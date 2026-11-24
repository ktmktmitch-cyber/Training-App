import { describe, expect, it } from 'vitest';
import { addDays } from '../src/engine/dates';
import { heatAdaptation, heatDose } from '../src/engine/heat';
import type { Activity } from '../src/engine/types';

const asOf = '2026-07-30';
const ride = (daysAgo: number, tempC: number | null, min = 75, indoor = false): Activity => ({ id: `r${daysAgo}`, date: addDays(asOf, -daysAgo), name: 'Ride', type: indoor ? 'VirtualRide' : 'Ride', isRide: true, isStrength: false, movingSec: min * 60, tss: 60, intensity: 0.7, normalizedPower: 200, avgHr: 140, powerZoneSecs: null, hrZoneSecs: null, source: 'intervals', tempC, indoor });

describe('heat adaptation', () => {
  it('dose rises with temperature and duration; cool rides and lifts give none', () => {
    expect(heatDose(ride(0, 15))).toBe(0);
    expect(heatDose(ride(0, 33, 60))).toBeCloseTo(1, 1);
    expect(heatDose(ride(0, 27, 60))).toBeLessThan(0.2);
    expect(heatDose(ride(0, 34, 120))).toBeGreaterThan(1);
    expect(heatDose(ride(0, null, 60, true))).toBeCloseTo(0.15, 2);
  });

  it('a week of daily hot rides makes you well on the way; it fades without heat', () => {
    const week = Array.from({ length: 7 }, (_, i) => ride(i, 33, 70));
    const h = heatAdaptation(week, null, asOf);
    expect(h.index).toBeGreaterThan(55);
    expect(h.hotSessions14).toBe(7);
    const later = heatAdaptation(week, null, addDays(asOf, 21));
    expect(later.index).toBeLessThan(h.index * 0.65);
    expect(heatAdaptation([ride(1, 12), ride(3, 14)], null, asOf).level).toBe('none');
  });

  it('turns the conditions model into heat and indoor costs', () => {
    const model = { n: 30, r2: 0.8, bpmPerWatt: 0.3, bpmPerDegree: 0.4, bpmIndoor: 3, bpmPerTsb: -0.1, bpmPerHour: 2, bpmPerWeek: -0.1, wattsPerMonthAtSameHr: 1 };
    const h = heatAdaptation([], model, asOf);
    expect(h.bpmAt30).toBe(6);
    expect(h.wattsAt30).toBe(20);
    expect(h.wattsIndoor).toBe(10);
  });
});
