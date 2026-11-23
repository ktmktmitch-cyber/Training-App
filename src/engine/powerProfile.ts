// Power profile & rider type (inspired by JOIN's rider profile, Wahoo 4DP and TrainingPeaks'
// power profile). 5 s / 1 min / 5 min power are your actual best efforts from intervals.icu's
// power curve (default: last 90 days). Only when there is no curve does it fall back to
// estimating them from the power-duration model (CP, W′, Pmax; Morton 3-parameter), which
// tends to under-read sprints. Scored against approximate Coggan power-profile ranges.
import type { AthleteProfile, CurvePoint, PowerCurve } from './types';

export type PowerKey = 'sprint' | 'anaerobic' | 'vo2' | 'threshold';
export const POWER_LABEL: Record<PowerKey, string> = { sprint: 'Sprint (5 s)', anaerobic: 'Anaerobic (1 min)', vo2: 'VO2max (5 min)', threshold: 'Threshold (FTP)' };

// [untrained, world class] W/kg — approximate Coggan power-profile anchors
const ANCHORS: Record<'M' | 'F', Record<PowerKey, [number, number]>> = {
  M: { sprint: [10.2, 25.2], anaerobic: [5.6, 11.5], vo2: [2.3, 7.6], threshold: [1.9, 6.4] },
  F: { sprint: [8.4, 19.4], anaerobic: [4.7, 9.3], vo2: [1.9, 6.6], threshold: [1.5, 5.7] },
};

export const POWER_SECS: Record<Exclude<PowerKey, 'threshold'>, number> = { sprint: 5, anaerobic: 60, vo2: 300 };

/** Where a number came from: a real best effort (with the ride), the model, or your FTP. */
export interface PowerSource {
  kind: 'best' | 'model' | 'ftp';
  secs: number | null;
  point?: CurvePoint;
  window?: string; // e.g. 'Last 90 days'
  modelWatts?: number; // model estimate for comparison
}

export interface PowerProfile {
  sources: Record<PowerKey, PowerSource>;
  window: string | null;
  watts: Record<PowerKey, number>;
  wkg: Record<PowerKey, number>;
  score: Record<PowerKey, number>; // 0..100 on the population scale
  type: string;
  strength: PowerKey;
  limiter: PowerKey;
  note: string;
}

export function morton(cp: number, wPrime: number, pMax: number, t: number): number {
  const k = wPrime / Math.max(1, pMax - cp);
  return cp + wPrime / (t + k);
}

export function powerProfile(p: AthleteProfile | null, curves: PowerCurve[] = [], windowId = '90d'): PowerProfile | null {
  const curve = curves.find((c) => c.id === windowId) ?? curves.find((c) => c.points.length) ?? null;
  const weightKg = p?.weightKg ?? curve?.weightKg ?? null;
  if (!p || !weightKg) return null;
  const ftp = p.ftp ?? p.eftp;
  const cp = p.cp ?? ftp;
  const hasModel = Boolean(ftp && cp && p.wPrime && p.pMax);
  const hasCurve = Boolean(curve?.points.length);
  if (!ftp || (!hasModel && !hasCurve)) return null;
  const watts = { threshold: Math.round(ftp) } as Record<PowerKey, number>;
  const sources = { threshold: { kind: 'ftp', secs: null } } as Record<PowerKey, PowerSource>;
  for (const k of ['sprint', 'anaerobic', 'vo2'] as const) {
    const secs = POWER_SECS[k];
    const modelWatts = hasModel ? Math.round(morton(cp!, p.wPrime!, p.pMax!, secs)) : undefined;
    const best = curve?.points.find((pt) => pt.secs === secs);
    if (best) {
      watts[k] = best.watts;
      sources[k] = { kind: 'best', secs, point: best, window: curve!.label, modelWatts };
    } else if (modelWatts != null) {
      watts[k] = modelWatts;
      sources[k] = { kind: 'model', secs, modelWatts };
    } else return null;
  }
  const p2 = { ...p, weightKg };
  const sex = p.sex === 'F' ? 'F' : 'M';
  const keys = Object.keys(watts) as PowerKey[];
  const wkg = Object.fromEntries(keys.map((k) => [k, Math.round((watts[k] / weightKg) * 100) / 100])) as Record<PowerKey, number>;
  const score = Object.fromEntries(
    keys.map((k) => {
      const [lo, hi] = ANCHORS[sex][k];
      return [k, Math.round(Math.max(0, Math.min(100, ((wkg[k] - lo) / (hi - lo)) * 100)))];
    }),
  ) as Record<PowerKey, number>;
  const sorted = [...keys].sort((a, b) => score[b] - score[a]);
  const strength = sorted[0];
  const limiter = sorted[sorted.length - 1];
  const spread = score[strength] - score[limiter];
  let type: string;
  if (spread < 10) type = 'All-rounder';
  else if (strength === 'sprint' || (strength === 'anaerobic' && score.sprint >= score.vo2)) type = 'Sprinter';
  else if (strength === 'anaerobic' || (strength === 'vo2' && score.anaerobic > score.threshold)) type = 'Puncheur';
  else if (p2.weightKg < 68) type = 'Climber';
  else type = 'Time trialist / diesel';
  const usedBest = Object.values(sources).some((x) => x.kind === 'best');
  return {
    sources,
    window: usedBest ? curve!.label : null,
    watts,
    wkg,
    score,
    type,
    strength,
    limiter,
    note: usedBest
      ? `5 s, 1 min and 5 min are your best efforts on intervals.icu’s power curve (${curve!.label.toLowerCase()}); threshold is your FTP. Scored against approximate Coggan power-profile ranges — relative strengths matter more than the absolute numbers.`
      : 'Estimated from intervals.icu’s power-duration model (CP, W′, Pmax) because no power curve was available — this tends to under-read short sprints. Sync with intervals.icu to use your real best efforts.',
  };
}
