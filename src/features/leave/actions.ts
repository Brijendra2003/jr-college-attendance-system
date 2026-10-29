'use server';

import { z } from 'zod';
import { action, must } from '@/lib/auth/action';
import { applyLeaveSchema, decideLeaveSchema } from '@/shared/schemas';

export const decideLeave = action({
  permission: 'leave.student.decide',
  schema: decideLeaveSchema,
  message: (d: { records_changed: number }) => `Decision saved.${d.records_changed ? ` ${d.records_changed} past absence(s) changed to leave.` : ''}`,
  async run({ input, supabase }) {
    return must(await supabase.rpc('decide_leave', { p_id: input.id, p_decision: input.decision, p_note: input.note })) as { records_changed: number };
  },
});

/** Office records leave on a student's behalf (e.g. a letter handed in at the office). */
export const applyLeaveForStudent = action({
  permission: 'students.manage',
  scopes: ['all'],
  schema: applyLeaveSchema.and(z.object({ studentId: z.uuid() })),
  message: 'Leave recorded and sent to the class teacher.',
  async run({ input, supabase }) {
    return must(
      await supabase.rpc('apply_leave', {
        p_leave_type: input.leaveType, p_from: input.from, p_to: input.to, p_reason: input.reason,
        p_student_id: input.studentId, p_span: input.span,
      }),
    ) as string;
  },
});

export const logParentMeeting = action({
  permission: 'notices.defaulter.issue',
  schema: z.object({
    studentId: z.uuid(),
    outcome: z.string().trim().min(3).max(1000),
    mode: z.enum(['in_person', 'phone', 'video']).default('in_person'),
    met_on: z.iso.date(),
    follow_up_on: z.iso.date().or(z.literal('')).transform((v) => v || null),
  }),
  message: 'Meeting logged.',
  async run({ input, supabase }) {
    must(await supabase.rpc('log_parent_meeting', {
      p_student_id: input.studentId, p_outcome: input.outcome, p_met_on: input.met_on, p_mode: input.mode, p_follow_up_on: input.follow_up_on,
    }));
  },
});
