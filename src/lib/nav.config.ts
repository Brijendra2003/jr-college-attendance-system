import type { Permission } from '@/shared/permissions';

export type NavIcon =
  | 'dashboard' | 'today' | 'register' | 'corrections' | 'months' | 'eligibility' | 'notices' | 'condonation'
  | 'myclass' | 'students' | 'guardians' | 'staff' | 'admissions' | 'structure' | 'years' | 'calendar'
  | 'timetable' | 'sessions' | 'leave' | 'announcements' | 'reports' | 'govt' | 'settings' | 'audit';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Any scope of any listed permission shows the entry. null = every web user. */
  permission: Permission | Permission[] | null;
  /** Only for teachers with a current class-teacher assignment. */
  classTeacherOnly?: boolean;
}

export const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', permission: null },
      { href: '/my-class', label: 'My class', icon: 'myclass', permission: null, classTeacherOnly: true },
    ],
  },
  {
    label: 'Attendance',
    items: [
      { href: '/attendance/today', label: 'Today', icon: 'today', permission: 'attendance.view' },
      { href: '/attendance/day', label: 'Day registers', icon: 'register', permission: 'attendance.view' },
      { href: '/attendance/corrections', label: 'Corrections', icon: 'corrections', permission: 'attendance.correct.approve' },
      { href: '/attendance/months', label: 'Month close & muster', icon: 'months', permission: 'month.close' },
    ],
  },
  {
    label: 'Eligibility',
    items: [
      { href: '/eligibility', label: 'Eligibility & defaulters', icon: 'eligibility', permission: 'eligibility.view' },
      { href: '/eligibility/notices', label: 'Defaulter notices', icon: 'notices', permission: 'notices.defaulter.issue' },
      { href: '/eligibility/condonation', label: 'Condonation', icon: 'condonation', permission: ['eligibility.manage', 'condonation.recommend'] },
    ],
  },
  {
    label: 'People',
    items: [
      { href: '/people/students', label: 'Students', icon: 'students', permission: 'students.view' },
      { href: '/people/guardians', label: 'Guardians & logins', icon: 'guardians', permission: 'guardians.manage' },
      { href: '/people/staff', label: 'Staff', icon: 'staff', permission: 'staff.view' },
      { href: '/admissions', label: 'Admissions import', icon: 'admissions', permission: 'admissions.import' },
    ],
  },
  {
    label: 'Academics',
    items: [
      { href: '/academics/structure', label: 'Structure', icon: 'structure', permission: 'structure.view' },
      { href: '/academics/years', label: 'Years & terms', icon: 'years', permission: 'structure.manage' },
      { href: '/academics/calendar', label: 'Calendar', icon: 'calendar', permission: 'calendar.manage' },
      { href: '/timetable', label: 'Timetable', icon: 'timetable', permission: 'timetable.edit' },
      { href: '/timetable/sessions', label: 'Daily sessions', icon: 'sessions', permission: 'sessions.manage' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/leave', label: 'Leave', icon: 'leave', permission: 'leave.student.decide' },
      { href: '/announcements', label: 'Announcements', icon: 'announcements', permission: 'announcements.college' },
      { href: '/reports', label: 'Reports', icon: 'reports', permission: 'reports.view' },
      { href: '/govt', label: 'Government data', icon: 'govt', permission: 'govt.export' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { href: '/settings', label: 'Settings', icon: 'settings', permission: ['settings.manage', 'attendance.policy.manage', 'roles.manage'] },
      { href: '/audit', label: 'Audit log', icon: 'audit', permission: 'audit.view' },
    ],
  },
];
