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
import { TAG_BY_KEY, type MorningEffect } from './journal';
import type { CheckIn, ISODate, PeriodizationModel, Readiness, ReadinessFlag, Wellness } from './types';

interface Opts {
  checkIn?: CheckIn | null;
  model?: PeriodizationModel;
  /** Journal effects keyed by morning date (see journal.ts) */
  effects?: Record<ISODate, MorningEffect>;
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

  const eff = opts.effects ?? {};
  const okBase = (w: Wellness) => !eff[w.date]?.excludeBaseline;
  const okTrend = (w: Wellness) => !eff[w.date]?.excludeTrend;
  const explainedToday = eff[asOf]?.tags.filter((t) => TAG_BY_KEY[t]?.excludeTrend) ?? [];
  const explainLabel = explainedToday.map((t) => TAG_BY_KEY[t].short.toLowerCase()).join(' + ');

  // ---------- HRV ----------
  const hrvPts = wellness.filter((w) => w.hrv && w.hrv > 0) as (Wellness & { hrv: number })[];
  const recentAll = hrvPts.filter((w) => inWindow(w, addDays(asOf, -6), asOf));
  const recentClean = recentAll.filter(okTrend);
  const recent = recentClean.length >= 3 ? recentClean : recentAll;
  let baseWin = hrvPts.filter((w) => okBase(w) && inWindow(w, addDays(asOf, -67), addDays(asOf, -7)));
  let shortBaseline = false;
  if (baseWin.length < 14) {
    baseWin = hrvPts.filter((w) => okBase(w) && inWindow(w, addDays(asOf, -60), asOf));
    shortBaseline = true;
  }
  const hrv: Readiness['hrv'] = { today: null, avg7: null, baseline: null, low: null, high: null, cv7: null, trend: null, status: null };
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
    hrv.status = avg7 < mu - 2 * sigma ? 'poor' : avg7 < mu - sigma ? 'low' : avg7 < lo || avg7 > hi ? 'unbalanced' : 'balanced';
    const todayHrv = todayW?.hrv ?? null;
    hrv.today = todayHrv;

