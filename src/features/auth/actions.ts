'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getViewer } from '@/lib/auth/viewer';
import { YEAR_COOKIE } from '@/features/academics/context';
import { loginSchema, newPasswordSchema, resetRequestSchema } from '@/shared/schemas';
import { env } from '@/lib/env';

export type FormState = { error?: string; message?: string } | null;

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check your details.' };
  const { identifier, password } = parsed.data;
  const INVALID = 'Username/email or password is incorrect.';

  // Usernames resolve to the account's email on the server (never exposed to the browser).
  let email = identifier.toLowerCase();
  if (!identifier.includes('@')) {
    const { data } = await createAdminClient().from('profiles').select('email, is_active').eq('username', email).maybeSingle();
    if (!data?.email || !data.is_active) return { error: INVALID }; // same message as a wrong password
    email = data.email;
  }

  const supabase = await createClient();
  const captchaToken = String(formData.get('cf-turnstile-response') ?? '') || undefined;
  const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
  if (error) {
    return { error: error.status === 429 ? 'Too many attempts. Please wait a minute.' : INVALID };
  }
  const next = String(formData.get('next') ?? '');
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const captchaToken = String(formData.get('cf-turnstile-response') ?? '') || undefined;
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env.siteUrl}/auth/confirm?next=/reset-password`,
    captchaToken,
  });
  // Never reveal whether the address has an account.
  return { message: 'If this email has an account, a reset link is on its way.' };
}

export async function setNewPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = newPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: error.message };
  redirect('/dashboard');
}

export async function setAcademicYear(yearId: string) {
  if (!(await getViewer())) return;
  (await cookies()).set(YEAR_COOKIE, yearId, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 180 });
}
