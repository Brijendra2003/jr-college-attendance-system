import { LogOut, Menu, Search } from 'lucide-react';
import type { Viewer } from '@/lib/auth/viewer';
import { ROLE_LABELS } from '@/shared/permissions';
import { signOut } from '@/features/auth/actions';
import type { YearRow } from '@/features/academics/context';
import { YearSwitcher } from './year-switcher';
import { Sidebar } from './sidebar';

export function Topbar({ viewer, years, yearId, collegeName }: { viewer: Viewer; years: YearRow[]; yearId: string | null; collegeName: string }) {
  const roleLabel = viewer.roles.length
    ? viewer.roles.filter((r) => r !== 'student' && r !== 'parent').map((r) => ROLE_LABELS[r]).join(', ')
    : 'Class teacher';
  return (
    <div className="flex h-14 items-center gap-3 px-4 lg:px-8">
      <details className="relative lg:hidden">
        <summary className="flex size-9 cursor-pointer list-none items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Menu">
          <Menu className="size-5" />
        </summary>
        <div className="absolute left-0 top-11 z-20 max-h-[80vh] w-72 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          <Sidebar viewer={viewer} collegeName={collegeName} />
        </div>
      </details>

      <form action="/people/students" method="get" className="relative hidden max-w-sm flex-1 sm:block" role="search">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
        <input
          name="q"
          placeholder="Find a student: name, GR no., APAAR, Saral ID…"
          className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none"
        />
      </form>

      <div className="ml-auto flex items-center gap-3">
        <YearSwitcher years={years} value={yearId} />
        <div className="hidden text-right leading-tight md:block">
          <div className="text-sm font-medium text-gray-900">{viewer.displayName}</div>
          <div className="text-xs text-gray-500">{roleLabel}</div>
        </div>
        <form action={signOut}>
          <button type="submit" className="flex size-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100" title="Sign out" aria-label="Sign out">
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
