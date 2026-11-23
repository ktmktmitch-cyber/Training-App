import { mondayOf } from '../engine/dates';
import type { ISODate } from '../engine/types';
import type { useApp } from './store';

/** Add or remove a week (by its Monday) from the rest weeks you chose. */
export function toggleRestWeek(app: ReturnType<typeof useApp>, weekStart: ISODate): void {
  const monday = mondayOf(weekStart);
  app.updateSettings((s) => {
    const list = s.goal.restWeeks ?? [];
    const restWeeks = list.includes(monday) ? list.filter((d) => d !== monday) : [...list, monday].sort();
    return { ...s, goal: { ...s.goal, restWeeks } };
  });
}
