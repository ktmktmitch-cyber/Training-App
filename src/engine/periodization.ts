// Macro (season) periodization: allocates weeks from the plan start to the goal event
// into phases, inserts recovery weeks according to the loading pattern, and sets the
// per-week volume factor, focus and strength phase.
import { addDays, diffDays, fmtShort, mondayOf } from './dates';
import type {
  CalendarEvent,
  PlannedRace,
  EventType,
  GoalSettings,
  ISODate,
  MacroPlan,
  MacroWeek,
  Phase,
  StrengthPhase,
  WeekType,
} from './types';
import { eventProfile } from './goals';

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
  tri_sprint: 'Sprint triathlon',
  tri_olympic: 'Olympic-distance triathlon',
  tri_70_3: 'Half Ironman (70.3)',
  tri_ironman: 'Ironman',
  run_5k: '5 km run',
  run_10k: '10 km run',
  run_half: 'Half marathon',
  run_marathon: 'Marathon',
  run_ultra: 'Ultra / trail run',
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
  const ev = eventProfile(type);
  if (ev) return ev.taperDays;
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

export const APP_RACE_PREFIX = 'race-';
export const isAppRace = (e: CalendarEvent) => e.id.startsWith(APP_RACE_PREFIX);

/** Weeks mostly covered by date-range time off (4+ days) count as away weeks for the season plan. */
export function awayWeeksFromRanges(ranges: { start: ISODate; end: ISODate }[] = []): ISODate[] {
  const days = new Map<ISODate, number>();
  for (const r of ranges) {
    if (diffDays(r.end, r.start) < 0 || diffDays(r.end, r.start) > 120) continue;
    for (let d = r.start; diffDays(r.end, d) >= 0; d = addDays(d, 1)) days.set(mondayOf(d), (days.get(mondayOf(d)) ?? 0) + 1);
  }
  return [...days].filter(([, n]) => n >= 4).map(([m]) => m);
}

/** Weeks and date ranges you can't train, as holiday days on the calendar (the planner leaves them empty). */
export function withAwayWeeks(events: CalendarEvent[], awayWeeks: ISODate[] = [], ranges: { id: string; start: ISODate; end: ISODate; note?: string }[] = []): CalendarEvent[] {
  if (!awayWeeks.length && !ranges.length) return events;
  const extra = awayWeeks.map<CalendarEvent>((d) => {
    const m = mondayOf(d);
    return { id: `away-${m}`, date: m, endDate: addDays(m, 6), category: 'HOLIDAY', name: 'Away — no training' };
  });
  for (const r of ranges) extra.push({ id: `off-${r.id}`, date: r.start, endDate: r.end, category: 'HOLIDAY', name: r.note ? `Off — ${r.note}` : 'Off — no training' });
  return [...events, ...extra];
}

/** Races you added in the app, as calendar events (skipping any already on your intervals.icu calendar that day). */
export function withAppRaces(events: CalendarEvent[], races: PlannedRace[] = []): CalendarEvent[] {
  const extra = races
    .filter((r) => !events.some((e) => e.date === r.date && e.category.startsWith('RACE_')))
    .map<CalendarEvent>((r) => ({ id: `${APP_RACE_PREFIX}${r.id}`, date: r.date, category: `RACE_${r.priority}`, name: r.name, plannedSec: r.durationMin * 60 }));
  return extra.length ? [...events, ...extra] : events;
}

