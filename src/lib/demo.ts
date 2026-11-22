// Synthetic, deterministic demo data so the app can be explored without a connection.
import { addDays, dow } from '../engine/dates';
import { ewma } from '../engine/stats';
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
};

export function demoData(asOf: ISODate): { profile: AthleteProfile; activities: Activity[]; wellness: Wellness[]; events: CalendarEvent[] } {
  const r = rng(42);
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
    const mk = (name: string, min: number, ifac: number, zones: number[], hard = false): Activity => {
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
        normalizedPower: Math.round(DEMO_PROFILE.ftp! * ifac),
        avgHr: Math.round(120 + ifac * 40 + (hard ? 5 : 0)),
        powerZoneSecs: z,
        hrZoneSecs: [z[0] + z[1] * 0.6, z[1] * 0.4 + z[2] * 0.5, z[2] * 0.5, z[3], z[4], z[5], z[6]].map(Math.round),
        source: 'demo',
      };
    };
    const scale = recoveryWeek ? 0.6 : 1;
    if (d === 2) activities.push(mk('Threshold 3×12', 75 * scale, recoveryWeek ? 0.68 : 0.83, recoveryWeek ? [30, 60, 10, 0, 0, 0, 0] : [25, 35, 8, 30, 2, 0, 0], !recoveryWeek));
    if (d === 3) activities.push(mk('Endurance', 60 * scale, 0.66, [25, 70, 5, 0, 0, 0, 0]));
    if (d === 4 && !recoveryWeek) activities.push(mk('VO2 5×4', 70, 0.84, [30, 35, 5, 6, 22, 2, 0], true));
    if (d === 6) activities.push(mk('Group ride', 150 * scale, 0.78, [20, 45, 18, 10, 5, 1.5, 0.5], !recoveryWeek));
    if (d === 0) activities.push(mk('Long endurance', 180 * scale, 0.68, [20, 72, 7, 1, 0, 0, 0]));
    if ((d === 1 || d === 4) && week < 14 && r() > 0.25) {
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
    const hrv = Math.round(Math.exp(Math.log(62) - fatigue * 0.008 + (r() - 0.5) * 0.18));
    const rhr = Math.round(48 + fatigue * 0.08 + (r() - 0.5) * 3);
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
      eftp: 268,
    });
  }
  for (let i = 7; i < wellness.length; i++) wellness[i].rampRate = (wellness[i].ctl ?? 0) - (wellness[i - 7].ctl ?? 0);
  const events: CalendarEvent[] = [{ id: 'demo-b', date: addDays(asOf, 54), category: 'RACE_B', name: 'Spring Road Race (demo)' }];
  return { profile: DEMO_PROFILE, activities, wellness, events };
}
