// Staleness risk. "Staleness" is the classic sports-science term for the flat, overreached
// state that precedes overtraining syndrome. Foster's model links it to *monotony* (the
// same load day after day: mean ÷ SD of daily load) multiplied by load (*strain*). We
// combine that with other warning signs:
//   • chronically deep fatigue (form below −20 for most of two weeks)
//   • no top-end stimulus for 3+ weeks ("stale legs")
//   • stalled performance despite rising load
//   • suppressed HRV / elevated resting HR (when wellness data exists)
//   • inactivity (a different kind of stale: fitness is decaying)
import { addDays, diffDays } from './dates';
import { mean, round, sd } from './stats';
import type { ISODate } from './types';

export interface StalenessInput {
  asOf: ISODate;
  daily: { date: ISODate; load: number }[]; // daily training load (≥ 4 weeks ideally)
  tsb: { date: ISODate; tsb: number }[];
  lastRide: ISODate | null;
  lastHard: ISODate | null | undefined; // undefined = unknown
  prsLast8w?: number | null;
  eftpChangePct?: number | null;
  ctlChange28?: number | null;
  hrvLow?: boolean | null;
  rhrHigh?: boolean | null;
}

export interface StalenessFactor {
  label: string;
  detail: string;
  points: number;
}

export interface Staleness {
  score: number | null;
  level: 'low' | 'moderate' | 'high' | 'unknown';
  monotony: number | null;
  strain: number | null;
  strainVsUsual: number | null; // current week strain ÷ average of the previous 5 weeks
  factors: StalenessFactor[];
  summary: string;
}

/** Back-calculate daily load from a daily ATL series (ATL_t = ATL_{t-1} + (L − ATL_{t-1}) / 7). */
export function dailyLoadFromAtl(trend: { date: ISODate; fatigue: number }[]): { date: ISODate; load: number }[] {
  const out: { date: ISODate; load: number }[] = [];
  const sorted = [...trend].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < sorted.length; i++) {
    if (diffDays(sorted[i].date, sorted[i - 1].date) !== 1) continue;
    out.push({ date: sorted[i].date, load: Math.max(0, Math.round(7 * sorted[i].fatigue - 6 * sorted[i - 1].fatigue)) });
  }
  return out;
}

function weekStats(loads: Map<ISODate, number>, end: ISODate): { total: number; monotony: number | null; strain: number | null } {
  const vals = Array.from({ length: 7 }, (_, i) => loads.get(addDays(end, -i)) ?? 0);
  const total = vals.reduce((a, b) => a + b, 0);
  const s = sd(vals);
  const monotony = s > 0 ? mean(vals) / s : total > 0 ? 3 : null; // identical daily loads → very monotonous
  return { total, monotony: monotony != null ? Math.min(monotony, 5) : null, strain: monotony != null ? total * Math.min(monotony, 5) : null };
}