export function resolveGoalDate(goal: GoalSettings, events: CalendarEvent[], asOf: ISODate): { date: ISODate | null; name: string } {
  if (goal.eventDate && goal.eventType !== 'fitness' && diffDays(goal.eventDate, asOf) >= 0) return { date: goal.eventDate, name: goal.eventName || 'Goal event' };
  const nextA = (pred: (e: CalendarEvent) => boolean) =>
    events.filter((e) => e.category === 'RACE_A' && diffDays(e.date, asOf) >= 0 && pred(e)).sort((x, y) => x.date.localeCompare(y.date))[0];
  // An A race you add in the app always becomes the season goal (build → peak → taper)
  const mine = nextA((e) => isAppRace(e));
  if (mine) return { date: mine.date, name: mine.name || 'A race' };
  if (goal.eventType === 'fitness') return { date: null, name: goal.eventName || 'General fitness' };
  if (goal.useCalendarRaces) {
    const a = nextA(() => true);
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
    // A race added in the app while the goal type is "general fitness": taper like a road race of that length
    const goalRace = events.find((e) => e.date === goalDate && isAppRace(e) && e.category === 'RACE_A');
    taperDays =
      goal.eventType === 'fitness' && goalRace
        ? taperDaysFor('road_race', (goalRace.plannedSec ?? 7200) / 3600)
        : taperDaysFor(goal.eventType, goal.eventDurationHours);
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

  const away = [...(goal.awayWeeks ?? []), ...awayWeeksFromRanges(goal.offRanges)];
  applyRestWeeks(weeks, [...(goal.restWeeks ?? []), ...away], cycleLen, segs[0]?.phase ?? null, away);
  return { weeks, goalDate, taperDays, summary };
}

/** Phases where a chosen rest week is allowed (not peak/taper/race weeks). */
const RESTABLE: Phase[] = ['prep', 'base', 'accumulation', 'intensity', 'build', 'volume', 'transmutation', 'maintain', 'transition'];

export function canChooseRest(w: MacroWeek): boolean {
  return Boolean(w.userRest) || (RESTABLE.includes(w.phase) && w.weekType !== 'recovery' && !w.races.some((r) => r.category === 'RACE_A'));
}

/**
 * Turn the weeks you picked into rest weeks. A rest week restarts the loading cycle, so the
 * next recovery week moves to a full cycle after it (no two easy weeks close together, and
 * no over-long loading run), until the schedule lines up with the plan again.
 */
export function applyRestWeeks(weeks: MacroWeek[], restWeeks: ISODate[], cycleLen: number, firstPhase: Phase | null, awayWeeks: ISODate[] = []): void {
  const chosen = new Set(restWeeks.map((d) => mondayOf(d)));
  const away = new Set(awayWeeks.map((d) => mondayOf(d)));
  if (!chosen.size) return;
  const maxLoad = Math.max(1, cycleLen - 1);
  // A scheduled recovery week right before one of your rest/away weeks is redundant: make it a
  // loading week instead (unless that would stretch the loading run too far)
  for (let i = 1; i < weeks.length; i++) {
    const prev = weeks[i - 1];
    if (!chosen.has(weeks[i].start) || chosen.has(prev.start) || prev.weekType !== 'recovery' || !RESTABLE.includes(prev.phase)) continue;
    let run = 0;
    for (let j = i - 2; j >= 0 && weeks[j].weekType === 'load' && !chosen.has(weeks[j].start); j--) run++;
    if (run + 1 > maxLoad + 1) continue;
    const arr = VOLUME[prev.phase] ?? [0.9];
    weeks[i - 1] = {
      ...prev,
      weekType: 'load',
      loadStep: run + 1,
      volumeFactor: arr[Math.min(arr.length - 1, run)],
      estTssPerHour: TSS_PER_HOUR[prev.phase],
      strengthPhase: strengthPhaseFor(prev.phase, 'load', prev.weekInPhase, prev.phaseWeeks, prev.phase === firstPhase),
      focus: `${FOCUS[prev.phase]} (recovery moved to your week off next week)`,
    };
  }
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    if (!chosen.has(w.start) || !RESTABLE.includes(w.phase) || w.races.some((r) => r.category === 'RACE_A')) continue;
    weeks[i] = {
      ...w,
      weekType: 'recovery',
      loadStep: 0,
      volumeFactor: 0.6,
      estTssPerHour: 42,
      strengthPhase: 'DL',
      userRest: true,
      focus: 'Rest week (your choice) — ~40% less volume, easy riding only, no hard sessions',
    };
    if (away.has(w.start)) weeks[i] = { ...weeks[i], userAway: true, volumeFactor: 0, estTssPerHour: 0, focus: 'Away — no training planned this week. Expect to come back a little fresher and a little less fit.' };
    // Restart the loading cycle after it: load, load, …, recovery, until it lines up with the
    // plan again (or hits a HIT block, peak/taper, or another rest week you chose)
    for (let j = i + 1, pos = 1; j < weeks.length; j++, pos++) {
      const n = weeks[j];
      if (chosen.has(n.start) || n.weekType === 'hit_block' || !RESTABLE.includes(n.phase)) break;
      const wantRecovery = pos % (maxLoad + 1) === 0;
      if (wantRecovery && n.weekType === 'recovery') break; // back in step with the plan
      if (wantRecovery) {
        weeks[j] = { ...n, weekType: 'recovery', loadStep: 0, volumeFactor: 0.6, estTssPerHour: 42, strengthPhase: 'DL', focus: 'Recovery week — ~40% less volume, light intensity, absorb the block' };
      } else {
        const step = pos % (maxLoad + 1);
        const arr = VOLUME[n.phase] ?? [0.9];
        const wasRecovery = n.weekType === 'recovery';
        weeks[j] = {
          ...n,
          weekType: 'load',
          loadStep: step,
          volumeFactor: arr[Math.min(arr.length - 1, step - 1)],
          estTssPerHour: TSS_PER_HOUR[n.phase],
          strengthPhase: strengthPhaseFor(n.phase, 'load', n.weekInPhase, n.phaseWeeks, n.phase === firstPhase),
          focus: wasRecovery ? `${FOCUS[n.phase]} (recovery moved — you just had a rest week)` : n.focus,
        };
      }
    }
  }
}

export function macroWeekFor(plan: MacroPlan, date: ISODate): MacroWeek | null {
  return plan.weeks.find((w) => diffDays(date, w.start) >= 0 && diffDays(date, w.start) < 7) ?? null;
}
