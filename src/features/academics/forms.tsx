import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/primitives';
import { SITE } from '@/lib/site';
import type { CollegeRow } from './context';
import { addCalendarEvent, createAcademicYear, createDivisions, createShift, saveCollege } from './actions';

const BOARDS = [
  ['pune', 'Pune'], ['mumbai', 'Mumbai'], ['nagpur', 'Nagpur'], ['chh_sambhajinagar', 'Chh. Sambhajinagar'],
  ['kolhapur', 'Kolhapur'], ['amravati', 'Amravati'], ['nashik', 'Nashik'], ['latur', 'Latur'], ['konkan', 'Konkan'],
] as const;
const MANAGEMENT = [
  ['government', 'Government'], ['aided', 'Aided'], ['partially_aided', 'Partially aided'], ['unaided', 'Unaided'], ['self_financed', 'Self-financed'],
] as const;
export const MEDIUMS = [['en', 'English'], ['mr', 'Marathi'], ['hi', 'Hindi'], ['ur', 'Urdu']] as const;

export function CollegeForm({ college }: { college: CollegeRow | null }) {
  return (
    <ActionForm action={saveCollege} submitLabel="Save college profile">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="College name (English)"><Input name="name" defaultValue={college?.name ?? SITE.collegeName} required /></Field>
        <Field label="College name (Marathi)"><Input name="name_mr" className="deva" lang="mr" defaultValue={college?.name_mr ?? ''} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input name="address" defaultValue={college?.address ?? ''} /></Field>
        <Field label="District"><Input name="district" defaultValue={college?.district ?? ''} /></Field>
        <Field label="Taluka"><Input name="taluka" defaultValue={college?.taluka ?? ''} /></Field>
        <Field label="Divisional board">
          <Select name="divisional_board" defaultValue={college?.divisional_board ?? 'pune'}>
            {BOARDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Junior college index no." hint="As printed on board correspondence."><Input name="board_index_no" defaultValue={college?.board_index_no ?? ''} /></Field>
        <Field label="UDISE code"><Input name="udise_code" defaultValue={college?.udise_code ?? ''} /></Field>
        <Field label="Management type">
          <Select name="management_type" defaultValue={college?.management_type ?? 'aided'}>
            {MANAGEMENT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-gray-700">Mediums offered</legend>
        <div className="flex flex-wrap gap-4">
          {MEDIUMS.map(([v, l]) => (
            <label key={v} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="mediums[]" value={v} defaultChecked={college ? college.mediums.includes(v) : v === 'en'} /> {l}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_minority" defaultChecked={college?.is_minority ?? false} /> Minority institution
      </label>
    </ActionForm>
  );
}

export function YearForm() {
  return (
    <ActionForm action={createAcademicYear} submitLabel="Create academic year" resetOnSuccess>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Label" hint="e.g. 2026-27"><Input name="label" placeholder="2026-27" required pattern="\d{4}-\d{2}" /></Field>
        <Field label="Year starts (first term)"><Input type="date" name="starts_on" required /></Field>
        <Field label="First term ends" hint="Usually just before Diwali."><Input type="date" name="term1_ends_on" required /></Field>
        <Field label="Second term starts" hint="After the Diwali vacation."><Input type="date" name="term2_starts_on" required /></Field>
        <Field label="Year ends (second term)"><Input type="date" name="ends_on" required /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="activate" /> Make this the active year</label>
      </div>
    </ActionForm>
  );
}

export function ShiftForm() {
  return (
    <ActionForm action={createShift} submitLabel="Add shift" resetOnSuccess>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name"><Input name="name" placeholder="Morning" required /></Field>
        <Field label="Starts"><Input type="time" name="starts_at" defaultValue="07:30" required /></Field>
        <Field label="Ends"><Input type="time" name="ends_at" defaultValue="13:00" required /></Field>
      </div>
    </ActionForm>
  );
}

export function DivisionsForm({
  yearId, standards, streams, shifts,
}: {
  yearId: string;
  standards: { id: string; code: string; label: string }[];
  streams: { id: string; code: string; name: string }[];
  shifts: { id: string; name: string }[];
}) {
  return (
    <ActionForm action={createDivisions} submitLabel="Create divisions" extra={{ academic_year_id: yearId }}>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Standard">
          <Select name="standard_id">{standards.map((s) => <option key={s.id} value={s.id}>{s.code} ({s.label})</option>)}</Select>
        </Field>
        <Field label="Stream">
          <Select name="stream_id">{streams.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </Field>
        <Field label="Medium">
          <Select name="medium_code">{MEDIUMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
        <Field label="How many" hint="Codes A, B, C…"><Input type="number" name="count" min={1} max={20} defaultValue={1} /></Field>
        <Field label="Capacity"><Input type="number" name="capacity" min={1} max={250} defaultValue={120} /></Field>
        <Field label="Shift">
          <Select name="shift_id" defaultValue={shifts[0]?.id ?? ''}>
            <option value="">–</option>
            {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      </div>
    </ActionForm>
  );
}

export const EVENT_KINDS = [
  ['public_holiday', 'Public holiday'], ['college_holiday', 'College holiday'], ['emergency_holiday', 'Emergency / rain holiday'],
  ['vacation', 'Vacation'], ['exam_block', 'Exam block'], ['event', 'Event (no effect on working days)'],
  ['working_override', 'Working-day override (e.g. make-up Sunday)'],
] as const;

export function CalendarEventForm({ yearId }: { yearId: string }) {
  return (
    <ActionForm action={addCalendarEvent} submitLabel="Add to calendar" extra={{ academic_year_id: yearId }} resetOnSuccess>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Type">
          <Select name="kind">{EVENT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
        <Field label="Title"><Input name="title" required placeholder="Diwali vacation" /></Field>
        <Field label="Title (Marathi)"><Input name="title_mr" className="deva" lang="mr" placeholder="दिवाळी सुट्टी" /></Field>
        <Field label="From"><Input type="date" name="starts_on" required /></Field>
        <Field label="To"><Input type="date" name="ends_on" required /></Field>
      </div>
    </ActionForm>
  );
}
