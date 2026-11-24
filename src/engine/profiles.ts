// What a week should contain, given its phase/week type, the event and the chosen
// intensity-distribution model.
import { eventProfile } from './goals';
import type { EventType, GoalSettings, IntensityModel, MacroWeek } from './types';

export interface WeekProfile {
  keySessions: number;
  slots: string[][]; // per key slot, candidate template ids (rotated week to week)
  longRide: string[] | null;
  longRideShare: number;
  variety: string[];
  allowBackToBack: boolean;
  levelCap: number | null; // force low levels (taper/race week)
  distribution: Exclude<IntensityModel, 'auto'>;
  note: string;
}

const EVENT_SPECIFIC: Record<EventType, { slots: string[][]; long: string[] }> = {
  road_race: { slots: [['vo2_3015', 'over_under'], ['thr_surges', 'anaerobic', 'vo2_faststart']], long: ['durability'] },
  crit: { slots: [['crit_sim', 'vo2_4020'], ['anaerobic', 'sprints', 'thr_surges']], long: ['endurance'] },
  gran_fondo: { slots: [['threshold', 'sweetspot'], ['vo2_long', 'over_under']], long: ['durability'] },
  gravel: { slots: [['over_under', 'threshold'], ['vo2_long', 'vo2_3015']], long: ['gravel_sim', 'durability'] },
  tt: { slots: [['tt_sim', 'threshold'], ['vo2_long', 'over_under']], long: ['endurance'] },
  hill_climb: { slots: [['climb_sim', 'threshold'], ['vo2_long', 'vo2_4x8']], long: ['endurance'] },
  mtb_xc: { slots: [['vo2_3015', 'vo2_4020'], ['anaerobic', 'over_under']], long: ['endurance'] },
  cx: { slots: [['vo2_4020', 'vo2_3015'], ['anaerobic', 'crit_sim']], long: ['endurance'] },
  stage_race: { slots: [['threshold', 'over_under'], ['vo2_long', 'thr_surges']], long: ['durability'] },
  ultra: { slots: [['sweetspot', 'tempo'], ['threshold']], long: ['durability'] },
  fitness: { slots: [['sweetspot', 'threshold'], ['vo2_long', 'vo2_3015']], long: ['endurance'] },
  // Non-drafting triathlon: steady power at/below threshold; longer races ride at tempo / sweet spot
  tri_sprint: { slots: [['threshold', 'tt_sim'], ['vo2_long', 'over_under']], long: ['endurance'] },
  tri_olympic: { slots: [['tt_sim', 'threshold'], ['vo2_long', 'over_under']], long: ['endurance'] },
  tri_70_3: { slots: [['sweetspot', 'threshold'], ['tempo', 'over_under']], long: ['durability'] },
  tri_ironman: { slots: [['sweetspot', 'tempo'], ['tempo', 'sweetspot']], long: ['durability'] },
  // Running events: the bike plan is converted to runs (or supports them in run + bike)
  run_5k: { slots: [['vo2_long', 'threshold'], ['vo2_3015', 'sweetspot']], long: ['endurance'] },
  run_10k: { slots: [['threshold', 'vo2_long'], ['sweetspot', 'vo2_3015']], long: ['endurance'] },
  run_half: { slots: [['threshold', 'sweetspot'], ['tempo', 'vo2_long']], long: ['endurance'] },
  run_marathon: { slots: [['sweetspot', 'tempo'], ['threshold']], long: ['durability'] },
  run_ultra: { slots: [['tempo', 'sweetspot'], ['threshold']], long: ['durability'] },
};

const LONG_EVENTS: EventType[] = ['road_race', 'gran_fondo', 'gravel', 'stage_race', 'ultra', 'tri_70_3', 'tri_ironman', 'run_marathon', 'run_ultra'];

export function longRideCap(type: EventType, eventHours: number): number {
  const ev = eventProfile(type);
  if (ev?.longRide) return ev.longRide;
  switch (type) {
    case 'ultra':
      return 420;
    case 'gran_fondo':
    case 'gravel':
      return Math.min(330, Math.max(180, eventHours * 60 * 0.8));
    case 'stage_race':
    case 'road_race':
      return 270;
    case 'hill_climb':
      return 180;
    case 'crit':
    case 'mtb_xc':
    case 'cx':
    case 'tt':
      return 150;
    default:
      return 240;
  }
}

export function resolveDistribution(model: IntensityModel, week: MacroWeek, hours: number): Exclude<IntensityModel, 'auto'> {
  if (model !== 'auto') return model;
  if (hours < 6) return 'sweetspot'; // time-crunched: more intensity per hour
  // Pyramidal through general/base phases, more polarized as competition approaches
  return ['prep', 'base', 'accumulation', 'volume', 'maintain'].includes(week.phase) ? 'pyramidal' : 'polarized';
}

