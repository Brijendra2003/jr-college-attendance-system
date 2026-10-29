import { requirePermission } from '@/lib/auth/viewer';
import { getYearContext } from '@/features/academics/context';
import { getDayBoard } from '@/features/attendance/queries';
import { BoardTable } from '@/features/attendance/board-table';
import { LiveRefresh } from '@/components/live-refresh';
import { Card, CardHeader, Notice, PageHeader, Stat } from '@/components/ui/primitives';
import { formatDate, todayIST } from '@/shared/dates';
import { percent } from '@/shared/attendance';

export const metadata = { title: "Today's attendance" };

const TABLES = ['day_registers', 'attendance_registers'];

export default async function TodayPage() {
  await requirePermission('attendance.view');
  const { year } = await getYearContext();
  if (!year) return <Notice tone="warn">No academic year yet.</Notice>;
  const today = todayIST();
  const rows = await getDayBoard(year.id, today);
  const submitted = rows.filter((r) => r.register && ['submitted', 'locked'].includes(r.register.state));
  const present = rows.reduce((n, r) => n + r.present, 0);
  const marked = rows.reduce((n, r) => n + r.marked, 0);
  const absent = rows.reduce((n, r) => n + r.absent, 0);
  const sessions = rows.reduce((a, r) => ({ total: a.total + r.sessions.total, submitted: a.submitted + r.sessions.submitted }), { total: 0, submitted: 0 });
  const pending = rows.filter((r) => !r.register || r.register.state === 'pending');

  return (
    <>
      <PageHeader title="Today" description={`${formatDate(today)} · Roll-call and period registers update live as teachers submit from the app.`} actions={<LiveRefresh tables={TABLES} />} />
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Roll-calls in" value={`${submitted.length} / ${rows.length}`} tone={pending.length ? 'warn' : 'ok'} hint={pending.length ? `Waiting: ${pending.slice(0, 4).map((r) => r.divisionName).join(', ')}${pending.length > 4 ? '…' : ''}` : 'Complete'} />
        <Stat label="Present" value={percent(present, marked) === null ? '–' : `${percent(present, marked)}%`} hint={`${present} of ${marked} students`} />
        <Stat label="Absent today" value={absent} tone={absent ? 'danger' : 'default'} hint="Guardians get one alert per day" />
        <Stat label="Period registers" value={`${sessions.submitted} / ${sessions.total}`} hint="Submitted / scheduled so far" />
      </section>
      <Card className="mt-6">
        <CardHeader title="Divisions" description="Missing roll-calls are reminded to the class teacher after 30 minutes and escalated to the Supervisor after 60." />
        <BoardTable rows={rows} date={today} />
      </Card>
    </>
  );
}
