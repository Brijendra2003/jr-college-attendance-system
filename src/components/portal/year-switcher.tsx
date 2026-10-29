'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setAcademicYear } from '@/features/auth/actions';
import type { YearRow } from '@/features/academics/context';

export function YearSwitcher({ years, value }: { years: YearRow[]; value: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!years.length) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Academic year</span>
      <select
        className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm disabled:opacity-60"
        value={value ?? ''}
        disabled={pending}
        onChange={(e) => {
          const id = e.target.value;
          start(async () => {
            await setAcademicYear(id);
            router.refresh();
          });
        }}
      >
        {years.map((y) => (
          <option key={y.id} value={y.id}>
            {y.label}{y.status === 'active' ? ' (active)' : y.status === 'archived' ? ' (archived)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
