// Weekly planner: turns the macro week, your availability (hours, blocked days, group
// rides, pinned workouts, races), readiness and training history into a 7-day plan.
//
// Core rules (current consensus coaching practice):
//  * Keep hard days hard and easy days easy; avoid back-to-back hard days (except a
//    deliberate HIT block week).
//  * Number of quality sessions follows the phase (typically 2/week, 0 in recovery weeks).
//  * Group rides and races count as quality sessions.
//  * Long ride on the day with the most time (default weekend), progressed gradually.
//  * At least one full rest day; days after hard days are recovery/easy.
//  * Respect the CTL ramp-rate limit; readiness can trim volume and delay intensity.
import { eventProfile } from './goals';
import { addDays, diffDays, dow, dowLong, dowShort, fmtMinutes, range } from './dates';
import { fuelingFor } from './fueling';
import { EXTERNAL_PREFIX } from './icuExport';
import { buildMobility, type MobilitySession } from './mobility';
import { longRideCap, weekProfile, type WeekProfile } from './profiles';
import { macroWeekFor, PHASE_LABELS } from './periodization';
import { projectLoad, round } from './stats';
import { planStrength } from './strength';
import type { TrainingCamp } from './types';
import type {
  AthleteProfile,
  CalendarEvent,
  DayConfig,
  GoalSettings,
  ISODate,
  MacroPlan,
  MacroWeek,
  PlannedDay,
  PlannedWorkout,
  PlannerPrefs,
  Readiness,
  MobilityPrefs,
  StrengthSettings,
  Trends,
  WeekConfig,
  WeekPlan,
} from './types';
import type { LoadFocus } from './loadFocus';
import { DIFFICULTY_LABEL, difficultyOf, PROG_LABEL, progressionCapable, TEMPLATE_ZONE, workoutLevel, type Difficulty, type ProgZone, type Progression } from './progression';
import { blocksLoad, getTemplate, GROUP_IF, tssFromIf, WORKOUT_BY_ID, type WorkoutTemplate } from './workouts';

export interface PlanInput {
  startDate: ISODate;
  asOf: ISODate;
  week: WeekConfig;
  goal: GoalSettings;
  macro: MacroPlan;
  prefs: PlannerPrefs;
  strength: StrengthSettings;
  readiness: Readiness;
  trends: Trends;
  profile: AthleteProfile;
  events: CalendarEvent[];
  progression?: Progression;
  loadFocus?: LoadFocus;
  carryOver?: { date: ISODate; templateId: string; name: string }[];
  limiter?: ProgZone | null; // from the power profile
}

const FALLBACK_WEEK: MacroWeek = {
  index: 0,
  start: '1970-01-05',
  phase: 'base',
  weekType: 'load',
  weekInPhase: 1,
  phaseWeeks: 1,
  loadStep: 1,
  volumeFactor: 0.9,
  focus: 'General training',
  strengthPhase: 'MS',
  races: [],
  estTssPerHour: 50,
};

export function defaultDayCap(date: ISODate, hours: number): number {
  const d = dow(date);
  if (d === 0 || d === 6) return Math.max(120, Math.round((hours * 60 * 0.4) / 15) * 15);
  return hours >= 12 ? 150 : hours >= 8 ? 120 : 90;
}

const RIDE_EVENT_TYPES = new Set(['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide']);
const CAL_TYPES = new Set([...RIDE_EVENT_TYPES, 'Run', 'Swim']);

/** Coach workouts sent from this app carry the library workout in their id: tacoach-<date>-<templateId>-L<level>-<rand> */
export function parseCoachId(externalId: string | null | undefined): { templateId: string; level: number | null } | null {
  const m = (externalId ?? '').match(/^tacoach-\d{4}-\d{2}-\d{2}-([a-z0-9_]+?)(?:-L(\d+))?-[a-z0-9]+$/);
  return m && WORKOUT_BY_ID[m[1]] ? { templateId: m[1], level: m[2] != null ? Number(m[2]) : null } : null;
}

export function effectiveDayConfig(date: ISODate, week: WeekConfig, events: CalendarEvent[], goalDate: ISODate | null, campDay?: (d: ISODate) => DayConfig['camp'] | null): DayConfig {
  const user = week.days[date];
  if (user && user.status !== 'available') return user;
  const base: DayConfig = user ?? { status: 'available', maxMinutes: null };
  const evs = events.filter((e) => e.date === date || (e.endDate && diffDays(date, e.date) >= 0 && diffDays(e.endDate, date) >= 0));
  const race = evs.find((e) => ['RACE_A', 'RACE_B', 'RACE_C'].includes(e.category));
  if (race) {
    const priority = race.category === 'RACE_A' ? 'A' : race.category === 'RACE_B' ? 'B' : 'C';
    return { ...base, status: 'race', race: { name: race.name, durationMin: race.plannedSec ? Math.round(race.plannedSec / 60) : 120, priority } };
  }
  if (goalDate === date) return { ...base, status: 'race', race: { name: 'Goal event', durationMin: 180, priority: 'A' } };
  // A ride already on the intervals.icu calendar (coach, TrainerRoad, …) — not one this app sent
  const cal = evs.find((e) => e.category === 'WORKOUT' && (!e.type || CAL_TYPES.has(e.type)) && !(e.externalId ?? '').startsWith(`${EXTERNAL_PREFIX}-`) && e.date === date);
  if (cal && !user?.skipCalendar) {
    const coach = parseCoachId(cal.externalId);
    return { ...base, status: 'scheduled', scheduled: { name: cal.name, durationMin: cal.plannedSec ? Math.round(cal.plannedSec / 60) : 60, tss: cal.plannedTss ?? null, description: cal.description ?? null, type: cal.type ?? null, templateId: coach?.templateId ?? null, level: coach?.level ?? null, externalId: cal.externalId ?? null } };
  }
  if (evs.some((e) => ['SICK', 'INJURED', 'HOLIDAY'].includes(e.category))) return { ...base, status: 'off' };
  const camp = campDay?.(date);
  if (camp) return { ...base, status: 'camp', camp };
  return base;
}

// ---------- Training camps ----------
// A base camp is a short block of much higher volume, almost all Zone 2 (Seiler; block-periodisation
// studies, e.g. Rønnestad 2014). Volume roughly doubles your usual week; every 4th day is easier so
// the block can be absorbed; one tempo day mid-camp and short sprints keep some top end. Arrive
// fresh (two easy days before) and absorb it afterwards (rest, then ~4 easy days) — fitness gains from
// a camp show up after the recovery, not during it.
export function campMinutes(c: TrainingCamp, weeklyHours: number): number {
  if (c.hoursPerDay) return Math.round(c.hoursPerDay * 60);
  return Math.round(Math.max(150, Math.min(300, weeklyHours * 60 * 0.33)) / 15) * 15;
}

