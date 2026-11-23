// Macro (season) periodization: allocates weeks from the plan start to the goal event
// into phases, inserts recovery weeks according to the loading pattern, and sets the
// per-week volume factor, focus and strength phase.
import { addDays, diffDays, fmtShort, mondayOf } from './dates';
import type {
  CalendarEvent,
  EventType,
  GoalSettings,
  ISODate,
  MacroPlan,
  MacroWeek,
  Phase,
  StrengthPhase,
  WeekType,
} from './types';

export const EVENT_LABELS: Record<EventType, string> = {
  road_race: 'Road race',
  crit: 'Criterium',
  gran_fondo: 'Gran fondo / century',
  gravel: 'Gravel race',
  tt: 'Time trial',
  hill_climb: 'Hill climb',
  mtb_xc: 'MTB cross-country',
  cx: 'Cyclocross',
  stage_race: 'Stage race',
  ultra: 'Ultra-endurance',
  fitness: 'General fitness (no event)',
};

export const PHASE_LABELS: Record<Phase, string> = {
  prep: 'Prep',
  base: 'Base',
  build: 'Build',
  peak: 'Peak',
  taper: 'Taper',
  race: 'Race',
  accumulation: 'Accumulation',
  transmutation: 'Transmutation',
  realization: 'Realization',
  intensity: 'Intensity',
  volume: 'Volume',
  specific: 'Specific',
  maintain: 'Maintain',
  transition: 'Transition',
};

const FOCUS: Record<Phase, string> = {
  prep: 'General preparation — easy aerobic volume, skills, strength foundation',
  base: 'Aerobic base — Zone 2 volume, tempo/sweet spot, heavy strength',
  build: 'Build — threshold + VO2max work, strength → power',
  peak: 'Peak — race-specific intensity, slightly less volume, strength maintenance',
  taper: 'Taper — cut volume 40-60%, keep intensity and frequency',
  race: 'Race week — short sharp efforts, openers, race',
  accumulation: 'Accumulation — high aerobic volume + threshold, heavy strength',
  transmutation: 'Transmutation — concentrated VO2max block, then absorb',
  realization: 'Realization — race-specific sharpening',
  intensity: 'Reverse: intensity first — VO2max/threshold on lower volume',
  volume: 'Reverse: volume — longer rides, sweet spot, durability',
  specific: 'Specific — race simulation and durability',
  maintain: 'Maintain — balanced mix in rolling cycles',
  transition: 'Transition — unstructured, active recovery',
};

export function taperDaysFor(type: EventType, durationH: number): number {
  switch (type) {
    case 'crit':
    case 'mtb_xc':
    case 'cx':
      return 7;
    case 'ultra':
      return 14;
    case 'gran_fondo':
    case 'gravel':
      return durationH > 5 ? 14 : 10;
    case 'fitness':
      return 0;
    default:
      return 10;
  }
}

const cycleLength = (p: GoalSettings['loadPattern']) => (p === '2:1' ? 3 : p === '4:1' ? 5 : 4);

/** Split n weeks into k ≈ equal cycles (each ends with a recovery week). */
function cycles(n: number, cycleLen: number): number[] {
  if (n <= 1) return n === 1 ? [1] : [];
  const k = Math.max(1, Math.min(Math.round(n / cycleLen), Math.floor(n / 2)));
  const base = Math.floor(n / k);
  const extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

interface Seg {
  phase: Phase;
  weeks: number;
}

function allocate(goal: GoalSettings, n: number, taperWeeks: number): Seg[] {
  const remaining = n - 1 - taperWeeks; // minus race week
  const tail: Seg[] = [];
  if (taperWeeks) tail.push({ phase: 'taper', weeks: taperWeeks });
  tail.push({ phase: 'race', weeks: 1 });
  if (remaining <= 0) return tail.slice(-n);

  const peakWeeks = remaining >= 18 ? 3 : remaining >= 5 ? 2 : remaining >= 3 ? 1 : 0;
  let rem = remaining - peakWeeks;

  if (goal.model === 'block') {
    // Alternating 4-week accumulation → transmutation blocks that always open with
    // accumulation and finish with transmutation right before realization.
    const prep = rem > 32 ? rem - 32 : 0;
    rem -= prep;
    let n4 = Math.floor(rem / 4);
    const leftover = rem % 4;
    const segs: Seg[] = [];
    if (n4 === 0) {
      segs.push({ phase: 'accumulation', weeks: rem });
    } else {
      // Even number of blocks → A,T,A,T…; odd → first accumulation is a double block
      let firstAcc = leftover;
      if (n4 % 2 === 1) {
        if (n4 === 1) {
          segs.push(...(leftover ? [{ phase: 'accumulation' as Phase, weeks: leftover }] : []), { phase: 'transmutation', weeks: 4 });
          n4 = 0;
        } else {
          firstAcc += 4;
          n4 -= 1;
        }
      }
      for (let i = 0; i < n4; i++) {
        const acc = i % 2 === 0;
        segs.push({ phase: acc ? 'accumulation' : 'transmutation', weeks: 4 + (i === 0 ? firstAcc : 0) });
      }
    }
    return mergeAdjacent([
      ...(prep ? [{ phase: 'prep' as Phase, weeks: prep }] : []),
      ...segs,
      ...(peakWeeks ? [{ phase: 'realization' as Phase, weeks: peakWeeks }] : []),
      ...tail,
    ]);
  }

  if (goal.model === 'reverse') {
    const prep = rem > 24 ? rem - 24 : 0;
    rem -= prep;
    const intensity = Math.round(rem * 0.45);
    const volume = rem - intensity;
    return mergeAdjacent([
      ...(prep ? [{ phase: 'prep' as Phase, weeks: prep }] : []),
      { phase: 'intensity', weeks: intensity },
      { phase: 'volume', weeks: volume },
      ...(peakWeeks ? [{ phase: 'specific' as Phase, weeks: peakWeeks }] : []),
      ...tail,
    ]);
  }

  // linear / hrv_flex
  let build: number;
  let base: number;
  let prep = 0;
  if (rem <= 6) {
    build = rem;
    base = 0;
  } else if (rem <= 12) {
    build = Math.max(4, Math.ceil(rem / 2));
    base = rem - build;
  } else {
    build = 8;
    base = Math.min(16, rem - 8);
    prep = rem - build - base;
  }
  return mergeAdjacent([
    ...(prep ? [{ phase: 'prep' as Phase, weeks: prep }] : []),
    ...(base ? [{ phase: 'base' as Phase, weeks: base }] : []),
    ...(build ? [{ phase: 'build' as Phase, weeks: build }] : []),
    ...(peakWeeks ? [{ phase: 'peak' as Phase, weeks: peakWeeks }] : []),
    ...tail,
  ]);
}

function mergeAdjacent(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    if (s.weeks <= 0) continue;
    const last = out[out.length - 1];
    if (last && last.phase === s.phase) last.weeks += s.weeks;
    else out.push({ ...s });
  }
  return out;
}

