import Link from 'next/link';
import { can, requirePermission } from '@/lib/auth/viewer';
import { getDivisions, getYearContext } from '@/features/academics/context';
import { getCollegePolicy, getEligibility } from '@/features/eligibility/queries';
import { issueNotice, runEvaluation } from '@/features/eligibility/actions';
import { ActionButton } from '@/components/action-button';
import { str } from '@/components/pager';
import { LinkButton } from '@/components/ui/button';
import { Card, CardHeader, EligibilityChip, EmptyRow, Notice, PageHeader, Percent, Select, Table, TD, TH, THead, TR } from '@/components/ui/primitives';
import { formatDate } from '@/shared/dates';

export const metadata = { title: 'Eligibility & defaulters' };

const BASIS: Record<string, string> = {
  working_days: '75% of working days (board rule)',
  per_subject: 'each subject',
  per_subject_component: 'each subject, theory and practical separately',
  working_days_and_subject: 'working days, plus each subject',
};

export default async function EligibilityPage({ searchParams }: PageProps<'/eligibility'>) {
  const viewer = await requirePermission('eligibility.view');
  const sp = await searchParams;
  const kind = str(sp.kind) === 'final' ? 'final' : 'projected';
  const filters = { division: str(sp.division), status: str(sp.status), show: str(sp.show) ?? 'defaulters' };
  const { year } = await getYearContext();
  if (!year) return <Notice tone="warn">No academic year yet.</Notice>;
  const [divisions, policy, { asOf, rows }] = await Promise.all([
    getDivisions(),
    getCollegePolicy(),
    getEligibility(year.id, { kind, divisionId: filters.division, status: filters.status }),
  ]);
  const min = Number(policy?.min_percent ?? 75);
  const warn = Number(policy?.warn_percent ?? 80);
  const list = filters.show === 'all' ? rows : rows.filter((r) => r.status !== 'eligible' || (r.annual_percent ?? 100) < warn);
  const canNotice = can(viewer, 'notices.defaulter.issue');

  return (
    <>
      <PageHeader
        title="Eligibility & defaulters"
        description={`Basis: ${BASIS[policy?.eligibility_basis ?? 'working_days']}, ${policy?.term_rule === 'each_term' ? 'each term separately' : 'both terms together'}. Warning band below ${warn}%. Projected eligibility uses the remaining working days in the year; the final list is signed by the Principal before hall tickets.`}
        actions={can(viewer, 'eligibility.manage', 'all') ? (
          <>
            <ActionButton action={runEvaluation} payload={{ kind: 'projected' }} label="Recompute projected" />
            <ActionButton action={runEvaluation} payload={{ kind: 'final' }} label="Compute final list" confirm="Compute the FINAL eligibility list as of today? Use this before hall tickets / the annual exam." />
          </>
        ) : null}
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <Select name="kind" defaultValue={kind} className="w-40"><option value="projected">Projected</option><option value="final">Final</option></Select>
        <Select name="division" defaultValue={filters.division ?? ''} className="w-44">
          <option value="">All divisions</option>
          {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <Select name="status" defaultValue={filters.status ?? ''} className="w-52">
          <option value="">Any status</option>
          {['eligible', 'at_risk', 'short', 'condonation_pending', 'condoned', 'not_eligible'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </Select>
        <Select name="show" defaultValue={filters.show} className="w-56">
          <option value="defaulters">Defaulters (below {warn}% or not eligible)</option>
          <option value="all">Everyone</option>
        </Select>
        <button className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white">Apply</button>
        <LinkButton href={`/api/reports/eligibility?kind=${kind}${filters.division ? `&division=${filters.division}` : ''}`} size="md">Export Excel</LinkButton>
      </form>

      {!asOf ? (
        <Notice tone="warn">No {kind} snapshot yet. It is computed nightly at 01:00 IST{can(viewer, 'eligibility.manage', 'all') ? ', or recompute now' : ''}.</Notice>
      ) : (
        <Card>
          <CardHeader title={`${list.length} student${list.length === 1 ? '' : 's'}`} description={`Snapshot as of ${formatDate(asOf)}`} />
          <Table>
            <THead>
              <tr>
                <TH>Student</TH><TH>Division</TH><TH className="text-right">Term 1</TH><TH className="text-right">Term 2</TH><TH className="text-right">Year</TH>
                <TH className="text-right">Days needed</TH><TH className="text-right">Days left</TH><TH>Status</TH><TH>Subjects below {min}%</TH>{canNotice ? <TH>Notice</TH> : null}
              </tr>
            </THead>
            <tbody>
              {list.length === 0 ? <EmptyRow colSpan={10}>No defaulters in this view.</EmptyRow> : null}
              {list.map((r) => (
                <TR key={r.student_id}>
                  <TD>
                    <Link className="font-medium text-brand-700 hover:underline" href={`/people/students/${r.student_id}`}>{r.student.full_name}</Link>
                    <div className="text-xs text-gray-500">GR {r.student.gr_no}</div>
                  </TD>
                  <TD>{r.division?.name ?? '–'}</TD>
                  <TD className="text-right"><Percent value={r.term1_percent} min={min} warn={warn} /></TD>
                  <TD className="text-right"><Percent value={r.term2_percent} min={min} warn={warn} /></TD>
                  <TD className="text-right"><Percent value={r.annual_percent} min={min} warn={warn} /></TD>
                  <TD className="text-right tabular-nums">{r.days_needed || '–'}</TD>
                  <TD className="text-right tabular-nums">{kind === 'projected' ? r.remaining_days : '–'}</TD>
                  <TD><EligibilityChip status={r.status} /></TD>
                  <TD className="text-xs">{r.subject_results.map((s) => `${s.subject} ${s.component} ${s.percent}%`).join(', ') || '–'}</TD>
                  {canNotice ? (
                    <TD>
                      {r.status !== 'eligible' || (r.annual_percent ?? 100) < warn ? (
                        <ActionButton action={issueNotice} payload={{ studentId: r.student_id, level: 'warning', language: 'mr', channel: 'both' }} label="Issue notice" confirm={`Issue a defaulter warning to ${r.student.full_name}'s guardians?`} />
                      ) : null}
                    </TD>
                  ) : null}
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
