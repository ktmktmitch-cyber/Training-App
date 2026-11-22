// Behaviour journal: tag what happened (alcohol, travel, illness …) so unusual HRV / resting
// HR mornings are explained — and, where it's biologically justified, kept out of your
// personal baseline and/or your 7-day readiness trend.
//
// Policy (why each tag is treated the way it is):
//  * Baseline = your normal physiology. Transient, external perturbations (alcohol, jet lag,
//    altitude, heat, late meals, late caffeine, vaccination) distort its mean and spread, so
//    those mornings are excluded. Illness is excluded from the baseline too (pathological).
//  * 7-day trend = "is training fatigue accumulating?". Transient non-training confounders
//    are excluded so one night out doesn't cut a week of training. Illness, poor sleep and
//    life stress are KEPT: they genuinely reduce what you can absorb.
//  * Life stress and late hard workouts are never excluded — they're recurring, real load
//    that your baseline should reflect.
// The tagged morning itself still counts as a less-recovered day: you're told the low
// reading is explained, and today's session is softened only if the drop is large.
import { addDays, diffDays } from './dates';
import { mean } from './stats';
import type { ISODate, Wellness } from './types';

export type TagKey =
  | 'alcohol_light'
  | 'alcohol_heavy'
  | 'late_meal'
  | 'caffeine_late'
  | 'travel'
  | 'altitude'
  | 'heat'
  | 'illness'
  | 'vaccine'
  | 'poor_sleep'
  | 'stress'
  | 'late_workout'
  | 'other_exclude';

export interface TagDef {
  key: TagKey;
  label: string;
  short: string;
  mornings: number; // how many following mornings are affected
  excludeBaseline: boolean;
  excludeTrend: boolean;
  why: string;
}

export const TAGS: TagDef[] = [
  { key: 'alcohol_light', label: 'Alcohol (1-2 drinks)', short: 'Alcohol', mornings: 1, excludeBaseline: true, excludeTrend: true, why: 'Alcohol raises sleeping heart rate and suppresses HRV in a dose-dependent way, mostly in the first hours of sleep. One or two drinks usually clear by the next night.' },
  { key: 'alcohol_heavy', label: 'Alcohol (3+ drinks)', short: 'Alcohol 3+', mornings: 2, excludeBaseline: true, excludeTrend: true, why: 'Heavier drinking suppresses HRV and raises resting HR more, and the effect can carry into a second night.' },
  { key: 'late_meal', label: 'Big / late meal', short: 'Late meal', mornings: 1, excludeBaseline: true, excludeTrend: true, why: 'Digestion close to bedtime raises overnight heart rate and lowers HRV for one night.' },
  { key: 'caffeine_late', label: 'Caffeine late in the day', short: 'Late caffeine', mornings: 1, excludeBaseline: true, excludeTrend: true, why: 'Caffeine taken in the afternoon or evening can disturb sleep and nudge overnight HR up.' },
  { key: 'travel', label: 'Travel / jet lag', short: 'Travel', mornings: 2, excludeBaseline: true, excludeTrend: true, why: 'Circadian disruption, dehydration and poor sleep on travel days shift HRV/RHR for a couple of nights.' },
  { key: 'altitude', label: 'Altitude (first days)', short: 'Altitude', mornings: 3, excludeBaseline: true, excludeTrend: true, why: 'Acute hypoxia raises resting HR and lowers HRV until you acclimatise.' },
  { key: 'heat', label: 'Hot night / sauna', short: 'Heat', mornings: 1, excludeBaseline: true, excludeTrend: true, why: 'Thermoregulation raises overnight heart rate and lowers HRV.' },
  { key: 'illness', label: 'Sick / symptoms', short: 'Ill', mornings: 1, excludeBaseline: true, excludeTrend: false, why: 'Illness is kept out of your baseline but NOT ignored for readiness — it is a real reason to train less.' },
  { key: 'vaccine', label: 'Vaccination', short: 'Vaccine', mornings: 2, excludeBaseline: true, excludeTrend: true, why: 'The immune response commonly lowers HRV and raises RHR for 1-2 days.' },
  { key: 'poor_sleep', label: 'Disturbed sleep (kids, noise…)', short: 'Bad sleep', mornings: 1, excludeBaseline: true, excludeTrend: false, why: 'Not representative of your normal nights, but sleep debt still affects recovery, so it stays in readiness.' },
  { key: 'stress', label: 'High life / work stress', short: 'Stress', mornings: 1, excludeBaseline: false, excludeTrend: false, why: 'Kept in both: stress is real load that competes with training for recovery.' },
  { key: 'late_workout', label: 'Hard workout late in the evening', short: 'Late workout', mornings: 1, excludeBaseline: false, excludeTrend: false, why: 'Kept: training stress is exactly what HRV should reflect.' },
  { key: 'other_exclude', label: 'Other (exclude this night)', short: 'Excluded', mornings: 1, excludeBaseline: true, excludeTrend: true, why: 'You marked this night as not representative.' },
];
export const TAG_BY_KEY: Record<TagKey, TagDef> = Object.fromEntries(TAGS.map((t) => [t.key, t])) as Record<TagKey, TagDef>;

