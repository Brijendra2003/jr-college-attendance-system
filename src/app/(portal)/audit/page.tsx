import { requirePermission } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { Pager, pageParam, str } from '@/components/pager';
import { Card, EmptyRow, Input, PageHeader, Table, TD, TH, THead, TR } from '@/components/ui/primitives';
import { formatDateTime } from '@/shared/dates';

export const metadata = { title: 'Audit log' };
const SIZE = 50;

interface Row { id: number; actor_id: string | null; action: string; entity: string; entity_id: string | null; before: unknown; after: unknown; reason: string | null; created_at: string }

/** Append-only log of record changes, exports and administrative actions. */
export default async function AuditPage({ searchParams }: PageProps<'/audit'>) {
  await requirePermission('audit.view');
  const sp = await searchParams;
  const filters = { entity: str(sp.entity), action: str(sp.action), from: str(sp.from), to: str(sp.to) };
  const page = pageParam(sp.page);
  const supabase = await createClient();
  let q = supabase
    .from('audit_log')
    .select('id, actor_id, action, entity, entity_id, before, after, reason, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * SIZE, page * SIZE - 1);
  if (filters.entity) q = q.ilike('entity', `${filters.entity.replace(/[%_]/g, '')}%`);
  if (filters.action) q = q.eq('action', filters.action);
  if (filters.from) q = q.gte('created_at', filters.from);
  if (filters.to) q = q.lte('created_at', `${filters.to}T23:59:59+05:30`);
  const { data, count } = await q;
  // audit_log deliberately has no FK to profiles (append-only, survives account removal).
  const rows = asRows<Row>(data);
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
  const { data: actors } = actorIds.length ? await supabase.from('profiles').select('id, display_name').in('id', actorIds) : { data: [] };
  const actorName = new Map(asRows<{ id: string; display_name: string }>(actors).map((a) => [a.id, a.display_name]));

  return (
    <>
      <PageHeader title="Audit log" description="Append-only: attendance changes, month close, eligibility and condonation, notices, logins issued, enrollment changes, configuration and every personal-data export." />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <Input name="entity" defaultValue={filters.entity} placeholder="Entity (e.g. students, report:)" className="w-56" />
        <Input name="action" defaultValue={filters.action} placeholder="Action (update, export…)" className="w-48" />
        <Input type="date" name="from" defaultValue={filters.from} className="w-40" />
        <Input type="date" name="to" defaultValue={filters.to} className="w-40" />
        <button className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white">Filter</button>
      </form>
      <Card>
        <Table>
          <THead><tr><TH>When</TH><TH>Who</TH><TH>Action</TH><TH>Entity</TH><TH>Details</TH></tr></THead>
          <tbody>
            {!rows.length ? <EmptyRow colSpan={5}>No entries.</EmptyRow> : null}
            {rows.map((r) => (
              <TR key={r.id} className="align-top">
                <TD className="whitespace-nowrap text-sm">{formatDateTime(r.created_at)}</TD>
                <TD className="text-sm">{r.actor_id ? actorName.get(r.actor_id) ?? 'unknown user' : 'system'}</TD>
                <TD className="text-sm">{r.action}</TD>
                <TD className="text-sm">{r.entity}{r.entity_id ? <div className="font-mono text-xs text-gray-500">{r.entity_id.slice(0, 8)}</div> : null}</TD>
                <TD>
                  {r.reason ? <div className="text-sm">Reason: {r.reason}</div> : null}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-brand-700">before / after</summary>
                    <pre className="mt-1 max-h-60 max-w-xl overflow-auto rounded bg-gray-50 p-2">{JSON.stringify(diff(r.before, r.after), null, 2)}</pre>
                  </details>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
        <Pager page={page} total={count ?? 0} pageSize={SIZE} basePath="/audit" params={filters} />
      </Card>
    </>
  );
}

/** Show only changed keys for updates. */
function diff(before: unknown, after: unknown) {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return { before, after };
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k]) && k !== 'updated_at') out[k] = { from: b[k], to: a[k] };
  }
  return out;
}