export function campDayOf(camps: TrainingCamp[] | undefined, weeklyHours: number): (d: ISODate) => DayConfig['camp'] | null {
  return (d) => {
    const c = (camps ?? []).find((x) => d >= x.start && d <= x.end);
    if (!c) return null;
    return { name: c.name, index: diffDays(d, c.start), length: diffDays(c.end, c.start) + 1, minutes: campMinutes(c, weeklyHours) };
  };
}

/** What to ride on a given camp day. */
export function campSession(cp: NonNullable<DayConfig['camp']>): { id: string; minutes: number; why: string } {
  const { index: i, length: n, minutes } = cp;
  const r5 = (x: number) => Math.round(x / 5) * 5;
  // one tempo day around the middle, never on an easier day
  const mid = (Math.floor(n / 2) + 1) % 4 === 0 ? Math.floor(n / 2) - 1 : Math.floor(n / 2);
  if (n > 2 && i === n - 1) return { id: 'endurance', minutes: r5(minutes * 0.55), why: 'Last camp day — shorter, easy Zone 2 (travel day for most).' };
  if ((i + 1) % 4 === 0) return { id: 'endurance', minutes: r5(minutes * 0.55), why: 'Easier camp day — short and easy so the block can be absorbed.' };
  if (i === 0) return { id: 'endurance', minutes: r5(minutes * 0.75), why: 'First camp day — settle in with steady Zone 2.' };
  if (n >= 5 && i === mid) return { id: 'end_tempo', minutes, why: 'Mid-camp: Zone 2 with tempo blocks — aerobic strength without an interval day.' };
  if (i % 4 === 1) return { id: 'end_sprints', minutes, why: 'Long Zone 2 with a few short sprints to keep some top end.' };
  return { id: 'endurance', minutes, why: 'Long, steady Zone 2 — the heart of a base camp. Fuel 60-90 g carbs/h.' };
}

function raceIf(min: number): number {
  if (min <= 60) return 0.95;
  if (min <= 120) return 0.9;
  if (min <= 240) return 0.82;
  return 0.75;
}

interface Ctx {
  input: PlanInput;
  profile: WeekProfile;
  mw: MacroWeek;
  days: ISODate[];
  cfg: Record<ISODate, DayConfig>;
  cap: Record<ISODate, number>;
  rides: Record<ISODate, PlannedWorkout | null>;
  notes: Record<ISODate, string[]>;
  locked: Set<ISODate>; // days whose content is decided
  rest: Set<ISODate>;
  warnings: string[];
  summary: string[];
}

/** Build a concrete workout from a template, with load, fueling and progression info. */
export function instantiate(
  t: WorkoutTemplate,
  durationMin: number,
  level: number,
  weightKg: number | null,
  progression: Progression | undefined,
  why: string[],
  overrides: Partial<PlannedWorkout> = {},
): PlannedWorkout {
  const d = Math.max(t.minMin, Math.min(t.maxMin, Math.round(durationMin / 5) * 5));
  const lvl = Math.max(0, Math.min(t.levels - 1, level));
  const built = t.build(d, lvl);
  const load = blocksLoad(built.blocks);
  const wl = workoutLevel(t.id, built.blocks);
  const pl = wl && progression?.[wl.zone]?.source === 'history' ? progression[wl.zone].level : null;
  // Difficulty labels only for quality sessions (an easy Z2 ride isn't "achievable" or "recovery")
  const difficulty: Difficulty | null = wl && pl != null && t.key && progressionCapable(t) ? difficultyOf(wl.level, pl) : null;
  const progWhy =
    wl && pl != null && difficulty && TEMPLATE_ZONE[t.id] !== 'endurance'
      ? [`${DIFFICULTY_LABEL[difficulty!]} for you: workout level ${wl.level.toFixed(1)} vs your ${PROG_LABEL[wl.zone]} level ${pl.toFixed(1)}.`]
      : [];
  const w: PlannedWorkout = {
    templateId: t.id,
    name: built.name,
    category: t.category,
    intensity: t.intensity,
    durationMin: Math.round(load.seconds / 60),
    tss: load.tss,
    ifactor: load.ifactor,
    blocks: built.blocks,
    purpose: t.purpose,
    why: [...why, ...progWhy, ...(t.science ? [t.science] : [])],
    fueling: '',
    key: t.key,
    level: lvl,
    sport: t.sport ?? 'ride',
    progression: wl ? { zone: wl.zone, workoutLevel: wl.level, athleteLevel: pl, difficulty } : undefined,
    ...overrides,
  };
  w.fueling = fuelingFor(w, weightKg);
  return w;
}

function makeWorkout(t: WorkoutTemplate, durationMin: number, level: number, ctx: Ctx, why: string[], overrides: Partial<PlannedWorkout> = {}): PlannedWorkout {
  return instantiate(t, durationMin, level, ctx.input.profile.weightKg, ctx.input.progression, why.filter((x) => !/ for you: workout level /.test(x)), overrides);
}

/** Template level whose workout level is closest to a target (overshooting is penalised). */
export function levelForTarget(t: WorkoutTemplate, durationMin: number, target: number): number {
  let best = 0;
  let bestD = Infinity;
  const d = Math.max(t.minMin, Math.min(t.maxMin, Math.round(durationMin / 5) * 5));
  for (let l = 0; l < t.levels; l++) {
    const wl = workoutLevel(t.id, t.build(d, l).blocks)?.level ?? 1;
    const dist = wl > target + 0.5 ? (wl - target) * 2 : Math.abs(wl - target);
    if (dist < bestD - 1e-9) {
      bestD = dist;
      best = l;
    }
  }
  return best;
}

function isHard(w: PlannedWorkout | null | undefined): boolean {
  return !!w && (w.key || w.intensity === 'hard' || w.category === 'race');
}

/**
 * Template level for this week. With progression history (TrainerRoad-style), aim for a
 * "productive" workout level just above your current level for that energy system —
 * achievable in recovery weeks or when readiness is down, a stretch late in a block.
 * Without history, fall back to phase progress.
 */
/** Target workout level for this template this week, if progression history exists. */
function progressionTarget(t: WorkoutTemplate, ctx: Ctx): number | null {
  const { mw, input } = ctx;
  if (t.levels <= 1 || !progressionCapable(t)) return null;
  const zone = TEMPLATE_ZONE[t.id];
  const pl = zone && zone !== 'endurance' ? input.progression?.[zone] : undefined;
  if (!pl || pl.source !== 'history') return null;
  let delta: number;
  if (mw.weekType === 'recovery') delta = -1.5;
  else if (mw.weekType === 'taper' || mw.weekType === 'race') delta = -1;
  else if (['peak', 'realization', 'specific'].includes(mw.phase)) delta = 1;
  else if (mw.phase === 'prep') delta = -0.5;
  else delta = [0.3, 0.8, 1.2, 1.2][Math.max(0, Math.min(3, mw.loadStep - 1))];
  if (input.readiness.status === 'amber') delta -= 1;
  if (input.readiness.status === 'red') delta -= 2;
  return pl.level + delta;
}

