import Link from 'next/link';
import { can, requirePermission } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { decideLeave } from '@/features/leave/actions';
import { ActionButton } from '@/components/action-button';
import { str } from '@/components/pager';
import { Badge, Card, EmptyRow, Notice, PageHeader, StateBadge, Table, TD, TH, THead, TR } from '@/components/ui/primitives';
import { formatDate, formatDateTime } from '@/shared/dates';
import { cn } from '@/lib/cn';

export const metadata = { title: 'Leave' };

interface LeaveRow {
  id: string; leave_type: string; span: string; from_date: string; to_date: string; reason: string; status: string;
  applied_by_kind: string; guardian_ack_at: string | null; decision_note: string | null; decided_at: string | null; created_at: string;
  student: { id: string; full_name: string }; division: { name: string } | null;
}

const TABS = [['open', 'To decide'], ['awaiting_guardian', 'Awaiting guardian'], ['approved', 'Approved'], ['rejected', 'Rejected']] as const;

export default async function LeavePage({ searchParams }: PageProps<'/leave'>) {
  const viewer = await requirePermission('leave.student.decide');
  const tab = str((await searchParams).tab) ?? 'open';
  const supabase = await createClient();
  let q = supabase
    .from('leave_requests')
    .select('id, leave_type, span, from_date, to_date, reason, status, applied_by_kind, guardian_ack_at, decision_note, decided_at, created_at, student:students(id, full_name), division:divisions(name)')
    .order('from_date', { ascending: tab === 'open' })
    .limit(300);
  q = tab === 'open' ? q.in('status', ['pending', 'needs_info']) : q.eq('status', tab);
  const { data } = await q;
  const rows = asRows<LeaveRow>(data);
  const decideAll = can(viewer, 'leave.student.decide', ['all', 'stream']);

  return (
    <>
      <PageHeader
        title="Student leave"
        description="Students and parents apply in the app; a student's own request needs a guardian's acknowledgement first (college policy). Class teachers decide; requests not decided within the routing window can be decided here."
      />
      {!decideAll ? <Notice>You see requests for your own division. Decide them from My class or here.</Notice> : null}
      <div className="my-4 flex gap-2 text-sm">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/leave?tab=${k}`} className={cn('rounded-full px-3 py-1', k === tab ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200')}>{l}</Link>
        ))}
      </div>
      <Card>
        <Table>
          <THead><tr><TH>Student</TH><TH>Dates</TH><TH>Type</TH><TH>Reason</TH><TH>Applied</TH><TH>Status</TH><TH /></tr></THead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={7}>Nothing here.</EmptyRow> : null}
            {rows.map((l) => (
              <TR key={l.id}>
                <TD>
                  <Link className="font-medium text-brand-700 hover:underline" href={`/people/students/${l.student.id}`}>{l.student.full_name}</Link>
                  <div className="text-xs text-gray-500">{l.division?.name}</div>
                </TD>
                <TD className="whitespace-nowrap text-sm">{formatDate(l.from_date)}{l.to_date !== l.from_date ? ` – ${formatDate(l.to_date)}` : ''}{l.span !== 'full_day' ? <Badge className="ml-1">{l.span.replace('_', ' ')}</Badge> : null}</TD>
                <TD className="text-sm">{l.leave_type}</TD>
                <TD className="max-w-xs text-sm">{l.reason}{l.decision_note ? <div className="text-xs text-gray-500">Note: {l.decision_note}</div> : null}</TD>
                <TD className="text-xs text-gray-600">
                  <div className="capitalize">{l.applied_by_kind} · {formatDateTime(l.created_at)}</div>
                  {l.guardian_ack_at ? <div>Guardian acknowledged</div> : null}
                </TD>
                <TD><StateBadge state={l.status} /></TD>
                <TD>
                  {['pending', 'needs_info'].includes(l.status) ? (
                    <div className="flex gap-2">
                      <ActionButton action={decideLeave} payload={{ id: l.id, decision: 'approved' }} label="Approve" variant="primary" />
                      <ActionButton action={decideLeave} payload={{ id: l.id, decision: 'rejected' }} label="Reject" variant="ghost" prompt="Reason:" promptField="note" />
                    </div>
                  ) : null}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
