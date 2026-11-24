// Team (coach) view: types for the team-dashboard repository's data/team.json (built every
// few hours by its GitHub Action from the coach's intervals.icu key) plus derived metrics —
// VO2max estimate, staleness risk, form zone — and optional live enrichment per athlete
// (load buckets, readiness, training status) straight from intervals.icu.
import { addDays, diffDays, mondayOf } from './dates';
import { computeLoadFocus, type LoadFocus } from './loadFocus';
import { morton } from './powerProfile';
import { assessReadiness } from './readiness';
import { computeStaleness, dailyLoadFromAtl, type Staleness } from './staleness';
import { formZone, trainingStatus, type TrainingStatus } from './status';
import { round } from './stats';
import { countsForHours, isHardSession } from './trends';
import type { Activity, AthleteProfile, CalendarEvent, ISODate, Readiness, Wellness } from './types';
import { estimateVo2, type Vo2Estimate } from './vo2max';

export interface TeamWeek {
  week: ISODate;
  hours: number;
  miles: number;
  rides: number;
}
export interface TeamTrend {
  date: ISODate;
  fitness: number;
  fatigue: number;
  form: number;
}
export interface TeamRide {
  start: string;
  date: ISODate;
  name: string;
  type: string;
  hours: number;
  miles: number | null;
  avg_watts: number | null;
  np: number | null;
  load: number | null;
}
export interface TeamPR {
  rider: string;
  duration: string;
  watts: number;
  wkg: number | null;
  date: ISODate | null;
  ride: string | null;
}
export interface TeamFeedItem {
  rider: string;
  start: string;
  date: ISODate;
  name: string;
  type: string;
  hours: number;
  miles: number | null;
  load: number | null;
}
export const POWER_KEYS = ['p5s', 'p1m', 'p3m', 'p12m', 'p20m'] as const;
export type PowerKey = (typeof POWER_KEYS)[number];
export const POWER_KEY_LABEL: Record<PowerKey, string> = { p5s: '5 s', p1m: '1 min', p3m: '3 min', p12m: '12 min', p20m: '20 min' };

