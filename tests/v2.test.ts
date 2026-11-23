import { describe, expect, it } from 'vitest';
import { computeCompliance, missedKeySessions } from '../src/engine/compliance';
import { addDays } from '../src/engine/dates';
import { computeLoadFocus } from '../src/engine/loadFocus';
import { buildMacroPlan } from '../src/engine/periodization';
import { planWeek, workoutAlternatives, type PlanInput } from '../src/engine/planner';
import { morton, powerProfile } from '../src/engine/powerProfile';
import { activityZoneMinutes, computeProgression, difficultyOf, workoutLevel, zoneScore } from '../src/engine/progression';
import { parseIntervalSummary } from '../src/lib/intervals';
import { assessReadiness } from '../src/engine/readiness';
import { formZone, trainingStatus } from '../src/engine/status';
import { computeTrends } from '../src/engine/trends';
import type { Activity, Wellness } from '../src/engine/types';
import { getTemplate } from '../src/engine/workouts';
import { workoutToZwo } from '../src/engine/zwo';
import { DEFAULT_PREFS, DEFAULT_STRENGTH, defaultGoal } from '../src/lib/defaults';
import { DEMO_PROFILE, demoData, demoSnapshots } from '../src/lib/demo';

const AS_OF = '2026-11-22';
const START = addDays(AS_OF, 1);

function ride(date: string, zones: number[], over: Partial<Activity> = {}): Activity {
  const secs = zones.reduce((a, b) => a + b, 0);
  return {
    id: `r-${date}-${Math.random()}`,
    date,
    name: 'Ride',
    type: 'Ride',
    isRide: true,
    isStrength: false,
    movingSec: secs,
    tss: Math.round(secs / 36),
    intensity: 0.75,
    normalizedPower: null,
    avgHr: null,
    powerZoneSecs: zones,
    hrZoneSecs: null,
    source: 'demo',
    ...over,
  };
}

describe('progression levels', () => {
  it('scores more time in zone as a higher level, on one scale for rides and workouts', () => {
    expect(zoneScore('threshold', 40)).toBeGreaterThan(zoneScore('threshold', 30));
    expect(zoneScore('vo2max', 2)).toBe(0);
    expect(zoneScore('vo2max', 60)).toBe(10);
    const easy = workoutLevel('threshold', getTemplate('threshold').build(90, 0).blocks)!;
    const hard = workoutLevel('threshold', getTemplate('threshold').build(120, 7).blocks)!;
    expect(hard.level).toBeGreaterThan(easy.level);
  });

  it('builds levels from history, decays them and applies feedback', () => {
    const recent = ride(addDays(AS_OF, -3), [600, 1200, 300, 2700, 0, 0, 0]); // 45 min threshold
    const old = ride(addDays(AS_OF, -60), [600, 1200, 300, 0, 1200, 0, 0]); // 20 min VO2, 8+ weeks ago
    const p = computeProgression([recent, old], {}, AS_OF);
    expect(p.threshold.source).toBe('history');
    expect(p.threshold.level).toBeGreaterThan(4);
    expect(p.vo2max.level).toBeLessThan(zoneScore('vo2max', 20)); // decayed
    expect(p.anaerobic.source).toBe('none');
    const easier = computeProgression([recent], { [recent.id]: 'easy' }, AS_OF);
    const harder = computeProgression([recent], { [recent.id]: 'all_out' }, AS_OF);
    expect(easier.threshold.level).toBeGreaterThan(harder.threshold.level);
  });

  it('credits structured efforts but not group-ride surges (intervals.icu interval summaries)', () => {
    const efforts = parseIntervalSummary(['1x 10m51s 191w', '5x 3m58s 323w', '6x 5m 156w', '1x 1h26m 203w', '1x 38m47s 92bpm'])!;
    expect(efforts).toHaveLength(4);
    expect(efforts[1]).toEqual({ reps: 5, secs: 238, watts: 323 });
    const vo2Session = ride(AS_OF, [1200, 1200, 300, 300, 1200, 60, 0], { efforts, ftp: 290 });
    const groupRide = ride(AS_OF, [3000, 5000, 1500, 900, 700, 400, 150], {
      efforts: parseIntervalSummary(['1x 3m20s 262w', '36x 8s 492w', '5x 32s 315w', '1x 60s 311w']),
      ftp: 290,
    });
    expect(activityZoneMinutes(vo2Session).vo2max).toBeGreaterThan(15);
    expect(activityZoneMinutes(groupRide).vo2max).toBe(0);
    expect(activityZoneMinutes(groupRide).endurance).toBeGreaterThan(100);
  });

  it('labels difficulty relative to the athlete level', () => {
    expect(difficultyOf(5.3, 5)).toBe('productive');
    expect(difficultyOf(3.5, 5)).toBe('achievable');
    expect(difficultyOf(6.8, 5)).toBe('stretch');
    expect(difficultyOf(9.5, 5)).toBe('not_recommended');
  });
});

