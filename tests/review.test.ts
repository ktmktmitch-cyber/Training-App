import { describe, expect, it } from 'vitest';
import { alignLaps, flattenBlocks, reviewWorkout, sliceStream } from '../src/engine/review';
import { parseWorkoutDoc } from '../src/lib/intervals';

const doc = { steps: [
  { ramp: true, power: { start: 50, end: 72, units: '%ftp' }, warmup: true, duration: 600 },
  { reps: 3, text: 'Main set 3x', steps: [{ power: { start: 88, end: 93, units: '%ftp' }, duration: 600 }, { power: { start: 50, end: 55, units: '%ftp' }, duration: 300 }] },
  { power: { start: 45, end: 55, units: '%ftp' }, cooldown: true, duration: 600 },
] };
const FTP = 300;
const L = (secs: number, avgW: number) => ({ start: 0, secs, avgW, np: avgW, hr: 150, cadence: 88 });
const blocks = parseWorkoutDoc(doc, FTP)!;
const steps = flattenBlocks(blocks);

describe('workout review', () => {
  it('parses intervals.icu steps and expands repeats', () => {
    expect(steps).toHaveLength(8);
    expect(steps[1].label).toBe('Main set 1/3');
    expect(steps[2].label).toBe('Recovery');
    expect(steps[1].work).toBe(true);
  });

  it('matches laps (merging a split lap and ignoring a lap-button blip) and scores a well-executed ride high', () => {
    const laps = [L(600, 180), L(300, 270), L(300, 272), L(300, 150), L(600, 271), L(5, 200), L(300, 150), L(600, 273), L(300, 140), L(600, 150)];
    const m = alignLaps(steps, laps, FTP)!;
    expect(m.every(Boolean)).toBe(true);
    expect(Math.round(m[1]!.secs)).toBe(600); // two 5-min laps merged into the first interval
    const r = reviewWorkout({ planned: { secs: 3900, tss: 60, blocks }, actual: { secs: 3905, tss: 61, ifactor: 0.76, np: 228 }, ftp: FTP, matched: m, source: 'laps' });
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.steps.filter((s) => s.step.work).every((s) => s.status === 'on')).toBe(true);
  });

  it('flags work intervals ridden too easy and a ride cut short', () => {
    const laps = [L(600, 180), L(600, 230), L(300, 150), L(600, 235), L(300, 150)];
    const m = alignLaps(steps, laps, FTP)!;
    const r = reviewWorkout({ planned: { secs: 3900, tss: 60, blocks }, actual: { secs: 2400, tss: 35, ifactor: 0.7, np: 210 }, ftp: FTP, matched: m, source: 'laps' });
    expect(r.score).toBeLessThan(60);
    expect(r.steps.some((s) => s.status === 'under' || s.status === 'missed')).toBe(true);
    expect(r.notes.join(' ')).toMatch(/shorter than planned/);
  });

  it('falls back to slicing the power stream by planned durations', () => {
    const time = Array.from({ length: 3900 }, (_, i) => i);
    const watts = time.map((t) => (t >= 600 && t < 3300 && Math.floor((t - 600) / 900) < 3 && (t - 600) % 900 < 600 ? 272 : 150));
    const m = sliceStream(steps, { time, watts, hr: [], cadence: [] });
    const r = reviewWorkout({ planned: { secs: 3900, tss: 60, blocks }, actual: { secs: 3900, tss: 60, ifactor: 0.76, np: 228 }, ftp: FTP, matched: m, source: 'stream' });
    expect(r.steps.filter((s) => s.step.work).every((s) => s.status === 'on')).toBe(true);
  });

  it('scores on totals alone when there are no structured steps', () => {
    const r = reviewWorkout({ planned: { secs: 3600, tss: 60, blocks: null }, actual: { secs: 3600, tss: 62, ifactor: 0.78, np: 230 }, ftp: FTP, matched: null, source: 'none' });
    expect(r.steps).toHaveLength(0);
    expect(r.score).toBeGreaterThan(80);
  });
});
