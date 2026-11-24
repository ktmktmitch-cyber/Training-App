// Triathlon and running goal events: what each distance needs, so the plan builds toward it.
//
// For each event we set the sport split, the longest session in each sport the plan builds to
// (reached in the peak/specific phase, approached gradually and never faster than the running
// safety cap allows), the run quality sessions that matter most for that distance, brick length
// and the taper. Values follow common coaching practice for age-group athletes:
//  * 5k/10k: VO2max and threshold intervals; long run ~60-90 min. 7-8 day taper.
//  * Half marathon: threshold + race pace; long run to ~2 h. ~10 day taper.
//  * Marathon: long run to ~3 h, marathon-pace long runs late; 2-3 week taper.
//  * Sprint/Olympic tri: threshold/VO2 run and bike, short bricks, open-water skills.
//  * 70.3 / Ironman: aerobic durability — long rides to 4/5.5 h, long runs to 2/2.75 h,
//    race-pace bricks and long continuous swims; intensity mostly tempo/sweet spot.
import type { EventType, Phase, SportMode } from './types';

export type EventKind = 'bike' | 'tri' | 'run';

export interface EventProfile {
  kind: EventKind;
  /** the sport plan this event needs */
  sport: SportMode;
  label: string;
  distance: string;
  /** typical finishing time for an age-grouper, hours (default for "expected duration") */
  hours: number;
  taperDays: number;
  share?: { ride: number; run: number; swim: number };
  /** longest session the plan builds to, minutes */
  longRun?: number;
  longRide?: number;
  longSwim?: number;
  brick?: number;
  /** key run sessions by phase group */
  runQuality?: { base: string[]; build: string[]; specific: string[] };
  /** a race-specific long run in the specific phase (e.g. marathon-pace finish) */
  longRunSpecific?: string;
  guidance: string[];
}

export const TRI_EVENTS: EventType[] = ['tri_sprint', 'tri_olympic', 'tri_70_3', 'tri_ironman'];
export const RUN_EVENTS: EventType[] = ['run_5k', 'run_10k', 'run_half', 'run_marathon', 'run_ultra'];

