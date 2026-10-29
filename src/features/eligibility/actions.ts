'use server';

import { z } from 'zod';
import { action, ActionError, must } from '@/lib/auth/action';
import { condonationSchema, issueNoticeSchema } from '@/shared/schemas';

export const runEvaluation = action({
  permission: 'eligibility.manage',
  scopes: ['all'],
  schema: z.object({ kind: z.enum(['projected', 'final']), asOf: z.iso.date().optional() }),
  message: (n: number) => `Eligibility evaluated for ${n} students.`,
  async run({ input, supabase }) {
    return must(await supabase.rpc('evaluate_eligibility', { p_as_of: input.asOf ?? null, p_kind: input.kind })) as number;
  },
});

export const issueNotice = action({
  permission: 'notices.defaulter.issue',
  schema: issueNoticeSchema,
  message: 'Notice issued. Guardians see it in the app and are asked to acknowledge it.',
  async run({ input, supabase }) {
    return must(
      await supabase.rpc('issue_defaulter_notice', {
        p_student_id: input.studentId, p_level: input.level, p_language: input.language, p_channel: input.channel,
      }),
    ) as string;
  },
});

export const createCondonationCase = action({
  permission: ['eligibility.manage', 'condonation.recommend'],
  scopes: ['all'],
  schema: condonationSchema.extend({ academic_year_id: z.uuid() }),
  message: 'Condonation case opened.',
  async run({ input, supabase, viewer }) {
    const { data: snap } = await supabase
      .from('eligibility_snapshots')
      .select('annual_percent')
      .eq('student_id', input.student_id)
      .eq('academic_year_id', input.academic_year_id)
      .order('as_of', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: pol } = await supabase.from('attendance_policies').select('min_percent').eq('scope_kind', 'college').order('effective_from', { ascending: false }).limit(1).maybeSingle();
    const shortfall = snap?.annual_percent != null && pol ? Math.max(0, Number(pol.min_percent) - Number(snap.annual_percent)) : null;
    must(await supabase.from('condonation_cases').insert({ ...input, shortfall_percent: shortfall, created_by: viewer.userId }));
  },
});

export const updateCondonation = action({
  permission: ['eligibility.manage', 'condonation.recommend'],
  scopes: ['all'],
  schema: z.discriminatedUnion('step', [
    z.object({ step: z.literal('recommend'), id: z.uuid(), recommendation: z.string().trim().min(3) }),
    z.object({ step: z.literal('submitted'), id: z.uuid(), on: z.iso.date() }),
    z.object({ step: z.literal('decision'), id: z.uuid(), outcome: z.enum(['condoned', 'rejected']), on: z.iso.date(), note: z.string().trim().max(500).optional() }),
    z.object({ step: z.literal('withdraw'), id: z.uuid() }),
  ]),
  message: 'Case updated. Re-run eligibility to refresh the student’s status.',
  async run({ input, supabase, viewer }) {
    let patch: Record<string, unknown>;
    switch (input.step) {
      case 'recommend':
        if (!viewer.roles.includes('principal')) throw new ActionError('Only the Principal recommends condonation to the divisional board.');
        patch = { status: 'recommended', principal_recommendation: input.recommendation, recommended_by: viewer.userId, recommended_at: new Date().toISOString() };
        break;
      case 'submitted':
        patch = { status: 'submitted_to_board', submitted_to_board_on: input.on };
        break;
      case 'decision':
        patch = { status: input.outcome, board_decision: input.note ?? input.outcome, board_decision_on: input.on };
        break;
      default:
        patch = { status: 'withdrawn' };
    }
    must(await supabase.from('condonation_cases').update(patch).eq('id', input.id));
  },
});
