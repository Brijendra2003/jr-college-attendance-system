import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, requirePermission } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { getDayRoster, getRegisterHistory } from '@/features/attendance/queries';
import { reopenRegister } from '@/features/attendance/actions';
import { getStatusCodes } from '@/features/people/queries';
import { RollCallSheet } from '@/features/attendance/roll-call-sheet';
import { CorrectionForm } from '@/features/attendance/correction-form';
import { ActionButton } from '@/components/action-button';
import { LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Notice, PageHeader, StateBadge, StatusPill, Table, TD, TH, THead, TR } from '@/components/ui/primitives';
import { formatDate, formatDateTime, isISODate, shiftISODate, todayIST } from '@/shared/dates';

export const metadata = { title: 'Day register' };

export default async function DayRegisterPage({ params }: PageProps<'/attendance/day/[divisionId]/[date]'>) {
  const viewer = await requirePermission('attendance.view');
  const { divisionId, date } = await params;
  if (!isISODate(date)) notFound();
  const supabase = await createClient();
  const [{ data: division }, roster, codes] = await Promise.all([
    supabase.from('divisions').select('id, name').eq('id', divisionId).maybeSingle(),
    getDayRoster(divisionId, date).catch(() => null),
    getStatusCodes(),
  ]);
  if (!division || !roster) notFound();

  const dayCodes = codes.filter((c) => c.scope === 'day' || c.scope === 'both');
  const reg = roster.register;
  const history = reg ? await getRegisterHistory(reg.id) : [];
  const names = new Map(roster.students.map((s) => [s.student_id, `${s.roll_no ?? '–'} · ${s.name}`]));
  const { data: policyRow } = await supabase.from('attendance_policies').select('default_unmarked_status').eq('scope_kind', 'college').order('effective_from', { ascending: false }).limit(1).maybeSingle();

  const isClassTeacher = viewer.classDivisions.some((d) => d.id === divisionId);
  const canMark = can(viewer, 'attendance.day.mark', 'all') || (can(viewer, 'attendance.day.mark', 'class') && isClassTeacher);
  // The database decides editability (edit window from first submission, reopen, month close).
  const editable = roster.working_day && date <= todayIST() && !reg?.block;

  const { data: changers } = history.length
    ? await supabase.from('profiles').select('id, display_name').in('id', [...new Set(history.map((h) => h.changed_by).filter(Boolean))] as string[])
    : { data: [] };
  const changerName = new Map(asRows<{ id: string; display_name: string }>(changers).map((p) => [p.id, p.display_name]));

  return (
    <>
      <PageHeader
        title={`${division.name} · ${formatDate(date)}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            Day register <StateBadge state={reg?.state ?? 'pending'} />
            {reg?.submitted_at ? <span>last submitted {formatDateTime(reg.submitted_at)}</span> : null}
            {reg?.month_closed ? <StateBadge state="closed" /> : null}
            <span>· version {reg?.version ?? 0}</span>
          </span>
        }
        actions={
          <>
            <LinkButton href={`/attendance/day/${divisionId}/${shiftISODate(date, -1)}`} size="sm">← Prev day</LinkButton>
            {date < todayIST() ? <LinkButton href={`/attendance/day/${divisionId}/${shiftISODate(date, 1)}`} size="sm">Next day →</LinkButton> : null}
          </>
        }
      />

      {!roster.working_day ? <Notice tone="warn">Not a working day (Sunday, holiday, vacation or outside the terms). Nothing to mark.</Notice> : null}

      {roster.working_day && canMark && editable ? (
        <Card>
          <CardHeader title={reg && reg.state !== 'pending' ? 'Edit roll-call' : 'Mark roll-call'} description="Usually done by the class teacher in the app. Every change after the first submission is kept in the history below." />
          <CardBody>
            <RollCallSheet
              divisionId={divisionId}
              date={date}
              baseVersion={reg?.version ?? 0}
              students={roster.students}
              codes={dayCodes}
              defaultUnmarked={policyRow?.default_unmarked_status ?? 'A'}
            />
          </CardBody>
        </Card>
      ) : roster.working_day ? (
        <Card>
          <CardHeader
            title={`Roll-call (${roster.students.length} students)`}
            actions={reg && !reg.month_closed && reg.state !== 'reopened' && can(viewer, 'attendance.reopen') ? (
              <ActionButton action={reopenRegister} payload={{ kind: 'day', registerId: reg.id, hours: 4 }} label="Reopen for 4 hours" prompt="Reason for reopening (kept in the audit log):" />
            ) : null}
          />
          <Table>
            <THead><tr><TH className="w-16 text-right">Roll</TH><TH>Student</TH><TH>Status</TH></tr></THead>
            <tbody>
              {roster.students.map((s) => (
                <TR key={s.student_id}>
                  <TD className="text-right font-mono tabular-nums">{s.roll_no ?? '–'}</TD>
                  <TD><Link href={`/people/students/${s.student_id}`} className="hover:underline">{s.name}</Link></TD>
                  <TD>{s.current_status ? <StatusPill code={s.current_status} /> : <span className="text-xs text-gray-400">not marked</span>}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}

      {reg && reg.state !== 'pending' && !editable ? (
        <Card className="mt-6">
          <CardHeader title="Request a correction" description={reg.month_closed ? 'The month is closed: an approved correction revises the muster.' : 'The edit window has passed: corrections go to the Supervisor or Stream Coordinator.'} />
          <CardBody>
            <CorrectionForm kind="day" registerId={reg.id} students={roster.students} codes={dayCodes} />
          </CardBody>
        </Card>
      ) : null}

      {history.length ? (
        <Card className="mt-6">
          <CardHeader title="Change history" description="Append-only: every change after the first submission." />
          <Table>
            <THead><tr><TH>When</TH><TH>Student</TH><TH>Change</TH><TH>Source</TH><TH>By</TH><TH>Reason</TH></tr></THead>
            <tbody>
              {history.map((h) => (
                <TR key={h.id}>
                  <TD className="whitespace-nowrap text-sm">{formatDateTime(h.changed_at)}</TD>
                  <TD className="text-sm">{names.get(h.student_id) ?? h.student_id.slice(0, 8)}</TD>
                  <TD><span className="inline-flex items-center gap-1">{h.old_status ? <StatusPill code={h.old_status} /> : '–'} → <StatusPill code={h.new_status} /></span></TD>
                  <TD className="text-sm">{h.source}</TD>
                  <TD className="text-sm">{h.changed_by ? changerName.get(h.changed_by) ?? '–' : 'system'}</TD>
                  <TD className="text-sm text-gray-600">{h.reason ?? ''}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}
