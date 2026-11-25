// Workout review: how well a ride matched the planned workout.
//
//  * Planned vs actual for duration, TSS, intensity factor and normalized power.
//  * Lap by lap: the ride's laps (Garmin/Wahoo record one per workout step) are matched to the planned
//    steps by duration, merging laps where needed. Without usable laps the power stream is sliced by
//    the planned step durations instead. Each step is checked against its target range (±3 % FTP).
//  * One score 0-100: mostly how well the work steps hit their targets (weighted by duration), plus how
//    close duration, TSS and IF came to the plan.
import type { Block } from './types';
import { blocksLoad } from './workouts';

export interface PlanStep {
  n: number;
  label: string;
  secs: number;
  low: number; // % FTP
  high: number;
  ramp: boolean;
  open: boolean; // no power target
  work: boolean;
}

export interface LapLike {
  start: number;
  secs: number;
  avgW: number | null;
  np: number | null;
  hr: number | null;
  cadence: number | null;
}

export type StepStatus = 'on' | 'over' | 'under' | 'short' | 'missed' | 'open';

export interface StepResult {
  step: PlanStep;
  actual: LapLike | null;
  pct: number | null; // actual average power as % FTP
  status: StepStatus;
  score: number;
}

export interface Metric {
  key: 'duration' | 'tss' | 'if' | 'np';
  label: string;
  planned: number | null;
  actual: number | null;
  diffPct: number | null;
}

export interface Review {
  score: number;
  label: string;
  tone: 'good' | 'ok' | 'warn' | 'bad';
  metrics: Metric[];
  steps: StepResult[];
  source: 'laps' | 'stream' | 'none';
  notes: string[];
}

/** Planned blocks → a flat list of steps (repeats expanded). */
export function flattenBlocks(blocks: Block[]): PlanStep[] {
  const out: PlanStep[] = [];
  for (const b of blocks)
    for (let r = 0; r < b.reps; r++)
      for (const s of b.steps) {
        const open = s.low <= 0 && s.high <= 0;
        const mid = (s.low + s.high) / 2;
        out.push({
          n: out.length + 1,
          label:
            s.label ??
            (b.reps > 1 ? (mid >= 76 || b.steps.length === 1 ? `${b.name ?? 'Interval'} ${r + 1}/${b.reps}` : 'Recovery') : b.name) ??
            (mid >= 76 ? 'Work' : mid >= 56 ? 'Steady' : 'Easy'),
          secs: s.durationSec,
          low: Math.min(s.low, s.high),
          high: Math.max(s.low, s.high),
          ramp: !!s.ramp,
          open,
          work: !open && mid >= 76,
        });
      }
  return out;
}

function mergeLaps(laps: LapLike[]): LapLike {
  const secs = laps.reduce((a, l) => a + l.secs, 0) || 1;
  const wavg = (f: (l: LapLike) => number | null) => {
    const v = laps.filter((l) => f(l) != null && l.secs > 0);
    const s = v.reduce((a, l) => a + l.secs, 0);
    return s ? v.reduce((a, l) => a + (f(l) as number) * l.secs, 0) / s : null;
  };
  const np4 = wavg((l) => (l.np ?? l.avgW) != null ? (l.np ?? l.avgW)! ** 4 : null);
  return { start: laps[0].start, secs, avgW: wavg((l) => l.avgW), np: np4 != null ? np4 ** 0.25 : null, hr: wavg((l) => l.hr), cadence: wavg((l) => l.cadence) };
}

