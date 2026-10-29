// Runs the migrations in PGlite (Postgres compiled to WASM) with a minimal emulation of the
// Supabase pieces they rely on: auth schema + auth.uid()/jwt()/role(), API roles and default grants.
// No Docker needed. The full Supabase stack (supabase start + pgTAP) remains the CI reference.
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export async function boot({ quiet = true } = {}) {
  const db = await PGlite.create({ extensions: { btree_gist } });
  await db.exec(SUPABASE_STUB);
  for (const f of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
      if (!quiet) console.log('migrated', f);
    } catch (e) {
      console.error(`Migration ${f} failed: ${e.message}`);
      throw e;
    }
  }
  return db;
}

/** Run fn inside a transaction as a signed-in user, so RLS and auth.uid() apply. */
export async function as(db, userId, fn, extraClaims = {}) {
  return db.transaction(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: 'authenticated', aal: 'aal2', ...extraClaims });
    await tx.exec('set local role authenticated');
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    return fn(tx);
  });
}

/** Run fn as the service role (Edge Functions, cron callers). */
export async function asService(db, fn) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    await tx.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    return fn(tx);
  });
}
