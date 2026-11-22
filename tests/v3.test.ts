import { describe, expect, it } from 'vitest';
import { addDays } from '../src/engine/dates';
import { affectedMornings, tagImpacts, type Journal } from '../src/engine/journal';
import { analyzePerformance } from '../src/engine/performance';
import { assessReadiness } from '../src/engine/readiness';
import { ols } from '../src/engine/stats';
import type { Activity, AthleteProfile, Wellness } from '../src/engine/types';

const AS_OF = '2026-11-22';

describe('regression', () => {
  it('recovers known coefficients', () => {
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 40; i++) {
      const a = (i * 7) % 13;
      const b = (i * 5) % 11;
      X.push([1, a, b]);
      y.push(3 + 2 * a - 0.5 * b);
    }
    const r = ols(X, y)!;
    expect(r.beta[0]).toBeCloseTo(3, 3);
    expect(r.beta[1]).toBeCloseTo(2, 3);
    expect(r.beta[2]).toBeCloseTo(-0.5, 3);
    expect(r.r2).toBeCloseTo(1, 5);
  });
});

describe('performance analysis', () => {
  const profile: AthleteProfile = { id: 'x', name: 'x', ftp: 280, eftp: 285, lthr: 172, maxHr: 192, restingHr: 48, weightKg: 75, powerZones: [55, 75, 90, 105, 120, 150, 999], hrZones: [] };
  // Synthetic truth: HR = 55 + 0.42·NP + 0.35·(T−15) + 6·indoor + 1.5·(h−1.5) − 0.6·weeks
  const rides: Activity[] = [];
  const wellness: Wellness[] = [];
  for (let d = 120; d >= 0; d--) {
    const date = addDays(AS_OF, -d);
    wellness.push({ date, hrv: 60, rhr: 48, sleepSec: 27000, sleepScore: 80, ctl: 60, atl: 60, rampRate: 0, soreness: null, fatigue: null, stress: null, mood: null, motivation: null, eftp: 270 + (120 - d) * 0.12 });
    if (d % 2) continue;
    const i = rides.length;
    const np = 170 + ((i * 37) % 70);
    const temp = 5 + ((i * 11) % 25);
    const indoor = i % 4 === 0;
    const hours = 1 + ((i * 3) % 4) * 0.5;
    const weeks = -d / 7;
    const hr = 55 + 0.42 * np + 0.35 * (temp - 15) + (indoor ? 6 : 0) + 1.5 * (hours - 1.5) - 0.6 * weeks;
    rides.push({
      id: `r${i}`, date, name: 'ride', type: indoor ? 'VirtualRide' : 'Ride', isRide: true, isStrength: false,
      movingSec: hours * 3600, tss: 60, intensity: np / 280, normalizedPower: np, avgHr: Math.round(hr * 10) / 10,
      powerZoneSecs: null, hrZoneSecs: null, source: 'demo', tempC: temp, indoor, ftp: 280,
      pmFtp: d < 30 ? 284 : 270, pmFtpSecs: 600, pmFtpWatts: 320,
    });
  }

  it('separates temperature, indoor, duration and fitness effects', () => {
    const r = analyzePerformance(rides, wellness, profile, AS_OF);
    expect(r.model).not.toBeNull();
    expect(r.model!.bpmPerDegree).toBeCloseTo(0.35, 1);
    expect(r.model!.bpmIndoor).toBeCloseTo(6, 0);
    expect(r.model!.bpmPerHour).toBeCloseTo(1.5, 0);
    expect(r.model!.wattsPerMonthAtSameHr).toBeGreaterThan(4);
    expect(r.efTrendPctPerMonth).toBeGreaterThan(0);
    expect(r.conditionsNote).toMatch(/indoors/);
  });

  it('blends FTP sources and reaches an improving verdict', () => {
    const r = analyzePerformance(rides, wellness, profile, AS_OF);
    const keys = r.ftp.sources.map((s) => s.key);
    expect(keys).toContain('eftp');
    expect(keys).toContain('best');
    expect(r.ftp.estimate).toBeGreaterThan(270);
    expect(r.ftp.estimate).toBeLessThan(300);
    expect(r.improvement.verdict).toBe('improving');
  });

  it('degrades gracefully with no data', () => {
    const r = analyzePerformance([], [], null, AS_OF);
    expect(r.model).toBeNull();
    expect(r.ftp.estimate).toBeNull();
    expect(r.improvement.verdict).toBe('unknown');
  });
});

