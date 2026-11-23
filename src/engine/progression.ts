// Progression levels (inspired by TrainerRoad's Progression/Workout Levels and JOIN's
// RPE-adaptive plans). Each energy system gets a 1-10 level derived from the hardest
// recent session that stressed it (time in zone), decaying when not trained, nudged by
// how hard you said it felt. Every planned workout gets a level on the same scale, so the
// planner can choose sessions that are Achievable / Productive / Stretch for *you*.
import { diffDays } from './dates';
import type { Activity, Block, ISODate } from './types';

export type ProgZone = 'endurance' | 'tempo' | 'sweetspot' | 'threshold' | 'vo2max' | 'anaerobic';
export const PROG_ZONES: ProgZone[] = ['endurance', 'tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic'];
export const PROG_LABEL: Record<ProgZone, string> = {
  endurance: 'Endurance',
  tempo: 'Tempo',
  sweetspot: 'Sweet spot',
  threshold: 'Threshold',
  vo2max: 'VO2max',
  anaerobic: 'Anaerobic',
};

export type Feedback = 'easy' | 'moderate' | 'hard' | 'very_hard' | 'all_out' | 'failed';
export const FEEDBACK_LABEL: Record<Feedback, string> = {
  easy: 'Easy',
  moderate: 'Moderate',
  hard: 'Hard',
  very_hard: 'Very hard',
  all_out: 'All out',
  failed: 'Couldn’t finish',
};
const FEEDBACK_ADJ: Record<Feedback, number> = { easy: 1, moderate: 0.5, hard: 0, very_hard: -0.4, all_out: -0.8, failed: -1.5 };

export function rpeToFeedback(rpe: number): Feedback {
  if (rpe <= 4) return 'easy';
  if (rpe <= 6) return 'moderate';
  if (rpe <= 8) return 'hard';
  if (rpe <= 9) return 'very_hard';
  return 'all_out';
}

export type Difficulty = 'recovery' | 'achievable' | 'productive' | 'stretch' | 'breakthrough' | 'not_recommended';
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  recovery: 'Recovery',
  achievable: 'Achievable',
  productive: 'Productive',
  stretch: 'Stretch',
  breakthrough: 'Breakthrough',
  not_recommended: 'Not recommended',
};

/** Which energy system each template primarily trains. */
export const TEMPLATE_ZONE: Record<string, ProgZone | null> = {
  recovery: null,
  endurance: 'endurance',
  end_sprints: 'endurance',
  end_cadence: 'endurance',
  tempo: 'tempo',
  sweetspot: 'sweetspot',
  threshold: 'threshold',
  over_under: 'threshold',
  thr_surges: 'threshold',
  vo2_long: 'vo2max',
  vo2_4x8: 'vo2max',
  vo2_3015: 'vo2max',
  vo2_4020: 'vo2max',
  vo2_faststart: 'vo2max',
  anaerobic: 'anaerobic',
  sprints: 'anaerobic',
  crit_sim: 'anaerobic',
  climb_sim: 'threshold',
  tt_sim: 'threshold',
  gravel_sim: 'vo2max',
  durability: 'endurance',
  openers: null,
  ftp_test: 'threshold',
  end_tempo: 'tempo',
  torque: 'tempo',
  z2_finish: 'threshold',
  tempo_bursts: 'tempo',
  tempo_long: 'tempo',
  ss_bursts: 'sweetspot',
  ss_ladder: 'sweetspot',
  thr_steady: 'threshold',
  thr_ladder: 'threshold',
  thr_floats: 'threshold',
  climb_repeats: 'threshold',
  vo2_4x4: 'vo2max',
  vo2_3030: 'vo2max',
  vo2_pyramid: 'vo2max',
  vo2_microburst: 'vo2max',
  anaerobic_2min: 'vo2max',
  tabata: 'anaerobic',
  attacks: 'anaerobic',
  standing_starts: 'anaerobic',
  leadout_sprints: 'anaerobic',
  breakaway: 'threshold',
  xc_start: 'vo2max',
  road_race_sim: 'threshold',
  hillclimb_tt: 'threshold',
  durability_vo2: 'vo2max',
  ramp_test: null,
  test_8min: null,
  test_cp: null,
  sprint_test: null,
  recovery_drills: null,
  race_warmup: null,
};

/** Minutes → level (1-10). Same scale for completed rides and planned workouts. */
export function zoneScore(zone: ProgZone, minutes: number): number {
  const f: Record<ProgZone, [number, number]> = {
    // [minutes at level 1, minutes per level] — calibrated so the library spans ~2-9
    endurance: [45, 28],
    tempo: [10, 9],
    sweetspot: [13, 6.7],
    threshold: [22, 5.1],
    vo2max: [8.4, 2.4],
    anaerobic: [4, 1.33],
  };
  const [start, per] = f[zone];
  const s = 1 + (minutes - start) / per;
  return s < 1 ? 0 : Math.min(10, s);
}

