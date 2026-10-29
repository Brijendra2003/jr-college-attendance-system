import { requirePermission } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { setYearStatus } from '@/features/academics/actions';
import { YearForm } from '@/features/academics/forms';
import { ActionButton } from '@/components/action-button';
import { Card, CardBody, CardHeader, Notice, PageHeader, StateBadge, Table, TD, TH, THead, TR } from '@/components/ui/primitives';
import { formatDate } from '@/shared/dates';

export const metadata = { title: 'Years & terms' };

interface Year { id: string; label: string; starts_on: string; ends_on: string; status: string; academic_terms: { seq: number; name: string; starts_on: string; ends_on: string }[] }

export default async function YearsPage() {
  await requirePermission('structure.manage');
  const supabase = await createClient();
  const { data } = await supabase
    .from('academic_years')
    .select('id, label, starts_on, ends_on, status, academic_terms(seq, name, starts_on, ends_on)')
    .order('starts_on', { ascending: false });
  const years = asRows<Year>(data);

  return (
    <>
      <PageHeader title="Academic years & terms" description="Two terms per year: June to Diwali, and after Diwali to March/April. Eligibility is reported per term and for the year." />
      <Card>
        <Table>
          <THead><tr><TH>Year</TH><TH>First term</TH><TH>Second term</TH><TH>Status</TH><TH className="text-right">Actions</TH></tr></THead>
          <tbody>
            {years.map((y) => {
              const t = [...y.academic_terms].sort((a, b) => a.seq - b.seq);
              return (
                <TR key={y.id}>
                  <TD className="font-medium">{y.label}</TD>
                  {[0, 1].map((i) => (
                    <TD key={i}>{t[i] ? `${formatDate(t[i].starts_on)} – ${formatDate(t[i].ends_on)}` : '–'}</TD>
                  ))}
                  <TD><StateBadge state={y.status} /></TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-2">
                      {y.status !== 'active' ? (
                        <ActionButton action={setYearStatus} payload={{ id: y.id, status: 'active' }} label="Make active"
                          confirm={`Make ${y.label} the active year? The current active year will be archived (read-only).`} />
                      ) : null}
                      {y.status === 'active' ? (
                        <ActionButton action={setYearStatus} payload={{ id: y.id, status: 'archived' }} label="Archive" variant="ghost"
                          confirm={`Archive ${y.label}? Its records become read-only.`} />
                      ) : null}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card className="mt-6">
        <CardHeader title="New academic year" description="Create next year's structure in Academics → Structure after this. Promotion of XI students to XII is done from the student list." />
        <CardBody><YearForm /></CardBody>
      </Card>
      <div className="mt-4">
        <Notice>Year rollover (cloning divisions and promoting XI → XII) is planned for the next release. Until then, create the new year&apos;s divisions and import the XII roster.</Notice>
      </div>
    </>
  );
}
