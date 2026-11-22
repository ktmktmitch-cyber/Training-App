import { addDays, mondayOf } from '../engine/dates';
import type { GoalSettings, ISODate, PlannerPrefs, StrengthSettings, WeekConfig } from '../engine/types';

export function defaultGoal(asOf: ISODate): GoalSettings {
  return {
    eventName: '',
    eventDate: null,
    eventType: 'fitness',
    eventDurationHours: 3,
    model: 'linear',
    intensity: 'auto',
    loadPattern: '3:1',
    typicalWeeklyHours: 8,
    planStart: mondayOf(addDays(asOf, 1)),
    useCalendarRaces: true,
  };
}

export const DEFAULT_STRENGTH: StrengthSettings = {
  frequency: 2,
  equipment: 'gym',
  experience: 'intermediate',
  placement: 'hard_days',
  followPhaseCaps: true,
  includeMobility: true,
};

export const DEFAULT_PREFS: PlannerPrefs = {
  longRideDay: 'auto',
  minRestDays: 1,
  targetMode: 'power',
  maxRampPerWeek: 6,
  indoorFriendly: false,
};

export function defaultWeek(startDate: ISODate, hours = 8): WeekConfig {
  return { startDate, hours, days: {} };
}