export interface TeamRider {
  id: string;
  rider: string;
  state: string; // 'ok' | 'blocked'
  hidden_strava: number;
  hours_this_week: number;
  hours_last_week: number;
  hours_month: number;
  hours_ytd: number;
  miles_ytd: number;
  fitness: number | null;
  form: number | null;
  eftp_watts: number | null;
  eftp_wkg: number | null;
  prs: TeamPR[];
  weeks: TeamWeek[];
  trend: TeamTrend[];
  recent_rides: TeamRide[];
  /** published planned workouts and races (next 2 weeks) */
  planned?: { date: ISODate; category: string; name: string; type: string; minutes: number | null; load: number | null }[];
  p5s: number | null;
  p1m: number | null;
  p3m: number | null;
  p12m: number | null;
  p20m: number | null;
  p5s_pr: boolean;
  p1m_pr: boolean;
  p3m_pr: boolean;
  p12m_pr: boolean;
  p20m_pr: boolean;
}
export interface TeamData {
  updated: string;
  today: ISODate;
  riders: TeamRider[];
  feed: TeamFeedItem[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Validate/normalise a team.json payload (tolerant of missing fields). */
export function parseTeamData(raw: unknown): TeamData {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { riders?: unknown }).riders)) throw new Error('That URL did not return team-dashboard data (expected { riders: [...] }).');
  const r = raw as Record<string, unknown>;
  const riders: TeamRider[] = arr<Record<string, unknown>>(r.riders).map((x) => ({
    id: str(x.id),
    rider: str(x.rider, str(x.id)),
    state: str(x.state, 'ok'),
    hidden_strava: num(x.hidden_strava) ?? 0,
    hours_this_week: num(x.hours_this_week) ?? 0,
    hours_last_week: num(x.hours_last_week) ?? 0,
    hours_month: num(x.hours_month) ?? 0,
    hours_ytd: num(x.hours_ytd) ?? 0,
    miles_ytd: num(x.miles_ytd) ?? 0,
    fitness: num(x.fitness),
    form: num(x.form),
    eftp_watts: num(x.eftp_watts),
    eftp_wkg: num(x.eftp_wkg),
    prs: arr<Record<string, unknown>>(x.prs).map((p) => ({ rider: str(p.rider), duration: str(p.duration), watts: num(p.watts) ?? 0, wkg: num(p.wkg), date: (p.date as string) ?? null, ride: (p.ride as string) ?? null })),
    weeks: arr<Record<string, unknown>>(x.weeks).map((w) => ({ week: str(w.week), hours: num(w.hours) ?? 0, miles: num(w.miles) ?? 0, rides: num(w.rides) ?? 0 })),
    trend: arr<Record<string, unknown>>(x.trend).map((t) => ({ date: str(t.date), fitness: num(t.fitness) ?? 0, fatigue: num(t.fatigue) ?? 0, form: num(t.form) ?? 0 })),
    planned: arr<Record<string, unknown>>(x.planned).map((e) => ({ date: str(e.date), category: str(e.category), name: str(e.name), type: str(e.type), minutes: num(e.minutes), load: num(e.load) })),
    recent_rides: arr<Record<string, unknown>>(x.recent_rides).map((a) => ({
      start: str(a.start),
      date: str(a.date),
      name: str(a.name),
      type: str(a.type),
      hours: num(a.hours) ?? 0,
      miles: num(a.miles),
      avg_watts: num(a.avg_watts),
      np: num(a.np),
      load: num(a.load),
    })),
    p5s: num(x.p5s),
    p1m: num(x.p1m),
    p3m: num(x.p3m),
    p12m: num(x.p12m),
    p20m: num(x.p20m),
    p5s_pr: Boolean(x.p5s_pr),
    p1m_pr: Boolean(x.p1m_pr),
    p3m_pr: Boolean(x.p3m_pr),
    p12m_pr: Boolean(x.p12m_pr),
    p20m_pr: Boolean(x.p20m_pr),
  }));
  return {
    updated: str(r.updated),
    today: str(r.today),
    riders,
    feed: arr<Record<string, unknown>>(r.feed).map((a) => ({
      rider: str(a.rider),
      start: str(a.start),
      date: str(a.date),
      name: str(a.name),
      type: str(a.type),
      hours: num(a.hours) ?? 0,
      miles: num(a.miles),
      load: num(a.load),
    })),
  };
}

// ---------- live enrichment ----------
export interface DeepRider {
  activities: Activity[];
  wellness: Wellness[];
  profile: AthleteProfile | null;
  fetchedAt: string;
  error?: string;
  /** their intervals.icu calendar around today (sick/injured/holiday days, races, planned workouts) */
  events?: CalendarEvent[];
  /** from their synced app settings: planned breaks and how they've felt */
  plan?: { restWeeks: ISODate[]; awayWeeks: ISODate[]; offRanges: { start: ISODate; end: ISODate; note?: string }[]; sickDays: ISODate[]; sport?: string } | null;
}

export interface Availability {
  today: 'sick' | 'injured' | 'away' | 'rest week' | null;
  next: string | null; // e.g. "Away Dec 21–27"
  sickRecent: ISODate[]; // last 14 days (calendar SICK, check-in 'sick', journal 'illness')
}

