// Permission keys, roles and scopes (web doc §6). Seeded into `permissions` by migration 0008.
// SHARED: depends only on zod / date-fns. Synced to jr-college-mobile/src/shared.

export const PERMISSIONS = [
  'settings.manage', 'roles.manage', 'audit.view',
  'structure.view', 'structure.manage', 'structure.activate',
  'calendar.manage', 'year.rollover', 'month.close',
  'admissions.import', 'students.view', 'students.manage', 'students.promote',
  'students.ids.view', 'students.sensitive.view',
  'guardians.view', 'guardians.manage', 'accounts.issue', 'consents.manage',
  'staff.view', 'staff.manage', 'assignments.manage',
  'timetable.view', 'timetable.edit', 'timetable.publish', 'sessions.manage',
  'attendance.view', 'attendance.mark', 'attendance.day.mark', 'attendance.override',
  'attendance.reopen', 'attendance.correct.approve', 'attendance.policy.manage',
  'devices.manage', 'biometric.view',
  'eligibility.view', 'eligibility.manage', 'condonation.recommend',
  'notices.defaulter.issue', 'certificates.issue', 'scholarships.manage', 'govt.export',
  'leave.student.decide', 'leave.staff.decide',
  'exams.manage', 'exams.attendance.mark',
  'announcements.college', 'announcements.class',
  'reports.view', 'reports.export',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const SCOPES = ['all', 'stream', 'class', 'assigned', 'self', 'linked'] as const;
export type Scope = (typeof SCOPES)[number];

export const ROLES = [
  'principal', 'supervisor', 'admin', 'office', 'exam_incharge', 'stream_coordinator',
  'teacher', 'student', 'parent',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  principal: 'Principal',
  supervisor: 'Supervisor',
  admin: 'Admin',
  office: 'Office',
  exam_incharge: 'Exam In-charge',
  stream_coordinator: 'Stream Coordinator',
  teacher: 'Teacher',
  student: 'Student',
  parent: 'Parent',
};

/** Roles whose primary client is the web portal. */
export const WEB_ROLES: readonly Role[] = [
  'principal', 'supervisor', 'admin', 'office', 'exam_incharge', 'stream_coordinator',
];

export interface Grant {
  permission: Permission;
  scope: Scope;
}

/** True when any grant matches the permission (optionally restricted to the given scopes). */
export function hasPermission(grants: readonly Grant[], permission: Permission, scopes?: Scope | readonly Scope[]): boolean {
  const allowed = scopes === undefined ? null : Array.isArray(scopes) ? scopes : [scopes];
  return grants.some((g) => g.permission === permission && (allowed === null || allowed.includes(g.scope)));
}

export type Persona = 'teacher' | 'student' | 'parent';

/**
 * Mobile persona resolution (mobile doc §6.3). Returns every persona the roles allow;
 * more than one means the app shows a persona picker, none means "use the web portal".
 */
export function personasFor(roles: readonly Role[]): Persona[] {
  const out: Persona[] = [];
  if (roles.some((r) => r === 'teacher' || r === 'supervisor' || r === 'stream_coordinator')) out.push('teacher');
  if (roles.includes('student')) out.push('student');
  if (roles.includes('parent')) out.push('parent');
  return out;
}
