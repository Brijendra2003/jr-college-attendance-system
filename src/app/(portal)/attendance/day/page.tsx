import { requirePermission } from '@/lib/auth/viewer';
import { getYearContext } from '@/features/academics/context';
import { getDayBoard } from '@/features/attendance/queries';
import { BoardTable } from '@/features/attendance/board-table';
import { str } from '@/components/pager';
import { LinkButton } from '@/components/ui/button';
import { Card, Input, Notice, PageHeader } from '@/components/ui/primitives';
import { formatDate, isISODate, shiftISODate, todayIST } from '@/shared/dates';

export const metadata = { title: 'Day registers' };

export default async function DayRegistersPage({ searchParams }: PageProps<'/attendance/day'>) {
  await requirePermission('attendance.view');
  const sp = await searchParams;
  const today = todayIST();
  const raw = str(sp.date);
  const date = raw && isISODate(raw) && raw <= today ? raw : today;
  const { year } = await getYearContext();
  if (!year) return <Notice tone="warn">No academic year yet.</Notice>;
  const rows = await getDayBoard(year.id, date);

  return (
    <>
      <PageHeader
        title="Day registers"
        description="The board counts working days, so the class-teacher roll-call is the register that decides eligibility. Open a division to review, reopen, correct or (for a missed roll-call) mark it from the web."
        actions={
          <form method="get" className="flex items-center gap-2">
            <LinkButton href={`/attendance/day?date=${shiftISODate(date, -1)}`} size="sm">← Prev</LinkButton>
            <Input type="date" name="date" defaultValue={date} max={today} className="h-8 w-40" />
            <button className="h-8 rounded-lg bg-gray-900 px-3 text-sm text-white">Go</button>
            {date < today ? <LinkButton href={`/attendance/day?date=${shiftISODate(date, 1)}`} size="sm">Next →</LinkButton> : null}
          </form>
        }
      />
      <Card>
        <div className="border-b border-gray-100 px-5 py-3 text-sm font-medium">{formatDate(date)}</div>
        <BoardTable rows={rows} date={date} />
      </Card>
    </>
  );
}
