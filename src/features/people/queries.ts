import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { rangeContains } from '@/lib/ranges';
import { todayIST } from '@/shared/dates';

export const PAGE_SIZE = 50;

/** Strip characters that have meaning in PostgREST filter syntax. */
export const sanitizeSearch = (q: string) => q.replace(/[,()"\\%*]/g, ' ').trim().slice(0, 60);

export interface StudentListRow {
  id: string; gr_no: string; full_name: string; name_mr: string | null; status: string;
  apaar_id: string | null; saral_id: string | null; pen: string | null; admission_type: string; admitted_on: string;
  student_enrollments: { roll_no: string | null; valid_during: string; is_primary: boolean; division: { id: string; name: string } }[];
}

export async function listStudents(opts: { yearId: string; q?: string; divisionId?: string; status?: string; page: number }) {
  const supabase = await createClient();
  let query = supabase
    .from('students')
    .select(
      `id, gr_no, full_name, name_mr, status, apaar_id, saral_id, pen, admission_type, admitted_on,
       student_enrollments!inner(roll_no, valid_during, is_primary, academic_year_id, division_id, division:divisions(id, name))`,
      { count: 'exact' },
    )
    .eq('student_enrollments.academic_year_id', opts.yearId)
    .order('full_name')
    .range((opts.page - 1) * PAGE_SIZE, opts.page * PAGE_SIZE - 1);

  if (opts.divisionId) query = query.eq('student_enrollments.division_id', opts.divisionId);
  if (opts.status) query = query.eq('status', opts.status);
  const q = opts.q ? sanitizeSearch(opts.q) : '';
  if (q) {
    query = query.or(
      [`full_name.ilike.*${q}*`, `name_mr.ilike.*${q}*`, `gr_no.eq.${q}`, `apaar_id.eq.${q}`, `saral_id.eq.${q}`, `cap_application_no.eq.${q}`, `pen.eq.${q}`].join(','),
    );
  }
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  return { rows: asRows<StudentListRow>(data), total: count ?? 0 };
}

/** The enrollment that is current today, else the latest one. */
export function currentEnrollment<T extends { valid_during: string; is_primary?: boolean }>(rows: T[]): T | null {
  const today = todayIST();
  return rows.find((r) => rangeContains(r.valid_during, today)) ?? [...rows].sort((a, b) => b.valid_during.localeCompare(a.valid_during))[0] ?? null;
}

export async function getStudent360(id: string) {
  const supabase = await createClient();
  const [student, enrollments, guardians, consents, daySummaries, subjectSummaries, eligibility, notices, leave, history] = await Promise.all([
    supabase.from('students').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('student_enrollments')
      .select('id, roll_no, valid_during, enrollment_type, reason, batch_id, division:divisions(id, name), batch:batches(code, name), academic_year:academic_years(label)')
      .eq('student_id', id)
      .order('valid_during', { ascending: false }),
    supabase
      .from('guardian_links')
      .select('id, status, is_primary, verified_at, guardian:guardians(id, full_name, relation, email, phone, preferred_language, user_id)')
      .eq('student_id', id),
    supabase.from('consents').select('id, purpose, method, granted_at, withdrawn_at').eq('student_id', id).order('granted_at', { ascending: false }),
    supabase.from('day_attendance_summaries').select('term_id, working_days, present_value, absent_days, percent, term:academic_terms(name, seq, academic_year_id)').eq('student_id', id),
    supabase
      .from('attendance_summaries')
      .select('offering_id, component, held, attended, percent, offering:subject_offerings(subject:subjects(name))')
      .eq('student_id', id),
    supabase.from('eligibility_snapshots').select('as_of, kind, annual_percent, working_days, remaining_days, days_needed, status').eq('student_id', id).order('as_of', { ascending: false }).limit(5),
    supabase.from('defaulter_notices').select('id, level, issued_at, day_percent, acknowledged_at, channel').eq('student_id', id).order('issued_at', { ascending: false }),
    supabase.from('leave_requests').select('id, leave_type, from_date, to_date, status, reason, applied_by_kind').eq('student_id', id).order('from_date', { ascending: false }).limit(10),
    supabase.from('day_attendance').select('id, att_date, status_code, source').eq('student_id', id).order('att_date', { ascending: false }).limit(60),
  ]);
  if (!student.data) return null;
  return {
    student: student.data as Record<string, string | null> & { id: string; full_name: string; gr_no: string; status: string; user_id: string | null },
    enrollments: asRows<{ id: string; roll_no: string | null; valid_during: string; enrollment_type: string; reason: string | null; batch_id: string | null; division: { id: string; name: string }; batch: { code: string; name: string } | null; academic_year: { label: string } }>(enrollments.data),
    guardians: asRows<{ id: string; status: string; is_primary: boolean; verified_at: string | null; guardian: { id: string; full_name: string; relation: string; email: string | null; phone: string | null; preferred_language: string; user_id: string | null } }>(guardians.data),
    consents: asRows<{ id: string; purpose: string; method: string; granted_at: string; withdrawn_at: string | null }>(consents.data),
    daySummaries: asRows<{ term_id: string; working_days: number; present_value: number; absent_days: number; percent: number | null; term: { name: string; seq: number; academic_year_id: string } }>(daySummaries.data),
    subjectSummaries: asRows<{ offering_id: string; component: string; held: number; attended: number; percent: number | null; offering: { subject: { name: string } } }>(subjectSummaries.data),
    eligibility: asRows<{ as_of: string; kind: string; annual_percent: number | null; working_days: number; remaining_days: number; days_needed: number | null; status: string }>(eligibility.data),
    notices: asRows<{ id: string; level: string; issued_at: string; day_percent: number | null; acknowledged_at: string | null; channel: string }>(notices.data),
    leave: asRows<{ id: string; leave_type: string; from_date: string; to_date: string; status: string; reason: string; applied_by_kind: string }>(leave.data),
    history: asRows<{ id: string; att_date: string; status_code: string; source: string }>(history.data),
  };
}

export async function getStatusCodes() {
  const supabase = await createClient();
  const { data } = await supabase.from('attendance_status_codes').select('code, label, label_mr, color, scope, teacher_can_set, sort_order').order('sort_order');
  return asRows<{ code: string; label: string; label_mr: string; color: string; scope: string; teacher_can_set: boolean }>(data);
}

export async function getStaffOptions() {
  const supabase = await createClient();
  const { data } = await supabase.from('staff').select('id, full_name, employee_id').eq('status', 'active').order('full_name');
  return asRows<{ id: string; full_name: string; employee_id: string }>(data);
}
