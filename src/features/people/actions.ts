'use server';

import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { action, ActionError, must } from '@/lib/auth/action';
import { createAdminClient } from '@/lib/supabase/admin';
import { classTeacherSchema, guardianSchema, issueLoginSchema, staffSchema, studentSchema } from '@/shared/schemas';

// ---------------------------------------------------------------- students
export const createStudent = action({
  permission: 'admissions.import',
  scopes: ['all'],
  schema: studentSchema,
  async run({ input, supabase }) {
    const { data: div } = await supabase.from('divisions').select('name').eq('id', input.division_id).single();
    if (!div) throw new ActionError('Choose a division.');
    // Same path as the bulk import, so GR numbers, roll numbers and duplicate checks behave identically.
    const res = must(
      await supabase.rpc('import_students', { p_rows: [{ ...input, division: div.name }], p_commit: true }),
    ) as { rows: { outcome: string; errors: string[]; student_id: string | null }[] };
    const row = res.rows[0];
    if (row.outcome === 'existing') throw new ActionError('A student with this GR No., CAP application no. or SSC seat no. already exists.');
    if (row.outcome !== 'new') throw new ActionError(row.errors.join('; ') || 'Could not create the student.');
    return { id: row.student_id as string };
  },
});

export const updateStudentIds = action({
  permission: 'students.manage',
  scopes: ['all'],
  schema: z.object({
    id: z.uuid(),
    name_mr: z.string().trim().max(200).transform((v) => v || null),
    saral_id: z.string().trim().max(30).transform((v) => v || null),
    pen: z.string().trim().max(20).transform((v) => v || null),
    apaar_id: z.string().trim().max(20).transform((v) => v || null),
    login_email: z.email().or(z.literal('')).transform((v) => v.toLowerCase() || null),
  }),
  message: 'Student details saved.',
  async run({ input: { id, ...rest }, supabase }) {
    must(await supabase.from('students').update(rest).eq('id', id));
  },
});

export const endEnrollment = action({
  permission: 'students.manage',
  scopes: ['all'],
  schema: z.object({
    studentId: z.uuid(),
    status: z.enum(['left', 'admission_cancelled', 'transferred', 'detained', 'passed_out']),
    on: z.iso.date(),
    reason: z.string().trim().min(3, 'Give a reason'),
  }),
  message: 'Enrollment closed. The GR No. is kept permanently.',
  async run({ input, supabase }) {
    const res = must(await supabase.rpc('end_enrollment', { p_student_id: input.studentId, p_status: input.status, p_on: input.on, p_reason: input.reason })) as { deactivated_user: string | null };
    if (res.deactivated_user) await createAdminClient().auth.admin.updateUserById(res.deactivated_user, { ban_duration: '876000h' });
  },
});

export const transferStudent = action({
  permission: 'students.manage',
  scopes: ['all'],
  schema: z.object({ studentId: z.uuid(), divisionId: z.uuid(), on: z.iso.date(), rollNo: z.string().trim().max(10).optional(), reason: z.string().trim().min(3) }),
  message: (d: { roll_no: string }) => `Transferred. New roll no. ${d.roll_no}.`,
  async run({ input, supabase }) {
    return must(await supabase.rpc('transfer_student', {
      p_student_id: input.studentId, p_division_id: input.divisionId, p_on: input.on, p_roll_no: input.rollNo ?? null, p_reason: input.reason,
    })) as { roll_no: string };
  },
});

export const setStudentBatch = action({
  permission: 'students.manage',
  scopes: ['all'],
  schema: z.object({ studentId: z.uuid(), batchId: z.uuid().or(z.literal('')).transform((v) => v || null) }),
  message: 'Batch updated.',
  async run({ input, supabase }) {
    must(await supabase.rpc('set_student_batch', { p_student_id: input.studentId, p_batch_id: input.batchId }));
  },
});

// ---------------------------------------------------------------- guardians & consent
export const addGuardian = action({
  permission: 'guardians.manage',
  scopes: ['all'],
  schema: guardianSchema,
  message: 'Guardian linked (pending verification).',
  async run({ input: { student_id, ...g }, supabase }) {
    let guardianId: string | null = null;
    if (g.email) {
      const { data } = await supabase.from('guardians').select('id').eq('email', g.email).maybeSingle();
      guardianId = data?.id ?? null;
    }
    if (!guardianId) {
      guardianId = (must(await supabase.from('guardians').insert(g).select('id').single()) as { id: string }).id;
    }
    must(await supabase.from('guardian_links').upsert({ student_id, guardian_id: guardianId }, { onConflict: 'student_id,guardian_id', ignoreDuplicates: true }));
  },
});

export const setGuardianLink = action({
  permission: 'guardians.manage',
  scopes: ['all'],
  schema: z.object({ linkId: z.uuid(), status: z.enum(['verified', 'revoked', 'pending']) }),
  message: (s: string) => `Link ${s}.`,
  async run({ input, supabase, viewer }) {
    must(
      await supabase
        .from('guardian_links')
        .update({
          status: input.status,
          verified_by: input.status === 'verified' ? viewer.userId : null,
          verified_at: input.status === 'verified' ? new Date().toISOString() : null,
        })
        .eq('id', input.linkId),
    );
    return input.status;
  },
});

export const recordPaperConsent = action({
  permission: 'consents.manage',
  scopes: ['all'],
  schema: z.object({ studentId: z.uuid(), guardianId: z.uuid().optional(), purposes: z.array(z.enum(['app_account', 'photos', 'biometric', 'apaar', 'communications'])).min(1) }),
  message: 'Consent recorded.',
  async run({ input, supabase, viewer }) {
    must(
      await supabase.from('consents').insert(
        input.purposes.map((purpose) => ({ student_id: input.studentId, guardian_id: input.guardianId ?? null, purpose, method: 'paper', recorded_by: viewer.userId })),
      ),
    );
  },
});

