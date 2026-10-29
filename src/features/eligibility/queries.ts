import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';

export interface EligibilityRow {
  student_id: string; division_id: string | null; as_of: string; kind: string; status: string;
  term1_percent: number | null; term2_percent: number | null; annual_percent: number | null;
  working_days: number; present_value: number; remaining_days: number; days_needed: number | null;
  subject_results: { subject: string; component: string; percent: number }[];
  student: { full_name: string; gr_no: string };
  division: { name: string } | null;
}

/** Latest snapshot of the given kind for the year (RLS-scoped to the viewer). */
export async function getEligibility(yearId: string, opts: { kind: 'projected' | 'final'; divisionId?: string; status?: string }) {
  const supabase = await createClient();
  const { data: latest } = await supabase
    .from('eligibility_snapshots')
    .select('as_of')
    .eq('academic_year_id', yearId)
    .eq('kind', opts.kind)
    .order('as_of', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return { asOf: null, rows: [] as EligibilityRow[] };
  let q = supabase
    .from('eligibility_snapshots')
    .select('student_id, division_id, as_of, kind, status, term1_percent, term2_percent, annual_percent, working_days, present_value, remaining_days, days_needed, subject_results, student:students(full_name, gr_no), division:divisions(name)')
    .eq('academic_year_id', yearId)
    .eq('kind', opts.kind)
    .eq('as_of', latest.as_of)
    .order('annual_percent', { ascending: true, nullsFirst: false });
  if (opts.divisionId) q = q.eq('division_id', opts.divisionId);
  if (opts.status) q = q.eq('status', opts.status);
  const { data } = await q.limit(2000);
  return { asOf: latest.as_of as string, rows: asRows<EligibilityRow>(data) };
}

export async function getCollegePolicy() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('attendance_policies')
    .select('*')
    .eq('scope_kind', 'college')
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as null | {
    id: string; min_percent: number; warn_percent: number; eligibility_basis: string; term_rule: string; day_source: string;
    count_from: string; default_unmarked_status: string; edit_window_hours: number; lock_after_hours: number;
    month_close_working_day: number; leave_requires_guardian_ack: boolean; leave_applies_retroactively: boolean; effective_from: string;
  };
}

export interface NoticeRow {
  id: string; level: string; period_from: string; period_to: string; day_percent: number | null; language: string; channel: string;
  issued_at: string; acknowledged_at: string | null; subject_percents: { subject: string; component: string; percent: number }[];
  student: { id: string; full_name: string; name_mr: string | null; gr_no: string };
  division: { name: string };
}

export async function listNotices(opts: { ack?: string; divisionId?: string }) {
  const supabase = await createClient();
  let q = supabase
    .from('defaulter_notices')
    .select('id, level, period_from, period_to, day_percent, language, channel, issued_at, acknowledged_at, subject_percents, student:students(id, full_name, name_mr, gr_no), division:divisions(name)')
    .order('issued_at', { ascending: false })
    .limit(300);
  if (opts.ack === 'pending') q = q.is('acknowledged_at', null);
  if (opts.ack === 'done') q = q.not('acknowledged_at', 'is', null);
  if (opts.divisionId) q = q.eq('division_id', opts.divisionId);
  const { data } = await q;
  return asRows<NoticeRow>(data);
}

export async function getNotice(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('defaulter_notices')
    .select('id, level, period_from, period_to, day_percent, language, channel, issued_at, acknowledged_at, subject_percents, student:students(id, full_name, name_mr, gr_no), division:divisions(name)')
    .eq('id', id)
    .maybeSingle();
  return data as unknown as NoticeRow | null;
}
