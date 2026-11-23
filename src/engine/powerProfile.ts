// Power profile & rider type (inspired by JOIN's rider profile, Wahoo 4DP and TrainingPeaks'
// power profile). Uses intervals.icu's power-duration model (CP, W′, Pmax) to estimate
// 5 s / 1 min / 5 min power (Morton 3-parameter model), plus FTP, scored against
// approximate Coggan power-profile ranges (untrained → world class).
import type { AthleteProfile } from './types';

export type PowerKey = 'sprint' | 'anaerobic' | 'vo2' | 'threshold';
export const POWER_LABEL: Record<PowerKey, string> = { sprint: 'Sprint (5 s)', anaerobic: 'Anaerobic (1 min)', vo2: 'VO2max (5 min)', threshold: 'Threshold (FTP)' };

// [untrained, world class] W/kg — approximate Coggan power-profile anchors
const ANCHORS: Record<'M' | 'F', Record<PowerKey, [number, number]>> = {
  M: { sprint: [10.2, 25.2], anaerobic: [5.6, 11.5], vo2: [2.3, 7.6], threshold: [1.9, 6.4] },
  F: { sprint: [8.4, 19.4], anaerobic: [4.7, 9.3], vo2: [1.9, 6.6], threshold: [1.5, 5.7] },
};

export interface PowerProfile {
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

export function powerProfile(p: AthleteProfile | null): PowerProfile | null {
  if (!p || !p.weightKg) return null;
  const ftp = p.ftp ?? p.eftp;
  const cp = p.cp ?? ftp;
  if (!ftp || !cp || !p.wPrime || !p.pMax) return null;
  const watts: Record<PowerKey, number> = {
    sprint: Math.round(morton(cp, p.wPrime, p.pMax, 5)),
    anaerobic: Math.round(morton(cp, p.wPrime, p.pMax, 60)),
    vo2: Math.round(morton(cp, p.wPrime, p.pMax, 300)),
    threshold: Math.round(ftp),
  };
  const sex = p.sex === 'F' ? 'F' : 'M';
  const keys = Object.keys(watts) as PowerKey[];
  const wkg = Object.fromEntries(keys.map((k) => [k, Math.round((watts[k] / p.weightKg!) * 100) / 100])) as Record<PowerKey, number>;
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
  else if (p.weightKg < 68) type = 'Climber';
  else type = 'Time trialist / diesel';
  return {
    watts,
    wkg,
    score,
    type,
    strength,
    limiter,
    note: 'Estimated from intervals.icu’s power-duration model (CP, W′, Pmax) and your weight, scored against approximate Coggan power-profile ranges. Relative strengths matter more than the absolute numbers.',
  };
}
