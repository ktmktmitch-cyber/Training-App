// Running, run + bike and triathlon plans, layered on the bike planner so they keep its
// periodization, readiness, rest days, strength placement and fixed days.
//
//  * Running only: each planned ride becomes the matching run (hard ride → quality run, long
//    ride → long run, easy → easy run), shortened because running costs more per minute, with
//    at most 2 quality runs plus the long run, the long run capped (~30% of the week, ≤ 2.5 h),
//    and weekly running time capped at ~15% above what you've recently run — the main
//    modifiable risk factor for running injuries is ramping volume too fast.
//  * Run + bike / triathlon: the bike plan gets its share of the hours; runs and swims are
//    slotted around it — the quality run on a day away from hard rides, the long run on the
//    other weekend day from the long ride, brick runs off key rides in triathlon build/peak,
//    swims (CSS + aerobic/technique) on easier days — always keeping your rest days.
import { diffDays, dow, fmtMinutes } from './dates';
import { instantiate } from './planner';
import { eventProfile, longFraction, phaseGroup, type EventProfile } from './goals';
import type { Activity, EventType, ISODate, MacroWeek, Phase, PlannedDay, PlannedWorkout, Readiness, SecondSession, SportMode, WeekPlan } from './types';
import { projectLoad, round } from './stats';
import { getTemplate } from './workouts';

export const SPORT_LABEL: Record<SportMode, string> = { cycling: 'Cycling', running: 'Running', run_bike: 'Run + bike', triathlon: 'Triathlon' };

/** Share of weekly time by sport. */
export const SPORT_SHARE: Record<SportMode, { ride: number; run: number; swim: number }> = {
  cycling: { ride: 1, run: 0, swim: 0 },
  running: { ride: 0, run: 1, swim: 0 },
  run_bike: { ride: 0.6, run: 0.4, swim: 0 },
  triathlon: { ride: 0.5, run: 0.3, swim: 0.2 },
};

/** Share of weekly time by sport, tuned to the goal event's distance (e.g. Ironman = more bike). */
export function shareFor(sport: SportMode, event?: EventType | null): { ride: number; run: number; swim: number } {
  const ev = eventProfile(event);
  return sport === 'triathlon' && ev?.share ? ev.share : SPORT_SHARE[sport];
}

/** Hours to hand to the bike planner (running-only plans are built from a full bike plan, then converted). */
export function bikeHoursFor(sport: SportMode, hours: number, event?: EventType | null): number {
  return sport === 'running' || sport === 'cycling' ? hours : Math.max(1, hours * shareFor(sport, event).ride);
}

/** The event's key run for this week (rotates through the distance's priority sessions). */
function eventQualityRun(ev: EventProfile | null, mw: MacroWeek | null, n: number): string | null {
  if (!ev?.runQuality) return null;
  const list = ev.runQuality[phaseGroup(phaseOf(mw))];
  return list[((mw?.index ?? 0) + n) % list.length];
}

/** Long-session target this week for the event: grows through the season toward the event's longest. */
function eventLong(ev: EventProfile | null, key: 'longRun' | 'longRide' | 'longSwim', mw: MacroWeek | null): number | null {
  const v = ev?.[key];
  if (!v) return null;
  return Math.round((v * longFraction(phaseOf(mw)) * (isEasyWeek(mw) && mw?.weekType === 'recovery' ? 0.75 : 1)) / 5) * 5;
}

export interface SportsInput {
  plan: WeekPlan;
  sport: SportMode;
  hours: number;
  macroWeek: MacroWeek | null;
  readiness: Readiness;
  activities: Activity[];
  asOf: ISODate;
  weightKg: number | null;
  minRestDays: number;
  /** the season goal's event type (distance-specific long sessions and key sessions) */
  event?: EventType | null;
}

const isRun = (a: Activity) => /run/i.test(a.type) && !/ride/i.test(a.type);
const isHardRide = (w: PlannedWorkout | null | undefined) => !!w && (w.key || w.intensity === 'hard') && w.category !== 'endurance' && w.category !== 'recovery';

