import { requirePermission } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { getDivisions } from '@/features/academics/context';
import { createAnnouncement, publishAnnouncement } from '@/features/announcements/actions';
import { ActionButton } from '@/components/action-button';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, CardBody, CardHeader, EmptyRow, Field, Input, PageHeader, Select, StateBadge, Table, TD, TH, THead, TR, Textarea } from '@/components/ui/primitives';
import { formatDateTime } from '@/shared/dates';

export const metadata = { title: 'Announcements' };

interface Ann { id: string; title: string; title_mr: string | null; priority: string; scope: string; status: string; audience: { roles: string[] }; created_at: string; announcement_recipients: { count: number }[] }

export default async function AnnouncementsPage() {
  await requirePermission('announcements.college');
  const supabase = await createClient();
  const [{ data }, divisions, { data: streams }] = await Promise.all([
    supabase.from('announcements').select('id, title, title_mr, priority, scope, status, audience, created_at, announcement_recipients(count)').order('created_at', { ascending: false }).limit(100),
    getDivisions(),
    supabase.from('streams').select('id, name').eq('is_active', true).order('sort_order'),
  ]);
  const rows = asRows<Ann>(data);

  return (
    <>
      <PageHeader title="Announcements" description="Delivered in the app (and as push notifications) in each recipient's language. Parents default to Marathi, so add the Marathi text where you can." />
      <Card>
        <CardHeader title="New announcement" />
        <CardBody>
          <ActionForm action={createAnnouncement} submitLabel="Publish now" resetOnSuccess>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <Field label="Title (English)"><Input name="title" required maxLength={160} /></Field>
                <Field label="Message (English)"><Textarea name="body" rows={5} required /></Field>
              </div>
              <div className="space-y-4">
                <Field label="Title (Marathi)"><Input name="title_mr" className="deva" lang="mr" maxLength={160} /></Field>
                <Field label="Message (Marathi)"><Textarea name="body_mr" className="deva" lang="mr" rows={5} /></Field>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-gray-700">Audience</legend>
                {[['parent', 'Parents'], ['student', 'Students'], ['teacher', 'Teachers']].map(([v, l]) => (
                  <label key={v} className="flex items-center gap-2 text-sm"><input type="checkbox" name="audience_roles[]" value={v} defaultChecked={v === 'parent'} /> {l}</label>
                ))}
              </fieldset>
              <Field label="Streams" hint="None selected = all.">
                <select name="stream_ids[]" multiple className="block h-24 w-full rounded-lg border border-gray-300 px-2 text-sm">
                  {(streams ?? []).map((s: { id: string; name: string }) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Divisions" hint="None selected = all.">
                <select name="division_ids[]" multiple className="block h-24 w-full rounded-lg border border-gray-300 px-2 text-sm">
                  {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="Priority"><Select name="priority"><option value="normal">Normal</option><option value="high">High</option></Select></Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <Table>
          <THead><tr><TH>Created</TH><TH>Title</TH><TH>Audience</TH><TH className="text-right">Recipients</TH><TH>Status</TH><TH /></tr></THead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={6}>No announcements yet.</EmptyRow> : null}
            {rows.map((a) => (
              <TR key={a.id}>
                <TD className="whitespace-nowrap text-sm">{formatDateTime(a.created_at)}</TD>
                <TD>{a.title}{a.priority === 'high' ? <Badge tone="red" className="ml-2">high</Badge> : null}{a.title_mr ? <div className="deva text-xs text-gray-500" lang="mr">{a.title_mr}</div> : null}</TD>
                <TD className="text-sm capitalize">{a.audience.roles.join(', ')} · {a.scope}</TD>
                <TD className="text-right tabular-nums">{a.announcement_recipients[0]?.count ?? 0}</TD>
                <TD><StateBadge state={a.status} /></TD>
                <TD>{a.status === 'draft' ? <ActionButton action={publishAnnouncement} payload={{ id: a.id }} label="Publish" /> : null}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
