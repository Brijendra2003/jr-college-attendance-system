import { requirePermission } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { getDivisions, getYearContext } from '@/features/academics/context';
import { declareHoliday, deleteCalendarEvent } from '@/features/academics/actions';
import { CalendarEventForm, EVENT_KINDS } from '@/features/academics/forms';
import { ActionButton } from '@/components/action-button';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, CardBody, CardHeader, Field, Input, Notice, PageHeader, Select, Table, TD, TH, THead, TR } from '@/components/ui/primitives';
import { formatDate, todayIST } from '@/shared/dates';

export const metadata = { title: 'Academic calendar' };

interface Ev { id: string; kind: string; title: string; title_mr: string | null; starts_on: string; ends_on: string; division_ids: string[] | null }

export default async function CalendarPage() {
  await requirePermission('calendar.manage');
  const { year, terms } = await getYearContext();
  if (!year) return <Notice tone="warn">Create an academic year first.</Notice>;
  const supabase = await createClient();
  const [{ data }, divisions] = await Promise.all([
    supabase.from('academic_calendar_events').select('*').eq('academic_year_id', year.id).order('starts_on'),
    getDivisions(),
  ]);
  const events = asRows<Ev>(data);
  const kindLabel = Object.fromEntries(EVENT_KINDS);
  const divName = new Map(divisions.map((d) => [d.id, d.name]));
  const today = todayIST();

  return (
    <>
      <PageHeader
        title="Academic calendar"
        description={`A day is a working day when it falls in a term, is not a Sunday and no holiday or vacation covers it. ${terms.map((t) => `${t.name}: ${formatDate(t.starts_on)} – ${formatDate(t.ends_on)}`).join(' · ')}`}
      />

      <Card>
        <CardHeader title="Declare a holiday after the fact" description="For rain or emergency closures. Voids that day's roll-calls and period registers, removes the day from working days and notifies affected users." />
        <CardBody>
          <ActionForm action={declareHoliday} submitLabel="Declare holiday" resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Date"><Input type="date" name="date" max={today} required /></Field>
              <Field label="Title"><Input name="title" placeholder="Heavy rain holiday" required /></Field>
              <Field label="Type">
                <Select name="kind" defaultValue="emergency_holiday">
                  <option value="emergency_holiday">Emergency / rain</option>
                  <option value="college_holiday">College holiday</option>
                  <option value="public_holiday">Public holiday</option>
                </Select>
              </Field>
              <Field label="Divisions" hint="Leave empty for the whole college.">
                <select name="divisionIds[]" multiple className="block h-24 w-full rounded-lg border border-gray-300 px-2 text-sm">
                  {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Add holidays, vacations and exam blocks" description="Plan ahead: session generation, working-day counts and 'days remaining' all read this calendar." />
        <CardBody><CalendarEventForm yearId={year.id} /></CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title={`${year.label} calendar (${events.length})`} />
        <Table>
          <THead><tr><TH>Dates</TH><TH>Event</TH><TH>Type</TH><TH>Applies to</TH><TH /></tr></THead>
          <tbody>
            {events.map((e) => (
              <TR key={e.id}>
                <TD className="whitespace-nowrap">{e.starts_on === e.ends_on ? formatDate(e.starts_on) : `${formatDate(e.starts_on)} – ${formatDate(e.ends_on)}`}</TD>
                <TD>{e.title}{e.title_mr ? <span className="deva ml-2 text-gray-500" lang="mr">{e.title_mr}</span> : null}</TD>
                <TD><Badge tone={e.kind === 'working_override' ? 'green' : e.kind.includes('holiday') || e.kind === 'vacation' ? 'amber' : 'gray'}>{kindLabel[e.kind] ?? e.kind}</Badge></TD>
                <TD>{e.division_ids?.length ? e.division_ids.map((id) => divName.get(id) ?? '?').join(', ') : 'Whole college'}</TD>
                <TD className="text-right">
                  {e.starts_on > today || e.kind === 'event' || e.kind === 'exam_block' ? (
                    <ActionButton action={deleteCalendarEvent} payload={{ id: e.id }} label="Remove" variant="ghost" confirm="Remove this calendar entry?" />
                  ) : null}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
