import { describe, expect, it } from 'vitest';
import { addDays } from '../src/engine/dates';
import { heatDose } from '../src/engine/heat';
import { analyzePerformance } from '../src/engine/performance';
import { applyRideContext, hrConfounders } from '../src/engine/rideContext';
import type { Activity } from '../src/engine/types';

const AS_OF = '2026-11-25';
function rides(n: number, stimulantEvery: number, bump = 8): { acts: Activity[]; ctx: Record<string, string[]> } {
  const acts: Activity[] = [];
  const ctx: Record<string, string[]> = {};
  for (let i = 0; i < n; i++) {
    const np = 160 + ((i * 37) % 80);
    const stim = stimulantEvery > 0 && i % stimulantEvery === 0;
    const hr = 70 + 0.4 * np + (stim ? bump : 0) + ((i * 13) % 5) - 2;
    const id = `a${i}`;
    acts.push({ id, date: addDays(AS_OF, -2 - i * 3), name: 'Ride', type: 'Ride', isRide: true, isStrength: false, movingSec: 5400, tss: 70, intensity: np / 280, normalizedPower: np, avgHr: hr, powerZoneSecs: null, hrZoneSecs: null, source: 'intervals', tempC: 15, ftp: 280 } as Activity);
    if (stim) ctx[id] = ['stimulant'];
  }
  return { acts, ctx };
}
const profile = { ftp: 280, eftp: 280, lthr: 175, weightKg: 75 } as any;

describe('ride context', () => {
  it('learns your personal heart-rate effect of a tag once it has enough rides', () => {
    const { acts, ctx } = rides(30, 3);
    const p = analyzePerformance(applyRideContext(acts, ctx as any), [], profile, AS_OF);
    const eff = p.model!.tagEffects!.find((t) => t.tag === 'stimulant')!;
    expect(eff.n).toBeGreaterThanOrEqual(4);
    expect(eff.bpm).toBeGreaterThan(6);
    expect(eff.bpm).toBeLessThan(10);
  });

  it('keeps strong-effect rides out until the effect can be learned', () => {
    const { acts, ctx } = rides(20, 7); // 3 tagged rides — not enough to learn
    const tagged = applyRideContext(acts, ctx as any);
    const p = analyzePerformance(tagged, [], profile, AS_OF);
    expect(p.model!.excluded!.n).toBe(3);
    expect(hrConfounders(tagged.find((a) => a.id === 'a0')!)).toEqual(['stimulant']);
  });

  it('indoor without a fan is indoor riding and counts as heat exposure', () => {
    const a = { id: 'x', date: AS_OF, isStrength: false, movingSec: 3600, indoor: false, tempC: null } as any;
    const [t] = applyRideContext([a], { x: ['no_fan'] });
    expect(t.indoor).toBe(true);
    expect(heatDose(t)).toBeGreaterThan(heatDose({ ...t, context: ['fan'] }));
  });
});
