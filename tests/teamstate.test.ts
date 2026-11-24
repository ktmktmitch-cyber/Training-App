import { describe, expect, it } from 'vitest';
import { addDays } from '../src/engine/dates';
import type { TeamRider } from '../src/engine/team';
import { riderTrainingState } from '../src/engine/teamState';

const asOf = '2026-11-24';
function rider(series: (i: number) => { fitness: number; fatigue: number }, over: Partial<TeamRider> = {}): TeamRider {
  const trend = Array.from({ length: 56 }, (_, i) => {
    const s = series(i);
    return { date: addDays(asOf, i - 55), fitness: s.fitness, fatigue: s.fatigue, form: s.fitness - s.fatigue };
  });
  return { id: 'x', rider: 'X', state: 'ok', hours_this_week: 5, hours_last_week: 6, hours_month: 20, hours_ytd: 200, miles_ytd: 3000, fitness: trend[55].fitness, form: trend[55].form, eftp_watts: 250, eftp_wkg: 3.5, prs: [], weeks: Array.from({ length: 8 }, () => ({ week: '', hours: 6, miles: 0, rides: 3 })), trend, recent_rides: [], hidden_strava: 0, ...over } as TeamRider;
}

describe('team training state', () => {
  it('improving: fitness rising over 4 weeks', () => {
    expect(riderTrainingState(rider((i) => ({ fitness: 30 + i * 0.3, fatigue: 30 + i * 0.3 + 8 })), asOf).key).toBe('improving');
  });
  it('detraining: fitness falling', () => {
    expect(riderTrainingState(rider((i) => ({ fitness: 50 - i * 0.4, fatigue: 50 - i * 0.4 - 10 })), asOf).key).toBe('detraining');
  });
  it('strained: fatigue far above fitness', () => {
    expect(riderTrainingState(rider((i) => ({ fitness: 40, fatigue: i > 50 ? 80 : 45 })), asOf).key).toBe('strained');
  });
  it('overreaching: deep fatigue for two weeks without fitness rising', () => {
    expect(riderTrainingState(rider((i) => ({ fitness: 60, fatigue: i > 40 ? 87 : 65 })), asOf).key).toBe('overreaching');
  });
  it('plateau: steady training, flat fitness, no PRs', () => {
    expect(riderTrainingState(rider(() => ({ fitness: 40, fatigue: 42 })), asOf).key).toBe('plateau');
  });
  it('maintaining when flat but with recent power PRs being older than 8 weeks is not the case', () => {
    const r = rider(() => ({ fitness: 40, fatigue: 42 }), { prs: [{ rider: 'X', duration: '20 min', watts: 260, wkg: 3.6, date: addDays(asOf, -40), ride: 'TT' }] });
    expect(riderTrainingState(r, asOf).key).toBe('maintaining');
  });
  it('recovering: short dip with positive form', () => {
    expect(riderTrainingState(rider((i) => ({ fitness: i > 48 ? 40 - (i - 48) * 0.5 : 40, fatigue: i > 48 ? 30 : 42 })), asOf).key).toBe('recovering');
  });
  it('inactive / no data', () => {
    expect(riderTrainingState(rider(() => ({ fitness: 0, fatigue: 0 }), { weeks: Array.from({ length: 8 }, () => ({ week: '', hours: 0, miles: 0, rides: 0 })) }), asOf).key).toBe('inactive');
    expect(riderTrainingState({ ...rider(() => ({ fitness: 0, fatigue: 0 })), trend: [], weeks: [] }, asOf).key).toBe('inactive');
  });
});
