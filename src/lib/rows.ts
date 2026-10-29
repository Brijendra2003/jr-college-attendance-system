// supabase-js infers embedded relations from the select string; until `npm run db:types` has
// generated real types, cast query results to the row shapes each feature declares.
export const asRows = <T>(data: unknown): T[] => (data ?? []) as T[];
export const asRow = <T>(data: unknown): T | null => (data ?? null) as T | null;
