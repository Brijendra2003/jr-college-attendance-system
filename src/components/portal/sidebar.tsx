import {
  BookOpen, CalendarDays, CalendarRange, ClipboardCheck, ClipboardList, FileClock, FileSpreadsheet, FileWarning,
  GraduationCap, Landmark, LayoutDashboard, Megaphone, PenLine, Plane, Scale, ScrollText, Settings, ShieldCheck,
  Sun, Upload, UserCog, Users, UsersRound, Clock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { NAV, type NavIcon } from '@/lib/nav.config';
import { can, type Viewer } from '@/lib/auth/viewer';
import { NavLink } from './nav-link';
import { SITE } from '@/lib/site';

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard, today: Sun, register: ClipboardCheck, corrections: PenLine, months: FileClock,
  eligibility: Scale, notices: FileWarning, condonation: ShieldCheck, myclass: UsersRound, students: GraduationCap,
  guardians: Users, staff: UserCog, admissions: Upload, structure: Landmark, years: CalendarRange,
  calendar: CalendarDays, timetable: BookOpen, sessions: Clock, leave: Plane, announcements: Megaphone,
  reports: FileSpreadsheet, govt: ClipboardList, settings: Settings, audit: ScrollText,
};

export function Sidebar({ viewer, collegeName }: { viewer: Viewer; collegeName: string }) {
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((item) => {
      if (item.classTeacherOnly) return viewer.classDivisions.length > 0;
      if (item.permission === null) return true;
      const perms = Array.isArray(item.permission) ? item.permission : [item.permission];
      return perms.some((p) => can(viewer, p));
    }),
  })).filter((g) => g.items.length > 0);

  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="px-5 py-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Attendance</div>
        <div className="mt-1 text-sm font-medium leading-snug text-gray-900">{collegeName || SITE.collegeName}</div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{g.label}</div>
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const Icon = ICONS[item.icon];
                return (
                  <li key={item.href}>
                    <NavLink href={item.href}>
                      <Icon aria-hidden className="size-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

export function SidebarSkeleton() {
  return (
    <div className="space-y-3 p-5" aria-hidden>
      <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="h-7 animate-pulse rounded bg-gray-100" />
      ))}
    </div>
  );
}
