// Calendar-date helpers that never touch UTC conversion (avoids off-by-one around midnight/DST).
import type { ISODate } from './types';

export function toISO(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISO(s: ISODate): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0); // noon avoids DST edge cases
}

export function today(): ISODate {
  return toISO(new Date());
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function diffDays(a: ISODate, b: ISODate): number {
  // a - b in whole days
  return Math.round((fromISO(a).getTime() - fromISO(b).getTime()) / 86_400_000);
}

export function dow(s: ISODate): number {
  return fromISO(s).getDay(); // 0 = Sunday
}

/** Monday of the ISO week containing the date. */
export function mondayOf(s: ISODate): ISODate {
  const d = dow(s);
  const offset = d === 0 ? -6 : 1 - d;
  return addDays(s, offset);
}

export function range(start: ISODate, days: number): ISODate[] {
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const dowShort = (s: ISODate) => DOW_SHORT[dow(s)];
export const dowLong = (s: ISODate) => DOW_LONG[dow(s)];

export function fmtShort(s: ISODate): string {
  const d = fromISO(s);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function fmtLong(s: ISODate): string {
  const d = fromISO(s);
  return `${DOW_SHORT[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function fmtMinutes(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h${String(r).padStart(2, '0')}`;
}

export function weeksBetween(a: ISODate, b: ISODate): number {
  return Math.floor(diffDays(b, a) / 7);
}
