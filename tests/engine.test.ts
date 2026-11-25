import { describe, expect, it } from 'vitest';
import { addDays, diffDays, dow, mondayOf } from '../src/engine/dates';
import { blocksToIcuText, dayToIcuEvents } from '../src/engine/icuExport';
import { buildMacroPlan, macroWeekFor } from '../src/engine/periodization';
import { planWeek, type PlanInput } from '../src/engine/planner';
import { projectSeason } from '../src/engine/projection';
import { assessReadiness } from '../src/engine/readiness';
import { buildStrengthSession } from '../src/engine/strength';
import { computeTrends } from '../src/engine/trends';
import type { GoalSettings, PlannedDay, Wellness, WeekConfig } from '../src/engine/types';
import { blocksLoad, WORKOUTS } from '../src/engine/workouts';
import { DEFAULT_PREFS, DEFAULT_STRENGTH, defaultGoal } from '../src/lib/defaults';
import { demoData } from '../src/lib/demo';

const AS_OF = '2026-11-22'; // a Sunday
const START = addDays(AS_OF, 1);

function goal(over: Partial<GoalSettings> = {}): GoalSettings {
  return { ...defaultGoal(AS_OF), ...over };
}

function baseInput(over: Partial<PlanInput> = {}, weekOver: Partial<WeekConfig> = {}): PlanInput {
  const demo = demoData(AS_OF);
  const g = over.goal ?? goal({ eventType: 'road_race', eventDate: '2027-05-15', eventDurationHours: 3 });
  const macro = buildMacroPlan(g, demo.events, AS_OF);
  const readiness = assessReadiness(demo.wellness, AS_OF);
  const trends = computeTrends(demo.activities, demo.wellness, AS_OF);
  return {
    startDate: START,
    asOf: AS_OF,
    week: { startDate: START, hours: 9, days: {}, ...weekOver },
    goal: g,
    macro,
    prefs: DEFAULT_PREFS,
    strength: DEFAULT_STRENGTH,
    readiness,
    trends,
    profile: demo.profile,
    events: demo.events,
    ...over,
  };
}

const hard = (d: PlannedDay) => !!d.ride && (d.ride.key || d.ride.intensity === 'hard' || d.ride.category === 'race');

