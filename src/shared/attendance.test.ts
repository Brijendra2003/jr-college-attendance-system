import { describe, expect, it } from 'vitest';
import { ELIGIBILITY_FIXTURES, applyAbsentees, band, classifyEligibility, daysNeeded, percent, recoveryPlan } from './attendance';
import { errorCode, errorMessage } from './errors';
import { isApaarId, redactAadhaar } from './ids';
import { monthDays, shiftISODate } from './dates';
import { hasPermission, personasFor } from './permissions';

describe('attendance maths', () => {
  it.each(ELIGIBILITY_FIXTURES)('fixture %#', (f) => {
    expect(daysNeeded(f.present, f.working, f.min)).toBe(f.needed);
    expect(classifyEligibility(f)).toBe(f.status);
  });

  it('rounds percentages to 2 dp and returns null with nothing held', () => {
    expect(percent(2, 3)).toBe(66.67);
    expect(percent(0, 0)).toBeNull();
  });

  it('half days count as 0.5', () => {
    // 3 P + 1 HD over 4 working days = 87.5%
    expect(percent(3.5, 4)).toBe(87.5);
  });

  it('recovery plan says whether 75% is still reachable', () => {
    expect(recoveryPlan(50, 70, 10, 75)).toEqual({ percent: 71.43, needed: 10, reachable: true });
    expect(recoveryPlan(50, 70, 9, 75).reachable).toBe(false);
  });

  it('absentee keypad parses spaces, commas, duplicates and unknown roll numbers', () => {
    const roster = [{ rollNo: '3', studentId: 'a' }, { rollNo: '17', studentId: 'b' }, { rollNo: '45', studentId: 'c' }];
    const r = applyAbsentees(' 3, 17 17 99 ', roster);
    expect([...r.absent]).toEqual(['a', 'b']);
    expect(r.unknown).toEqual(['99']);
  });

  it('bands', () => {
    expect(band(74.99, 75, 80)).toBe('short');
    expect(band(79, 75, 80)).toBe('warn');
    expect(band(80, 75, 80)).toBe('ok');
    expect(band(null, 75, 80)).toBe('none');
  });
});

describe('errors', () => {
  it('extracts codes from PostgREST messages', () => {
    expect(errorCode('ATT_FORBIDDEN')).toBe('ATT_FORBIDDEN');
    expect(errorCode('ERROR: MONTH_CLOSED (P0001)')).toBe('MONTH_CLOSED');
    expect(errorCode('duplicate key value')).toBeNull();
    expect(errorMessage('LEAVE_OVERLAP', 'mr')).toContain('रजे');
  });
});

describe('ids and dates', () => {
  it('validates APAAR and redacts Aadhaar', () => {
    expect(isApaarId('123456789012')).toBe(true);
    expect(isApaarId('12345')).toBe(false);
    expect(redactAadhaar('Aadhaar 1234 5678 9012')).toBe('Aadhaar XXXX XXXX 9012');
  });
  it('month helpers', () => {
    expect(monthDays('2027-02-10')).toHaveLength(28);
    expect(shiftISODate('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('permissions', () => {
  it('scoped grants', () => {
    const grants = [{ permission: 'attendance.view', scope: 'class' }] as const;
    expect(hasPermission(grants, 'attendance.view')).toBe(true);
    expect(hasPermission(grants, 'attendance.view', 'all')).toBe(false);
  });
  it('personas', () => {
    expect(personasFor(['teacher', 'parent'])).toEqual(['teacher', 'parent']);
    expect(personasFor(['office'])).toEqual([]);
  });
});
