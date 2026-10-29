'use server';

import { z } from 'zod';
import { action, must } from '@/lib/auth/action';

export interface ImportResult {
  summary: { new: number; existing: number; error: number };
  rows: { row: number; outcome: 'new' | 'existing' | 'error'; errors: string[]; student_id: string | null }[];
}

/** Preview (commit = false) or commit a student / CAP list import. Idempotent on GR No., CAP no., SSC seat no. */
export const importStudents = action({
  permission: 'admissions.import',
  scopes: ['all'],
  schema: z.object({
    rows: z.array(z.record(z.string(), z.string().nullable().optional())).min(1).max(2000),
    commit: z.boolean(),
  }),
  async run({ input, supabase }) {
    return must(await supabase.rpc('import_students', { p_rows: input.rows, p_commit: input.commit })) as ImportResult;
  },
});
