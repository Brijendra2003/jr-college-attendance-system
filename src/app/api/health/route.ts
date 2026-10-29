import { createClient } from '@supabase/supabase-js';

/**
 * Uptime check: 200 when the app can reach the Junior College database, 503 otherwise.
 * Reads only the public edition marker; reveals nothing else.
 */
export async function GET() {
  const started = Date.now();
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_JR_SUPABASE_URL!, process.env.NEXT_PUBLIC_JR_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase.from('app_config').select('value').eq('key', 'edition').maybeSingle();
    const ok = !error && data?.value === 'junior_college';
    return Response.json({ ok, db: ok ? 'up' : 'unavailable', ms: Date.now() - started }, { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, db: 'unreachable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