function levelFor(t: WorkoutTemplate, ctx: Ctx, durationMin: number): number {
  const { mw, profile, input } = ctx;
  if (t.levels <= 1) return 0;
  const tgt = progressionTarget(t, ctx);
  if (tgt != null) {
    let lvl = levelForTarget(t, durationMin, tgt);
    if (profile.levelCap != null) lvl = Math.min(lvl, profile.levelCap);
    return lvl;
  }
  const progress = mw.phaseWeeks > 1 ? (mw.weekInPhase - 1) / (mw.phaseWeeks - 1) : 0.5;
  let lvl: number;
  if (mw.weekType === 'recovery') lvl = 0;
  else if (['peak', 'realization', 'specific'].includes(mw.phase)) lvl = Math.round(0.7 * (t.levels - 1) + progress * 0.3 * (t.levels - 1));
  else if (mw.phase === 'prep') lvl = Math.round(progress * 0.4 * (t.levels - 1));
  else lvl = Math.round(progress * (t.levels - 1));
  if (input.readiness.status === 'amber') lvl -= 1;
  if (input.readiness.status === 'red') lvl -= 2;
  if (input.trends.hardSessions14 === 0 && ['threshold', 'vo2max', 'anaerobic', 'race_sim'].includes(t.category)) lvl -= 1;
  if (profile.levelCap != null) lvl = Math.min(lvl, profile.levelCap);
  return Math.max(0, Math.min(t.levels - 1, lvl));
}

