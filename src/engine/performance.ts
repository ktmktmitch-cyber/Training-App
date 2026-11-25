// Performance analysis: "am I actually getting fitter?"
//
//  * FTP estimate blended from (1) intervals.icu eFTP, (2) your best recent efforts
//    (intervals.icu per-ride power model / detected intervals) and (3) a sub-maximal,
//    heart-rate-based estimate: power at your LTHR from a model fitted to your rides.
//  * Conditions-adjusted efficiency: heart rate depends on power AND on temperature,
//    indoor vs outdoor (less cooling), form/fatigue (TSB), ride duration (cardiac drift)
//    and fitness. A multivariable fit HR ~ power + temp + indoor + TSB + duration + time
//    separates those, so the fitness trend isn't fooled by a heatwave or a trainer block.
//  * Best-effort progression (1/5/20 min) and aerobic decoupling, combined into a verdict.
import { addDays, diffDays } from './dates';
import { linearTrend, mean, ols, round, sd } from './stats';
import { hrConfounders, RIDE_TAGS, RIDE_TAG_BY_KEY, type RideTag } from './rideContext';
import type { Activity, AthleteProfile, ISODate, Wellness } from './types';

export interface RidePoint {
  date: ISODate;
  name: string;
  np: number;
  hr: number;
  tempC: number;
  indoor: boolean;
  tsb: number;
  hours: number;
  ef: number; // NP / HR
  efAdj: number; // NP / conditions-standardised HR
  /** ride context you logged (caffeine, stimulant, indoor no fan…) */
  tags?: RideTag[];
}

export interface ConditionsModel {
  n: number;
  r2: number;
  bpmPerWatt: number;
  bpmPerDegree: number | null; // per °C above 15 °C
  bpmIndoor: number | null;
  bpmPerTsb: number;
  bpmPerHour: number;
  bpmPerWeek: number; // fitness drift at fixed power/conditions (negative = fitter)
  wattsPerMonthAtSameHr: number;
  /** your personal heart-rate effect of each logged ride context, learned from your rides */
  tagEffects?: { tag: RideTag; label: string; bpm: number; n: number }[];
  /** rides left out because a logged context makes their heart rate unrepresentative */
  excluded?: { n: number; tags: RideTag[] };
}

export interface FtpSource {
  key: 'eftp' | 'best' | 'hr';
  label: string;
  value: number;
  detail: string;
  weight: number;
}

export interface FtpEstimate {
  current: number | null;
  estimate: number | null;
  low: number | null;
  high: number | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  sources: FtpSource[];
  suggestion: string;
  staleDays: number | null; // days since a hard 5-60 min effort
  history: { date: ISODate; eftp: number }[];
}

export interface Factor {
  label: string;
  value: string;
  direction: 'up' | 'down' | 'flat' | 'na';
  good: boolean | null;
  detail: string;
}

export interface Improvement {
  verdict: 'improving' | 'stable' | 'declining' | 'unknown';
  score: number;
  factors: Factor[];
  summary: string;
}

export interface BestEffort {
  label: string;
  secs: number;
  recent: number | null;
  previous: number | null;
  changePct: number | null;
}

export interface PerformanceAnalysis {
  ftp: FtpEstimate;
  model: ConditionsModel | null;
  points: RidePoint[];
  efTrendPctPerMonth: number | null;
  bestEfforts: BestEffort[];
  improvement: Improvement;
  conditionsNote: string | null;
}

