import { requirePermission } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { getStaffOptions } from '@/features/people/queries';
import { assignSubstitute, cancelSession } from '@/features/timetable/actions';
import { ActionButton } from '@/components/action-button';
import { ActionForm } from '@/components/action-form';
import { str } from '@/components/pager';
import { Badge, Card, EmptyRow, Input, PageHeader, Select, StateBadge, Table, TD, TH, THead, TR } from '@/components/ui/primitives';
import { formatDate, formatTime, isISODate, todayIST } from '@/shared/dates';

export const metadata = { title: 'Daily sessions' };

interface Session {
  id: string; starts_at: string; ends_at: string; status: string; status_reason: string | null; component: string; session_type: string;
  group: { name: string }; offering: { subject: { name: string } }; division: { name: string } | null;
  session_staff: { role: string; staff: { id: string; full_name: string } }[];
  attendance_registers: { state: string } | { state: string }[] | null;
}

export default async function SessionsBoard({ searchParams }: PageProps<'/timetable/sessions'>) {
  await requirePermission('sessions.manage');
  const raw = str((await searchParams).date);
  const date = raw && isISODate(raw) ? raw : todayIST();
  const supabase = await createClient();
  const [{ data }, staff] = await Promise.all([
    supabase.from('class_sessions')
      .select('id, starts_at, ends_at, status, status_reason, component, session_type, group:teaching_groups(name), offering:subject_offerings(subject:subjects(name)), division:divisions(name), session_staff(role, staff(id, full_name)), attendance_registers(state)')
      .eq('session_date', date).order('starts_at'),
    getStaffOptions(),
  ]);
  const sessions = asRows<Session>(data);

  return (
    <>
      <PageHeader
        title="Daily session board"
        description="Cancel, substitute or check registers for a day. Lecturers often invigilate, so substitutions are one click. For a whole-day closure, declare a holiday in the calendar instead."
        actions={<form method="get" className="flex gap-2"><Input type="date" name="date" defaultValue={date} className="h-9 w-40" /><button className="h-9 rounded-lg bg-gray-900 px-3 text-sm text-white">Show</button></form>}
      />
      <Card>
        <div className="border-b border-gray-100 px-5 py-3 text-sm font-medium">{formatDate(date)} · {sessions.length} sessions</div>
        <Table>
          <THead><tr><TH>Time</TH><TH>Class</TH><TH>Subject</TH><TH>Staff</TH><TH>Status</TH><TH>Register</TH><TH>Actions</TH></tr></THead>
          <tbody>
            {sessions.length === 0 ? <EmptyRow colSpan={7}>No sessions. Publish a timetable to generate them.</EmptyRow> : null}
            {sessions.map((s) => {
              const reg = Array.isArray(s.attendance_registers) ? s.attendance_registers[0] : s.attendance_registers;
              const live = s.status === 'scheduled' || s.status === 'held';
              return (
                <TR key={s.id}>
                  <TD className="whitespace-nowrap text-sm">{formatTime(s.starts_at)}–{formatTime(s.ends_at)}</TD>
                  <TD>{s.group.name}</TD>
                  <TD>{s.offering.subject.name} <Badge>{s.component}</Badge></TD>
                  <TD className="text-sm">
                    {s.session_staff.map((x) => <div key={x.staff.id}>{x.staff.full_name}{x.role === 'substitute' ? <Badge tone="violet" className="ml-1">substitute</Badge> : null}</div>)}
                  </TD>
                  <TD><StateBadge state={s.status} />{s.status_reason ? <div className="text-xs text-gray-500">{s.status_reason}</div> : null}</TD>
                  <TD><StateBadge state={reg?.state ?? 'pending'} /></TD>
                  <TD>
                    {live && (!reg || reg.state === 'pending') ? (
                      <div className="flex flex-wrap items-start gap-2">
                        <ActionForm action={assignSubstitute} extra={{ sessionId: s.id }} submitLabel="Substitute" className="flex items-end gap-2 space-y-0">
                          <Select name="staffId" className="h-8 w-40">{staff.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</Select>
                        </ActionForm>
                        <ActionButton action={cancelSession} payload={{ sessionId: s.id }} label="Cancel" variant="ghost" prompt="Reason for cancelling (shown on the student timetable):" />
                      </div>
                    ) : null}
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
