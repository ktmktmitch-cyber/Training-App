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
