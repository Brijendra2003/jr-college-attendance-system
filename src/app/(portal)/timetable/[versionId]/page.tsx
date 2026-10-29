import { notFound } from 'next/navigation';
import { can, requirePermission } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { rangeContains } from '@/lib/ranges';
import { getStaffOptions } from '@/features/people/queries';
import { addSlot, deleteSlot, publishTimetable } from '@/features/timetable/actions';
import { ActionButton } from '@/components/action-button';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, CardBody, CardHeader, Field, Input, Notice, PageHeader, Select, StateBadge } from '@/components/ui/primitives';
import { formatDate, todayIST } from '@/shared/dates';

export const metadata = { title: 'Timetable editor' };

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Slot {
  id: string; weekday: number; period_no: number; starts_at: string; ends_at: string; session_type: string; staff_id: string | null;
  group: { id: string; name: string; kind: string; division_id: string | null; batch: { division_id: string } | null; teaching_assignments: { staff_id: string; valid_during: string }[] };
}

export default async function TimetableEditor({ params }: PageProps<'/timetable/[versionId]'>) {
  const viewer = await requirePermission('timetable.edit');
  const { versionId } = await params;
  const supabase = await createClient();
  const { data: version } = await supabase
    .from('timetable_versions')
    .select('id, name, status, effective_from, academic_year_id, standard_id, stream_id, term:academic_terms(name, ends_on), standard:standards(code), stream:streams(name)')
    .eq('id', versionId)
    .maybeSingle();
  if (!version) notFound();
  const v = version as unknown as { id: string; name: string; status: string; effective_from: string; academic_year_id: string; standard_id: string; stream_id: string; term: { name: string; ends_on: string }; standard: { code: string }; stream: { name: string } };
  const today = todayIST();

  const [{ data: slotData }, { data: groupData }, staff] = await Promise.all([
    supabase.from('timetable_slots')
      .select('id, weekday, period_no, starts_at, ends_at, session_type, staff_id, group:teaching_groups(id, name, kind, division_id, batch:batches(division_id), teaching_assignments(staff_id, valid_during))')
      .eq('version_id', versionId).order('weekday').order('period_no'),
    supabase.from('teaching_groups')
      .select('id, name, offering:subject_offerings!inner(academic_year_id, standard_id, stream_id)')
      .eq('offering.academic_year_id', v.academic_year_id).eq('offering.standard_id', v.standard_id).eq('offering.stream_id', v.stream_id).order('name'),
    getStaffOptions(),
  ]);
  const slots = asRows<Slot>(slotData);
  const staffName = new Map(staff.map((s) => [s.id, s.full_name]));
  const teacherOf = (s: Slot) => s.staff_id ?? s.group.teaching_assignments.find((a) => rangeContains(a.valid_during, today))?.staff_id ?? null;
  const divisionOf = (s: Slot) => s.group.division_id ?? s.group.batch?.division_id ?? null;

  // Clash check: same teacher twice, or a whole-division class overlapping anything else for that division.
  const clashes: string[] = [];
  const byTime = new Map<string, Slot[]>();
  for (const s of slots) byTime.set(`${s.weekday}-${s.period_no}`, [...(byTime.get(`${s.weekday}-${s.period_no}`) ?? []), s]);
  for (const [key, list] of byTime) {
    const [d, p] = key.split('-').map(Number);
    const teachers = list.map(teacherOf).filter(Boolean);
    for (const t of new Set(teachers)) if (teachers.filter((x) => x === t).length > 1) clashes.push(`${DAYS[d - 1]} P${p}: ${staffName.get(t!) ?? 'a teacher'} is double-booked`);
    for (const s of list.filter((x) => x.group.kind === 'division')) {
      if (list.some((o) => o !== s && divisionOf(o) === divisionOf(s))) clashes.push(`${DAYS[d - 1]} P${p}: ${s.group.name} overlaps another class of the same division`);
    }
    for (const s of list) if (!teacherOf(s)) clashes.push(`${DAYS[d - 1]} P${p}: ${s.group.name} has no teacher`);
  }
  const periods = [...new Set(slots.map((s) => s.period_no))].sort((a, b) => a - b);
  const editable = v.status !== 'archived';

  return (
    <>
      <PageHeader
        title={v.name}
        description={<span>{v.standard.code} · {v.stream.name} · {v.term.name} · from {formatDate(v.effective_from)} <StateBadge state={v.status} /></span>}
        actions={can(viewer, 'timetable.publish', 'all') && editable ? (
          <ActionButton action={publishTimetable} payload={{ versionId }} label={v.status === 'published' ? 'Republish' : 'Publish'} variant="primary" size="md"
            confirm={`Generate sessions from ${formatDate(v.effective_from > today ? v.effective_from : today)} to ${formatDate(v.term.ends_on)}? Future sessions without attendance are replaced; marked ones are kept.`} />
        ) : null}
      />
      {clashes.length ? <Notice tone="warn"><strong>Check before publishing:</strong><ul className="mt-1 list-disc pl-5">{[...new Set(clashes)].map((c) => <li key={c}>{c}</li>)}</ul></Notice> : null}

      <Card className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs uppercase text-gray-500">
              <th className="w-16 border-b border-gray-200 p-2">Period</th>
              {DAYS.map((d) => <th key={d} className="border-b border-gray-200 p-2 text-left">{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p} className="align-top">
                <td className="border-b border-gray-100 p-2 text-center font-medium">P{p}</td>
                {DAYS.map((_, i) => (
                  <td key={i} className="border-b border-l border-gray-100 p-1.5">
                    {slots.filter((s) => s.weekday === i + 1 && s.period_no === p).map((s) => (
                      <div key={s.id} className="mb-1 rounded-md border border-gray-200 bg-white p-1.5">
                        <div className="font-medium">{s.group.name}</div>
                        <div className="text-xs text-gray-500">{s.starts_at.slice(0, 5)}–{s.ends_at.slice(0, 5)} · {staffName.get(teacherOf(s) ?? '') ?? <Badge tone="amber">no teacher</Badge>}</div>
                        {editable ? <ActionButton action={deleteSlot} payload={{ id: s.id }} label="Remove" variant="ghost" /> : null}
                      </div>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
            {periods.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-gray-500">No slots yet. Add them below.</td></tr> : null}
          </tbody>
        </table>
      </Card>

      {editable ? (
        <Card className="mt-6">
          <CardHeader title="Add a slot" description="Practical batches and language groups can share a period in parallel lanes." />
          <CardBody>
            <ActionForm action={addSlot} extra={{ version_id: versionId }} submitLabel="Add slot">
              <div className="grid gap-4 sm:grid-cols-4 lg:grid-cols-8">
                <Field label="Day"><Select name="weekday">{DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</Select></Field>
                <Field label="Period"><Input type="number" name="period_no" min={1} max={12} defaultValue={1} /></Field>
                <Field label="Starts"><Input type="time" name="starts_at" defaultValue="07:30" /></Field>
                <Field label="Ends"><Input type="time" name="ends_at" defaultValue="08:15" /></Field>
                <Field label="Group" className="lg:col-span-2">
                  <Select name="teaching_group_id">{asRows<{ id: string; name: string }>(groupData).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>
                </Field>
                <Field label="Type"><Select name="session_type"><option value="theory">Theory</option><option value="practical">Practical</option><option value="oral">Oral</option><option value="pe">PE</option></Select></Field>
                <Field label="Teacher override"><Select name="staff_id" defaultValue=""><option value="">Assigned teacher</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select></Field>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
