// Running and swimming workouts. Targets are % of threshold *speed* (run: threshold pace,
// swim: CSS), the same convention intervals.icu uses for "% Pace" targets — so 100% is
// threshold pace, 80% is a pace 25% slower in time per km. Load (rTSS/sTSS-style) comes from
// the same intensity-squared model as the bike workouts.
//
// Running prescriptions follow current endurance-running practice: ~80% easy, long run
// ≤ ~30% of weekly time and capped near 2.5 h, quality from strides/hills and tempo in base
// to threshold and VO2 intervals in build, race pace in the specific phase. Swim sets are
// built around CSS (critical swim speed), the standard triathlon swim threshold.
import type { Block, Step } from './types';
import type { BuildResult, WorkoutTemplate } from './workouts';

export type Sport = 'ride' | 'run' | 'swim';

const steady = (sec: number, low: number, high = low, extra: Partial<Step> = {}): Step => ({ durationSec: Math.round(sec), low, high, ...extra });
const ramp = (sec: number, from: number, to: number, extra: Partial<Step> = {}): Step => ({ durationSec: Math.round(sec), low: from, high: to, ramp: true, ...extra });
const block = (name: string | undefined, reps: number, steps: Step[]): Block => ({ name, reps, steps });
const m = (min: number) => min * 60;
const secs = (blocks: Block[]) => blocks.reduce((a, b) => a + b.reps * b.steps.reduce((x, s) => x + s.durationSec, 0), 0);

// Running intensity bands (% threshold speed)
const R = { rec: [62, 70], easy: [70, 80], steady: [80, 86], mp: [84, 88], tempo: [88, 92], thr: [96, 100], vo2: [104, 110], fast: [115, 125] } as const;

const runWarm = (min = 12): Block => block('Warmup', 1, [ramp(m(min), 65, 78)]);
const runCool = (min = 8): Block => block('Cooldown', 1, [steady(m(min), 65, 72)]);

/** Fill the rest of the session with easy running so the total matches the duration asked for. */
function padEasy(blocks: Block[], durationMin: number, at = blocks.length - 1): Block[] {
  const left = durationMin * 60 - secs(blocks);
  if (left >= 120) blocks.splice(at, 0, block('Easy', 1, [steady(left, R.easy[0], R.easy[1])]));
  return blocks;
}

type RunDef = Omit<WorkoutTemplate, 'build'> & { sport: Sport; build(d: number, l: number): BuildResult };

function run(def: Omit<RunDef, 'sport'>): WorkoutTemplate {
  return { ...def, sport: 'run' } as WorkoutTemplate;
}
function swim(def: Omit<RunDef, 'sport'>): WorkoutTemplate {
  return { ...def, sport: 'swim' } as WorkoutTemplate;
}