export function computeStaleness(inp: StalenessInput): Staleness {
  const factors: StalenessFactor[] = [];
  const loads = new Map(inp.daily.map((d) => [d.date, d.load]));
  const haveLoads = inp.daily.filter((d) => diffDays(inp.asOf, d.date) < 28).length >= 14;
  if (!haveLoads && !inp.lastRide) {
    return { score: null, level: 'unknown', monotony: null, strain: null, strainVsUsual: null, factors: [], summary: 'Not enough recent training data.' };
  }
  const load28 = inp.daily.filter((d) => diffDays(inp.asOf, d.date) < 28).reduce((a, d) => a + d.load, 0);
  if (!inp.lastRide && load28 === 0) {
    return { score: null, level: 'unknown', monotony: null, strain: null, strainVsUsual: null, factors: [], summary: 'No training recorded in the last 4 weeks (or rides aren’t reaching intervals.icu).' };
  }
  let score = 0;
  let monotony: number | null = null;
  let strain: number | null = null;
  let strainVsUsual: number | null = null;

  if (haveLoads) {
    const cur = weekStats(loads, inp.asOf);
    monotony = cur.monotony != null ? round(cur.monotony, 2) : null;
    strain = cur.strain != null ? Math.round(cur.strain) : null;
    const prev = [1, 2, 3, 4, 5].map((w) => weekStats(loads, addDays(inp.asOf, -7 * w)).strain).filter((x): x is number => x != null && x > 0);
    if (strain != null && prev.length >= 3) strainVsUsual = round(strain / mean(prev), 2);
    if (monotony != null && cur.total > 100) {
      if (monotony > 2) {
        score += 25;
        factors.push({ label: 'Monotonous training', detail: `Monotony ${monotony} (>2.0): daily loads are too similar. Mix genuinely easy days with harder ones.`, points: 25 });
      } else if (monotony > 1.5) {
        score += 10;
        factors.push({ label: 'Somewhat monotonous', detail: `Monotony ${monotony} (1.5-2.0). More contrast between hard and easy days helps.`, points: 10 });
      }
    }
    if (strainVsUsual != null && strainVsUsual > 1.5) {
      score += 15;
      factors.push({ label: 'Strain spike', detail: `This week’s strain is ${strainVsUsual}× the usual. A spike in monotonous load is the classic staleness and illness setup.`, points: 15 });
    }
  }

  const recentTsb = inp.tsb.filter((t) => diffDays(inp.asOf, t.date) < 14);
  if (recentTsb.length >= 10) {
    const deep = recentTsb.filter((t) => t.tsb < -20).length;
    const mild = recentTsb.filter((t) => t.tsb < -10).length;
    if (deep >= 10) {
      score += 20;
      factors.push({ label: 'Chronically deep fatigue', detail: `Form below −20 on ${deep} of the last ${recentTsb.length} days with no recovery dip.`, points: 20 });
    } else if (mild >= recentTsb.length - 1) {
      score += 8;
      factors.push({ label: 'No recent freshness', detail: 'Form has stayed below −10 for two weeks. Schedule a lighter few days.', points: 8 });
    }
  }

  const sinceRide = inp.lastRide ? diffDays(inp.asOf, inp.lastRide) : null;
  if (sinceRide != null && sinceRide > 7) {
    const p = sinceRide > 14 ? 35 : 25;
    score += p;
    factors.push({ label: 'Inactive', detail: `No ride for ${sinceRide} days — fitness is decaying (or rides aren’t reaching intervals.icu).`, points: p });
  }
  if (inp.lastHard !== undefined) {
    const sinceHard = inp.lastHard ? diffDays(inp.asOf, inp.lastHard) : null;
    if ((sinceHard == null || sinceHard > 21) && (sinceRide == null || sinceRide <= 7)) {
      score += 10;
      factors.push({ label: 'No top-end stimulus', detail: sinceHard == null ? 'No hard session found recently.' : `Last hard session ${sinceHard} days ago — “stale legs” risk; a few short efforts restore sharpness.`, points: 10 });
    }
  }
  if ((inp.ctlChange28 ?? 0) > 3 && ((inp.eftpChangePct != null && inp.eftpChangePct <= 0) || inp.prsLast8w === 0)) {
    score += 10;
    factors.push({ label: 'Performance stalled', detail: 'Load is rising but power isn’t (no PRs / flat eFTP).', points: 10 });
  }
  if (inp.hrvLow) {
    score += 15;
    factors.push({ label: 'HRV suppressed', detail: '7-day HRV is below the normal range.', points: 15 });
  }
  if (inp.rhrHigh) {
    score += 10;
    factors.push({ label: 'Resting HR elevated', detail: '7-day resting HR is above baseline.', points: 10 });
  }

  score = Math.min(100, score);
  const level: Staleness['level'] = score >= 50 ? 'high' : score >= 25 ? 'moderate' : 'low';
  const summary =
    level === 'high'
      ? 'High staleness risk — reduce load and add variety and rest before pushing on.'
      : level === 'moderate'
        ? 'Some staleness warning signs — worth adjusting this week.'
        : 'Low staleness risk — training looks varied and absorbable.';
  return { score, level, monotony, strain, strainVsUsual, factors, summary };
}
