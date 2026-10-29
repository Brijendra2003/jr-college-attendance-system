import { can, requirePermission } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { getYearContext } from '@/features/academics/context';
import { applyTemplate, createBatch } from '@/features/academics/actions';
import { DivisionsForm, ShiftForm } from '@/features/academics/forms';
import { rangeContains } from '@/lib/ranges';
import { ActionButton } from '@/components/action-button';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, CardBody, CardHeader, Field, Input, Notice, PageHeader, Select, Table, TD, TH, THead, TR } from '@/components/ui/primitives';
import { todayIST } from '@/shared/dates';

export const metadata = { title: 'Academic structure' };

interface Division {
  id: string; name: string; medium_code: string; capacity: number;
  standard: { code: string; level: number }; stream: { code: string; name: string };
  shift: { name: string } | null;
  batches: { id: string; code: string; name: string }[];
  class_teacher_assignments: { valid_during: string; staff: { full_name: string } }[];
  student_enrollments: { valid_during: string }[];
}

export default async function StructurePage() {
  const viewer = await requirePermission('structure.view');
  const manage = can(viewer, 'structure.manage', 'all');
  const { year } = await getYearContext();
  if (!year) return <Notice tone="warn">Create an academic year first.</Notice>;

  const supabase = await createClient();
  const today = todayIST();
  const [{ data }, { data: shifts }, { data: standards }, { data: streams }, { data: subjects }] = await Promise.all([
    supabase
      .from('divisions')
      .select(`id, name, medium_code, capacity, standard:standards(code, level), stream:streams(code, name), shift:shifts(name),
               batches(id, code, name), class_teacher_assignments(valid_during, staff(full_name)), student_enrollments(valid_during)`)
      .eq('academic_year_id', year.id)
      .order('name'),
    supabase.from('shifts').select('id, name, starts_at, ends_at').order('starts_at'),
    supabase.from('standards').select('id, code, label').order('level'),
    supabase.from('streams').select('id, code, name').eq('is_active', true).order('sort_order'),
    supabase.from('subjects').select('id, name, name_mr, kind, in_eligibility, stream_codes, subject_components(component)').order('name'),
  ]);
  const divisions = asRows<Division>(data);
  const subjectRows = asRows<{ id: string; name: string; name_mr: string | null; kind: string; in_eligibility: boolean; stream_codes: string[]; subject_components: { component: string }[] }>(subjects);

  return (
    <>
      <PageHeader title="Academic structure" description={`Standards × streams × mediums → divisions → practical batches, for ${year.label}.`} />

      <Card>
        <CardHeader title={`Divisions (${divisions.length})`} />
        <Table>
          <THead><tr><TH>Division</TH><TH>Stream</TH><TH>Medium</TH><TH>Shift</TH><TH className="text-right">Students</TH><TH>Class teacher</TH><TH>Batches</TH></tr></THead>
          <tbody>
            {divisions.map((d) => {
              const ct = d.class_teacher_assignments.find((c) => rangeContains(c.valid_during, today));
              const enrolled = d.student_enrollments.filter((e) => rangeContains(e.valid_during, today)).length;
              return (
                <TR key={d.id}>
                  <TD className="font-medium">{d.name}</TD>
                  <TD>{d.stream.name}</TD>
                  <TD className="uppercase">{d.medium_code}</TD>
                  <TD>{d.shift?.name ?? '–'}</TD>
                  <TD className="text-right tabular-nums">{enrolled} / {d.capacity}</TD>
                  <TD>{ct ? ct.staff.full_name : <Badge tone="amber">Not assigned</Badge>}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {d.batches.map((b) => <Badge key={b.id}>{b.code}</Badge>)}
                      {d.stream.code === 'SCI' && d.batches.length === 0 ? <Badge tone="amber">no practical batches</Badge> : null}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {manage ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <CardHeader title="Add divisions" />
            <CardBody><DivisionsForm yearId={year.id} standards={standards ?? []} streams={streams ?? []} shifts={shifts ?? []} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Add a practical batch" description="Physics, Chemistry, Biology, IT and bifocal practicals are taken batch-wise." />
            <CardBody>
              <ActionForm action={createBatch} submitLabel="Add batch" resetOnSuccess>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Division">
                    <Select name="division_id">{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
                  </Field>
                  <Field label="Code"><Input name="code" placeholder="P1" required /></Field>
                  <Field label="Name"><Input name="name" placeholder="Batch P1 (roll 1–40)" required /></Field>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Shifts" description={(shifts ?? []).map((s: { name: string; starts_at: string; ends_at: string }) => `${s.name} ${s.starts_at.slice(0, 5)}–${s.ends_at.slice(0, 5)}`).join(' · ') || 'None yet'} />
            <CardBody><ShiftForm /></CardBody>
          </Card>
        </div>
      ) : null}

      <Card className="mt-6">
        <CardHeader
          title={`Subjects (${subjectRows.length})`}
          description="Board subject codes are blank in the template: fill them from the current MSBSHSE list."
          actions={manage ? <ActionButton action={applyTemplate} payload={{}} label="Apply MSBSHSE template" /> : null}
        />
        <Table>
          <THead><tr><TH>Subject</TH><TH>Kind</TH><TH>Streams</TH><TH>Components</TH><TH>Counts for eligibility</TH></tr></THead>
          <tbody>
            {subjectRows.map((s) => (
              <TR key={s.id}>
                <TD>{s.name}{s.name_mr ? <span className="deva ml-2 text-gray-500" lang="mr">{s.name_mr}</span> : null}</TD>
                <TD className="capitalize">{s.kind}</TD>
                <TD>{s.stream_codes.length ? s.stream_codes.join(', ') : 'All'}</TD>
                <TD>{s.subject_components.map((c) => c.component).join(' + ')}</TD>
                <TD>{s.in_eligibility ? 'Yes' : 'No'}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
