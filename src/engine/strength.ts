// Strength training for cyclists: phase-based prescriptions (anatomical adaptation →
// max strength → strength-power → maintenance → taper), equipment-specific exercise
// choices, and day placement that keeps easy days easy and protects key sessions.
import { addDays, diffDays, dowShort } from './dates';
import type {
  DayConfig,
  Equipment,
  Experience,
  ISODate,
  PlannedDay,
  Readiness,
  StrengthExercise,
  StrengthPhase,
  StrengthSession,
  StrengthSettings,
  Trends,
} from './types';

type Pattern =
  | 'squat'
  | 'squatAlt'
  | 'hinge'
  | 'hingeAlt'
  | 'unilateral'
  | 'unilateralAlt'
  | 'glute'
  | 'hamstring'
  | 'calf'
  | 'pull'
  | 'push'
  | 'antiRotation'
  | 'antiExtension'
  | 'adductor'
  | 'plyo'
  | 'plyoAlt';

const EXERCISES: Record<Pattern, Record<Equipment, string>> = {
  squat: { gym: 'Back Squat', barbell: 'Back Squat', dumbbell: 'Goblet Squat', bodyweight: 'Tempo Squat (3 s down, pause)' },
  squatAlt: { gym: 'Leg Press', barbell: 'Front Squat', dumbbell: 'DB Front-Rack Squat', bodyweight: 'Skater Squat' },
  hinge: { gym: 'Trap-Bar Deadlift', barbell: 'Deadlift', dumbbell: 'DB Romanian Deadlift', bodyweight: 'Single-Leg RDL (slow)' },
  hingeAlt: { gym: 'Romanian Deadlift', barbell: 'Romanian Deadlift', dumbbell: 'Single-Leg DB RDL', bodyweight: 'Single-Leg Hip Thrust' },
  unilateral: {
    gym: 'Bulgarian Split Squat (DB)',
    barbell: 'Bulgarian Split Squat (barbell)',
    dumbbell: 'Bulgarian Split Squat (DB)',
    bodyweight: 'Bulgarian Split Squat (3 s lowering)',
  },
  unilateralAlt: { gym: 'Step-Up (knee-height box)', barbell: 'Barbell Step-Up', dumbbell: 'DB Step-Up', bodyweight: 'Step-Up (high box)' },
  glute: { gym: 'Hip Thrust', barbell: 'Barbell Hip Thrust', dumbbell: 'DB Hip Thrust', bodyweight: 'Single-Leg Glute Bridge' },
  hamstring: { gym: 'Lying Leg Curl', barbell: 'Nordic Curl (assisted)', dumbbell: 'Nordic Curl (assisted)', bodyweight: 'Nordic Curl (assisted)' },
  calf: { gym: 'Standing Calf Raise', barbell: 'Barbell Calf Raise', dumbbell: 'Single-Leg DB Calf Raise', bodyweight: 'Single-Leg Calf Raise' },
  pull: { gym: 'Pull-Up or Lat Pulldown', barbell: 'Barbell Row', dumbbell: '1-Arm DB Row', bodyweight: 'Inverted Row or Band Row' },
  push: { gym: 'DB Bench Press', barbell: 'Bench Press', dumbbell: 'DB Floor Press', bodyweight: 'Push-Up' },
  antiRotation: { gym: 'Cable Pallof Press', barbell: 'Band Pallof Press', dumbbell: 'Suitcase Carry', bodyweight: 'Side Plank' },
  antiExtension: { gym: 'Ab-Wheel Rollout', barbell: 'Dead Bug', dumbbell: 'Dead Bug', bodyweight: 'Dead Bug' },
  adductor: { gym: 'Copenhagen Plank', barbell: 'Copenhagen Plank', dumbbell: 'Copenhagen Plank', bodyweight: 'Copenhagen Plank' },
  plyo: { gym: 'Box Jump', barbell: 'Box Jump', dumbbell: 'Box Jump', bodyweight: 'Squat Jump' },
  plyoAlt: { gym: 'Broad Jump', barbell: 'Broad Jump', dumbbell: 'KB Swing (explosive)', bodyweight: 'Lateral Bound' },
};

