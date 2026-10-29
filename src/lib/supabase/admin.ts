import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * Service-role client. Bypasses RLS: use ONLY after the caller has been authorised by the
 * action() wrapper, and only for the uses listed in docs/service-role-usage.md
 * (issuing logins, deactivating accounts, edition check).
 */
export function createAdminClient() {
  return createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
