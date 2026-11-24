// What a workout is exported against: power (watts from an FTP) or heart rate (bpm from a
// threshold HR). Workouts are built in % FTP; these helpers turn them into absolute targets.
import type { Step } from './types';

export type ExportMode = 'power' | 'hr';

export interface ExportTargets {
  mode: ExportMode;
  ftp: number; // W — used for power targets
  lthr: number | null; // bpm — threshold (lactate threshold) heart rate, used for HR targets
  paceMps?: number | null; // threshold pace as speed (runs), used for pace targets
}

/** Coggan power zone (1-5+) of a %FTP target. */
export function powerZone(pct: number): number {
  if (pct < 56) return 1;
  if (pct < 76) return 2;
  if (pct < 91) return 3;
  if (pct < 106) return 4;
  return 5;
}

/** HR zone tops as % of LTHR (Friel cycling zones: Z1 <81, Z2 81-89, Z3 90-93, Z4 94-99, Z5 100+). */
const HR_EDGES = [65, 81, 89, 93, 99, 105];

/** HR zone boundaries in bpm for a threshold HR: [Z1/Z2, Z2/Z3, Z3/Z4, Z4/Z5, Z5 top]. */
export function lthrZones(lthr: number): number[] {
  return HR_EDGES.slice(1).map((p) => Math.round((p * lthr) / 100));
}

/** Heart rate lags too much to steer efforts shorter than this; those are ridden by feel. */
export const MIN_HR_STEP_SEC = 120;

export function hrSteerable(s: Step): boolean {
  return s.durationSec >= MIN_HR_STEP_SEC;
}

/** bpm range for a step: the HR zone that matches the step's power zone. */
export function hrBand(s: Step, lthr: number): [number, number] {
  const z = powerZone((s.low + s.high) / 2);
  const bpm = HR_EDGES.map((p) => Math.round((p * lthr) / 100));
  return [bpm[z - 1], bpm[z]];
}

/** watts range for a step. */
export function wattBand(s: Step, ftp: number): [number, number] {
  return [Math.round((s.low * ftp) / 100), Math.round((Math.max(s.low, s.high) * ftp) / 100)];
}

export function targetsLabel(t: ExportTargets, sport: 'ride' | 'run' | 'swim' = 'ride'): string {
  if (t.mode === 'hr') return `heart rate (threshold HR ${t.lthr} bpm)`;
  if (sport === 'run') return t.paceMps ? `pace (threshold ${Math.floor(1000 / t.paceMps / 60)}:${String(Math.round((1000 / t.paceMps) % 60)).padStart(2, '0')}/km)` : 'pace (% of threshold)';
  if (sport === 'swim') return 'pace (% of CSS)';
  return `power (FTP ${t.ftp} W)`;
}
