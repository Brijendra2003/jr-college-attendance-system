'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Printer } from 'lucide-react';
import { issueLogin } from './actions';
import { Button } from '@/components/ui/button';

type Role = 'principal' | 'supervisor' | 'admin' | 'office' | 'exam_incharge' | 'stream_coordinator' | 'teacher';

/**
 * Issues an email + password login and shows the password ONCE as a printable login slip.
 * The password is not stored anywhere; issuing again resets it.
 */
export function IssueLoginButton({ kind, id, name, hasLogin, roles }: { kind: 'guardian' | 'staff' | 'student'; id: string; name: string; hasLogin: boolean; roles?: Role[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [slip, setSlip] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (slip) {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm">
        <div className="font-medium text-green-900">Login slip for {name}</div>
        <div className="mt-1 font-mono">Username: {slip.email}</div>
        <div className="font-mono">Password: {slip.password}</div>
        <div className="mt-1 text-xs text-green-800">Shown once. Hand it over in person; the user can change it in the app.</div>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => window.print()}><Printer className="size-3.5" /> Print</Button>
          <Button size="sm" variant="ghost" onClick={() => setSlip(null)}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant={hasLogin ? 'ghost' : 'secondary'}
        disabled={pending}
        onClick={() => {
          if (hasLogin && !window.confirm(`Reset the password for ${name}? Their old password stops working.`)) return;
          start(async () => {
            const res = await issueLogin({ kind, id, roles });
            if (res.ok) {
              setSlip(res.data as { email: string; password: string });
              setError(null);
              router.refresh();
            } else setError(res.error);
          });
        }}
      >
        <KeyRound className="size-3.5" /> {pending ? 'Issuing…' : hasLogin ? 'Reset password' : 'Issue login'}
      </Button>
      {error ? <span className="max-w-xs text-xs text-red-700">{error}</span> : null}
    </span>
  );
}
