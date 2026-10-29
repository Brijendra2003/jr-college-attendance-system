'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  // Exact match for section roots that have siblings underneath (e.g. /eligibility vs /eligibility/notices).
  const active = pathname === href || (pathname.startsWith(`${href}/`) && !['/eligibility', '/timetable'].includes(href));
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors',
        active ? 'bg-brand-50 font-medium text-brand-700' : 'text-gray-700 hover:bg-gray-100',
      )}
    >
      {children}
    </Link>
  );
}
