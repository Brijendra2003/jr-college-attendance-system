'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitDayRegister, type SubmitResult } from './actions';
import type { RosterStudent } from './queries';
import { Button } from '@/components/ui/button';
import { Badge, Notice } from '@/components/ui/primitives';
import { applyAbsentees } from '@/shared/attendance';
import { statusColors } from '@/shared/tokens';
import { cn } from '@/lib/cn';

interface Code { code: string; label: string; label_mr: string; color: string; teacher_can_set: boolean }

export function RollCallSheet({
  divisionId, date, baseVersion, students, codes, defaultUnmarked = 'A',
}: {
  divisionId: string;
  date: string;
  baseVersion: number;
  students: RosterStudent[];
  codes: Code[];
  defaultUnmarked?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [marks, setMarks] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(students.map((s) => [s.student_id, s.current_status ?? s.suggested_status ?? null])),
  );
  const [mode, setMode] = useState<'keypad' | 'list'>(students.length > 60 ? 'keypad' : 'list');
  const [keypad, setKeypad] = useState('');
  const [unknown, setUnknown] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  // One idempotency key per Submit tap; reused if the same submission is retried.
  const submissionId = useRef<string | null>(null);

  const colorOf = (code: string) => codes.find((c) => c.code === code)?.color ?? statusColors[code] ?? '#6b7280';
  const counts = useMemo(() => {
    const c: Record<string, number> = { pending: 0 };
    for (const v of Object.values(marks)) c[v ?? 'pending'] = (c[v ?? 'pending'] ?? 0) + 1;
    return c;
  }, [marks]);
  const absentRolls = students.filter((s) => marks[s.student_id] === 'A').map((s) => s.roll_no ?? '?');

  function set(id: string, code: string | null) {
    submissionId.current = null;
    setMarks((m) => ({ ...m, [id]: code }));
  }

  function applyKeypad() {
    const { absent, unknown: bad } = applyAbsentees(keypad, students.map((s) => ({ rollNo: s.roll_no, studentId: s.student_id })));
    setUnknown(bad);
    submissionId.current = null;
    setMarks(() =>
      Object.fromEntries(
        students.map((s) => {
          if (absent.has(s.student_id)) return [s.student_id, 'A'];
          // Approved leave stays as leave unless the teacher typed the roll number; actual presence still wins in list mode.
          if (s.suggested_status) return [s.student_id, s.suggested_status];
          return [s.student_id, 'P'];
        }),
      ),
    );
  }

  function submit() {
    submissionId.current ??= crypto.randomUUID();
    const records = Object.entries(marks)
      .filter(([, v]) => v)
      .map(([student_id, status]) => ({ student_id, status: status as 'P' }));
    start(async () => {
      const res = await submitDayRegister({ divisionId, date, clientSubmissionId: submissionId.current!, baseVersion, records });
      setConfirming(false);
      if (!res.ok) return setResult({ ok: false, text: res.error });
      const data = res.data as SubmitResult;
      setResult({ ok: data.result === 'ok' || data.result === 'duplicate', text: res.message ?? data.result });
      if (data.result === 'ok' || data.result === 'duplicate' || data.result === 'conflict') {
        submissionId.current = null;
        router.refresh();
      }
    });
  }

  const settable = codes.filter((c) => c.teacher_can_set || c.code === 'L' || c.code === 'ML');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-sm">
          {(['keypad', 'list'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={cn('rounded-md px-3 py-1', mode === m ? 'bg-gray-900 text-white' : 'text-gray-700')}>
              {m === 'keypad' ? 'Absentee keypad' : 'List'}
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={() => {
          submissionId.current = null;
          setMarks(Object.fromEntries(students.map((s) => [s.student_id, marks[s.student_id] ?? s.suggested_status ?? 'P'])));
        }}>Mark unmarked as present</Button>
        <div className="ml-auto flex flex-wrap gap-2 text-sm" aria-live="polite">
          {Object.entries(counts).filter(([, n]) => n).map(([k, n]) => (
            <Badge key={k} tone={k === 'pending' ? 'amber' : k === 'A' ? 'red' : k === 'P' ? 'green' : 'blue'}>{k === 'pending' ? 'Pending' : k} {n}</Badge>
          ))}
        </div>
      </div>

      {mode === 'keypad' ? (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <label className="text-sm font-medium text-gray-700" htmlFor="absentees">Type the roll numbers of absent students</label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id="absentees"
              value={keypad}
              onChange={(e) => setKeypad(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), applyKeypad())}
              inputMode="numeric"
              placeholder="e.g. 3 17 45 102"
              className="h-11 min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 font-mono text-lg tracking-wide"
            />
            <Button onClick={applyKeypad}>Apply: everyone else present</Button>
          </div>
          {unknown.length ? <p className="mt-2 text-sm text-red-700">Not on this roster: {unknown.join(', ')}</p> : null}
          <p className="mt-2 text-xs text-gray-500">Students on approved leave keep their leave status. Switch to List to fine-tune half days or on-duty.</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {students.map((s) => {
          const v = marks[s.student_id];
          return (
            <div key={s.student_id} className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2">
              <span className="w-9 text-right font-mono text-sm tabular-nums text-gray-500">{s.roll_no ?? '–'}</span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {s.name}
                {s.is_new ? <Badge tone="blue" className="ml-2">New</Badge> : null}
                {s.suggested_status ? <Badge tone="violet" className="ml-2">On leave</Badge> : null}
              </span>
              <div className="flex gap-1" role="radiogroup" aria-label={`Roll ${s.roll_no}, ${s.name}`}>
                {settable.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    role="radio"
                    aria-checked={v === c.code}
                    title={c.label}
                    onClick={() => set(s.student_id, v === c.code ? null : c.code)}
                    className="h-7 min-w-8 rounded-md px-1.5 text-xs font-semibold"
                    style={v === c.code ? { background: colorOf(c.code), color: '#fff' } : { color: colorOf(c.code), boxShadow: `inset 0 0 0 1px ${colorOf(c.code)}55` }}
                  >
                    {c.code}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {result ? <Notice tone={result.ok ? 'ok' : 'danger'}>{result.text}</Notice> : null}

      {confirming ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium">Submit roll-call for {students.length} students?</p>
          <p className="mt-1">Absent ({absentRolls.length}): <span className="font-mono">{absentRolls.join(', ') || 'none'}</span></p>
          {counts.pending ? <p className="mt-1 text-amber-800">{counts.pending} unmarked student(s) will be recorded as <strong>{defaultUnmarked}</strong> under college policy.</p> : null}
          <div className="mt-3 flex gap-2">
            <Button onClick={submit} disabled={pending}>{pending ? 'Submitting…' : 'Confirm and submit'}</Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Back</Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setConfirming(true)} disabled={pending}>Review and submit</Button>
      )}
    </div>
  );
}
