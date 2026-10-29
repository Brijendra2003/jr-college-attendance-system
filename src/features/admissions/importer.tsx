'use client';

import { useState, useTransition } from 'react';
import Papa from 'papaparse';
import { importStudents, type ImportResult } from './actions';
import { Button } from '@/components/ui/button';
import { Badge, Notice, Table, TD, TH, THead, TR } from '@/components/ui/primitives';

/** Column aliases: template headers, common CAP-portal headings and plain-English variants. */
const ALIASES: Record<string, string> = {
  surname: 'surname', last_name: 'surname', first_name: 'first_name', name: 'first_name', student_first_name: 'first_name',
  father_name: 'father_name', fathers_name: 'father_name', middle_name: 'father_name', mother_name: 'mother_name', mothers_name: 'mother_name',
  name_marathi: 'name_mr', name_mr: 'name_mr', dob: 'dob', date_of_birth: 'dob', birth_date: 'dob', gender: 'gender', sex: 'gender',
  division: 'division', class: 'division', roll_no: 'roll_no', roll: 'roll_no', gr_no: 'gr_no', general_register_no: 'gr_no',
  cap_application_no: 'cap_application_no', application_no: 'cap_application_no', application_id: 'cap_application_no', form_no: 'cap_application_no',
  ssc_seat_no: 'ssc_seat_no', seat_no: 'ssc_seat_no', ssc_board: 'ssc_board', ssc_percent: 'ssc_percent', percentage: 'ssc_percent',
  admission_type: 'admission_type', quota: 'admission_type', admitted_on: 'admitted_on', admission_date: 'admitted_on',
  apaar_id: 'apaar_id', apaar: 'apaar_id', pen: 'pen', saral_id: 'saral_id',
  father_email: 'father_email', father_phone: 'father_phone', father_mobile: 'father_phone',
  mother_email: 'mother_email', mother_phone: 'mother_phone', mother_mobile: 'mother_phone',
  guardian_name: 'guardian_name', guardian_email: 'guardian_email', guardian_phone: 'guardian_phone',
};

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** dd-mm-yyyy / dd/mm/yyyy → yyyy-mm-dd; leaves ISO dates alone. */
const isoDate = (v: string) => {
  const m = v.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v.trim();
};

const QUOTA: Record<string, string> = { cap: 'cap', in_house: 'in_house', inhouse: 'in_house', management: 'management', minority: 'minority', transfer: 'transfer' };

function mapRows(raw: Record<string, string>[]) {
  return raw.map((r) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) {
      const key = ALIASES[norm(k)];
      if (key && v != null && String(v).trim() !== '') out[key] = String(v).trim();
    }
    if (out.dob) out.dob = isoDate(out.dob);
    if (out.admitted_on) out.admitted_on = isoDate(out.admitted_on);
    if (out.gender) out.gender = { m: 'male', f: 'female', male: 'male', female: 'female' }[out.gender.toLowerCase()] ?? out.gender.toLowerCase();
    if (out.admission_type) out.admission_type = QUOTA[norm(out.admission_type)] ?? 'cap';
    return out;
  });
}

export function StudentImporter() {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [committed, setCommitted] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onFile(file: File) {
    setPreview(null); setCommitted(null); setError(null); setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const mapped = mapRows(res.data);
        setRows(mapped);
        if (!mapped.length) return setError('No rows found. Is the first line a header row?');
        start(async () => {
          const r = await importStudents({ rows: mapped, commit: false });
          if (r.ok) setPreview(r.data); else setError(r.error);
        });
      },
      error: (e) => setError(e.message),
    });
  }

  const result = committed ?? preview;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center rounded-lg border border-dashed border-gray-400 bg-white px-4 py-3 text-sm hover:bg-gray-50">
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          {fileName || 'Choose a CSV file…'}
        </label>
        <a href="/api/templates/students" className="text-sm text-brand-700 underline">Download the template</a>
        {pending ? <span className="text-sm text-gray-500">Checking…</span> : null}
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {result ? (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge tone="green">{result.summary.new} new</Badge>
            <Badge tone="gray">{result.summary.existing} already admitted</Badge>
            <Badge tone="red">{result.summary.error} with errors</Badge>
            {committed ? <span className="font-medium text-green-700">Imported. Guardians were linked as pending: verify them and issue logins from Guardians.</span> : null}
          </div>
          {!committed ? (
            <div className="flex items-center gap-3">
              <Button
                disabled={pending || result.summary.new === 0}
                onClick={() => start(async () => {
                  const r = await importStudents({ rows, commit: true });
                  if (r.ok) setCommitted(r.data); else setError(r.error);
                })}
              >
                Import {result.summary.new} new student{result.summary.new === 1 ? '' : 's'}
              </Button>
              <span className="text-xs text-gray-500">Rows with errors are skipped; fix them and upload again. Re-uploading never duplicates students.</span>
            </div>
          ) : null}
          <div className="rounded-xl border border-gray-200 bg-white">
            <Table>
              <THead><tr><TH>Row</TH><TH>Student</TH><TH>Division</TH><TH>Outcome</TH><TH>Problems</TH></tr></THead>
              <tbody>
                {result.rows.map((r) => {
                  const src = rows[r.row - 1] ?? {};
                  return (
                    <TR key={r.row}>
                      <TD className="tabular-nums">{r.row + 1}</TD>
                      <TD>{[src.surname, src.first_name, src.father_name].filter(Boolean).join(' ')}</TD>
                      <TD>{src.division}</TD>
                      <TD><Badge tone={r.outcome === 'new' ? 'green' : r.outcome === 'existing' ? 'gray' : 'red'}>{r.outcome}</Badge></TD>
                      <TD className="text-xs text-red-700">{r.errors.join('; ')}</TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </>
      ) : null}
    </div>
  );
}
