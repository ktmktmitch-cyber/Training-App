// Cycling workout library. Each template can be scaled to the available time and has
// progression "levels" (more time-in-zone as a block progresses). Targets are % of FTP.
import type { Block, Intensity, Step, WorkoutCategory } from './types';

export interface BuildResult {
  name: string;
  blocks: Block[];
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  category: WorkoutCategory;
  intensity: Intensity;
  key: boolean;
  minMin: number;
  maxMin: number;
  levels: number;
  purpose: string;
  science?: string;
  tags?: string[]; // 'indoor', 'outdoor', 'classic', 'evidence', 'climbing', 'race', 'test'
  /** level is 0-based, already clamped. */
  build(durationMin: number, level: number): BuildResult;
}

// ---------- step helpers ----------
const m = (min: number) => Math.round(min * 60);
const s = (sec: number) => sec;

export const steady = (sec: number, low: number, high = low, extra: Partial<Step> = {}): Step => ({
  durationSec: sec,
  low,
  high,
  ...extra,
});
export const ramp = (sec: number, from: number, to: number, extra: Partial<Step> = {}): Step => ({
  durationSec: sec,
  low: from,
  high: to,
  ramp: true,
  ...extra,
});
const block = (name: string | undefined, reps: number, steps: Step[]): Block => ({ name, reps, steps });

export function blockSeconds(b: Block): number {
  return b.reps * b.steps.reduce((a, st) => a + st.durationSec, 0);
}
export function totalSeconds(blocks: Block[]): number {
  return blocks.reduce((a, b) => a + blockSeconds(b), 0);
}

function warmup(min = 15, primers = false): Block {
  const steps: Step[] = [ramp(m(Math.max(5, min - (primers ? 6 : 3))), 50, 72, { cadence: '85-95rpm' })];
  if (primers) {
    steps.push(steady(s(60), 95, 100, { label: 'primer' }), steady(s(60), 55), steady(s(60), 105, 110, { label: 'primer' }), steady(m(3), 55));
  } else {
    steps.push(steady(m(3), 72, 78));
  }
  return block('Warmup', 1, steps);
}

function cooldown(min = 10): Block {
  return block('Cooldown', 1, [steady(m(min), 45, 55, { cadence: '85-95rpm' })]);
}

function endurance(min: number, label = 'Endurance'): Block {
  return block(label, 1, [steady(m(min), 62, 72)]);
}

function recoveryBetween(min: number): Block {
  return block(undefined, 1, [steady(m(min), 50, 55)]);
}

/** Interval sets: `sets` blocks of `reps` × [work, rest], with `between` minutes easy between sets. */
function sets(
  count: number,
  reps: number,
  work: Step,
  rest: Step | null,
  betweenMin: number,
  name = 'Main set',
): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < count; i++) {
    out.push(block(count > 1 ? `${name} ${i + 1}` : name, reps, rest ? [work, rest] : [work]));
    if (i < count - 1 && betweenMin > 0) out.push(recoveryBetween(betweenMin));
  }
  return out;
}

/**
 * Wrap a main set with warmup/cooldown and pad with endurance to fill the requested
 * duration (endurance is inserted after the main set — common "extend with Z2" practice).
 */
function assemble(durationMin: number, main: Block[], opts: { wu?: number; cd?: number; primers?: boolean } = {}): Block[] {
  const wu = warmup(opts.wu ?? 15, opts.primers);
  const cd = cooldown(opts.cd ?? 10);
  const core = [wu, ...main, cd];
  const padMin = durationMin - totalSeconds(core) / 60;
  if (padMin >= 10) return [wu, ...main, endurance(Math.round(padMin / 5) * 5, 'Endurance extension'), cd];
  return core;
}

/** Pick the highest level ≤ `level` whose core fits in `durationMin`. */
function fitLevel(durationMin: number, level: number, coreMinutes: (lvl: number) => number): number {
  for (let l = level; l > 0; l--) if (coreMinutes(l) <= durationMin + 1) return l;
  return 0;
}

// Interval progressions: [reps, workMinutes, restMinutes]
type Prog = [number, number, number][];

function intervalTemplate(cfg: {
  id: string;
  name: string;
  category: WorkoutCategory;
  intensity: Intensity;
  key?: boolean;
  low: number;
  high: number;
  prog: Prog;
  purpose: string;
  science?: string;
  cadence?: string;
  primers?: boolean;
  minMin?: number;
  maxMin?: number;
  label?: (r: number, w: number) => string;
}): WorkoutTemplate {
  const core = (l: number) => {
    const [r, w, rest] = cfg.prog[l];
    return 15 + 10 + r * (w + rest);
  };
  return {
    id: cfg.id,
    name: cfg.name,
    category: cfg.category,
    intensity: cfg.intensity,
    key: cfg.key ?? true,
    minMin: cfg.minMin ?? Math.ceil(core(0) / 5) * 5,
    maxMin: cfg.maxMin ?? 180,
    levels: cfg.prog.length,
    purpose: cfg.purpose,
    science: cfg.science,
    build(durationMin, level) {
      const l = fitLevel(durationMin, level, core);
      const [r, w, rest] = cfg.prog[l];
      const main: Block[] = [
        block('Main set', r, [
          steady(m(w), cfg.low, cfg.high, { cadence: cfg.cadence }),
          ...(rest > 0 ? [steady(m(rest), 50, 55)] : []),
        ]),
      ];
      return {
        name: cfg.label ? cfg.label(r, w) : `${cfg.name} ${r}×${w}`,
        blocks: assemble(durationMin, main, { primers: cfg.primers }),
      };
    },
  };
}

// ---------- the library ----------

const recovery: WorkoutTemplate = {
  id: 'recovery',
  name: 'Recovery Spin',
  category: 'recovery',
  intensity: 'easy',
  key: false,
  minMin: 30,
  maxMin: 75,
  levels: 1,
  purpose: 'Promote blood flow and recovery without adding meaningful fatigue. Very easy, high cadence, conversational.',
  build(d) {
    return { name: 'Recovery Spin', blocks: [block('Easy spin', 1, [steady(m(d), 45, 55, { cadence: '90-100rpm' })])] };
  },
};

const enduranceZ2: WorkoutTemplate = {
  id: 'endurance',
  name: 'Endurance',
  category: 'endurance',
  intensity: 'easy',
  key: false,
  minMin: 45,
  maxMin: 420,
  levels: 1,
  purpose:
    'Low-intensity aerobic work (below the first lactate/ventilatory threshold). Builds mitochondrial density, fat oxidation, capillarization and durability with little recovery cost.',
  science: 'The large majority of elite endurance training time is spent below LT1 regardless of intensity-distribution model.',
  build(d) {
    const name = d >= 150 ? 'Long Endurance' : 'Endurance';
    return {
      name,
      blocks: [
        block('Warmup', 1, [ramp(m(5), 50, 65)]),
        endurance(Math.max(10, d - 10)),
        block('Cooldown', 1, [steady(m(5), 50, 55)]),
      ],
    };
  },
};