/** Weekly running-time cap from recent history (≈ +15%/week, with a floor so beginners can start). */
export function runCap(activities: Activity[], asOf: ISODate, floorMin: number): { cap: number; last7: number; avg28: number; note: string | null } {
  let last7 = 0;
  let last28 = 0;
  for (const a of activities) {
    if (!isRun(a)) continue;
    const age = diffDays(asOf, a.date);
    if (age < 0 || age >= 28) continue;
    last28 += a.movingSec / 60;
    if (age < 7) last7 += a.movingSec / 60;
  }
  const avg28 = last28 / 4;
  const base = Math.max(last7, avg28);
  const cap = Math.max(floorMin, Math.round(base * 1.15));
  const note = base < 1 ? `No recent runs found — starting at ${fmtMinutes(cap)} of running and building gradually.` : null;
  return { cap, last7: Math.round(last7), avg28: Math.round(avg28), note };
}

function phaseOf(mw: MacroWeek | null): Phase {
  return mw?.phase ?? 'base';
}
const isEasyWeek = (mw: MacroWeek | null) => !!mw && (mw.weekType === 'recovery' || mw.weekType === 'taper' || mw.weekType === 'race' || !!mw.userRest);
const lateBuild = (p: Phase) => ['build', 'transmutation', 'volume', 'intensity'].includes(p);
const specific = (p: Phase) => ['peak', 'specific', 'realization'].includes(p);

function runLevel(id: string, mw: MacroWeek | null, readiness: Readiness): number {
  const t = getTemplate(id);
  if (readiness.status === 'amber' || isEasyWeek(mw)) return 0;
  const step = Math.max(1, mw?.loadStep ?? 1) - 1 + (lateBuild(phaseOf(mw)) ? 1 : specific(phaseOf(mw)) ? 2 : 0);
  return Math.min(t.levels - 1, step);
}

/** The run that matches a planned ride in a running-only plan. */
function runForRide(w: PlannedWorkout, isLongest: boolean, mw: MacroWeek | null, alt: number): string {
  const p = phaseOf(mw);
  switch (w.category) {
    case 'recovery':
      return 'run_recovery';
    case 'endurance':
      return isLongest ? 'run_long' : alt % 2 ? 'run_strides' : 'run_easy';
    case 'tempo':
    case 'sweetspot':
      return p === 'base' || p === 'prep' ? 'run_tempo' : 'run_progression';
    case 'threshold':
    case 'test':
      return 'run_threshold';
    case 'vo2max':
    case 'anaerobic':
      return p === 'base' || p === 'prep' ? 'run_hills' : alt % 2 ? 'run_3030' : 'run_vo2';
    case 'sprint':
      return 'run_strides';
    case 'race_sim':
    case 'durability':
      return specific(p) ? 'run_racepace' : 'run_long_ff';
    case 'openers':
      return 'run_openers';
    default:
      return 'run_easy';
  }
}

function make(id: string, minutes: number, level: number, inp: SportsInput, why: string[]): PlannedWorkout {
  const t = getTemplate(id);
  return instantiate(t, Math.max(t.minMin, Math.min(t.maxMin, minutes)), level, inp.weightKg, undefined, why, { sport: t.sport ?? 'ride' });
}

const sessions = (d: PlannedDay) => (d.ride ? 1 : 0) + (d.extras?.length ?? 0);