export const RUN_WORKOUTS: WorkoutTemplate[] = [
  run({
    id: 'run_recovery', name: 'Recovery run', category: 'recovery', intensity: 'easy', key: false, minMin: 20, maxMin: 45, levels: 1,
    purpose: 'Very easy jog to promote blood flow without adding fatigue. Walk breaks are fine.',
    build: (d) => ({ name: 'Recovery run', blocks: [block('Easy jog', 1, [steady(m(d), R.rec[0], R.rec[1])])] }),
  }),
  run({
    id: 'run_easy', name: 'Easy run', category: 'endurance', intensity: 'easy', key: false, minMin: 25, maxMin: 90, levels: 1,
    purpose: 'Conversational aerobic running — the bulk of a runner’s week. Builds capillaries, mitochondria and tendon resilience.',
    build: (d) => ({ name: 'Easy run', blocks: [block('Easy', 1, [steady(m(d), R.easy[0], R.easy[1])])] }),
  }),
  run({
    id: 'run_strides', name: 'Easy run + strides', category: 'sprint', intensity: 'easy', key: false, minMin: 30, maxMin: 70, levels: 3,
    purpose: 'Easy run finished with relaxed 20 s strides — keeps leg speed and running economy with almost no fatigue.',
    build: (d, l) => {
      const n = [4, 6, 8][l];
      const blocks = [block('Easy', 1, [steady(m(Math.max(15, d - n * 1.5 - 2)), R.easy[0], R.easy[1])]), block('Strides', n, [steady(20, R.fast[0], R.fast[1], { label: 'stride' }), steady(70, 60, 65)]), block('Cooldown', 1, [steady(m(2), 65, 70)])];
      return { name: `Easy run + ${n} strides`, blocks };
    },
  }),
  run({
    id: 'run_long', name: 'Long run', category: 'endurance', intensity: 'moderate', key: true, minMin: 40, maxMin: 180, levels: 1,
    purpose: 'The cornerstone of endurance running: aerobic durability, fat use and musculoskeletal resilience. Keep it easy; fuel if over 90 min.',
    build: (d) => ({ name: d >= 120 ? 'Long run' : 'Long easy run', blocks: [block('Long run', 1, [steady(m(d), R.easy[0], R.easy[1] + 2)])] }),
  }),
  run({
    id: 'run_long_ff', name: 'Long run, fast finish', category: 'durability', intensity: 'hard', key: true, minMin: 70, maxMin: 165, levels: 3,
    purpose: 'Long run with the last part at marathon/steady pace — race-specific durability for half-marathon and longer.',
    build: (d, l) => {
      const fast = [10, 15, 25][l];
      return { name: `Long run, last ${fast} min steady`, blocks: [block('Long run', 1, [steady(m(d - fast - 3), R.easy[0], R.easy[1])]), block('Fast finish', 1, [steady(m(fast), R.mp[0], R.mp[1])]), block('Cooldown', 1, [steady(m(3), 65, 70)])] };
    },
  }),
  run({
    id: 'run_hills', name: 'Hill repeats', category: 'vo2max', intensity: 'hard', key: true, minMin: 40, maxMin: 70, levels: 4,
    purpose: 'Short uphill efforts with jog-down recovery: strength and power with less impact than flat speed work. Great in base.',
    build: (d, l) => {
      const n = [6, 8, 10, 12][l];
      const blocks = [runWarm(15), block('Hill repeats', n, [steady(60, R.vo2[0], R.vo2[1], { label: 'uphill hard' }), steady(90, 55, 62, { label: 'jog down' })]), runCool(8)];
      return { name: `Hill repeats ${n}×60s`, blocks: padEasy(blocks, d) };
    },
  }),
  run({
    id: 'run_tempo', name: 'Tempo run', category: 'tempo', intensity: 'moderate', key: true, minMin: 40, maxMin: 80, levels: 4,
    purpose: 'Comfortably-hard sustained running (≈ half-marathon effort). Raises the pace you can hold aerobically.',
    build: (d, l) => {
      const [reps, min] = [[2, 10], [2, 15], [3, 12], [2, 20]][l];
      const blocks = [runWarm(12), block('Tempo', reps, [steady(m(min), R.tempo[0], R.tempo[1]), steady(m(3), 68, 75)]), runCool(8)];
      return { name: `Tempo ${reps}×${min} min`, blocks: padEasy(blocks, d) };
    },
  }),
  run({
    id: 'run_threshold', name: 'Threshold intervals', category: 'threshold', intensity: 'hard', key: true, minMin: 45, maxMin: 80, levels: 5,
    purpose: 'Cruise intervals at threshold pace (≈ 1-hour race pace) with short jog recoveries — the most time-efficient way to lift threshold.',
    build: (d, l) => {
      const [reps, min] = [[4, 5], [5, 5], [4, 7], [3, 10], [4, 10]][l];
      const blocks = [runWarm(15), block('Threshold', reps, [steady(m(min), R.thr[0], R.thr[1]), steady(m(min >= 7 ? 2 : 1.5), 65, 72)]), runCool(8)];
      return { name: `Threshold ${reps}×${min} min`, blocks: padEasy(blocks, d) };
    },
  }),
  run({
    id: 'run_vo2', name: 'VO2max intervals', category: 'vo2max', intensity: 'hard', key: true, minMin: 45, maxMin: 75, levels: 5,
    purpose: 'Hard 3-minute repeats at ~3–5 km race pace with equal jog recovery: maximal aerobic power.',
    build: (d, l) => {
      const [reps, min] = [[4, 3], [5, 3], [6, 3], [5, 4], [6, 4]][l];
      const blocks = [runWarm(15), block('VO2max', reps, [steady(m(min), R.vo2[0], R.vo2[1]), steady(m(min * 0.8), 60, 68)]), runCool(8)];
      return { name: `VO2max ${reps}×${min} min`, blocks: padEasy(blocks, d) };
    },
  }),
  run({
    id: 'run_3030', name: '30/30s', category: 'vo2max', intensity: 'hard', key: true, minMin: 40, maxMin: 65, levels: 3,
    purpose: '30 s fast / 30 s float — racks up time near VO2max with less strain than long repeats. A good first VO2 session.',
    build: (d, l) => {
      const [sets, reps] = [[2, 8], [2, 10], [3, 10]][l];
      const blocks: Block[] = [runWarm(15)];
      for (let i = 0; i < sets; i++) blocks.push(block(`Set ${i + 1}`, reps, [steady(30, R.vo2[1], R.vo2[1] + 5), steady(30, 70, 75, { label: 'float' })]), block(undefined, 1, [steady(m(3), 65, 70)]));
      blocks.push(runCool(6));
      return { name: `30/30s ${sets}×${reps}`, blocks: padEasy(blocks, d) };
    },
  }),
  run({
    id: 'run_progression', name: 'Progression run', category: 'tempo', intensity: 'moderate', key: true, minMin: 40, maxMin: 90, levels: 1,
    purpose: 'Start easy and finish at tempo — aerobic work that also teaches pacing and finishing strong.',
    build: (d) => ({ name: 'Progression run', blocks: [block('Easy', 1, [steady(m(d * 0.5), R.easy[0], R.easy[1])]), block('Steady', 1, [steady(m(d * 0.3), R.steady[0], R.steady[1])]), block('Tempo', 1, [steady(m(d * 0.2), R.tempo[0], R.tempo[1])])] }),
  }),
  run({
    id: 'run_fartlek', name: 'Fartlek', category: 'vo2max', intensity: 'hard', key: true, minMin: 40, maxMin: 70, levels: 3,
    purpose: 'Unstructured speed play: alternating 1–3 min surges with easy running. Builds speed without the track.',
    build: (d, l) => {
      const n = [5, 7, 9][l];
      const blocks = [runWarm(12), block('Fartlek', n, [steady(m(2), R.thr[1], R.vo2[0] + 2, { label: 'surge' }), steady(m(2), R.easy[0], R.easy[1])]), runCool(8)];
      return { name: `Fartlek ${n}×2 min`, blocks: padEasy(blocks, d) };
    },
  }),
  run({
    id: 'run_racepace', name: 'Race-pace run', category: 'race_sim', intensity: 'hard', key: true, minMin: 45, maxMin: 100, levels: 3,
    purpose: 'Blocks at goal race pace (10 km → half marathon) to make race rhythm feel familiar. Specific/peak phase.',
    build: (d, l) => {
      const [reps, min] = [[3, 8], [3, 12], [2, 20]][l];
      const blocks = [runWarm(15), block('Race pace', reps, [steady(m(min), R.tempo[1], R.thr[0]), steady(m(3), 65, 72)]), runCool(8)];
      return { name: `Race pace ${reps}×${min} min`, blocks: padEasy(blocks, d) };
    },
  }),
  run({
    id: 'run_brick', name: 'Brick run (off the bike)', category: 'race_sim', intensity: 'moderate', key: false, minMin: 10, maxMin: 40, levels: 1,
    purpose: 'Short run straight after a ride: trains running on tired legs and the bike-to-run transition. Start controlled, settle into race effort.',
    build: (d) => ({ name: `Brick run ${d} min`, blocks: [block('Off the bike', 1, [steady(m(Math.min(5, d / 3)), R.easy[1], R.steady[0])]), block('Race effort', 1, [steady(m(d - Math.min(5, d / 3)), R.steady[1], R.tempo[1])])] }),
  }),
  run({
    id: 'run_openers', name: 'Pre-race shakeout', category: 'openers', intensity: 'easy', key: false, minMin: 20, maxMin: 35, levels: 1,
    purpose: 'Day-before-race shakeout: easy jog with a few strides to feel sharp.',
    build: (d) => ({ name: 'Shakeout + strides', blocks: [block('Easy', 1, [steady(m(d - 4), R.easy[0], R.easy[1])]), block('Strides', 4, [steady(20, R.fast[0], R.fast[0] + 5), steady(40, 60, 65)])] }),
  }),
];

