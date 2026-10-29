'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

/** Browser client (Realtime subscriptions, MFA enrolment). Reads go through Server Components. */
export function getBrowserClient() {
  client ??= createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_JR_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_JR_SUPABASE_PUBLISHABLE_KEY!,
  );
  return client;
}