const enduranceSprints: WorkoutTemplate = {
  id: 'end_sprints',
  name: 'Endurance + Sprints',
  category: 'endurance',
  intensity: 'easy',
  key: false,
  minMin: 60,
  maxMin: 240,
  levels: 2,
  purpose:
    'Zone 2 ride with short, maximal neuromuscular sprints and full recovery. Keeps top-end power and pedaling skill during base with minimal fatigue.',
  build(d, level) {
    const reps = level >= 1 ? 8 : 6;
    const sprintBlock = block('Sprints', reps, [steady(s(12), 150, 200, { label: 'max sprint', cadence: '100-120rpm' }), steady(m(3), 55, 65)]);
    const sprintMin = totalSeconds([sprintBlock]) / 60;
    const rest = Math.max(10, d - 10 - sprintMin);
    return {
      name: `Endurance + ${reps} Sprints`,
      blocks: [
        block('Warmup', 1, [ramp(m(10), 50, 70)]),
        endurance(Math.round(rest * 0.4)),
        sprintBlock,
        endurance(Math.round(rest * 0.6)),
      ],
    };
  },
};

const enduranceCadence: WorkoutTemplate = {
  id: 'end_cadence',
  name: 'Endurance + Cadence Drills',
  category: 'endurance',
  intensity: 'easy',
  key: false,
  minMin: 50,
  maxMin: 180,
  levels: 1,
  purpose: 'Zone 2 with high-cadence spin-ups to improve pedaling efficiency and neuromuscular coordination.',
  build(d) {
    const drills = block('Spin-ups', 6, [steady(m(1), 62, 70, { cadence: '110-120rpm', label: 'high cadence' }), steady(m(2), 60, 68)]);
    const rest = Math.max(10, d - 10 - 18);
    return {
      name: 'Endurance + Cadence Drills',
      blocks: [block('Warmup', 1, [ramp(m(10), 50, 70)]), drills, endurance(rest)],
    };
  },
};

const tempo = intervalTemplate({
  id: 'tempo',
  name: 'Tempo',
  category: 'tempo',
  intensity: 'moderate',
  low: 80,
  high: 87,
  prog: [
    [2, 15, 5],
    [2, 20, 5],
    [3, 15, 5],
    [3, 20, 5],
    [2, 30, 5],
    [2, 40, 5],
  ],
  purpose: 'Sustained Zone 3. Aerobic strength and muscular endurance; a staple of pyramidal base training and long-event prep.',
  cadence: '80-95rpm',
});

const sweetspot = intervalTemplate({
  id: 'sweetspot',
  name: 'Sweet Spot',
  category: 'sweetspot',
  intensity: 'moderate',
  low: 88,
  high: 93,
  prog: [
    [2, 10, 5],
    [2, 12, 5],
    [3, 10, 4],
    [3, 12, 4],
    [4, 10, 4],
    [2, 20, 5],
    [3, 15, 5],
    [3, 20, 5],
    [2, 30, 6],
  ],
  purpose: 'High-aerobic work just below threshold — a lot of training stimulus per hour with manageable fatigue. Ideal for time-crunched riders.',
  science: 'For athletes with limited weekly hours, more time at moderate-high intensity is an effective way to raise FTP.',
});

const threshold = intervalTemplate({
  id: 'threshold',
  name: 'Threshold',
  category: 'threshold',
  intensity: 'hard',
  low: 95,
  high: 100,
  prog: [
    [3, 8, 4],
    [3, 10, 5],
    [4, 8, 4],
    [3, 12, 5],
    [4, 10, 5],
    [2, 20, 6],
    [3, 15, 5],
    [2, 25, 6],
    [3, 20, 6],
  ],
  purpose: 'Intervals at ~FTP to raise the power you can sustain for 30-60 min and extend time-to-exhaustion at threshold.',
});

const overUnder: WorkoutTemplate = {
  id: 'over_under',
  name: 'Over-Unders',
  category: 'threshold',
  intensity: 'hard',
  key: true,
  minMin: 60,
  maxMin: 150,
  levels: 4,
  purpose:
    'Alternating just-below and just-above threshold. Trains lactate clearance while working and the ability to handle surges at race pace.',
  build(d, level) {
    const progs: [number, number][] = [
      [3, 3],
      [3, 4],
      [4, 4],
      [3, 5],
    ]; // [sets, rounds of (2' under + 1' over)]
    const core = (l: number) => 25 + progs[l][0] * progs[l][1] * 3 + (progs[l][0] - 1) * 5;
    const l = fitLevel(d, level, core);
    const [n, rounds] = progs[l];
    const main = sets(n, rounds, steady(m(2), 92, 95, { label: 'under' }), steady(m(1), 105, 110, { label: 'over' }), 5);
    return { name: `Over-Unders ${n}×${rounds * 3}min`, blocks: assemble(d, main) };
  },
};

const thresholdSurges: WorkoutTemplate = {
  id: 'thr_surges',
  name: 'Threshold with Surges',
  category: 'race_sim',
  intensity: 'hard',
  key: true,
  minMin: 65,
  maxMin: 150,
  levels: 3,
  purpose: 'Threshold blocks punctuated by short surges every 2 min — mimics attacks, corners and short climbs in road racing.',
  build(d, level) {
    const progs = [2, 3, 4];
    const core = (l: number) => 25 + progs[l] * 13 + (progs[l] - 1) * 5;
    const l = fitLevel(d, level, core);
    const n = progs[l];
    const main = sets(n, 6, steady(s(120), 92, 97), steady(s(10), 140, 160, { label: 'surge', cadence: '100+rpm' }), 5);
    return { name: `Threshold + Surges ${n}×13min`, blocks: assemble(d, main) };
  },
};

const vo2Long = intervalTemplate({
  id: 'vo2_long',
  name: 'VO2max',
  category: 'vo2max',
  intensity: 'hard',
  low: 110,
  high: 118,
  prog: [
    [4, 3, 3],
    [5, 3, 3],
    [4, 4, 3],
    [5, 4, 3],
    [6, 4, 3],
    [5, 5, 3],
  ],
  purpose: 'Classic 3-5 min VO2max intervals. Maximizes time near VO2max to lift your aerobic ceiling.',
  science: 'Accumulating time above ~90% VO2max is considered the key stimulus for raising VO2max in trained cyclists.',
  primers: true,
});

const vo2Seiler = intervalTemplate({
  id: 'vo2_4x8',
  name: 'Seiler 4×8',
  category: 'vo2max',
  intensity: 'hard',
  low: 103,
  high: 110,
  prog: [
    [3, 8, 2],
    [4, 8, 2],
    [5, 8, 2],
  ],
  purpose: 'Longer intervals at the highest pace you can hold evenly for all reps — a polarized-training staple.',
  science: 'Seiler et al. (2013): 4×8 min outperformed 4×4 and 4×16 min in recreational cyclists over 7 weeks.',
  primers: true,
  label: (r) => `Seiler ${r}×8min`,
});

