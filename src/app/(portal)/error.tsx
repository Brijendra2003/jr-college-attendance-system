'use client';

import { Button } from '@/components/ui/button';

export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
      <h1 className="text-lg font-semibold text-gray-900">This page could not be loaded</h1>
      <p className="mt-2 text-sm text-gray-600">
        Please try again. If it keeps happening, tell the office and mention reference{' '}
        <code className="rounded bg-gray-100 px-1">{error.digest ?? 'n/a'}</code>.
      </p>
      <Button className="mt-4" onClick={reset}>Try again</Button>
    </div>
  );
}