/** Sick / injured / away / rest-week status for coaches, from the rider's calendar and synced settings. */
export function riderAvailability(deep: DeepRider | null | undefined, asOf: ISODate): Availability {
  const evs = deep?.events ?? [];
  const covers = (e: CalendarEvent, d: ISODate) => diffDays(d, e.date) >= 0 && diffDays(e.endDate ?? e.date, d) >= 0;
  const sickEv = evs.filter((e) => e.category === 'SICK' || e.category === 'INJURED');
  const plan = deep?.plan;
  const inRange = (d: ISODate) => (plan?.offRanges ?? []).some((r) => diffDays(d, r.start) >= 0 && diffDays(r.end, d) >= 0);
  const monday = mondayOf(asOf);
  let today: Availability['today'] = null;
  const sickNow = sickEv.find((e) => covers(e, asOf));
  if (sickNow) today = sickNow.category === 'INJURED' ? 'injured' : 'sick';
  else if ((plan?.sickDays ?? []).includes(asOf)) today = 'sick';
  else if (evs.some((e) => e.category === 'HOLIDAY' && covers(e, asOf)) || (plan?.awayWeeks ?? []).includes(monday) || inRange(asOf)) today = 'away';
  else if ((plan?.restWeeks ?? []).includes(monday)) today = 'rest week';
  const upcoming: { d: ISODate; label: string }[] = [];
  for (const w of plan?.awayWeeks ?? []) if (diffDays(w, asOf) > 0) upcoming.push({ d: w, label: `Away wk of ${w.slice(5)}` });
  for (const w of plan?.restWeeks ?? []) if (diffDays(w, asOf) > 0) upcoming.push({ d: w, label: `Rest wk of ${w.slice(5)}` });
  for (const r of plan?.offRanges ?? []) if (diffDays(r.start, asOf) > 0) upcoming.push({ d: r.start, label: `Off ${r.start.slice(5)}–${r.end.slice(5)}` });
  for (const e of evs) if (e.category === 'HOLIDAY' && diffDays(e.date, asOf) > 0) upcoming.push({ d: e.date, label: `Holiday ${e.date.slice(5)}` });
  upcoming.sort((a, b) => a.d.localeCompare(b.d));
  const sickRecent = new Set<ISODate>();
  for (let i = 0; i < 14; i++) {
    const d = addDays(asOf, -i);
    if (sickEv.some((e) => covers(e, d)) || (plan?.sickDays ?? []).includes(d)) sickRecent.add(d);
  }
  return { today, next: upcoming[0]?.label ?? null, sickRecent: [...sickRecent].sort() };
}

export interface RiderMetrics {
  weightKg: number | null;
  vo2: Vo2Estimate;
  staleness: Staleness;
  formZone: string | null;
  ctlChange28: number | null;
  rampRate: number | null;
  lastRide: ISODate | null;
  // live-only
  loadFocus: LoadFocus | null;
  readiness: Readiness | null;
  status: TrainingStatus | null;
  hoursLast4w: number | null;
}

function lastHardFromRides(r: TeamRider, asOf: ISODate): ISODate | null | undefined {
  const rides = [...r.recent_rides].sort((a, b) => b.date.localeCompare(a.date));
  for (const a of rides) {
    const ifByNp = a.np && r.eftp_watts ? a.np / r.eftp_watts : null;
    const ifByLoad = a.load && a.hours > 0 ? Math.sqrt(a.load / (a.hours * 100)) : null;
    const ifac = ifByNp ?? ifByLoad;
    if (ifac != null && ifac >= 0.85 && a.hours >= 0.6) return a.date;
  }
  const oldest = rides[rides.length - 1]?.date;
  return oldest && diffDays(asOf, oldest) >= 21 ? null : undefined;
}