const vo2ThirtyFifteen: WorkoutTemplate = {
  id: 'vo2_3015',
  name: '30/15 Intervals',
  category: 'vo2max',
  intensity: 'hard',
  key: true,
  minMin: 60,
  maxMin: 150,
  levels: 5,
  purpose: 'Rønnestad-style 30 s on / 15 s off. Short recoveries keep VO2 high while letting you hold more power than continuous intervals.',
  science: 'Rønnestad et al. (2015, 2020): effort-matched 30/15 sets produced larger gains than 5-min intervals in well-trained and elite cyclists.',
  build(d, level) {
    const progs: [number, number][] = [
      [2, 10],
      [3, 10],
      [3, 11],
      [3, 13],
      [3, 15],
    ];
    const core = (l: number) => 25 + (progs[l][0] * progs[l][1] * 45) / 60 + (progs[l][0] - 1) * 3;
    const l = fitLevel(d, level, core);
    const [n, reps] = progs[l];
    const main = sets(n, reps, steady(s(30), 118, 128, { cadence: '95-105rpm' }), steady(s(15), 50, 50), 3);
    return { name: `30/15s ${n}×${reps}`, blocks: assemble(d, main, { primers: true }) };
  },
};

const vo2FortyTwenty: WorkoutTemplate = {
  id: 'vo2_4020',
  name: '40/20 Intervals',
  category: 'vo2max',
  intensity: 'hard',
  key: true,
  minMin: 60,
  maxMin: 150,
  levels: 3,
  purpose: '40 s hard / 20 s easy micro-intervals. High VO2 demand with an anaerobic flavour — great for punchy racing.',
  build(d, level) {
    const progs: [number, number][] = [
      [2, 8],
      [3, 8],
      [3, 10],
    ];
    const core = (l: number) => 25 + progs[l][0] * progs[l][1] + (progs[l][0] - 1) * 5;
    const l = fitLevel(d, level, core);
    const [n, reps] = progs[l];
    const main = sets(n, reps, steady(s(40), 120, 130), steady(s(20), 50, 50), 5);
    return { name: `40/20s ${n}×${reps}`, blocks: assemble(d, main, { primers: true }) };
  },
};

const vo2FastStart: WorkoutTemplate = {
  id: 'vo2_faststart',
  name: 'Fast-Start VO2',
  category: 'vo2max',
  intensity: 'hard',
  key: true,
  minMin: 60,
  maxMin: 150,
  levels: 3,
  purpose: 'Each interval opens with a hard 1-min surge, then settles at VO2 power — VO2 rises faster, so more of each rep is spent near max.',
  science: 'Front-loaded ("fast-start") intervals increase time near VO2max for similar work compared with even pacing.',
  build(d, level) {
    const progs = [4, 5, 6];
    const core = (l: number) => 25 + progs[l] * 5 + (progs[l] - 1) * 3;
    const l = fitLevel(d, level, core);
    const n = progs[l];
    const main: Block[] = [
      block('Main set', n, [steady(m(1), 125, 135, { label: 'fast start' }), steady(m(3), 105, 110), steady(m(3), 50, 55)]),
    ];
    return { name: `Fast-Start VO2 ${n}×4min`, blocks: assemble(d, main, { primers: true }) };
  },
};

const anaerobic: WorkoutTemplate = {
  id: 'anaerobic',
  name: 'Anaerobic 1-min Repeats',
  category: 'anaerobic',
  intensity: 'hard',
  key: true,
  minMin: 55,
  maxMin: 120,
  levels: 4,
  purpose: 'Hard 1-minute efforts to build anaerobic capacity (W′) and tolerance for the decisive moves in crits, CX and XC.',
  build(d, level) {
    const progs: [number, number][] = [
      [1, 6],
      [1, 8],
      [2, 5],
      [2, 6],
    ];
    const core = (l: number) => 25 + progs[l][0] * progs[l][1] * 3 + (progs[l][0] - 1) * 6;
    const l = fitLevel(d, level, core);
    const [n, reps] = progs[l];
    const main = sets(n, reps, steady(m(1), 130, 150), steady(m(2), 50, 55), 6);
    return { name: `Anaerobic ${n > 1 ? `${n}×` : ''}${reps}×1min`, blocks: assemble(d, main, { primers: true }) };
  },
};

const sprints: WorkoutTemplate = {
  id: 'sprints',
  name: 'Sprint Power',
  category: 'sprint',
  intensity: 'moderate',
  key: false,
  minMin: 50,
  maxMin: 120,
  levels: 2,
  purpose: 'Maximal 10-15 s sprints with full recovery. Develops peak power and race-finishing speed; low metabolic cost, high neural demand.',
  build(d, level) {
    const reps = level >= 1 ? 10 : 8;
    const main = [block('Sprints', reps, [steady(s(12), 150, 200, { label: 'max sprint' }), steady(m(4), 55, 60)])];
    return { name: `Sprint Power ${reps}×12s`, blocks: assemble(d, main, { primers: true }) };
  },
};

const critSim: WorkoutTemplate = {
  id: 'crit_sim',
  name: 'Crit Simulation',
  category: 'race_sim',
  intensity: 'hard',
  key: true,
  minMin: 60,
  maxMin: 120,
  levels: 3,
  purpose: 'Repeated hard accelerations out of corners on top of a high tempo — exactly what criteriums demand.',
  build(d, level) {
    const progs = [2, 3, 4];
    const core = (l: number) => 25 + progs[l] * 10 + (progs[l] - 1) * 5;
    const l = fitLevel(d, level, core);
    const n = progs[l];
    const main = sets(n, 10, steady(s(45), 85, 90), steady(s(15), 150, 170, { label: 'jump', cadence: '100+rpm' }), 5);
    return { name: `Crit Sim ${n}×10min`, blocks: assemble(d, main, { primers: true }) };
  },
};

const climbSim = intervalTemplate({
  id: 'climb_sim',
  name: 'Climbing Threshold',
  category: 'race_sim',
  intensity: 'hard',
  low: 95,
  high: 100,
  prog: [
    [3, 12, 5],
    [2, 20, 6],
    [3, 15, 5],
    [2, 25, 6],
    [3, 20, 6],
  ],
  cadence: '65-75rpm',
  purpose: 'Long threshold efforts at climbing cadence (ideally on a real climb or with the front wheel raised indoors).',
  label: (r, w) => `Climbing Threshold ${r}×${w}min`,
});

const ttSim = intervalTemplate({
  id: 'tt_sim',
  name: 'TT Efforts',
  category: 'race_sim',
  intensity: 'hard',
  low: 96,
  high: 102,
  prog: [
    [3, 10, 4],
    [2, 20, 5],
    [3, 15, 5],
    [1, 40, 0],
    [2, 25, 5],
  ],
  cadence: '90-100rpm',
  purpose: 'Race-pace efforts in your TT/aero position to make the position sustainable at threshold power.',
  label: (r, w) => `TT Efforts ${r}×${w}min (aero)`,
});

