// Attendance maths (web doc §9.4). The SQL in migration 0007 (app.days_needed,
// app.classify_eligibility) implements the same rules; both are tested on ELIGIBILITY_FIXTURES.
// SHARED: synced to the mobile app for instant previews ("attend the next 6 working days").

export const ELIGIBILITY_STATUSES = [
  'eligible', 'at_risk', 'short', 'condonation_pending', 'condoned', 'not_eligible',
] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

export const DAY_STATUS_CODES = ['P', 'A', 'HD', 'L', 'ML', 'OD', 'SP'] as const;
export const PERIOD_STATUS_CODES = ['P', 'A', 'LT', 'L', 'ML', 'OD'] as const;
export type DayStatusCode = (typeof DAY_STATUS_CODES)[number];
export type PeriodStatusCode = (typeof PERIOD_STATUS_CODES)[number];

/** Percentage rounded to 2 dp; null when nothing has been held yet. */
export function percent(attended: number, held: number): number | null {
  if (held <= 0) return null;
  return Math.round((attended * 100 * 100) / held) / 100;
}

/**
 * Consecutive full days (or lectures) of attendance needed to reach `min` percent.
 * needed = ceil((min × held − 100 × attended) / (100 − min)), never negative.
 */
export function daysNeeded(attended: number, held: number, min: number): number {
  if (min >= 100) return Number.POSITIVE_INFINITY;
  // Round away floating-point noise before ceil (e.g. 7.000000000001).
  const raw = (min * held - 100 * attended) / (100 - min);
  return Math.max(0, Math.ceil(Math.round(raw * 1e9) / 1e9));
}

export interface EligibilityInput {
  present: number;
  working: number;
  /** Working days still to come in the year (0 for a final evaluation). */
  remaining: number;
  min: number;
  kind: 'projected' | 'final';
}

/** Day-basis classification: eligible, at_risk (still reachable) or short (not reachable). */
export function classifyEligibility({ present, working, remaining, min, kind }: EligibilityInput): EligibilityStatus {
  if (working === 0) return 'eligible';
  if ((present * 100) / working >= min) return 'eligible';
  if (kind === 'final') return 'short';
  return daysNeeded(present, working, min) <= remaining ? 'at_risk' : 'short';
}

export interface RecoveryPlan {
  percent: number | null;
  needed: number;
  reachable: boolean;
}

export function recoveryPlan(present: number, working: number, remaining: number, min: number): RecoveryPlan {
  const needed = daysNeeded(present, working, min);
  return { percent: percent(present, working), needed, reachable: needed <= remaining };
}

/** Band for colouring a percentage against the policy thresholds. */
export function band(pct: number | null, min: number, warn: number): 'none' | 'ok' | 'warn' | 'short' {
  if (pct === null) return 'none';
  if (pct < min) return 'short';
  if (pct < warn) return 'warn';
  return 'ok';
}

/**
 * Absentee keypad (mobile doc §9.2): parse "3 17 45" / "3,17,45" against the roster.
 * Unknown roll numbers are reported, duplicates ignored.
 */
export function applyAbsentees(input: string, roster: ReadonlyArray<{ rollNo: string | null; studentId: string }>) {
  const byRoll = new Map(roster.filter((r) => r.rollNo).map((r) => [r.rollNo!.trim().toUpperCase(), r.studentId]));
  const absent = new Set<string>();
  const unknown: string[] = [];
  for (const token of input.split(/[\s,;]+/).filter(Boolean)) {
    const id = byRoll.get(token.toUpperCase());
    if (id) absent.add(id);
    else if (!unknown.includes(token)) unknown.push(token);
  }
  return { absent, unknown };
}

/** Shared fixtures: the SQL test suite checks app.days_needed / app.classify_eligibility against these. */
export const ELIGIBILITY_FIXTURES: ReadonlyArray<EligibilityInput & { needed: number; status: EligibilityStatus }> = [
  { present: 10, working: 20, remaining: 30, min: 75, kind: 'projected', needed: 20, status: 'at_risk' },
  { present: 10, working: 20, remaining: 19, min: 75, kind: 'projected', needed: 20, status: 'short' },
  { present: 15, working: 20, remaining: 0, min: 75, kind: 'final', needed: 0, status: 'eligible' },
  { present: 14.5, working: 20, remaining: 0, min: 75, kind: 'final', needed: 2, status: 'short' },
  { present: 0, working: 0, remaining: 100, min: 75, kind: 'projected', needed: 0, status: 'eligible' },
  { present: 71, working: 100, remaining: 50, min: 75, kind: 'projected', needed: 16, status: 'at_risk' },
  { present: 40, working: 100, remaining: 100, min: 75, kind: 'projected', needed: 140, status: 'short' },
];
