// Synthetic, deterministic demo data so the app can be explored without a connection.
import { addDays, dow } from '../engine/dates';
import { ewma } from '../engine/stats';
import type { PlanSnapshot } from '../engine/compliance';
import type { Journal } from '../engine/journal';
import type { Activity, AthleteProfile, CalendarEvent, ISODate, Wellness } from '../engine/types';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export const DEMO_PROFILE: AthleteProfile = {
  id: 'demo',
  name: 'Demo Rider',
  ftp: 265,
  eftp: 268,
  lthr: 172,
  maxHr: 192,
  restingHr: 48,
  weightKg: 72,
  powerZones: [55, 75, 90, 105, 120, 150, 999],
  hrZones: [137, 154, 162, 172, 177, 182, 192],
  sex: null,
  cp: 262,
  wPrime: 19500,
  pMax: 1120,
};

export interface DemoOpts {
  seed?: number;
  scale?: number; // training volume multiplier
  ftp?: number;
  weightKg?: number;
  stopDaysAgo?: number; // rider stopped training this many days ago
}

export function demoData(asOf: ISODate, opts: DemoOpts = {}): { profile: AthleteProfile; activities: Activity[]; wellness: Wellness[]; events: CalendarEvent[] } {
  const r = rng(opts.seed ?? 42);
  const vol = opts.scale ?? 1;
  const ftpBase = opts.ftp ?? 265;
  const profile: AthleteProfile = { ...DEMO_PROFILE, ftp: ftpBase, eftp: ftpBase + 3, cp: Math.round(ftpBase * 0.99), weightKg: opts.weightKg ?? DEMO_PROFILE.weightKg, wPrime: Math.round(19500 * (ftpBase / 265)), pMax: Math.round(1120 * (ftpBase / 265)) };
  const activities: Activity[] = [];
  const wellness: Wellness[] = [];
  let ctl = 45;
  let atl = 45;
  const days = 120;
  for (let i = days; i >= 0; i--) {
    const date = addDays(asOf, -i);
    const d = dow(date);
    const week = Math.floor((days - i) / 7);
    const recoveryWeek = week % 4 === 3;
    let load = 0;
    const mk = (name: string, min0: number, ifac: number, zones: number[], hard = false, rpe: number | null = null): Activity => {
      const min = Math.round(min0 * vol);
      const secs = min * 60;
      const tot = zones.reduce((a, b) => a + b, 0);
      const z = zones.map((x) => Math.round((x / tot) * secs));
      return {
        id: `demo-${date}-${name}`,
        date,
        name,
        type: 'Ride',
        isRide: true,
        isStrength: false,
        movingSec: secs,
        tss: Math.round((min / 60) * ifac * ifac * 100),
        intensity: ifac,
        normalizedPower: Math.round(ftpBase * ifac),
        avgHr: Math.round(60 + ifac * 265 * 0.42 + (d === 2 || d === 4 ? 5 : 0) + 0.25 * (8 + 10 * Math.sin((days - i) / 19) - 15) - week * 0.35 + (r() - 0.5) * 3),
        powerZoneSecs: z,
        hrZoneSecs: [z[0] + z[1] * 0.6, z[1] * 0.4 + z[2] * 0.5, z[2] * 0.5, z[3], z[4], z[5], z[6]].map(Math.round),
        source: 'demo',
        ssSecs: Math.round(z[2] * 0.3 + z[3] * 0.7),
        tempC: Math.round((8 + 10 * Math.sin((days - i) / 19) + r() * 6) * 10) / 10,
        indoor: d === 2 || d === 4,
        ftp: 255 + Math.floor(week * 0.8),
        vi: hard ? 1.08 : 1.03,
        pmFtp: hard ? Math.round((250 + week * 1.1) * (0.97 + r() * 0.04)) : null,
        pmFtpSecs: hard ? 300 : null,
        pmFtpWatts: hard ? Math.round((250 + week * 1.1) * 1.24) : null,
        decoupling: ifac < 0.75 && min >= 75 ? Math.round((3 + r() * 5) * 10) / 10 : null,
        efficiencyFactor: Math.round((1.38 + week * 0.004 + r() * 0.05) * 1000) / 1000,
        rpe,
      };
    };
    const scale = recoveryWeek ? 0.6 : 1;
    const stopped = opts.stopDaysAgo != null && i < opts.stopDaysAgo;
    if (stopped) {
      /* no training */
    } else if (d === 2) activities.push(mk('Threshold 3×12', 75 * scale, recoveryWeek ? 0.68 : 0.83, recoveryWeek ? [30, 60, 10, 0, 0, 0, 0] : [25, 35, 8, 30, 2, 0, 0], !recoveryWeek, recoveryWeek ? null : 7));
    if (!stopped && d === 3) activities.push(mk('Endurance', 60 * scale, 0.66, [25, 70, 5, 0, 0, 0, 0]));
    if (!stopped && d === 4 && !recoveryWeek) activities.push(mk('VO2 5×4', 70, 0.84, [30, 35, 5, 6, 22, 2, 0], true, 8));
    if (!stopped && d === 6) activities.push(mk('Group ride', 150 * scale, 0.78, [20, 45, 18, 10, 5, 1.5, 0.5], !recoveryWeek));
    if (!stopped && d === 0) activities.push(mk('Long endurance', 180 * scale, 0.68, [20, 72, 7, 1, 0, 0, 0]));
    if (!stopped && (d === 1 || d === 4) && week < 14 && r() > 0.25) {
      activities.push({
        id: `demo-${date}-str`,
        date,
        name: 'Strength',
        type: 'WeightTraining',
        isRide: false,
        isStrength: true,
        movingSec: 2700,
        tss: 20,
        intensity: null,
        normalizedPower: null,
        avgHr: 100,
        powerZoneSecs: null,
        hrZoneSecs: null,
        source: 'demo',
      });
    }
    load = activities.filter((a) => a.date === date).reduce((a, b) => a + (b.tss ?? 0), 0);
    ctl = ewma(ctl, load, 42);
    atl = ewma(atl, load, 7);
    const fatigue = atl - ctl;
    // demo journal nights (see demoJournal): 3+ drinks affects two mornings, 1-2 drinks one
    const boozy = i === 9 || i === 23 ? 1 : i === 8 ? 0.5 : 0;
    const hrv = Math.round(Math.exp(Math.log(62) - fatigue * 0.008 + (r() - 0.5) * 0.18) * (1 - 0.28 * boozy));
    const rhr = Math.round(48 + fatigue * 0.08 + (r() - 0.5) * 3 + 5 * boozy);
    wellness.push({
      date,
      hrv,
      rhr,
      sleepSec: Math.round((7.3 + (r() - 0.5) * 1.6) * 3600),
      sleepScore: Math.round(70 + (r() - 0.5) * 30),
      ctl,
      atl,
      rampRate: null,
      soreness: null,
      fatigue: null,
      stress: null,
      mood: null,
      motivation: null,
      eftp: Math.round(ftpBase - 10 + week * 0.9),
      wPrime: profile.wPrime,
      pMax: profile.pMax,
      vo2max: Math.round(10.8 * ((ftpBase * 1.22) / (profile.weightKg ?? 72)) + 7 + (r() - 0.5) * 2),
      weightKg: profile.weightKg,
    });
  }
  for (let i = 7; i < wellness.length; i++) wellness[i].rampRate = (wellness[i].ctl ?? 0) - (wellness[i - 7].ctl ?? 0);
  const events: CalendarEvent[] = [{ id: 'demo-b', date: addDays(asOf, 54), category: 'RACE_B', name: 'Spring Road Race (demo)' }];
  return { profile, activities, wellness, events };
}

