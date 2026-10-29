import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

let checked: Promise<void> | null = null;

/**
 * Refuse to run against any database that is not the Junior College edition (web doc §5).
 * `app_config.edition` is a public row, so the publishable key can read it. Checked once per process.
 */
export function assertEdition(): Promise<void> {
  checked ??= (async () => {
    const supabase = createClient(env.supabaseUrl, env.supabasePublishableKey, { auth: { persistSession: false } });
    const { data, error } = await supabase.from('app_config').select('value').eq('key', 'edition').maybeSingle();
    if (error) {
      checked = null; // transient: retry on the next request
      throw new Error(`Could not read app_config.edition: ${error.message}`);
    }
    if (data?.value !== 'junior_college') {
      throw new Error(
        `This web app is the Junior College edition but the database reports edition "${String(data?.value)}". ` +
          'Check NEXT_PUBLIC_JR_SUPABASE_URL.',
      );
    }
  })();
  return checked;
}