export function planWeek(input: PlanInput): WeekPlan {
  const { startDate, week, goal, macro, prefs, readiness, trends } = input;
  const days = range(startDate, 7);
  const mw = macroWeekFor(macro, startDate) ?? FALLBACK_WEEK;
  const profile = weekProfile(mw, goal, week.hours);
  const ctx: Ctx = {
    input,
    profile,
    mw,
    days,
    cfg: {},
    cap: {},
    rides: {},
    notes: {},
    locked: new Set(),
    rest: new Set(),
    warnings: [],
    summary: [],
  };
  for (const d of days) {
    ctx.cfg[d] = effectiveDayConfig(d, week, input.events, macro.goalDate, campDayOf(goal.camps, week.hours));
    ctx.cap[d] = ctx.cfg[d].maxMinutes ?? defaultDayCap(d, week.hours);
    ctx.rides[d] = null;
    ctx.notes[d] = [];
  }

  const budget = Math.round(week.hours * 60 * mw.volumeFactor * readiness.volumeModifier);
  ctx.summary.push(
    `${PHASE_LABELS[mw.phase]} · week ${mw.weekInPhase}/${mw.phaseWeeks}${mw.weekType !== 'load' ? ` · ${mw.weekType.replace('_', ' ')} week` : ''}: ${mw.focus}.`,
  );
  if (profile.note) ctx.summary.push(profile.note);
  if (input.loadFocus?.shortage) ctx.summary.push(`Load focus: ${input.loadFocus.headline}`);

  // ---------- 1. fixed days ----------
  let fixedHard = 0;
  for (const d of days) {
    const c = ctx.cfg[d];
    if (c.status === 'off') {
      ctx.locked.add(d);
      ctx.rest.add(d);
      ctx.notes[d].push('Unavailable — rest day.');
    } else if (c.status === 'group' && c.group) {
      const g = c.group;
      const ifac = GROUP_IF[g.intensity];
      const w: PlannedWorkout = {
        templateId: 'group',
        name: g.name || `Group ride (${g.intensity})`,
        category: 'group',
        intensity: g.intensity === 'social' ? 'easy' : g.intensity === 'tempo' ? 'moderate' : 'hard',
        durationMin: g.durationMin,
        tss: tssFromIf(g.durationMin, ifac),
        ifactor: ifac,
        blocks: [],
        purpose:
          g.intensity === 'social'
            ? 'Social group ride — keep it conversational and treat it as endurance.'
            : g.intensity === 'tempo'
              ? 'Steady group ride — mostly tempo. Sit in when you can; it counts as moderate load.'
              : 'Hard group ride — counts as one of this week’s quality sessions. Race the sprints/climbs you care about, recover in the wheels.',
        why: ['Fixed by you. The rest of the week is planned around it.'],
        fueling: '',
        key: g.intensity === 'hard' || g.intensity === 'race',
        fixed: 'group',
      };
      w.fueling = fuelingFor(w, input.profile.weightKg);
      ctx.rides[d] = w;
      ctx.locked.add(d);
      if (w.key) fixedHard++;
    } else if (c.status === 'scheduled' && c.scheduled?.templateId && WORKOUT_BY_ID[c.scheduled.templateId]) {
      // From your coach via this app: rebuild the real workout so its targets use YOUR FTP/zones and you can swap it
      const sc = c.scheduled;
      const t = getTemplate(sc.templateId!);
      const coachNote = sc.description?.match(/^Coach: (.+)$/m)?.[1];
      const w = makeWorkout(t, sc.durationMin, sc.level ?? levelFor(t, ctx, sc.durationMin), ctx, ['From your coach — targets use your own FTP and zones. Use Easier / Harder / Shorter or pick another workout to change it; your coach’s version is then replaced.', ...(coachNote ? [`Coach’s note: ${coachNote}`] : [])], { fixed: 'calendar' });
      ctx.rides[d] = w;
      ctx.locked.add(d);
      if (w.key) fixedHard++;
    } else if (c.status === 'scheduled' && c.scheduled) {
      const sc = c.scheduled;
      const ifac = sc.tss && sc.durationMin ? Math.min(1.1, Math.max(0.5, Math.sqrt(sc.tss / ((sc.durationMin / 60) * 100)))) : 0.72;
      const w: PlannedWorkout = {
        templateId: 'calendar',
        name: sc.name,
        category: ifac >= 0.88 ? 'threshold' : ifac >= 0.8 ? 'sweetspot' : ifac >= 0.75 ? 'tempo' : 'endurance',
        intensity: ifac >= 0.82 ? 'hard' : ifac >= 0.75 ? 'moderate' : 'easy',
        durationMin: sc.durationMin,
        tss: sc.tss ?? tssFromIf(sc.durationMin, ifac),
        ifactor: Math.round(ifac * 100) / 100,
        blocks: [],
        purpose: sc.description?.trim() || 'Scheduled on your intervals.icu calendar.',
        why: [(sc.externalId ?? '').startsWith('tacoach-') ? 'From your coach — the rest of the week is planned around it. Pick another workout here to override it.' : 'Already on your intervals.icu calendar (e.g. from your coach), so the rest of the week is planned around it. Pick another workout here to override it.'],
        fueling: '',
        key: ifac >= 0.82,
        fixed: 'calendar',
      };
      w.fueling = fuelingFor(w, input.profile.weightKg);
      ctx.rides[d] = w;
      ctx.locked.add(d);
      if (w.key) fixedHard++;
    } else if (c.status === 'camp' && c.camp) {
      const sess = campSession(c.camp);
      const w = makeWorkout(getTemplate(sess.id), sess.minutes, 0, ctx, [`${c.camp.name} · day ${c.camp.index + 1} of ${c.camp.length}. ${sess.why}`], { fixed: 'camp' });
      ctx.rides[d] = w;
      ctx.locked.add(d);
    } else if (c.status === 'pinned' && c.pinned && WORKOUT_BY_ID[c.pinned.workoutId]) {
      const t = getTemplate(c.pinned.workoutId);
      const lvl = c.pinned.level ?? levelFor(t, ctx, c.pinned.durationMin);
      const why = c.pinned.fromCoach
        ? [`From your coach — you moved it here from ${dowLong(c.pinned.movedFrom ?? d)}. Targets use your own FTP and zones; the rest of the week is planned around it.`]
        : c.pinned.movedFrom
          ? [`Moved here from ${dowLong(c.pinned.movedFrom)} — the rest of the week is planned around it.`]
          : ['You picked this workout for this day.'];
      const w = makeWorkout(t, c.pinned.durationMin, lvl, ctx, why, { fixed: 'pinned' });
      ctx.rides[d] = w;
      ctx.locked.add(d);
      if (isHard(w)) fixedHard++;
    } else if (c.status === 'race' && c.race) {
      const isGoal = d === macro.goalDate && c.race.name === 'Goal event';
      const ev = isGoal || c.race.priority === 'A' ? eventProfile(goal.eventType) : null;
      if (isGoal) ctx.cfg[d] = { ...c, race: { ...c.race, name: goal.eventName || ev?.label || 'Goal event', durationMin: Math.round((goal.eventDurationHours || 3) * 60) } };
      const race = ctx.cfg[d].race!;
      const ifac = raceIf(race.durationMin);
      const w: PlannedWorkout = {
        templateId: 'race',
        ...(ev?.kind === 'run' ? { sport: 'run' as const } : {}),
        name: `${race.priority} race: ${race.name}${ev && ev.kind !== 'bike' && !race.name.toLowerCase().includes(ev.label.toLowerCase()) ? ` (${ev.label})` : ''}`,
        category: 'race',
        intensity: 'hard',
        durationMin: race.durationMin,
        tss: tssFromIf(race.durationMin, ifac),
        ifactor: ifac,
        blocks: [],
        purpose: race.priority === 'A' ? 'Goal event. Trust the taper, pace and fuel to plan.' : race.priority === 'B' ? 'B race — race it, with a short mini-taper.' : 'C race — a hard training day with a number on.',
        why: [],
        fueling: '',
        key: true,
        fixed: 'race',
      };
      w.fueling = fuelingFor(w, input.profile.weightKg);
      ctx.rides[d] = w;
      ctx.locked.add(d);
      fixedHard++;
    }
  }

  // ---------- 1b. around training camps: arrive fresh, absorb it afterwards ----------
  for (const camp of goal.camps ?? []) {
    const free = (d: ISODate) => days.includes(d) && !ctx.locked.has(d) && ctx.cfg[d].status === 'available';
    const set = (d: ISODate, id: string | null, min: number, why: string) => {
      if (!free(d)) return;
      ctx.locked.add(d);
      ctx.cfg[d] = { ...ctx.cfg[d], noLift: true }; // no lifting while arriving fresh or absorbing the camp
      if (id) ctx.rides[d] = makeWorkout(getTemplate(id), Math.min(min, ctx.cap[d]), 0, ctx, [why]);
      else {
        ctx.rest.add(d);
        ctx.notes[d].push(why);
      }
    };
    set(addDays(camp.start, -2), 'endurance', 60, `Easy before ${camp.name} — arrive fresh for the volume.`);
    set(addDays(camp.start, -1), 'recovery', 40, `Day before ${camp.name}: short and easy (or rest if you’re travelling).`);
    set(addDays(camp.end, 1), null, 0, `Rest after ${camp.name} — the fitness from a camp arrives after you recover from it.`);
    set(addDays(camp.end, 2), 'recovery', 45, `Recovering from ${camp.name}: easy spin only.`);
    set(addDays(camp.end, 3), 'recovery', 60, `Recovering from ${camp.name}: easy spin only.`);
    set(addDays(camp.end, 4), 'endurance', 75, `Recovering from ${camp.name}: short easy Zone 2.`);
    set(addDays(camp.end, 5), 'endurance', 90, `Recovering from ${camp.name}: easy Zone 2 — normal training resumes tomorrow.`);
  }
  const campDays = days.filter((d) => ctx.cfg[d].status === 'camp');
  if (campDays.length) {
    const c = ctx.cfg[campDays[0]].camp!;
    ctx.summary.push(`${c.name}: ${campDays.length} camp day${campDays.length === 1 ? '' : 's'} this week, up to ${fmtMinutes(c.minutes)} of mostly Zone 2 a day (every 4th day easier). Eat 60-90 g carbs/h on the bike and sleep as much as you can.`);
  }

  // ---------- 2. race-week shaping (openers, pre-race rest, post-race recovery) ----------
  for (const d of days) {
    const c = ctx.cfg[d];
    if (c.status !== 'race' || !c.race || c.race.priority === 'C') continue;
    const before1 = addDays(d, -1);
    const before2 = addDays(d, -2);
    const after1 = addDays(d, 1);
    if (days.includes(before1) && !ctx.locked.has(before1)) {
      ctx.rides[before1] = makeWorkout(getTemplate('openers'), Math.min(60, ctx.cap[before1]), 0, ctx, [`Day before your ${c.race.priority} race.`]);
      ctx.locked.add(before1);
    }
    if (c.race.priority === 'A' && days.includes(before2) && !ctx.locked.has(before2)) {
      ctx.locked.add(before2);
      ctx.rest.add(before2);
      ctx.notes[before2].push('Two days before the race: rest (or a 30-min spin if you feel flat after full rest).');
    }
    if (c.race.priority === 'B' && days.includes(before2) && !ctx.locked.has(before2)) {
      ctx.rides[before2] = makeWorkout(getTemplate('endurance'), Math.min(60, ctx.cap[before2]), 0, ctx, ['Mini-taper before a B race.']);
      ctx.locked.add(before2);
    }
    if (days.includes(after1) && !ctx.locked.has(after1)) {
      ctx.rides[after1] = makeWorkout(getTemplate('recovery'), 45, 0, ctx, ['Day after racing: flush the legs.']);
      ctx.locked.add(after1);
    }
  }

  // ---------- 3. readiness: force leading easy days ----------
  const easyLead = new Set(days.slice(0, readiness.easyDays));
  if (readiness.status === 'red' || (readiness.flags.some((f) => f.id === 'sick') && readiness.easyDays > 0)) {
    const d0 = days[0];
    if (!ctx.locked.has(d0)) {
      ctx.locked.add(d0);
      ctx.rest.add(d0);
      ctx.notes[d0].push('Rest — recovery markers are down. Re-check readiness tomorrow.');
    } else if (isHard(ctx.rides[d0])) {
      ctx.warnings.push(`Readiness is low but ${dowLong(d0)} has a hard fixed session — consider skipping it or riding easy.`);
    }
  }
  const sick = readiness.flags.some((f) => f.id === 'sick');
  if (sick) {
    for (const d of days.slice(0, readiness.easyDays)) {
      const w = ctx.rides[d];
      if (w && w.fixed === 'pinned') {
        ctx.rides[d] = null;
        ctx.rest.add(d);
        ctx.notes[d].push(`Your planned ${w.name} was replaced with rest because you’re unwell.`);
      } else if (!ctx.locked.has(d)) {
        ctx.locked.add(d);
        ctx.rest.add(d);
        ctx.notes[d].push('Rest while unwell.');
      }
    }
  }
  if (readiness.status === 'red' || sick) {
    for (const d of days.slice(1, 4)) {
      const w = ctx.rides[d];
      if (w && (w.fixed === 'group' || w.fixed === 'race') && isHard(w))
        ctx.warnings.push(`${dowLong(d)}: ${w.name} is hard and your recovery markers are down — skip it, or sit in and ride easy.`);
    }
  }

  // ---------- 4. long ride ----------
  const used = () => days.reduce((a, d) => a + (ctx.rides[d]?.durationMin ?? 0), 0);
  let longDay: ISODate | null = null;
  const groupLong = days.find((d) => ctx.rides[d]?.fixed === 'group' && (ctx.rides[d]?.durationMin ?? 0) >= 150);
  if (profile.longRide && !groupLong) {
    const free = days.filter((d) => !ctx.locked.has(d) && !easyLead.has(d) && ctx.cap[d] >= 90);
    const pref = prefs.longRideDay === 'sat' ? 6 : prefs.longRideDay === 'sun' ? 0 : null;
    const ranked = [...free].sort((a, b) => {
      const pa = pref != null && dow(a) === pref ? 1 : 0;
      const pb = pref != null && dow(b) === pref ? 1 : 0;
      if (pa !== pb) return pb - pa;
      if (ctx.cap[a] !== ctx.cap[b]) return ctx.cap[b] - ctx.cap[a];
      const wa = dow(a) === 0 || dow(a) === 6 ? 1 : 0;
      const wb = dow(b) === 0 || dow(b) === 6 ? 1 : 0;
      return wb - wa;
    });
    const eventCap = longRideCap(goal.eventType, goal.eventDurationHours);
    const progressionCap = trends.longestRideMin28 > 0 ? Math.max(150, Math.round(trends.longestRideMin28 * 1.25 + 15)) : 180;
    const share = profile.longRideShare + (input.loadFocus?.shortage === 'low' ? 0.05 : 0) + (trends.aerobic?.verdict === 'needs_work' && ['base', 'prep', 'accumulation', 'volume'].includes(mw.phase) ? 0.03 : 0);
    const target = Math.max(90, budget * share);
    const pick = (d: ISODate) => {
      const duration = Math.min(ctx.cap[d], eventCap, progressionCap, target);
      const options = profile.longRide!.filter((id) => WORKOUT_BY_ID[id] && WORKOUT_BY_ID[id].minMin <= duration);
      return { duration, id: options.length ? options[mw.index % options.length] : 'endurance' };
    };
    // An easy long ride the day after a hard group ride is a classic weekend block; a hard
    // (durability/race-sim) long ride must not sit next to another hard day.
    longDay =
      ranked.find((d) => {
        const t = getTemplate(pick(d).id);
        return !t.key || (!isHard(ctx.rides[addDays(d, -1)]) && !isHard(ctx.rides[addDays(d, 1)]));
      }) ??
      ranked[0] ??
      null;
    if (longDay) {
      const { duration, id: pickedId } = pick(longDay);
      const id = getTemplate(pickedId).key && (isHard(ctx.rides[addDays(longDay, -1)]) || isHard(ctx.rides[addDays(longDay, 1)])) ? 'endurance' : pickedId;
      const t = getTemplate(id);
      const why = [
        `Long ride on ${dowLong(longDay)} — your day with the most time.`,
        progressionCap < target && progressionCap < ctx.cap[longDay]
          ? `Capped at ${fmtMinutes(progressionCap)} (~25% above your recent longest ride) to progress safely.`
          : `About ${Math.round((duration / Math.max(1, budget)) * 100)}% of this week’s riding.`,
      ];
      ctx.rides[longDay] = makeWorkout(t, duration, levelFor(t, ctx, duration), ctx, why);
      ctx.locked.add(longDay);
    }
  } else if (groupLong) {
    ctx.summary.push(`Your ${dowLong(groupLong)} group ride doubles as this week’s long ride.`);
  }

  // ---------- 5. key sessions ----------
  const longIsHard = longDay ? isHard(ctx.rides[longDay]) : false;
  let k = profile.keySessions + readiness.maxKeySessionsDelta - fixedHard;
  if (longIsHard && week.hours < 8) k -= 1;
  if (week.hours < 4) k = Math.min(k, 1);
  const hardCap = profile.allowBackToBack ? 5 : 3;
  const alreadyHard = days.filter((d) => isHard(ctx.rides[d])).length;
  k = Math.max(0, Math.min(k, hardCap - alreadyHard));
  if (fixedHard > 0 && profile.keySessions + readiness.maxKeySessionsDelta - fixedHard <= 0 && profile.keySessions > 0)
    ctx.summary.push('Your group rides/races already provide this week’s intensity, so no extra interval sessions were added.');

  const candidates = days.filter((d) => !ctx.locked.has(d) && !easyLead.has(d) && ctx.cap[d] >= 50);
  const raceDays = days.filter((d) => ctx.cfg[d].status === 'race');
  const hardSet = (extra: ISODate[]) => new Set([...days.filter((d) => isHard(ctx.rides[d])), ...extra]);
  const prevHard = trends.daysSinceHard === 0;

  let bestCombo: ISODate[] = [];
  let bestScore = -Infinity;
  const kk = Math.min(k, candidates.length);
  const evalCombo = (combo: ISODate[]) => {
    const hs = hardSet(combo);
    let s = 0;
    for (const d of combo) {
      const prev = addDays(d, -1);
      const next = addDays(d, 1);
      if (hs.has(prev)) s -= profile.allowBackToBack ? 1 : 10;
      if (hs.has(next)) s -= profile.allowBackToBack ? 1 : 10;
      if (raceDays.includes(next)) s -= 100;
      if (longDay && prev === longDay) s -= 3;
      if (longDay && next === longDay) s -= 2;
      if (d === days[0] && prevHard) s -= 8;
      s += Math.min(ctx.cap[d], 120) / 60;
      if (dow(d) !== 0 && dow(d) !== 6) s += 0.5;
    }
    const sorted = [...combo].sort();
    for (let i = 1; i < sorted.length; i++) if (diffDays(sorted[i], sorted[i - 1]) >= 2) s += 2;
    return s;
  };
  const choose = (start: number, chosen: ISODate[]) => {
    if (chosen.length === kk) {
      const s = evalCombo(chosen);
      if (s > bestScore) {
        bestScore = s;
        bestCombo = [...chosen];
      }
      return;
    }
    for (let i = start; i < candidates.length; i++) choose(i + 1, [...chosen, candidates[i]]);
  };
  if (kk > 0) choose(0, []);
  const campWeek = days.some((d) => ctx.cfg[d].status === 'camp' || ctx.rides[d]?.why[0]?.includes(' camp'));
  if (kk < k && !campWeek) ctx.warnings.push(`Only room for ${kk} of ${k} planned quality sessions with your availability.`);

  bestCombo.sort();
  const usedTemplates = new Set<string>();
  const keyTotal = bestCombo.length + fixedHard + (longIsHard ? 1 : 0);
  const focus = input.loadFocus?.shortage ?? null;
  const prefer = (id: string): number => {
    const z = TEMPLATE_ZONE[id];
    let s = 0;
    if (focus === 'anaerobic' && z === 'anaerobic') s += 2;
    if (focus === 'high' && (z === 'threshold' || z === 'vo2max' || z === 'sweetspot')) s += 1;
    if (focus === 'low' && (z === 'tempo' || z === 'sweetspot')) s += 1;
    if (input.limiter && z === input.limiter) s += 1;
    return s;
  };
  // Missed key session from the last few days → reschedule it first (JOIN-style)
  const carry = (input.carryOver ?? []).find((c) => WORKOUT_BY_ID[c.templateId]?.key && mw.weekType !== 'recovery' && mw.weekType !== 'race');
  if (carry && bestCombo.length) ctx.summary.push(`You missed ${carry.name} on ${dowLong(carry.date)} — it’s been rescheduled as this week’s first quality session.`);
  bestCombo.forEach((d, i) => {
    const slot = profile.slots[Math.min(i, profile.slots.length - 1)] ?? ['sweetspot'];
    const rotated = slot.map((_, k) => slot[(mw.index + i + k) % slot.length]);
    const ranked = [...rotated].sort((a, b) => prefer(b) - prefer(a));
    let id = ranked[0];
    if (i === 0 && carry) id = carry.templateId;
    if (!profile.allowBackToBack && usedTemplates.has(id)) id = ranked.find((x) => !usedTemplates.has(x)) ?? id;
    usedTemplates.add(id);
    const t = getTemplate(id);
    const cap = ctx.cap[d];
    let target = Math.min(cap, Math.max(t.minMin, 75));
    // Give the session enough time to reach a productive level for you (within the day's cap)
    const tgtLevel = progressionTarget(t, ctx);
    if (tgtLevel != null && week.hours >= 6) {
      for (const dur of [75, 90, 105, 120]) {
        if (dur > cap) break;
        target = Math.max(t.minMin, dur);
        const wl = workoutLevel(t.id, t.build(target, levelFor(t, ctx, target)).blocks)?.level ?? 0;
        if (wl >= tgtLevel - 0.5) break;
      }
    }
    const lvl = levelFor(t, ctx, target);
    const why = [
      `Quality session ${i + 1 + fixedHard + (longIsHard ? 1 : 0)} of ${keyTotal} this week (${PHASE_LABELS[mw.phase].toLowerCase()} phase).`,
    ];
    if (i === 0 && carry) why.push(`Rescheduled from ${dowLong(carry.date)}, when it was missed.`);
    else if (prefer(id) > 0 && focus) why.push(`Chosen partly to fill your ${focus === 'low' ? 'low aerobic' : focus === 'high' ? 'high aerobic' : 'anaerobic'} load shortage.`);
    const prev = addDays(d, -1);
    if (!isHard(ctx.rides[prev]) && !bestCombo.includes(prev)) why.push('Placed after an easy/rest day so you start it fresh.');
    if (cap < t.minMin) ctx.warnings.push(`${dowLong(d)} has less time (${cap} min) than ${t.name} needs (${t.minMin} min).`);
    ctx.rides[d] = makeWorkout(t, target, lvl, ctx, why);
    ctx.locked.add(d);
  });

  // ---------- 6. rest days ----------
  const open = () => days.filter((d) => !ctx.locked.has(d));
  const restNeeded = Math.max(0, prefs.minRestDays - ctx.rest.size);
  const restScore = (d: ISODate) => {
    let s = 0;
    if (isHard(ctx.rides[addDays(d, -1)]) || addDays(d, -1) === longDay) s += 3;
    if (isHard(ctx.rides[addDays(d, 1)])) s += 1.5;
    if (dow(d) === 1) s += 1;
    if (easyLead.has(d)) s += 1;
    s += (150 - Math.min(150, ctx.cap[d])) / 60;
    return s;
  };
  const pickRest = (n: number, reason: string) => {
    const ranked = open().sort((a, b) => restScore(b) - restScore(a));
    for (const d of ranked.slice(0, n)) {
      ctx.locked.add(d);
      ctx.rest.add(d);
      ctx.notes[d].push(reason);
    }
  };
  pickRest(restNeeded, 'Rest day — adaptation happens when you recover.');

  // ---------- 7. endurance fill ----------
  let remaining = budget - used();
  let fillDays = open();
  // Fewer, longer easy rides beat many short ones: each easy day needs ~60 min (40 if time is very short)
  const minRide = week.hours < 5 ? 40 : 60;
  const maxDays = Math.max(0, Math.floor(remaining / minRide));
  if (fillDays.length > maxDays) {
    pickRest(fillDays.length - maxDays, 'Rest day — your time budget is better used on fewer, longer rides this week.');
    fillDays = open();
  }
  // Water-fill minutes up to each day's cap
  const alloc: Record<ISODate, number> = {};
  for (const d of fillDays) alloc[d] = 0;
  let pool = remaining;
  for (let iter = 0; iter < 10 && pool > 1; iter++) {
    const openDays = fillDays.filter((d) => alloc[d] < ctx.cap[d]);
    if (!openDays.length) break;
    const share = pool / openDays.length;
    for (const d of openDays) {
      const add = Math.min(share, ctx.cap[d] - alloc[d]);
      alloc[d] += add;
      pool -= add;
    }
  }
  let varietyUsed = false;
  for (const d of fillDays) {
    let mins = Math.round(alloc[d] / 5) * 5;
    const afterHard = isHard(ctx.rides[addDays(d, -1)]) || addDays(d, -1) === longDay;
    if (mins < 30) {
      ctx.locked.add(d);
      ctx.rest.add(d);
      ctx.notes[d].push('Rest day.');
      continue;
    }
    let t: WorkoutTemplate;
    const why: string[] = [];
    if ((afterHard && (mins <= 60 || readiness.status !== 'green')) || mins < 45) {
      t = getTemplate('recovery');
      mins = Math.min(mins, 60);
      why.push(afterHard ? 'Easy day after a hard one — absorb the work.' : 'Short, easy spin — keeps the legs moving without adding fatigue.');
    } else if (!varietyUsed && !afterHard && profile.variety.length && mins >= 60 && focus !== 'low') {
      t = getTemplate(focus === 'anaerobic' ? 'end_sprints' : profile.variety[mw.index % profile.variety.length]);
      varietyUsed = true;
      why.push('Easy aerobic ride with a little neuromuscular work for variety.');
    } else {
      t = getTemplate('endurance');
      why.push(afterHard ? 'Easy endurance after a hard day — keep it truly Zone 2.' : 'Aerobic volume — stay below LT1 (you can talk in full sentences).');
    }
    ctx.rides[d] = makeWorkout(t, Math.max(t.minMin, mins), levelFor(t, ctx, mins), ctx, why);
    ctx.locked.add(d);
  }

  // Leftover time: extend key sessions with Z2, then the long ride
  remaining = budget - used();
  if (remaining > 20) {
    const extendable = [...bestCombo, ...(longDay ? [longDay] : [])];
    for (const d of extendable) {
      const w = ctx.rides[d];
      if (!w || remaining <= 20) continue;
      const t = getTemplate(w.templateId);
      const room = Math.min(ctx.cap[d], t.maxMin) - w.durationMin;
      if (room < 15) continue;
      const add = Math.min(room, remaining);
      const longCap = d === longDay ? Math.min(longRideCap(goal.eventType, goal.eventDurationHours), Math.max(150, trends.longestRideMin28 * 1.25 + 15)) : Infinity;
      const newDur = Math.min(w.durationMin + add, longCap);
      if (newDur - w.durationMin < 15) continue;
      const nw = makeWorkout(t, newDur, w.level ?? levelFor(t, ctx, newDur), ctx, w.why);
      remaining -= nw.durationMin - w.durationMin;
      ctx.rides[d] = nw;
    }
  }
  remaining = budget - used();
  if (remaining > 45 && mw.weekType === 'load')
    ctx.summary.push(`About ${fmtMinutes(remaining)} of your available time is left unused — more volume isn’t needed for this week’s goals.`);

  // Over budget (fixed sessions too long): trim easy rides
  if (remaining < -15) {
    for (const d of days) {
      const w = ctx.rides[d];
      if (!w || w.fixed || w.key || remaining >= -15) continue;
      const t = getTemplate(w.templateId);
      const cut = Math.min(w.durationMin - t.minMin, -remaining);
      if (cut >= 10) {
        ctx.rides[d] = makeWorkout(t, w.durationMin - cut, 0, ctx, w.why);
        remaining += cut;
      }
    }
    if (remaining < -15 && !campWeek) ctx.warnings.push('Your fixed sessions exceed the hours you set for this week.');
  }

  // ---------- 8. ramp-rate guard ----------
  const ctl0 = readiness.ctl ?? trends.ctl;
  const atl0 = readiness.atl ?? trends.atl;
  let projectedCtl: number | null = null;
  let projectedTsb: number | null = null;
  if (ctl0 != null && atl0 != null) {
    const daily = () => days.map((d) => ctx.rides[d]?.tss ?? 0);
    let proj = projectLoad(ctl0, atl0, daily());
    let guard = 0;
    while (proj.ctl[6] - ctl0 > prefs.maxRampPerWeek && guard++ < 8) {
      let changed = false;
      for (const d of days) {
        const w = ctx.rides[d];
        if (!w || w.fixed || w.key) continue;
        const t = getTemplate(w.templateId);
        if (w.durationMin - 15 >= t.minMin) {
          ctx.rides[d] = makeWorkout(t, w.durationMin - 15, w.level ?? levelFor(t, ctx, w.durationMin - 15), ctx, w.why);
          changed = true;
        }
      }
      if (!changed) break;
      proj = projectLoad(ctl0, atl0, daily());
    }
    if (guard > 0) ctx.summary.push(`Easy rides trimmed to keep fitness (CTL) ramp ≤ ${prefs.maxRampPerWeek}/week.`);
    projectedCtl = round(proj.ctl[6], 1);
    projectedTsb = round(proj.ctl[6] - proj.atl[6], 1);
  }

  // ---------- 9. assemble days + strength ----------
  const planned: PlannedDay[] = days.map((d) => {
    const dmw = macroWeekFor(macro, d) ?? mw;
    return {
      date: d,
      dow: dow(d),
      phase: dmw.phase,
      weekType: dmw.weekType,
      ride: ctx.rides[d],
      strength: null,
      mobility: null,
      notes: ctx.notes[d],
      status: ctx.cfg[d].status,
    };
  });

  const strengthRes = planStrength({
    days: planned,
    settings: input.strength,
    trends,
    readiness,
    dayCfg: (d) => ctx.cfg[d],
    aRaceDates: [
      ...days.filter((d) => ctx.cfg[d].race?.priority === 'A'),
      ...(macro.goalDate ? [macro.goalDate] : []),
      ...input.events.filter((e) => e.category === 'RACE_A').map((e) => e.date),
    ],
    raceDates: raceDays,
    basePhase: mw.strengthPhase,
  });
  for (const p of planned) {
    p.strength = strengthRes.sessions[p.date] ?? null;
    p.mobility = mobilityFor(p, mobilityPrefs(input.strength));
  }
  ctx.summary.push(...strengthRes.notes);

  const totalMin = planned.reduce((a, p) => a + (p.ride?.durationMin ?? 0), 0);
  const totalTss = planned.reduce((a, p) => a + (p.ride?.tss ?? 0), 0);
  const hardDays = planned.filter((p) => isHard(p.ride)).map((p) => dowShort(p.date));
  ctx.summary.push(
    `${fmtMinutes(totalMin)} riding (${fmtMinutes(budget)} target from ${week.hours} h available) · ~${totalTss} TSS · quality: ${hardDays.join(', ') || 'none'}.`,
  );
  if (projectedCtl != null && ctl0 != null) {
    const delta = round(projectedCtl - ctl0, 1);
    ctx.summary.push(`Projected fitness (CTL) ${round(ctl0)} → ${round(projectedCtl)} (${delta >= 0 ? '+' : ''}${delta}); form at week end ${projectedTsb! >= 0 ? '+' : ''}${round(projectedTsb!)}.`);
  }

  return {
    days: planned,
    totalMin,
    totalTss,
    budgetMin: budget,
    macroWeek: mw,
    readiness,
    summary: ctx.summary,
    warnings: ctx.warnings,
    projectedCtl,
    projectedTsb,
  };
}

