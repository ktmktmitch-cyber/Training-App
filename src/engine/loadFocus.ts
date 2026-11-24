// Training Load Focus (inspired by Garmin): the last 4 weeks of training load split into
// low aerobic / high aerobic / anaerobic, compared with target ranges for the current
// phase and event. A shortage nudges which sessions the planner picks.
import { diffDays } from './dates';
import type { Activity, EventType, ISODate, Phase } from './types';

export type FocusKey = 'low' | 'high' | 'anaerobic';
export const FOCUS_LABEL: Record<FocusKey, string> = { low: 'Low aerobic', high: 'High aerobic', anaerobic: 'Anaerobic' };

export interface LoadFocus {
  load: Record<FocusKey, number>; // TSS-like units over 28 days
  share: Record<FocusKey, number>; // 0..1
  target: Record<FocusKey, [number, number]>; // share bands
  status: Record<FocusKey, 'short' | 'ok' | 'over'>;
  shortage: FocusKey | null;
  headline: string;
  days: number;
  /** estimated from ride averages (no zone data): anaerobic work can't be seen */
  estimated?: boolean;
}

// Representative intensity (fraction of FTP) for each of the 7 power zones
const ZONE_IF = [0.45, 0.65, 0.83, 0.97, 1.12, 1.35, 1.7];

export function focusTargets(phase: Phase, event: EventType): Record<FocusKey, [number, number]> {
  let t: Record<FocusKey, [number, number]>;
  if (['prep', 'base', 'accumulation', 'volume', 'transition'].includes(phase)) t = { low: [0.55, 0.78], high: [0.2, 0.4], anaerobic: [0.02, 0.08] };
  else if (['build', 'intensity', 'transmutation', 'maintain'].includes(phase)) t = { low: [0.45, 0.65], high: [0.3, 0.48], anaerobic: [0.05, 0.12] };
  else t = { low: [0.4, 0.6], high: [0.3, 0.48], anaerobic: [0.07, 0.15] };
  if (['crit', 'cx', 'mtb_xc', 'road_race'].includes(event)) t.anaerobic = [t.anaerobic[0] + 0.02, t.anaerobic[1] + 0.03];
  if (['ultra', 'gran_fondo', 'tt'].includes(event)) {
    t.anaerobic = [Math.max(0.01, t.anaerobic[0] - 0.02), Math.max(0.05, t.anaerobic[1] - 0.03)];
    t.low = [t.low[0] + 0.03, t.low[1] + 0.03];
  }
  return t;
}

export function computeLoadFocus(activities: Activity[], asOf: ISODate, phase: Phase, event: EventType): LoadFocus {
  const load: Record<FocusKey, number> = { low: 0, high: 0, anaerobic: 0 };
  let first: ISODate | null = null;
  for (const a of activities) {
    const age = diffDays(asOf, a.date);
    if (age < 0 || age >= 28 || a.isStrength) continue;
    if (!first || a.date < first) first = a.date;
    const z = a.powerZoneSecs && a.powerZoneSecs.some((x) => x > 0) ? a.powerZoneSecs : a.hrZoneSecs && a.hrZoneSecs.some((x) => x > 0) ? a.hrZoneSecs : null;
    if (z) {
      const parts = z.map((secs, i) => (secs / 3600) * ZONE_IF[Math.min(i, 6)] ** 2 * 100);
      const raw = { low: (parts[0] ?? 0) + (parts[1] ?? 0), high: (parts[2] ?? 0) + (parts[3] ?? 0) + (parts[4] ?? 0), anaerobic: (parts[5] ?? 0) + (parts[6] ?? 0) };
      const tot = raw.low + raw.high + raw.anaerobic;
      // Scale to the activity's actual training load so totals match TSS
      const k = a.tss && tot > 0 ? a.tss / tot : 1;
      load.low += raw.low * k;
      load.high += raw.high * k;
      load.anaerobic += raw.anaerobic * k;
    } else if (a.tss) {
      if ((a.intensity ?? 0.7) < 0.76) load.low += a.tss;
      else load.high += a.tss;
    }
  }
  const total = load.low + load.high + load.anaerobic;
  const share = {
    low: total ? load.low / total : 0,
    high: total ? load.high / total : 0,
    anaerobic: total ? load.anaerobic / total : 0,
  };
  const target = focusTargets(phase, event);
  const status = Object.fromEntries(
    (Object.keys(target) as FocusKey[]).map((k) => [k, share[k] < target[k][0] ? 'short' : share[k] > target[k][1] ? 'over' : 'ok']),
  ) as LoadFocus['status'];
  const deficits = (Object.keys(target) as FocusKey[])
    .filter((k) => status[k] === 'short')
    .map((k) => ({ k, d: (target[k][0] - share[k]) / target[k][0] }))
    .sort((a, b) => b.d - a.d);
  const days = first ? diffDays(asOf, first) + 1 : 0;
  const shortage = total > 0 && days >= 7 ? (deficits[0]?.k ?? null) : null;
  const headline =
    total === 0 || days < 7
      ? 'Not enough recent training to judge load focus.'
      : shortage
        ? `${FOCUS_LABEL[shortage]} shortage — this week leans toward ${shortage === 'low' ? 'more easy Zone 2 volume' : shortage === 'high' ? 'tempo, threshold and VO2max work' : 'short, very hard efforts (sprints, 1-min repeats)'}.`
        : (Object.keys(status) as FocusKey[]).some((k) => status[k] === 'over')
          ? `Balanced overall, with more ${FOCUS_LABEL[(Object.keys(status) as FocusKey[]).find((k) => status[k] === 'over')!].toLowerCase()} load than this phase needs.`
          : 'Balanced — your last 4 weeks match what this phase calls for.';
  return { load: { low: Math.round(load.low), high: Math.round(load.high), anaerobic: Math.round(load.anaerobic) }, share, target, status, shortage, headline, days };
}
