'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserClient } from '@/lib/supabase/client';
import { Field, Input } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

type Step = { kind: 'loading' } | { kind: 'enroll'; factorId: string; qr: string; secret: string } | { kind: 'verify'; factorId: string } | { kind: 'error'; message: string };

/** TOTP MFA for Principal and Admin (web doc §7). Enrols on first visit, then verifies each sign-in. */
export default function MfaPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = getBrowserClient();
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setStep({ kind: 'error', message: error.message });
      const verified = data.totp.find((f) => f.status === 'verified');
      if (verified) return setStep({ kind: 'verify', factorId: verified.id });
      // Remove half-finished enrolments before starting again.
      for (const f of data.all.filter((f) => f.status === 'unverified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
      if (enrolled.error) return setStep({ kind: 'error', message: enrolled.error.message });
      setStep({ kind: 'enroll', factorId: enrolled.data.id, qr: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret });
    })();
  }, []);

  async function verify(factorId: string) {
    setBusy(true);
    setError(null);
    const supabase = getBrowserClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (error) return setError('That code did not work. Check the time on your phone and try again.');
    router.replace('/dashboard');
    router.refresh();
  }

  return (
    <>
      <h1 className="text-lg font-semibold text-gray-900">Two-step verification</h1>
      {step.kind === 'loading' ? <p className="mt-4 text-sm text-gray-500">Loading…</p> : null}
      {step.kind === 'error' ? <p className="mt-4 text-sm text-red-700">{step.message}</p> : null}
      {step.kind === 'enroll' ? (
        <div className="mt-4 space-y-3 text-sm text-gray-600">
          <p>Principal and Admin accounts need an authenticator app (Google Authenticator, Microsoft Authenticator). Scan this code:</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={step.qr} alt="Authenticator QR code" className="mx-auto size-44" />
          <p className="break-all text-xs">Or enter this key: <code>{step.secret}</code></p>
        </div>
      ) : null}
      {step.kind === 'enroll' || step.kind === 'verify' ? (
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            verify(step.factorId);
          }}
        >
          <Field label="6-digit code">
            <Input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
          </Field>
          {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>Verify</Button>
        </form>
      ) : null}
    </>
  );
}
