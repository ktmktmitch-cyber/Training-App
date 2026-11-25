// Heat adaptation: how much heat and indoor riding cost you, and how heat-acclimated you are now.
//
//  * Heat cost comes from the conditions model in performance.ts (heart rate ~ power + temperature +
//    indoor + fatigue + duration + fitness): bpm per °C at the same power, turned into watts lost at
//    the same heart rate with your own bpm-per-watt slope.
//  * Acclimation follows the usual exercise-heat-acclimation picture: most adaptation (lower HR and
//    core temp, more plasma volume and sweat) comes in ~5-7 days of daily 60-90 min heat exposure,
//    nearly complete by ~10-14 days, and decays roughly 2-3% per day without exposure. Each hot
//    session (by the ride's average temperature) adds a dose; indoor rides count as mild heat
//    (warm room, little airflow); hot days without exposure decay the index.
import { addDays, diffDays } from './dates';
import type { ConditionsModel } from './performance';
import type { Activity, ISODate } from './types';

export interface HeatAdaptation {
  index: number; // 0-100 % of full heat acclimation
  level: 'none' | 'partial' | 'good' | 'well';
  label: string;
  hotSessions14: number; // sessions ≥ 27 °C (bike computer) in the last 14 days
  hotMinutes14: number;
  indoorSessions14: number;
  lastHot: ISODate | null;
  bpmPerDegree: number | null;
  bpmAt30: number | null; // extra bpm at 30 °C vs 15 °C, same power
  wattsAt30: number | null; // watts lost at the same HR at 30 °C
  bpmIndoor: number | null;
  wattsIndoor: number | null; // watts lost at the same HR indoors
  hottest28: { date: ISODate; tempC: number; name: string } | null;
  series: { date: ISODate; index: number }[]; // last 42 days
  advice: string;
}

const HOT = 27; // °C average on the bike computer that counts as a real heat stimulus (head units read several °C warm from sun and body heat)

/** Heat dose of one session: 0 (cool) → ~1 (60 min hot) → up to 1.5 (long and very hot). */
export function heatDose(a: Activity): number {
  if (a.isStrength) return 0;
  const min = a.movingSec / 60;
  if (min < 20) return 0;
  const t = a.tempC;
  let f: number;
  const ctx = a.context ?? [];
  if (ctx.includes('no_fan')) f = 0.8; // indoors without a fan: core temperature climbs much like a hot day
  else if (t != null && !a.indoor) f = Math.max(0, Math.min(1.5, (t - 26) / 7)); // device 26 °C → 0, 33 °C → 1
  else if (a.indoor) f = ctx.includes('fan') ? 0.1 : 0.15; // warm room — most people ride indoors with fans, so only a mild stimulus
  else f = 0;
  if (ctx.includes('hot')) f = Math.max(f, 0.7); // you marked it hot (temperature missing or understated)
  return Math.min(1.5, f * Math.min(1.5, min / 60));
}

export function heatAdaptation(activities: Activity[], model: ConditionsModel | null, asOf: ISODate): HeatAdaptation {
  const byDay = new Map<ISODate, number>();
  for (const a of activities) {
    const age = diffDays(asOf, a.date);
    if (age < 0 || age > 120) continue;
    byDay.set(a.date, (byDay.get(a.date) ?? 0) + heatDose(a));
  }
  // Daily update: exposure moves you toward 100% (≈ 70% after a week of daily 1-h sessions);
  // a day without exposure decays ~2.5%.
  let idx = 0;
  const series: { date: ISODate; index: number }[] = [];
  for (let d = addDays(asOf, -120); diffDays(asOf, d) >= 0; d = addDays(d, 1)) {
    const dose = Math.min(1.5, byDay.get(d) ?? 0);
    if (dose > 0.05) idx += (1 - idx) * 0.16 * dose;
    else idx *= 0.975;
    if (diffDays(asOf, d) < 42) series.push({ date: d, index: Math.round(idx * 100) });
  }
  const index = Math.round(idx * 100);
  const recent = activities.filter((a) => !a.isStrength && diffDays(asOf, a.date) >= 0 && diffDays(asOf, a.date) < 14);
  const hot = recent.filter((a) => !a.indoor && a.tempC != null && a.tempC >= HOT && a.movingSec >= 1200);
  const lastHot = activities.filter((a) => !a.indoor && a.tempC != null && a.tempC >= HOT && diffDays(asOf, a.date) >= 0).sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? null;
  const hottest = activities
    .filter((a) => a.tempC != null && !a.indoor && diffDays(asOf, a.date) >= 0 && diffDays(asOf, a.date) < 28)
    .sort((a, b) => (b.tempC ?? 0) - (a.tempC ?? 0))[0];
  const level: HeatAdaptation['level'] = index >= 75 ? 'well' : index >= 45 ? 'good' : index >= 15 ? 'partial' : 'none';
  const bpmPerDegree = model?.bpmPerDegree ?? null;
  const bpmAt30 = bpmPerDegree != null ? Math.round(bpmPerDegree * 15 * 10) / 10 : null;
  const wattsAt30 = bpmAt30 != null && model && model.bpmPerWatt > 0 ? Math.round(bpmAt30 / model.bpmPerWatt) : null;
  const bpmIndoor = model?.bpmIndoor ?? null;
  const wattsIndoor = bpmIndoor != null && model && model.bpmPerWatt > 0 ? Math.round(bpmIndoor / model.bpmPerWatt) : null;
  const label = { none: 'Not heat-adapted', partial: 'Partly heat-adapted', good: 'Heat-adapted', well: 'Well heat-adapted' }[level];
  const advice =
    level === 'well'
      ? 'You’re well adapted. A couple of hot sessions a week keeps it; without them it fades by about half in 2-3 weeks.'
      : level === 'good'
        ? 'Good adaptation. 3-5 more days with 60-90 min of heat (hot rides, indoor without a fan, or a 30-40 min hot bath right after training) gets you close to full.'
        : 'To acclimate for a hot race: 7-14 days of 60-90 min heat exposure — ride in the heat or indoors with less cooling/extra layers, or sit in a ~40 °C bath for 30-40 min straight after training. Most of the benefit comes in the first week; finish 2-7 days before the race.';
  return {
    index,
    level,
    label,
    hotSessions14: hot.length,
    hotMinutes14: Math.round(hot.reduce((a, x) => a + x.movingSec, 0) / 60),
    indoorSessions14: recent.filter((a) => a.indoor).length,
    lastHot,
    bpmPerDegree,
    bpmAt30,
    wattsAt30,
    bpmIndoor,
    wattsIndoor,
    hottest28: hottest ? { date: hottest.date, tempC: Math.round(hottest.tempC!), name: hottest.name } : null,
    series,
    advice,
  };
}
