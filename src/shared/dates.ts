// IST date helpers. Everything is displayed in Asia/Kolkata, whatever the server or device zone.
// SHARED (depends on date-fns + @date-fns/tz).
import { addDays, format, isValid, parseISO } from 'date-fns';
import { TZDate } from '@date-fns/tz';

export const COLLEGE_TZ = 'Asia/Kolkata';

/** "Now" as a Date whose calendar fields are IST. */
export const nowIST = () => new TZDate(Date.now(), COLLEGE_TZ);

/** Today's date in IST as YYYY-MM-DD. */
export const todayIST = () => format(nowIST(), 'yyyy-MM-dd');

export const isISODate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && isValid(parseISO(v));

/** Add days to a YYYY-MM-DD date string. */
export const shiftISODate = (iso: string, days: number) => format(addDays(parseISO(iso), days), 'yyyy-MM-dd');

/** First day of the month containing the date, YYYY-MM-01. */
export const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;

/** Every YYYY-MM-DD in the month. */
export function monthDays(monthISO: string): string[] {
  const start = parseISO(monthStart(monthISO));
  const out: string[] = [];
  for (let d = start; d.getMonth() === start.getMonth(); d = addDays(d, 1)) out.push(format(d, 'yyyy-MM-dd'));
  return out;
}

const MONTHS_MR = ['जाने', 'फेब्रु', 'मार्च', 'एप्रि', 'मे', 'जून', 'जुलै', 'ऑग', 'सप्टें', 'ऑक्टो', 'नोव्हें', 'डिसें'];
const DEVANAGARI_DIGITS = '०१२३४५६७८९';

export const toDevanagariDigits = (s: string) => s.replace(/\d/g, (d) => DEVANAGARI_DIGITS[Number(d)]);

/** 28 Oct 2026 / 28 ऑक्टो 2026 (Western digits by default; mobile doc §15). */
export function formatDate(value: string | Date | null | undefined, lang: 'en' | 'mr' | 'hi' = 'en', devanagariDigits = false): string {
  if (!value) return '–';
  const d = typeof value === 'string' ? (value.length === 10 ? parseISO(value) : new TZDate(value, COLLEGE_TZ)) : new TZDate(value, COLLEGE_TZ);
  if (!isValid(d)) return '–';
  if (lang === 'en') return format(d, 'd MMM yyyy');
  const out = `${d.getDate()} ${MONTHS_MR[d.getMonth()]} ${d.getFullYear()}`;
  return devanagariDigits ? toDevanagariDigits(out) : out;
}

/** 12-hour IST time, e.g. 8:10 AM. */
export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '–';
  const d = new TZDate(typeof value === 'string' ? new Date(value) : value, COLLEGE_TZ);
  return isValid(d) ? format(d, 'h:mm a') : '–';
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '–';
  const d = new TZDate(typeof value === 'string' ? new Date(value) : value, COLLEGE_TZ);
  return isValid(d) ? format(d, 'd MMM yyyy, h:mm a') : '–';
}

export const formatMonth = (monthISO: string) => format(parseISO(monthStart(monthISO)), 'MMMM yyyy');
