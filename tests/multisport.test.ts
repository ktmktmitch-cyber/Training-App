import { describe, expect, it } from 'vitest';
import { addDays } from '../src/engine/dates';
import { applySports, bikeHoursFor, runCap } from '../src/engine/multisport';
import { buildMacroPlan } from '../src/engine/periodization';
import { planWeek, type PlanInput } from '../src/engine/planner';
import { assessReadiness } from '../src/engine/readiness';
import { computeTrends } from '../src/engine/trends';
import type { Activity, PlannedWorkout, SportMode, WeekPlan } from '../src/engine/types';
import { DEFAULT_PREFS, DEFAULT_STRENGTH, defaultGoal } from '../src/lib/defaults';
import { demoData } from '../src/lib/demo';

const AS_OF = '2026-11-22';
const START = addDays(AS_OF, 1);

function runs(n: number, minutes: number): Activity[] {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, date: addDays(AS_OF, -1 - i * 2), name: 'Run', type: 'Run', isRide: false, isStrength: false, movingSec: minutes * 60, tss: 40, intensity: 0.75, normalizedPower: null, avgHr: 140, powerZoneSecs: null, hrZoneSecs: null, source: 'intervals' as const }));
}

function plan(sport: SportMode, hours = 9, history: Activity[] = runs(10, 45)): WeekPlan {
  const demo = demoData(AS_OF);
  const g = { ...defaultGoal(AS_OF), eventType: 'road_race' as const, eventDate: '2027-05-15' };
  const macro = buildMacroPlan(g, [], AS_OF);
  const readiness = assessReadiness(demo.wellness, AS_OF);
  const input: PlanInput = {
    startDate: START, asOf: AS_OF, week: { startDate: START, hours: bikeHoursFor(sport, hours), days: {} }, goal: g, macro, prefs: DEFAULT_PREFS, strength: DEFAULT_STRENGTH,
    readiness, trends: computeTrends(demo.activities, demo.wellness, AS_OF), profile: demo.profile, events: [],
  };
  const base = planWeek(input);
  return applySports({ plan: base, sport, hours, macroWeek: base.macroWeek, readiness, activities: [...demo.activities, ...history], asOf: AS_OF, weightKg: 72, minRestDays: 1 });
}

const all = (p: WeekPlan) => p.days.flatMap((d) => [d.ride, ...(d.extras ?? [])].filter(Boolean) as PlannedWorkout[]);

describe('running plans', () => {
  it('turns the week into runs with safe structure', () => {
    const p = plan('running');
    const r = all(p);
    expect(r.length).toBeGreaterThan(2);
    expect(r.every((w) => w.sport === 'run')).toBe(true);
    const quality = r.filter((w) => w.key && w.templateId !== 'run_long');
    expect(quality.length).toBeLessThanOrEqual(2);
    const long = r.find((w) => w.templateId === 'run_long');
    expect(long).toBeTruthy();
    expect(long!.durationMin).toBeLessThanOrEqual(150);
    // capped near +15% of recent running (≈ 225 min/week of history → ≤ ~260)
    const total = r.reduce((a, w) => a + w.durationMin, 0);
    expect(total).toBeLessThanOrEqual(270);
    expect(p.days.some((d) => !d.ride && !(d.extras ?? []).length)).toBe(true); // a rest day survives
  });

  it('starts conservatively with no running history', () => {
    expect(runCap([], AS_OF, 120).cap).toBe(120);
    expect(runCap(runs(8, 60), AS_OF, 60).cap).toBe(Math.round(180 * 1.15)); // 3 runs in the last 7 days
  });
});

