import type { ReactNode } from 'react';
import { SITE } from '@/lib/site';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50 to-white p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold text-gray-900">{SITE.collegeName}</div>
          <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-brand-600">Attendance &amp; records · Std XI–XII</div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">{children}</div>
        <p className="mt-6 text-center text-xs text-gray-500">
          Accounts are issued by the college office. There is no public sign-up.
        </p>
      </div>
    </main>
  );
}