describe('load focus', () => {
  it('flags a high-aerobic shortage when almost everything is easy', () => {
    const acts = Array.from({ length: 12 }, (_, i) => ride(addDays(AS_OF, -i * 2), [1800, 5400, 60, 0, 0, 0, 0]));
    const f = computeLoadFocus(acts, AS_OF, 'build', 'road_race');
    expect(f.status.low).toBe('over');
    expect(['high', 'anaerobic']).toContain(f.shortage);
  });
  it('needs at least a week of data', () => {
    expect(computeLoadFocus([ride(AS_OF, [3600, 0, 0, 0, 0, 0, 0])], AS_OF, 'base', 'road_race').shortage).toBeNull();
  });
});

describe('training status & form zones', () => {
  const mk = (n: number, f: (i: number) => Partial<Wellness>): Wellness[] =>
    Array.from({ length: n }, (_, i) => ({
      date: addDays(AS_OF, -(n - 1 - i)),
      hrv: 60, rhr: 48, sleepSec: 27000, sleepScore: 80, ctl: 50, atl: 50, rampRate: 0,
      soreness: null, fatigue: null, stress: null, mood: null, motivation: null, eftp: 280,
      ...f(i),
    }));
  it('detects productive training', () => {
    const w = mk(60, (i) => ({ ctl: 40 + i * 0.4, atl: 45 + i * 0.4, rampRate: 2.8, eftp: 270 + i * 0.3 }));
    const st = trainingStatus(w, assessReadiness(w, AS_OF), AS_OF);
    expect(st.key).toBe('productive');
  });
  it('detects detraining', () => {
    const w = mk(60, (i) => ({ ctl: 70 - i * 0.5, atl: 60 - i * 0.7, rampRate: -3 }));
    expect(trainingStatus(w, assessReadiness(w, AS_OF), AS_OF).key).toBe('detraining');
  });
  it('maps TSB to intervals.icu-style zones', () => {
    expect(formZone(-20).label).toBe('Optimal');
    expect(formZone(-35).label).toBe('High risk');
    expect(formZone(12).label).toBe('Fresh');
    expect(formZone(0).label).toBe('Grey zone');
  });
});

describe('compliance & missed sessions', () => {
  it('colours days TrainingPeaks-style and finds missed key sessions', () => {
    const demo = demoData(AS_OF);
    const days = Array.from({ length: 7 }, (_, i) => addDays(AS_OF, -7 + i));
    const c = computeCompliance(days, AS_OF, [], demo.activities, demoSnapshots(AS_OF));
    const fri = c.find((d) => d.date === addDays(AS_OF, -2))!;
    expect(fri.color).toBe('red');
    expect(c.some((d) => d.color === 'green')).toBe(true);
    const missed = missedKeySessions(c, AS_OF);
    expect(missed[0].templateId).toBe('sweetspot');
  });

  it('reschedules a missed key session as the first quality session', () => {
    const demo = demoData(AS_OF);
    const g = { ...defaultGoal(AS_OF), eventType: 'road_race' as const, eventDate: '2027-05-15' };
    const input: PlanInput = {
      startDate: START, asOf: AS_OF, week: { startDate: START, hours: 9, days: {} }, goal: g,
      macro: buildMacroPlan(g, [], AS_OF), prefs: DEFAULT_PREFS, strength: DEFAULT_STRENGTH,
      readiness: assessReadiness(demo.wellness, AS_OF), trends: computeTrends(demo.activities, demo.wellness, AS_OF),
      profile: demo.profile, events: [], carryOver: [{ date: addDays(AS_OF, -2), templateId: 'threshold', name: 'Threshold 3×12' }],
    };
    const plan = planWeek(input);
    const firstKey = plan.days.find((d) => d.ride?.key && !d.ride.fixed);
    expect(firstKey?.ride?.templateId).toBe('threshold');
    expect(plan.summary.join(' ')).toMatch(/rescheduled/);
  });
});

