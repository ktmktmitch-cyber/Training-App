import { describe, expect, it } from 'vitest';
import { addDays, diffDays, mondayOf } from '../src/engine/dates';
import { buildMacroPlan, canChooseRest, macroWeekFor } from '../src/engine/periodization';
import { defaultGoal } from '../src/lib/defaults';

const asOf = '2026-11-23';

describe('chosen rest weeks', () => {
  it('turns a load week into a rest week and restarts the cycle', () => {
    const base = buildMacroPlan(defaultGoal(asOf), [], asOf);
    const firstLoad = base.weeks.find((w) => w.weekType === 'load')!;
    const plan = buildMacroPlan({ ...defaultGoal(asOf), restWeeks: [addDays(firstLoad.start, 2)] }, [], asOf);
    const rest = macroWeekFor(plan, firstLoad.start)!;
    expect(rest.weekType).toBe('recovery');
    expect(rest.userRest).toBe(true);
    expect(rest.volumeFactor).toBeLessThan(0.7);
    expect(canChooseRest(rest)).toBe(true); // can undo it

    // No two easy weeks within 3 weeks after it, and never more than 3 load weeks in a row (3:1)
    const after = plan.weeks.filter((w) => diffDays(w.start, rest.start) > 0).slice(0, 12);
    expect(after.slice(0, 3).every((w) => w.weekType !== 'recovery')).toBe(true);
    let run = 0;
    for (const w of after) {
      run = w.weekType === 'load' ? run + 1 : 0;
      expect(run).toBeLessThanOrEqual(3);
    }
    expect(after[3].weekType).toBe('recovery');
  });

  it('ignores rest weeks in taper/race weeks and leaves the plan alone without any', () => {
    const goal = { ...defaultGoal(asOf), eventType: 'road_race' as const, eventDate: addDays(asOf, 70), eventName: 'Race' };
    const base = buildMacroPlan(goal, [], asOf);
    const taper = base.weeks.find((w) => w.weekType === 'taper' || w.weekType === 'race')!;
    expect(canChooseRest(taper)).toBe(false);
    const plan = buildMacroPlan({ ...goal, restWeeks: [taper.start] }, [], asOf);
    expect(macroWeekFor(plan, taper.start)!.weekType).toBe(taper.weekType);
    expect(buildMacroPlan({ ...goal, restWeeks: [] }, [], asOf).weeks).toEqual(base.weeks);
    expect(mondayOf(taper.start)).toBe(taper.start);
  });
});

import { withAwayWeeks } from '../src/engine/periodization';
import { effectiveDayConfig } from '../src/engine/planner';

describe('away weeks', () => {
  it('plan no training that week and restart the cycle after it', () => {
    const base = buildMacroPlan(defaultGoal(asOf), [], asOf);
    const target = base.weeks.filter((w) => w.weekType === 'load')[2];
    const goal = { ...defaultGoal(asOf), awayWeeks: [addDays(target.start, 3)] };
    const plan = buildMacroPlan(goal, [], asOf);
    const w = macroWeekFor(plan, target.start)!;
    expect(w.userAway).toBe(true);
    expect(w.volumeFactor).toBe(0);
    const after = plan.weeks.filter((x) => diffDays(x.start, w.start) > 0).slice(0, 3);
    expect(after.every((x) => x.weekType === 'load')).toBe(true);
    // every day of that week is off in the planner
    const ev = withAwayWeeks([], goal.awayWeeks);
    for (let i = 0; i < 7; i++) expect(effectiveDayConfig(addDays(target.start, i), { startDate: asOf, hours: 8, days: {} }, ev, null).status).toBe('off');
    expect(effectiveDayConfig(addDays(target.start, 7), { startDate: asOf, hours: 8, days: {} }, ev, null).status).toBe('available');
  });
});

describe('weeks off next to scheduled recovery', () => {
  it('turns a recovery week right before your week off into a loading week', () => {
    const base = buildMacroPlan(defaultGoal(asOf), [], asOf);
    const idx = base.weeks.findIndex((w, i) => i > 0 && w.weekType === 'recovery');
    const next = base.weeks[idx + 1];
    const plan = buildMacroPlan({ ...defaultGoal(asOf), awayWeeks: [next.start] }, [], asOf);
    expect(plan.weeks[idx].weekType).toBe('load');
    expect(plan.weeks[idx + 1].userAway).toBe(true);
    let run = 0;
    let maxRun = 0;
    for (const w of plan.weeks) {
      run = w.weekType === 'load' ? run + 1 : 0;
      maxRun = Math.max(maxRun, run);
    }
    expect(maxRun).toBeLessThanOrEqual(4); // 3:1 pattern stretched by at most one week
  });
});