export interface Alternative {
  label: string;
  hint: string;
  templateId: string;
  level: number;
  durationMin: number;
  workout: PlannedWorkout;
}

/**
 * Smart swaps for a planned ride (inspired by JOIN's "replace workout", Garmin's
 * alternative suggestions and TrainerRoad's easier/harder alternates).
 */
export function workoutAlternatives(w: PlannedWorkout, progression: Progression | undefined, weightKg: number | null): Alternative[] {
  if (w.fixed === 'group' || (w.fixed === 'calendar' && !WORKOUT_BY_ID[w.templateId]) || w.category === 'race' || !WORKOUT_BY_ID[w.templateId] || (w.sport ?? 'ride') !== 'ride') return [];
  const t = getTemplate(w.templateId);
  const zone = TEMPLATE_ZONE[t.id];
  const pl = zone && zone !== 'endurance' && progressionCapable(t) && progression?.[zone]?.source === 'history' ? progression[zone].level : null;
  const cur = w.level ?? 0;
  const out: Alternative[] = [];
  const curLoad = w.progression?.workoutLevel ?? w.tss;
  const add = (label: string, hint: string, tid: string, level: number, dur: number) => {
    const tt = getTemplate(tid);
    const lvl = Math.max(0, Math.min(tt.levels - 1, level));
    const wk = instantiate(tt, dur, lvl, weightKg, progression, ['Swapped in by you.']);
    if (out.some((o) => o.workout.name === wk.name && Math.abs(o.workout.durationMin - wk.durationMin) < 5)) return;
    if (wk.name === w.name && Math.abs(wk.durationMin - w.durationMin) < 5) return;
    const load = w.progression ? wk.progression?.workoutLevel ?? wk.tss : wk.tss;
    if (label === 'Easier' && !(load < curLoad)) return;
    if (label === 'Harder' && !(load > curLoad)) return;
    out.push({ label, hint, templateId: tid, level: lvl, durationMin: dur, workout: wk });
  };
  if (t.key || t.intensity !== 'easy') {
    const easier = pl != null ? levelForTarget(t, w.durationMin, pl - 1) : cur - 2;
    const harder = pl != null ? levelForTarget(t, w.durationMin, pl + 1.8) : cur + 2;
    add('Easier', 'Achievable — for a tired day', t.id, Math.min(easier, cur - 1), w.durationMin);
    for (const extra of [0, 15, 30]) {
      const dur = Math.min(t.maxMin, w.durationMin + extra);
      const lvl = pl != null ? Math.max(levelForTarget(t, dur, pl + 1.8), cur + 1) : Math.max(harder, cur + 1);
      const before = out.length;
      add('Harder', extra ? `Stretch — needs ${extra} min more` : 'Stretch — when you feel great', t.id, lvl, dur);
      if (out.length > before) break;
    }
    add('Shorter', 'Same session, less time', t.id, cur, Math.max(t.minMin, w.durationMin - 30));
    const SIMILAR: Record<string, string[]> = { sweetspot: ['tempo', 'over_under'], tempo: ['sweetspot'], durability: ['gravel_sim'], gravel_sim: ['durability'] };
    const same = [
      ...Object.keys(TEMPLATE_ZONE).filter((id) => id !== t.id && TEMPLATE_ZONE[id] === zone && WORKOUT_BY_ID[id].key),
      ...(SIMILAR[t.id] ?? []),
    ].filter((id, i, arr) => arr.indexOf(id) === i && id !== t.id && WORKOUT_BY_ID[id].minMin <= w.durationMin + 5);
    for (const id of same.slice(0, 2)) {
      const tt = getTemplate(id);
      const lvl = pl != null ? levelForTarget(tt, w.durationMin, pl + 0.5) : Math.round(((tt.levels - 1) * cur) / Math.max(1, t.levels - 1));
      add(`Same focus: ${tt.name}`, `Different ${zone ? PROG_LABEL[zone].toLowerCase() : ''} session`, id, lvl, w.durationMin);
    }
    add('Endurance instead', 'Keep the time, drop the intensity', 'endurance', 0, w.durationMin);
  } else {
    add('Shorter', 'Less time, same purpose', t.id, cur, Math.max(t.minMin, w.durationMin - 30));
    add('Longer', '+30 min of Zone 2', t.id, cur, Math.min(t.maxMin, w.durationMin + 30));
    if (t.id !== 'end_sprints') add('Add sprints', 'Neuromuscular touch', 'end_sprints', 0, Math.max(60, w.durationMin));
    if (t.id !== 'recovery') add('Recovery spin', 'Very easy, 45 min', 'recovery', 0, 45);
  }
  return out;
}

