// Training-history analysis: weekly load, intensity distribution, recent key sessions,
// long-ride history, strength frequency, monotony/strain.
import { addDays, diffDays, fmtMinutes, mondayOf } from './dates';
import { ewma, mean, round, sd } from './stats';
import type { Activity, ISODate, Trends, Wellness } from './types';

/** A hard session in any endurance sport (rides by power zones; runs/swims by intensity or HR zones). Strength doesn't count. */
export function isHardSession(a: Activity): boolean {
  if (a.isStrength) return false;
  if (!a.isRide) {
    if (a.intensity != null && a.intensity >= 0.88 && a.movingSec >= 1200) return true;
    const hr = a.hrZoneSecs;
    if (hr && hr.slice(3).reduce((x, y) => x + y, 0) >= 900) return true;
    return false;
  }
  const z = a.powerZoneSecs;
  const highSecs = z ? z.slice(4).reduce((x, y) => x + y, 0) : 0; // Z5+
  const thrSecs = z ? (z[3] ?? 0) : 0; // Z4
  if (highSecs >= 360 || thrSecs >= 1200) return true;
  if (a.intensity != null && a.intensity >= 0.85 && a.movingSec >= 2400) return true;
  if (!z && a.hrZoneSecs) {
    const hrHigh = a.hrZoneSecs.slice(3).reduce((x, y) => x + y, 0);
    if (hrHigh >= 900) return true;
  }
  return false;
}

/** CTL/ATL computed from activity loads when intervals.icu wellness isn't available (e.g. demo/Strava). */
export function loadSeries(activities: Activity[], from: ISODate, to: ISODate): { date: ISODate; ctl: number; atl: number; load: number }[] {
  const byDay = new Map<ISODate, number>();
  for (const a of activities) byDay.set(a.date, (byDay.get(a.date) ?? 0) + (a.tss ?? 0));
  const out: { date: ISODate; ctl: number; atl: number; load: number }[] = [];
  let ctl = 0;
  let atl = 0;
  for (let d = from; diffDays(to, d) >= 0; d = addDays(d, 1)) {
    const l = byDay.get(d) ?? 0;
    ctl = ewma(ctl, l, 42);
    atl = ewma(atl, l, 7);
    out.push({ date: d, ctl, atl, load: l });
  }
  return out;
}