describe('behaviour journal', () => {
  const base = (n: number): Wellness[] =>
    Array.from({ length: n }, (_, i) => ({
      date: addDays(AS_OF, -(n - 1 - i)),
      hrv: 60 + ((i * 7) % 5) - 2,
      rhr: 48 + ((i * 3) % 3) - 1,
      sleepSec: 27000, sleepScore: 80, ctl: 60, atl: 60, rampRate: 1,
      soreness: null, fatigue: null, stress: null, mood: null, motivation: null, eftp: null,
    }));

  it('maps behaviours to the following mornings', () => {
    const j: Journal = { '2026-11-20': ['alcohol_heavy'], '2026-11-21': ['stress'] };
    const e = affectedMornings(j);
    expect(e['2026-11-21'].excludeBaseline).toBe(true);
    expect(e['2026-11-22'].tags).toEqual(expect.arrayContaining(['alcohol_heavy', 'stress']));
    expect(e['2026-11-22'].excludeTrend).toBe(true);
    expect(affectedMornings({ '2026-11-21': ['stress'] })['2026-11-22'].excludeBaseline).toBe(false);
  });

  it('keeps explained alcohol nights out of the trend so readiness stays green', () => {
    const w = base(70);
    // two rough nights after drinks
    w[68] = { ...w[68], hrv: 38, rhr: 56 };
    w[69] = { ...w[69], hrv: 40, rhr: 55 };
    const unexplained = assessReadiness(w, AS_OF);
    const explained = assessReadiness(w, AS_OF, { effects: affectedMornings({ [addDays(AS_OF, -2)]: ['alcohol_heavy'] }) });
    expect(explained.score!).toBeGreaterThan(unexplained.score!);
    expect(explained.status).toBe('green');
    expect(explained.flags.some((f) => f.id === 'hrv-today' && /explained/.test(f.title))).toBe(true);
  });

  it('does not ignore illness for readiness', () => {
    const e = affectedMornings({ [addDays(AS_OF, -1)]: ['illness'] });
    expect(e[AS_OF].excludeBaseline).toBe(true);
    expect(e[AS_OF].excludeTrend).toBe(false);
  });

  it('estimates the personal impact of a behaviour', () => {
    const w = base(90);
    const j: Journal = {};
    for (const k of [10, 25, 40, 55]) {
      const idx = 90 - k;
      w[idx] = { ...w[idx], hrv: 45, rhr: 53 };
      j[addDays(w[idx].date, -1)] = ['alcohol_light'];
    }
    const imp = tagImpacts(j, w, AS_OF).find((t) => t.key === 'alcohol_light')!;
    expect(imp.n).toBe(4);
    expect(imp.hrvPct!).toBeLessThan(-15);
    expect(imp.rhrDelta!).toBeGreaterThan(3);
  });
});

import { Decoder, Stream } from '@garmin/fitsdk';
import { workoutToFit, workoutToMrc } from '../src/engine/exporters';
import { WORKOUTS, blocksLoad, getTemplate } from '../src/engine/workouts';
import type { PlannedWorkout } from '../src/engine/types';

function plan(id: string, dur = 75, level = 2): PlannedWorkout {
  const t = getTemplate(id);
  const b = t.build(Math.max(t.minMin, dur), Math.min(level, t.levels - 1));
  const l = blocksLoad(b.blocks);
  return { templateId: id, name: b.name, category: t.category, intensity: t.intensity, durationMin: Math.round(l.seconds / 60), tss: l.tss, ifactor: l.ifactor, blocks: b.blocks, purpose: t.purpose, why: [], fueling: '', key: t.key };
}

describe('workout file exports', () => {
  it('every library workout encodes to a FIT file that Garmin’s SDK decodes cleanly', () => {
    expect(WORKOUTS.length).toBeGreaterThanOrEqual(50);
    for (const t of WORKOUTS) {
      const w = plan(t.id, 90, t.levels - 1);
      const d = new Decoder(Stream.fromByteArray(Array.from(workoutToFit(w))));
      expect(d.isFIT()).toBe(true);
      expect(d.checkIntegrity()).toBe(true);
      const { messages, errors } = d.read();
      expect(errors).toEqual([]);
      expect(messages.workoutMesgs![0].sport).toBe('cycling');
      const steps = messages.workoutStepMesgs!;
      expect(steps.length).toBe(messages.workoutMesgs![0].numValidSteps);
      // total timed duration matches the planned workout
      const repeatExpanded = (() => {
        let secs = 0;
        steps.forEach((s: any, i: number) => {
          if (s.durationType === 'time') secs += s.durationTime;
          if (s.durationType === 'repeatUntilStepsCmplt') {
            const block = steps.slice(s.durationStep, i).reduce((a: number, x: any) => a + (x.durationTime ?? 0), 0);
            secs += block * (s.targetValue - 1);
          }
        });
        return secs;
      })();
      expect(Math.abs(repeatExpanded / 60 - w.durationMin)).toBeLessThan(1.5);
    }
  });

  it('writes MRC files with % FTP over time', () => {
    const mrc = workoutToMrc(plan('sweetspot', 75, 3));
    expect(mrc).toMatch(/\[COURSE DATA\]/);
    expect(mrc).toMatch(/MINUTES PERCENT/);
    expect(mrc.split('\r\n').filter((l) => /^\d+\.\d{2}\t\d+$/.test(l)).length).toBeGreaterThan(10);
  });
});