/** Mobility preferences, filling in defaults for older saved settings. */
export function mobilityPrefs(st: StrengthSettings): MobilityPrefs {
  const m = st.mobility;
  return {
    frequency: m?.frequency ?? (st.includeMobility === false ? 'off' : 'rest_days'),
    minutes: m?.minutes ?? 10,
    focus: m?.focus ?? [],
    roller: m?.roller ?? false,
    band: m?.band ?? false,
  };
}

/**
 * Which days get a mobility session, and which kind:
 *  - rest days get the full session; easy-ride days a shorter after-ride one
 *  - "most days" adds a short after-ride session on hard days too (not race days or lift days)
 *  - "every day" also adds one after lifting
 */
export function mobilityFor(p: PlannedDay, m: MobilityPrefs): MobilitySession | null {
  if (m.frequency === 'off' || p.status === 'race' || p.ride?.category === 'race') return null;
  const opts = (minutes: number) => ({ focus: m.focus, minutes, equipment: { roller: m.roller, band: m.band } });
  const short = Math.max(5, Math.round(m.minutes * 0.6));
  const easyRide = p.ride && (p.ride.category === 'recovery' || (p.ride.category === 'endurance' && !p.ride.key));
  if (!p.ride && !p.strength) return buildMobility('rest_day', p.date, opts(m.minutes));
  if (p.strength && m.frequency !== 'daily') return null; // the lifting warm-up covers it
  if (easyRide && !p.strength) return buildMobility('post_ride', p.date, opts(short));
  if (m.frequency === 'rest_days') return null;
  return buildMobility('post_ride', p.date, opts(p.strength ? 5 : short));
}