const PHASE_INFO: Record<StrengthPhase, { title: string; focus: string; minutes: number }> = {
  AA: { title: 'Anatomical Adaptation', focus: 'Learn the movements, build tendon/connective-tissue tolerance. Moderate loads, higher reps.', minutes: 45 },
  MS: { title: 'Max Strength', focus: 'Heavy, low-rep lifting with full intent on the way up. This is what improves cycling economy and sprint power.', minutes: 50 },
  SP: { title: 'Strength → Power', focus: 'Fewer heavy sets paired with jumps to convert strength into rate of force development.', minutes: 40 },
  MT: { title: 'Maintenance', focus: 'Short, heavy, low volume. One session a week keeps your strength gains while bike load is high.', minutes: 30 },
  DL: { title: 'Deload', focus: 'Same movements, about half the sets, lighter. Keeps the pattern without adding fatigue.', minutes: 30 },
  TP: { title: 'Taper / Neural', focus: 'A few fast, crisp reps and jumps — stimulates without soreness. Skip if in doubt.', minutes: 20 },
};

type Line = [Pattern, number, string, string, string, string?]; // pattern, sets, reps, load, rest, notes

function heavyReps(exp: Experience): { reps: string; load: string } {
  if (exp === 'new') return { reps: '6-8', load: 'RPE 7 (2-3 reps in reserve)' };
  if (exp === 'advanced') return { reps: '3-5', load: 'RPE 8-9 (~85-90% 1RM)' };
  return { reps: '4-6', load: 'RPE 8 (~80-85% 1RM)' };
}

function program(phase: StrengthPhase, variant: 0 | 1, exp: Experience): Line[] {
  const h = heavyReps(exp);
  switch (phase) {
    case 'AA':
      return variant === 0
        ? [
            ['squat', 3, '10-12', 'RPE 6-7', '90 s', 'Controlled 2-3 s lowering'],
            ['hingeAlt', 3, '10', 'RPE 6-7', '90 s'],
            ['unilateral', 2, '10/leg', 'RPE 6-7', '60 s'],
            ['pull', 3, '10-12', 'RPE 7', '60 s'],
            ['push', 2, '10-12', 'RPE 7', '60 s'],
            ['antiExtension', 2, '8/side', 'slow, ribs down', '45 s'],
            ['adductor', 2, '20-30 s/side', 'bodyweight', '45 s'],
          ]
        : [
            ['squatAlt', 3, '10-12', 'RPE 6-7', '90 s'],
            ['hinge', 3, '8-10', 'RPE 6-7', '90 s', 'Neutral spine, push the floor away'],
            ['unilateralAlt', 2, '10/leg', 'RPE 6-7', '60 s'],
            ['glute', 3, '12', 'RPE 7', '60 s'],
            ['calf', 3, '12-15', 'RPE 7', '45 s'],
            ['antiRotation', 2, '10/side', 'moderate', '45 s'],
          ];
    case 'MS':
    case 'DL':
      return variant === 0
        ? [
            ['squat', 4, h.reps, h.load, '2-3 min', 'Controlled down, as fast as possible up'],
            ['unilateral', 3, '6/leg', 'RPE 8', '90 s'],
            ['hingeAlt', 3, '6-8', 'RPE 7-8', '2 min'],
            ['pull', 3, '6-8', 'RPE 8', '90 s'],
            ['antiExtension', 2, '8/side', 'slow', '45 s'],
          ]
        : [
            ['hinge', 4, h.reps, h.load, '2-3 min', 'Max intent on every rep'],
            ['unilateralAlt', 3, '6/leg', 'RPE 8', '90 s'],
            ['glute', 3, '6-8', 'RPE 8', '90 s'],
            ['calf', 3, '8-10', 'RPE 8', '60 s'],
            ['adductor', 2, '20-30 s/side', 'bodyweight', '45 s'],
          ];
    case 'SP':
      return variant === 0
        ? [
            ['squat', 3, '3-4', h.load, '2-3 min', 'Pair each set with the jumps below (contrast)'],
            ['plyo', 3, '4', 'max height, step down', '90 s', 'Full recovery — quality over fatigue'],
            ['unilateral', 2, '5/leg', 'RPE 8, explosive up', '90 s'],
            ['antiRotation', 2, '10/side', 'moderate', '45 s'],
          ]
        : [
            ['hinge', 3, '3', h.load, '2-3 min'],
            ['plyoAlt', 3, '4', 'explosive', '90 s'],
            ['unilateralAlt', 2, '5/leg', 'explosive step', '90 s'],
            ['antiExtension', 2, '8/side', 'slow', '45 s'],
          ];
    case 'MT':
      return variant === 0
        ? [
            ['squat', 3, '3-5', 'RPE 7-8 (same loads as base phase)', '2-3 min'],
            ['unilateral', 2, '5/leg', 'RPE 7-8', '90 s'],
            ['plyo', 2, '3', 'crisp', '60 s'],
            ['antiExtension', 2, '8/side', 'slow', '45 s'],
          ]
        : [
            ['hinge', 3, '3-5', 'RPE 7-8', '2-3 min'],
            ['glute', 2, '6', 'RPE 7', '90 s'],
            ['adductor', 2, '20 s/side', 'bodyweight', '45 s'],
          ];
    case 'TP':
      return [
        ['squat', 2, '3', 'RPE 6, move it fast', '2 min'],
        ['plyo', 2, '3', 'low box, crisp', '60 s'],
        ['antiRotation', 1, '10/side', 'light', '30 s'],
      ];
  }
}

