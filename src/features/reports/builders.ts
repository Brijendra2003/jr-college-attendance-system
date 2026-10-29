import 'server-only';
import type { ServerClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { rangeContains } from '@/lib/ranges';
import { getMuster } from '@/features/attendance/queries';
import { getEligibility } from '@/features/eligibility/queries';
import { percent } from '@/shared/attendance';
import { formatMonth, todayIST } from '@/shared/dates';
import type { Permission } from '@/shared/permissions';

export interface Sheet {
  title: string;
  columns: { header: string; key: string; width?: number }[];
  rows: Record<string, string | number | null>[];
}

export interface ReportDef {
  label: string;
  permission: Permission;
  /** Government-format export: logged in govt_exports. */
  govt?: string;
  build: (ctx: { supabase: ServerClient; params: URLSearchParams; yearId: string }) => Promise<Sheet>;
}

async function termIds(supabase: ServerClient, yearId: string) {
  const { data } = await supabase.from('academic_terms').select('id, seq').eq('academic_year_id', yearId).order('seq');
  return asRows<{ id: string; seq: number }>(data);
}

export const REPORTS: Record<string, ReportDef> = {
  muster: {
    label: 'Monthly muster',
    permission: 'reports.export',
    async build({ params, yearId }) {
      const division = params.get('division') ?? '';
      const month = params.get('month') ?? todayIST();
      const m = await getMuster(division, month, yearId);
      if (!m) throw new Error('NOT_FOUND');
      const days = m.days.filter((d) => d.working).map((d) => d.date);
      return {
        title: `${m.division.name} ${formatMonth(m.month)}`,
        columns: [
          { header: 'Roll', key: 'roll', width: 6 }, { header: 'Name', key: 'name', width: 32 },
          ...days.map((d) => ({ header: d.slice(8), key: d, width: 4 })),
          { header: 'Present (month)', key: 'p', width: 10 }, { header: 'Working (month)', key: 'w', width: 10 },
          { header: 'Present (to date)', key: 'tp', width: 10 }, { header: 'Working (to date)', key: 'tw', width: 10 }, { header: '% to date', key: 'pct', width: 9 },
        ],
        rows: m.students.map((s) => ({
          roll: s.roll_no, name: s.name, ...Object.fromEntries(days.map((d) => [d, s.marks[d] ?? ''])),
          p: s.present, w: s.working, tp: s.toDatePresent, tw: s.toDateWorking, pct: percent(s.toDatePresent, s.toDateWorking),
        })),
      };
    },
  },

  eligibility: {
    label: 'Eligibility / defaulter list',
    permission: 'reports.export',
    async build({ params, yearId }) {
      const kind = params.get('kind') === 'final' ? 'final' : 'projected';
      const { asOf, rows } = await getEligibility(yearId, { kind, divisionId: params.get('division') ?? undefined });
      return {
        title: `Eligibility ${kind} ${asOf ?? ''}`,
        columns: [
          { header: 'GR No.', key: 'gr', width: 10 }, { header: 'Name', key: 'name', width: 32 }, { header: 'Division', key: 'div', width: 12 },
          { header: 'Term 1 %', key: 't1' }, { header: 'Term 2 %', key: 't2' }, { header: 'Year %', key: 'yr' },
          { header: 'Working days', key: 'wd' }, { header: 'Present', key: 'pv' }, { header: 'Days needed', key: 'dn' },
          { header: 'Status', key: 'st', width: 18 }, { header: 'Subjects below minimum', key: 'subj', width: 40 },
        ],
        rows: rows.map((r) => ({
          gr: r.student.gr_no, name: r.student.full_name, div: r.division?.name ?? '', t1: r.term1_percent, t2: r.term2_percent,
          yr: r.annual_percent, wd: r.working_days, pv: Number(r.present_value), dn: r.days_needed, st: r.status,
          subj: r.subject_results.map((s) => `${s.subject} ${s.component} ${s.percent}%`).join('; '),
        })),
      };
    },
  },

  'day-summary': {
    label: 'Day attendance summary (students × terms)',
    permission: 'reports.export',
    async build({ supabase, params, yearId }) {
      const terms = await termIds(supabase, yearId);
      let q = supabase
        .from('student_enrollments')
        .select('roll_no, valid_during, division:divisions(id, name), student:students(id, gr_no, full_name, day_attendance_summaries(term_id, working_days, present_value, percent))')
        .eq('academic_year_id', yearId);
      if (params.get('division')) q = q.eq('division_id', params.get('division'));
      const { data } = await q;
      const today = todayIST();
      type Enr = { roll_no: string | null; valid_during: string; division: { name: string }; student: { id: string; gr_no: string; full_name: string; day_attendance_summaries: { term_id: string; working_days: number; present_value: number; percent: number | null }[] } };
      // One row per student: the current enrollment, else the latest (left / transferred students).
      const byStudent = new Map<string, Enr>();
      for (const e of asRows<Enr>(data)) {
        const prev = byStudent.get(e.student.id);
        if (!prev || rangeContains(e.valid_during, today) || (!rangeContains(prev.valid_during, today) && e.valid_during > prev.valid_during)) byStudent.set(e.student.id, e);
      }
      const rows = [...byStudent.values()]
        .map((e) => {
          const t = (seq: number) => e.student.day_attendance_summaries.find((s) => s.term_id === terms.find((x) => x.seq === seq)?.id);
          const w = (t(1)?.working_days ?? 0) + (t(2)?.working_days ?? 0);
          const p = Number(t(1)?.present_value ?? 0) + Number(t(2)?.present_value ?? 0);
          return { div: e.division.name, roll: e.roll_no, gr: e.student.gr_no, name: e.student.full_name, t1: t(1)?.percent ?? null, t2: t(2)?.percent ?? null, w, p, yr: percent(p, w) };
        })
        .sort((a, b) => a.div.localeCompare(b.div) || (Number(a.roll) || 0) - (Number(b.roll) || 0));
      return {
        title: 'Day attendance summary',
        columns: [
          { header: 'Division', key: 'div', width: 12 }, { header: 'Roll', key: 'roll', width: 6 }, { header: 'GR No.', key: 'gr', width: 10 },
          { header: 'Name', key: 'name', width: 32 }, { header: 'Term 1 %', key: 't1' }, { header: 'Term 2 %', key: 't2' },
          { header: 'Working days', key: 'w' }, { header: 'Present', key: 'p' }, { header: 'Year %', key: 'yr' },
        ],
        rows,
      };
    },
  },

  readiness: {
    label: 'Government ID readiness (APAAR / PEN / Saral / consent)',
    permission: 'govt.export',
    govt: 'readiness',
    async build({ supabase }) {
      const { data } = await supabase
        .from('students')
        .select('gr_no, full_name, dob, apaar_id, pen, saral_id, consents(purpose, withdrawn_at), student_enrollments(valid_during, division:divisions(name))')
        .eq('status', 'active')
        .order('full_name');
      const today = todayIST();
      return {
        title: 'ID readiness',
        columns: [
          { header: 'GR No.', key: 'gr' }, { header: 'Name', key: 'name', width: 32 }, { header: 'Division', key: 'div' }, { header: 'DOB', key: 'dob' },
          { header: 'APAAR', key: 'apaar', width: 14 }, { header: 'PEN', key: 'pen', width: 14 }, { header: 'Saral ID', key: 'saral', width: 22 },
          { header: 'APAAR consent', key: 'ac' }, { header: 'Missing', key: 'missing', width: 30 },
        ],
        rows: asRows<{ gr_no: string; full_name: string; dob: string | null; apaar_id: string | null; pen: string | null; saral_id: string | null; consents: { purpose: string; withdrawn_at: string | null }[]; student_enrollments: { valid_during: string; division: { name: string } }[] }>(data).map((s) => {
          const apaarConsent = s.consents.some((c) => c.purpose === 'apaar' && !c.withdrawn_at);
          const missing = [!s.apaar_id && 'APAAR', !s.pen && 'PEN', !s.saral_id && 'Saral', !apaarConsent && 'APAAR consent'].filter(Boolean).join(', ');
          return {
            gr: s.gr_no, name: s.full_name, div: s.student_enrollments.find((e) => rangeContains(e.valid_during, today))?.division.name ?? '',
            dob: s.dob, apaar: s.apaar_id, pen: s.pen, saral: s.saral_id, ac: apaarConsent ? 'yes' : 'no', missing,
          };
        }),
      };
    },
  },

  mahadbt: {
    label: 'MahaDBT scholarship attendance',
    permission: 'govt.export',
    govt: 'mahadbt',
    async build({ supabase, yearId, params }) {
      const min = Number(params.get('min') ?? 75);
      const terms = await termIds(supabase, yearId);
      const { data } = await supabase
        .from('students')
        .select('gr_no, full_name, saral_id, student_sensitive(scholarship_flags), day_attendance_summaries(term_id, working_days, present_value)')
        .eq('status', 'active')
        .order('full_name');
      return {
        title: 'MahaDBT attendance',
        columns: [
          { header: 'GR No.', key: 'gr' }, { header: 'Name', key: 'name', width: 32 }, { header: 'Saral ID', key: 'saral', width: 22 },
          { header: 'Scholarship ID', key: 'sid', width: 20 }, { header: 'Working days', key: 'w' }, { header: 'Present days', key: 'p' },
          { header: 'Attendance %', key: 'pct' }, { header: `Eligible (≥${min}%)`, key: 'ok' },
        ],
        rows: asRows<{ gr_no: string; full_name: string; saral_id: string | null; student_sensitive: { scholarship_flags: Record<string, string> } | null; day_attendance_summaries: { term_id: string; working_days: number; present_value: number }[] }>(data).map((s) => {
          const mine = s.day_attendance_summaries.filter((d) => terms.some((t) => t.id === d.term_id));
          const w = mine.reduce((n, d) => n + d.working_days, 0);
          const p = mine.reduce((n, d) => n + Number(d.present_value), 0);
          const pct = percent(p, w);
          return {
            gr: s.gr_no, name: s.full_name, saral: s.saral_id, sid: s.student_sensitive?.scholarship_flags?.mahadbt_id ?? '',
            w, p, pct, ok: pct !== null && pct >= min ? 'Yes' : 'No',
          };
        }),
      };
    },
  },
};
