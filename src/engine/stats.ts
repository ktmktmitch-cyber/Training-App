export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

export function sd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const mu = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1));
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function round(x: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

/** Exponentially weighted load (Banister/Coggan CTL/ATL style). */
export function ewma(prev: number, load: number, days: number): number {
  return prev + (load - prev) / days;
}

export function projectLoad(ctl0: number, atl0: number, daily: number[]): { ctl: number[]; atl: number[]; tsb: number[] } {
  let c = ctl0;
  let a = atl0;
  const ctl: number[] = [];
  const atl: number[] = [];
  const tsb: number[] = [];
  for (const l of daily) {
    // Form for a day is yesterday's fitness minus yesterday's fatigue (intervals.icu convention)
    tsb.push(c - a);
    c = ewma(c, l, 42);
    a = ewma(a, l, 7);
    ctl.push(c);
    atl.push(a);
  }
  return { ctl, atl, tsb };
}