export function riderMetrics(r: TeamRider, asOf: ISODate, deep?: DeepRider | null): RiderMetrics {
  const trend = [...r.trend].sort((a, b) => a.date.localeCompare(b.date));
  const last = trend[trend.length - 1];
  const at = (daysAgo: number) => [...trend].reverse().find((t) => diffDays(asOf, t.date) >= daysAgo);
  const ctlChange28 = last && at(28) ? round(last.fitness - at(28)!.fitness, 1) : null;
  const rampRate = last && at(7) ? round(last.fitness - at(7)!.fitness, 1) : null;
  const lastRide = [...r.recent_rides].sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? null;

  const liveWeight = deep?.profile?.weightKg ?? [...(deep?.wellness ?? [])].reverse().find((w) => w.weightKg)?.weightKg ?? null;
  const weightKg = liveWeight ?? (r.eftp_watts && r.eftp_wkg ? round(r.eftp_watts / r.eftp_wkg, 1) : null);
  const latestW = [...(deep?.wellness ?? [])].reverse();
  const garmin = latestW.find((w) => w.vo2max)?.vo2max ?? null;
  const modelW = latestW.find((w) => w.eftp && w.wPrime && w.pMax);
  const vo2 = estimateVo2({
    p3: r.p3m,
    p12: r.p12m,
    cp: modelW?.eftp ?? deep?.profile?.cp ?? null,
    wPrime: modelW?.wPrime ?? deep?.profile?.wPrime ?? null,
    pMax: modelW?.pMax ?? deep?.profile?.pMax ?? null,
    weightKg,
    garmin,
  });

  let loadFocus: LoadFocus | null = null;
  let readiness: Readiness | null = null;
  let status: TrainingStatus | null = null;
  let hoursLast4w: number | null = null;
  let daily = dailyLoadFromAtl(trend);
  let lastHard = lastHardFromRides(r, asOf);
  let eftpChangePct: number | null = null;
  if (!deep || deep.error) {
    // No detailed data (not shared with this key, or not loaded yet): estimate from the rides in team.json
    const est: Activity[] = r.recent_rides
      .filter((a) => a.load && a.hours > 0 && diffDays(asOf, a.date) >= 0 && diffDays(asOf, a.date) < 28)
      .map((a, i) => ({
        id: `est-${i}`,
        date: a.date,
        name: a.name,
        type: a.type,
        isRide: true,
        isStrength: false,
        movingSec: a.hours * 3600,
        tss: a.load,
        intensity: Math.sqrt((a.load as number) / (a.hours * 100)),
        normalizedPower: a.np,
        avgHr: null,
        powerZoneSecs: null,
        hrZoneSecs: null,
        source: 'intervals',
      }));
    if (est.length) loadFocus = { ...computeLoadFocus(est, asOf, 'base', 'fitness'), estimated: true };
  }
  if (deep && !deep.error) {
    loadFocus = computeLoadFocus(deep.activities, asOf, 'base', 'fitness');
    readiness = assessReadiness(deep.wellness, asOf);
    status = trainingStatus(deep.wellness, readiness, asOf);
    hoursLast4w = round(deep.activities.filter((a) => countsForHours(a) && diffDays(asOf, a.date) < 28).reduce((s, a) => s + a.movingSec, 0) / 3600, 1);
    const byDay = new Map<ISODate, number>();
    for (const a of deep.activities) byDay.set(a.date, (byDay.get(a.date) ?? 0) + (a.tss ?? 0));
    daily = Array.from({ length: 42 }, (_, i) => addDays(asOf, -i)).map((d) => ({ date: d, load: byDay.get(d) ?? 0 }));
    const hard = deep.activities.filter(isHardSession).sort((a, b) => b.date.localeCompare(a.date))[0];
    lastHard = hard?.date ?? null;
    const e = deep.wellness.filter((w) => w.eftp).sort((a, b) => a.date.localeCompare(b.date));
    const now = e[e.length - 1];
    const then = [...e].reverse().find((w) => diffDays(asOf, w.date) >= 42) ?? e[0];
    if (now && then && now !== then) eftpChangePct = round(((now.eftp! - then.eftp!) / then.eftp!) * 100, 1);
  }
  const staleness = computeStaleness({
    asOf,
    daily,
    tsb: trend.map((t) => ({ date: t.date, tsb: t.form })),
    lastRide,
    lastHard,
    prsLast8w: r.prs.length,
    eftpChangePct,
    ctlChange28,
    hrvLow: readiness ? readiness.flags.some((f) => f.id === 'hrv-low' || f.id === 'hrv-below') : null,
    rhrHigh: readiness ? readiness.flags.some((f) => f.id === 'rhr-high') : null,
  });
  return {
    weightKg,
    vo2,
    staleness,
    formZone: r.form != null ? formZone(r.form).label : null,
    ctlChange28,
    rampRate,
    lastRide,
    loadFocus,
    readiness,
    status,
    hoursLast4w,
  };
}