/** Match laps to planned steps (each step gets one or more consecutive laps). Null when laps don't fit. */
export function alignLaps(steps: PlanStep[], lapsIn: LapLike[], ftp: number): (LapLike | null)[] | null {
  // fold blips (< 20 s, e.g. a lap button double-press) into the previous lap
  const laps: LapLike[] = [];
  for (const l of lapsIn) {
    if (l.secs < 20 && laps.length) laps[laps.length - 1] = mergeLaps([laps[laps.length - 1], l]);
    else if (l.secs > 0) laps.push(l);
  }
  const n = steps.length;
  const m = laps.length;
  if (!n || m < Math.max(2, Math.ceil(n * 0.6))) return null;
  const cost = (st: PlanStep, group: LapLike[]) => {
    const g = mergeLaps(group);
    let c = Math.abs(g.secs - st.secs) / Math.max(60, st.secs);
    if (!st.open && g.avgW != null) c += Math.abs((g.avgW / ftp) * 100 - (st.low + st.high) / 2) / 60;
    return c;
  };
  const INF = 1e9;
  // dp[i][j]: best cost matching the first i steps to the first j laps; a step may also be skipped (missed)
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(INF));
  const from = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(-1));
  dp[0][0] = 0;
  for (let i = 1; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      // missed step (no laps)
      if (dp[i - 1][j] + 1.5 < dp[i][j]) {
        dp[i][j] = dp[i - 1][j] + 1.5;
        from[i][j] = j;
      }
      for (let k = Math.max(0, j - 6); k < j; k++) {
        if (dp[i - 1][k] >= INF) continue;
        const c = dp[i - 1][k] + cost(steps[i - 1], laps.slice(k, j)) + (j - k - 1) * 0.15;
        if (c < dp[i][j]) {
          dp[i][j] = c;
          from[i][j] = k;
        }
      }
    }
  // extra laps after the workout (riding on) are allowed with a small penalty
  let bestJ = 0;
  for (let j = 0; j <= m; j++) if (dp[n][j] + (m - j) * 0.1 < dp[n][bestJ] + (m - bestJ) * 0.1) bestJ = j;
  if (dp[n][bestJ] >= INF) return null;
  const out: (LapLike | null)[] = new Array(n).fill(null);
  let j = bestJ;
  for (let i = n; i >= 1; i--) {
    const k = from[i][j];
    out[i - 1] = k < j ? mergeLaps(laps.slice(k, j)) : null;
    j = k;
  }
  return out;
}