const gravelSim: WorkoutTemplate = {
  id: 'gravel_sim',
  name: 'Gravel Race Sim',
  category: 'race_sim',
  intensity: 'hard',
  key: true,
  minMin: 120,
  maxMin: 360,
  levels: 3,
  purpose: 'Long ride with repeated 2-min surges (climbs, sectors, gaps) and a closing tempo block — prepares for the stochastic demands of gravel.',
  build(d, level) {
    const surges = [6, 8, 10][level];
    const surgeBlock = block('Surges', surges, [steady(m(2), 110, 120), steady(m(6), 65, 72)]);
    const surgeMin = totalSeconds([surgeBlock]) / 60;
    const tempoBlock = block('Closing tempo', 1, [steady(m(20), 80, 87)]);
    const rest = Math.max(15, d - 15 - surgeMin - 20 - 10);
    return {
      name: `Gravel Sim ${surges}×2min + 20min tempo`,
      blocks: [warmup(15), endurance(Math.round(rest * 0.4)), surgeBlock, endurance(Math.round(rest * 0.6)), tempoBlock, cooldown(10)],
    };
  },
};

const durability: WorkoutTemplate = {
  id: 'durability',
  name: 'Durability Ride',
  category: 'durability',
  intensity: 'hard',
  key: true,
  minMin: 150,
  maxMin: 420,
  levels: 4,
  purpose:
    'Long Zone 2 ride with quality efforts in the final hour. Trains "durability" — holding power after hours of work — which separates riders late in long events.',
  science: 'Maunder et al. (2021) and later studies highlight durability (power/physiology after prolonged work) as a distinct performance determinant.',
  build(d, level) {
    const progs: [number, number, number, number][] = [
      [2, 10, 88, 93],
      [3, 10, 90, 95],
      [2, 15, 93, 98],
      [3, 12, 95, 100],
    ];
    const [r, w, lo, hi] = progs[level];
    const late = block('Late efforts', r, [steady(m(w), lo, hi), steady(m(5), 55, 60)]);
    const lateMin = totalSeconds([late]) / 60;
    const z2 = Math.max(60, d - lateMin - 10 - 10);
    return {
      name: `Durability ${fmtH(d)} + ${r}×${w}min late`,
      blocks: [block('Warmup', 1, [ramp(m(10), 50, 68)]), endurance(z2), late, cooldown(10)],
    };
  },
};

const openers: WorkoutTemplate = {
  id: 'openers',
  name: 'Race Openers',
  category: 'openers',
  intensity: 'easy',
  key: false,
  minMin: 40,
  maxMin: 75,
  levels: 1,
  purpose: 'Day-before-race primer: a few short efforts to wake the legs up without creating fatigue.',
  build(d) {
    const main = [
      block('Openers', 3, [steady(m(1), 105, 115), steady(m(2), 55)]),
      block('Sprints', 3, [steady(s(10), 150, 180, { label: 'snappy, not max' }), steady(m(2), 55)]),
    ];
    return { name: 'Race Openers', blocks: assemble(d, main, { wu: 12, cd: 8 }) };
  },
};

const ftpTest: WorkoutTemplate = {
  id: 'ftp_test',
  name: 'FTP Test (20 min)',
  category: 'test',
  intensity: 'hard',
  key: true,
  minMin: 60,
  maxMin: 75,
  levels: 1,
  purpose: 'Classic 20-min test (FTP ≈ 95% of 20-min power). Optional — intervals.icu already estimates eFTP from your rides.',
  build(d) {
    const main = [
      block('Primers', 3, [steady(m(1), 100, 105), steady(m(1), 50)]),
      recoveryBetween(5),
      block('Test', 1, [steady(m(20), 100, 108, { label: 'best sustainable effort' })]),
    ];
    return { name: 'FTP Test (20 min)', blocks: assemble(d, main, { wu: 15, cd: 10 }) };
  },
};