export function computeTrends(activities: Activity[], wellness: Wellness[], asOf: ISODate): Trends {
  const notes: string[] = [];
  const past = activities.filter((a) => diffDays(asOf, a.date) >= 0);

  // Weekly load (last 12 ISO weeks incl. current)
  const thisMonday = mondayOf(asOf);
  const weekly = Array.from({ length: 12 }, (_, i) => {
    const ws = addDays(thisMonday, -7 * (11 - i));
    const we = addDays(ws, 6);
    const acts = past.filter((a) => diffDays(a.date, ws) >= 0 && diffDays(we, a.date) >= 0);
    const endurance = acts.filter((a) => !a.isStrength);
    return {
      weekStart: ws,
      hours: round(endurance.reduce((x, a) => x + a.movingSec, 0) / 3600, 1),
      tss: Math.round(acts.reduce((x, a) => x + (a.tss ?? 0), 0)),
      rides: acts.filter((a) => a.isRide).length,
      runs: acts.filter((a) => /run/i.test(a.type) && !a.isRide).length,
      swims: acts.filter((a) => /swim/i.test(a.type)).length,
      strength: acts.filter((a) => a.isStrength).length,
    };
  });

  const last = (days: number) => past.filter((a) => diffDays(asOf, a.date) < days);
  const last28 = last(28);
  const rides28 = last28.filter((a) => a.isRide);
  // Intensity distribution counts every endurance session (rides, runs, swims …)
  const endurance28 = last28.filter((a) => !a.isStrength);

  // Intensity distribution (3-zone model: below LT1 / LT1-LT2 / above LT2)
  let pz = [0, 0, 0];
  let hz = [0, 0, 0];
  let powerSecs = 0;
  let rideSecs = 0;
  for (const r of endurance28) {
    rideSecs += r.movingSec;
    if (r.powerZoneSecs && r.powerZoneSecs.some((x) => x > 0)) {
      const z = r.powerZoneSecs;
      const low = (z[0] ?? 0) + (z[1] ?? 0);
      const mid = (z[2] ?? 0) + (z[3] ?? 0);
      const high = z.slice(4).reduce((x, y) => x + y, 0);
      pz = [pz[0] + low, pz[1] + mid, pz[2] + high];
      powerSecs += low + mid + high;
    }
    if (r.hrZoneSecs && r.hrZoneSecs.some((x) => x > 0)) {
      const z = r.hrZoneSecs;
      hz = [hz[0] + (z[0] ?? 0) + (z[1] ?? 0), hz[1] + (z[2] ?? 0) + (z[3] ?? 0), hz[2] + z.slice(4).reduce((x, y) => x + y, 0)];
    }
  }
  let distribution28: Trends['distribution28'] = { low: 0, mid: 0, high: 0, source: 'none' };
  const usePower = powerSecs > 0 && powerSecs >= rideSecs * 0.5;
  const src = usePower ? pz : hz;
  const tot = src[0] + src[1] + src[2];
  if (tot > 0) {
    distribution28 = {
      low: round(src[0] / tot, 3),
      mid: round(src[1] / tot, 3),
      high: round(src[2] / tot, 3),
      source: usePower ? 'power' : 'hr',
    };
    const lowPct = Math.round(distribution28.low * 100);
    const midPct = Math.round(distribution28.mid * 100);
    const highPct = Math.round(distribution28.high * 100);
    const shape =
      distribution28.low >= 0.75 && distribution28.high > distribution28.mid
        ? 'polarized'
        : distribution28.low >= 0.65 && distribution28.mid >= distribution28.high
          ? 'pyramidal'
          : distribution28.mid > 0.3
            ? 'threshold-heavy'
            : 'mixed';
    notes.push(`Last 4 weeks (${distribution28.source}): ${lowPct}% easy / ${midPct}% moderate / ${highPct}% hard — ${shape}.`);
    if (distribution28.low < 0.6)
      notes.push('Less than 60% of training is easy. Most high performers keep 70-90% of time below LT1 — easy days may be drifting too hard ("grey zone").');
  }

  const longestRideMin28 = Math.round(Math.max(0, ...rides28.map((r) => r.movingSec / 60)));
  const avgWeeklyHours4 = round(last28.filter((a) => !a.isStrength).reduce((x, a) => x + a.movingSec, 0) / 3600 / 4, 1);
  const avgWeeklyTss4 = Math.round(last28.reduce((x, a) => x + (a.tss ?? 0), 0) / 4);
  const hard = past.filter(isHardSession).sort((a, b) => b.date.localeCompare(a.date));
  const hardSessions14 = hard.filter((a) => diffDays(asOf, a.date) < 14).length;
  const daysSinceHard = hard.length ? diffDays(asOf, hard[0].date) : null;
  const strength = past.filter((a) => a.isStrength).sort((a, b) => b.date.localeCompare(a.date));
  const strengthSessions28 = strength.filter((a) => diffDays(asOf, a.date) < 28).length;
  const daysSinceStrength = strength.length ? diffDays(asOf, strength[0].date) : null;

  // Monotony & strain (Foster): last 7 days
  const daily = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(asOf, -i);
    return past.filter((a) => a.date === d).reduce((x, a) => x + (a.tss ?? 0), 0);
  });
  const dsd = sd(daily);
  const monotony7 = dsd > 0 ? round(mean(daily) / dsd, 2) : null;
  const strain7 = monotony7 != null ? Math.round(daily.reduce((a, b) => a + b, 0) * monotony7) : null;

  const lw = [...wellness].filter((w) => diffDays(asOf, w.date) >= 0 && w.ctl != null).sort((a, b) => b.date.localeCompare(a.date))[0];
  let ctl = lw?.ctl ?? null;
  let atl = lw?.atl ?? null;
  if (ctl == null && past.length) {
    const series = loadSeries(past, addDays(asOf, -120), asOf);
    ctl = series[series.length - 1].ctl;
    atl = series[series.length - 1].atl;
  }

  // Aerobic decoupling (Pw:HR drift) on steady endurance rides: <5% ≈ well-developed aerobic base
  const steady = past
    .filter((a) => a.isRide && a.decoupling != null && a.movingSec >= 75 * 60 && (a.intensity ?? 0) > 0 && (a.intensity ?? 1) <= 0.78 && diffDays(asOf, a.date) < 42)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);
  const decs = steady.map((a) => a.decoupling as number).sort((a, b) => a - b);
  const median = decs.length >= 2 ? round(decs[Math.floor((decs.length - 1) / 2)] / 2 + decs[Math.ceil((decs.length - 1) / 2)] / 2, 1) : null;
  const efOf = (from: number, to: number) => {
    const v = past
      .filter((a) => a.isRide && a.efficiencyFactor && a.movingSec >= 3600 && (a.intensity ?? 1) <= 0.8 && diffDays(asOf, a.date) >= from && diffDays(asOf, a.date) < to)
      .map((a) => a.efficiencyFactor as number);
    return v.length >= 2 ? mean(v) : null;
  };
  const efNow = efOf(0, 28);
  const efPrev = efOf(28, 56);
  const efChange = efNow && efPrev ? round(((efNow - efPrev) / efPrev) * 100, 1) : null;
  const aerobic: Trends['aerobic'] = {
    rides: steady.map((a) => ({ date: a.date, decoupling: round(a.decoupling as number, 1), ef: a.efficiencyFactor ?? null, minutes: Math.round(a.movingSec / 60) })),
    median,
    efChange,
    verdict: median == null ? 'unknown' : median < 5 ? 'solid' : median < 8 ? 'developing' : 'needs_work',
  };
  if (median != null)
    notes.push(
      median < 5
        ? `Aerobic decoupling on long easy rides is ${median}% (<5%) — your aerobic base is solid.`
        : median < 8
          ? `Aerobic decoupling on long easy rides is ${median}% — base still developing; keep the Zone 2 volume.`
          : `Aerobic decoupling on long easy rides is ${median}% (>8%) — heart rate drifts a lot, so long steady Zone 2 rides are the priority (heat, dehydration and stops also raise it).`,
    );

  if (longestRideMin28 > 0) notes.push(`Longest ride in the last 4 weeks: ${fmtMinutes(longestRideMin28)}.`);
  if (hardSessions14 === 0 && rides28.length > 0) notes.push('No high-intensity sessions in the last 2 weeks — interval levels start conservatively.');
  if (hardSessions14 >= 6) notes.push(`${hardSessions14} hard sessions in 14 days is a lot — make sure easy days are truly easy.`);
  if (daysSinceStrength == null) notes.push('No strength sessions found in your history.');
  else if (daysSinceStrength > 21) notes.push(`Last strength session ${daysSinceStrength} days ago — lifting restarts with an adaptation phase.`);
  if (monotony7 != null && monotony7 > 2) notes.push(`Training monotony is high (${monotony7}). Bigger contrast between hard and easy days helps adaptation.`);

  return {
    weekly,
    distribution28,
    longestRideMin28,
    avgWeeklyHours4,
    avgWeeklyTss4,
    hardSessions14,
    strengthSessions28,
    daysSinceStrength,
    monotony7,
    strain7,
    daysSinceHard,
    ctl: ctl != null ? round(ctl, 1) : null,
    atl: atl != null ? round(atl, 1) : null,
    aerobic,
    notes,
  };
}
