'use client';

import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from '@/features/auth/actions';
import { Field, Input } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Turnstile } from '@/components/turnstile';

export function LoginForm() {
  const next = useSearchParams().get('next') ?? '';
  const [state, formAction, pending] = useActionState(signIn, null);
  return (
    <form action={formAction} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email or username">
        <Input name="identifier" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Turnstile />
      {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
      <Button type="submit" className="w-full" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</Button>
    </form>
  );
}