/** Slice second-by-second data by the planned step durations (from the start of the ride). */
export function sliceStream(steps: PlanStep[], s: { time: number[]; watts: number[]; hr: number[]; cadence: number[] }): (LapLike | null)[] {
  const out: (LapLike | null)[] = [];
  let t0 = 0;
  const idxAt = (t: number) => {
    let lo = 0;
    let hi = s.time.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s.time[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  for (const st of steps) {
    const a = idxAt(t0);
    const b = idxAt(t0 + st.secs);
    t0 += st.secs;
    if (b - a < 10) {
      out.push(null);
      continue;
    }
    const w = s.watts.slice(a, b);
    const avg = (x: number[]) => (x.length ? x.reduce((p, q) => p + q, 0) / x.length : null);
    // 30-s rolling NP
    let np: number | null = null;
    if (w.length >= 30) {
      const roll: number[] = [];
      let sum = 0;
      for (let i = 0; i < w.length; i++) {
        sum += w[i];
        if (i >= 30) sum -= w[i - 30];
        if (i >= 29) roll.push(sum / 30);
      }
      np = (roll.reduce((p, q) => p + q ** 4, 0) / roll.length) ** 0.25;
    }
    out.push({ start: s.time[a], secs: s.time[b - 1] - s.time[a] + 1, avgW: s.watts.length ? avg(w) : null, np, hr: s.hr.length ? avg(s.hr.slice(a, b)) : null, cadence: s.cadence.length ? avg(s.cadence.slice(a, b).filter((c) => c > 0)) : null });
  }
  return out;
}

const TOL = 3; // % FTP either side of the target range

export function judgeStep(step: PlanStep, actual: LapLike | null, ftp: number): StepResult {
  if (!actual) return { step, actual, pct: null, status: 'missed', score: 0 };
  const pct = actual.avgW != null && ftp ? (actual.avgW / ftp) * 100 : null;
  if (step.open || pct == null) return { step, actual, pct, status: 'open', score: 100 };
  const lo = step.low - TOL;
  const hi = step.high + TOL + (step.work ? 0 : 10); // easy steps: a bit harder is fine
  // easier than planned on a recovery / easy step is fine
  const under = step.work && pct < lo;
  const dev = under ? lo - pct : pct > hi ? pct - hi : 0;
  let score = Math.max(0, 100 - dev * 6);
  let status: StepStatus = under ? 'under' : pct > hi ? 'over' : 'on';
  const done = actual.secs / step.secs;
  if (done < 0.85) {
    score *= Math.max(0, done);
    if (status === 'on') status = 'short';
  }
  return { step, actual, pct, status, score: Math.round(score) };
}

const pctDiff = (a: number | null, p: number | null) => (a != null && p ? (a - p) / p : null);
const closeness = (d: number | null, k: number) => (d == null ? null : Math.max(0, 100 - Math.abs(d) * 100 * k));

export function reviewWorkout(input: {
  planned: { secs: number | null; tss: number | null; blocks: Block[] | null };
  actual: { secs: number; tss: number | null; ifactor: number | null; np: number | null };
  ftp: number;
  matched: (LapLike | null)[] | null;
  source: 'laps' | 'stream' | 'none';
}): Review {
  const { planned, actual, ftp } = input;
  const load = planned.blocks?.length ? blocksLoad(planned.blocks) : null;
  const pSecs = load?.seconds ?? planned.secs;
  const pTss = planned.tss ?? load?.tss ?? null;
  const pIf = load?.ifactor ?? (pTss && pSecs ? Math.sqrt(pTss / ((pSecs / 3600) * 100)) : null);
  const metrics: Metric[] = [
    { key: 'duration', label: 'Duration', planned: pSecs, actual: actual.secs, diffPct: pctDiff(actual.secs, pSecs) },
    { key: 'tss', label: 'TSS', planned: pTss, actual: actual.tss, diffPct: pctDiff(actual.tss, pTss) },
    { key: 'if', label: 'Intensity (IF)', planned: pIf != null ? Math.round(pIf * 100) / 100 : null, actual: actual.ifactor, diffPct: pctDiff(actual.ifactor, pIf) },
    { key: 'np', label: 'Normalized power', planned: pIf != null ? Math.round(pIf * ftp) : null, actual: actual.np != null ? Math.round(actual.np) : null, diffPct: pctDiff(actual.np, pIf != null ? pIf * ftp : null) },
  ];

  const steps = planned.blocks?.length && input.matched ? flattenBlocks(planned.blocks).map((s, i) => judgeStep(s, input.matched![i] ?? null, ftp)) : [];
  const weighted = steps.filter((r) => r.status !== 'open');
  const wsum = weighted.reduce((a, r) => a + r.step.secs * (r.step.work ? 1 : 0.3), 0);
  const stepScore = wsum ? weighted.reduce((a, r) => a + r.score * r.step.secs * (r.step.work ? 1 : 0.3), 0) / wsum : null;

  const dur = closeness(metrics[0].diffPct, 2);
  const tss = closeness(metrics[1].diffPct, 2);
  const ifs = closeness(metrics[2].diffPct, 4);
  const parts: [number | null, number][] = stepScore != null ? [[stepScore, 0.55], [dur, 0.15], [tss, 0.15], [ifs, 0.15]] : [[dur, 0.35], [tss, 0.35], [ifs, 0.3]];
  const have = parts.filter(([v]) => v != null) as [number, number][];
  const wt = have.reduce((a, [, w]) => a + w, 0);
  const score = wt ? Math.round(have.reduce((a, [v, w]) => a + v * w, 0) / wt) : 0;

  const notes: string[] = [];
  const work = steps.filter((r) => r.step.work && r.pct != null);
  if (work.length) {
    const target = work.reduce((a, r) => a + ((r.step.low + r.step.high) / 2) * r.step.secs, 0) / work.reduce((a, r) => a + r.step.secs, 0);
    const did = work.reduce((a, r) => a + (r.pct as number) * r.step.secs, 0) / work.reduce((a, r) => a + r.step.secs, 0);
    const on = work.filter((r) => r.status === 'on').length;
    notes.push(`Work intervals averaged ${Math.round((did / target) * 100)}% of target — ${on} of ${work.length} on target.`);
  }
  const missed = steps.filter((r) => r.status === 'missed' && r.step.work).length;
  if (missed) notes.push(`${missed} work interval${missed === 1 ? '' : 's'} not found in the ride.`);
  const d = metrics[0].diffPct;
  if (d != null && d < -0.1) notes.push(`${Math.round(-d * 100)}% shorter than planned.`);
  if (d != null && d > 0.15) notes.push(`${Math.round(d * 100)}% longer than planned.`);
  const i = metrics[2];
  if (i.diffPct != null && Math.abs(i.diffPct) >= 0.05) notes.push(`${i.diffPct > 0 ? 'Harder' : 'Easier'} than planned overall (IF ${i.actual?.toFixed(2)} vs ${i.planned?.toFixed(2)}).`);
  if (!planned.blocks?.length) notes.push('No structured steps for this workout, so it’s scored on duration, TSS and intensity only.');
  else if (input.source === 'none') notes.push('No lap or power data to compare step by step.');

  const [label, tone]: [string, Review['tone']] = score >= 90 ? ['Nailed it', 'good'] : score >= 75 ? ['Good', 'ok'] : score >= 60 ? ['Partly', 'warn'] : ['Off target', 'bad'];
  return { score, label, tone, metrics, steps, source: steps.length ? input.source : 'none', notes };
}
