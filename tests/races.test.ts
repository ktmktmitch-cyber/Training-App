import { describe, expect, it } from 'vitest';
import { addDays } from '../src/engine/dates';
import { buildMacroPlan, macroWeekFor, withAppRaces } from '../src/engine/periodization';
import { effectiveDayConfig } from '../src/engine/planner';
import type { CalendarEvent, PlannedRace } from '../src/engine/types';
import { defaultGoal } from '../src/lib/defaults';

const asOf = '2026-11-23';

describe('races added in the app', () => {
  const races: PlannedRace[] = [
    { id: 'a', name: 'Spring Classic', date: addDays(asOf, 120), priority: 'A', durationMin: 240 },
    { id: 'b', name: 'Club crit', date: addDays(asOf, 40), priority: 'C', durationMin: 60 },
  ];

  it('become calendar races and the first A race is the season goal', () => {
    const ev = withAppRaces([], races);
    expect(ev.map((e) => e.category).sort()).toEqual(['RACE_A', 'RACE_C']);
    const plan = buildMacroPlan(defaultGoal(asOf), ev, asOf); // default goal is "fitness"
    expect(plan.goalDate).toBe(races[0].date);
    expect(plan.weeks.some((w) => w.weekType === 'taper')).toBe(true);
    expect(macroWeekFor(plan, races[0].date)!.races.some((r) => r.name === 'Spring Classic')).toBe(true);
  });

  it('sets race day with its length and priority', () => {
    const ev = withAppRaces([], races);
    const cfg = effectiveDayConfig(races[1].date, { startDate: asOf, hours: 8, days: {} }, ev, null);
    expect(cfg.status).toBe('race');
    expect(cfg.race).toEqual({ name: 'Club crit', durationMin: 60, priority: 'C' });
  });

  it('does not duplicate a race already on the intervals.icu calendar', () => {
    const cal: CalendarEvent[] = [{ id: '9', date: races[1].date, category: 'RACE_B', name: 'Club crit (icu)' }];
    const ev = withAppRaces(cal, races);
    expect(ev.filter((e) => e.date === races[1].date)).toHaveLength(1);
    expect(withAppRaces(cal, [])).toBe(cal);
  });
});
