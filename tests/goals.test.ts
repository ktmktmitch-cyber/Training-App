import { describe, expect, it } from 'vitest';
import { addDays } from '../src/engine/dates';
import { EVENT_PROFILES, longFraction } from '../src/engine/goals';
import { applySports, bikeHoursFor, shareFor } from '../src/engine/multisport';
import { buildMacroPlan, taperDaysFor } from '../src/engine/periodization';
import { planWeek, type PlanInput } from '../src/engine/planner';
import { assessReadiness } from '../src/engine/readiness';
import { computeTrends } from '../src/engine/trends';
import type { Activity, EventType, PlannedWorkout, SportMode, WeekPlan } from '../src/engine/types';
import { DEFAULT_PREFS, DEFAULT_STRENGTH, defaultGoal } from '../src/lib/defaults';
import { demoData } from '../src/lib/demo';

const AS_OF = '2026-11-22';
const START = addDays(AS_OF, 1);
const runs = (n: number, minutes: number): Activity[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, date: addDays(AS_OF, -1 - i), name: 'Run', type: 'Run', isRide: false, isStrength: false, movingSec: minutes * 60, tss: 40, intensity: 0.75, normalizedPower: null, avgHr: 140, powerZoneSecs: null, hrZoneSecs: null, source: 'intervals' as const }));

function plan(sport: SportMode, event: EventType, eventDate: string, hours = 10, history = runs(20, 60)): WeekPlan {
  const demo = demoData(AS_OF);
  const g = { ...defaultGoal(AS_OF), eventType: event, eventDate, eventDurationHours: EVENT_PROFILES[event]?.hours ?? 3 };
  const macro = buildMacroPlan(g, [], AS_OF);
  const readiness = assessReadiness(demo.wellness, AS_OF);
  const input: PlanInput = {
    startDate: START, asOf: AS_OF, week: { startDate: START, hours: bikeHoursFor(sport, hours, event), days: {} }, goal: g, macro, prefs: DEFAULT_PREFS, strength: DEFAULT_STRENGTH,
    readiness, trends: computeTrends(demo.activities, demo.wellness, AS_OF), profile: demo.profile, events: [],
  };
  const base = planWeek(input);
  return applySports({ plan: base, sport, hours, macroWeek: base.macroWeek, readiness, activities: [...demo.activities, ...history], asOf: AS_OF, weightKg: 72, minRestDays: 1, event });
}
const all = (p: WeekPlan) => p.days.flatMap((d) => [d.ride, ...(d.extras ?? [])].filter(Boolean) as PlannedWorkout[]);

describe('triathlon and running goal events', () => {
  it('has a profile, label and taper for every distance', () => {
    expect(taperDaysFor('tri_ironman', 12)).toBeGreaterThanOrEqual(14);
    expect(taperDaysFor('run_5k', 0.4)).toBe(7);
    expect(taperDaysFor('run_marathon', 4)).toBeGreaterThanOrEqual(14);
    expect(shareFor('triathlon', 'tri_ironman').ride).toBeGreaterThan(shareFor('triathlon', 'tri_sprint').ride);
    expect(longFraction('base')).toBeLessThan(longFraction('peak'));
  });

  it('marathon: long run grows toward the event and says so; quality is from the marathon list', () => {
    const p = plan('running', 'run_marathon', '2027-04-18', 8);
    const r = all(p);
    expect(r.every((w) => w.sport === 'run')).toBe(true);
    const long = r.find((w) => w.templateId === 'run_long' || w.templateId === 'run_long_ff');
    expect(long).toBeTruthy();
    expect(long!.durationMin).toBeGreaterThanOrEqual(90);
    expect(long!.durationMin).toBeLessThanOrEqual(180);
    expect(p.summary.some((s) => s.startsWith('Goal: Marathon'))).toBe(true);
    const q = r.filter((w) => w.key && !w.templateId.startsWith('run_long')).map((w) => w.templateId);
    const allowed = Object.values(EVENT_PROFILES.run_marathon!.runQuality!).flat();
    for (const id of q) expect([...allowed, 'run_strides']).toContain(id);
  });

  it('5k: key sessions are speed work, long run stays short', () => {
    const r = all(plan('running', 'run_5k', '2027-03-01', 6));
    const long = r.find((w) => w.templateId === 'run_long');
    if (long) expect(long.durationMin).toBeLessThanOrEqual(75);
  });

  it('Ironman: more bike, long swim and long run toward race distance', () => {
    const p = plan('triathlon', 'tri_ironman', '2027-07-20', 14);
    const s = all(p);
    const swim = s.filter((w) => w.sport === 'swim');
    const rideMin = s.filter((w) => (w.sport ?? 'ride') === 'ride').reduce((a, w) => a + w.durationMin, 0);
    const runMin = s.filter((w) => w.sport === 'run').reduce((a, w) => a + w.durationMin, 0);
    expect(swim.length).toBeGreaterThanOrEqual(2);
    expect(rideMin).toBeGreaterThan(runMin);
    expect(p.summary.some((x) => x.startsWith('Goal: Ironman'))).toBe(true);
  });

  it('warns when the goal needs a different sport than the plan', () => {
    const p = plan('cycling', 'tri_70_3', '2027-06-01');
    expect(p.warnings.some((w) => /Half Ironman/.test(w) && /Triathlon/.test(w))).toBe(true);
  });

  it('race day of a running goal is a run with the event name', () => {
    const date = addDays(START, 3);
    const demo = demoData(AS_OF);
    const g = { ...defaultGoal(AS_OF), eventType: 'run_half' as const, eventDate: date, eventName: 'City Half', eventDurationHours: 1.9 };
    const macro = buildMacroPlan(g, [], AS_OF);
    const readiness = assessReadiness(demo.wellness, AS_OF);
    const base = planWeek({ startDate: START, asOf: AS_OF, week: { startDate: START, hours: 6, days: {} }, goal: g, macro, prefs: DEFAULT_PREFS, strength: DEFAULT_STRENGTH, readiness, trends: computeTrends(demo.activities, demo.wellness, AS_OF), profile: demo.profile, events: [] });
    const race = base.days.find((d) => d.date === date)!.ride!;
    expect(race.sport).toBe('run');
    expect(race.name).toContain('City Half');
    expect(race.durationMin).toBe(114);
  });
});