/** Journal entries keyed by the date of the evening/day the behaviour happened. */
export type Journal = Record<ISODate, TagKey[]>;

export interface MorningEffect {
  tags: TagKey[];
  excludeBaseline: boolean;
  excludeTrend: boolean;
}

/** Map journal entries to the morning wellness readings they affect (behaviour on D → readings D+1…). */
export function affectedMornings(journal: Journal): Record<ISODate, MorningEffect> {
  const out: Record<ISODate, MorningEffect> = {};
  for (const [day, tags] of Object.entries(journal)) {
    for (const key of tags) {
      const def = TAG_BY_KEY[key];
      if (!def) continue;
      for (let i = 1; i <= def.mornings; i++) {
        const m = addDays(day, i);
        const e = (out[m] ??= { tags: [], excludeBaseline: false, excludeTrend: false });
        if (!e.tags.includes(key)) e.tags.push(key);
        e.excludeBaseline ||= def.excludeBaseline;
        e.excludeTrend ||= def.excludeTrend;
      }
    }
  }
  return out;
}

export interface TagImpact {
  key: TagKey;
  label: string;
  n: number;
  hrvPct: number | null; // % vs clean baseline
  rhrDelta: number | null; // bpm vs clean baseline
}

/** Personal effect of each behaviour: tagged mornings vs your clean ±30-day baseline. */
export function tagImpacts(journal: Journal, wellness: Wellness[], asOf: ISODate): TagImpact[] {
  const eff = affectedMornings(journal);
  const byDate = new Map(wellness.map((w) => [w.date, w]));
  const clean = wellness.filter((w) => !eff[w.date]);
  const out: TagImpact[] = [];
  for (const def of TAGS) {
    const hrvD: number[] = [];
    const rhrD: number[] = [];
    for (const [m, e] of Object.entries(eff)) {
      if (!e.tags.includes(def.key) || diffDays(asOf, m) < 0 || diffDays(asOf, m) > 180) continue;
      const w = byDate.get(m);
      if (!w) continue;
      const win = clean.filter((c) => Math.abs(diffDays(c.date, m)) <= 30);
      const hb = win.filter((c) => c.hrv).map((c) => Math.log(c.hrv as number));
      const rb = win.filter((c) => c.rhr).map((c) => c.rhr as number);
      if (w.hrv && hb.length >= 7) hrvD.push(Math.log(w.hrv) - mean(hb));
      if (w.rhr && rb.length >= 7) rhrD.push(w.rhr - mean(rb));
    }
    const n = Math.max(hrvD.length, rhrD.length);
    if (!n) continue;
    out.push({
      key: def.key,
      label: def.label,
      n,
      hrvPct: hrvD.length ? Math.round((Math.exp(mean(hrvD)) - 1) * 100) : null,
      rhrDelta: rhrD.length ? Math.round(mean(rhrD) * 10) / 10 : null,
    });
  }
  return out;
}
