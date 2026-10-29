import Link from 'next/link';
import { requirePermission } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { str } from '@/components/pager';
import { Card, CardBody, CardHeader, EmptyRow, Field, Input, Notice, PageHeader, Select, Stat, Table, TD, TH, THead, TR } from '@/components/ui/primitives';
import { formatDateTime } from '@/shared/dates';

export const metadata = { title: 'Government data' };

const MISSING: Record<string, { col: string; label: string }> = {
  apaar: { col: 'apaar_id', label: 'APAAR ID' }, pen: { col: 'pen', label: 'PEN' }, saral: { col: 'saral_id', label: 'Saral ID' },
};

export default async function GovtPage({ searchParams }: PageProps<'/govt'>) {
  await requirePermission('govt.export');
  const missing = str((await searchParams).missing);
  const supabase = await createClient();
  const base = () => supabase.from('students').select('id', { count: 'exact', head: true }).eq('status', 'active');
  const [total, apaar, pen, saral, { data: exports }, list] = await Promise.all([
    base(), base().is('apaar_id', null), base().is('pen', null), base().is('saral_id', null),
    supabase.from('govt_exports').select('id, kind, row_count, created_at, exporter:profiles(display_name)').order('created_at', { ascending: false }).limit(20),
    missing && MISSING[missing]
      ? supabase.from('students').select('id, gr_no, full_name, dob').eq('status', 'active').is(MISSING[missing].col, null).order('full_name').limit(500)
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <>
      <PageHeader
        title="Government data"
        description="Saral, UDISE+/APAAR, FYJC CAP, MahaDBT and the MSBSHSE portal have no public APIs. The system prepares the files the office uploads or types in; it never logs in to a portal and stores no portal passwords."
      />
      <section className="grid gap-4 sm:grid-cols-4">
        <Stat label="Active students" value={total.count ?? 0} />
        <Stat label="Missing APAAR ID" value={<Link href="/govt?missing=apaar" className="hover:underline">{apaar.count ?? 0}</Link>} tone={apaar.count ? 'warn' : 'ok'} hint="Required for SSC/HSC from 2026" />
        <Stat label="Missing PEN" value={<Link href="/govt?missing=pen" className="hover:underline">{pen.count ?? 0}</Link>} tone={pen.count ? 'warn' : 'ok'} hint="Needed to generate APAAR" />
        <Stat label="Missing Saral ID" value={<Link href="/govt?missing=saral" className="hover:underline">{saral.count ?? 0}</Link>} tone={saral.count ? 'warn' : 'ok'} />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Exports" description="Each export is logged with who, when, filters and row count, and watermarked." />
          <CardBody className="space-y-5">
            <form action="/api/reports/readiness" className="flex flex-wrap items-end gap-3">
              <div className="flex-1 text-sm"><div className="font-medium">ID readiness list</div><div className="text-gray-500">APAAR / PEN / Saral / APAAR consent per student, for bulk entry on UDISE+ and Saral.</div></div>
              <Select name="format" className="w-28"><option value="xlsx">Excel</option><option value="csv">CSV</option></Select>
              <button className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white">Download</button>
            </form>
            <form action="/api/reports/mahadbt" className="flex flex-wrap items-end gap-3">
              <div className="flex-1 text-sm"><div className="font-medium">MahaDBT scholarship attendance</div><div className="text-gray-500">Attendance % for the year and an eligible flag for the scholarship clerk.</div></div>
              <Field label="Minimum %" className="w-28"><Input type="number" name="min" defaultValue={75} min={1} max={100} /></Field>
              <Select name="format" className="w-28"><option value="xlsx">Excel</option><option value="csv">CSV</option></Select>
              <button className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white">Download</button>
            </form>
            <Notice>Portal column orders change between years. Export formats will be configurable per academic year (format adapters) in a later release.</Notice>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent exports" />
          <Table>
            <THead><tr><TH>When</TH><TH>Kind</TH><TH className="text-right">Rows</TH><TH>By</TH></tr></THead>
            <tbody>
              {asRows<{ id: string; kind: string; row_count: number; created_at: string; exporter: { display_name: string } | null }>(exports).map((e) => (
                <TR key={e.id}><TD className="text-sm">{formatDateTime(e.created_at)}</TD><TD>{e.kind}</TD><TD className="text-right">{e.row_count}</TD><TD className="text-sm">{e.exporter?.display_name}</TD></TR>
              ))}
              {!exports?.length ? <EmptyRow colSpan={4}>No exports yet.</EmptyRow> : null}
            </tbody>
          </Table>
        </Card>
      </div>

      {missing && MISSING[missing] ? (
        <Card className="mt-6">
          <CardHeader title={`Active students missing ${MISSING[missing].label}`} description="Open a student to add the ID." />
          <Table>
            <THead><tr><TH>GR No.</TH><TH>Name</TH><TH>DOB</TH></tr></THead>
            <tbody>
              {asRows<{ id: string; gr_no: string; full_name: string; dob: string | null }>(list.data).map((s) => (
                <TR key={s.id}><TD>{s.gr_no}</TD><TD><Link className="text-brand-700 hover:underline" href={`/people/students/${s.id}`}>{s.full_name}</Link></TD><TD>{s.dob ?? '–'}</TD></TR>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}
