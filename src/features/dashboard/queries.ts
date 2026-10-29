import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { todayIST } from '@/shared/dates';
import { rangeContains } from '@/lib/ranges';

const count = (res: { count: number | null }) => res.count ?? 0;

/** Today's roll-call progress across the divisions the viewer can see (RLS-scoped). */
export async function getTodayRollCall(yearId: string) {
  const supabase = await createClient();
  const today = todayIST();
  const [{ data: divisions }, { data: registers }] = await Promise.all([
    supabase.from('divisions').select('id').eq('academic_year_id', yearId).is('archived_at', null),
    supabase
      .from('day_registers')
      .select('id, state, division_id, day_attendance(status_code)')
      .eq('att_date', today),
  ]);
  const regs = (registers ?? []) as Array<{ state: string; day_attendance: { status_code: string }[] }>;
  const submitted = regs.filter((r) => r.state === 'submitted' || r.state === 'locked');
  const marks = submitted.flatMap((r) => r.day_attendance);
  const present = marks.filter((m) => ['P', 'HD', 'OD', 'SP'].includes(m.status_code)).length;
  const absent = marks.filter((m) => m.status_code === 'A').length;
  return {
    divisions: divisions?.length ?? 0,
    submitted: submitted.length,
    pending: regs.filter((r) => r.state === 'pending' || r.state === 'reopened').length,
    present,
    absent,
    marked: marks.length,
  };
}

export async function getEligibilityCounts(yearId: string) {
  const supabase = await createClient();
  const { data: latest } = await supabase
    .from('eligibility_snapshots')
    .select('as_of')
    .eq('academic_year_id', yearId)
    .order('as_of', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return null;
  const { data } = await supabase
    .from('eligibility_snapshots')
    .select('status, kind')
    .eq('academic_year_id', yearId)
    .eq('as_of', latest.as_of);
  const byStatus: Record<string, number> = {};
  for (const r of data ?? []) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return { asOf: latest.as_of as string, byStatus };
}

export async function getQueues() {
  const supabase = await createClient();
  const [corrections, leave, notices] = await Promise.all([
    supabase.from('attendance_correction_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('leave_requests').select('id', { count: 'exact', head: true }).in('status', ['pending', 'needs_info']),
    supabase.from('defaulter_notices').select('id', { count: 'exact', head: true }).is('acknowledged_at', null).neq('channel', 'print'),
  ]);
  return { corrections: count(corrections), leave: count(leave), unacknowledgedNotices: count(notices) };
}

/** Office readiness: government IDs and guardian logins (web doc §12.5, §12.12). */
export async function getReadiness() {
  const supabase = await createClient();
  const base = () => supabase.from('students').select('id', { count: 'exact', head: true }).eq('status', 'active');
  const [total, apaar, pen, saral, noLogin] = await Promise.all([
    base(),
    base().is('apaar_id', null),
    base().is('pen', null),
    base().is('saral_id', null),
    supabase.from('guardians').select('id, guardian_links!inner(status)', { count: 'exact', head: true }).is('user_id', null).eq('guardian_links.status', 'verified'),
  ]);
  return { total: count(total), missingApaar: count(apaar), missingPen: count(pen), missingSaral: count(saral), guardianLoginsPending: count(noLogin) };
}

/** Admin setup health (web doc §12.14). */
export async function getSetupHealth(yearId: string) {
  const supabase = await createClient();
  const today = todayIST();
  const [{ data: divisions }, { data: cts }, { count: published }, { count: policies }] = await Promise.all([
    supabase.from('divisions').select('id, name').eq('academic_year_id', yearId).is('archived_at', null),
    supabase.from('class_teacher_assignments').select('division_id, valid_during'),
    supabase.from('timetable_versions').select('id', { count: 'exact', head: true }).eq('academic_year_id', yearId).eq('status', 'published'),
    supabase.from('attendance_policies').select('id', { count: 'exact', head: true }),
  ]);
  const covered = new Set(
    (cts ?? [])
      .filter((c: { valid_during: string }) => rangeContains(c.valid_during, today))
      .map((c: { division_id: string }) => c.division_id),
  );
  return {
    divisionsWithoutClassTeacher: (divisions ?? []).filter((d) => !covered.has(d.id)).map((d) => d.name as string),
    publishedTimetables: published ?? 0,
    policies: policies ?? 0,
  };
}
