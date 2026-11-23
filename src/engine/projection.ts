// Season-level fitness projection from the macro plan (weekly hours × phase volume ×
// typical TSS/hour), used for the CTL/form chart and race-day form estimate.
import { addDays, diffDays } from './dates';
import { ewma, round } from './stats';
import type { ISODate, MacroPlan } from './types';

export interface SeasonPoint {
  date: ISODate;
  ctl: number;
  atl: number;
  tsb: number;
  weekTss: number;
}

export function projectSeason(
  plan: MacroPlan,
  hoursPerWeek: number,
  ctl0: number,
  atl0: number,
  from: ISODate,
): { points: SeasonPoint[]; raceDay: SeasonPoint | null } {
  const points: SeasonPoint[] = [];
  let ctl = ctl0;
  let atl = atl0;
  let raceDay: SeasonPoint | null = null;
  // Typical weekly shape (fraction of weekly TSS per day Mon..Sun)
  const shape = [0.05, 0.17, 0.12, 0.17, 0.06, 0.28, 0.15];
  for (const w of plan.weeks) {
    if (diffDays(addDays(w.start, 6), from) < 0) continue;
    const weekTss = hoursPerWeek * w.volumeFactor * w.estTssPerHour;
    for (let i = 0; i < 7; i++) {
      const d = addDays(w.start, i);
      if (diffDays(d, from) < 0) continue;
      let load = weekTss * shape[i];
      if (plan.goalDate) {
        const toRace = diffDays(plan.goalDate, d);
        if (toRace === 0) load = 200;
        else if (toRace === 1) load = 35;
        else if (toRace === 2) load = 0;
        else if (toRace < 0) load = 20;
      }
      const tsb = ctl - atl;
      ctl = ewma(ctl, load, 42);
      atl = ewma(atl, load, 7);
      const p = { date: d, ctl: round(ctl, 1), atl: round(atl, 1), tsb: round(tsb, 1), weekTss: Math.round(weekTss) };
      if (plan.goalDate === d) raceDay = p;
      if (i === 6 || plan.goalDate === d) points.push(p);
    }
  }
  return { points, raceDay };
}
