/** Does a Postgres daterange literal such as "[2026-06-01,)" contain the ISO date? */
export function rangeContains(range: string | null | undefined, iso: string): boolean {
  const m = range?.match(/^([[(])([^,]*),([^\])]*)([\])])$/);
  if (!m) return false;
  const [, lb, lo, hi, ub] = m;
  const afterLo = !lo || (lb === '[' ? iso >= lo : iso > lo);
  const beforeHi = !hi || (ub === ']' ? iso <= hi : iso < hi);
  return afterLo && beforeHi;
}

/** Lower bound of a daterange literal. */
export const rangeStart = (range: string | null | undefined) => range?.match(/^[[(]([^,]*),/)?.[1] || null;

/** Exclusive upper bound of a daterange literal, or null when open-ended. */
export const rangeEnd = (range: string | null | undefined) => range?.match(/,([^\])]*)[\])]$/)?.[1] || null;
