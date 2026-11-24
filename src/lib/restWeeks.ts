import { mondayOf } from '../engine/dates';
import type { ISODate } from '../engine/types';
import type { useApp } from './store';

export type WeekOffKind = 'rest' | 'away';

/** Set a week (by any day in it) to a rest week, an away week, or back to the plan (null). */
export function setWeekOff(app: ReturnType<typeof useApp>, weekStart: ISODate, kind: WeekOffKind | null): void {
  const monday = mondayOf(weekStart);
  app.updateSettings((s) => {
    const rest = (s.goal.restWeeks ?? []).filter((d) => d !== monday);
    const away = (s.goal.awayWeeks ?? []).filter((d) => d !== monday);
    if (kind === 'rest') rest.push(monday);
    if (kind === 'away') away.push(monday);
    return { ...s, goal: { ...s.goal, restWeeks: rest.sort(), awayWeeks: away.sort() } };
  });
}

export function weekOffKind(app: ReturnType<typeof useApp>, weekStart: ISODate): WeekOffKind | null {
  const monday = mondayOf(weekStart);
  if ((app.settings.goal.awayWeeks ?? []).includes(monday)) return 'away';
  if ((app.settings.goal.restWeeks ?? []).includes(monday)) return 'rest';
  return null;
}

/** Add or remove a week (by its Monday) from the rest weeks you chose. */
export function toggleRestWeek(app: ReturnType<typeof useApp>, weekStart: ISODate): void {
  setWeekOff(app, weekStart, weekOffKind(app, weekStart) ? null : 'rest');
}