describe('progression-aware planning & alternatives', () => {
  it('uses progression levels to pick productive interval levels and offers easier/harder swaps', () => {
    const demo = demoData(AS_OF);
    const prog = computeProgression(demo.activities, {}, AS_OF);
    const g = { ...defaultGoal(AS_OF), eventType: 'road_race' as const, eventDate: '2027-02-20', model: 'linear' as const };
    const input: PlanInput = {
      startDate: START, asOf: AS_OF, week: { startDate: START, hours: 9, days: {} }, goal: g,
      macro: buildMacroPlan(g, [], AS_OF), prefs: DEFAULT_PREFS, strength: DEFAULT_STRENGTH,
      readiness: assessReadiness(demo.wellness, AS_OF), trends: computeTrends(demo.activities, demo.wellness, AS_OF),
      profile: demo.profile, events: [], progression: prog,
    };
    const plan = planWeek(input);
    const key = plan.days.map((d) => d.ride).find((r) => r?.key && r.progression?.athleteLevel != null)!;
    expect(key).toBeTruthy();
    expect(['achievable', 'productive', 'stretch']).toContain(key.progression!.difficulty);
    const alts = workoutAlternatives(key, prog, 72);
    const easier = alts.find((a) => a.label === 'Easier');
    const harder = alts.find((a) => a.label === 'Harder');
    if (easier) expect(easier.workout.progression!.workoutLevel).toBeLessThanOrEqual(key.progression!.workoutLevel);
    if (harder) expect(harder.workout.progression!.workoutLevel).toBeGreaterThanOrEqual(key.progression!.workoutLevel);
    expect(alts.some((a) => a.label.startsWith('Same focus'))).toBe(true);
  });
});

describe('power profile', () => {
  it('estimates the power-duration curve and a rider type', () => {
    expect(morton(280, 20000, 1200, 60)).toBeGreaterThan(morton(280, 20000, 1200, 300));
    const p = powerProfile(DEMO_PROFILE)!;
    expect(p.watts.sprint).toBeGreaterThan(p.watts.anaerobic);
    expect(p.watts.vo2).toBeGreaterThan(p.watts.threshold);
    expect(p.type).toBeTruthy();
    expect(powerProfile({ ...DEMO_PROFILE, wPrime: null })).toBeNull();
  });
});

describe('zwo export', () => {
  it('produces Zwift workout XML with intervals', () => {
    const t = getTemplate('vo2_long');
    const b = t.build(75, 2);
    const xml = workoutToZwo({ templateId: t.id, name: b.name, category: t.category, intensity: t.intensity, durationMin: 75, tss: 80, ifactor: 0.8, blocks: b.blocks, purpose: 'x & y', why: [], fueling: '', key: true });
    expect(xml).toMatch(/<workout_file>/);
    expect(xml).toMatch(/<Warmup Duration="\d+" PowerLow="0.500" PowerHigh="0.720"/);
    expect(xml).toMatch(/<IntervalsT Repeat="4" OnDuration="240" OffDuration="180" OnPower="1.140" OffPower="0.525"/);
    expect(xml).toMatch(/x &amp; y/);
  });
});