export const EVENT_PROFILES: Partial<Record<EventType, EventProfile>> = {
  tri_sprint: {
    kind: 'tri', sport: 'triathlon', label: 'Sprint triathlon', distance: '750 m swim · 20 km bike · 5 km run', hours: 1.25, taperDays: 7,
    share: { ride: 0.45, run: 0.32, swim: 0.23 }, longRun: 60, longRide: 120, longSwim: 45, brick: 20,
    runQuality: { base: ['run_hills', 'run_tempo'], build: ['run_threshold', 'run_vo2'], specific: ['run_racepace', 'run_vo2'] },
    guidance: ['Short and fast: threshold and VO2max work in all three sports.', 'Short bricks (15-20 min) to practise running off the bike.', 'Open-water practice before race day if the swim is outdoors.'],
  },
  tri_olympic: {
    kind: 'tri', sport: 'triathlon', label: 'Olympic triathlon', distance: '1.5 km swim · 40 km bike · 10 km run', hours: 2.5, taperDays: 10,
    share: { ride: 0.48, run: 0.32, swim: 0.2 }, longRun: 80, longRide: 150, longSwim: 60, brick: 25,
    runQuality: { base: ['run_hills', 'run_tempo'], build: ['run_threshold', 'run_vo2'], specific: ['run_racepace', 'run_threshold'] },
    guidance: ['Threshold is king: bike and run intervals around race intensity.', 'Bricks build to ~25 min at race pace off key rides.', 'CSS swim sets for pacing the 1.5 km.'],
  },
  tri_70_3: {
    kind: 'tri', sport: 'triathlon', label: 'Half Ironman (70.3)', distance: '1.9 km swim · 90 km bike · 21.1 km run', hours: 5.5, taperDays: 12,
    share: { ride: 0.52, run: 0.3, swim: 0.18 }, longRun: 120, longRide: 240, longSwim: 70, brick: 40,
    runQuality: { base: ['run_tempo', 'run_hills'], build: ['run_threshold', 'run_tempo'], specific: ['run_racepace', 'run_progression'] },
    guidance: ['Aerobic durability: long ride builds to ~4 h, long run to ~2 h.', 'Race-pace bricks (30-40 min) off long rides late in the build.', 'Practise race nutrition on every long ride — 60-90 g carbs/h.'],
  },
  tri_ironman: {
    kind: 'tri', sport: 'triathlon', label: 'Ironman', distance: '3.8 km swim · 180 km bike · 42.2 km run', hours: 12, taperDays: 17,
    share: { ride: 0.55, run: 0.28, swim: 0.17 }, longRun: 165, longRide: 330, longSwim: 80, brick: 45,
    runQuality: { base: ['run_tempo', 'run_hills'], build: ['run_tempo', 'run_threshold'], specific: ['run_racepace', 'run_progression'] },
    guidance: ['Volume and durability first: long ride builds to ~5.5 h, long run to ~2 h 45.', 'Most intensity is tempo / sweet spot (Ironman pace), not VO2max.', 'Long runs stop short of the marathon distance — the bike carries the volume; bricks practise the marathon start.', 'Nutrition is the 4th discipline: train the gut with 80-100 g carbs/h.'],
  },
  run_5k: {
    kind: 'run', sport: 'running', label: '5 km', distance: '5 km', hours: 0.4, taperDays: 7, longRun: 75,
    runQuality: { base: ['run_hills', 'run_fartlek'], build: ['run_vo2', 'run_3030'], specific: ['run_racepace', 'run_vo2'] },
    guidance: ['VO2max intervals and 5k-pace reps are the key sessions.', 'Long run ~60-75 min keeps the aerobic base.', 'Strides 2× a week for speed and form.'],
  },
  run_10k: {
    kind: 'run', sport: 'running', label: '10 km', distance: '10 km', hours: 0.85, taperDays: 8, longRun: 90,
    runQuality: { base: ['run_hills', 'run_tempo'], build: ['run_threshold', 'run_vo2'], specific: ['run_racepace', 'run_threshold'] },
    guidance: ['Threshold and VO2max intervals, then 10k-pace reps.', 'Long run builds to ~90 min.'],
  },
  run_half: {
    kind: 'run', sport: 'running', label: 'Half marathon', distance: '21.1 km', hours: 1.9, taperDays: 10, longRun: 120,
    runQuality: { base: ['run_tempo', 'run_hills'], build: ['run_threshold', 'run_tempo'], specific: ['run_racepace', 'run_threshold'] },
    longRunSpecific: 'run_long_ff',
    guidance: ['Threshold is the key: tempo runs and cruise intervals.', 'Long run builds to ~2 h, with a fast finish late in the plan.'],
  },
  run_marathon: {
    kind: 'run', sport: 'running', label: 'Marathon', distance: '42.2 km', hours: 4, taperDays: 17, longRun: 180,
    runQuality: { base: ['run_tempo', 'run_hills'], build: ['run_threshold', 'run_progression'], specific: ['run_racepace', 'run_tempo'] },
    longRunSpecific: 'run_long_ff',
    guidance: ['Long run builds to ~3 h (about 30-35 km) — longer adds injury risk, not fitness.', 'Marathon-pace work inside long runs in the last 6-8 weeks.', '2-3 week taper; practise race fuelling (60-90 g carbs/h) on long runs.'],
  },
  run_ultra: {
    kind: 'run', sport: 'running', label: 'Ultra / trail', distance: 'beyond 42.2 km', hours: 7, taperDays: 14, longRun: 180,
    runQuality: { base: ['run_hills', 'run_tempo'], build: ['run_hills', 'run_tempo'], specific: ['run_hills', 'run_progression'] },
    longRunSpecific: 'run_long_ff',
    guidance: ['Time on feet: long runs to ~3 h, back-to-back long weekend runs late in the build.', 'Hill repeats and hiking for climbing; mostly easy effort.', 'Practise fuelling, kit and terrain like race day.'],
  },
};

export const eventProfile = (t: EventType | undefined | null): EventProfile | null => (t ? (EVENT_PROFILES[t] ?? null) : null);
export const isTriEvent = (t: EventType | undefined | null) => !!t && TRI_EVENTS.includes(t);
export const isRunEvent = (t: EventType | undefined | null) => !!t && RUN_EVENTS.includes(t);

/** Which group of run sessions this phase calls for. */
export function phaseGroup(p: Phase): 'base' | 'build' | 'specific' {
  if (['peak', 'specific', 'realization', 'taper', 'race'].includes(p)) return 'specific';
  if (['build', 'intensity', 'transmutation'].includes(p)) return 'build';
  return 'base';
}

/**
 * How far along the build to the event's longest session this phase is: the long sessions
 * grow through base → build → peak and come down in the taper.
 */
export function longFraction(p: Phase): number {
  switch (p) {
    case 'prep':
    case 'transition':
      return 0.55;
    case 'base':
    case 'accumulation':
    case 'intensity':
      return 0.7;
    case 'build':
    case 'volume':
    case 'transmutation':
    case 'maintain':
      return 0.85;
    case 'taper':
    case 'race':
      return 0.55;
    default:
      return 1; // peak / specific / realization
  }
}

/** Sport the goal event is raced in, for the race-day entry. */
export function raceSport(t: EventType | undefined | null): 'ride' | 'run' | null {
  return isRunEvent(t) ? 'run' : null;
}
