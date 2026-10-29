'use server';

import { z } from 'zod';
import { action, ActionError, must } from '@/lib/auth/action';
import { teachingGroupSchema, timetableSlotSchema, timetableVersionSchema } from '@/shared/schemas';

export const createTeachingGroup = action({
  permission: ['timetable.edit', 'structure.manage'],
  schema: teachingGroupSchema,
  message: 'Teaching group created.',
  async run({ input, supabase }) {
    return must(await supabase.rpc('create_teaching_group', {
      p_subject_id: input.subject_id, p_division_id: input.division_id, p_component: input.component,
      p_batch_id: input.batch_id, p_staff_id: input.staff_id,
    })) as string;
  },
});

export const createVersion = action({
  permission: 'timetable.edit',
  schema: timetableVersionSchema,
  message: 'Draft timetable created.',
  async run({ input, supabase }) {
    const { data: term } = await supabase.from('academic_terms').select('academic_year_id').eq('id', input.term_id).single();
    if (!term) throw new ActionError('Unknown term.');
    return (must(await supabase.from('timetable_versions').insert({ ...input, academic_year_id: term.academic_year_id }).select('id').single()) as { id: string }).id;
  },
});

export const addSlot = action({
  permission: 'timetable.edit',
  schema: timetableSlotSchema,
  message: 'Slot added.',
  async run({ input, supabase }) {
    if (input.ends_at <= input.starts_at) throw new ActionError('The period must end after it starts.');
    const { data: v } = await supabase.from('timetable_versions').select('status').eq('id', input.version_id).single();
    if (v?.status !== 'draft' && v?.status !== 'published') throw new ActionError('Archived timetables cannot be edited.');
    must(await supabase.from('timetable_slots').insert(input));
  },
});

export const deleteSlot = action({
  permission: 'timetable.edit',
  schema: z.object({ id: z.uuid() }),
  message: 'Slot removed. Republish to update future sessions.',
  async run({ input, supabase }) {
    must(await supabase.from('timetable_slots').delete().eq('id', input.id));
  },
});

export const publishTimetable = action({
  permission: 'timetable.publish',
  scopes: ['all'],
  schema: z.object({ versionId: z.uuid() }),
  message: (d: { sessions_created: number; sessions_replaced: number }) =>
    `Published. ${d.sessions_created} sessions generated for the rest of the term (${d.sessions_replaced} unmarked future sessions replaced).`,
  async run({ input, supabase }) {
    return must(await supabase.rpc('publish_timetable', { p_version_id: input.versionId })) as { sessions_created: number; sessions_replaced: number };
  },
});

export const cancelSession = action({
  permission: 'sessions.manage',
  schema: z.object({ sessionId: z.uuid(), reason: z.string().trim().min(3) }),
  message: 'Session cancelled.',
  async run({ input, supabase }) {
    must(await supabase.rpc('cancel_session', { p_session_id: input.sessionId, p_reason: input.reason }));
  },
});

export const assignSubstitute = action({
  permission: 'sessions.manage',
  schema: z.object({ sessionId: z.uuid(), staffId: z.uuid() }),
  message: 'Substitute assigned and notified.',
  async run({ input, supabase }) {
    must(await supabase.rpc('assign_substitute', { p_session_id: input.sessionId, p_staff_id: input.staffId }));
  },
});
