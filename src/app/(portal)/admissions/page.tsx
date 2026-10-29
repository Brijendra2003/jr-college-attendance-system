import { requirePermission } from '@/lib/auth/viewer';
import { StudentImporter } from '@/features/admissions/importer';
import { Card, CardBody, CardHeader, Notice, PageHeader } from '@/components/ui/primitives';

export const metadata = { title: 'Admissions import' };

export default async function AdmissionsPage() {
  await requirePermission('admissions.import');
  return (
    <>
      <PageHeader
        title="Admissions import"
        description="Import the FYJC CAP allotment / admitted list you download from the college login on the portal, or any student list in the template format. The system never logs in to government portals."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Upload a list" description="CSV with a header row. Excel files: Save As → CSV (UTF-8) first so Marathi names survive." />
          <CardBody><StudentImporter /></CardBody>
        </Card>
        <div className="space-y-4">
          <Notice>
            <strong>Late admissions are normal until October.</strong> Each student&apos;s attendance counts from the <em>admitted on</em> date, so a student admitted in round 4 is not marked absent for days before they joined.
          </Notice>
          <Notice tone="warn">
            Students are matched on GR No., CAP application no., or SSC seat no. + date of birth. Matching rows are reported as &ldquo;already admitted&rdquo; and left unchanged.
          </Notice>
          <Notice>
            Roll numbers are appended in upload order. Re-number alphabetically once the CAP rounds settle (planned: roll-number freeze tool).
          </Notice>
        </div>
      </div>
    </>
  );
}
