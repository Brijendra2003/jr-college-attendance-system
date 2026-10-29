// Environment for the Junior College edition. Names carry a JR_ prefix so an engineering-edition
// key can never be picked up by mistake (web doc §5).

function need(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}

export const env = {
  get supabaseUrl() {
    return need('NEXT_PUBLIC_JR_SUPABASE_URL', process.env.NEXT_PUBLIC_JR_SUPABASE_URL);
  },
  get supabasePublishableKey() {
    return need('NEXT_PUBLIC_JR_SUPABASE_PUBLISHABLE_KEY', process.env.NEXT_PUBLIC_JR_SUPABASE_PUBLISHABLE_KEY);
  },
  get serviceRoleKey() {
    return need('JR_SUPABASE_SERVICE_ROLE_KEY', process.env.JR_SUPABASE_SERVICE_ROLE_KEY);
  },
  get siteUrl() {
    return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  },
};