const VOLUME: Partial<Record<Phase, number[]>> = {
  prep: [0.7, 0.75, 0.8],
  base: [0.85, 0.92, 1, 1],
  accumulation: [0.88, 0.95, 1, 1],
  volume: [0.88, 0.95, 1, 1],
  build: [0.9, 0.95, 1, 1],
  transmutation: [0.9, 0.95, 1, 1],
  intensity: [0.8, 0.85, 0.9, 0.9],
  maintain: [0.85, 0.9, 0.95, 0.95],
};

const TSS_PER_HOUR: Record<Phase, number> = {
  prep: 45,
  base: 50,
  build: 58,
  peak: 60,
  taper: 55,
  race: 55,
  accumulation: 50,
  transmutation: 60,
  realization: 60,
  intensity: 60,
  volume: 52,
  specific: 58,
  maintain: 55,
  transition: 35,
};

function strengthPhaseFor(phase: Phase, weekType: WeekType, weekInPhase: number, phaseWeeks: number, firstPhase: boolean): StrengthPhase {
  if (weekType === 'recovery') return 'DL';
  switch (phase) {
    case 'prep':
      return 'AA';
    case 'base':
    case 'accumulation':
    case 'intensity':
      return firstPhase && weekInPhase <= 2 ? 'AA' : 'MS';
    case 'build':
    case 'volume':
      return weekInPhase <= Math.ceil(phaseWeeks / 2) ? 'SP' : 'MT';
    case 'transmutation':
      return 'SP';
    case 'peak':
    case 'realization':
    case 'specific':
    case 'maintain':
      return 'MT';
    case 'taper':
    case 'race':
      return 'TP';
    default:
      return 'MT';
  }
}

export function resolveGoalDate(goal: GoalSettings, events: CalendarEvent[], asOf: ISODate): { date: ISODate | null; name: string } {
  if (goal.eventType === 'fitness') return { date: null, name: goal.eventName || 'General fitness' };
  if (goal.eventDate && diffDays(goal.eventDate, asOf) >= 0) return { date: goal.eventDate, name: goal.eventName || 'Goal event' };
  if (goal.useCalendarRaces) {
    const a = events
      .filter((e) => e.category === 'RACE_A' && diffDays(e.date, asOf) >= 0)
      .sort((x, y) => x.date.localeCompare(y.date))[0];
    if (a) return { date: a.date, name: a.name || 'A race' };
  }
  return { date: null, name: goal.eventName || 'General fitness' };
}

