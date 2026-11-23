import { describe, expect, it } from 'vitest';
import { buildMobility, MOVES } from '../src/engine/mobility';
import { mobilityFor, mobilityPrefs } from '../src/engine/planner';
import type { PlannedDay } from '../src/engine/types';
import { DEFAULT_STRENGTH } from '../src/lib/defaults';

const eq = { roller: false, band: false };
const count = (s: ReturnType<typeof buildMobility>, area: string) => s.moves.filter((m) => m.areas.includes(area as never)).length;

describe('mobility sessions', () => {
  it('stays short and covers the areas riding tightens', () => {
    for (const min of [5, 8, 10, 15]) {
      const s = buildMobility('rest_day', '2026-11-24', { focus: [], minutes: min, equipment: eq });
      expect(s.minutes).toBeLessThanOrEqual(min + 1);
      expect(s.minutes).toBeGreaterThanOrEqual(Math.min(min, 4) - 1);
      expect(new Set(s.moves.map((m) => m.id)).size).toBe(s.moves.length);
    }
    const s = buildMobility('rest_day', '2026-11-24', { focus: [], minutes: 10, equipment: eq });
    for (const a of ['hip_flexors', 'thoracic', 'hamstrings', 'glutes']) expect(count(s, a)).toBeGreaterThan(0);
  });

  it('gives tight spots more moves and puts them first', () => {
    const base = buildMobility('rest_day', '2026-11-24', { focus: [], minutes: 10, equipment: eq });
    const neck = buildMobility('rest_day', '2026-11-24', { focus: ['neck_shoulders', 'wrists'], minutes: 10, equipment: eq });
    expect(count(neck, 'neck_shoulders')).toBeGreaterThan(count(base, 'neck_shoulders'));
    expect(count(neck, 'wrists')).toBeGreaterThan(0);
    expect(count(neck, 'neck_shoulders')).toBeGreaterThanOrEqual(2);
    expect(neck.title).toMatch(/neck/);
  });

  it('respects session type and equipment', () => {
    const pre = buildMobility('pre_ride', '2026-11-24', { focus: ['hamstrings'], minutes: 6, equipment: eq });
    expect(pre.moves.every((m) => m.kind === 'dynamic' || m.kind === 'activate')).toBe(true);
    const noKit = buildMobility('rest_day', '2026-11-25', { focus: ['thoracic', 'it_band'], minutes: 15, equipment: eq });
    expect(noKit.moves.some((m) => m.needs === 'roller' || m.needs === 'band')).toBe(false);
    const kit = buildMobility('rest_day', '2026-11-25', { focus: ['thoracic', 'it_band'], minutes: 15, equipment: { roller: true, band: true } });
    expect(kit.moves.some((m) => m.needs === 'roller')).toBe(true);
    expect(MOVES.length).toBeGreaterThanOrEqual(25);
  });

  it('places sessions on rest and easy days by default, more often when asked', () => {
    const day = (ride: Partial<PlannedDay['ride']> | null, strength = false): PlannedDay =>
      ({ date: '2026-11-24', dow: 2, phase: 'base', weekType: 'load', ride: ride as PlannedDay['ride'], strength: strength ? ({} as PlannedDay['strength']) : null, notes: [], status: 'available' }) as PlannedDay;
    const def = mobilityPrefs(DEFAULT_STRENGTH);
    expect(def.frequency).toBe('rest_days');
    expect(mobilityFor(day(null), def)?.kind).toBe('rest_day');
    expect(mobilityFor(day({ category: 'recovery', key: false }), def)?.kind).toBe('post_ride');
    expect(mobilityFor(day({ category: 'threshold', key: true }), def)).toBeNull();
    expect(mobilityFor(day({ category: 'threshold', key: true }), { ...def, frequency: 'most_days' })?.kind).toBe('post_ride');
    expect(mobilityFor(day({ category: 'threshold', key: true }, true), { ...def, frequency: 'most_days' })).toBeNull();
    expect(mobilityFor(day({ category: 'threshold', key: true }, true), { ...def, frequency: 'daily' })?.minutes).toBeLessThanOrEqual(6);
    expect(mobilityFor(day(null), { ...def, frequency: 'off' })).toBeNull();
    expect(mobilityPrefs({ ...DEFAULT_STRENGTH, includeMobility: false, mobility: undefined }).frequency).toBe('off');
  });
});