const fmtDur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}` : s >= 60 ? `${Math.round(s / 60)} min` : `${s}s`);

function tsbOn(wellness: Map<ISODate, Wellness>, date: ISODate): number {
  const w = wellness.get(addDays(date, -1));
  return w && w.ctl != null && w.atl != null ? w.ctl - w.atl : 0;
}

export function analyzePerformance(activities: Activity[], wellnessAll: Wellness[], profile: AthleteProfile | null, asOf: ISODate): PerformanceAnalysis {
  const wmap = new Map(wellnessAll.map((w) => [w.date, w]));
  const ftpNow = profile?.ftp ?? profile?.eftp ?? null;
  const lthr = profile?.lthr ?? null;

  // ---------- ride points ----------
  const points: RidePoint[] = [];
  for (const a of activities) {
    const age = diffDays(asOf, a.date);
    if (!a.isRide || age < 0 || age > 150) continue;
    const ftp = a.ftp ?? ftpNow;
    if (!a.normalizedPower || !a.avgHr || !ftp || a.avgHr < 90 || a.movingSec < 30 * 60) continue;
    const rel = a.normalizedPower / ftp;
    if (rel < 0.45 || rel > 1.0) continue;
    if (a.vi != null && a.vi > 1.25) continue;
    points.push({
      date: a.date,
      name: a.name,
      np: a.normalizedPower,
      hr: a.avgHr,
      tempC: a.tempC ?? (a.indoor ? 21 : 15),
      indoor: !!a.indoor,
      tsb: tsbOn(wmap, a.date),
      hours: a.movingSec / 3600,
      ef: a.normalizedPower / a.avgHr,
      efAdj: a.normalizedPower / a.avgHr,
      tags: (a.context ?? []) as RideTag[],
    });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));

  // ---------- ride context ----------
  // Tags seen on enough rides (and missing from enough) are learned as personal bpm effects;
  // strong confounders that can't be learned yet keep that ride out of the heart-rate model.
  const learnTags = RIDE_TAGS.filter((d) => d.learn && points.filter((p) => p.tags!.includes(d.key)).length >= 4 && points.filter((p) => !p.tags!.includes(d.key)).length >= 4).map((d) => d.key);
  const learned = new Set<RideTag>(learnTags);
  const excludedTags = new Set<RideTag>();
  let excludedN = 0;
  for (let i = points.length - 1; i >= 0; i--) {
    const bad = (points[i].tags ?? []).filter((t) => RIDE_TAG_BY_KEY[t]?.effect === 'strong' && !learned.has(t));
    if (bad.length) {
      bad.forEach((t) => excludedTags.add(t));
      excludedN++;
      points.splice(i, 1);
    }
  }

  // ---------- conditions model ----------
  let model: ConditionsModel | null = null;
  let beta: Record<string, number> | null = null;
  if (points.length >= 12) {
    const indoorN = points.filter((p) => p.indoor).length;
    const useIndoor = indoorN >= 3 && points.length - indoorN >= 3;
    let useTemp = sd(points.map((p) => p.tempC)) >= 2;
    const fit = () => {
      const cols = ['c', 'np', ...(useTemp ? ['temp'] : []), ...(useIndoor ? ['indoor'] : []), 'tsb', 'hours', 'weeks', ...learnTags.map((t) => `tag:${t}`)];
      const X = points.map((p) => {
        const row: Record<string, number> = {
          c: 1,
          np: p.np,
          temp: p.tempC - 15,
          indoor: p.indoor ? 1 : 0,
          tsb: p.tsb,
          hours: p.hours - 1.5,
          weeks: diffDays(p.date, asOf) / 7,
          ...Object.fromEntries(learnTags.map((t) => [`tag:${t}`, p.tags!.includes(t) ? 1 : 0])),
        };
        return cols.map((c) => row[c]);
      });
      const r = ols(X, points.map((p) => p.hr), 1e-4);
      return r ? { r2: r.r2, b: Object.fromEntries(cols.map((c, i) => [c, r.beta[i]])) as Record<string, number> } : null;
    };
    let res = fit();
    // Heat can only raise heart rate at a given power — drop a physiologically implausible temperature term
    if (res && useTemp && (res.b.temp < 0 || res.b.temp > 2)) {
      useTemp = false;
      res = fit();
    }
    if (res && res.b.np > 0.02) {
      beta = res.b;
      model = {
        n: points.length,
        r2: round(res.r2, 2),
        bpmPerWatt: round(res.b.np, 3),
        bpmPerDegree: useTemp ? round(res.b.temp, 2) : null,
        bpmIndoor: useIndoor ? round(res.b.indoor, 1) : null,
        bpmPerTsb: round(res.b.tsb, 2),
        bpmPerHour: round(res.b.hours, 1),
        bpmPerWeek: round(res.b.weeks, 2),
        wattsPerMonthAtSameHr: round((-res.b.weeks / res.b.np) * 4.35, 1),
        tagEffects: learnTags.map((t) => ({ tag: t, label: RIDE_TAG_BY_KEY[t].short, bpm: round(res!.b[`tag:${t}`], 1), n: points.filter((p) => p.tags!.includes(t)).length })),
        excluded: excludedN ? { n: excludedN, tags: [...excludedTags] } : undefined,
      };
      for (const p of points) {
        const tagAdj = learnTags.reduce((acc, t) => acc + (p.tags!.includes(t) ? (beta![`tag:${t}`] ?? 0) : 0), 0);
        const hrStd = p.hr - (beta.temp ?? 0) * (p.tempC - 15) - (beta.indoor ?? 0) * (p.indoor ? 1 : 0) - beta.tsb * p.tsb - beta.hours * (p.hours - 1.5) - tagAdj;
        p.efAdj = round(p.np / Math.max(60, hrStd), 3);
      }
    }
  }
  for (const p of points) {
    p.ef = round(p.ef, 3);
    if (!model) p.efAdj = p.ef;
  }

  const recent90 = points.filter((p) => diffDays(asOf, p.date) <= 90);
  const tr = linearTrend(
    recent90.map((p) => diffDays(p.date, asOf)),
    recent90.map((p) => p.efAdj),
  );
  const efTrendPctPerMonth = tr && recent90.length >= 6 ? round(((tr.slope * 30) / mean(recent90.map((p) => p.efAdj))) * 100, 1) : null;

  // ---------- FTP sources ----------
  const sources: FtpSource[] = [];
  const history = wellnessAll
    .filter((w) => w.eftp && diffDays(asOf, w.date) >= 0 && diffDays(asOf, w.date) <= 180)
    .map((w) => ({ date: w.date, eftp: round(w.eftp as number, 0) }));
  const eftp = history.length ? history[history.length - 1].eftp : (profile?.eftp ?? null);
  if (eftp) sources.push({ key: 'eftp', label: 'intervals.icu eFTP', value: Math.round(eftp), detail: 'From your power-duration curve (last ~6 weeks of maximal efforts).', weight: 0.5 });

  let best: { value: number; date: ISODate; detail: string } | null = null;
  let lastHard: ISODate | null = null;
  for (const a of activities) {
    const age = diffDays(asOf, a.date);
    if (!a.isRide || age < 0) continue;
    if (age <= 42 && a.pmFtp && a.pmFtpSecs && a.pmFtpSecs >= 180 && a.pmFtpWatts) {
      if (!best || a.pmFtp > best.value) best = { value: a.pmFtp, date: a.date, detail: `${fmtDur(a.pmFtpSecs)} @ ${a.pmFtpWatts} W` };
    }
    const ftp = a.ftp ?? ftpNow;
    for (const e of a.efforts ?? []) {
      if (!ftp) continue;
      if (e.secs >= 300 && e.watts >= ftp * 0.98 && (!lastHard || a.date > lastHard)) lastHard = a.date;
      if (age <= 42 && e.secs >= 480 && e.secs <= 3600) {
        const est = Math.round(e.watts * (e.secs / 3600) ** 0.07);
        if (!best || est > best.value) best = { value: est, date: a.date, detail: `${fmtDur(e.secs)} @ ${e.watts} W` };
      }
    }
    if (a.pmFtpSecs && a.pmFtpSecs >= 300 && a.pmFtpWatts && ftp && a.pmFtpWatts >= ftp * 0.98 && (!lastHard || a.date > lastHard)) lastHard = a.date;
  }
  if (best) sources.push({ key: 'best', label: 'Best recent effort', value: Math.round(best.value), detail: `${best.detail} on ${best.date} (last 6 weeks).`, weight: 0.35 });

  if (beta && model && lthr && model.r2 >= 0.4) {
    const p = (lthr - beta.c) / beta.np; // standard conditions: 15 °C, outdoor, TSB 0, 1.5 h, today
    if (ftpNow && p > ftpNow * 0.75 && p < ftpNow * 1.3)
      sources.push({ key: 'hr', label: 'Power at LTHR (heart rate)', value: Math.round(p), detail: `Sub-maximal estimate from ${model.n} rides, standardised to 15 °C outdoors, normal form. LTHR ${lthr} bpm.`, weight: model.r2 >= 0.6 ? 0.2 : 0.1 });
  }

  let estimate: number | null = null;
  let low: number | null = null;
  let high: number | null = null;
  let confidence: FtpEstimate['confidence'] = 'none';
  if (sources.length) {
    const wsum = sources.reduce((a, s) => a + s.weight, 0);
    estimate = Math.round(sources.reduce((a, s) => a + s.value * s.weight, 0) / wsum);
    low = Math.min(...sources.map((s) => s.value));
    high = Math.max(...sources.map((s) => s.value));
    const spread = estimate ? (high - low) / estimate : 1;
    const bestRecent = best ? diffDays(asOf, best.date) <= 21 : false;
    confidence = sources.length >= 2 && spread <= 0.04 && bestRecent ? 'high' : sources.length >= 2 && spread <= 0.08 ? 'medium' : 'low';
  }
  const staleDays = lastHard ? diffDays(asOf, lastHard) : null;
  let suggestion = 'Not enough power data to estimate FTP yet.';
  if (estimate && ftpNow) {
    const diff = (estimate - ftpNow) / ftpNow;
    if (Math.abs(diff) >= 0.03)
      suggestion = `Your FTP setting (${ftpNow} W) is ${diff > 0 ? 'below' : 'above'} the estimate by ${Math.abs(Math.round(diff * 100))}% — consider ${diff > 0 ? 'raising' : 'lowering'} it to ~${estimate} W so zones and TSS stay accurate.`;
    else suggestion = `Your FTP setting (${ftpNow} W) matches the estimate — no change needed.`;
    if (staleDays == null || staleDays > 42)
      suggestion += ' No hard 5-60 min effort in 6 weeks, so maximal estimates may be stale — a test or a hard climb when fresh (form > 0) would sharpen it.';
  }

  // ---------- best efforts (lower bounds from detected efforts) ----------
  const buckets: [string, number][] = [
    ['1 min', 60],
    ['5 min', 300],
    ['20 min', 1200],
  ];
  const bestEfforts: BestEffort[] = buckets.map(([label, secs]) => {
    const win = (from: number, to: number) => {
      let bestW: number | null = null;
      for (const a of activities) {
        const age = diffDays(asOf, a.date);
        if (!a.isRide || age < from || age > to) continue;
        const cands = [...(a.efforts ?? []).map((e) => ({ s: e.secs, w: e.watts })), ...(a.pmFtpSecs && a.pmFtpWatts ? [{ s: a.pmFtpSecs, w: a.pmFtpWatts }] : [])];
        for (const c of cands) if (c.s >= secs && (bestW == null || c.w > bestW)) bestW = c.w;
      }
      return bestW;
    };
    const recent = win(0, 42);
    const previous = win(43, 84);
    return { label, secs, recent, previous, changePct: recent && previous ? round(((recent - previous) / previous) * 100, 1) : null };
  });

  // ---------- improvement verdict ----------
  const factors: Factor[] = [];
  let score = 0;
  let available = 0;
  const eftpThen = history.filter((h) => diffDays(asOf, h.date) >= 42).slice(-1)[0]?.eftp ?? history[0]?.eftp;
  if (eftp && eftpThen && history.length >= 14) {
    const ch = round(((eftp - eftpThen) / eftpThen) * 100, 1);
    available++;
    const dir = ch > 1.5 ? 'up' : ch < -1.5 ? 'down' : 'flat';
    score += dir === 'up' ? 2 : dir === 'down' ? -2 : 0;
    factors.push({ label: 'eFTP (6 weeks)', value: `${ch >= 0 ? '+' : ''}${ch}%`, direction: dir, good: dir === 'flat' ? null : dir === 'up', detail: `${eftpThen} → ${eftp} W` });
  }
  if (efTrendPctPerMonth != null) {
    available++;
    const dir = efTrendPctPerMonth > 1 ? 'up' : efTrendPctPerMonth < -1 ? 'down' : 'flat';
    score += dir === 'up' ? 1.5 : dir === 'down' ? -1.5 : 0;
    factors.push({
      label: model ? 'Efficiency (conditions-adjusted)' : 'Efficiency (NP/HR)',
      value: `${efTrendPctPerMonth >= 0 ? '+' : ''}${efTrendPctPerMonth}%/month`,
      direction: dir,
      good: dir === 'flat' ? null : dir === 'up',
      detail: model
        ? `≈ ${model.wattsPerMonthAtSameHr >= 0 ? '+' : ''}${model.wattsPerMonthAtSameHr} W/month at the same heart rate, after removing temperature, indoor, fatigue and duration effects.`
        : 'Power per heartbeat on steady rides (not enough rides yet to adjust for conditions).',
    });
  }
  const be = bestEfforts.filter((b) => b.changePct != null);
  if (be.length) {
    available++;
    const avg = round(mean(be.map((b) => b.changePct as number)), 1);
    const dir = avg > 2 ? 'up' : avg < -2 ? 'down' : 'flat';
    score += dir === 'up' ? 1 : dir === 'down' ? -1 : 0;
    factors.push({ label: 'Best efforts vs previous 6 weeks', value: `${avg >= 0 ? '+' : ''}${avg}%`, direction: dir, good: dir === 'flat' ? null : dir === 'up', detail: be.map((b) => `${b.label} ${b.changePct! >= 0 ? '+' : ''}${b.changePct}%`).join(' · ') });
  }
  const dec = (from: number, to: number) => {
    const v = activities
      .filter((a) => a.isRide && a.decoupling != null && a.movingSec >= 75 * 60 && (a.intensity ?? 1) <= 0.78 && diffDays(asOf, a.date) >= from && diffDays(asOf, a.date) <= to && !hrConfounders(a).length)
      .map((a) => a.decoupling as number);
    return v.length >= 2 ? mean(v) : null;
  };
  const decNow = dec(0, 21);
  const decPrev = dec(22, 63);
  if (decNow != null && decPrev != null) {
    available++;
    const d = round(decNow - decPrev, 1);
    const dir = d < -1 ? 'up' : d > 1 ? 'down' : 'flat';
    score += dir === 'up' ? 0.5 : dir === 'down' ? -0.5 : 0;
    factors.push({ label: 'Aerobic decoupling', value: `${round(decNow, 1)}% (${d >= 0 ? '+' : ''}${d} pts)`, direction: dir, good: dir === 'flat' ? null : dir === 'up', detail: 'Lower drift on long easy rides = better aerobic durability.' });
  }
  const ctlNow = [...wellnessAll].reverse().find((w) => w.ctl != null && diffDays(asOf, w.date) >= 0);
  const ctlThen = [...wellnessAll].reverse().find((w) => w.ctl != null && diffDays(asOf, w.date) >= 42);
  if (ctlNow?.ctl != null && ctlThen?.ctl != null) {
    const d = round(ctlNow.ctl - ctlThen.ctl, 1);
    factors.push({ label: 'Fitness (CTL, 6 weeks)', value: `${d >= 0 ? '+' : ''}${d}`, direction: d > 2 ? 'up' : d < -2 ? 'down' : 'flat', good: null, detail: 'Training load — context for the performance markers above.' });
  }
  const verdict: Improvement['verdict'] = available < 2 ? 'unknown' : score >= 1.5 ? 'improving' : score <= -1.5 ? 'declining' : 'stable';
  const summary = {
    improving: 'Yes — your performance markers are moving the right way.',
    stable: 'Holding steady — fitness is being maintained rather than built.',
    declining: 'Performance markers are slipping — check recovery, consistency and whether load is too high or too low.',
    unknown: 'Not enough power + heart-rate data yet to judge.',
  }[verdict];

  let conditionsNote: string | null = null;
  if (model) {
    const parts: string[] = [];
    if (model.bpmPerDegree != null) parts.push(`+10 °C ≈ ${model.bpmPerDegree * 10 >= 0 ? '+' : ''}${round(model.bpmPerDegree * 10, 1)} bpm`);
    if (model.bpmIndoor != null) parts.push(`indoors ≈ ${model.bpmIndoor >= 0 ? '+' : ''}${model.bpmIndoor} bpm`);
    parts.push(`10 points more fatigue (TSB −10) ≈ ${round(-model.bpmPerTsb * 10, 1) >= 0 ? '+' : ''}${round(-model.bpmPerTsb * 10, 1)} bpm`);
    parts.push(`each extra hour ≈ ${model.bpmPerHour >= 0 ? '+' : ''}${model.bpmPerHour} bpm`);
    conditionsNote = `At the same power, in your data: ${parts.join(' · ')} (model fit R² ${model.r2}, ${model.n} rides).`;
  }

  return {
    ftp: { current: ftpNow, estimate, low, high, confidence, sources, suggestion, staleDays, history },
    model,
    points,
    efTrendPctPerMonth,
    bestEfforts,
    improvement: { verdict, score: round(score, 1), factors, summary },
    conditionsNote,
  };
}
