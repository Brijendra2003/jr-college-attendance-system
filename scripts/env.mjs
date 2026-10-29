// Loads .env.local / .env for the CLI scripts (Next.js loads them itself for the app).
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const file of ['.env.local', '.env']) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export const URL = process.env.NEXT_PUBLIC_JR_SUPABASE_URL;
export const ANON = process.env.NEXT_PUBLIC_JR_SUPABASE_PUBLISHABLE_KEY;
export const SERVICE = process.env.JR_SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE || !ANON) {
  console.error('Set NEXT_PUBLIC_JR_SUPABASE_URL, NEXT_PUBLIC_JR_SUPABASE_PUBLISHABLE_KEY and JR_SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

export const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

/** Refuse to touch any database that is not the Junior College edition. */
export async function assertEdition() {
  const { data, error } = await admin.from('app_config').select('value').eq('key', 'edition').single();
  if (error || data.value !== 'junior_college') {
    console.error(`Refusing to run: database edition is ${error ? 'unreadable' : JSON.stringify(data.value)}, expected "junior_college".`);
    process.exit(1);
  }
}

/** A client signed in as the given user (RPCs then run with that user's permissions). */
export async function signedIn(email, password) {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return c;
}

export function must({ data, error }, what = 'query') {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}
