'use client';

import { useActionState } from 'react';
import { setNewPassword } from '@/features/auth/actions';
import { Field, Input } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState(setNewPassword, null);
  return (
    <>
      <h1 className="text-lg font-semibold text-gray-900">Choose a new password</h1>
      <form action={formAction} className="mt-6 space-y-4">
        <Field label="New password" hint="At least 10 characters.">
          <Input name="password" type="password" autoComplete="new-password" required minLength={10} />
        </Field>
        <Field label="Confirm password">
          <Input name="confirm" type="password" autoComplete="new-password" required />
        </Field>
        {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
        <Button type="submit" className="w-full" disabled={pending}>Save password</Button>
      </form>
    </>
  );
}