describe('triathlon and run + bike', () => {
  it('keeps rides and adds runs and swims without stacking two key sessions on easy days', () => {
    const p = plan('triathlon', 10);
    const sessions = all(p);
    const bySport = (s: string) => sessions.filter((w) => (w.sport ?? 'ride') === s);
    expect(bySport('ride').length).toBeGreaterThan(1);
    expect(bySport('run').length).toBeGreaterThanOrEqual(2);
    expect(bySport('swim').length).toBeGreaterThanOrEqual(2);
    expect(bySport('swim').some((w) => w.templateId === 'swim_css' || w.templateId === 'swim_endurance')).toBe(true);
    // at least one full rest day kept
    expect(p.days.some((d) => !d.ride && !(d.extras ?? []).length)).toBe(true);
    // the long run is not on the long-ride day
    const longRun = p.days.find((d) => d.extras?.some((x) => x.templateId === 'run_long'));
    const longRide = p.days.reduce((a, d) => ((d.ride?.durationMin ?? 0) > (a.ride?.durationMin ?? 0) ? d : a));
    expect(longRun?.date).not.toBe(longRide.date);
  });

  it('run + bike gives the bike ~60% of the hours', () => {
    expect(bikeHoursFor('run_bike', 10)).toBe(6);
    expect(bikeHoursFor('triathlon', 10)).toBe(5);
    const p = plan('run_bike', 10);
    expect(all(p).filter((w) => w.sport === 'run').length).toBeGreaterThanOrEqual(2);
    expect(all(p).some((w) => (w.sport ?? 'ride') === 'ride')).toBe(true);
  });

  it('cycling is unchanged', () => {
    const p = plan('cycling');
    expect(all(p).every((w) => (w.sport ?? 'ride') === 'ride')).toBe(true);
  });
});

import { computeCompliance } from '../src/engine/compliance';
import { isHardSession } from '../src/engine/trends';

describe('every sport counts', () => {
  const run = (over: Partial<Activity> = {}): Activity => ({ id: 'r', date: AS_OF, name: 'Run', type: 'Run', isRide: false, isStrength: false, movingSec: 3000, tss: 60, intensity: 0.9, normalizedPower: null, avgHr: 160, powerZoneSecs: null, hrZoneSecs: null, source: 'intervals', ...over });

  it('hard runs and swims are hard sessions; lifting is not', () => {
    expect(isHardSession(run())).toBe(true);
    expect(isHardSession(run({ intensity: 0.7 }))).toBe(false);
    expect(isHardSession(run({ type: 'Swim', intensity: 0.7, hrZoneSecs: [300, 600, 300, 900, 200, 0, 0] }))).toBe(true);
    expect(isHardSession(run({ type: 'WeightTraining', isStrength: true, intensity: 1 }))).toBe(false);
  });

  it('planned vs done matches runs and swims', () => {
    const c = computeCompliance([AS_OF], addDays(AS_OF, 1), [{ id: '1', date: AS_OF, category: 'WORKOUT', type: 'Run', name: 'Tempo run', plannedSec: 3000, plannedTss: 60 }], [run()], {});
    expect(c[0].done.length).toBe(1);
    expect(c[0].color).toBe('green');
  });

  it('intensity distribution includes runs (HR zones)', () => {
    const t = computeTrends([run({ date: addDays(AS_OF, -2), intensity: 0.7, hrZoneSecs: [1200, 1500, 300, 0, 0, 0, 0] })], [], AS_OF);
    expect(t.distribution28.source).toBe('hr');
    expect(t.distribution28.low).toBeGreaterThan(0.8);
  });

  it('projected fitness and form include runs and swims', () => {
    const tri = plan('triathlon', 10);
    const cyc = plan('cycling', 10);
    expect(tri.totalTss).toBe(all(tri).reduce((a, w) => a + w.tss, 0));
    expect(tri.summary.some((s) => s.startsWith('Projected fitness (CTL, all sports)'))).toBe(true);
    expect(tri.projectedCtl).not.toBeNull();
    expect(cyc.summary.some((s) => s.includes('all sports'))).toBe(false);
  });
});

describe('planned vs done by sport', () => {
  it('compares a planned run with the run, not the ride on the same day', () => {
    const d = '2026-09-20';
    const ride: Activity = { id: 'a', date: d, name: 'Ride', type: 'Ride', isRide: true, isStrength: false, movingSec: 7200, tss: 54, intensity: 0.7, normalizedPower: 200, avgHr: 130, powerZoneSecs: null, hrZoneSecs: null, source: 'intervals' };
    const r: Activity = { ...ride, id: 'b', type: 'Run', isRide: false, movingSec: 1320, tss: 39 };
    const c = computeCompliance([d], '2026-09-21', [{ id: '1', date: d, category: 'WORKOUT', type: 'Run', name: 'Run', plannedSec: 1320, plannedTss: 39 }], [ride, r], {});
    expect(c[0].done.map((x) => x.type)).toEqual(['Run']);
    expect(c[0].color).toBe('green');
  });
});