export function buildStrengthSession(
  phase: StrengthPhase,
  equipment: Equipment,
  experience: Experience,
  variant: 0 | 1,
): StrengthSession {
  const lines = program(phase, variant, experience);
  const exercises: StrengthExercise[] = lines.map(([pat, sets, reps, load, rest, notes]) => {
    let name = EXERCISES[pat][equipment];
    let n = notes;
    if (experience === 'new' && pat === 'plyo') {
      name = equipment === 'bodyweight' ? 'Squat Jump (small)' : 'Box Jump (low box)';
    }
    if (phase === 'DL') {
      return { name, sets: Math.max(1, Math.ceil(sets / 2)), reps, load: 'RPE 6 — lighter than last week', rest, notes: n };
    }
    if (equipment === 'bodyweight' && (phase === 'MS' || phase === 'MT') && (pat === 'squat' || pat === 'hinge')) {
      n = 'Bodyweight can’t load heavily — slow the lowering to 3-4 s, add a pause, use a loaded backpack if you can';
      return { name, sets, reps: '8-12', load: 'near-failure on the last set', rest, notes: n };
    }
    return { name, sets, reps, load, rest, notes: n };
  });
  const info = PHASE_INFO[phase];
  return {
    phase,
    title: `${info.title} ${phase === 'TP' ? '' : variant === 0 ? 'A' : 'B'}`.trim(),
    durationMin: info.minutes,
    focus: info.focus,
    exercises,
    timing: '',
    why: [],
  };
}

// ---------- placement ----------

const isHardDay = (d: PlannedDay) => !!d.ride && (d.ride.key || d.ride.intensity === 'hard' || d.ride.category === 'race');
const isLongDay = (d: PlannedDay) => !!d.ride && d.ride.durationMin >= 150;

export interface StrengthPlanArgs {
  days: PlannedDay[];
  settings: StrengthSettings;
  trends: Trends;
  readiness: Readiness;
  dayCfg: (date: ISODate) => DayConfig;
  aRaceDates: ISODate[];
  raceDates: ISODate[];
  basePhase: StrengthPhase; // from the macro plan
}

export function phaseCap(phase: StrengthPhase): number {
  return { AA: 3, MS: 3, SP: 2, MT: 2, DL: 1, TP: 1 }[phase];
}

