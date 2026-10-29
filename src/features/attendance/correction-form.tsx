'use client';

import { requestCorrection } from './actions';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select } from '@/components/ui/primitives';

/** Request a correction for one student on a locked / closed register. */
export function CorrectionForm({ kind, registerId, students, codes }: {
  kind: 'day' | 'period';
  registerId: string;
  students: { student_id: string; roll_no: string | null; name: string; current_status: string | null }[];
  codes: { code: string; label: string }[];
}) {
  return (
    <ActionForm
      action={async (raw: { student_id: string; status: string; reason: string }) =>
        requestCorrection({ kind, registerId, reason: raw.reason, records: [{ student_id: raw.student_id, status: raw.status }] })}
      submitLabel="Request correction"
      resetOnSuccess
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Student">
          <Select name="student_id">
            {students.map((s) => <option key={s.student_id} value={s.student_id}>{s.roll_no ?? '–'} · {s.name} ({s.current_status ?? 'unmarked'})</option>)}
          </Select>
        </Field>
        <Field label="Correct status">
          <Select name="status">{codes.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}</Select>
        </Field>
        <Field label="Reason" hint="Kept in the audit trail and shown to the approver."><Input name="reason" required minLength={3} /></Field>
      </div>
    </ActionForm>
  );
}
