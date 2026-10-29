import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { rangeContains } from '@/lib/ranges';
import { monthDays } from '@/shared/dates';

export interface BoardRow {
  divisionId: string;
  divisionName: string;
  streamCode: string;
  classTeacher: string | null;
  register: { id: string; state: string; version: number; submitted_at: string | null; source: string } | null;
  present: number;
  absent: number;
  onLeave: number;
  marked: number;
  sessions: { total: number; submitted: number; cancelled: number };
}

const PRESENTISH = new Set(['P', 'HD', 'OD', 'SP', 'LT']);

/** Roll-call and period-register progress per division for a date (RLS-scoped). */
export async function getDayBoard(yearId: string, date: string): Promise<BoardRow[]> {
  const supabase = await createClient();
  const [{ data: divisions }, { data: registers }, { data: sessions }] = await Promise.all([
    supabase
      .from('divisions')
      .select('id, name, stream:streams(code), class_teacher_assignments(valid_during, staff(full_name))')
      .eq('academic_year_id', yearId)
      .is('archived_at', null)
      .order('name'),
    supabase
      .from('day_registers')
      .select('id, division_id, state, version, submitted_at, source, day_attendance(status_code)')
      .eq('att_date', date),
    supabase
      .from('class_sessions')
      .select('division_id, status, attendance_registers(state)')
      .eq('session_date', date),
  ]);
  const regBy = new Map(
    asRows<{ id: string; division_id: string; state: string; version: number; submitted_at: string | null; source: string; day_attendance: { status_code: string }[] }>(registers).map((r) => [r.division_id, r]),
  );
  const sessBy = new Map<string, BoardRow['sessions']>();
  for (const s of asRows<{ division_id: string | null; status: string; attendance_registers: { state: string }[] | { state: string } | null }>(sessions)) {
    if (!s.division_id) continue;
    const agg = sessBy.get(s.division_id) ?? { total: 0, submitted: 0, cancelled: 0 };
    const reg = Array.isArray(s.attendance_registers) ? s.attendance_registers[0] : s.attendance_registers;
    if (s.status === 'cancelled' || s.status === 'rescheduled') agg.cancelled++;
    else {
      agg.total++;
      if (reg && (reg.state === 'submitted' || reg.state === 'locked')) agg.submitted++;
    }
    sessBy.set(s.division_id, agg);
  }

  return asRows<{ id: string; name: string; stream: { code: string }; class_teacher_assignments: { valid_during: string; staff: { full_name: string } }[] }>(divisions).map((d) => {
    const reg = regBy.get(d.id) ?? null;
    const marks = reg?.day_attendance ?? [];
    return {
      divisionId: d.id,
      divisionName: d.name,
      streamCode: d.stream.code,
      classTeacher: d.class_teacher_assignments.find((a) => rangeContains(a.valid_during, date))?.staff.full_name ?? null,
      register: reg ? { id: reg.id, state: reg.state, version: reg.version, submitted_at: reg.submitted_at, source: reg.source } : null,
      present: marks.filter((m) => PRESENTISH.has(m.status_code)).length,
      absent: marks.filter((m) => m.status_code === 'A').length,
      onLeave: marks.filter((m) => m.status_code === 'L' || m.status_code === 'ML').length,
      marked: marks.length,
      sessions: sessBy.get(d.id) ?? { total: 0, submitted: 0, cancelled: 0 },
    };
  });
}

export interface RosterStudent {
  student_id: string; roll_no: string | null; name: string; name_mr: string | null; batch_id: string | null;
  suggested_status: string | null; is_new: boolean; current_status: string | null;
}
export interface DayRoster {
  division_id: string; date: string; working_day: boolean;
  /** block: null when editable now, else what a submit would return (locked, month_closed, not_working_day). */
  register: { id: string; state: string; version: number; submitted_at: string | null; month_closed: boolean; block: string | null } | null;
  students: RosterStudent[];
}

export async function getDayRoster(divisionId: string, date: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('division_roster_for_marking', { p_division_id: divisionId, p_date: date });
  if (error) throw new Error(error.message);
  return data as DayRoster;
}

export async function getRegisterHistory(registerId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('attendance_record_history')
    .select('id, student_id, old_status, new_status, source, reason, changed_at, changed_by')
    .eq('kind', 'day')
    .eq('register_id', registerId)
    .order('changed_at', { ascending: false })
    .limit(100);
  return asRows<{ id: number; student_id: string; old_status: string | null; new_status: string; source: string; reason: string | null; changed_at: string; changed_by: string | null }>(data);
}

export interface CorrectionRow {
  id: string; kind: 'day' | 'period'; register_id: string; division_id: string | null; att_date: string; reason: string; status: string;
  requested_at: string; decided_at: string | null; decision_note: string | null;
  records: { student_id: string; from: string | null; to: string }[];
  division: { name: string } | null;
  requester: { display_name: string } | null;
}

