import { diffDays } from './dates';
import type { DayConfig, ISODate, TrainingCamp } from './types';

// ---------- Training camps ----------
// A base camp is a short block of much higher volume, almost all Zone 2 (Seiler; block-periodisation
// studies, e.g. Rønnestad 2014). Volume roughly doubles your usual week; every 4th day is easier so
// the block can be absorbed; one tempo day mid-camp and short sprints keep some top end. Arrive
// fresh (two easy days before) and absorb it afterwards (rest, then ~4 easy days) — fitness gains from
// a camp show up after the recovery, not during it.
export function campMinutes(c: TrainingCamp, weeklyHours: number): number {
  if (c.hoursPerDay) return Math.round(c.hoursPerDay * 60);
  return Math.round(Math.max(150, Math.min(300, weeklyHours * 60 * 0.33)) / 15) * 15;
}

export function campDayOf(camps: TrainingCamp[] | undefined, weeklyHours: number): (d: ISODate) => DayConfig['camp'] | null {
  return (d) => {
    const c = (camps ?? []).find((x) => d >= x.start && d <= x.end);
    if (!c) return null;
    return { name: c.name, index: diffDays(d, c.start), length: diffDays(c.end, c.start) + 1, minutes: campMinutes(c, weeklyHours) };
  };
}

/** What to ride on a given camp day. */
export function campSession(cp: NonNullable<DayConfig['camp']>): { id: string; minutes: number; why: string } {
  const { index: i, length: n, minutes } = cp;
  const r5 = (x: number) => Math.round(x / 5) * 5;
  // one tempo day around the middle, never on an easier day
  const mid = (Math.floor(n / 2) + 1) % 4 === 0 ? Math.floor(n / 2) - 1 : Math.floor(n / 2);
  if (n > 2 && i === n - 1) return { id: 'endurance', minutes: r5(minutes * 0.55), why: 'Last camp day — shorter, easy Zone 2 (travel day for most).' };
  if ((i + 1) % 4 === 0) return { id: 'endurance', minutes: r5(minutes * 0.55), why: 'Easier camp day — short and easy so the block can be absorbed.' };
  if (i === 0) return { id: 'endurance', minutes: r5(minutes * 0.75), why: 'First camp day — settle in with steady Zone 2.' };
  if (n >= 5 && i === mid) return { id: 'end_tempo', minutes, why: 'Mid-camp: Zone 2 with tempo blocks — aerobic strength without an interval day.' };
  if (i % 4 === 1) return { id: 'end_sprints', minutes, why: 'Long Zone 2 with a few short sprints to keep some top end.' };
  return { id: 'endurance', minutes, why: 'Long, steady Zone 2 — the heart of a base camp. Fuel 60-90 g carbs/h.' };
}

