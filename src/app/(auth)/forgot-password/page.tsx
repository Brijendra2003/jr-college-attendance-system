'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { requestPasswordReset } from '@/features/auth/actions';
import { Field, Input } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Turnstile } from '@/components/turnstile';

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, null);
  return (
    <>
      <h1 className="text-lg font-semibold text-gray-900">Reset your password</h1>
      <p className="mt-1 text-sm text-gray-500">We will email you a link to choose a new password.</p>
      <form action={formAction} className="mt-6 space-y-4">
        <Field label="Email">
          <Input name="email" type="email" autoComplete="username" required />
        </Field>
        <Turnstile />
        {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
        {state?.message ? <p role="status" className="text-sm text-green-700">{state.message}</p> : null}
        <Button type="submit" className="w-full" disabled={pending}>Send reset link</Button>
      </form>
      <Link href="/login" className="mt-4 block text-center text-sm text-brand-600 hover:underline">Back to sign in</Link>
    </>
  );
}
