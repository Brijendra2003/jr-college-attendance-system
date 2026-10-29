import Link from 'next/link';
import { requirePermission } from '@/lib/auth/viewer';
import { getDivisions } from '@/features/academics/context';
import { listNotices } from '@/features/eligibility/queries';
import { str } from '@/components/pager';
import { Badge, Card, EmptyRow, PageHeader, Percent, Select, Table, TD, TH, THead, TR } from '@/components/ui/primitives';
import { formatDate, formatDateTime } from '@/shared/dates';

export const metadata = { title: 'Defaulter notices' };

export default async function NoticesPage({ searchParams }: PageProps<'/eligibility/notices'>) {
  await requirePermission('notices.defaulter.issue');
  const sp = await searchParams;
  const filters = { ack: str(sp.ack), division: str(sp.division) };
  const [divisions, notices] = await Promise.all([getDivisions(), listNotices({ ack: filters.ack, divisionId: filters.division })]);

  return (
    <>
      <PageHeader
        title="Defaulter notices"
        description="Bilingual (Marathi / English) letters to guardians: warning → second → final. Issue them from the Eligibility list or a student's page. Guardians acknowledge in the app; printed copies can be signed and filed."
      />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <Select name="ack" defaultValue={filters.ack ?? ''} className="w-56">
          <option value="">All</option><option value="pending">Not yet acknowledged</option><option value="done">Acknowledged</option>
        </Select>
        <Select name="division" defaultValue={filters.division ?? ''} className="w-44">
          <option value="">All divisions</option>
          {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <button className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white">Filter</button>
      </form>
      <Card>
        <Table>
          <THead><tr><TH>Issued</TH><TH>Student</TH><TH>Division</TH><TH>Level</TH><TH className="text-right">Attendance</TH><TH>Channel</TH><TH>Acknowledgement</TH><TH /></tr></THead>
          <tbody>
            {notices.length === 0 ? <EmptyRow colSpan={8}>No notices.</EmptyRow> : null}
            {notices.map((n) => (
              <TR key={n.id}>
                <TD className="text-sm">{formatDate(n.issued_at)}</TD>
                <TD><Link className="text-brand-700 hover:underline" href={`/people/students/${n.student.id}`}>{n.student.full_name}</Link></TD>
                <TD>{n.division.name}</TD>
                <TD><Badge tone={n.level === 'final' ? 'red' : n.level === 'second' ? 'amber' : 'blue'}>{n.level}</Badge></TD>
                <TD className="text-right"><Percent value={n.day_percent} /></TD>
                <TD className="text-sm">{n.channel}</TD>
                <TD className="text-sm">{n.acknowledged_at ? <span className="text-green-700">✓ {formatDateTime(n.acknowledged_at)}</span> : <Badge tone="amber">pending</Badge>}</TD>
                <TD><Link className="text-sm text-brand-700 hover:underline" href={`/eligibility/notices/${n.id}`}>Letter</Link></TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