// ---------- build a team rider from raw intervals.icu-style data (demo, and your own row) ----------
export function riderFromData(
  id: string,
  name: string,
  activities: Activity[],
  wellness: Wellness[],
  profile: AthleteProfile | null,
  asOf: ISODate,
): TeamRider {
  const monday = mondayOf(asOf);
  const rides = activities.filter(countsForHours); // hours: rides, runs, swims
  const hoursBetween = (from: ISODate, to?: ISODate) =>
    round(rides.filter((a) => diffDays(a.date, from) >= 0 && (!to || diffDays(to, a.date) > 0)).reduce((s, a) => s + a.movingSec, 0) / 3600, 1);
  const monthStart = `${asOf.slice(0, 8)}01`;
  const yearStart = `${asOf.slice(0, 5)}01-01`;
  const weeks: TeamWeek[] = Array.from({ length: 8 }, (_, i) => {
    const ws = addDays(monday, -7 * (7 - i));
    const we = addDays(ws, 7);
    const wk = rides.filter((a) => diffDays(a.date, ws) >= 0 && diffDays(we, a.date) > 0);
    return { week: ws, hours: round(wk.reduce((s, a) => s + a.movingSec, 0) / 3600, 1), miles: Math.round(wk.length * 28), rides: wk.length };
  });
  const trend: TeamTrend[] = wellness
    .filter((w) => w.ctl != null && diffDays(asOf, w.date) >= 0 && diffDays(asOf, w.date) < 56)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => ({ date: w.date, fitness: round(w.ctl!, 1), fatigue: round(w.atl ?? 0, 1), form: round(w.ctl! - (w.atl ?? 0), 1) }));
  const lastT = trend[trend.length - 1];
  const kg = profile?.weightKg ?? null;
  const eftp = profile?.eftp ?? profile?.ftp ?? null;
  const pw = (t: number) => (profile?.cp && profile.wPrime && profile.pMax ? Math.round(morton(profile.cp, profile.wPrime, profile.pMax, t)) : null);
  const recent = [...rides]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10)
    .map((a) => ({
      start: a.startTime ?? `${a.date}T08:00:00`,
      date: a.date,
      name: a.name,
      type: a.type,
      hours: round(a.movingSec / 3600, 1),
      miles: round((a.movingSec / 3600) * 17, 1),
      avg_watts: a.avgPower ?? (a.normalizedPower ? Math.round(a.normalizedPower * 0.92) : null),
      np: a.normalizedPower,
      load: a.tss,
    }));
  return {
    id,
    rider: name,
    state: 'ok',
    hidden_strava: 0,
    hours_this_week: hoursBetween(monday),
    hours_last_week: hoursBetween(addDays(monday, -7), monday),
    hours_month: hoursBetween(monthStart),
    hours_ytd: hoursBetween(yearStart),
    miles_ytd: Math.round(hoursBetween(yearStart) * 17),
    fitness: lastT ? Math.round(lastT.fitness) : null,
    form: lastT ? Math.round(lastT.form) : null,
    eftp_watts: eftp ? Math.round(eftp) : null,
    eftp_wkg: eftp && kg ? round(eftp / kg, 2) : null,
    prs: [],
    weeks,
    trend,
    recent_rides: recent,
    p5s: pw(5),
    p1m: pw(60),
    p3m: pw(180),
    p12m: pw(720),
    p20m: pw(1200),
    p5s_pr: false,
    p1m_pr: false,
    p3m_pr: false,
    p12m_pr: false,
    p20m_pr: false,
  };
}