// Swimming bands (% CSS speed)
const S = { easy: [75, 85], aero: [85, 92], css: [98, 102], thr: [95, 99], fast: [108, 115] } as const;
const swimWarm = (min = 8): Block => block('Warmup', 1, [steady(m(min), S.easy[0], S.easy[1], { label: 'easy free + drills' })]);
const swimCool = (min = 4): Block => block('Cooldown', 1, [steady(m(min), 70, 80, { label: 'easy' })]);
function padSwim(blocks: Block[], d: number): Block[] {
  const left = d * 60 - secs(blocks);
  if (left >= 120) blocks.splice(blocks.length - 1, 0, block('Aerobic', 1, [steady(left, S.aero[0], S.aero[1], { label: 'pull or swim' })]));
  return blocks;
}

export const SWIM_WORKOUTS: WorkoutTemplate[] = [
  swim({
    id: 'swim_technique', name: 'Technique swim', category: 'recovery', intensity: 'easy', key: false, minMin: 25, maxMin: 60, levels: 1,
    purpose: 'Drills and easy swimming — for most triathletes technique is the biggest lever on swim speed.',
    build: (d) => ({ name: 'Technique & drills', blocks: [swimWarm(6), block('Drills', 6, [steady(m(1.5), 70, 80, { label: 'drill (catch-up / fingertip drag / 6-kick)' }), steady(30, 50, 50, { label: 'rest' })]), block('Easy', 1, [steady(m(Math.max(5, d - 6 - 12 - 4)), S.easy[0], S.easy[1])]), swimCool(4)] }),
  }),
  swim({
    id: 'swim_endurance', name: 'Aerobic endurance swim', category: 'endurance', intensity: 'easy', key: false, minMin: 30, maxMin: 75, levels: 2,
    purpose: 'Steady aerobic sets just below CSS with short rests — builds swim-specific endurance.',
    build: (d, l) => {
      const reps = [4, 6][l];
      return { name: `Aerobic ${reps}×4 min`, blocks: padSwim([swimWarm(8), block('Aerobic', reps, [steady(m(4), S.aero[0], S.aero[1]), steady(20, 50, 50, { label: 'rest' })]), swimCool(4)], d) };
    },
  }),
  swim({
    id: 'swim_css', name: 'CSS intervals', category: 'threshold', intensity: 'hard', key: true, minMin: 35, maxMin: 70, levels: 4,
    purpose: 'Repeats at CSS (≈ 1500 m race pace) with 10–20 s rest — the key triathlon swim session for threshold.',
    build: (d, l) => {
      const reps = [6, 8, 10, 12][l];
      return { name: `CSS ${reps}×~100 m`, blocks: padSwim([swimWarm(10), block('CSS', reps, [steady(100, S.css[0], S.css[1], { label: '~100 m @ CSS' }), steady(15, 50, 50, { label: 'rest' })]), swimCool(5)], d) };
    },
  }),
  swim({
    id: 'swim_threshold', name: 'Threshold swim', category: 'tempo', intensity: 'moderate', key: true, minMin: 40, maxMin: 75, levels: 3,
    purpose: 'Longer repeats a touch slower than CSS — sustained race effort for 1.5–3.8 km swims.',
    build: (d, l) => {
      const reps = [3, 4, 5][l];
      return { name: `Threshold ${reps}×~400 m`, blocks: padSwim([swimWarm(10), block('Threshold', reps, [steady(m(6), S.thr[0], S.thr[1], { label: '~400 m' }), steady(30, 50, 50, { label: 'rest' })]), swimCool(5)], d) };
    },
  }),
  swim({
    id: 'swim_speed', name: 'Speed swim', category: 'vo2max', intensity: 'hard', key: true, minMin: 30, maxMin: 55, levels: 2,
    purpose: 'Fast 50s with full rest: stroke rate and the punch for race starts and buoy sprints.',
    build: (d, l) => {
      const reps = [8, 12][l];
      return { name: `Speed ${reps}×~50 m`, blocks: padSwim([swimWarm(10), block('Fast', reps, [steady(45, S.fast[0], S.fast[1], { label: '~50 m fast' }), steady(30, 50, 50, { label: 'rest' })]), swimCool(5)], d) };
    },
  }),
  swim({
    id: 'swim_openwater', name: 'Open-water / continuous swim', category: 'race_sim', intensity: 'moderate', key: false, minMin: 30, maxMin: 80, levels: 1,
    purpose: 'Continuous swim at race effort, practising sighting every 6–9 strokes. Open water (with a buddy) when you can.',
    build: (d) => ({ name: 'Continuous swim', blocks: [swimWarm(6), block('Continuous', 1, [steady(m(d - 10), S.aero[1], S.thr[0], { label: 'sight every 6-9 strokes' })]), swimCool(4)] }),
  }),
];

