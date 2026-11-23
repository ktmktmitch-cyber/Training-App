import { describe, expect, it } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import { workoutToFit } from '../src/engine/exporters';
import { blocksToIcuText, workoutDescription } from '../src/engine/icuExport';
import { hrBand, lthrZones } from '../src/engine/targets';
import type { PlannedWorkout } from '../src/engine/types';
import { blocksLoad, getTemplate } from '../src/engine/workouts';

function plan(id: string, dur = 75, level = 2): PlannedWorkout {
  const t = getTemplate(id);
  const b = t.build(Math.max(t.minMin, dur), Math.min(level, t.levels - 1));
  const l = blocksLoad(b.blocks);
  return { templateId: id, name: b.name, category: t.category, intensity: t.intensity, durationMin: Math.round(l.seconds / 60), tss: l.tss, ifactor: l.ifactor, blocks: b.blocks, purpose: t.purpose, why: [], fueling: '', key: t.key };
}

function steps(bytes: Uint8Array) {
  const d = new Decoder(Stream.fromByteArray(Array.from(bytes)));
  expect(d.checkIntegrity()).toBe(true);
  const { messages, errors } = d.read();
  expect(errors).toEqual([]);
  return messages.workoutStepMesgs as any[];
}

describe('export targets', () => {
  const w = plan('sweetspot', 75, 3);
  const work = w.blocks.flatMap((b) => b.steps).find((s) => s.low >= 88)!;

  it('FIT power export uses absolute watts from the chosen FTP', () => {
    const st = steps(workoutToFit(w, { mode: 'power', ftp: 300, lthr: null }));
    const timed = st.filter((s) => s.durationType === 'time');
    expect(timed.every((s) => s.targetType === 'power')).toBe(true);
    // >1000 means watts + 1000
    const expectLow = Math.round((work.low * 300) / 100) + 1000;
    expect(timed.some((s) => s.customTargetPowerLow === expectLow || s.customTargetValueLow === expectLow)).toBe(true);
    const lows = timed.map((s) => s.customTargetPowerLow ?? s.customTargetValueLow);
    expect(lows.every((v: number) => v > 1000)).toBe(true);
  });

  it('FIT HR export uses bpm from threshold HR, and open targets for short efforts', () => {
    const vo2 = plan('vo2_3015', 75, 2);
    const st = steps(workoutToFit(vo2, { mode: 'hr', ftp: 300, lthr: 170 }));
    const timed = st.filter((s) => s.durationType === 'time');
    expect(timed.some((s) => s.targetType === 'heartRate')).toBe(true);
    expect(timed.some((s) => s.targetType === 'open')).toBe(true); // 30 s efforts
    const hr = timed.filter((s) => s.targetType === 'heartRate');
    for (const s of hr) {
      const lo = (s.customTargetHeartRateLow ?? s.customTargetValueLow) - 100;
      expect(lo).toBeGreaterThan(100);
      expect(lo).toBeLessThan(180);
    }
    const st2 = steps(workoutToFit(w, { mode: 'hr', ftp: 300, lthr: 170 }));
    const [lo, hi] = hrBand(work, 170);
    expect(st2.some((s) => (s.customTargetHeartRateLow ?? s.customTargetValueLow) === lo + 100 && (s.customTargetHeartRateHigh ?? s.customTargetValueHigh) === hi + 100)).toBe(true);
  });

  it('sweet spot maps to Z3-Z4 heart rate and zones scale with LTHR', () => {
    const [lo, hi] = hrBand(work, 170);
    expect(lo).toBeGreaterThanOrEqual(150);
    expect(hi).toBeLessThanOrEqual(170);
    expect(lthrZones(170)).toEqual([138, 151, 158, 168, 179]);
  });

  it('intervals.icu text: watts for power, % of intervals.icu LTHR for heart rate', () => {
    const p = blocksToIcuText(w.blocks, 'power', { targets: { mode: 'power', ftp: 250, lthr: null } });
    expect(p).toMatch(/\d+-\d+w/);
    expect(p).not.toMatch(/\d+%/);
    // chosen LTHR 170 but intervals.icu has 180 → percentages are re-based so bpm come out right
    const h = workoutDescription(w, 'hr', { targets: { mode: 'hr', ftp: 250, lthr: 170 }, icuLthr: 180 });
    const [lo] = hrBand(work, 170);
    expect(h).toContain(`${Math.round((lo / 180) * 100)}-`);
    expect(h).toMatch(/% LTHR/);
    expect(h).toContain('threshold HR 170 bpm');
  });

  it('without targets the files stay % FTP (unchanged behaviour)', () => {
    const st = steps(workoutToFit(w));
    const lows = st.filter((s) => s.durationType === 'time').map((s) => s.customTargetPowerLow ?? s.customTargetValueLow);
    expect(lows.every((v: number) => v < 1000)).toBe(true);
  });
});
