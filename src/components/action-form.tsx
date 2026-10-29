'use client';

import { useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/lib/auth/action';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * FormData → plain object for the Zod schemas:
 *  - `name[]` collects every value into an array
 *  - checkboxes named without [] become booleans
 *  - empty strings are kept (schemas turn them into null)
 */
export function formToObject(form: HTMLFormElement): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const fd = new FormData(form);
  for (const [key, value] of fd.entries()) {
    if (key.endsWith('[]')) {
      const k = key.slice(0, -2);
      const list = (out[k] as unknown[] | undefined) ?? [];
      list.push(value);
      out[k] = list;
    } else {
      out[key] = value;
    }
  }
  for (const el of Array.from(form.elements)) {
    if (el instanceof HTMLInputElement && el.type === 'checkbox' && el.name && !el.name.endsWith('[]')) {
      out[el.name] = el.checked;
    }
    if (el instanceof HTMLInputElement && el.name.endsWith('[]') && !(el.name.slice(0, -2) in out)) {
      out[el.name.slice(0, -2)] = [];
    }
  }
  return out;
}

export function ActionForm<T>({
  action,
  children,
  submitLabel = 'Save',
  className,
  resetOnSuccess = false,
  extra,
  onSuccess,
  footer,
}: {
  action: (input: never) => Promise<ActionResult<T>>;
  children: ReactNode;
  submitLabel?: string;
  className?: string;
  resetOnSuccess?: boolean;
  /** Extra values merged into the payload (ids that are not form fields). */
  extra?: Record<string, unknown>;
  onSuccess?: (data: T) => void;
  footer?: ReactNode;
}) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult<T> | null>(null);

  return (
    <form
      ref={ref}
      className={cn('space-y-4', className)}
      onSubmit={(e) => {
        e.preventDefault();
        const payload = { ...formToObject(e.currentTarget), ...extra };
        start(async () => {
          const res = await action(payload as never);
          setResult(res);
          if (res.ok) {
            if (resetOnSuccess) ref.current?.reset();
            onSuccess?.(res.data);
            router.refresh();
          }
        });
      }}
    >
      {children}
      <ResultMessage result={result} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : submitLabel}</Button>
        {footer}
      </div>
    </form>
  );
}

export function ResultMessage<T>({ result }: { result: ActionResult<T> | null }) {
  if (!result) return null;
  if (result.ok) {
    return result.message ? <p role="status" className="text-sm text-green-700">{result.message}</p> : null;
  }
  const fields = Object.entries(result.fieldErrors ?? {}).filter(([, v]) => v?.length);
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <p>{result.error}</p>
      {fields.length ? (
        <ul className="mt-1 list-disc pl-5">
          {fields.map(([k, v]) => (
            <li key={k}>
              <span className="font-medium">{k.replace(/_/g, ' ')}</span>: {v.join(', ')}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
