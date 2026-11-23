import { describe, expect, it } from 'vitest';
import { morton, powerProfile } from '../src/engine/powerProfile';
import type { AthleteProfile } from '../src/engine/types';
import { normalizeCurves } from '../src/lib/intervals';

const raw = {
  list: [
    {
      id: '90d',
      label: '90 days',
      start_date_local: '2026-08-26T00:00:00',
      end_date_local: '2026-11-24T00:00:00',
      weight: 75,
      secs: [1, 2, 5, 10, 60, 120, 300, 1200],
      watts: [1400, 1380, 1310, 1200, 640, 470, 360, 300],
      activity_id: ['a1', 'a1', 'a1', 'a1', 'a2', 'a2', 'a3', 'a4'],
    },
  ],
  activities: {
    a1: { id: 'a1', name: 'Crit', start_date_local: '2026-09-30T17:55:00' },
    a2: { id: 'a2', name: 'Hill reps', start_date_local: '2026-11-20T12:00:00' },
    a3: { id: 'a3', name: 'VO2 5x5', start_date_local: '2026-11-03T12:00:00' },
  },
};

const profile: AthleteProfile = { id: 'i1', name: 'R', ftp: 290, eftp: 290, cp: 280, wPrime: 22000, pMax: 1400, lthr: 170, maxHr: 190, restingHr: 48, weightKg: 75, powerZones: [], hrZones: [] };

describe('power curve', () => {
  it('keeps key durations with the ride name and date', () => {
    const [c] = normalizeCurves(raw);
    expect(c.id).toBe('90d');
    expect(c.weightKg).toBe(75);
    const five = c.points.find((p) => p.secs === 5)!;
    expect(five).toEqual({ secs: 5, watts: 1310, activityId: 'a1', activityName: 'Crit', date: '2026-09-30' });
    expect(c.points.find((p) => p.secs === 1200)!.activityName).toBeNull(); // ride not in the map
    expect(c.points.some((p) => p.secs === 2)).toBe(false); // not a kept duration
  });

  it('uses real best efforts (not the model) and says where each came from', () => {
    const pp = powerProfile(profile, normalizeCurves(raw))!;
    expect(pp.watts.sprint).toBe(1310);
    expect(pp.watts.anaerobic).toBe(640);
    expect(pp.watts.vo2).toBe(360);
    expect(pp.watts.threshold).toBe(290);
    expect(pp.sources.sprint.kind).toBe('best');
    expect(pp.sources.sprint.point?.activityName).toBe('Crit');
    expect(pp.sources.sprint.modelWatts).toBe(Math.round(morton(280, 22000, 1400, 5)));
    expect(pp.sources.sprint.modelWatts!).toBeLessThan(1310); // the model under-reads sprints
    expect(pp.note).toMatch(/best efforts/);
  });

  it('falls back to the model when there is no curve', () => {
    const pp = powerProfile(profile, [])!;
    expect(pp.sources.sprint.kind).toBe('model');
    expect(pp.watts.sprint).toBe(Math.round(morton(280, 22000, 1400, 5)));
    expect(pp.note).toMatch(/under-read/);
  });
});
