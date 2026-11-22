// Training Status (inspired by Garmin): one label summarising whether your recent
// training is working, from the fitness trend (CTL), form (TSB), eFTP trend and HRV.
import { addDays, diffDays } from './dates';
import { round } from './stats';
import type { ISODate, Readiness, Wellness } from './types';

export type StatusKey = 'productive' | 'maintaining' | 'peaking' | 'recovery' | 'overreaching' | 'strained' | 'unproductive' | 'detraining' | 'unknown';

export interface TrainingStatus {
  key: StatusKey;
  label: string;
  detail: string;
  tone: 'good' | 'neutral' | 'warn' | 'bad';
  ctlDelta28: number | null;
  eftpDelta28: number | null;
}

const LABEL: Record<StatusKey, string> = {
  productive: 'Productive',
  maintaining: 'Maintaining',
  peaking: 'Peaking',
  recovery: 'Recovery',
  overreaching: 'Overreaching',
  strained: 'Strained',
  unproductive: 'Unproductive',
  detraining: 'Detraining',
  unknown: 'Not enough data',
};

export function trainingStatus(wellness: Wellness[], readiness: Readiness, asOf: ISODate): TrainingStatus {
  const sorted = [...wellness].filter((w) => diffDays(asOf, w.date) >= 0).sort((a, b) => a.date.localeCompare(b.date));
  const at = (daysAgo: number) => {
    const target = addDays(asOf, -daysAgo);
    return [...sorted].reverse().find((w) => diffDays(target, w.date) >= 0 && w.ctl != null) ?? null;
  };
  const now = at(0);
  const prev = at(28);
  if (!now || now.ctl == null || !prev || prev.ctl == null) {
    return { key: 'unknown', label: LABEL.unknown, detail: 'Needs about 4 weeks of intervals.icu fitness data.', tone: 'neutral', ctlDelta28: null, eftpDelta28: null };
  }
  const ctl = now.ctl;
  const ctlDelta28 = round(ctl - prev.ctl, 1);
  const tsb = readiness.tsb ?? (now.atl != null ? ctl - now.atl : 0);
  const ramp = readiness.rampRate ?? 0;
  const eNow = [...sorted].reverse().find((w) => w.eftp)?.eftp ?? null;
  const ePrev = prev.eftp ?? sorted.find((w) => w.eftp && diffDays(prev.date, w.date) >= 0)?.eftp ?? null;
  const eftpDelta28 = eNow && ePrev ? round(((eNow - ePrev) / ePrev) * 100, 1) : null;
  const max90 = Math.max(...sorted.filter((w) => diffDays(asOf, w.date) <= 90 && w.ctl != null).map((w) => w.ctl as number));
  const hrvLow = readiness.flags.some((f) => f.id === 'hrv-low' || f.id === 'hrv-below');

  let key: StatusKey;
  if (tsb < -30 || (readiness.status === 'red' && ramp > 3)) key = 'overreaching';
  else if (hrvLow && ramp <= 3) key = 'strained';
  else if (ctlDelta28 < -0.12 * prev.ctl && tsb > 0) key = 'detraining';
  else if (tsb >= 5 && tsb <= 25 && ctl >= 0.92 * max90) key = 'peaking';
  else if (tsb > 5 && ramp < 0) key = 'recovery';
  else if (ctlDelta28 > 2 && eftpDelta28 != null && eftpDelta28 < -2) key = 'unproductive';
  else if (ctlDelta28 > 2) key = 'productive';
  else key = 'maintaining';

  const ft = eftpDelta28 != null ? ` eFTP ${eftpDelta28 >= 0 ? '+' : ''}${eftpDelta28}% over 4 weeks.` : '';
  const detail: Record<StatusKey, string> = {
    productive: `Fitness (CTL) up ${ctlDelta28} in 4 weeks and you’re absorbing it.${ft}`,
    maintaining: `Fitness stable (${ctlDelta28 >= 0 ? '+' : ''}${ctlDelta28} CTL in 4 weeks). Add load to keep improving.${ft}`,
    peaking: `Fresh (form +${round(tsb)}) with fitness near its 90-day high — ideal for racing or testing.`,
    recovery: `Lighter training lately (form +${round(tsb)}). Good for absorbing a block; expect to build again.`,
    overreaching: `Very high fatigue (form ${round(tsb)}). Recover before adding more load.`,
    strained: 'HRV is suppressed without a big jump in load — likely life stress, illness or poor sleep. Keep things easy.',
    unproductive: `Load is rising but eFTP is falling (${eftpDelta28}%) — recovery may not be keeping up.`,
    detraining: `Fitness dropped ${Math.abs(ctlDelta28)} CTL in 4 weeks. Consistency matters more than any single workout.`,
    unknown: '',
  };
  const tone: TrainingStatus['tone'] =
    key === 'productive' || key === 'peaking' ? 'good' : key === 'overreaching' || key === 'unproductive' ? 'bad' : key === 'strained' || key === 'detraining' ? 'warn' : 'neutral';
  return { key, label: LABEL[key], detail: detail[key], tone, ctlDelta28, eftpDelta28 };
}

/** intervals.icu-style form (TSB) zones. */
export const FORM_ZONES = [
  { from: 25, to: 200, label: 'Transition', tone: 'neutral' as const },
  { from: 5, to: 25, label: 'Fresh', tone: 'good' as const },
  { from: -10, to: 5, label: 'Grey zone', tone: 'neutral' as const },
  { from: -30, to: -10, label: 'Optimal', tone: 'good' as const },
  { from: -200, to: -30, label: 'High risk', tone: 'bad' as const },
];

export function formZone(tsb: number) {
  return FORM_ZONES.find((z) => tsb >= z.from && tsb < z.to) ?? FORM_ZONES[2];
}