export function buildMacroPlan(goal: GoalSettings, events: CalendarEvent[], asOf: ISODate): MacroPlan {
  const { date: goalDate, name } = resolveGoalDate(goal, events, asOf);
  const cycleLen = cycleLength(goal.loadPattern);
  const currentMonday = mondayOf(addDays(asOf, 1));
  let start = mondayOf(goal.planStart ?? currentMonday);
  const summary: string[] = [];

  let segs: Seg[];
  let taperDays = 0;
  if (!goalDate) {
    // Rolling cycles anchored at plan start: base 8 → build 8, repeating
    if (diffDays(start, currentMonday) > 0) start = currentMonday;
    const elapsed = Math.max(0, Math.floor(diffDays(currentMonday, start) / 7));
    const cycleStart = elapsed - (elapsed % 16);
    start = addDays(start, cycleStart * 7);
    segs = [
      { phase: 'base', weeks: 8 },
      { phase: 'build', weeks: 8 },
      { phase: 'base', weeks: 8 },
      { phase: 'build', weeks: 8 },
    ];
    summary.push('No goal event — rolling 16-week cycles (8 base → 8 build) with regular recovery weeks. Set a goal date to get peak and taper phases.');
  } else {
    const raceMonday = mondayOf(goalDate);
    if (diffDays(raceMonday, start) < 0) start = currentMonday;
    if (diffDays(raceMonday, start) < 0) start = raceMonday;
    const n = Math.floor(diffDays(raceMonday, start) / 7) + 1;
    taperDays = taperDaysFor(goal.eventType, goal.eventDurationHours);
    const raceOffset = (diffDays(goalDate, raceMonday) + 7) % 7;
    const taperWeeks = n >= 2 && taperDays - raceOffset > 2 ? 1 : 0;
    segs = allocate(goal, n, taperWeeks);
    const weeksLeft = Math.floor(diffDays(raceMonday, currentMonday) / 7) + 1;
    summary.push(
      `${weeksLeft} week${weeksLeft === 1 ? '' : 's'} to ${name} (${fmtShort(goalDate)}). Plan: ${segs
        .map((s) => `${s.weeks} ${PHASE_LABELS[s.phase].toLowerCase()}`)
        .join(' · ')}. Taper ≈ ${taperDays} days.`,
    );
  }

  // Expand segments into weeks
  const weeks: MacroWeek[] = [];
  let idx = 0;
  segs.forEach((seg, segIdx) => {
    const types: WeekType[] = [];
    const steps: number[] = [];
    const noRecovery = ['peak', 'taper', 'race', 'realization', 'specific'].includes(seg.phase);
    if (noRecovery) {
      for (let i = 0; i < seg.weeks; i++) {
        types.push(seg.phase === 'taper' ? 'taper' : seg.phase === 'race' ? 'race' : 'load');
        steps.push(i + 1);
      }
    } else if (seg.phase === 'transmutation') {
      for (const len of cycles(seg.weeks, cycleLen)) {
        for (let i = 0; i < len; i++) {
          const last = i === len - 1 && len > 1;
          types.push(i === 0 ? 'hit_block' : last ? 'recovery' : 'load');
          steps.push(last ? 0 : i + 1);
        }
      }
    } else {
      for (const len of cycles(seg.weeks, cycleLen)) {
        for (let i = 0; i < len; i++) {
          const last = i === len - 1 && len > 1;
          types.push(last ? 'recovery' : 'load');
          steps.push(last ? 0 : i + 1);
        }
      }
    }
    for (let i = 0; i < seg.weeks; i++) {
      const weekType = types[i];
      const loadStep = steps[i];
      let volumeFactor: number;
      if (weekType === 'recovery') volumeFactor = 0.6;
      else if (weekType === 'hit_block') volumeFactor = 0.85;
      else if (weekType === 'taper') volumeFactor = taperDays >= 14 ? 0.7 : 0.65;
      else if (weekType === 'race') volumeFactor = 0.45;
      else if (['peak', 'realization', 'specific'].includes(seg.phase)) volumeFactor = i === 0 ? 0.9 : 0.85;
      else {
        const arr = VOLUME[seg.phase] ?? [0.9];
        volumeFactor = arr[Math.min(arr.length - 1, Math.max(0, loadStep - 1))];
      }
      const wStart = addDays(start, idx * 7);
      const wEnd = addDays(wStart, 6);
      const races = events.filter(
        (e) => ['RACE_A', 'RACE_B', 'RACE_C'].includes(e.category) && diffDays(e.date, wStart) >= 0 && diffDays(wEnd, e.date) >= 0,
      );
      if (goalDate && diffDays(goalDate, wStart) >= 0 && diffDays(wEnd, goalDate) >= 0 && !races.some((r) => r.date === goalDate)) {
        races.push({ id: 'goal', date: goalDate, category: 'RACE_A', name });
      }
      let focus = FOCUS[seg.phase];
      if (weekType === 'recovery') focus = 'Recovery week — ~40% less volume, light intensity, absorb the block';
      if (weekType === 'hit_block') focus = 'HIT block — 4-5 VO2max sessions this week, everything else very easy';
      weeks.push({
        index: idx,
        start: wStart,
        phase: seg.phase,
        weekType,
        weekInPhase: i + 1,
        phaseWeeks: seg.weeks,
        loadStep,
        volumeFactor,
        focus,
        strengthPhase: strengthPhaseFor(seg.phase, weekType, i + 1, seg.weeks, segIdx === 0),
        races,
        estTssPerHour: weekType === 'recovery' ? 42 : TSS_PER_HOUR[seg.phase],
      });
      idx++;
    }
  });

  return { weeks, goalDate, taperDays, summary };
}

export function macroWeekFor(plan: MacroPlan, date: ISODate): MacroWeek | null {
  return plan.weeks.find((w) => diffDays(date, w.start) >= 0 && diffDays(date, w.start) < 7) ?? null;
}
