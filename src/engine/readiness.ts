// Readiness from HRV (ln rMSSD 7-day rolling vs personal baseline ± SWC), resting HR,
// sleep, training stress balance and optional subjective check-in.
//
// Method notes
//  * HRV: compare the 7-day rolling mean of ln(rMSSD) with a ~60-day baseline. The
//    "normal range" is baseline ± 0.5 SD (smallest worthwhile change), the approach used
//    in HRV-guided cycling studies (e.g. Javaloyes et al. 2019) and HRV4Training-style apps.
//    A single low morning matters less than a suppressed rolling average.
//  * RHR: 7-day mean vs baseline; a sustained rise is a classic fatigue/illness sign.
//  * Convergent signals (HRV down AND RHR up) carry more weight than either alone.
import { addDays, diffDays } from './dates';
import { clamp, mean, round, sd } from './stats';
import type { CheckIn, ISODate, PeriodizationModel, Readiness, ReadinessFlag, Wellness } from './types';

interface Opts {
  checkIn?: CheckIn | null;
  model?: PeriodizationModel;
}

function inWindow(w: Wellness, from: ISODate, to: ISODate) {
  return diffDays(w.date, from) >= 0 && diffDays(to, w.date) >= 0;
}

export function assessReadiness(wellnessAll: Wellness[], asOf: ISODate, opts: Opts = {}): Readiness {
  const wellness = [...wellnessAll].filter((w) => diffDays(asOf, w.date) >= 0).sort((a, b) => a.date.localeCompare(b.date));
  const flags: ReadinessFlag[] = [];
  let score = 100;
  let signals = 0;

  const todayW = wellness.find((w) => w.date === asOf) ?? null;
  const latest = [...wellness].reverse().find((w) => w.ctl != null) ?? null;

  // ---------- HRV ----------
  const hrvPts = wellness.filter((w) => w.hrv && w.hrv > 0) as (Wellness & { hrv: number })[];
  const recent = hrvPts.filter((w) => inWindow(w, addDays(asOf, -6), asOf));
  let baseWin = hrvPts.filter((w) => inWindow(w, addDays(asOf, -67), addDays(asOf, -7)));
  let shortBaseline = false;
  if (baseWin.length < 14) {
    baseWin = hrvPts.filter((w) => inWindow(w, addDays(asOf, -60), asOf));
    shortBaseline = true;
  }
  const hrv: Readiness['hrv'] = { today: null, avg7: null, baseline: null, low: null, high: null, cv7: null, trend: null };
  let hrvBelow = false;
  if (recent.length >= 3 && baseWin.length >= 7) {
    signals++;
    const lnBase = baseWin.map((w) => Math.log(w.hrv));
    const mu = mean(lnBase);
    const sigma = Math.max(sd(lnBase), 0.03);
    const lnRecent = recent.map((w) => Math.log(w.hrv));
    const avg7 = mean(lnRecent);
    const lo = mu - 0.5 * sigma;
    const hi = mu + 0.5 * sigma;
    hrv.avg7 = round(Math.exp(avg7));
    hrv.baseline = round(Math.exp(mu));
    hrv.low = round(Math.exp(lo));
    hrv.high = round(Math.exp(hi));
    hrv.cv7 = lnRecent.length >= 3 ? round((sd(lnRecent) / avg7) * 100, 1) : null;
    const todayHrv = todayW?.hrv ?? null;
    hrv.today = todayHrv;

    const prev = hrvPts.filter((w) => inWindow(w, addDays(asOf, -13), addDays(asOf, -7))).map((w) => Math.log(w.hrv));
    if (prev.length >= 3) {
      const d = avg7 - mean(prev);
      hrv.trend = d > 0.25 * sigma ? 'up' : d < -0.25 * sigma ? 'down' : 'flat';
    }

    if (avg7 < mu - sigma) {
      score -= 30;
      hrvBelow = true;
      flags.push({
        id: 'hrv-low',
        level: 'bad',
        title: 'HRV well below normal',
        detail: `7-day HRV ${hrv.avg7} ms is well under your normal range (${hrv.low}–${hrv.high} ms). Prioritise recovery.`,
      });
    } else if (avg7 < lo) {
      score -= 20;
      hrvBelow = true;
      flags.push({
        id: 'hrv-below',
        level: 'warn',
        title: 'HRV below normal range',
        detail: `7-day HRV ${hrv.avg7} ms is below your normal range (${hrv.low}–${hrv.high} ms). Keep intensity low until it recovers.`,
      });
    } else if (avg7 > hi) {
      flags.push({
        id: 'hrv-high',
        level: 'good',
        title: 'HRV above normal',
        detail: `7-day HRV ${hrv.avg7} ms is above your usual range (${hrv.low}–${hrv.high} ms) — typically a sign you are absorbing training well.`,
      });
    } else {
      flags.push({
        id: 'hrv-normal',
        level: 'good',
        title: 'HRV in normal range',
        detail: `7-day HRV ${hrv.avg7} ms sits inside your normal range (${hrv.low}–${hrv.high} ms).`,
      });
    }
    if (todayHrv && Math.log(todayHrv) < mu - 1.5 * sigma) {
      score -= 10;
      flags.push({
        id: 'hrv-today',
        level: 'warn',
        title: 'Low HRV this morning',
        detail: `Today's HRV (${todayHrv} ms) is unusually low. One low reading is not a trend, but consider a softer start to the week.`,
      });
    }
    // Rolling CV: day-to-day instability often precedes a drop in the average
    const baseCvs: number[] = [];
    for (let i = 7; i <= 60; i += 7) {
      const win = hrvPts.filter((w) => inWindow(w, addDays(asOf, -i - 6), addDays(asOf, -i))).map((w) => Math.log(w.hrv));
      if (win.length >= 4) baseCvs.push((sd(win) / mean(win)) * 100);
    }
    if (hrv.cv7 != null && baseCvs.length >= 3) {
      const typical = mean(baseCvs);
      if (hrv.cv7 > typical * 1.6 && hrv.cv7 > 5) {
        score -= 5;
        flags.push({
          id: 'hrv-cv',
          level: 'info',
          title: 'HRV unusually variable',
          detail: `Day-to-day HRV variation (CV ${hrv.cv7}%) is higher than your typical ${round(typical, 1)}%. Often linked to stress, travel, alcohol or poor sleep.`,
        });
      }
    }
    if (shortBaseline) {
      flags.push({
        id: 'hrv-baseline',
        level: 'info',
        title: 'Short HRV history',
        detail: 'Less than ~3 weeks of HRV history — the normal range will become more reliable with more mornings of data.',
      });
    }
  }

  // ---------- Resting HR ----------
  const rhrPts = wellness.filter((w) => w.rhr && w.rhr > 0) as (Wellness & { rhr: number })[];
  const rhrRecent = rhrPts.filter((w) => inWindow(w, addDays(asOf, -6), asOf)).map((w) => w.rhr);
  let rhrBaseWin = rhrPts.filter((w) => inWindow(w, addDays(asOf, -67), addDays(asOf, -7))).map((w) => w.rhr);
  if (rhrBaseWin.length < 14) rhrBaseWin = rhrPts.filter((w) => inWindow(w, addDays(asOf, -60), asOf)).map((w) => w.rhr);
  const rhr: Readiness['rhr'] = { today: todayW?.rhr ?? null, avg7: null, baseline: null, sd: null };
  let rhrHigh = false;
  if (rhrRecent.length >= 3 && rhrBaseWin.length >= 7) {
    signals++;
    const mu = mean(rhrBaseWin);
    const sigma = Math.max(sd(rhrBaseWin), 1.5);
    const avg7 = mean(rhrRecent);
    rhr.avg7 = round(avg7, 1);
    rhr.baseline = round(mu, 1);
    rhr.sd = round(sigma, 1);
    if (avg7 > mu + Math.max(sigma, 2.5)) {
      score -= 15;
      rhrHigh = true;
      flags.push({
        id: 'rhr-high',
        level: 'warn',
        title: 'Resting HR elevated',
        detail: `7-day resting HR ${round(avg7)} bpm vs your baseline ${round(mu)} bpm. Sustained elevation can indicate accumulated fatigue, heat, or illness coming on.`,
      });
    } else if (avg7 < mu - sigma) {
      flags.push({
        id: 'rhr-low',
        level: 'good',
        title: 'Resting HR low',
        detail: `7-day resting HR ${round(avg7)} bpm is below your baseline (${round(mu)} bpm).`,
      });
    } else {
      flags.push({
        id: 'rhr-normal',
        level: 'good',
        title: 'Resting HR normal',
        detail: `7-day resting HR ${round(avg7)} bpm vs baseline ${round(mu)} bpm.`,
      });
    }
    if (rhr.today != null && rhr.today > mu + Math.max(1.5 * sigma, 5)) {
      score -= 10;
      rhrHigh = true;
      flags.push({
        id: 'rhr-today',
        level: 'warn',
        title: 'High resting HR this morning',
        detail: `Today's resting HR (${rhr.today} bpm) is ${round(rhr.today - mu)} bpm above baseline.`,
      });
    }
  }
  if (hrvBelow && rhrHigh) {
    score -= 10;
    flags.push({
      id: 'convergent',
      level: 'bad',
      title: 'HRV down and resting HR up',
      detail: 'Both markers point the same way, which is a more reliable fatigue signal than either alone.',
    });
  }

  // ---------- Sleep ----------
  const sleepPts = wellness.filter((w) => inWindow(w, addDays(asOf, -2), asOf) && w.sleepSec && w.sleepSec > 0);
  const sleepAvg3h = sleepPts.length ? round(mean(sleepPts.map((w) => (w.sleepSec as number) / 3600)), 1) : null;
  const scorePts = wellness.filter((w) => inWindow(w, addDays(asOf, -2), asOf) && w.sleepScore).map((w) => w.sleepScore as number);
  if (sleepAvg3h != null) {
    signals++;
    if (sleepAvg3h < 5.5) {
      score -= 15;
      flags.push({ id: 'sleep-bad', level: 'bad', title: 'Very short sleep', detail: `Averaging ${sleepAvg3h} h over the last 3 nights.` });
    } else if (sleepAvg3h < 6.5) {
      score -= 8;
      flags.push({ id: 'sleep-short', level: 'warn', title: 'Short sleep', detail: `Averaging ${sleepAvg3h} h over the last 3 nights — aim for 7-9 h in hard weeks.` });
    }
  }
  if (scorePts.length >= 2 && mean(scorePts) < 50) {
    score -= 5;
    flags.push({ id: 'sleep-score', level: 'info', title: 'Poor sleep scores', detail: `Average sleep score ${round(mean(scorePts))} over the last 3 nights.` });
  }

  // ---------- Training stress balance ----------
  const ctl = latest?.ctl ?? null;
  const atl = latest?.atl ?? null;
  const tsb = ctl != null && atl != null ? round(ctl - atl, 1) : null;
  const rampRate = latest?.rampRate != null ? round(latest.rampRate, 1) : null;
  if (tsb != null) {
    signals++;
    const rel = ctl ? tsb / ctl : 0;
    if (tsb < -30 || rel < -0.45) {
      score -= 25;
      flags.push({ id: 'tsb-very-low', level: 'bad', title: 'Very high fatigue', detail: `Form (TSB) is ${round(tsb)} — beyond the productive range. Absorb before adding more load.` });
    } else if (tsb < -20 || rel < -0.3) {
      score -= 10;
      flags.push({ id: 'tsb-low', level: 'warn', title: 'Deep in a training block', detail: `Form (TSB) is ${round(tsb)}. Productive if short-lived; watch HRV/RHR closely.` });
    } else if (tsb > 15) {
      flags.push({ id: 'tsb-fresh', level: 'info', title: 'Fresh', detail: `Form is +${round(tsb)}. Good time for a quality session — or a sign volume has dropped recently.` });
    }
  }
  if (rampRate != null && rampRate > 8) {
    score -= 8;
    flags.push({ id: 'ramp', level: 'warn', title: 'Fitness ramping fast', detail: `CTL rose ${rampRate} in the last week. Sustained ramps above ~5-8/week raise injury and illness risk.` });
  }

  // ---------- Subjective (intervals.icu 1..4 scales, higher = worse) ----------
  const subj: [keyof Wellness, string][] = [
    ['soreness', 'Soreness'],
    ['fatigue', 'Fatigue'],
    ['stress', 'Stress'],
  ];
  for (const [k, label] of subj) {
    const v = todayW?.[k] as number | null | undefined;
    if (v != null && v >= 3) {
      score -= v >= 4 ? 12 : 6;
      flags.push({ id: `subj-${k}`, level: 'warn', title: `${label} reported ${v >= 4 ? 'very high' : 'high'}`, detail: `From today's intervals.icu wellness entry.` });
    }
  }

  // ---------- In-app check-in ----------
  const ci = opts.checkIn && opts.checkIn.date === asOf ? opts.checkIn : null;
  if (ci) {
    signals++;
    if (ci.feel === 'sick') {
      score = Math.min(score, 20);
      flags.push({ id: 'sick', level: 'bad', title: 'Feeling unwell', detail: 'Rest until symptoms clear. Above-the-neck mild symptoms: easy spinning at most; fever or chest symptoms: no training.' });
    } else if (ci.feel === 'tired') {
      score -= 15;
      flags.push({ id: 'ci-tired', level: 'warn', title: 'You feel tired', detail: 'Subjective fatigue is one of the most sensitive markers of overreaching.' });
    } else if (ci.feel === 'sore') {
      score -= 8;
      flags.push({ id: 'ci-sore', level: 'warn', title: 'You feel sore', detail: 'Delay heavy lower-body lifting and favour easy riding first.' });
    } else if (ci.feel === 'great') {
      score += 5;
      flags.push({ id: 'ci-great', level: 'good', title: 'You feel great', detail: 'Nice — good day for a key session.' });
    }
  }

  if (signals === 0) {
    return {
      status: 'unknown',
      score: null,
      flags: [
        {
          id: 'no-data',
          level: 'info',
          title: 'No readiness data yet',
          detail: 'Connect intervals.icu with Garmin wellness (HRV, resting HR, sleep) to adapt the plan to your recovery.',
        },
      ],
      hrv,
      rhr,
      tsb,
      ctl,
      atl,
      rampRate,
      sleepAvg3h,
      volumeModifier: 1,
      maxKeySessionsDelta: 0,
      firstDayEasy: false,
      easyDays: 0,
      summary: 'No wellness data — planning from your schedule and training history only.',
    };
  }

  score = clamp(Math.round(score), 0, 100);
  const sick = ci?.feel === 'sick';
  let status: Readiness['status'] = score >= 75 ? 'green' : score >= 55 ? 'amber' : 'red';
  // HRV-guided model: a suppressed HRV average alone means "no intensity today" (Javaloyes et al. 2019)
  if (opts.model === 'hrv_flex' && hrvBelow && status === 'green') status = 'amber';

  const mods = sick
    ? { volumeModifier: 0.5, maxKeySessionsDelta: -2, firstDayEasy: true, easyDays: 3 }
    : status === 'red'
      ? { volumeModifier: 0.75, maxKeySessionsDelta: -1, firstDayEasy: true, easyDays: 2 }
      : status === 'amber'
        ? { volumeModifier: 0.9, maxKeySessionsDelta: 0, firstDayEasy: true, easyDays: 1 }
        : { volumeModifier: 1, maxKeySessionsDelta: 0, firstDayEasy: false, easyDays: 0 };

  const summary = sick
    ? 'You reported feeling unwell — the first days are rest and the week is scaled right back.'
    : status === 'green'
      ? 'Recovery markers look good — train as planned.'
      : status === 'amber'
        ? 'Some fatigue signals — the week starts easy and volume is trimmed ~10%; key sessions move later.'
        : 'Multiple fatigue signals — two easy days first, one fewer key session and ~25% less volume.';

  return { status, score, flags, hrv, rhr, tsb, ctl, atl, rampRate, sleepAvg3h, ...mods, summary };
}
