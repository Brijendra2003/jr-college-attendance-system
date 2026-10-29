import Link from 'next/link';
import { requireViewer, can } from '@/lib/auth/viewer';
import { getYearContext } from '@/features/academics/context';
import { getEligibilityCounts, getQueues, getReadiness, getSetupHealth, getTodayRollCall } from '@/features/dashboard/queries';
import { Card, CardBody, CardHeader, EligibilityChip, Notice, PageHeader, Stat } from '@/components/ui/primitives';
import { LinkButton } from '@/components/ui/button';
import { formatDate, todayIST } from '@/shared/dates';
import { percent } from '@/shared/attendance';

export const metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const viewer = await requireViewer();
  const { year } = await getYearContext();
  if (!year) {
    return <Notice tone="warn">No academic year is set up yet. Create one in <Link className="underline" href="/academics/years">Years &amp; terms</Link>.</Notice>;
  }

  const showAttendance = can(viewer, 'attendance.view');
  const showEligibility = can(viewer, 'eligibility.view');
  const showReadiness = can(viewer, 'students.ids.view', 'all');
  const showSetup = can(viewer, 'structure.manage', 'all');

  const [today, elig, queues, readiness, setup] = await Promise.all([
    showAttendance ? getTodayRollCall(year.id) : null,
    showEligibility ? getEligibilityCounts(year.id) : null,
    getQueues(),
    showReadiness ? getReadiness() : null,
    showSetup ? getSetupHealth(year.id) : null,
  ]);

  const presentPct = today ? percent(today.present, today.marked) : null;

  return (
    <>
      <PageHeader
        title={`Good ${greeting()}, ${viewer.displayName.split(' ')[0]}`}
        description={`${formatDate(todayIST())} · Academic year ${year.label}`}
        actions={showAttendance ? <LinkButton href="/attendance/today" variant="primary">Open today&apos;s board</LinkButton> : null}
      />

      {viewer.classDivisions.length > 0 && !viewer.roles.some((r) => r !== 'teacher') ? (
        <Notice>
          Class-teacher desk for <strong>{viewer.classDivisions.map((d) => d.name).join(', ')}</strong>. Daily roll-call happens in the mobile app;
          use <Link className="underline" href="/my-class">My class</Link> for defaulters, notices and muster sign-off.
        </Notice>
      ) : null}

      {today ? (
        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Roll-calls submitted" value={`${today.submitted} / ${today.divisions}`} hint={today.pending ? `${today.pending} still pending` : 'All divisions in'} tone={today.pending ? 'warn' : 'ok'} />
          <Stat label="Present today" value={presentPct === null ? '–' : `${presentPct}%`} hint={`${today.present} of ${today.marked} marked`} />
          <Stat label="Absent today" value={today.absent} hint="Guardians alerted after roll-call" tone={today.absent ? 'danger' : 'default'} />
          <Stat label="Pending corrections" value={queues.corrections} hint={<Link className="underline" href="/attendance/corrections">Review queue</Link>} tone={queues.corrections ? 'warn' : 'default'} />
        </section>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {elig ? (
          <Card>
            <CardHeader title="Board eligibility (75% of working days)" description={`Snapshot as of ${formatDate(elig.asOf)}`} actions={<LinkButton href="/eligibility" size="sm">Defaulters</LinkButton>} />
            <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {['eligible', 'at_risk', 'short', 'condonation_pending', 'condoned', 'not_eligible'].map((s) => (
                <div key={s} className="rounded-lg border border-gray-100 p-3">
                  <EligibilityChip status={s} />
                  <div className="mt-2 text-xl font-semibold tabular-nums">{elig.byStatus[s] ?? 0}</div>
                </div>
              ))}
            </CardBody>
          </Card>
        ) : showEligibility ? (
          <Card><CardHeader title="Board eligibility" /><CardBody className="text-sm text-gray-500">No eligibility snapshot yet. It is computed nightly once attendance is being taken.</CardBody></Card>
        ) : null}

        <Card>
          <CardHeader title="Waiting on you" />
          <CardBody className="space-y-2 text-sm">
            <QueueRow href="/attendance/corrections" label="Attendance corrections" n={queues.corrections} />
            <QueueRow href="/leave" label="Leave requests to decide" n={queues.leave} />
            <QueueRow href="/eligibility/notices" label="Defaulter notices not yet acknowledged by parents" n={queues.unacknowledgedNotices} />
          </CardBody>
        </Card>

        {readiness ? (
          <Card>
            <CardHeader title="Records readiness" description={`${readiness.total} active students`} actions={<LinkButton href="/govt" size="sm">Details</LinkButton>} />
            <CardBody className="space-y-2 text-sm">
              <QueueRow href="/govt?missing=apaar" label="Missing APAAR ID (needed for HSC)" n={readiness.missingApaar} />
              <QueueRow href="/govt?missing=pen" label="Missing PEN" n={readiness.missingPen} />
              <QueueRow href="/govt?missing=saral" label="Missing Saral ID" n={readiness.missingSaral} />
              <QueueRow href="/people/guardians?login=pending" label="Verified guardians without an app login" n={readiness.guardianLoginsPending} />
            </CardBody>
          </Card>
        ) : null}

        {setup ? (
          <Card>
            <CardHeader title="Setup health" />
            <CardBody className="space-y-2 text-sm">
              <QueueRow href="/people/staff" label="Divisions without a class teacher" n={setup.divisionsWithoutClassTeacher.length} detail={setup.divisionsWithoutClassTeacher.slice(0, 6).join(', ')} />
              <QueueRow href="/timetable" label="Published timetables this year" n={setup.publishedTimetables} good />
              <QueueRow href="/settings" label="Attendance policies configured" n={setup.policies} good />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function QueueRow({ href, label, n, detail, good }: { href: string; label: string; n: number; detail?: string; good?: boolean }) {
  const tone = good ? (n ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800') : n ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600';
  return (
    <Link href={href} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50">
      <span>
        {label}
        {detail ? <span className="block text-xs text-gray-500">{detail}</span> : null}
      </span>
      <span className={`min-w-8 rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular-nums ${tone}`}>{n}</span>
    </Link>
  );
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
