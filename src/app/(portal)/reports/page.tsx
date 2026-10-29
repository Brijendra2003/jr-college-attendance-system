import { can, requirePermission } from '@/lib/auth/viewer';
import { getDivisions } from '@/features/academics/context';
import { Card, CardBody, CardHeader, Field, Notice, PageHeader, Select } from '@/components/ui/primitives';
import { monthStart, todayIST } from '@/shared/dates';

export const metadata = { title: 'Reports' };

export default async function ReportsPage() {
  const viewer = await requirePermission('reports.view');
  const divisions = await getDivisions();
  const canExport = can(viewer, 'reports.export');
  const divisionSelect = (all = true) => (
    <Field label="Division">
      <Select name="division" required={!all}>
        {all ? <option value="">All divisions in scope</option> : null}
        {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </Select>
    </Field>
  );
  const formatSelect = (
    <Field label="Format"><Select name="format"><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option></Select></Field>
  );
  const submit = <button className="h-10 self-end rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700" disabled={!canExport}>Download</button>;

  return (
    <>
      <PageHeader title="Reports" description="Every report is limited to what your role can see, and every download is recorded in the audit log because it contains children's personal data." />
      {!canExport ? <Notice tone="warn">Your role can view reports on screen but not download them.</Notice> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Monthly muster (हजेरी पत्रक)" description="Roll no × date grid with monthly and to-date totals. The printable version is under Month close." />
          <CardBody>
            <form action="/api/reports/muster" className="grid gap-4 sm:grid-cols-4">
              {divisionSelect(false)}
              <Field label="Month"><input type="month" name="month" defaultValue={monthStart(todayIST()).slice(0, 7)} className="h-10 rounded-lg border border-gray-300 px-2 text-sm" /></Field>
              {formatSelect}{submit}
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Day attendance summary" description="Every student's working-day % per term and for the year." />
          <CardBody>
            <form action="/api/reports/day-summary" className="grid gap-4 sm:grid-cols-3">{divisionSelect()}{formatSelect}{submit}</form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Eligibility / defaulter list" description="From the latest projected or final snapshot, with days needed and subject shortfalls." />
          <CardBody>
            <form action="/api/reports/eligibility" className="grid gap-4 sm:grid-cols-4">
              {divisionSelect()}
              <Field label="List"><Select name="kind"><option value="projected">Projected</option><option value="final">Final</option></Select></Field>
              {formatSelect}{submit}
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="More reports" />
          <CardBody className="text-sm text-gray-600">
            Subject-wise attendance, teacher submission, late admissions, biometric integrity and exam attendance reports arrive with Phases 03–04. Government formats (readiness, MahaDBT) are under Government data.
          </CardBody>
        </Card>
      </div>
    </>
  );
}