export function weekProfile(week: MacroWeek, goal: GoalSettings, hours: number): WeekProfile {
  const dist = resolveDistribution(goal.intensity, week, hours);
  const ev = EVENT_SPECIFIC[goal.eventType];
  const longEvent = LONG_EVENTS.includes(goal.eventType);
  const share = goal.eventType === 'ultra' ? 0.4 : ['crit', 'cx', 'mtb_xc'].includes(goal.eventType) ? 0.25 : 0.32;
  const late = week.phaseWeeks > 1 ? (week.weekInPhase - 1) / (week.phaseWeeks - 1) > 0.5 : false;

  const p = (o: Partial<WeekProfile>): WeekProfile => ({
    keySessions: 2,
    slots: [],
    longRide: ['endurance'],
    longRideShare: share,
    variety: ['end_sprints', 'end_cadence'],
    allowBackToBack: false,
    levelCap: null,
    distribution: dist,
    note: '',
    ...o,
  });

  if (week.weekType === 'race') {
    return p({
      keySessions: 1,
      slots: [['vo2_3015', 'vo2_long']],
      longRide: null,
      variety: [],
      levelCap: 0,
      note: 'Race week: one short, sharp session early, openers the day before, otherwise easy.',
    });
  }
  if (week.weekType === 'taper') {
    return p({
      keySessions: 2,
      slots: [['vo2_3015', 'vo2_long'], ev.slots[0]],
      longRide: ['endurance'],
      longRideShare: 0.25,
      variety: ['end_sprints'],
      levelCap: 1,
      note: 'Taper: volume drops ~40-60% while intensity and session frequency are kept (Bosquet et al. 2007).',
    });
  }
  if (week.weekType === 'recovery') {
    return p({
      keySessions: 0,
      slots: [],
      longRide: ['endurance'],
      longRideShare: 0.3,
      variety: ['end_cadence', 'end_sprints'],
      note: 'Recovery week: lower volume and no hard intervals so the last block can turn into fitness.',
    });
  }
  if (week.weekType === 'hit_block') {
    return p({
      keySessions: 5,
      slots: [['vo2_long'], ['vo2_3015'], ['vo2_4x8'], ['vo2_long'], ['vo2_3015']],
      longRide: ['endurance'],
      longRideShare: 0.22,
      variety: [],
      allowBackToBack: true,
      note: 'HIT block (Rønnestad et al. 2014): a week with 4-5 VO2max sessions followed by weeks with one HIT session per week.',
    });
  }

  switch (week.phase) {
    case 'prep':
      return p({ keySessions: 1, slots: [['tempo', 'sweetspot']], note: 'General prep: mostly easy riding, one moderate session, build strength.' });
    case 'base':
      if (dist === 'polarized')
        return p({
          keySessions: 1,
          slots: [['vo2_4x8', 'vo2_long'], ['threshold']],
          note: 'Polarized base: one high-intensity session, everything else genuinely easy.',
        });
      if (dist === 'sweetspot')
        return p({
          keySessions: 2,
          slots: [['sweetspot'], late ? ['threshold', 'vo2_long'] : ['sweetspot', 'tempo']],
          note: 'Time-crunched base: sweet spot gives the most aerobic stimulus per hour.',
        });
      return p({
        keySessions: 2,
        slots: late ? [['threshold', 'sweetspot'], ['tempo', 'vo2_4x8']] : [['sweetspot', 'tempo'], ['tempo', 'sweetspot']],
        note: 'Pyramidal base: lots of Zone 2, a couple of tempo/sweet-spot sessions, little very hard work.',
      });
    case 'accumulation':
      return p({
        keySessions: 1,
        slots: [['threshold', 'sweetspot'], ['tempo']],
        note: 'Accumulation block: aerobic volume and threshold, heavy strength.',
      });
    case 'volume':
      return p({
        keySessions: 1,
        slots: [['sweetspot', 'tempo'], ['threshold']],
        longRide: longEvent ? ['durability', 'endurance'] : ['endurance'],
        note: 'Reverse periodization volume phase: longer rides and sustained aerobic work.',
      });
    case 'transmutation':
      return p({
        keySessions: 1,
        slots: [['vo2_3015', 'vo2_long'], ['threshold']],
        note: 'After the HIT week: one VO2 session per week and plenty of easy volume.',
      });
    case 'intensity':
      return p({
        keySessions: 2,
        slots: [['vo2_3015', 'vo2_long'], ['threshold', 'over_under']],
        longRideShare: 0.28,
        note: 'Reverse periodization: raise the ceiling (VO2max/threshold) first while volume is modest.',
      });
    case 'build': {
      const slots =
        dist === 'polarized'
          ? [['vo2_4x8', 'vo2_long', 'vo2_3015'], ['threshold', 'vo2_3015', 'over_under'], ev.slots[1]]
          : dist === 'sweetspot'
            ? [['sweetspot', 'threshold'], ['over_under', 'vo2_long'], ['vo2_3015']]
            : [['threshold', 'over_under'], ['vo2_long', 'vo2_3015', 'vo2_faststart'], ['sweetspot', 'tempo']];
      return p({
        keySessions: hours >= 12 && dist !== 'polarized' ? 3 : 2,
        slots,
        longRide: longEvent && late ? ['durability', 'endurance'] : ['endurance'],
        variety: ['end_sprints'],
        note:
          dist === 'polarized'
            ? 'Polarized build: two high-intensity sessions, strictly easy otherwise.'
            : 'Build: one threshold-type and one VO2max-type session per week, plus the long ride.',
      });
    }
    case 'peak':
    case 'realization':
    case 'specific':
      return p({
        keySessions: 2,
        slots: ev.slots,
        longRide: ev.long,
        variety: goal.eventType === 'crit' || goal.eventType === 'road_race' ? ['end_sprints'] : ['end_cadence'],
        note: 'Peak: race-specific sessions at the highest levels, volume starting to come down.',
      });
    case 'maintain':
      return p({ keySessions: 2, slots: [['sweetspot', 'threshold'], ['vo2_long', 'vo2_3015']], note: 'Maintain: balanced mix.' });
    default:
      return p({ keySessions: 1, slots: [['tempo']] });
  }
}
