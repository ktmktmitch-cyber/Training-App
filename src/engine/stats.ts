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

/**
 * Least squares with a light ridge penalty (not applied to the intercept, column 0).
 * Returns null if the system is singular.
 */
export function ols(X: number[][], y: number[], ridge = 1e-6): { beta: number[]; r2: number } | null {
  const n = X.length;
  if (!n) return null;
  const p = X[0].length;
  const A = Array.from({ length: p }, () => new Array(p + 1).fill(0));
  for (let i = 0; i < n; i++)
    for (let r = 0; r < p; r++) {
      A[r][p] += X[i][r] * y[i];
      for (let c = 0; c < p; c++) A[r][c] += X[i][r] * X[i][c];
    }
  for (let r = 1; r < p; r++) A[r][r] += ridge * (A[r][r] || 1);
  // Gaussian elimination with partial pivoting
  for (let col = 0; col < p; col++) {
    let piv = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= p; c++) A[r][c] -= f * A[col][c];
    }
  }
  const beta = A.map((row, i) => row[p] / row[i]);
  const yMean = mean(y);
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = X[i].reduce((a, x, j) => a + x * beta[j], 0);
    ssRes += (y[i] - pred) ** 2;
    ssTot += (y[i] - yMean) ** 2;
  }
  return { beta, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}

export function linearTrend(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  if (xs.length < 3) return null;
  const fit = ols(xs.map((x) => [1, x]), ys, 0);
  return fit ? { intercept: fit.beta[0], slope: fit.beta[1] } : null;
}
