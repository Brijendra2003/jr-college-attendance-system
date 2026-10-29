import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';

export const YEAR_COOKIE = 'jcas_year';

export interface YearRow { id: string; label: string; starts_on: string; ends_on: string; status: 'planned' | 'active' | 'archived' }
export interface TermRow { id: string; academic_year_id: string; seq: 1 | 2; name: string; starts_on: string; ends_on: string }
export interface CollegeRow {
  name: string; name_mr: string | null; address: string | null; district: string | null; taluka: string | null;
  divisional_board: string; board_index_no: string | null; udise_code: string | null; management_type: string;
  is_minority: boolean; mediums: string[]; logo_url: string | null; setup_completed_at: string | null;
}

export const getCollege = cache(async (): Promise<CollegeRow | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from('college').select('*').maybeSingle();
  return data;
});

/** Academic context (year + its terms) chosen in the top bar, defaulting to the active year. */
export const getYearContext = cache(async () => {
  const supabase = await createClient();
  const [{ data: years }, store] = await Promise.all([
    supabase.from('academic_years').select('id, label, starts_on, ends_on, status').order('starts_on', { ascending: false }),
    cookies(),
  ]);
  const list = (years ?? []) as YearRow[];
  const chosen = store.get(YEAR_COOKIE)?.value;
  const year = list.find((y) => y.id === chosen) ?? list.find((y) => y.status === 'active') ?? list[0] ?? null;
  const { data: terms } = year
    ? await supabase.from('academic_terms').select('*').eq('academic_year_id', year.id).order('seq')
    : { data: [] };
  return { years: list, year, terms: (terms ?? []) as TermRow[] };
});

export interface DivisionRow {
  id: string; name: string; code: string; capacity: number; medium_code: string; shift_id: string | null;
  standard: { id: string; code: string; level: number }; stream: { id: string; code: string; name: string };
}

/** Divisions of the selected year with standard/stream labels, ordered for pickers. */
export const getDivisions = cache(async () => {
  const { year } = await getYearContext();
  if (!year) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('divisions')
    .select('id, name, code, capacity, medium_code, shift_id, standard:standards(id, code, level), stream:streams(id, code, name)')
    .eq('academic_year_id', year.id)
    .is('archived_at', null)
    .order('name');
  return asRows<DivisionRow>(data);
});