export function planStrength(args: StrengthPlanArgs): { sessions: Record<ISODate, StrengthSession>; notes: string[] } {
  const { days, settings, trends, readiness, dayCfg, aRaceDates, raceDates, basePhase } = args;
  const notes: string[] = [];
  const sessions: Record<ISODate, StrengthSession> = {};
  if (settings.frequency === 0) return { sessions, notes };

  // Phase for the week: from the macro week of the first day, with a re-entry override
  let phase: StrengthPhase = basePhase;
  const reEntry = trends.daysSinceStrength == null || trends.daysSinceStrength > 21;
  if (reEntry && ['MS', 'SP', 'MT'].includes(phase)) {
    phase = 'AA';
    notes.push(
      trends.daysSinceStrength == null
        ? 'No recent lifting found — starting with 2-3 weeks of anatomical adaptation before heavy loads.'
        : `It has been ${trends.daysSinceStrength} days since your last lift — easing back in with adaptation-phase loads to avoid heavy soreness.`,
    );
  } else if (settings.experience === 'new' && phase === 'MS' && trends.strengthSessions28 < 4) {
    phase = 'AA';
    notes.push('New to lifting: a few more adaptation sessions before heavy (RPE 8+) work.');
  }

  let target = settings.frequency as number;
  if (settings.followPhaseCaps && target > phaseCap(phase)) {
    notes.push(`Strength capped at ${phaseCap(phase)}×/week in this phase (${PHASE_INFO[phase].title.toLowerCase()}) to protect bike sessions.`);
    target = phaseCap(phase);
  }

  // Candidate days
  type Cand = { i: number; date: ISODate; score: number; reasons: string[] };
  const cands: Cand[] = [];
  days.forEach((d, i) => {
    const cfg = dayCfg(d.date);
    if (cfg.status === 'off' || cfg.noLift) return;
    if (d.ride?.category === 'race') return;
    const daysToA = aRaceDates.map((r) => diffDays(r, d.date)).filter((x) => x >= 0);
    const nearestA = daysToA.length ? Math.min(...daysToA) : Infinity;
    if (nearestA < 5) return; // nothing in the last 4 days before an A race
    if (phase !== 'TP' && nearestA < 8) return; // only a neural session inside the final week
    const next = days[i + 1];
    const nextDate = addDays(d.date, 1);
    let score = 0;
    const reasons: string[] = [];
    const hard = isHardDay(d);
    if (hard) {
      score += settings.placement === 'easy_days' ? 1 : 4;
      reasons.push('same day as a hard ride — keeps your easy days easy');
    } else if (d.ride) {
      score += settings.placement === 'easy_days' ? 3 : 1.5;
      reasons.push('paired with an easy ride');
    } else {
      const restDays = days.filter((x) => !x.ride).length;
      score += settings.placement === 'hard_days' ? -2 : settings.placement === 'any' ? 0.5 : 1;
      if (restDays <= 1) score -= 3;
      reasons.push('on a day off the bike');
    }
    if (isLongDay(d)) score -= d.ride?.key ? 6 : 3;
    if (raceDates.includes(nextDate)) score -= 50;
    if (next && (isHardDay(next) || isLongDay(next))) {
      score -= phase === 'TP' || phase === 'DL' ? 2 : 6;
    } else if (next) {
      score += 1;
      reasons.push('tomorrow is easy, so heavy legs won’t cost a key session');
    }
    if (i < readiness.easyDays) score -= 4;
    if (i === 0 && trends.daysSinceStrength === 0) score -= 5;
    cands.push({ i, date: d.date, score, reasons });
  });

  if (!cands.length) {
    notes.push('No suitable lifting days this week (taper/race or all days blocked).');
    return { sessions, notes };
  }

  // Choose best combination (spacing ≥ 2 days preferred)
  const n = Math.min(target, cands.length);
  let best: Cand[] = [];
  let bestScore = -Infinity;
  const combo = (start: number, chosen: Cand[]) => {
    if (chosen.length === n) {
      let s = chosen.reduce((a, c) => a + c.score, 0);
      for (let k = 1; k < chosen.length; k++) {
        const gap = chosen[k].i - chosen[k - 1].i;
        if (gap < 2) s -= 8;
        else if (gap >= 3) s += 1;
      }
      if (s > bestScore) {
        bestScore = s;
        best = [...chosen];
      }
      return;
    }
    for (let k = start; k < cands.length; k++) combo(k + 1, [...chosen, cands[k]]);
  };
  combo(0, []);
  if (n < settings.frequency && n === cands.length && n < target) notes.push(`Only ${n} suitable lifting day(s) this week.`);

  best.forEach((c, k) => {
    const d = days[c.i];
    const session = buildStrengthSession(phase, settings.equipment, settings.experience, (k % 2) as 0 | 1);
    session.timing = isHardDay(d)
      ? 'Ride first, lift later — ideally 6+ h after the ride (or straight after if that is your only window). Never lift legs right before intervals.'
      : d.ride
        ? 'After the easy ride or later in the day.'
        : 'Any time today; keep the rest of the day relaxed.';
    session.why = [
      `${dowShort(d.date)}: ${c.reasons.join('; ')}.`,
      'Heavy strength training improves cycling economy, sprint power and late-race performance without meaningful weight gain (Rønnestad & Mujika 2014; Vikmoen et al. 2016).',
      phase === 'MT'
        ? 'One heavy session per week is enough to maintain strength during hard bike blocks (Rønnestad et al. 2010).'
        : phase === 'TP'
          ? 'Inside the final 10 days only a short neural session — never heavy or to soreness.'
          : 'Two heavy sessions per week for 8-12 weeks is the most-studied dose for cyclists.',
    ];
    sessions[d.date] = session;
  });
  return { sessions, notes };
}