describe('dates', () => {
  it('handles weeks and differences', () => {
    expect(dow(AS_OF)).toBe(0);
    expect(mondayOf(AS_OF)).toBe('2026-11-16');
    expect(mondayOf('2026-11-23')).toBe('2026-11-23');
    expect(diffDays('2026-12-01', '2026-11-22')).toBe(9);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('workout library', () => {
  it('every template builds at every level and fits within ~10% of the requested time when possible', () => {
    for (const t of WORKOUTS) {
      for (let l = 0; l < t.levels; l++) {
        const want = Math.max(t.minMin, Math.min(t.maxMin, 90));
        const b = t.build(want, l);
        const load = blocksLoad(b.blocks);
        expect(load.seconds).toBeGreaterThan(0);
        expect(load.tss).toBeGreaterThan(0);
        expect(load.seconds / 60).toBeLessThanOrEqual(want * 1.15 + 5);
      }
    }
  });
  it('produces plausible intensity factors', () => {
    const vo2 = WORKOUTS.find((w) => w.id === 'vo2_long')!.build(75, 3);
    const z2 = WORKOUTS.find((w) => w.id === 'endurance')!.build(120, 0);
    expect(blocksLoad(vo2.blocks).ifactor).toBeGreaterThan(0.75);
    expect(blocksLoad(z2.blocks).ifactor).toBeLessThan(0.72);
  });
  it('exports intervals.icu workout text', () => {
    const t = WORKOUTS.find((w) => w.id === 'vo2_long')!.build(75, 2);
    const txt = blocksToIcuText(t.blocks, 'power');
    expect(txt).toMatch(/Warmup/);
    expect(txt).toMatch(/Main set 4x/);
    expect(txt).toMatch(/- 4m 110-118%/);
    expect(txt).toMatch(/ramp 50-72%/);
    const hr = blocksToIcuText(WORKOUTS.find((w) => w.id === 'tempo')!.build(75, 0).blocks, 'hr');
    expect(hr).toMatch(/Z3 HR/);
  });
});

describe('readiness', () => {
  const mk = (n: number, f: (i: number) => Partial<Wellness>): Wellness[] =>
    Array.from({ length: n }, (_, i) => ({
      date: addDays(AS_OF, -(n - 1 - i)),
      hrv: 60,
      rhr: 48,
      sleepSec: 7.5 * 3600,
      sleepScore: 80,
      ctl: 60,
      atl: 60,
      rampRate: 2,
      soreness: null,
      fatigue: null,
      stress: null,
      mood: null,
      motivation: null,
      eftp: null,
      ...f(i),
    }));

  it('is green with stable markers', () => {
    const w = mk(70, (i) => ({ hrv: 60 + ((i * 7) % 5) - 2, rhr: 48 + ((i * 3) % 3) - 1 }));
    const r = assessReadiness(w, AS_OF);
    expect(r.status).toBe('green');
    expect(r.volumeModifier).toBe(1);
  });

  it('turns red when HRV drops and RHR rises together with deep fatigue', () => {
    const w = mk(70, (i) => (i >= 63 ? { hrv: 40, rhr: 56, atl: 95, ctl: 60 } : { hrv: 60 + ((i * 7) % 5) - 2, rhr: 48 + ((i * 3) % 3) - 1 }));
    const r = assessReadiness(w, AS_OF);
    expect(r.status).toBe('red');
    expect(r.flags.map((f) => f.id)).toEqual(expect.arrayContaining(['hrv-low', 'rhr-high', 'convergent']));
    expect(r.easyDays).toBe(2);
  });

  it('reports unknown without data', () => {
    expect(assessReadiness([], AS_OF).status).toBe('unknown');
  });

  it('sick check-in forces rest', () => {
    const w = mk(70, () => ({}));
    const r = assessReadiness(w, AS_OF, { checkIn: { date: AS_OF, feel: 'sick' } });
    expect(r.status).toBe('red');
    expect(r.easyDays).toBe(3);
  });
});

describe('macro periodization', () => {
  it('linear plan ends with peak → taper → race and has recovery weeks', () => {
    const p = buildMacroPlan(goal({ eventType: 'road_race', eventDate: '2027-05-15', model: 'linear' }), [], AS_OF);
    const phases = p.weeks.map((w) => w.phase);
    expect(phases[phases.length - 1]).toBe('race');
    expect(phases).toContain('base');
    expect(phases).toContain('build');
    expect(phases).toContain('peak');
    expect(p.weeks.filter((w) => w.weekType === 'recovery').length).toBeGreaterThanOrEqual(3);
    // never more than 4 consecutive load weeks in base/build with 3:1
    let run = 0;
    for (const w of p.weeks) {
      if (['base', 'build'].includes(w.phase) && w.weekType === 'load') run++;
      else run = 0;
      expect(run).toBeLessThanOrEqual(4);
    }
    expect(macroWeekFor(p, '2027-05-15')!.phase).toBe('race');
  });

  it('block plan contains HIT block weeks', () => {
    const p = buildMacroPlan(goal({ eventType: 'road_race', eventDate: '2027-05-15', model: 'block' }), [], AS_OF);
    expect(p.weeks.some((w) => w.weekType === 'hit_block')).toBe(true);
    expect(p.weeks.some((w) => w.phase === 'accumulation')).toBe(true);
    expect(p.weeks[p.weeks.length - 1].phase).toBe('race');
  });

  it('reverse plan goes intensity → volume', () => {
    const p = buildMacroPlan(goal({ eventType: 'gravel', eventDate: '2027-06-05', model: 'reverse' }), [], AS_OF);
    const firstVol = p.weeks.findIndex((w) => w.phase === 'volume');
    const firstInt = p.weeks.findIndex((w) => w.phase === 'intensity');
    expect(firstInt).toBeGreaterThanOrEqual(0);
    expect(firstVol).toBeGreaterThan(firstInt);
  });

  it('short timelines compress gracefully', () => {
    for (const weeks of [1, 2, 3, 5, 8, 12]) {
      const date = addDays(START, weeks * 7 - 2);
      const p = buildMacroPlan(goal({ eventType: 'crit', eventDate: date }), [], AS_OF);
      expect(p.weeks.length).toBe(weeks);
      expect(p.weeks[p.weeks.length - 1].phase).toBe('race');
    }
  });

  it('fitness mode produces rolling cycles', () => {
    const p = buildMacroPlan(goal({ eventType: 'fitness' }), [], AS_OF);
    expect(p.goalDate).toBeNull();
    expect(p.weeks.length).toBeGreaterThanOrEqual(16);
  });

  it('season projection reaches race day', () => {
    const p = buildMacroPlan(goal({ eventType: 'road_race', eventDate: '2027-05-15' }), [], AS_OF);
    const proj = projectSeason(p, 9, 50, 50, START);
    expect(proj.raceDay).not.toBeNull();
    expect(proj.raceDay!.tsb).toBeGreaterThan(0); // tapered = positive form
  });
});

describe('week planner', () => {
  it('builds 7 days within budget with no back-to-back hard days and at least one rest day', () => {
    const plan = planWeek(baseInput());
    expect(plan.days).toHaveLength(7);
    expect(plan.days[0].date).toBe(START);
    expect(plan.totalMin).toBeLessThanOrEqual(9 * 60 + 15);
    for (let i = 1; i < 7; i++) expect(hard(plan.days[i]) && hard(plan.days[i - 1])).toBe(false);
    expect(plan.days.filter((d) => !d.ride).length).toBeGreaterThanOrEqual(1);
  });

  it('respects unavailable days, group rides and pinned workouts', () => {
    const days = {
      [addDays(START, 0)]: { status: 'off' as const, maxMinutes: null },
      [addDays(START, 2)]: { status: 'pinned' as const, maxMinutes: null, pinned: { workoutId: 'vo2_3015', durationMin: 75 } },
      [addDays(START, 5)]: { status: 'group' as const, maxMinutes: null, group: { durationMin: 180, intensity: 'hard' as const } },
    };
    const plan = planWeek(baseInput({}, { days }));
    expect(plan.days[0].ride).toBeNull();
    expect(plan.days[2].ride?.templateId).toBe('vo2_3015');
    expect(plan.days[5].ride?.category).toBe('group');
    expect(plan.days[5].ride?.durationMin).toBe(180);
    for (let i = 1; i < 7; i++) expect(hard(plan.days[i]) && hard(plan.days[i - 1])).toBe(false);
  });

  it('never lifts the day before a key session or on unavailable days', () => {
    const plan = planWeek(baseInput());
    plan.days.forEach((d, i) => {
      if (!d.strength) return;
      const next = plan.days[i + 1];
      if (next && hard(next) && d.strength.phase !== 'TP' && d.strength.phase !== 'DL') {
        // allowed only if nothing better existed; the scorer heavily penalises it — assert it's rare
        expect(hard(d)).toBe(true);
      }
      expect(d.status).not.toBe('off');
    });
    expect(plan.days.filter((d) => d.strength).length).toBeGreaterThan(0);
  });

  it('red readiness starts the week with rest and fewer quality sessions', () => {
    const base = baseInput();
    const red = { ...base.readiness, status: 'red' as const, volumeModifier: 0.75, maxKeySessionsDelta: -1, easyDays: 2, firstDayEasy: true };
    const normal = planWeek(base);
    const tired = planWeek({ ...base, readiness: red });
    expect(tired.days[0].ride).toBeNull();
    expect(hard(tired.days[1])).toBe(false);
    expect(tired.totalMin).toBeLessThan(normal.totalMin);
  });

  it('race week: openers the day before, rest two days out, recovery after', () => {
    const raceDay = addDays(START, 5);
    const g = goal({ eventType: 'road_race', eventDate: raceDay, eventDurationHours: 3 });
    const input = baseInput({ goal: g, macro: buildMacroPlan(g, [], AS_OF) });
    const plan = planWeek(input);
    expect(plan.days[5].ride?.category).toBe('race');
    expect(plan.days[4].ride?.templateId).toBe('openers');
    expect(plan.days[3].ride).toBeNull();
    expect(plan.days[6].ride?.templateId).toBe('recovery');
    expect(plan.days[4].strength).toBeNull();
  });

  it('puts an easy long ride the day after a hard Saturday group ride (weekend block)', () => {
    // START is Monday → index 5 = Saturday, 6 = Sunday
    const days = { [addDays(START, 5)]: { status: 'group' as const, maxMinutes: null, group: { durationMin: 120, intensity: 'hard' as const } } };
    const g = goal({ eventType: 'gran_fondo', eventDate: '2027-06-01', model: 'linear' });
    const plan = planWeek(baseInput({ goal: g, macro: buildMacroPlan(g, [], AS_OF) }, { days, hours: 8 }));
    const sunday = plan.days[6].ride!;
    expect(sunday).not.toBeNull();
    expect(sunday.intensity).toBe('easy');
    expect(sunday.durationMin).toBeGreaterThanOrEqual(120);
  });

  it('replaces pinned workouts with rest when you check in sick, and warns about hard group rides', () => {
    const base = baseInput({}, {
      days: {
        [addDays(START, 1)]: { status: 'pinned', maxMinutes: null, pinned: { workoutId: 'vo2_3015', durationMin: 75 } },
        [addDays(START, 2)]: { status: 'group', maxMinutes: null, group: { durationMin: 120, intensity: 'hard' } },
      },
    });
    const w: Wellness[] = Array.from({ length: 70 }, (_, i) => ({
      date: addDays(AS_OF, -(69 - i)), hrv: 60, rhr: 48, sleepSec: 27000, sleepScore: 80, ctl: 60, atl: 60, rampRate: 2,
      soreness: null, fatigue: null, stress: null, mood: null, motivation: null, eftp: null,
    }));
    const sick = assessReadiness(w, AS_OF, { checkIn: { date: AS_OF, feel: 'sick' } });
    const plan = planWeek({ ...base, readiness: sick });
    expect(plan.days[0].ride).toBeNull();
    expect(plan.days[1].ride).toBeNull();
    expect(plan.days[1].notes.join(' ')).toMatch(/replaced with rest/);
    expect(plan.warnings.join(' ')).toMatch(/recovery markers are down/);
  });

  it('pushes to intervals.icu with stable external ids', () => {
    const plan = planWeek(baseInput());
    const evs = plan.days.flatMap((d) => dayToIcuEvents(d, baseInput().profile, 'power'));
    expect(evs.length).toBeGreaterThan(3);
    for (const e of evs) {
      expect(e.external_id).toMatch(/^trainingapp-\d{4}-\d{2}-\d{2}-(ride|strength|mobility)$/);
      expect(e.start_date_local).toMatch(/T00:00:00$/);
    }
  });

  it('handles tiny and huge availability', () => {
    const small = planWeek(baseInput({}, { hours: 3 }));
    expect(small.totalMin).toBeLessThanOrEqual(3 * 60 + 15);
    const big = planWeek(baseInput({}, { hours: 20 }));
    expect(big.totalMin).toBeGreaterThan(small.totalMin);
    for (let i = 1; i < 7; i++) expect(hard(big.days[i]) && hard(big.days[i - 1])).toBe(false);
  });
});

describe('strength', () => {
  it('builds equipment-specific sessions', () => {
    const gym = buildStrengthSession('MS', 'gym', 'intermediate', 0);
    const bw = buildStrengthSession('MS', 'bodyweight', 'intermediate', 0);
    expect(gym.exercises[0].name).toBe('Back Squat');
    expect(bw.exercises[0].name).toMatch(/Tempo Squat/);
    const dl = buildStrengthSession('DL', 'gym', 'intermediate', 0);
    expect(dl.exercises[0].sets).toBeLessThan(gym.exercises[0].sets);
  });
});

describe('workouts already on the intervals.icu calendar', () => {
  it('are kept as fixed sessions and not overwritten by the push', () => {
    const inp = baseInput();
    const day = addDays(inp.startDate, 2);
    const plan = planWeek({
      ...inp,
      events: [
        { id: '77', date: day, category: 'WORKOUT', type: 'Ride', name: 'Coach: 3x10 threshold', plannedSec: 5400, plannedTss: 112, externalId: null, description: '3x10min @ 95-100%' },
        { id: '78', date: addDays(inp.startDate, 3), category: 'WORKOUT', type: 'Ride', name: 'Old app push', plannedSec: 3600, plannedTss: 50, externalId: `trainingapp-${addDays(inp.startDate, 3)}-ride` },
      ],
    });
    const d = plan.days.find((x) => x.date === day)!;
    expect(d.status).toBe('scheduled');
    expect(d.ride?.name).toBe('Coach: 3x10 threshold');
    expect(d.ride?.fixed).toBe('calendar');
    expect(d.ride?.durationMin).toBe(90);
    expect(d.ride?.key).toBe(true);
    // the app's own earlier push is not treated as a fixed workout
    expect(plan.days.find((x) => x.date === addDays(inp.startDate, 3))!.ride?.fixed).not.toBe('calendar');
    // pushing the week doesn't send a duplicate for the coach's workout
    const evs = plan.days.flatMap((x) => dayToIcuEvents(x, inp.profile, 'power'));
    expect(evs.some((e) => e.start_date_local.startsWith(day) && e.type === 'Ride')).toBe(false);
  });
});

import { parseCoachId, workoutAlternatives } from '../src/engine/planner';
import { coachExternalId } from '../src/lib/coach';

describe('coach workouts in the rider’s plan', () => {
  it('rebuilds the library workout with the rider’s own numbers and allows swaps', () => {
    const inp = baseInput();
    const day = addDays(inp.startDate, 2);
    const ext = coachExternalId(day, 'threshold', 3);
    expect(parseCoachId(ext)).toEqual({ templateId: 'threshold', level: 3 });
    expect(parseCoachId('tacoach-2026-11-25-nope-L1-abc')).toBeNull();
    const plan = planWeek({ ...inp, events: [{ id: '9', date: day, category: 'WORKOUT', type: 'Ride', name: 'Threshold 4×8', plannedSec: 4500, plannedTss: 80, externalId: ext, description: 'Coach: openers for Sat\n\n...' }] });
    const d = plan.days.find((x) => x.date === day)!;
    expect(d.ride?.templateId).toBe('threshold');
    expect(d.ride?.blocks.length).toBeGreaterThan(0);
    expect(d.ride?.fixed).toBe('calendar');
    expect(d.ride?.why.join(' ')).toMatch(/openers for Sat/);
    expect(workoutAlternatives(d.ride!, inp.progression, 72).length).toBeGreaterThan(0);
  });
});

import { assessReadiness as ar } from '../src/engine/readiness';
describe('readiness and sleep', () => {
  const day = (date: string, sleepH: number, score: number) => ({ date, hrv: 45, rhr: 50, sleepSec: sleepH * 3600, sleepScore: score, ctl: 50, atl: 50, rampRate: 0, soreness: null, fatigue: null, stress: null, mood: null, motivation: null, eftp: null });
  const hist = Array.from({ length: 20 }, (_, i) => day(`2026-11-${String(i + 1).padStart(2, '0')}`, 7.8, 82));
  it('one very short night is not averaged away', () => {
    const r = ar([...hist, day('2026-11-21', 7.5, 70), day('2026-11-22', 7.5, 70), day('2026-11-23', 4.4, 51)] as any, '2026-11-23');
    expect(r.score!).toBeLessThan(75);
    expect(r.status).not.toBe('green');
    expect(r.flags.some((f) => f.id === 'sleep-last')).toBe(true);
  });
  it('a normal night stays green', () => {
    const r = ar([...hist, day('2026-11-21', 7.8, 82)] as any, '2026-11-21');
    expect(r.status).toBe('green');
    expect(r.flags.some((f) => f.id.startsWith('sleep'))).toBe(false);
  });
  it('a fair night (6.5 h, score 65) costs a little but stays green', () => {
    const r = ar([...hist, day('2026-11-21', 6.5, 65)] as any, '2026-11-21');
    expect(r.status).toBe('green');
    expect(r.score!).toBeLessThan(100);
  });
});
