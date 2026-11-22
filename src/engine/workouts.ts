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
    const core = (l: number) => 25 + progs[l] * 12 + (progs[l] - 1) * 5;
    const l = fitLevel(d, level, core);
    const n = progs[l];
    const main = sets(n, 6, steady(s(110), 90, 95), steady(s(10), 140, 160, { label: 'surge', cadence: '100+rpm' }), 5);
    return { name: `Threshold + Surges ${n}×12min`, blocks: assemble(d, main) };
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
