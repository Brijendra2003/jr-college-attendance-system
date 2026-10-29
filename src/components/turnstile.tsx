'use client';

import Script from 'next/script';

/**
 * Cloudflare Turnstile bot check (web doc §7). Renders only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set;
 * the widget adds a hidden `cf-turnstile-response` field that the server passes to Supabase Auth
 * as captchaToken (enable CAPTCHA protection in Supabase Auth with the matching secret).
 */
export function Turnstile() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      <div className="cf-turnstile" data-sitekey={siteKey} data-theme="light" />
    </>
  );
}
