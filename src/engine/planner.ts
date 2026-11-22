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
import { addDays, diffDays, dow, dowLong, dowShort, fmtMinutes, range } from './dates';
import { fuelingFor } from './fueling';
import { longRideCap, weekProfile, type WeekProfile } from './profiles';
import { macroWeekFor, PHASE_LABELS } from './periodization';
import { projectLoad, round } from './stats';
import { planStrength } from './strength';
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
  StrengthSettings,
  Trends,
  WeekConfig,
  WeekPlan,
} from './types';
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

export function effectiveDayConfig(date: ISODate, week: WeekConfig, events: CalendarEvent[], goalDate: ISODate | null): DayConfig {
  const user = week.days[date];
  if (user && user.status !== 'available') return user;
  const base: DayConfig = user ?? { status: 'available', maxMinutes: null };
  const evs = events.filter((e) => e.date === date || (e.endDate && diffDays(date, e.date) >= 0 && diffDays(e.endDate, date) >= 0));
  const race = evs.find((e) => ['RACE_A', 'RACE_B', 'RACE_C'].includes(e.category));
  if (race) {
    const priority = race.category === 'RACE_A' ? 'A' : race.category === 'RACE_B' ? 'B' : 'C';
    return { ...base, status: 'race', race: { name: race.name, durationMin: 120, priority } };
  }
  if (goalDate === date) return { ...base, status: 'race', race: { name: 'Goal event', durationMin: 180, priority: 'A' } };
  if (evs.some((e) => ['SICK', 'INJURED', 'HOLIDAY'].includes(e.category))) return { ...base, status: 'off' };
  return base;
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

function makeWorkout(
  t: WorkoutTemplate,
  durationMin: number,
  level: number,
  ctx: Ctx,
  why: string[],
  overrides: Partial<PlannedWorkout> = {},
): PlannedWorkout {
  const d = Math.max(t.minMin, Math.min(t.maxMin, Math.round(durationMin / 5) * 5));
  const lvl = Math.max(0, Math.min(t.levels - 1, level));
  const built = t.build(d, lvl);
  const load = blocksLoad(built.blocks);
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
    why: [...why, ...(t.science ? [t.science] : [])],
    fueling: '',
    key: t.key,
    ...overrides,
  };
  w.fueling = fuelingFor(w, ctx.input.profile.weightKg);
  return w;
}

function isHard(w: PlannedWorkout | null | undefined): boolean {
  return !!w && (w.key || w.intensity === 'hard' || w.category === 'race');
}

