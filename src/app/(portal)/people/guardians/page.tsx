import Link from 'next/link';
import { can, requirePermission } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { sanitizeSearch } from '@/features/people/queries';
import { setGuardianLink } from '@/features/people/actions';
import { IssueLoginButton } from '@/features/people/issue-login-button';
import { ActionButton } from '@/components/action-button';
import { Pager, pageParam, str } from '@/components/pager';
import { Badge, Card, EmptyRow, Input, Notice, PageHeader, Select, StateBadge, Table, TD, TH, THead, TR } from '@/components/ui/primitives';

export const metadata = { title: 'Guardians & logins' };
const SIZE = 50;

interface G {
  id: string; full_name: string; relation: string; email: string | null; phone: string | null; user_id: string | null; preferred_language: string;
  guardian_links: { id: string; status: string; student: { id: string; full_name: string; gr_no: string } }[];
}

export default async function GuardiansPage({ searchParams }: PageProps<'/people/guardians'>) {
  const viewer = await requirePermission('guardians.manage');
  const sp = await searchParams;
  const filters = { q: str(sp.q), login: str(sp.login), link: str(sp.link) };
  const page = pageParam(sp.page);
  const supabase = await createClient();

  let query = supabase
    .from('guardians')
    .select('id, full_name, relation, email, phone, user_id, preferred_language, guardian_links!inner(id, status, student:students(id, full_name, gr_no))', { count: 'exact' })
    .order('full_name')
    .range((page - 1) * SIZE, page * SIZE - 1);
  if (filters.login === 'pending') query = query.is('user_id', null).eq('guardian_links.status', 'verified');
  if (filters.login === 'issued') query = query.not('user_id', 'is', null);
  if (filters.link) query = query.eq('guardian_links.status', filters.link);
  const q = filters.q ? sanitizeSearch(filters.q) : '';
  if (q) query = query.or(`full_name.ilike.*${q}*,email.ilike.*${q}*,phone.ilike.*${q}*`);
  const { data, count } = await query;
  const rows = asRows<G>(data);
  const canIssue = can(viewer, 'accounts.issue', 'all');

  return (
    <>
      <PageHeader
        title="Guardians & app logins"
        description="Verify each link against the admission form, then issue the parent's login: their email is the username and a generated password is handed over on a slip. There is no SMS or OTP sign-in, and knowing a GR No. never grants access."
      />
      <Notice>
        Parents without an email address: help them create one at the parents&apos; meeting, or record a family email. (Decision 9 in the architecture document is still open.)
      </Notice>

      <form method="get" className="my-4 flex flex-wrap items-end gap-3">
        <Input name="q" defaultValue={filters.q} placeholder="Name, email or phone" className="w-64" />
        <Select name="link" defaultValue={filters.link ?? ''} className="w-44">
          <option value="">Any link status</option><option value="pending">Pending verification</option><option value="verified">Verified</option><option value="revoked">Revoked</option>
        </Select>
        <Select name="login" defaultValue={filters.login ?? ''} className="w-48">
          <option value="">Any login state</option><option value="pending">Verified, no login yet</option><option value="issued">Login issued</option>
        </Select>
        <button className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white">Filter</button>
      </form>

      <Card>
        <Table>
          <THead><tr><TH>Guardian</TH><TH>Contact</TH><TH>Children</TH><TH>Login</TH></tr></THead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={4}>No guardians match.</EmptyRow> : null}
            {rows.map((g) => (
              <TR key={g.id}>
                <TD>
                  <div className="font-medium">{g.full_name}</div>
                  <div className="text-xs capitalize text-gray-500">{g.relation} · prefers {g.preferred_language.toUpperCase()}</div>
                </TD>
                <TD className="text-sm">
                  <div>{g.email ?? <Badge tone="amber">no email</Badge>}</div>
                  <div className="text-gray-500">{g.phone ?? ''}</div>
                </TD>
                <TD>
                  <ul className="space-y-1.5">
                    {g.guardian_links.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <Link className="text-brand-700 hover:underline" href={`/people/students/${l.student.id}`}>{l.student.full_name}</Link>
                        <span className="text-xs text-gray-500">GR {l.student.gr_no}</span>
                        <StateBadge state={l.status} />
                        {l.status === 'pending' ? <ActionButton action={setGuardianLink} payload={{ linkId: l.id, status: 'verified' }} label="Verify" /> : null}
                      </li>
                    ))}
                  </ul>
                </TD>
                <TD>
                  {canIssue && g.guardian_links.some((l) => l.status === 'verified') ? (
                    <IssueLoginButton kind="guardian" id={g.id} name={g.full_name} hasLogin={Boolean(g.user_id)} />
                  ) : g.user_id ? <Badge tone="green">issued</Badge> : <span className="text-xs text-gray-500">verify a link first</span>}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
        <Pager page={page} total={count ?? 0} pageSize={SIZE} basePath="/people/guardians" params={filters} />
      </Card>
    </>
  );
}