type ZoneMinutes = Record<ProgZone, number>;
const empty = (): ZoneMinutes => ({ endurance: 0, tempo: 0, sweetspot: 0, threshold: 0, vo2max: 0, anaerobic: 0 });

interface Effort {
  reps: number;
  secs: number;
  pct: number; // % FTP
  restSecs?: number; // recovery after each rep (known for planned workouts)
}

const SS_LOW = 84;
const SS_HIGH = 97;
function zoneOfPct(p: number): number {
  const bounds = [55, 75, 90, 105, 120, 150];
  for (let i = 0; i < bounds.length; i++) if (p <= bounds[i]) return i;
  return 6;
}

/**
 * Credit only *sustained* work: each energy system needs efforts of a minimum length and
 * a minimum total per session. This is applied identically to detected intervals from
 * completed rides and to the steps of planned workouts, so both share one scale — and
 * 36 × 8 s surges in a group ride don't masquerade as a VO2max session.
 */
function effortMinutes(efforts: Effort[]): Omit<ZoneMinutes, 'endurance'> {
  const acc = { tempo: 0, sweetspot: 0, threshold: 0, vo2max: 0, anaerobic: 0 };
  for (const e of efforts) {
    const mins = (e.reps * e.secs) / 60;
    const z = zoneOfPct(e.pct);
    if (z === 2 && e.secs >= 180) acc.tempo += mins;
    if (e.pct >= SS_LOW && e.pct <= SS_HIGH && e.secs >= 180) acc.sweetspot += mins;
    if (z === 3 && e.secs >= 120) acc.threshold += mins;
    if (z === 4) {
      // Efforts just above threshold (e.g. Seiler 4×8 at ~106%) are part threshold, part VO2
      const w = Math.min(1, Math.max(0.5, 0.5 + (e.pct - 105) / 15));
      if (e.secs >= 60) {
        acc.vo2max += mins * w;
        acc.threshold += mins * 0.5;
      } else if (e.reps >= 6 && e.secs >= 15) acc.vo2max += mins * 0.75; // short-short VO2 sets
    }
    // Short repeats with short recoveries (30/15s, 40/20s) are mostly aerobic
    const shortRepeats = e.secs < 45 && e.reps >= 6 && (e.restSecs == null || e.restSecs <= e.secs * 2);
    if (z === 5 && e.secs >= 15) {
      acc.anaerobic += mins * (shortRepeats ? 0.3 : 1);
      if (e.reps >= 6 || e.secs >= 60) acc.vo2max += mins * 0.75;
    }
    if (z === 6) acc.anaerobic += mins * (e.secs >= 20 ? 1 : 0.5);
  }
  const min = { tempo: 10, sweetspot: 8, threshold: 6, vo2max: 4, anaerobic: 1.5 };
  for (const k of Object.keys(acc) as (keyof typeof acc)[]) if (acc[k] < min[k]) acc[k] = 0;
  return acc;
}

/** Time-in-zone of a completed ride (intervals.icu detected efforts, else zone times). */
export function activityZoneMinutes(a: Activity): ZoneMinutes {
  const m = empty();
  if (!a.isRide) return m;
  const z = a.powerZoneSecs;
  const hasZones = !!z && z.some((x) => x > 0);
  if (hasZones) m.endurance = ((z![0] ?? 0) + (z![1] ?? 0) + (z![2] ?? 0)) / 60;
  else if (a.hrZoneSecs && a.hrZoneSecs.some((x) => x > 0)) m.endurance = ((a.hrZoneSecs[0] ?? 0) + (a.hrZoneSecs[1] ?? 0) + (a.hrZoneSecs[2] ?? 0)) / 60;
  else if (a.intensity != null && a.intensity < 0.8) m.endurance = a.movingSec / 60;

  if (a.efforts && a.ftp) {
    Object.assign(m, effortMinutes(a.efforts.map((e) => ({ reps: e.reps, secs: e.secs, pct: (e.watts / a.ftp!) * 100 }))));
    return m;
  }
  if (hasZones) {
    // No interval detection: use time in zone, discounted for very stochastic rides
    const k = a.vi != null && a.vi > 1.12 ? 0.4 : 1;
    m.tempo = (z![2] ?? 0) / 60;
    m.threshold = (k * ((z![3] ?? 0) + 0.5 * (z![4] ?? 0))) / 60;
    m.vo2max = (k * ((z![4] ?? 0) + 0.75 * (z![5] ?? 0))) / 60;
    m.anaerobic = (k * ((z![5] ?? 0) + 0.5 * (z![6] ?? 0))) / 60;
    m.sweetspot = (k * (a.ssSecs ?? 0)) / 60;
  } else if (a.hrZoneSecs && a.hrZoneSecs.some((x) => x > 0)) {
    const h = a.hrZoneSecs;
    m.tempo = (h[2] ?? 0) / 60;
    m.threshold = (h[3] ?? 0) / 60;
    m.vo2max = ((h[4] ?? 0) + (h[5] ?? 0)) / 60;
  }
  return m;
}

