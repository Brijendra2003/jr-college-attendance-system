import Link from 'next/link';
import { can, requirePermission } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { rangeContains } from '@/lib/ranges';
import { getDivisions, getYearContext } from '@/features/academics/context';
import { getStaffOptions } from '@/features/people/queries';
import { createTeachingGroup, createVersion } from '@/features/timetable/actions';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, CardBody, CardHeader, EmptyRow, Field, Input, Notice, PageHeader, Select, StateBadge, Table, TD, TH, THead, TR } from '@/components/ui/primitives';
import { formatDate, todayIST } from '@/shared/dates';

export const metadata = { title: 'Timetable' };

interface Version { id: string; name: string; status: string; effective_from: string; published_at: string | null; term: { name: string }; standard: { code: string }; stream: { name: string }; timetable_slots: { id: string }[] }
interface Group { id: string; name: string; kind: string; component: string; offering: { stream_id: string; subject: { name: string } }; teaching_assignments: { valid_during: string; role: string; staff: { full_name: string } }[] }

export default async function TimetablePage() {
  const viewer = await requirePermission('timetable.edit');
  const { year, terms } = await getYearContext();
  if (!year) return <Notice tone="warn">No academic year yet.</Notice>;
  const supabase = await createClient();
  const today = todayIST();
  const [{ data: versions }, { data: groups }, { data: standards }, { data: streams }, { data: subjects }, { data: batches }, divisions, staff] = await Promise.all([
    supabase.from('timetable_versions').select('id, name, status, effective_from, published_at, term:academic_terms(name), standard:standards(code), stream:streams(name), timetable_slots(id)').eq('academic_year_id', year.id).order('created_at', { ascending: false }),
    supabase.from('teaching_groups').select('id, name, kind, component, offering:subject_offerings!inner(stream_id, academic_year_id, subject:subjects(name)), teaching_assignments(valid_during, role, staff(full_name))').eq('offering.academic_year_id', year.id).order('name'),
    supabase.from('standards').select('id, code').order('level'),
    supabase.from('streams').select('id, name').eq('is_active', true).order('sort_order'),
    supabase.from('subjects').select('id, name, subject_components(component)').order('name'),
    supabase.from('batches').select('id, code, division:divisions!inner(name, academic_year_id)').eq('division.academic_year_id', year.id),
    getDivisions(),
    getStaffOptions(),
  ]);

  return (
    <>
      <PageHeader title="Timetable" description="1) Create teaching groups (who is taught what, by whom). 2) Build a timetable version per standard × stream × term. 3) Publish: sessions are generated for the remaining term days, skipping holidays." />

      <Card>
        <CardHeader title="Timetable versions" />
        <Table>
          <THead><tr><TH>Name</TH><TH>Term</TH><TH>Standard · stream</TH><TH>From</TH><TH className="text-right">Slots</TH><TH>Status</TH></tr></THead>
          <tbody>
            {asRows<Version>(versions).length === 0 ? <EmptyRow colSpan={6}>No timetables yet.</EmptyRow> : null}
            {asRows<Version>(versions).map((v) => (
              <TR key={v.id}>
                <TD><Link className="font-medium text-brand-700 hover:underline" href={`/timetable/${v.id}`}>{v.name}</Link></TD>
                <TD>{v.term.name}</TD>
                <TD>{v.standard.code} · {v.stream.name}</TD>
                <TD>{formatDate(v.effective_from)}</TD>
                <TD className="text-right tabular-nums">{v.timetable_slots.length}</TD>
                <TD><StateBadge state={v.status} /></TD>
              </TR>
            ))}
          </tbody>
        </Table>
        <CardBody className="border-t border-gray-100">
          <ActionForm action={createVersion} submitLabel="New draft timetable" resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-5">
              <Field label="Term"><Select name="term_id">{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
              <Field label="Standard"><Select name="standard_id">{(standards ?? []).map((s: { id: string; code: string }) => <option key={s.id} value={s.id}>{s.code}</option>)}</Select></Field>
              <Field label="Stream"><Select name="stream_id">{(streams ?? []).map((s: { id: string; name: string }) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              <Field label="Name"><Input name="name" placeholder="XI Science · Term 2 v1" required /></Field>
              <Field label="Effective from"><Input type="date" name="effective_from" defaultValue={today} required /></Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Teaching groups" description="Division groups for theory, batch groups for practicals. Cross-division language/optional groups (custom) can be added by the Admin." />
        <Table>
          <THead><tr><TH>Group</TH><TH>Subject</TH><TH>Kind</TH><TH>Teacher</TH></tr></THead>
          <tbody>
            {asRows<Group>(groups).length === 0 ? <EmptyRow colSpan={4}>No teaching groups yet.</EmptyRow> : null}
            {asRows<Group>(groups).map((g) => {
              const t = g.teaching_assignments.filter((a) => rangeContains(a.valid_during, today));
              return (
                <TR key={g.id}>
                  <TD className="font-medium">{g.name}</TD>
                  <TD>{g.offering.subject.name} <Badge>{g.component}</Badge></TD>
                  <TD className="capitalize">{g.kind}</TD>
                  <TD className="text-sm">{t.map((a) => a.staff.full_name).join(', ') || <Badge tone="amber">unassigned</Badge>}</TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
        {can(viewer, 'timetable.edit') ? (
          <CardBody className="border-t border-gray-100">
            <ActionForm action={createTeachingGroup} submitLabel="Add teaching group" resetOnSuccess>
              <div className="grid gap-4 sm:grid-cols-5">
                <Field label="Division"><Select name="division_id">{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
                <Field label="Subject"><Select name="subject_id">{asRows<{ id: string; name: string }>(subjects).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
                <Field label="Component"><Select name="component"><option value="TH">Theory</option><option value="PR">Practical</option><option value="OR">Oral / project</option></Select></Field>
                <Field label="Batch (practicals)">
                  <Select name="batch_id" defaultValue=""><option value="">Whole division</option>{asRows<{ id: string; code: string; division: { name: string } }>(batches).map((b) => <option key={b.id} value={b.id}>{b.division.name} · {b.code}</option>)}</Select>
                </Field>
                <Field label="Teacher"><Select name="staff_id" defaultValue=""><option value="">–</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select></Field>
              </div>
            </ActionForm>
          </CardBody>
        ) : null}
      </Card>
    </>
  );
}
