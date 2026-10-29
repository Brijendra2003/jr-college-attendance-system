'use server';

import { action, must } from '@/lib/auth/action';
import {
  closeMonthSchema, correctionRequestSchema, decideCorrectionSchema, reopenRegisterSchema, signMusterSchema, submitDayRegisterSchema,
} from '@/shared/schemas';
import { SUBMIT_RESULT_MESSAGES } from '@/shared/errors';

export interface SubmitResult {
  result: 'ok' | 'duplicate' | 'conflict' | 'locked' | 'month_closed' | 'not_working_day';
  register?: { id: string; version: number; state: string };
  defaulted_students?: string[];
}

/**
 * Web roll-call (class-teacher desk, or Office for a missed register). Same RPC and idempotency
 * contract as the mobile app: the client generates clientSubmissionId once per Submit tap.
 */
export const submitDayRegister = action({
  permission: 'attendance.day.mark',
  schema: submitDayRegisterSchema,
  message: (d: SubmitResult) => SUBMIT_RESULT_MESSAGES[d.result]?.en ?? d.result,
  async run({ input, supabase }) {
    return must(
      await supabase.rpc('submit_day_register', {
        p_division_id: input.divisionId,
        p_date: input.date,
        p_client_submission_id: input.clientSubmissionId,
        p_base_version: input.baseVersion,
        p_records: input.records,
        p_client_marked_at: new Date().toISOString(),
        p_device_id: 'web',
      }),
    ) as SubmitResult;
  },
});

export const reopenRegister = action({
  permission: 'attendance.reopen',
  schema: reopenRegisterSchema,
  message: 'Register reopened for late marking.',
  async run({ input, supabase }) {
    const until = new Date(Date.now() + input.hours * 3600_000).toISOString();
    must(await supabase.rpc('reopen_register', { p_kind: input.kind, p_register_id: input.registerId, p_until: until, p_reason: input.reason }));
  },
});

export const requestCorrection = action({
  permission: ['attendance.day.mark', 'attendance.mark', 'attendance.correct.approve'],
  schema: correctionRequestSchema,
  message: 'Correction requested. An approver has been notified.',
  async run({ input, supabase }) {
    return must(
      await supabase.rpc('request_attendance_correction', {
        p_kind: input.kind, p_register_id: input.registerId, p_records: input.records, p_reason: input.reason,
      }),
    ) as string;
  },
});

export const decideCorrection = action({
  permission: 'attendance.correct.approve',
  schema: decideCorrectionSchema,
  message: (d: { result: string }) => (d.result === 'approved' ? 'Correction applied. The student and guardians were notified.' : 'Correction rejected.'),
  async run({ input, supabase }) {
    return must(await supabase.rpc('decide_correction', { p_request_id: input.requestId, p_approve: input.approve, p_note: input.note })) as { result: string };
  },
});

export const closeMonth = action({
  permission: 'month.close',
  schema: closeMonthSchema,
  message: (d: { result: string; missing_dates?: string[] }) =>
    d.result === 'ok' ? 'Month closed. Changes now need an approved correction.' : d.result === 'already_closed' ? 'Already closed.' : `Cannot close yet: ${d.missing_dates?.length ?? 0} working day(s) have no submitted roll-call.`,
  async run({ input, supabase }) {
    return must(await supabase.rpc('close_attendance_month', { p_division_id: input.divisionId, p_month: input.month })) as { result: string; missing_dates?: string[] };
  },
});

export const signMuster = action({
  permission: 'month.close',
  schema: signMusterSchema,
  message: 'Muster signed.',
  async run({ input, supabase }) {
    must(await supabase.rpc('sign_muster', { p_division_id: input.divisionId, p_month: input.month, p_as: input.as }));
  },
});
