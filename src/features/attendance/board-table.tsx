import Link from 'next/link';
import type { BoardRow } from './queries';
import { Badge, StateBadge, Table, TD, TH, THead, TR, EmptyRow } from '@/components/ui/primitives';
import { formatTime } from '@/shared/dates';
import { percent } from '@/shared/attendance';

export function BoardTable({ rows, date }: { rows: BoardRow[]; date: string }) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>Division</TH><TH>Class teacher</TH><TH>Roll-call</TH><TH className="text-right">Present</TH><TH className="text-right">Absent</TH>
          <TH className="text-right">Leave</TH><TH className="text-right">Present %</TH><TH>Period registers</TH>
        </tr>
      </THead>
      <tbody>
        {rows.length === 0 ? <EmptyRow colSpan={8}>No divisions in scope.</EmptyRow> : null}
        {rows.map((r) => {
          const pct = percent(r.present, r.marked);
          return (
            <TR key={r.divisionId}>
              <TD><Link className="font-medium text-brand-700 hover:underline" href={`/attendance/day/${r.divisionId}/${date}`}>{r.divisionName}</Link></TD>
              <TD className="text-sm">{r.classTeacher ?? <Badge tone="amber">none</Badge>}</TD>
              <TD>
                <div className="flex items-center gap-2">
                  <StateBadge state={r.register?.state ?? 'pending'} />
                  {r.register?.submitted_at ? <span className="text-xs text-gray-500">{formatTime(r.register.submitted_at)}</span> : null}
                  {r.register && r.register.source !== 'roll_call' ? <Badge tone="violet">{r.register.source}</Badge> : null}
                </div>
              </TD>
              <TD className="text-right tabular-nums">{r.marked ? r.present : '–'}</TD>
              <TD className="text-right tabular-nums">{r.marked ? <span className={r.absent ? 'font-medium text-red-700' : ''}>{r.absent}</span> : '–'}</TD>
              <TD className="text-right tabular-nums">{r.marked ? r.onLeave : '–'}</TD>
              <TD className="text-right tabular-nums">{pct === null ? '–' : `${pct}%`}</TD>
              <TD className="text-sm">
                {r.sessions.total ? (
                  <span className={r.sessions.submitted < r.sessions.total ? 'text-amber-700' : 'text-green-700'}>
                    {r.sessions.submitted}/{r.sessions.total} submitted
                  </span>
                ) : <span className="text-gray-400">no sessions</span>}
                {r.sessions.cancelled ? <span className="ml-2 text-xs text-gray-500">{r.sessions.cancelled} cancelled</span> : null}
              </TD>
            </TR>
          );
        })}
      </tbody>
    </Table>
  );
}
