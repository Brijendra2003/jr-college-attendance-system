import Link from 'next/link';
import { can, requirePermission } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { getDivisions, getYearContext } from '@/features/academics/context';
import { closeMonth, signMuster } from '@/features/attendance/actions';
import { ActionButton } from '@/components/action-button';
import { str } from '@/components/pager';
import { Badge, Card, Notice, PageHeader, Select, StateBadge, Table, TD, TH, THead, TR } from '@/components/ui/primitives';
import { formatDate, formatMonth, monthStart, todayIST } from '@/shared/dates';

export const metadata = { title: 'Month close & muster' };

function monthsOf(start: string, end: string, today: string) {
  const out: string[] = [];
  let [y, m] = start.slice(0, 7).split('-').map(Number);
  const last = (end < today ? end : today).slice(0, 7);
  while (`${y}-${String(m).padStart(2, '0')}` <= last) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out.reverse();
}

export default async function MonthsPage({ searchParams }: PageProps<'/attendance/months'>) {
  const viewer = await requirePermission('month.close');
  const { year } = await getYearContext();
  if (!year) return <Notice tone="warn">No academic year yet.</Notice>;
  const today = todayIST();
  const months = monthsOf(year.starts_on, year.ends_on, today);
  const requested = str((await searchParams).month);
  const month = requested && months.includes(monthStart(requested)) ? monthStart(requested) : months[1] ?? months[0];
  const supabase = await createClient();
  const [divisions, { data }] = await Promise.all([
    getDivisions(),
    supabase.from('attendance_months').select('division_id, state, closed_at, class_teacher_signed_at, principal_signed_at, revised').eq('month', month),
  ]);
  const byDiv = new Map(asRows<{ division_id: string; state: string; closed_at: string | null; class_teacher_signed_at: string | null; principal_signed_at: string | null; revised: boolean }>(data).map((r) => [r.division_id, r]));
  const visible = can(viewer, 'month.close', 'all') ? divisions : divisions.filter((d) => viewer.classDivisions.some((c) => c.id === d.id));
  const monthOver = month < monthStart(today);
  const isPrincipal = viewer.roles.includes('principal');

  return (
    <>
      <PageHeader
        title="Month close & muster"
        description="Close each division's month by the 3rd working day of the next month. After closing, changes need an approved correction and the muster is marked “revised”."
        actions={
          <form method="get" className="flex items-center gap-2">
            <Select name="month" defaultValue={month} className="h-9 w-44">
              {months.map((m) => <option key={m} value={m}>{formatMonth(m)}</option>)}
            </Select>
            <button className="h-9 rounded-lg bg-gray-900 px-3 text-sm text-white">Show</button>
          </form>
        }
      />
      {!monthOver ? <Notice tone="warn">{formatMonth(month)} is not over yet. It can be closed from {formatDate(`${month.slice(0, 7)}-01`)} next month onwards.</Notice> : null}
      <Card className="mt-4">
        <Table>
          <THead><tr><TH>Division</TH><TH>Month state</TH><TH>Class teacher sign-off</TH><TH>Principal sign-off</TH><TH className="text-right">Actions</TH></tr></THead>
          <tbody>
            {visible.map((d) => {
              const m = byDiv.get(d.id);
              const closed = m?.state === 'closed';
              const isCT = viewer.classDivisions.some((c) => c.id === d.id);
              return (
                <TR key={d.id}>
                  <TD className="font-medium">{d.name}</TD>
                  <TD><StateBadge state={m?.state ?? 'open'} /> {m?.revised ? <Badge tone="amber">revised</Badge> : null}</TD>
                  <TD className="text-sm">{m?.class_teacher_signed_at ? formatDate(m.class_teacher_signed_at) : '–'}</TD>
                  <TD className="text-sm">{m?.principal_signed_at ? formatDate(m.principal_signed_at) : '–'}</TD>
                  <TD>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Link href={`/attendance/months/${d.id}/${month}`} className="rounded-lg border border-gray-200 px-3 py-1 text-sm hover:bg-gray-50">Muster</Link>
                      {!closed && monthOver ? (
                        <ActionButton action={closeMonth} payload={{ divisionId: d.id, month }} label="Close month" variant="primary"
                          confirm={`Close ${formatMonth(month)} for ${d.name}? Registers become read-only except through corrections.`} />
                      ) : null}
                      {closed && isCT && !m?.class_teacher_signed_at ? <ActionButton action={signMuster} payload={{ divisionId: d.id, month, as: 'class_teacher' }} label="Sign as class teacher" /> : null}
                      {closed && isPrincipal && !m?.principal_signed_at ? <ActionButton action={signMuster} payload={{ divisionId: d.id, month, as: 'principal' }} label="Sign as Principal" /> : null}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
