'use server';

import { z } from 'zod';
import { action, ActionError, must } from '@/lib/auth/action';
import { policySchema } from '@/shared/schemas';
import { ROLES } from '@/shared/permissions';

/** Policies are effective-dated: saving adds a new college-wide row and ends the previous one. */
export const savePolicy = action({
  permission: 'attendance.policy.manage',
  scopes: ['all'],
  schema: policySchema,
  message: 'Policy saved. It applies from the effective date; earlier dates keep the old rules.',
  async run({ input, supabase }) {
    const { data: current } = await supabase
      .from('attendance_policies').select('id, effective_from').eq('scope_kind', 'college').is('effective_to', null)
      .order('effective_from', { ascending: false }).limit(1).maybeSingle();
    if (current && current.effective_from >= input.effective_from) {
      // Same or earlier start: replace the current row's values in place (no history gap).
      must(await supabase.from('attendance_policies').update(input).eq('id', current.id));
      return;
    }
    if (current) {
      const dayBefore = new Date(`${input.effective_from}T00:00:00Z`);
      dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
      must(await supabase.from('attendance_policies').update({ effective_to: dayBefore.toISOString().slice(0, 10) }).eq('id', current.id));
    }
    must(await supabase.from('attendance_policies').insert({ ...input, scope_kind: 'college' }));
  },
});

export const updateStatusCode = action({
  permission: 'attendance.policy.manage',
  scopes: ['all'],
  schema: z.object({
    code: z.string().min(1).max(4),
    label_mr: z.string().trim().min(1).max(40),
    day_value: z.coerce.number().min(0).max(1),
    counts_in_held: z.boolean(),
    teacher_can_set: z.boolean(),
  }),
  message: 'Status code updated. Run "reconcile summaries" or wait for the nightly job to recompute percentages.',
  async run({ input: { code, ...rest }, supabase }) {
    must(await supabase.from('attendance_status_codes').update(rest).eq('code', code));
  },
});

const STAFF_ROLES = ROLES.filter((r) => r !== 'student' && r !== 'parent');

export const setUserRole = action({
  permission: 'roles.manage',
  scopes: ['all'],
  schema: z.object({ userId: z.uuid(), role: z.enum(STAFF_ROLES as [string, ...string[]]), grant: z.boolean() }),
  message: (granted: boolean) => (granted ? 'Role granted. It applies on the user’s next page load.' : 'Role removed.'),
  async run({ input, supabase, viewer }) {
    if (!input.grant && input.userId === viewer.userId && (input.role === 'admin' || input.role === 'principal')) {
      throw new ActionError('You cannot remove your own Admin or Principal role.');
    }
    if (input.grant) {
      must(await supabase.from('user_roles').upsert({ user_id: input.userId, role: input.role, granted_by: viewer.userId }, { onConflict: 'user_id,role', ignoreDuplicates: true }));
    } else {
      must(await supabase.from('user_roles').delete().eq('user_id', input.userId).eq('role', input.role));
    }
    return input.grant;
  },
});

export const saveAppConfig = action({
  permission: 'settings.manage',
  scopes: ['all'],
  schema: z.object({
    min_mobile_version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Use a version like 1.2.0'),
    maintenance_banner: z.string().trim().max(200),
    biometric: z.boolean(),
    roster_photos: z.boolean(),
  }),
  message: 'App settings saved.',
  async run({ input, supabase }) {
    const { data: features } = await supabase.from('app_config').select('value').eq('key', 'features').maybeSingle();
    const rows = [
      { key: 'min_mobile_version', value: input.min_mobile_version, is_public: true },
      { key: 'maintenance_banner', value: input.maintenance_banner || null, is_public: true },
      { key: 'features', value: { ...(features?.value ?? {}), biometric: input.biometric, roster_photos: input.roster_photos }, is_public: true },
    ];
    must(await supabase.from('app_config').upsert(rows, { onConflict: 'key' }));
  },
});