export async function listCorrections(status: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('attendance_correction_requests')
    .select('id, kind, register_id, division_id, att_date, reason, status, requested_at, decided_at, decision_note, records, division:divisions(name), requester:profiles!attendance_correction_requests_requested_by_fkey(display_name)')
    .eq('status', status)
    .order('requested_at', { ascending: status !== 'pending' })
    .limit(200);
  const rows = asRows<CorrectionRow>(data);
  const ids = [...new Set(rows.flatMap((r) => r.records.map((x) => x.student_id)))];
  const { data: students } = ids.length ? await supabase.from('students').select('id, full_name').in('id', ids) : { data: [] };
  const names = new Map(asRows<{ id: string; full_name: string }>(students).map((s) => [s.id, s.full_name]));
  return { rows, names };
}

// ---------------------------------------------------------------- monthly muster (हजेरी पत्रक)
export interface MusterData {
  division: { id: string; name: string; standard: string; stream: string };
  month: string;
  days: { date: string; working: boolean }[];
  students: { id: string; roll_no: string | null; name: string; name_mr: string | null; marks: Record<string, string>; present: number; working: number; toDatePresent: number; toDateWorking: number }[];
  monthRow: { state: string; closed_at: string | null; class_teacher_signed_at: string | null; principal_signed_at: string | null; revised: boolean } | null;
}

export async function getMuster(divisionId: string, month: string, yearId: string): Promise<MusterData | null> {
  const supabase = await createClient();
  const days = monthDays(month);
  const first = days[0];
  const last = days[days.length - 1];
  const [{ data: division }, { data: regs }, { data: enr }, { data: monthRow }, { data: codes }] = await Promise.all([
    supabase.from('divisions').select('id, name, standard:standards(code), stream:streams(name)').eq('id', divisionId).maybeSingle(),
    supabase.from('day_registers').select('id, att_date, state, day_attendance(student_id, status_code)').eq('division_id', divisionId).gte('att_date', first).lte('att_date', last),
    supabase.from('student_enrollments').select('roll_no, valid_during, student:students(id, full_name, name_mr)').eq('division_id', divisionId),
    supabase.from('attendance_months').select('state, closed_at, class_teacher_signed_at, principal_signed_at, revised').eq('division_id', divisionId).eq('month', first).maybeSingle(),
    supabase.from('attendance_status_codes').select('code, day_value, counts_in_held'),
  ]);
  if (!division) return null;
  const value = new Map(asRows<{ code: string; day_value: number; counts_in_held: boolean }>(codes).map((c) => [c.code, c]));
  const counted = asRows<{ id: string; att_date: string; state: string; day_attendance: { student_id: string; status_code: string }[] }>(regs)
    .filter((r) => r.state === 'submitted' || r.state === 'locked' || r.state === 'reopened');
  const workingDates = new Set(counted.map((r) => r.att_date));

  // Year-to-date totals come from the term summaries.
  const { data: terms } = await supabase.from('academic_terms').select('id').eq('academic_year_id', yearId);
  const termIds = asRows<{ id: string }>(terms).map((t) => t.id);

  const roster = asRows<{ roll_no: string | null; valid_during: string; student: { id: string; full_name: string; name_mr: string | null } }>(enr)
    .filter((e) => days.some((d) => rangeContains(e.valid_during, d)));
  const studentIds = roster.map((r) => r.student.id);
  const { data: sums } = studentIds.length && termIds.length
    ? await supabase.from('day_attendance_summaries').select('student_id, working_days, present_value').in('student_id', studentIds).in('term_id', termIds)
    : { data: [] };
  const toDate = new Map<string, { w: number; p: number }>();
  for (const s of asRows<{ student_id: string; working_days: number; present_value: number }>(sums)) {
    const t = toDate.get(s.student_id) ?? { w: 0, p: 0 };
    toDate.set(s.student_id, { w: t.w + s.working_days, p: t.p + Number(s.present_value) });
  }

  const students = roster
    .map((r) => {
      const marks: Record<string, string> = {};
      let present = 0;
      let working = 0;
      for (const reg of counted) {
        const m = reg.day_attendance.find((a) => a.student_id === r.student.id);
        if (!m) continue;
        marks[reg.att_date] = m.status_code;
        const c = value.get(m.status_code);
        if (c?.counts_in_held) {
          working++;
          present += Number(c.day_value);
        }
      }
      const td = toDate.get(r.student.id) ?? { w: 0, p: 0 };
      return { id: r.student.id, roll_no: r.roll_no, name: r.student.full_name, name_mr: r.student.name_mr, marks, present, working, toDatePresent: td.p, toDateWorking: td.w };
    })
    .sort((a, b) => (Number(a.roll_no) || 9999) - (Number(b.roll_no) || 9999) || a.name.localeCompare(b.name));

  const d = division as unknown as { id: string; name: string; standard: { code: string }; stream: { name: string } };
  return {
    division: { id: d.id, name: d.name, standard: d.standard.code, stream: d.stream.name },
    month: first,
    days: days.map((date) => ({ date, working: workingDates.has(date) })),
    students,
    monthRow: (monthRow as MusterData['monthRow']) ?? null,
  };
}