/** Progression level from phase progress, readiness and recent history. */
function levelFor(t: WorkoutTemplate, ctx: Ctx): number {
  const { mw, profile, input } = ctx;
  if (t.levels <= 1) return 0;
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
    ctx.cfg[d] = effectiveDayConfig(d, week, input.events, macro.goalDate);
    ctx.cap[d] = ctx.cfg[d].maxMinutes ?? defaultDayCap(d, week.hours);
    ctx.rides[d] = null;
    ctx.notes[d] = [];
  }

  const budget = Math.round(week.hours * 60 * mw.volumeFactor * readiness.volumeModifier);
  ctx.summary.push(
    `${PHASE_LABELS[mw.phase]} · week ${mw.weekInPhase}/${mw.phaseWeeks}${mw.weekType !== 'load' ? ` · ${mw.weekType.replace('_', ' ')} week` : ''}: ${mw.focus}.`,
  );
  if (profile.note) ctx.summary.push(profile.note);

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
    } else if (c.status === 'pinned' && c.pinned && WORKOUT_BY_ID[c.pinned.workoutId]) {
      const t = getTemplate(c.pinned.workoutId);
      const w = makeWorkout(t, c.pinned.durationMin, levelFor(t, ctx), ctx, ['You picked this workout for this day.'], { fixed: 'pinned' });
      ctx.rides[d] = w;
      ctx.locked.add(d);
      if (isHard(w)) fixedHard++;
    } else if (c.status === 'race' && c.race) {
      const ifac = raceIf(c.race.durationMin);
      const w: PlannedWorkout = {
        templateId: 'race',
        name: `${c.race.priority} race: ${c.race.name}`,
        category: 'race',
        intensity: 'hard',
        durationMin: c.race.durationMin,
        tss: tssFromIf(c.race.durationMin, ifac),
        ifactor: ifac,
        blocks: [],
        purpose: c.race.priority === 'A' ? 'Goal event. Trust the taper, pace and fuel to plan.' : c.race.priority === 'B' ? 'B race — race it, with a short mini-taper.' : 'C race — a hard training day with a number on.',
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
    const target = Math.max(90, budget * profile.longRideShare);
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
      ctx.rides[longDay] = makeWorkout(t, duration, levelFor(t, ctx), ctx, why);
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
  if (kk < k) ctx.warnings.push(`Only room for ${kk} of ${k} planned quality sessions with your availability.`);

  bestCombo.sort();
  const usedTemplates = new Set<string>();
  const keyTotal = bestCombo.length + fixedHard + (longIsHard ? 1 : 0);
  bestCombo.forEach((d, i) => {
    const slot = profile.slots[Math.min(i, profile.slots.length - 1)] ?? ['sweetspot'];
    let id = slot[(mw.index + i) % slot.length];
    if (!profile.allowBackToBack && usedTemplates.has(id)) id = slot.find((x) => !usedTemplates.has(x)) ?? id;
    usedTemplates.add(id);
    const t = getTemplate(id);
    const cap = ctx.cap[d];
    const target = Math.min(cap, Math.max(t.minMin, 75));
    const lvl = levelFor(t, ctx);
    const why = [
      `Quality session ${i + 1 + fixedHard + (longIsHard ? 1 : 0)} of ${keyTotal} this week (${PHASE_LABELS[mw.phase].toLowerCase()} phase, level ${lvl + 1}/${t.levels}).`,
    ];
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
    } else if (!varietyUsed && !afterHard && profile.variety.length && mins >= 60) {
      t = getTemplate(profile.variety[mw.index % profile.variety.length]);
      varietyUsed = true;
      why.push('Easy aerobic ride with a little neuromuscular work for variety.');
    } else {
      t = getTemplate('endurance');
      why.push(afterHard ? 'Easy endurance after a hard day — keep it truly Zone 2.' : 'Aerobic volume — stay below LT1 (you can talk in full sentences).');
    }
    ctx.rides[d] = makeWorkout(t, Math.max(t.minMin, mins), levelFor(t, ctx), ctx, why);
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
      const nw = makeWorkout(t, newDur, levelFor(t, ctx), ctx, w.why);
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
    if (remaining < -15) ctx.warnings.push('Your fixed sessions exceed the hours you set for this week.');
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
          ctx.rides[d] = makeWorkout(t, w.durationMin - 15, levelFor(t, ctx), ctx, w.why);
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
    if (input.strength.includeMobility && (!p.ride || p.ride.category === 'recovery') && !p.strength)
      p.mobility = '10-15 min mobility: hip-flexor and hamstring stretches, thoracic rotations, glute bridges, cat-cow.';
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

/** Build a single workout for manual swaps in the UI. */
export function buildSwap(templateId: string, durationMin: number, level: number, weightKg: number | null): PlannedWorkout {
  const t = getTemplate(templateId);
  const d = Math.max(t.minMin, Math.min(t.maxMin, Math.round(durationMin / 5) * 5));
  const built = t.build(d, Math.max(0, Math.min(t.levels - 1, level)));
  const load = blocksLoad(built.blocks);
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
    why: ['Swapped in by you.', ...(t.science ? [t.science] : [])],
    fueling: '',
    key: t.key,
    fixed: 'pinned',
  };
  w.fueling = fuelingFor(w, weightKg);
  return w;
}