function fmtH(min: number) {
  const h = Math.floor(min / 60);
  const r = Math.round(min % 60);
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`;
}


// ---------- extended library ----------

/** Generic builder for custom main sets: progs = list of level definitions → main blocks. */
function custom(cfg: {
  id: string;
  name: string;
  category: WorkoutCategory;
  intensity: Intensity;
  key?: boolean;
  purpose: string;
  science?: string;
  tags?: string[];
  maxMin?: number;
  primers?: boolean;
  wu?: number;
  cd?: number;
  levels: { label: string; main: () => Block[] }[];
}): WorkoutTemplate {
  const coreMin = (l: number) => (cfg.wu ?? 15) + (cfg.cd ?? 10) + totalSeconds(cfg.levels[l].main()) / 60;
  return {
    id: cfg.id,
    name: cfg.name,
    category: cfg.category,
    intensity: cfg.intensity,
    key: cfg.key ?? true,
    minMin: Math.ceil(coreMin(0) / 5) * 5,
    maxMin: cfg.maxMin ?? 180,
    levels: cfg.levels.length,
    purpose: cfg.purpose,
    science: cfg.science,
    tags: cfg.tags,
    build(d, level) {
      const l = fitLevel(d, level, coreMin);
      return { name: `${cfg.name} ${cfg.levels[l].label}`.trim(), blocks: assemble(d, cfg.levels[l].main(), { primers: cfg.primers, wu: cfg.wu, cd: cfg.cd }) };
    },
  };
}

/** Long aerobic ride with a quality block embedded late (or mid) in the ride. */
function longWith(cfg: {
  id: string;
  name: string;
  category: WorkoutCategory;
  intensity: Intensity;
  key?: boolean;
  purpose: string;
  science?: string;
  tags?: string[];
  minMin: number;
  where: 'middle' | 'end';
  levels: { label: string; main: () => Block[] }[];
}): WorkoutTemplate {
  return {
    id: cfg.id,
    name: cfg.name,
    category: cfg.category,
    intensity: cfg.intensity,
    key: cfg.key ?? true,
    minMin: cfg.minMin,
    maxMin: 420,
    levels: cfg.levels.length,
    purpose: cfg.purpose,
    science: cfg.science,
    tags: cfg.tags,
    build(d, level) {
      let l = level;
      while (l > 0 && totalSeconds(cfg.levels[l].main()) / 60 + 30 > d) l--;
      const main = cfg.levels[l].main();
      const z2 = Math.max(15, d - 10 - 10 - totalSeconds(main) / 60);
      const blocks =
        cfg.where === 'end'
          ? [block('Warmup', 1, [ramp(m(10), 50, 68)]), endurance(Math.round(z2)), ...main, cooldown(10)]
          : [block('Warmup', 1, [ramp(m(10), 50, 68)]), endurance(Math.round(z2 / 2)), ...main, endurance(Math.round(z2 / 2)), cooldown(10)];
      return { name: `${cfg.name} ${cfg.levels[l].label}`.trim(), blocks };
    },
  };
}

const rep = (n: number, steps: Step[], name = 'Main set') => block(name, n, steps);
const rec = (min: number) => recoveryBetween(min);

const enduranceTempo = longWith({
  id: 'end_tempo',
  name: 'Endurance + Tempo',
  category: 'tempo',
  intensity: 'moderate',
  key: false,
  minMin: 75,
  where: 'middle',
  purpose: 'A Zone 2 ride with tempo blocks in the middle — aerobic strength without the cost of a full interval day. A pyramidal-base favourite.',
  tags: ['outdoor', 'classic'],
  levels: [
    { label: '2×10', main: () => sets(2, 1, steady(m(10), 78, 85), null, 5, 'Tempo') },
    { label: '3×10', main: () => sets(3, 1, steady(m(10), 78, 85), null, 5, 'Tempo') },
    { label: '2×20', main: () => sets(2, 1, steady(m(20), 78, 85), null, 5, 'Tempo') },
    { label: '3×20', main: () => sets(3, 1, steady(m(20), 78, 85), null, 5, 'Tempo') },
  ],
});

const torque = custom({
  id: 'torque',
  name: 'Low-Cadence Torque',
  category: 'tempo',
  intensity: 'moderate',
  purpose: 'Big-gear, low-cadence tempo efforts for muscular endurance and climbing specificity. Research shows similar gains to normal-cadence work, so use it for variety and race specificity.',
  tags: ['climbing'],
  levels: [
    { label: '4×5', main: () => [rep(4, [steady(m(5), 80, 88, { cadence: '55-65rpm' }), steady(m(3), 55)])] },
    { label: '5×6', main: () => [rep(5, [steady(m(6), 80, 88, { cadence: '55-65rpm' }), steady(m(3), 55)])] },
    { label: '4×8', main: () => [rep(4, [steady(m(8), 82, 90, { cadence: '55-65rpm' }), steady(m(4), 55)])] },
    { label: '5×8', main: () => [rep(5, [steady(m(8), 82, 90, { cadence: '55-65rpm' }), steady(m(4), 55)])] },
  ],
});

const z2ThresholdFinish = longWith({
  id: 'z2_finish',
  name: 'Endurance + Threshold Finish',
  category: 'durability',
  intensity: 'hard',
  minMin: 90,
  where: 'end',
  purpose: 'Steady Zone 2, then a sustained threshold effort to finish — practise producing power when already tired.',
  tags: ['outdoor'],
  levels: [
    { label: '1×10', main: () => [block('Finish', 1, [steady(m(10), 93, 98)])] },
    { label: '1×15', main: () => [block('Finish', 1, [steady(m(15), 93, 98)])] },
    { label: '1×20', main: () => [block('Finish', 1, [steady(m(20), 93, 98)])] },
  ],
});

const tempoBursts = custom({
  id: 'tempo_bursts',
  name: 'Tempo with Bursts',
  category: 'tempo',
  intensity: 'moderate',
  purpose: 'Tempo blocks with a short surge every 3 minutes — builds the ability to respond to accelerations and settle straight back into rhythm.',
  tags: ['race'],
  levels: [
    { label: '2×13', main: () => sets(2, 4, steady(s(180), 80, 85), steady(s(10), 140, 160, { label: 'burst' }), 5) },
    { label: '3×13', main: () => sets(3, 4, steady(s(180), 80, 85), steady(s(10), 140, 160, { label: 'burst' }), 5) },
    { label: '3×16', main: () => sets(3, 5, steady(s(180), 80, 85), steady(s(10), 140, 160, { label: 'burst' }), 5) },
  ],
});

const tempoLong = custom({
  id: 'tempo_long',
  name: 'Steady Tempo',
  category: 'tempo',
  intensity: 'moderate',
  purpose: 'One long, continuous tempo effort — the backbone of gran fondo, gravel and ultra preparation.',
  tags: ['classic'],
  levels: [40, 50, 60, 75].map((x) => ({ label: `1×${x}`, main: () => [block('Tempo', 1, [steady(m(x), 78, 86)])] })),
});

const ssBursts = custom({
  id: 'ss_bursts',
  name: 'Sweet Spot with Surges',
  category: 'sweetspot',
  intensity: 'moderate',
  purpose: 'Sweet spot with a 15-second surge every 3 minutes — race-like variability on top of a big aerobic stimulus.',
  tags: ['race', 'indoor'],
  levels: [
    { label: '2×13', main: () => sets(2, 4, steady(s(180), 88, 92), steady(s(15), 125, 135, { label: 'surge' }), 5) },
    { label: '3×13', main: () => sets(3, 4, steady(s(180), 88, 92), steady(s(15), 125, 135, { label: 'surge' }), 5) },
    { label: '3×16', main: () => sets(3, 5, steady(s(180), 88, 92), steady(s(15), 125, 135, { label: 'surge' }), 5) },
  ],
});

const ssLadder = custom({
  id: 'ss_ladder',
  name: 'Sweet Spot Ladder',
  category: 'sweetspot',
  intensity: 'moderate',
  purpose: 'Each set climbs from low to high sweet spot in 5-minute steps, finishing near threshold — teaches pacing and builds fatigue resistance.',
  levels: [
    { label: '2×15', main: () => sets(2, 1, steady(m(5), 86, 88), null, 5).flatMap((b) => (b.name?.startsWith('Main') ? [block(b.name, 1, [steady(m(5), 86, 88), steady(m(5), 89, 91), steady(m(5), 92, 94)])] : [b])) },
    { label: '2×20', main: () => sets(2, 1, steady(m(5), 86, 88), null, 5).flatMap((b) => (b.name?.startsWith('Main') ? [block(b.name, 1, [steady(m(5), 86, 88), steady(m(5), 89, 91), steady(m(5), 92, 94), steady(m(5), 95, 97)])] : [b])) },
    { label: '3×20', main: () => sets(3, 1, steady(m(5), 86, 88), null, 5).flatMap((b) => (b.name?.startsWith('Main') ? [block(b.name, 1, [steady(m(5), 86, 88), steady(m(5), 89, 91), steady(m(5), 92, 94), steady(m(5), 95, 97)])] : [b])) },
  ],
});

const thrSteady = custom({
  id: 'thr_steady',
  name: 'Steady Threshold',
  category: 'threshold',
  intensity: 'hard',
  purpose: 'One continuous effort at FTP, extended over weeks — builds time-to-exhaustion at threshold, which matters as much as FTP itself in long races.',
  tags: ['classic'],
  levels: [20, 25, 30, 35, 40, 45].map((x) => ({ label: `1×${x}`, main: () => [block('Threshold', 1, [steady(m(x), 95, 100)])] })),
});

const ladderSet = (mins: number[], lo: number, hi: number, restMin: number): Block[] =>
  mins.flatMap((x, i) => [block(i === 0 ? 'Ladder' : undefined, 1, [steady(m(x), lo, hi)]), ...(i < mins.length - 1 ? [rec(restMin)] : [])]);

const thrLadder = custom({
  id: 'thr_ladder',
  name: 'Threshold Ladder',
  category: 'threshold',
  intensity: 'hard',
  purpose: 'Up-and-down ladder of threshold efforts — varied durations keep it mentally manageable while accumulating lots of time at FTP.',
  levels: [
    { label: '4-6-8-6-4', main: () => ladderSet([4, 6, 8, 6, 4], 97, 102, 3) },
    { label: '5-8-10-8-5', main: () => ladderSet([5, 8, 10, 8, 5], 97, 102, 3) },
    { label: '6-10-12-10-6', main: () => ladderSet([6, 10, 12, 10, 6], 97, 102, 4) },
  ],
});

const thrFloats = custom({
  id: 'thr_floats',
  name: 'Threshold Floats',
  category: 'threshold',
  intensity: 'hard',
  purpose: 'Threshold efforts that "float" at high tempo instead of fully recovering — trains lactate clearance at race intensity.',
  science: 'Keeping recoveries at high tempo maintains high blood lactate turnover, a common coaching method for raising sustainable power.',
  levels: [
    { label: '2×12', main: () => sets(2, 3, steady(m(3), 100, 103), steady(m(1), 85, 88, { label: 'float' }), 5) },
    { label: '3×12', main: () => sets(3, 3, steady(m(3), 100, 103), steady(m(1), 85, 88, { label: 'float' }), 5) },
    { label: '3×16', main: () => sets(3, 4, steady(m(3), 100, 103), steady(m(1), 85, 88, { label: 'float' }), 5) },
  ],
});

const climbRepeats = custom({
  id: 'climb_repeats',
  name: 'Climb Repeats',
  category: 'race_sim',
  intensity: 'hard',
  purpose: 'Repeated 5-6 minute climbs at threshold+, alternating seated low cadence and standing — ideally on a real hill, otherwise front wheel raised.',
  tags: ['climbing', 'outdoor'],
  levels: [
    { label: '5×5', main: () => [rep(5, [steady(m(5), 100, 105, { cadence: '65-80rpm' }), steady(m(4), 50, 55)])] },
    { label: '6×5', main: () => [rep(6, [steady(m(5), 100, 105, { cadence: '65-80rpm' }), steady(m(4), 50, 55)])] },
    { label: '6×6', main: () => [rep(6, [steady(m(6), 100, 105, { cadence: '65-80rpm' }), steady(m(4), 50, 55)])] },
    { label: '8×5', main: () => [rep(8, [steady(m(5), 100, 105, { cadence: '65-80rpm' }), steady(m(4), 50, 55)])] },
  ],
});

const vo2Norwegian = custom({
  id: 'vo2_4x4',
  name: 'Norwegian Intervals',
  category: 'vo2max',
  intensity: 'hard',
  primers: true,
  purpose: 'The classic 4 × 4 min at ~90-95% of max heart rate with 3 min active recovery.',
  science: 'Helgerud et al. (2007): 4×4 min intervals raised VO2max more than long slow distance or threshold training at matched work.',
  tags: ['classic', 'evidence'],
  levels: [
    { label: '3×4', main: () => [rep(3, [steady(m(4), 108, 115), steady(m(3), 50, 60)])] },
    { label: '4×4', main: () => [rep(4, [steady(m(4), 108, 115), steady(m(3), 50, 60)])] },
    { label: '5×4', main: () => [rep(5, [steady(m(4), 108, 115), steady(m(3), 50, 60)])] },
  ],
});

const vo2Billat = custom({
  id: 'vo2_3030',
  name: 'Billat 30/30',
  category: 'vo2max',
  intensity: 'hard',
  primers: true,
  purpose: '30 s hard / 30 s easy. Accumulates lots of time near VO2max with lower perceived effort than long intervals.',
  science: 'Billat’s 30-30 intermittent runs kept athletes at VO2max for longer than continuous running at the same speed.',
  tags: ['evidence', 'indoor'],
  levels: [
    { label: '2×8', main: () => sets(2, 8, steady(s(30), 115, 125), steady(s(30), 50, 50), 4) },
    { label: '2×10', main: () => sets(2, 10, steady(s(30), 115, 125), steady(s(30), 50, 50), 4) },
    { label: '3×10', main: () => sets(3, 10, steady(s(30), 115, 125), steady(s(30), 50, 50), 4) },
    { label: '3×12', main: () => sets(3, 12, steady(s(30), 115, 125), steady(s(30), 50, 50), 4) },
  ],
});

const pyramidSet = (mins: number[], lo: number, hi: number): Block[] =>
  mins.flatMap((x, i) => [block(i === 0 ? 'Pyramid' : undefined, 1, [steady(m(x), lo, hi), ...(i < mins.length - 1 ? [steady(m(x), 50, 55)] : [])])]);

const vo2Pyramid = custom({
  id: 'vo2_pyramid',
  name: 'VO2 Pyramid',
  category: 'vo2max',
  intensity: 'hard',
  primers: true,
  purpose: '1-2-3-4-3-2-1 minute efforts with equal recovery. Builds VO2max with built-in variety and pacing practice.',
  levels: [
    { label: '1-2-3-2-1', main: () => pyramidSet([1, 2, 3, 2, 1], 110, 120) },
    { label: '1-2-3-4-3-2-1', main: () => pyramidSet([1, 2, 3, 4, 3, 2, 1], 110, 120) },
    { label: '2-3-4-4-3-2', main: () => pyramidSet([2, 3, 4, 4, 3, 2], 110, 118) },
  ],
});

const microbursts = custom({
  id: 'vo2_microburst',
  name: 'Microbursts 15/15',
  category: 'vo2max',
  intensity: 'hard',
  primers: true,
  purpose: '15 s very hard / 15 s easy in 8-10 minute blocks. Trains repeated accelerations (crits, CX, MTB) while keeping VO2 high.',
  tags: ['race', 'indoor'],
  levels: [
    { label: '2×8min', main: () => sets(2, 16, steady(s(15), 140, 150), steady(s(15), 50, 50), 5) },
    { label: '3×8min', main: () => sets(3, 16, steady(s(15), 140, 150), steady(s(15), 50, 50), 5) },
    { label: '3×10min', main: () => sets(3, 20, steady(s(15), 140, 150), steady(s(15), 50, 50), 5) },
  ],
});

const anaerobic2 = custom({
  id: 'anaerobic_2min',
  name: '2-Minute Repeats',
  category: 'anaerobic',
  intensity: 'hard',
  primers: true,
  purpose: 'Hard 2-minute efforts — the blend of VO2max and anaerobic capacity used for bridging gaps and short climbs.',
  levels: [
    { label: '5×2', main: () => [rep(5, [steady(m(2), 115, 122), steady(m(3), 50, 55)])] },
    { label: '6×2', main: () => [rep(6, [steady(m(2), 115, 122), steady(m(3), 50, 55)])] },
    { label: '8×2', main: () => [rep(8, [steady(m(2), 115, 122), steady(m(3), 50, 55)])] },
  ],
});

const tabata = custom({
  id: 'tabata',
  name: 'Tabata 20/10',
  category: 'anaerobic',
  intensity: 'hard',
  primers: true,
  purpose: '8 × 20 s all-out / 10 s easy per set. Brutal but short anaerobic-capacity stimulus. Use sparingly, mainly for crit/CX/MTB.',
  science: 'Tabata et al. (1996) showed gains in both anaerobic capacity and VO2max from this protocol in trained subjects.',
  tags: ['evidence', 'indoor'],
  levels: [
    { label: '2 sets', main: () => sets(2, 8, steady(s(20), 160, 175), steady(s(10), 40, 45), 6) },
    { label: '3 sets', main: () => sets(3, 8, steady(s(20), 160, 175), steady(s(10), 40, 45), 6) },
  ],
});

const attacks = custom({
  id: 'attacks',
  name: 'Attack & Recover',
  category: 'race_sim',
  intensity: 'hard',
  purpose: 'Repeated 30-second attacks from a tempo base, each followed by recovering while still riding firmly — just like racing in a group.',
  tags: ['race'],
  levels: [6, 8, 10].map((n) => ({ label: `${n} attacks`, main: () => [rep(n, [steady(s(30), 140, 160, { label: 'attack' }), steady(m(3), 80, 88)])] })),
});

const standingStarts = custom({
  id: 'standing_starts',
  name: 'Standing Starts',
  category: 'sprint',
  intensity: 'moderate',
  key: false,
  primers: true,
  purpose: 'Maximal 15-second efforts from almost stopped in a big gear — peak torque and acceleration out of corners and starts.',
  tags: ['outdoor', 'race'],
  levels: [6, 8].map((n) => ({ label: `${n}×15s`, main: () => [rep(n, [steady(s(15), 160, 220, { label: 'max from slow', cadence: '40-110rpm' }), steady(m(5), 50, 55)])] })),
});

const leadoutSprints = custom({
  id: 'leadout_sprints',
  name: 'Lead-out Sprints',
  category: 'sprint',
  intensity: 'moderate',
  key: false,
  primers: true,
  purpose: '30 s at high speed into a 12 s full sprint — race-finish simulation: sprinting when already above threshold.',
  tags: ['race'],
  levels: [5, 6, 8].map((n) => ({ label: `${n}×`, main: () => [rep(n, [steady(s(30), 115, 125, { label: 'lead-out' }), steady(s(12), 160, 220, { label: 'sprint' }), steady(m(5), 50, 55)])] })),
});

const breakaway = custom({
  id: 'breakaway',
  name: 'Breakaway Simulation',
  category: 'race_sim',
  intensity: 'hard',
  purpose: 'A hard 2-minute attack to get clear, then hold just under threshold to stay away. Specific for road racing.',
  tags: ['race'],
  levels: [
    { label: '2×14', main: () => sets(2, 1, steady(m(2), 118, 125, { label: 'attack' }), null, 6).map((b) => (b.name?.startsWith('Main') ? block(b.name, 1, [steady(m(2), 118, 125, { label: 'attack' }), steady(m(12), 90, 95)]) : b)) },
    { label: '3×14', main: () => sets(3, 1, steady(m(2), 118, 125), null, 6).map((b) => (b.name?.startsWith('Main') ? block(b.name, 1, [steady(m(2), 118, 125, { label: 'attack' }), steady(m(12), 90, 95)]) : b)) },
  ],
});

const xcStart = custom({
  id: 'xc_start',
  name: 'XC / CX Start Simulation',
  category: 'race_sim',
  intensity: 'hard',
  primers: true,
  purpose: 'Full-gas start to win position, then settle at threshold — the defining demand of mountain-bike and cyclocross racing.',
  tags: ['race'],
  levels: [3, 4].map((n) => ({ label: `${n}×`, main: () => [rep(n, [steady(s(90), 130, 150, { label: 'start' }), steady(m(8), 95, 100), steady(m(5), 50, 55)])] })),
});

const roadRaceSim = longWith({
  id: 'road_race_sim',
  name: 'Road Race Simulation',
  category: 'race_sim',
  intensity: 'hard',
  minMin: 120,
  where: 'end',
  purpose: 'A long ride that ends like a road race: climbs, attacks, a hard tempo pull and a sprint — after hours in the legs.',
  tags: ['race', 'outdoor'],
  levels: [
    { label: '', main: () => [rep(3, [steady(m(3), 108, 115, { label: 'climb' }), steady(m(4), 60, 70)], 'Race finale'), rep(4, [steady(s(30), 140, 160, { label: 'attack' }), steady(s(90), 75, 85)]), block(undefined, 1, [steady(m(10), 92, 97), steady(m(2), 60), steady(s(15), 160, 220, { label: 'sprint' })])] },
    { label: '(long)', main: () => [rep(4, [steady(m(4), 108, 115, { label: 'climb' }), steady(m(4), 60, 70)], 'Race finale'), rep(6, [steady(s(30), 140, 160, { label: 'attack' }), steady(s(90), 75, 85)]), block(undefined, 1, [steady(m(15), 92, 97), steady(m(2), 60), steady(s(15), 160, 220, { label: 'sprint' })])] },
  ],
});

const hillclimbTT = custom({
  id: 'hillclimb_tt',
  name: 'Hill-Climb TT Pacing',
  category: 'race_sim',
  intensity: 'hard',
  wu: 20,
  purpose: 'A single race-pace climb effort after a proper warm-up — rehearse pacing (start controlled, finish hard) for hill climbs and climbing TTs.',
  tags: ['climbing'],
  levels: [15, 20, 30].map((x) => ({ label: `1×${x}`, main: () => [block('Primers', 2, [steady(m(1), 105, 110), steady(m(2), 55)]), block('Race effort', 1, [steady(m(Math.round(x * 0.7)), 98, 102), steady(m(Math.round(x * 0.3)), 102, 108, { label: 'empty the tank' })])] })),
});

const durabilityVo2 = longWith({
  id: 'durability_vo2',
  name: 'Durability: Fatigued VO2',
  category: 'durability',
  intensity: 'hard',
  minMin: 150,
  where: 'end',
  purpose: 'VO2max intervals after 2+ hours of riding — trains the late-race capacity that decides long events.',
  science: 'High-intensity work after prolonged exercise targets "durability", now recognised as a separate performance determinant.',
  levels: [
    { label: '3×4', main: () => [rep(3, [steady(m(4), 106, 112), steady(m(4), 55)], 'Late VO2')] },
    { label: '4×4', main: () => [rep(4, [steady(m(4), 106, 112), steady(m(4), 55)], 'Late VO2')] },
  ],
});

const rampSteps = (): Block[] => [block('Ramp (go until you can’t hold it)', 1, Array.from({ length: 18 }, (_, i) => steady(m(1), 50 + i * 6, 50 + i * 6)))];
const rampTest = custom({
  id: 'ramp_test',
  name: 'Ramp Test',
  category: 'test',
  intensity: 'hard',
  wu: 10,
  cd: 10,
  purpose: '1-minute steps rising ~6% FTP each until failure. FTP ≈ 75% of your best 1-minute power. Quick and repeatable, but favours riders with big anaerobic power.',
  tags: ['test', 'indoor'],
  levels: [{ label: '', main: rampSteps }],
});

const test8 = custom({
  id: 'test_8min',
  name: '8-Minute Test',
  category: 'test',
  intensity: 'hard',
  wu: 20,
  purpose: 'Two 8-minute maximal efforts with 10 minutes recovery. FTP ≈ 90% of the average of the two.',
  tags: ['test'],
  levels: [{ label: '(2×8)', main: () => [block('Test', 2, [steady(m(8), 105, 115, { label: 'best sustainable' }), steady(m(10), 50, 55)])] }],
});

const testCp = custom({
  id: 'test_cp',
  name: 'Critical Power Test (3 + 12)',
  category: 'test',
  intensity: 'hard',
  wu: 20,
  maxMin: 120,
  purpose: 'A 3-minute and a 12-minute all-out effort, 30 min apart. Gives critical power and W′ — the model intervals.icu uses for eFTP.',
  tags: ['test'],
  levels: [{ label: '', main: () => [block('3-min max', 1, [steady(m(3), 120, 130)]), rec(30), block('12-min max', 1, [steady(m(12), 100, 106)])] }],
});

const sprintTest = custom({
  id: 'sprint_test',
  name: 'Sprint Test',
  category: 'test',
  intensity: 'moderate',
  key: false,
  primers: true,
  purpose: 'Three all-out 15-second sprints with full recovery to capture peak power (Pmax).',
  tags: ['test'],
  levels: [{ label: '', main: () => [rep(3, [steady(s(15), 180, 250, { label: 'all-out sprint' }), steady(m(5), 50, 55)])] }],
});

const recoveryDrills: WorkoutTemplate = {
  id: 'recovery_drills',
  name: 'Recovery + Pedalling Drills',
  category: 'recovery',
  intensity: 'easy',
  key: false,
  minMin: 30,
  maxMin: 75,
  levels: 1,
  purpose: 'Very easy spin with single-leg and high-cadence drills for a smoother, more efficient pedal stroke. Best indoors.',
  tags: ['indoor'],
  build(d) {
    const drills = block('Drills', 4, [steady(s(30), 45, 55, { label: 'left leg only' }), steady(s(30), 45, 55, { label: 'right leg only' }), steady(m(2), 45, 55, { cadence: '100-110rpm' })]);
    return { name: 'Recovery + Drills', blocks: [block('Easy', 1, [steady(m(Math.max(5, d - 22) / 2), 45, 55)]), drills, block('Easy', 1, [steady(m(Math.max(5, d - 22) / 2), 45, 55)])] };
  },
};

const raceWarmup: WorkoutTemplate = {
  id: 'race_warmup',
  name: 'Race-Day Warm-up',
  category: 'openers',
  intensity: 'easy',
  key: false,
  minMin: 25,
  maxMin: 40,
  levels: 1,
  purpose: 'Pre-race warm-up for short, fast events (crit, TT, CX, hill climb): progressive build, race-pace primer and a couple of snappy sprints, done 10-15 min before the start.',
  tags: ['race'],
  build() {
    return {
      name: 'Race-Day Warm-up',
      blocks: [
        block('Build', 1, [ramp(m(10), 50, 80)]),
        block('Primers', 3, [steady(m(1), 105, 110), steady(m(1), 55)]),
        block(undefined, 1, [steady(m(3), 95, 100, { label: 'race pace' }), steady(m(3), 55)]),
        block('Sprints', 2, [steady(s(10), 150, 180), steady(m(2), 50)]),
      ],
    };
  },
};

const BASE_TAGS: Record<string, string[]> = {
  endurance: ['classic', 'evidence'],
  end_sprints: ['outdoor'],
  end_cadence: ['indoor'],
  tempo: ['classic'],
  sweetspot: ['classic', 'indoor'],
  threshold: ['classic'],
  over_under: ['classic', 'race'],
  thr_surges: ['race'],
  vo2_long: ['classic', 'evidence'],
  vo2_4x8: ['evidence'],
  vo2_3015: ['evidence', 'indoor'],
  vo2_4020: ['race', 'indoor'],
  vo2_faststart: ['evidence'],
  anaerobic: ['race'],
  sprints: ['outdoor', 'race'],
  crit_sim: ['race'],
  climb_sim: ['climbing'],
  tt_sim: ['race'],
  gravel_sim: ['race', 'outdoor'],
  durability: ['evidence', 'outdoor'],
  openers: ['race'],
  ftp_test: ['test'],
};
for (const t of [recovery, enduranceZ2, enduranceSprints, enduranceCadence, tempo, sweetspot, threshold, overUnder, thresholdSurges, vo2Long, vo2Seiler, vo2ThirtyFifteen, vo2FortyTwenty, vo2FastStart, anaerobic, sprints, critSim, climbSim, ttSim, gravelSim, durability, openers, ftpTest])
  t.tags ??= BASE_TAGS[t.id];

export const WORKOUTS: WorkoutTemplate[] = [
  recovery,
  enduranceZ2,
  enduranceSprints,
  enduranceCadence,
  tempo,
  sweetspot,
  threshold,
  overUnder,
  thresholdSurges,
  vo2Long,
  vo2Seiler,
  vo2ThirtyFifteen,
  vo2FortyTwenty,
  vo2FastStart,
  anaerobic,
  sprints,
  critSim,
  climbSim,
  ttSim,
  gravelSim,
  durability,
  openers,
  ftpTest,
  enduranceTempo,
  torque,
  z2ThresholdFinish,
  tempoBursts,
  tempoLong,
  ssBursts,
  ssLadder,
  thrSteady,
  thrLadder,
  thrFloats,
  climbRepeats,
  vo2Norwegian,
  vo2Billat,
  vo2Pyramid,
  microbursts,
  anaerobic2,
  tabata,
  attacks,
  standingStarts,
  leadoutSprints,
  breakaway,
  xcStart,
  roadRaceSim,
  hillclimbTT,
  durabilityVo2,
  rampTest,
  test8,
  testCp,
  sprintTest,
  recoveryDrills,
  raceWarmup,
];

export const WORKOUT_BY_ID: Record<string, WorkoutTemplate> = Object.fromEntries(WORKOUTS.map((w) => [w.id, w]));

export function getTemplate(id: string): WorkoutTemplate {
  const t = WORKOUT_BY_ID[id];
  if (!t) throw new Error(`Unknown workout ${id}`);
  return t;
}

// ---------- load maths ----------

/** Mean of IF² over a step (exact for linear ramps). */
function stepIf2(st: Step): number {
  const a = st.low / 100;
  const b = st.high / 100;
  if (st.ramp) return (a * a + a * b + b * b) / 3;
  const mid = (a + b) / 2;
  return mid * mid;
}

export function blocksLoad(blocks: Block[]): { tss: number; ifactor: number; seconds: number } {
  let secs = 0;
  let weighted = 0;
  for (const b of blocks)
    for (let r = 0; r < b.reps; r++)
      for (const st of b.steps) {
        secs += st.durationSec;
        weighted += st.durationSec * stepIf2(st);
      }
  if (secs === 0) return { tss: 0, ifactor: 0, seconds: 0 };
  const ifactor = Math.sqrt(weighted / secs);
  const tss = (secs / 3600) * ifactor * ifactor * 100;
  return { tss: Math.round(tss), ifactor: Math.round(ifactor * 100) / 100, seconds: secs };
}

export function tssFromIf(durationMin: number, ifactor: number): number {
  return Math.round((durationMin / 60) * ifactor * ifactor * 100);
}

export const GROUP_IF: Record<string, number> = { social: 0.68, tempo: 0.78, hard: 0.86, race: 0.92 };
