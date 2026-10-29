'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/lib/auth/action';
import { Button } from '@/components/ui/button';

/**
 * One-click Server Action call with an optional confirmation and an optional free-text prompt
 * (e.g. a reason), whose answer is sent as `promptField`.
 */
export function ActionButton<T>({
  action,
  payload,
  label,
  variant = 'secondary',
  size = 'sm',
  confirm,
  prompt,
  promptField = 'reason',
  disabled,
}: {
  action: (input: never) => Promise<ActionResult<T>>;
  payload: Record<string, unknown>;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  confirm?: string;
  prompt?: string;
  promptField?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant={variant}
        size={size}
        disabled={pending || disabled}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          let extra: Record<string, unknown> = {};
          if (prompt) {
            const answer = window.prompt(prompt);
            if (answer === null) return;
            extra = { [promptField]: answer };
          }
          start(async () => {
            const res = await action({ ...payload, ...extra } as never);
            setMsg(res.ok ? (res.message ? { ok: true, text: res.message } : null) : { ok: false, text: res.error });
            if (res.ok) router.refresh();
          });
        }}
      >
        {pending ? '…' : label}
      </Button>
      {msg ? <span className={msg.ok ? 'text-xs text-green-700' : 'text-xs text-red-700'}>{msg.text}</span> : null}
    </span>
  );
}