/** Time-in-zone of a planned workout (same rules as completed rides). */
export function workoutZoneMinutes(blocks: Block[]): ZoneMinutes {
  const m = empty();
  const efforts: Effort[] = [];
  for (const b of blocks)
    b.steps.forEach((st, i) => {
      const mid = (st.low + st.high) / 2;
      if (zoneOfPct(mid) <= 2) m.endurance += (st.durationSec * b.reps) / 60;
      const next = b.steps[(i + 1) % b.steps.length];
      const restSecs = b.steps.length > 1 && next !== st ? next.durationSec : undefined;
      efforts.push({ reps: b.reps, secs: st.durationSec, pct: mid, restSecs });
    });
  return { ...m, ...effortMinutes(efforts) };
}

const capable = new Map<string, boolean>();
/**
 * Whether a template meaningfully registers on its zone's level scale (structured
 * intervals do; sprints, race simulations and tests mostly don't). Only capable
 * templates are levelled by progression and get difficulty labels.
 */
export function progressionCapable(t: { id: string; levels: number; minMin: number; maxMin: number; build: (d: number, l: number) => { blocks: Block[] } }): boolean {
  if (capable.has(t.id)) return capable.get(t.id)!;
  const zone = TEMPLATE_ZONE[t.id];
  let ok = false;
  if (zone && zone !== 'endurance' && t.levels > 1) {
    const d = Math.max(t.minMin, Math.min(t.maxMin, 150));
    const hi = workoutLevel(t.id, t.build(d, t.levels - 1).blocks)?.level ?? 0;
    const lo = workoutLevel(t.id, t.build(d, 0).blocks)?.level ?? 0;
    ok = hi >= 3 && hi - lo >= 1.5;
  }
  capable.set(t.id, ok);
  return ok;
}

export function workoutLevel(templateId: string, blocks: Block[]): { zone: ProgZone; level: number } | null {
  const zone = TEMPLATE_ZONE[templateId];
  if (!zone) return null;
  const mins = workoutZoneMinutes(blocks);
  return { zone, level: Math.round(Math.max(1, zoneScore(zone, mins[zone])) * 10) / 10 };
}

export interface ZoneLevel {
  level: number; // 1..10
  date: ISODate | null; // session that set it
  source: 'history' | 'none';
}
export type Progression = Record<ProgZone, ZoneLevel>;

export function computeProgression(activities: Activity[], feedback: Record<string, Feedback>, asOf: ISODate): Progression {
  const out = Object.fromEntries(PROG_ZONES.map((z) => [z, { level: 1, date: null, source: 'none' }])) as Progression;
  for (const a of activities) {
    const age = diffDays(asOf, a.date);
    if (!a.isRide || age < 0 || age > 120) continue;
    const mins = activityZoneMinutes(a);
    const scores = Object.fromEntries(PROG_ZONES.map((z) => [z, zoneScore(z, mins[z])])) as Record<ProgZone, number>;
    // Primary zone = hardest non-endurance system it scored, else endurance
    const hard = PROG_ZONES.filter((z) => z !== 'endurance' && scores[z] >= 1).sort((x, y) => scores[y] - scores[x]);
    const primary: ProgZone = hard[0] ?? 'endurance';
    const fb = feedback[a.id] ?? (a.rpe ? rpeToFeedback(a.rpe) : null);
    const weeks = age / 7;
    for (const z of PROG_ZONES) {
      if (scores[z] < 1) continue;
      let s = scores[z];
      if (fb && z === primary) s += FEEDBACK_ADJ[fb];
      s -= Math.max(0, weeks - 3) * (z === 'endurance' ? 0.2 : 0.35);
      if (s > out[z].level || out[z].source === 'none') {
        if (s >= 1 || out[z].source === 'none') out[z] = { level: Math.max(1, Math.min(10, Math.round(s * 10) / 10)), date: a.date, source: 'history' };
      }
    }
  }
  return out;
}

export function difficultyOf(workoutLvl: number, athleteLvl: number): Difficulty {
  const d = workoutLvl - athleteLvl;
  if (d <= -2.5) return 'recovery';
  if (d < -0.5) return 'achievable';
  if (d <= 1.0) return 'productive';
  if (d <= 2.0) return 'stretch';
  if (d <= 3.0) return 'breakthrough';
  return 'not_recommended';
}
