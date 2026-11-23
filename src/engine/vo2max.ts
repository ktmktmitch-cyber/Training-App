// VO2max estimates.
//  * Power-based: maximal aerobic power ≈ best ~5-minute power. VO2max (ml/kg/min)
//    ≈ 10.8 × (W/kg) + 7 — the ACSM leg-cycling metabolic equation (≈ 1.8 ml O2 per
//    kg·m of work + 7 ml/kg/min for unloaded cycling and rest). 5-min power slightly
//    under-reads a ramp-test peak, so treat it as a conservative field estimate.
//  * 5-min power comes from (in order): a measured 5-min best, a critical-power model
//    from 3- and 12-min bests (2-parameter CP), or the CP/W′/Pmax model (Morton).
//  * Garmin's own VO2max (from intervals.icu wellness) when available.
import { morton } from './powerProfile';

export interface Vo2Estimate {
  value: number | null;
  power: number | null; // power-based estimate
  garmin: number | null; // device estimate
  p5: number | null; // 5-min power used (W)
  weightKg: number | null;
  method: string;
  category: string | null;
}

export function vo2FromPower(watts: number, kg: number): number {
  return Math.round((10.8 * (watts / kg) + 7) * 10) / 10;
}

/** 2-parameter critical-power model from two maximal efforts → 5-min power. */
export function p5FromTwoEfforts(p3: number, p12: number): number | null {
  if (!(p3 > p12 && p12 > 0)) return null;
  const cp = (p12 * 720 - p3 * 180) / (720 - 180);
  const wPrime = (p3 - cp) * 180;
  if (cp <= 0 || wPrime <= 0) return null;
  return Math.round(cp + wPrime / 300);
}

export function vo2Category(v: number): string {
  if (v >= 75) return 'World-class endurance';
  if (v >= 65) return 'Elite amateur';
  if (v >= 55) return 'Well-trained';
  if (v >= 45) return 'Trained';
  if (v >= 35) return 'Recreationally active';
  return 'Below average';
}

export function estimateVo2(o: {
  p5?: number | null;
  p3?: number | null;
  p12?: number | null;
  cp?: number | null;
  wPrime?: number | null;
  pMax?: number | null;
  weightKg?: number | null;
  garmin?: number | null;
}): Vo2Estimate {
  let p5: number | null = null;
  let method = '';
  if (o.p5) {
    p5 = o.p5;
    method = 'best 5-min power';
  } else if (o.p3 && o.p12) {
    p5 = p5FromTwoEfforts(o.p3, o.p12);
    if (p5) method = '5-min power from your 3- and 12-min bests (critical-power model)';
  }
  if (!p5 && o.cp && o.wPrime && o.pMax) {
    p5 = Math.round(morton(o.cp, o.wPrime, o.pMax, 300));
    method = '5-min power from your power-duration model (CP, W′, Pmax)';
  }
  const power = p5 && o.weightKg ? vo2FromPower(p5, o.weightKg) : null;
  const garmin = o.garmin ?? null;
  const value = power != null && garmin != null ? Math.round(((power + garmin) / 2) * 10) / 10 : (power ?? garmin);
  if (!method && garmin != null) method = 'Garmin device estimate';
  else if (garmin != null) method += ' · averaged with your Garmin estimate';
  return { value, power, garmin, p5, weightKg: o.weightKg ?? null, method, category: value != null ? vo2Category(value) : null };
}
