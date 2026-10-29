// Notification dispatcher (web doc §15). Invoked every minute by pg_cron (migration 0009).
// Claims queued outbox rows with `for update skip locked`, sends push through FCM HTTP v1
// (Android + iOS via APNs) and email through Resend, then reports each result back.
//
// Secrets (supabase secrets set …):
//   FCM_SERVICE_ACCOUNT  JSON of a Firebase service account (project_id, client_email, private_key)
//   RESEND_API_KEY       optional; email channel is skipped without it
//   MAIL_FROM            e.g. "Demo Junior College <attendance@college.edu.in>"
import { createClient } from 'npm:@supabase/supabase-js@2';

interface Claimed {
  id: number; event_type: string; user_id: string; channel: string; attempts: number;
  payload: { title: string; body: string; data?: Record<string, unknown> };
  tokens: string[]; email: string | null; language: string;
}

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

// Android notification channels (mobile doc §13).
const CHANNEL: Record<string, string> = {
  student_absent_day: 'attendance', attendance_corrected: 'attendance', parent_daily_digest: 'attendance',
  defaulter_warning: 'notices', eligibility_changed: 'notices', announcement: 'announcements',
  exam_published: 'exams', exam_changed: 'exams',
};
// Events that also go out by email (when the user has an address and email is configured).
const EMAIL_EVENTS = new Set(['eligibility_changed', 'exam_published', 'exam_changed', 'defaulter_warning']);

// ---------------------------------------------------------------- FCM OAuth token (cached per instance)
let cached: { token: string; exp: number } | null = null;

const b64url = (data: ArrayBuffer | string) =>
  btoa(typeof data === 'string' ? data : String.fromCharCode(...new Uint8Array(data)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function fcmAccessToken(sa: { client_email: string; private_key: string }) {
  if (cached && cached.exp > Date.now() / 1000 + 60) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey(
    'pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`FCM auth failed: ${res.status}`);
  const json = await res.json();
  cached = { token: json.access_token, exp: now + json.expires_in };
  return cached.token;
}

async function sendPush(n: Claimed, sa: { project_id: string; client_email: string; private_key: string }) {
  const token = await fcmAccessToken(sa);
  const dead: string[] = [];
  let delivered = 0;
  // FCM data values must be strings.
  const data = Object.fromEntries(Object.entries({ ...(n.payload.data ?? {}), notificationType: n.event_type }).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  for (const t of n.tokens) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: t,
          notification: { title: n.payload.title, body: n.payload.body },
          data,
          android: { priority: 'high', notification: { channel_id: CHANNEL[n.event_type] ?? 'reminders' } },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      }),
    });
    if (res.ok) delivered++;
    else {
      const body = await res.text();
      if (res.status === 404 || body.includes('UNREGISTERED')) dead.push(t);
    }
  }
  return { delivered, dead };
}

async function sendEmail(n: Claimed) {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key || !n.email) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: Deno.env.get('MAIL_FROM'), to: n.email, subject: n.payload.title, text: n.payload.body }),
  });
  return res.ok;
}

Deno.serve(async (req) => {
  // Only the cron job (service role bearer) may trigger dispatch.
  if (req.headers.get('Authorization') !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return new Response('forbidden', { status: 403 });
  }
  const sa = Deno.env.get('FCM_SERVICE_ACCOUNT') ? JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT')!) : null;
  const { data, error } = await supabase.rpc('claim_notification_batch', { p_limit: 200 });
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0;
  for (const n of (data ?? []) as Claimed[]) {
    try {
      let ok = false;
      let dead: string[] = [];
      if (sa && n.tokens.length) {
        const r = await sendPush(n, sa);
        ok = r.delivered > 0;
        dead = r.dead;
      }
      if (EMAIL_EVENTS.has(n.event_type)) ok = (await sendEmail(n)) || ok;
      // No device and no email: the in-app notification centre still has it, so the row is done.
      if (!n.tokens.length && !EMAIL_EVENTS.has(n.event_type)) ok = true;
      await supabase.rpc('complete_notification', { p_id: n.id, p_ok: ok, p_error: ok ? null : 'no channel delivered', p_dead_tokens: dead });
      if (ok) sent++;
    } catch (e) {
      await supabase.rpc('complete_notification', { p_id: n.id, p_ok: false, p_error: String(e).slice(0, 500), p_dead_tokens: [] });
    }
  }
  return Response.json({ claimed: data?.length ?? 0, sent });
});