export function applySports(inp: SportsInput): WeekPlan {
  if (inp.sport === 'cycling') {
    const ev = eventProfile(inp.event);
    return ev ? { ...inp.plan, warnings: [...inp.plan.warnings, `Your goal is a ${ev.label} but your sport is set to Cycling — pick ${ev.kind === 'tri' ? 'Triathlon' : 'Running (or Run + bike)'} under Sport so the plan adds the ${ev.kind === 'tri' ? 'swims, runs and bricks' : 'runs'} it needs.`] } : inp.plan;
  }
  const days: PlannedDay[] = inp.plan.days.map((d) => ({ ...d, extras: [...(d.extras ?? [])], notes: [...d.notes] }));
  const summary = [...inp.plan.summary];
  const warnings = [...inp.plan.warnings];
  const red = inp.readiness.status === 'red';
  const share = shareFor(inp.sport, inp.event);
  const ev = eventProfile(inp.event);

  if (inp.sport === 'running') convertToRuns(days, inp, summary);
  else {
    if (share.run > 0) addRuns(days, inp, summary, warnings);
    if (share.swim > 0) addSwims(days, inp, summary);
  }
  if (ev && (ev.kind === 'run' ? inp.sport === 'running' || inp.sport === 'run_bike' : inp.sport === 'triathlon')) {
    const parts = [
      ev.longSwim ? `swim ${fmtMinutes(ev.longSwim)}` : '',
      ev.longRide ? `ride ${fmtMinutes(ev.longRide)}` : '',
      ev.longRun ? `run ${fmtMinutes(ev.longRun)}` : '',
    ].filter(Boolean);
    summary.push(`Goal: ${ev.label} (${ev.distance}) — longest sessions build toward ${parts.join(' · ')} by the peak phase.`);
  } else if (ev && ev.kind === 'tri' && inp.sport !== 'triathlon') {
    warnings.push(`Your goal is a ${ev.label} but your sport is set to ${SPORT_LABEL[inp.sport]} — set Sport to Triathlon in Settings to add swims, runs and bricks.`);
  }
  if (red) summary.push('Recovery markers are down: quality runs/swims are swapped for easy ones this week.');

  // Re-total the week across sports, and re-project fitness/fatigue/form with every session
  const all = days.flatMap((d) => [d.ride, ...(d.extras ?? [])].filter(Boolean) as PlannedWorkout[]);
  const totalMin = all.reduce((a, w) => a + w.durationMin, 0);
  const totalTss = all.reduce((a, w) => a + w.tss, 0);
  let { projectedCtl, projectedTsb } = inp.plan;
  const ctl0 = inp.readiness.ctl;
  const atl0 = inp.readiness.atl;
  if (ctl0 != null && atl0 != null) {
    const daily = days.map((d) => [d.ride, ...(d.extras ?? [])].reduce((a, w) => a + (w?.tss ?? 0), 0));
    const proj = projectLoad(ctl0, atl0, daily);
    projectedCtl = round(proj.ctl[proj.ctl.length - 1], 1);
    projectedTsb = round(proj.ctl[proj.ctl.length - 1] - proj.atl[proj.atl.length - 1], 1);
    const i = summary.findIndex((x) => x.startsWith('Projected fitness'));
    const line = `Projected fitness (CTL, all sports) ${round(ctl0)} → ${round(projectedCtl)} (${projectedCtl - ctl0 >= 0 ? '+' : ''}${round(projectedCtl - ctl0, 1)}); form at week end ${projectedTsb >= 0 ? '+' : ''}${round(projectedTsb)}.`;
    if (i >= 0) summary[i] = line;
    else summary.push(line);
    const j = summary.findIndex((x) => /riding \(/.test(x));
    if (j >= 0) summary[j] = `${fmtMinutes(totalMin)} training across sports · ~${totalTss} TSS.`;
  }
  return { ...inp.plan, days, totalMin, totalTss, summary, warnings, projectedCtl, projectedTsb };
}

function convertToRuns(days: PlannedDay[], inp: SportsInput, summary: string[]) {
  const mw = inp.macroWeek;
  const ev = eventProfile(inp.event);
  const evLong = eventLong(ev, 'longRun', mw);
  const { cap, note } = runCap(inp.activities, inp.asOf, Math.min(180, Math.max(90, inp.hours * 60 * 0.5)));
  const budget = Math.min(cap, inp.hours * 60);
  const rides = days.filter((d) => d.ride && !d.ride.fixed);
  // Runners do more, shorter sessions than the bike plan's rides: aim for 4–6 runs
  const want = budget < 150 ? 4 : budget < 240 ? 5 : 6;
  const perRun = Math.max(30, Math.round((budget * 0.7) / Math.max(1, want - 1)));
  const longest = rides.reduce<PlannedDay | null>((a, d) => (!a || (d.ride!.durationMin > a.ride!.durationMin && d.ride!.category === 'endurance') ? d : a), null);
  let quality = 0;
  let alt = 0;
  const used = new Set<string>();
  const VARIETY: Record<string, string> = { run_tempo: 'run_hills', run_progression: 'run_fartlek', run_threshold: 'run_3030', run_vo2: 'run_threshold', run_hills: 'run_tempo', run_3030: 'run_vo2', run_racepace: 'run_threshold' };
  for (const d of rides) {
    const r = d.ride!;
    let id = runForRide(r, d === longest && r.category === 'endurance', mw, alt++);
    // Goal distance: its own key sessions and race-specific long runs
    const evq = getTemplate(id).key && id !== 'run_long' ? eventQualityRun(ev, mw, quality) : null;
    if (evq) id = evq;
    if (id === 'run_long' && ev?.longRunSpecific && phaseGroup(phaseOf(mw)) === 'specific' && !isEasyWeek(mw) && (mw?.index ?? 0) % 2 === 0) id = ev.longRunSpecific;
    if (getTemplate(id).key && used.has(id) && VARIETY[id]) id = VARIETY[id];
    used.add(id);
    const t = getTemplate(id);
    if (t.key && id !== 'run_long') {
      quality++;
      if (quality > 2 || inp.readiness.status === 'red') id = 'run_strides';
    }
    let minutes = Math.min(Math.round(r.durationMin * 0.7), perRun);
    if (id === 'run_long' || id === ev?.longRunSpecific) minutes = evLong ? Math.min(evLong, Math.max(50, Math.round(budget * 0.4))) : Math.min(150, Math.max(50, Math.round(budget * 0.3)));
    d.ride = make(id, minutes, runLevel(id, mw, inp.readiness), inp, [`Your ${r.name.toLowerCase()} slot in the plan, as a run.`]);
  }
  // Fit the week under the running cap: shrink easy runs first, then everything proportionally
  const runs = () => days.filter((d) => d.ride?.sport === 'run');
  const total = () => runs().reduce((a, d) => a + d.ride!.durationMin, 0);
  let over = total() - budget;
  for (const d of runs().filter((x) => !x.ride!.key).sort((a, b) => b.ride!.durationMin - a.ride!.durationMin)) {
    if (over <= 0) break;
    const r = d.ride!;
    const t = getTemplate(r.templateId);
    const cut = Math.min(over, r.durationMin - t.minMin);
    if (cut >= 5) {
      d.ride = make(r.templateId, r.durationMin - cut, r.level ?? 0, inp, r.why);
      over -= cut;
    }
  }
  if (over > 0) {
    // Still too much: drop the shortest easy runs to rest
    for (const d of runs().filter((x) => !x.ride!.key).sort((a, b) => a.ride!.durationMin - b.ride!.durationMin)) {
      if (over <= 0) break;
      over -= d.ride!.durationMin;
      d.notes.push('Rest — keeps your running volume within a safe weekly increase.');
      d.ride = null;
    }
  }
  // Too few runs for the time available (the bike plan had fewer, longer rides): add easy runs on free days
  let room = budget - total();
  for (let guard = 0; guard < 4 && runs().length < want && room >= 25; guard++) {
    const d = pick(
      days,
      (x) => !x.ride && x.status !== 'off' && x.status !== 'race' && restCount(days) > inp.minRestDays,
      (x) => {
        const i = days.indexOf(x);
        const nearKey = [days[i - 1], days[i + 1]].some((y) => y?.ride?.key);
        return (nearKey ? -10 : 0) - (x.strength ? 5 : 0);
      },
    );
    if (!d) break;
    d.ride = make('run_easy', Math.min(45, room), 0, inp, ['Easy run — most of a runner’s week is easy mileage.']);
    room -= d.ride.durationMin;
  }
  summary.push(`Running: ${runs().length} runs · ${fmtMinutes(total())} (cap ${fmtMinutes(Math.round(budget))} — about 15% above your recent weeks).`);
  if (note) summary.push(note);
}

function scoreDay(d: PlannedDay, days: PlannedDay[], avoidHardNeighbours: boolean): number {
  if (d.status === 'off' || d.status === 'race') return -1e9;
  const i = days.indexOf(d);
  const prev = days[i - 1];
  const next = days[i + 1];
  let s = 0;
  if (isHardRide(d.ride)) s -= 50;
  if (avoidHardNeighbours && (isHardRide(prev?.ride) || isHardRide(next?.ride))) s -= 20;
  if (next?.status === 'race') s -= 60;
  if (d.extras?.some((x) => x.key)) s -= 40;
  s -= sessions(d) * 6;
  if (!d.ride && !d.strength) s -= 15; // keep planned rest days as rest where possible
  return s;
}

function pick(days: PlannedDay[], fits: (d: PlannedDay) => boolean, score: (d: PlannedDay) => number): PlannedDay | null {
  const c = days.filter(fits).map((d) => ({ d, s: score(d) })).filter((x) => x.s > -1e8);
  c.sort((a, b) => b.s - a.s);
  return c[0]?.d ?? null;
}

function restCount(days: PlannedDay[]) {
  return days.filter((d) => sessions(d) === 0).length;
}

function addRuns(days: PlannedDay[], inp: SportsInput, summary: string[], warnings: string[]) {
  const mw = inp.macroWeek;
  const p = phaseOf(mw);
  const easyWeek = isEasyWeek(mw);
  const tri = inp.sport === 'triathlon';
  const ev = eventProfile(inp.event);
  const runShare = shareFor(inp.sport, inp.event).run;
  const { cap, note } = runCap(inp.activities, inp.asOf, tri ? 100 : 90);
  let budget = Math.min(cap, inp.hours * 60 * runShare * (easyWeek ? 0.7 : 1));
  const startBudget = budget;
  const count = budget < 90 ? 2 : budget < 160 ? 3 : 4;
  const placed: string[] = [];
  const keepRest = (d: PlannedDay) => sessions(d) > 0 || restCount(days) > inp.minRestDays;
  const longRide = days.reduce<PlannedDay | null>((a, d) => (d.ride && d.ride.category !== 'race' && (!a || d.ride.durationMin > (a.ride?.durationMin ?? 0)) ? d : a), null);

  // 1. Long run — the other weekend day from the long ride if possible
  const evLong = eventLong(ev, 'longRun', mw);
  const longMin = Math.round(evLong ? Math.min(evLong, Math.max(40, budget * 0.45)) : Math.min(tri ? 120 : 105, Math.max(40, budget * 0.38)));
  const longDay = pick(
    days,
    (d) => d !== longRide && keepRest(d),
    (d) => scoreDay(d, days, false) + ([0, 6].includes(dow(d.date)) ? 25 : 0) + (longRide && Math.abs(diffDays(d.date, longRide.date)) === 1 ? 10 : 0),
  );
  if (longDay && budget >= 40) {
    const w = make('run_long', longMin, 0, inp, [evLong ? `Long run — building toward ${fmtMinutes(ev!.longRun!)} for your ${ev!.label}; kept away from your long ride so both get quality.` : 'Long run — kept away from your long ride so both get quality.']);
    longDay.extras!.push(w);
    budget -= w.durationMin;
    placed.push(`long ${fmtMinutes(w.durationMin)} ${fmtDow(longDay.date)}`);
  }

  // 2. Quality run — away from hard rides and the long run
  if (placed.length < count && budget >= 35) {
    let id = easyWeek ? 'run_strides' : eventQualityRun(ev, mw, 0) ?? (specific(p) ? 'run_racepace' : lateBuild(p) ? ((mw?.index ?? 0) % 2 ? 'run_vo2' : 'run_threshold') : (mw?.index ?? 0) % 2 ? 'run_hills' : 'run_tempo');
    if (inp.readiness.status === 'red') id = 'run_easy';
    const qDay = pick(
      days,
      (d) => d !== longDay && keepRest(d) && (!longDay || Math.abs(diffDays(d.date, longDay.date)) > 1 || days.length < 6),
      (d) => scoreDay(d, days, true),
    );
    if (qDay) {
      const stacked = isHardRide(qDay.ride);
      const w = make(id, Math.min(budget, 60), runLevel(id, mw, inp.readiness), inp, [stacked ? 'Stacked on a hard bike day so your easy days stay easy (run after the ride, or AM/PM).' : 'Quality run on a day away from your hard rides.']);
      qDay.extras!.push(w);
      budget -= w.durationMin;
      placed.push(`${w.name.toLowerCase()} ${fmtDow(qDay.date)}`);
    }
  }

  // 3. Triathlon: brick run off the key/long ride in build & peak
  if (tri && !easyWeek && (lateBuild(p) || specific(p)) && placed.length < count && budget >= 15) {
    const brickDay = days.find((d) => d.ride && d.ride.key && !(d.extras ?? []).some((x) => x.sport === 'run')) ?? (longRide && !(longRide.extras ?? []).some((x) => x.sport === 'run') ? longRide : null);
    if (brickDay) {
      const bl = ev?.brick ? Math.round((ev.brick * (specific(p) ? 1 : 0.7)) / 5) * 5 : 25;
      const w = make('run_brick', Math.min(bl, Math.max(15, budget)), 0, inp, [ev?.brick ? `Straight off the bike — practise the transition and your ${ev.label} run pace on tired legs.` : 'Straight off the bike — practise the transition and running on tired legs.']);
      brickDay.extras!.push(w);
      budget -= w.durationMin;
      placed.push(`brick ${fmtDow(brickDay.date)}`);
    }
  }

  // 4. Easy runs with what's left
  let strides = false;
  while (placed.length < count && budget >= 25) {
    const d = pick(
      days,
      (x) => keepRest(x) && !(x.extras ?? []).some((e) => e.sport === 'run'),
      (x) => scoreDay(x, days, false) + (isHardRide(x.ride) ? -10 : 0),
    );
    if (!d) break;
    const id: string = !strides && !easyWeek ? 'run_strides' : 'run_easy';
    strides = strides || id === 'run_strides';
    const w = make(id, Math.min(budget, 50), 1, inp, ['Easy run — aerobic volume with little fatigue.']);
    d.extras!.push(w);
    budget -= w.durationMin;
    placed.push(`easy ${fmtDow(d.date)}`);
  }
  const used = Math.round(startBudget - budget);
  summary.push(`Running: ${placed.length} runs · ${fmtMinutes(used)} (${placed.join(', ')}).`);
  if (note) summary.push(note);
  if (cap < inp.hours * 60 * runShare) warnings.push(`Running time is capped at ${fmtMinutes(cap)} this week (≈15% above your recent running) to keep injury risk down — the rest goes to the bike.`);
}

function addSwims(days: PlannedDay[], inp: SportsInput, summary: string[]) {
  const mw = inp.macroWeek;
  const p = phaseOf(mw);
  const easyWeek = isEasyWeek(mw);
  const ev = eventProfile(inp.event);
  let budget = inp.hours * 60 * shareFor('triathlon', inp.event).swim * (easyWeek ? 0.7 : 1);
  const evSwim = eventLong(ev, 'longSwim', mw);
  const n = budget < 90 ? 2 : 3;
  const ids: string[] = [easyWeek || inp.readiness.status === 'red' ? 'swim_endurance' : 'swim_css', 'swim_technique'];
  if (n === 3) ids.push(specific(p) ? 'swim_openwater' : lateBuild(p) ? 'swim_threshold' : 'swim_endurance');
  const placed: string[] = [];
  const per = Math.max(30, Math.min(60, Math.round(budget / n)));
  // The goal's long swim (continuous, toward race distance) takes the aerobic slot
  const longId = ids.includes('swim_openwater') ? 'swim_openwater' : ids.includes('swim_endurance') ? 'swim_endurance' : null;
  for (const id of ids as string[]) {
    if (budget < 25) break;
    const d = pick(
      days,
      (x) => !(x.extras ?? []).some((e) => e.sport === 'swim') && (sessions(x) > 0 || restCount(days) > inp.minRestDays),
      (x) => scoreDay(x, days, false) - (x.extras?.length ?? 0) * 8 + (id === 'swim_css' && isHardRide(x.ride) ? -15 : 0) + (!x.ride ? 4 : 0),
    );
    if (!d) break;
    const len = id === longId && evSwim ? Math.max(per, evSwim) : per;
    const w = make(id, Math.min(len, budget), runLevel(id, mw, inp.readiness), inp, [id === 'swim_css' ? 'Key swim: CSS repeats.' : id === longId && evSwim ? `Long continuous swim — building toward your ${ev!.label} swim (${ev!.distance.split(' · ')[0]}).` : 'Swim technique and aerobic base — low impact, fine on easier days.']);
    d.extras!.push(w);
    budget -= w.durationMin;
    placed.push(`${w.name.toLowerCase()} ${fmtDow(d.date)}`);
  }
  summary.push(`Swimming: ${placed.length} swims (${placed.join(', ')}).`);
}

function fmtDow(d: ISODate): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow(d)];
}