    const prev = hrvPts.filter((w) => okTrend(w) && inWindow(w, addDays(asOf, -13), addDays(asOf, -7))).map((w) => Math.log(w.hrv));
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
      if (explainedToday.length) {
        score -= 4;
        flags.push({
          id: 'hrv-today',
          level: 'info',
          title: `Low HRV this morning — explained (${explainLabel})`,
          detail: `Today's HRV (${todayHrv} ms) is low, most likely from ${explainLabel}, not accumulated training fatigue, so it's left out of your 7-day trend. You may still feel flat today — swap to an easier option if so.`,
        });
      } else {
        score -= 10;
        flags.push({
          id: 'hrv-today',
          level: 'warn',
          title: 'Low HRV this morning',
          detail: `Today's HRV (${todayHrv} ms) is unusually low. One low reading is not a trend, but consider a softer start to the week. If something explains it (alcohol, travel, a late meal), log it in the journal.`,
        });
      }
    }
    // Rolling CV: day-to-day instability often precedes a drop in the average
    const baseCvs: number[] = [];
    for (let i = 7; i <= 60; i += 7) {
      const win = hrvPts.filter((w) => okTrend(w) && inWindow(w, addDays(asOf, -i - 6), addDays(asOf, -i))).map((w) => Math.log(w.hrv));
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
  const rhrRecentAll = rhrPts.filter((w) => inWindow(w, addDays(asOf, -6), asOf));
  const rhrRecentClean = rhrRecentAll.filter(okTrend);
  const rhrRecent = (rhrRecentClean.length >= 3 ? rhrRecentClean : rhrRecentAll).map((w) => w.rhr);
  let rhrBaseWin = rhrPts.filter((w) => okBase(w) && inWindow(w, addDays(asOf, -67), addDays(asOf, -7))).map((w) => w.rhr);
  if (rhrBaseWin.length < 14) rhrBaseWin = rhrPts.filter((w) => okBase(w) && inWindow(w, addDays(asOf, -60), asOf)).map((w) => w.rhr);
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
      if (explainedToday.length) {
        score -= 3;
        flags.push({
          id: 'rhr-today',
          level: 'info',
          title: `High resting HR this morning — explained (${explainLabel})`,
          detail: `Today's resting HR (${rhr.today} bpm) is ${round(rhr.today - mu)} bpm above baseline, consistent with ${explainLabel}. Left out of your trend.`,
        });
      } else {
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

  // ---------- Journal exclusions summary ----------
  const excludedBase = Object.entries(eff).filter(([d, e]) => e.excludeBaseline && diffDays(asOf, d) >= 0 && diffDays(asOf, d) <= 67);
  if (excludedBase.length) {
    const counts: Record<string, number> = {};
    for (const [, e] of excludedBase) for (const t of e.tags) if (TAG_BY_KEY[t]?.excludeBaseline) counts[TAG_BY_KEY[t].short] = (counts[TAG_BY_KEY[t].short] ?? 0) + 1;
    flags.push({
      id: 'journal-excluded',
      level: 'info',
      title: `${excludedBase.length} night${excludedBase.length === 1 ? '' : 's'} kept out of your baseline`,
      detail: `From your journal: ${Object.entries(counts).map(([k, v]) => `${k} ×${v}`).join(', ')}. Your normal ranges reflect typical nights only.`,
    });
  }

  // ---------- Sleep ----------
  // Last night matters most (one short night measurably blunts high-intensity performance and mood),
  // and the 3-night average catches building sleep debt. The worse of the two counts, not both.
  const sleepPts = wellness.filter((w) => inWindow(w, addDays(asOf, -2), asOf) && w.sleepSec && w.sleepSec > 0);
  const sleepAvgRaw = sleepPts.length ? mean(sleepPts.map((w) => (w.sleepSec as number) / 3600)) : null;
  const sleepAvg3h = sleepAvgRaw != null ? round(sleepAvgRaw, 1) : null;
  const lastNightH = todayW?.sleepSec && todayW.sleepSec > 0 ? todayW.sleepSec / 3600 : null;
  const fmtH = (h: number) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')} min`;
  if (sleepAvgRaw != null || lastNightH != null) {
    signals++;
    const last =
      lastNightH == null
        ? null
        : lastNightH < 5
          ? { pts: 20, level: 'bad' as const, title: 'Very short sleep last night', detail: `${fmtH(lastNightH)} last night — expect hard efforts to feel harder; keep today easy or shorten the intensity.` }
          : lastNightH < 6
            ? { pts: 12, level: 'warn' as const, title: 'Short sleep last night', detail: `${fmtH(lastNightH)} last night — aim for 7-9 h, especially in hard weeks.` }
            : lastNightH < 7
              ? { pts: 5, level: 'info' as const, title: 'A bit short on sleep', detail: `${fmtH(lastNightH)} last night.` }
              : null;
    const avg =
      sleepAvgRaw == null || sleepPts.length < 2
        ? null
        : sleepAvgRaw < 5.5
          ? { pts: 15, level: 'bad' as const, title: 'Very short sleep', detail: `Averaging ${sleepAvg3h} h over the last 3 nights.` }
          : sleepAvgRaw < 6.5
            ? { pts: 8, level: 'warn' as const, title: 'Short sleep', detail: `Averaging ${sleepAvg3h} h over the last 3 nights — aim for 7-9 h in hard weeks.` }
            : null;
    const worst = [last, avg].filter(Boolean).sort((a, b) => b!.pts - a!.pts)[0];
    if (worst) {
      score -= worst.pts;
      flags.push({ id: worst === last ? 'sleep-last' : 'sleep-short', level: worst.level, title: worst.title, detail: worst.detail });
    }
  }
  // Sleep score (Garmin bands: 90+ excellent, 80-89 good, 60-79 fair, under 60 poor)
  const lastScore = todayW?.sleepScore ?? null;
  if (lastScore != null) {
    if (lastScore < 50) {
      score -= 8;
      flags.push({ id: 'sleep-score', level: 'warn', title: 'Poor sleep quality', detail: `Sleep score ${lastScore} last night.` });
    } else if (lastScore < 60) {
      score -= 5;
      flags.push({ id: 'sleep-score', level: 'info', title: 'Poor sleep quality', detail: `Sleep score ${lastScore} last night (under 60 is “poor”).` });
    } else if (lastScore < 70) {
      score -= 2;
    }
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
  // A serious red flag (e.g. under 5 h of sleep, very high fatigue) never reads as "ready to go"
  if (flags.some((f) => f.level === 'bad')) score = Math.min(score, 74);
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