export const RUN_SWIM_WORKOUTS = [...RUN_WORKOUTS, ...SWIM_WORKOUTS];

/** "4:35 /km" from a threshold speed and a % of it. */
export function paceLabel(pct: number, thresholdMps: number | null | undefined, sport: Sport): string | null {
  if (!thresholdMps || pct <= 55) return null;
  const v = (thresholdMps * pct) / 100;
  const per = sport === 'swim' ? 100 / v : 1000 / v;
  const mm = Math.floor(per / 60);
  const ss = Math.round(per % 60);
  return `${mm}:${String(ss === 60 ? 59 : ss).padStart(2, '0')}${sport === 'swim' ? '/100m' : '/km'}`;
}

/** Parse "4:30" (min:sec per km or per 100 m) to a speed in m/s. */
export function parsePace(s: string, sport: Sport): number | null {
  const m2 = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m2) return null;
  const sec = Number(m2[1]) * 60 + Number(m2[2]);
  if (!sec) return null;
  return (sport === 'swim' ? 100 : 1000) / sec;
}

export function formatPace(mps: number | null | undefined, sport: Sport): string {
  if (!mps) return '';
  const per = (sport === 'swim' ? 100 : 1000) / mps;
  return `${Math.floor(per / 60)}:${String(Math.round(per % 60)).padStart(2, '0')}`;
}
