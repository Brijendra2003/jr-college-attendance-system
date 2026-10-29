// Runs once when the server starts. Refuses to serve with an unsafe or incomplete configuration.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;

  const problems: string[] = [];
  for (const name of ['NEXT_PUBLIC_JR_SUPABASE_URL', 'NEXT_PUBLIC_JR_SUPABASE_PUBLISHABLE_KEY', 'JR_SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SITE_URL']) {
    if (!process.env[name]) problems.push(`${name} is not set`);
  }

  if (process.env.NODE_ENV === 'production') {
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? '';
    if (site && !/^https:\/\//.test(site)) problems.push(`NEXT_PUBLIC_SITE_URL must be an https:// URL (got "${site}")`);
    if (process.env.JR_REQUIRE_MFA === 'false') problems.push('JR_REQUIRE_MFA=false is only allowed in development');
    if (!/^https:\/\//.test(process.env.NEXT_PUBLIC_JR_SUPABASE_URL ?? '')) problems.push('NEXT_PUBLIC_JR_SUPABASE_URL must be https in production');
  }

  if (problems.length) {
    const message = `Refusing to start:\n  - ${problems.join('\n  - ')}`;
    console.error(message);
    throw new Error(message);
  }
}
