import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { issueNotice } from '@/features/eligibility/actions';
import { decideLeave, logParentMeeting } from '@/features/leave/actions';
import { ActionButton } from '@/components/action-button';
import { ActionForm } from '@/components/action-form';
import { LinkButton } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EligibilityChip, Field, Input, PageHeader, Percent, Select, StateBadge, Stat, Table, TD, TH, THead, TR, Textarea } from '@/components/ui/primitives';
import { formatDate, monthStart, todayIST } from '@/shared/dates';

export const metadata = { title: 'My class' };

interface Overview {
  division: { id: string; name: string };
  min_percent: number; warn_percent: number;
  today: { state: string; present: number; absent: number; total: number } | null;
  students: { student_id: string; roll_no: string | null; name: string; working_days: number; present: number; percent: number | null; days_needed: number | null; eligibility: string | null; last_notice: { level: string; issued_at: string; acknowledged_at: string | null } | null }[];
}

/** Class-teacher web desk (web doc §1.1): own division only. Daily marking happens in the app. */
export default async function MyClassPage({ searchParams }: PageProps<'/my-class'>) {
  const viewer = await requireViewer();
  if (!viewer.classDivisions.length) redirect('/dashboard');
  const sp = await searchParams;
  const divisionId = (typeof sp.division === 'string' && viewer.classDivisions.some((d) => d.id === sp.division) ? sp.division : viewer.classDivisions[0].id);
  const supabase = await createClient();
  const [{ data: overviewData, error }, { data: leaveData }] = await Promise.all([
    supabase.rpc('class_overview', { p_division_id: divisionId }),
    supabase.from('v_leave_pending_for_me').select('*').eq('division_name', viewer.classDivisions.find((d) => d.id === divisionId)?.name ?? ''),
  ]);
  if (error) throw new Error(error.message);
  const o = overviewData as Overview;
  const leave = asRows<{ id: string; full_name: string; roll_no: string | null; leave_type: string; from_date: string; to_date: string; reason: string; status: string; applied_by_kind: string }>(leaveData);
  const defaulters = o.students.filter((s) => s.percent !== null && s.percent < o.warn_percent);
  const today = todayIST();

  return (
    <>
      <PageHeader
        title={`My class · ${o.division.name}`}
        description="Defaulters, notices, parent meetings, leave approvals and the monthly muster for your division."
        actions={
          <>
            {viewer.classDivisions.length > 1 ? viewer.classDivisions.map((d) => <LinkButton key={d.id} href={`/my-class?division=${d.id}`} size="sm" variant={d.id === divisionId ? 'primary' : 'secondary'}>{d.name}</LinkButton>) : null}
            <LinkButton href={`/attendance/day/${divisionId}/${today}`} size="sm">Today&apos;s register</LinkButton>
            <LinkButton href={`/attendance/months/${divisionId}/${monthStart(today)}`} size="sm">Muster</LinkButton>
          </>
        }
      />

      <section className="grid gap-4 sm:grid-cols-4">
        <Stat label="Today's roll-call" value={o.today ? <StateBadge state={o.today.state} /> : <StateBadge state="pending" />} hint={o.today?.total ? `${o.today.present} present · ${o.today.absent} absent` : 'Mark it in the app'} />
        <Stat label="Students" value={o.students.length} />
        <Stat label={`Below ${o.warn_percent}%`} value={defaulters.length} tone={defaulters.length ? 'warn' : 'ok'} />
        <Stat label="Leave to decide" value={leave.length} tone={leave.length ? 'warn' : 'default'} />
      </section>

      {leave.length ? (
        <Card className="mt-6">
          <CardHeader title="Leave requests" />
          <Table>
            <THead><tr><TH>Student</TH><TH>Dates</TH><TH>Type</TH><TH>Reason</TH><TH>Applied by</TH><TH /></tr></THead>
            <tbody>
              {leave.map((l) => (
                <TR key={l.id}>
                  <TD>{l.roll_no} · {l.full_name}</TD>
                  <TD className="text-sm">{formatDate(l.from_date)}{l.to_date !== l.from_date ? ` – ${formatDate(l.to_date)}` : ''}</TD>
                  <TD className="text-sm">{l.leave_type}</TD>
                  <TD className="max-w-xs text-sm">{l.reason}</TD>
                  <TD className="text-sm capitalize">{l.applied_by_kind}</TD>
                  <TD>
                    <div className="flex gap-2">
                      <ActionButton action={decideLeave} payload={{ id: l.id, decision: 'approved' }} label="Approve" variant="primary" />
                      <ActionButton action={decideLeave} payload={{ id: l.id, decision: 'needs_info' }} label="Ask for info" prompt="What do you need from the family?" promptField="note" />
                      <ActionButton action={decideLeave} payload={{ id: l.id, decision: 'rejected' }} label="Reject" variant="ghost" prompt="Reason:" promptField="note" />
                    </div>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}

      <Card className="mt-6">
        <CardHeader title="Students" description={`Year-to-date working-day attendance. Board minimum ${o.min_percent}%, warning below ${o.warn_percent}%.`} />
        <Table>
          <THead><tr><TH className="text-right">Roll</TH><TH>Name</TH><TH className="text-right">Present / days</TH><TH className="text-right">%</TH><TH className="text-right">Days needed</TH><TH>Eligibility</TH><TH>Last notice</TH><TH /></tr></THead>
          <tbody>
            {o.students.map((s) => {
              const flagged = s.percent !== null && s.percent < o.warn_percent;
              const next = !s.last_notice ? 'warning' : s.last_notice.level === 'warning' ? 'second' : 'final';
              return (
                <TR key={s.student_id} className={flagged ? 'bg-amber-50/40' : undefined}>
                  <TD className="text-right font-mono tabular-nums">{s.roll_no}</TD>
                  <TD><Link className="hover:underline" href={`/people/students/${s.student_id}`}>{s.name}</Link></TD>
                  <TD className="text-right tabular-nums">{s.present}/{s.working_days}</TD>
                  <TD className="text-right"><Percent value={s.percent} min={o.min_percent} warn={o.warn_percent} /></TD>
                  <TD className="text-right tabular-nums">{s.days_needed || '–'}</TD>
                  <TD><EligibilityChip status={s.eligibility} /></TD>
                  <TD className="text-xs">
                    {s.last_notice ? (
                      <span>{s.last_notice.level} · {formatDate(s.last_notice.issued_at)} {s.last_notice.acknowledged_at ? <Badge tone="green">ack</Badge> : <Badge tone="amber">no ack</Badge>}</span>
                    ) : '–'}
                  </TD>
                  <TD>
                    {flagged && s.last_notice?.level !== 'final' ? (
                      <ActionButton action={issueNotice} payload={{ studentId: s.student_id, level: next, language: 'mr', channel: 'both' }} label={`Issue ${next} notice`} confirm={`Issue a ${next} defaulter notice for ${s.name}?`} />
                    ) : null}
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Log a parent meeting or call" description="Kept with the student's defaulter record." />
        <CardBody>
          <ActionForm action={logParentMeeting} submitLabel="Log meeting" resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Student">
                <Select name="studentId">{o.students.map((s) => <option key={s.student_id} value={s.student_id}>{s.roll_no} · {s.name}</option>)}</Select>
              </Field>
              <Field label="Mode"><Select name="mode"><option value="in_person">In person</option><option value="phone">Phone</option><option value="video">Video</option></Select></Field>
              <Field label="Date"><Input type="date" name="met_on" defaultValue={today} required /></Field>
              <Field label="Follow up on"><Input type="date" name="follow_up_on" /></Field>
            </div>
            <Field label="Outcome"><Textarea name="outcome" required /></Field>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