/** A week of "what was planned" so the demo shows compliance colours and a missed session. */
export function demoSnapshots(asOf: ISODate): Record<ISODate, PlanSnapshot> {
  const out: Record<ISODate, PlanSnapshot> = {};
  for (let i = 1; i <= 7; i++) {
    const date = addDays(asOf, -i);
    const d = dow(date);
    const plan: Partial<Record<number, Omit<PlanSnapshot, 'date'>>> = {
      2: { name: 'Threshold 3×12', templateId: 'threshold', durationMin: 75, tss: 74, key: true },
      3: { name: 'Endurance', templateId: 'endurance', durationMin: 75, tss: 48, key: false },
      4: { name: 'VO2max 5×4', templateId: 'vo2_long', durationMin: 70, tss: 72, key: true },
      5: { name: 'Sweet Spot 3×12', templateId: 'sweetspot', durationMin: 70, tss: 66, key: true },
      0: { name: 'Long Endurance', templateId: 'endurance', durationMin: 150, tss: 105, key: false },
    };
    const p = plan[d];
    if (p) out[date] = { date, ...p };
  }
  return out;
}

/** Two tagged nights in the demo so the journal and baseline exclusions are visible. */
export function demoJournal(asOf: ISODate): Journal {
  return { [addDays(asOf, -10)]: ['alcohol_heavy'], [addDays(asOf, -24)]: ['alcohol_light'] };
}
