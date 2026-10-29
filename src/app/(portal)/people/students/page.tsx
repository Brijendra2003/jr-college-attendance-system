import Link from 'next/link';
import { can, requirePermission } from '@/lib/auth/viewer';
import { getDivisions, getYearContext } from '@/features/academics/context';
import { currentEnrollment, listStudents, PAGE_SIZE } from '@/features/people/queries';
import { Pager, pageParam, str } from '@/components/pager';
import { LinkButton } from '@/components/ui/button';
import { Badge, Card, EmptyRow, Input, Notice, PageHeader, Select, StateBadge, Table, TD, TH, THead, TR } from '@/components/ui/primitives';

export const metadata = { title: 'Students' };

export default async function StudentsPage({ searchParams }: PageProps<'/people/students'>) {
  const viewer = await requirePermission('students.view');
  const sp = await searchParams;
  const { year } = await getYearContext();
  if (!year) return <Notice tone="warn">No academic year yet.</Notice>;
  const filters = { q: str(sp.q), division: str(sp.division), status: str(sp.status) };
  const page = pageParam(sp.page);
  const [divisions, { rows, total }] = await Promise.all([
    getDivisions(),
    listStudents({ yearId: year.id, q: filters.q, divisionId: filters.division, status: filters.status, page }),
  ]);
  const showIds = can(viewer, 'students.ids.view', 'all');

  return (
    <>
      <PageHeader
        title="Students"
        description={`Enrolled in ${year.label}. Search by name (English or Marathi), GR No., CAP application no., APAAR, PEN or Saral ID.`}
        actions={can(viewer, 'admissions.import', 'all') ? (
          <>
            <LinkButton href="/admissions">Import list</LinkButton>
            <LinkButton href="/people/students/new" variant="primary">Add student</LinkButton>
          </>
        ) : null}
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <Input name="q" defaultValue={filters.q} placeholder="Name, GR No., APAAR…" className="w-64" />
        <Select name="division" defaultValue={filters.division ?? ''} className="w-44">
          <option value="">All divisions</option>
          {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <Select name="status" defaultValue={filters.status ?? ''} className="w-48">
          <option value="">Any status</option>
          {['active', 'left', 'transferred', 'admission_cancelled', 'detained', 'passed_out'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </Select>
        <button className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white">Filter</button>
        {filters.q || filters.division || filters.status ? <Link href="/people/students" className="text-sm text-gray-600 underline">Clear</Link> : null}
      </form>

      <Card>
        <Table>
          <THead>
            <tr><TH>Name</TH><TH>GR No.</TH><TH>Division</TH><TH className="text-right">Roll</TH><TH>Admission</TH>{showIds ? <TH>IDs</TH> : null}<TH>Status</TH></tr>
          </THead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={7}>No students match.</EmptyRow> : null}
            {rows.map((s) => {
              const e = currentEnrollment(s.student_enrollments);
              return (
                <TR key={s.id}>
                  <TD>
                    <Link href={`/people/students/${s.id}`} className="font-medium text-brand-700 hover:underline">{s.full_name}</Link>
                    {s.name_mr ? <div className="deva text-xs text-gray-500" lang="mr">{s.name_mr}</div> : null}
                  </TD>
                  <TD className="tabular-nums">{s.gr_no}</TD>
                  <TD>{e?.division.name ?? '–'}</TD>
                  <TD className="text-right tabular-nums">{e?.roll_no ?? '–'}</TD>
                  <TD className="capitalize">{s.admission_type.replace(/_/g, ' ')}</TD>
                  {showIds ? (
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {!s.apaar_id ? <Badge tone="amber">no APAAR</Badge> : null}
                        {!s.saral_id ? <Badge tone="amber">no Saral</Badge> : null}
                        {!s.pen ? <Badge tone="amber">no PEN</Badge> : null}
                        {s.apaar_id && s.saral_id && s.pen ? <Badge tone="green">complete</Badge> : null}
                      </div>
                    </TD>
                  ) : null}
                  <TD><StateBadge state={s.status} /></TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
        <Pager page={page} total={total} pageSize={PAGE_SIZE} basePath="/people/students" params={filters} />
      </Card>
    </>
  );
}
