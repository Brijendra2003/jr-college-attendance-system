import Link from 'next/link';
import { requirePermission } from '@/lib/auth/viewer';
import { listCorrections } from '@/features/attendance/queries';
import { decideCorrection } from '@/features/attendance/actions';
import { ActionButton } from '@/components/action-button';
import { str } from '@/components/pager';
import { Card, EmptyRow, PageHeader, StateBadge, StatusPill, Table, TD, TH, THead, TR } from '@/components/ui/primitives';
import { formatDate, formatDateTime } from '@/shared/dates';
import { cn } from '@/lib/cn';

export const metadata = { title: 'Corrections' };

export default async function CorrectionsPage({ searchParams }: PageProps<'/attendance/corrections'>) {
  await requirePermission('attendance.correct.approve');
  const status = str((await searchParams).status) ?? 'pending';
  const { rows, names } = await listCorrections(status);

  return (
    <>
      <PageHeader title="Attendance corrections" description="Requests to change locked registers or closed months. Approving keeps the original value, the new value, the reason, the requester and the approver, and notifies the student and guardians." />
      <div className="mb-4 flex gap-2 text-sm">
        {['pending', 'approved', 'rejected'].map((s) => (
          <Link key={s} href={`/attendance/corrections?status=${s}`} className={cn('rounded-full px-3 py-1 capitalize', s === status ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200')}>{s}</Link>
        ))}
      </div>
      <Card>
        <Table>
          <THead><tr><TH>Requested</TH><TH>Register</TH><TH>Change</TH><TH>Reason</TH><TH>{status === 'pending' ? 'Decide' : 'Decision'}</TH></tr></THead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={5}>Nothing here.</EmptyRow> : null}
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="text-sm">
                  <div>{formatDateTime(r.requested_at)}</div>
                  <div className="text-xs text-gray-500">{r.requester?.display_name}</div>
                </TD>
                <TD className="text-sm">
                  {r.kind === 'day' && r.division_id ? (
                    <Link className="font-medium text-brand-700 hover:underline" href={`/attendance/day/${r.division_id}/${r.att_date}`}>
                      {r.division?.name ?? '–'} · {formatDate(r.att_date)}
                    </Link>
                  ) : (
                    <div className="font-medium">{r.division?.name ?? '–'} · {formatDate(r.att_date)}</div>
                  )}
                  <div className="text-xs capitalize text-gray-500">{r.kind} register</div>
                </TD>
                <TD>
                  <ul className="space-y-1 text-sm">
                    {r.records.map((x) => (
                      <li key={x.student_id} className="flex items-center gap-2">
                        <span>{names.get(x.student_id) ?? 'Student'}</span>
                        {x.from ? <StatusPill code={x.from} /> : '–'} → <StatusPill code={x.to} />
                      </li>
                    ))}
                  </ul>
                </TD>
                <TD className="max-w-xs text-sm text-gray-700">{r.reason}</TD>
                <TD>
                  {status === 'pending' ? (
                    <div className="flex gap-2">
                      <ActionButton action={decideCorrection} payload={{ requestId: r.id, approve: true }} label="Approve" variant="primary" promptField="note" />
                      <ActionButton action={decideCorrection} payload={{ requestId: r.id, approve: false }} label="Reject" prompt="Reason for rejecting:" promptField="note" />
                    </div>
                  ) : (
                    <div className="text-sm"><StateBadge state={r.status} /> <span className="text-xs text-gray-500">{r.decision_note ?? ''}</span></div>
                  )}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