const SECOND: Record<SecondSession, { sport: 'swim' | 'run' | 'ride'; when: 'AM' | 'PM'; easy: string; steady: string; min: number }> = {
  am_swim: { sport: 'swim', when: 'AM', easy: 'swim_technique', steady: 'swim_endurance', min: 35 },
  pm_swim: { sport: 'swim', when: 'PM', easy: 'swim_technique', steady: 'swim_endurance', min: 35 },
  am_run: { sport: 'run', when: 'AM', easy: 'run_recovery', steady: 'run_easy', min: 30 },
  pm_run: { sport: 'run', when: 'PM', easy: 'run_recovery', steady: 'run_easy', min: 30 },
  spin: { sport: 'ride', when: 'PM', easy: 'recovery', steady: 'recovery', min: 40 },
};

/**
 * Second sessions you asked for in your availability (e.g. a morning swim). Kept easy when the day
 * already has a hard session — the main session carries the training stimulus; steady aerobic
 * otherwise. Not added on days off or race days, or when that sport is already on the day.
 */
export function applySecondSessions(plan: WeekPlan, cfg: (d: ISODate) => { second?: SecondSession | null; status?: string } | undefined, weightKg: number | null, readiness: Readiness): WeekPlan {
  let changed = false;
  const days = plan.days.map((d) => {
    const c = cfg(d.date);
    const want = c?.second;
    if (!want || d.status === 'off' || d.status === 'race') return d;
    const spec = SECOND[want];
    const sessions = [d.ride, ...(d.extras ?? [])].filter(Boolean) as PlannedWorkout[];
    if (sessions.some((w) => (w.sport ?? 'ride') === spec.sport && (spec.sport !== 'ride' || w !== d.ride))) return d;
    const hardDay = sessions.some((w) => w.key || w.intensity === 'hard') || readiness.status === 'red';
    const t = getTemplate(hardDay ? spec.easy : spec.steady);
    const w = instantiate(t, spec.min, 0, weightKg, undefined, [hardDay ? 'Kept easy — the day’s main session is the hard one.' : 'Steady aerobic second session.'], { sport: t.sport ?? 'ride' });
    w.name = `${spec.when} · ${w.name}`;
    changed = true;
    return { ...d, extras: [...(d.extras ?? []), w] };
  });
  if (!changed) return plan;
  const all = days.flatMap((d) => [d.ride, ...(d.extras ?? [])].filter(Boolean) as PlannedWorkout[]);
  return { ...plan, days, totalMin: all.reduce((a, w) => a + w.durationMin, 0), totalTss: all.reduce((a, w) => a + w.tss, 0) };
}