export const withdrawConsent = action({
  permission: 'consents.manage',
  scopes: ['all'],
  schema: z.object({ id: z.uuid() }),
  message: 'Consent withdrawn.',
  async run({ input, supabase }) {
    must(await supabase.from('consents').update({ withdrawn_at: new Date().toISOString() }).eq('id', input.id));
  },
});

// ---------------------------------------------------------------- staff
export const createStaff = action({
  permission: 'staff.manage',
  scopes: ['all'],
  schema: staffSchema,
  message: 'Staff member added.',
  async run({ input, supabase }) {
    must(await supabase.from('staff').insert(input));
  },
});

export const assignClassTeacher = action({
  permission: 'assignments.manage',
  scopes: ['all'],
  schema: classTeacherSchema,
  message: 'Class teacher assigned.',
  async run({ input, supabase }) {
    must(await supabase.rpc('assign_class_teacher', { p_division_id: input.division_id, p_staff_id: input.staff_id, p_from: input.from }));
  },
});

export const assignCoordinator = action({
  permission: 'assignments.manage',
  scopes: ['all'],
  schema: z.object({ stream_id: z.uuid(), staff_id: z.uuid(), from: z.iso.date() }),
  message: 'Stream coordinator assigned.',
  async run({ input, supabase }) {
    must(await supabase.rpc('assign_stream_coordinator', { p_stream_id: input.stream_id, p_staff_id: input.staff_id, p_from: input.from }));
  },
});

// ---------------------------------------------------------------- logins (service role, after authorisation)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const generatePassword = () => Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/**
 * Issue (or re-issue) an email + password login. The password is returned once to be handed over
 * on a login slip; it is never stored. No SMS / OTP sign-in exists (web doc §7).
 */
export const issueLogin = action({
  permission: 'accounts.issue',
  scopes: ['all'],
  schema: issueLoginSchema,
  async run({ input, supabase, viewer }) {
    let email: string | null = null;
    let displayName = '';
    let language = 'en';
    let roles: string[] = [];
    let table: 'guardians' | 'staff' | 'students';

    if (input.kind === 'guardian') {
      const g = must(await supabase.from('guardians').select('full_name, email, preferred_language, guardian_links(status)').eq('id', input.id).single()) as {
        full_name: string; email: string | null; preferred_language: string; guardian_links: { status: string }[];
      };
      if (!g.guardian_links.some((l) => l.status === 'verified')) throw new ActionError('Verify the guardian link against the admission form first.');
      email = g.email; displayName = g.full_name; language = g.preferred_language; roles = ['parent']; table = 'guardians';
    } else if (input.kind === 'staff') {
      const s = must(await supabase.from('staff').select('full_name, email').eq('id', input.id).single()) as { full_name: string; email: string | null };
      if (!viewer.roles.includes('admin') && !viewer.roles.includes('principal') && input.roles?.some((r) => r !== 'teacher')) {
        throw new ActionError('Only the Admin or Principal can grant roles other than Teacher.');
      }
      email = s.email; displayName = s.full_name; roles = input.roles?.length ? input.roles : ['teacher']; table = 'staff';
    } else {
      const s = must(await supabase.from('students').select('full_name, login_email').eq('id', input.id).single()) as { full_name: string; login_email: string | null };
      const { count } = await supabase.from('consents').select('id', { count: 'exact', head: true })
        .eq('student_id', input.id).eq('purpose', 'app_account').is('withdrawn_at', null);
      if (!count) throw new ActionError('Record guardian consent for the student app account first (web doc §18).');
      email = s.login_email; displayName = s.full_name; roles = ['student']; table = 'students';
    }
    if (!email) throw new ActionError('Add an email address first: it is the login username.');

    const admin = createAdminClient();
    const password = generatePassword();
    const { data: existing } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
    let userId = existing?.id as string | undefined;
    if (userId) {
      const { error } = await admin.auth.admin.updateUserById(userId, { password, ban_duration: 'none' });
      if (error) throw new ActionError(error.message);
      must(await admin.from('profiles').update({ is_active: true }).eq('id', userId));
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { display_name: displayName, preferred_language: language },
      });
      if (error || !data.user) throw new ActionError(error?.message ?? 'Could not create the login.');
      userId = data.user.id;
    }
    must(await admin.from(table).update({ user_id: userId }).eq('id', input.id));
    must(await admin.from('user_roles').upsert(roles.map((role) => ({ user_id: userId, role, granted_by: viewer.userId })), { onConflict: 'user_id,role', ignoreDuplicates: true }));
    must(await admin.from('audit_log').insert({ actor_id: viewer.userId, action: 'issue_login', entity: table, entity_id: input.id, after: { email, roles } }));
    return { email, password };
  },
});

export const setAccountActive = action({
  permission: 'accounts.issue',
  scopes: ['all'],
  schema: z.object({ userId: z.uuid(), active: z.boolean() }),
  message: (active: boolean) => (active ? 'Account re-activated.' : 'Account deactivated and signed out.'),
  async run({ input, viewer }) {
    if (input.userId === viewer.userId) throw new ActionError('You cannot deactivate your own account.');
    const admin = createAdminClient();
    must(await admin.from('profiles').update({ is_active: input.active }).eq('id', input.userId));
    const { error } = await admin.auth.admin.updateUserById(input.userId, { ban_duration: input.active ? 'none' : '876000h' });
    if (error) throw new ActionError(error.message);
    must(await admin.from('audit_log').insert({ actor_id: viewer.userId, action: input.active ? 'activate_account' : 'deactivate_account', entity: 'profiles', entity_id: input.userId }));
    return input.active;
  },
});
