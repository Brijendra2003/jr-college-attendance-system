import Link from 'next/link';
import { can, requirePermission } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { getYearContext } from '@/features/academics/context';
import { getEligibility } from '@/features/eligibility/queries';
import { createCondonationCase, updateCondonation } from '@/features/eligibility/actions';
import { ActionButton } from '@/components/action-button';
import { ActionForm } from '@/components/action-form';
import { Card, CardBody, CardHeader, EmptyRow, Field, Notice, PageHeader, Select, StateBadge, Table, TD, TH, THead, TR, Textarea } from '@/components/ui/primitives';
import { formatDate, todayIST } from '@/shared/dates';

export const metadata = { title: 'Condonation' };

const GROUND: Record<string, string> = { state_national_sports: 'State / national sports', medical: 'Medical', other: 'Other documented ground' };

interface CaseRow {
  id: string; status: string; ground: string; details: string; shortfall_percent: number | null;
  principal_recommendation: string | null; recommended_at: string | null; submitted_to_board_on: string | null;
  board_decision: string | null; board_decision_on: string | null; created_at: string;
  student: { id: string; full_name: string; gr_no: string };
}

export default async function CondonationPage() {
  const viewer = await requirePermission(['eligibility.manage', 'condonation.recommend']);
  const { year } = await getYearContext();
  if (!year) return <Notice tone="warn">No academic year yet.</Notice>;
  const supabase = await createClient();
  const [{ data }, { rows: shortRows }] = await Promise.all([
    supabase
      .from('condonation_cases')
      .select('id, status, ground, details, shortfall_percent, principal_recommendation, recommended_at, submitted_to_board_on, board_decision, board_decision_on, created_at, student:students(id, full_name, gr_no)')
      .eq('academic_year_id', year.id)
      .order('created_at', { ascending: false }),
    getEligibility(year.id, { kind: 'projected' }),
  ]);
  const cases = asRows<CaseRow>(data);
  const withCase = new Set(cases.map((c) => c.student.id));
  const candidates = shortRows.filter((r) => ['short', 'at_risk', 'not_eligible'].includes(r.status) && !withCase.has(r.student_id));
  const isPrincipal = viewer.roles.includes('principal');
  const today = todayIST();

  return (
    <>
      <PageHeader
        title="Condonation cases"
        description="On the junior-college head's recommendation, the Divisional Chairman may condone a shortfall (state/national sports representation, or other documented grounds). The board's decision is recorded here once received; submission happens outside the system."
      />

      <Card>
        <Table>
          <THead><tr><TH>Student</TH><TH>Ground</TH><TH className="text-right">Shortfall</TH><TH>Status</TH><TH>Progress</TH><TH>Next step</TH></tr></THead>
          <tbody>
            {cases.length === 0 ? <EmptyRow colSpan={6}>No cases this year.</EmptyRow> : null}
            {cases.map((c) => (
              <TR key={c.id}>
                <TD>
                  <Link className="font-medium text-brand-700 hover:underline" href={`/people/students/${c.student.id}`}>{c.student.full_name}</Link>
                  <div className="max-w-xs text-xs text-gray-500">{c.details}</div>
                </TD>
                <TD className="text-sm">{GROUND[c.ground]}</TD>
                <TD className="text-right tabular-nums">{c.shortfall_percent != null ? `${Number(c.shortfall_percent).toFixed(2)}%` : '–'}</TD>
                <TD><StateBadge state={c.status} /></TD>
                <TD className="text-xs text-gray-600">
                  {c.recommended_at ? <div>Recommended {formatDate(c.recommended_at)}</div> : null}
                  {c.submitted_to_board_on ? <div>Sent to board {formatDate(c.submitted_to_board_on)}</div> : null}
                  {c.board_decision_on ? <div>Board: {c.board_decision} ({formatDate(c.board_decision_on)})</div> : null}
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-2">
                    {c.status === 'draft' && isPrincipal ? (
                      <ActionButton action={updateCondonation} payload={{ step: 'recommend', id: c.id }} label="Recommend" variant="primary" prompt="Principal's recommendation to the Divisional Chairman:" promptField="recommendation" />
                    ) : null}
                    {c.status === 'recommended' && can(viewer, 'eligibility.manage', 'all') ? (
                      <ActionButton action={updateCondonation} payload={{ step: 'submitted', id: c.id, on: today }} label="Mark sent to board" />
                    ) : null}
                    {c.status === 'submitted_to_board' && can(viewer, 'eligibility.manage', 'all') ? (
                      <>
                        <ActionButton action={updateCondonation} payload={{ step: 'decision', id: c.id, outcome: 'condoned', on: today }} label="Board condoned" variant="primary" />
                        <ActionButton action={updateCondonation} payload={{ step: 'decision', id: c.id, outcome: 'rejected', on: today }} label="Board rejected" prompt="Board's remarks:" promptField="note" />
                      </>
                    ) : null}
                    {['draft', 'recommended'].includes(c.status) ? (
                      <ActionButton action={updateCondonation} payload={{ step: 'withdraw', id: c.id }} label="Withdraw" variant="ghost" confirm="Withdraw this case?" />
                    ) : null}
                  </div>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Open a case" description="Students currently short or at risk, without a case. Attach supporting documents to the student's file." />
        <CardBody>
          {candidates.length ? (
            <ActionForm action={createCondonationCase} extra={{ academic_year_id: year.id }} submitLabel="Open case" resetOnSuccess>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Student">
                  <Select name="student_id">
                    {candidates.map((r) => <option key={r.student_id} value={r.student_id}>{r.student.full_name} · {r.division?.name} · {r.annual_percent ?? '–'}%</option>)}
                  </Select>
                </Field>
                <Field label="Ground">
                  <Select name="ground">{Object.entries(GROUND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
                </Field>
              </div>
              <Field label="Details" hint="Event, dates, certificate references or medical details."><Textarea name="details" required /></Field>
            </ActionForm>
          ) : <p className="text-sm text-gray-500">No short or at-risk students without a case in the latest projected snapshot.</p>}
        </CardBody>
      </Card>
    </>
  );
}
