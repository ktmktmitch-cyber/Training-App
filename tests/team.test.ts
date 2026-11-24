import { describe, expect, it } from 'vitest';
import { addDays } from '../src/engine/dates';
import { computeStaleness, dailyLoadFromAtl } from '../src/engine/staleness';
import { ewma } from '../src/engine/stats';
import { parseTeamData, riderMetrics } from '../src/engine/team';
import { estimateVo2, p5FromTwoEfforts, vo2FromPower } from '../src/engine/vo2max';
import { demoTeam } from '../src/lib/team';

const AS_OF = '2026-11-22';

describe('VO2max estimate', () => {
  it('uses the ACSM cycling equation', () => {
    expect(vo2FromPower(364, 80.7)).toBeCloseTo(55.7, 1);
  });
  it('derives 5-min power from 3- and 12-min bests with a CP model', () => {
    const p5 = p5FromTwoEfforts(400, 300)!; // CP 266.7, W′ 24 kJ → 346.7 W
    expect(p5).toBeGreaterThan(340);
    expect(p5).toBeLessThan(352);
    expect(p5FromTwoEfforts(300, 320)).toBeNull();
  });
  it('averages power-based and Garmin estimates', () => {
    const v = estimateVo2({ p3: 400, p12: 300, weightKg: 70, garmin: 60 });
    expect(v.power).toBeGreaterThan(55);
    expect(v.value).toBeCloseTo((v.power! + 60) / 2, 1);
    expect(v.category).toBeTruthy();
    expect(estimateVo2({}).value).toBeNull();
  });
});

describe('staleness', () => {
  it('recovers daily load from an ATL series', () => {
    let atl = 40;
    const loads = [80, 0, 120, 30, 0, 200, 60, 90];
    const trend = loads.map((l, i) => {
      atl = ewma(atl, l, 7);
      return { date: addDays(AS_OF, -loads.length + 1 + i), fatigue: atl };
    });
    const back = dailyLoadFromAtl(trend);
    expect(back.map((b) => b.load)).toEqual(loads.slice(1));
  });

  it('flags monotonous, high-strain training with deep fatigue as high risk', () => {
    const daily = Array.from({ length: 42 }, (_, i) => ({ date: addDays(AS_OF, -i), load: i < 7 ? 140 + (i % 2) * 10 : 70 + (i % 3) * 20 }));
    const tsb = Array.from({ length: 14 }, (_, i) => ({ date: addDays(AS_OF, -i), tsb: -28 }));
    const s = computeStaleness({ asOf: AS_OF, daily, tsb, lastRide: AS_OF, lastHard: addDays(AS_OF, -2), hrvLow: true });
    expect(s.level).toBe('high');
    expect(s.monotony!).toBeGreaterThan(2);
    expect(s.factors.map((f) => f.label)).toEqual(expect.arrayContaining(['Monotonous training', 'Chronically deep fatigue', 'HRV suppressed']));
  });

  it('rates varied, absorbable training as low risk', () => {
    const pattern = [0, 120, 45, 90, 0, 180, 60];
    const daily = Array.from({ length: 42 }, (_, i) => ({ date: addDays(AS_OF, -i), load: pattern[i % 7] }));
    const tsb = Array.from({ length: 14 }, (_, i) => ({ date: addDays(AS_OF, -i), tsb: -8 + (i % 5) }));
    const s = computeStaleness({ asOf: AS_OF, daily, tsb, lastRide: addDays(AS_OF, -1), lastHard: addDays(AS_OF, -3) });
    expect(s.level).toBe('low');
  });

  it('flags inactivity and reports unknown with no training at all', () => {
    const daily = Array.from({ length: 30 }, (_, i) => ({ date: addDays(AS_OF, -i), load: i > 15 ? 60 : 0 }));
    const s = computeStaleness({ asOf: AS_OF, daily, tsb: [], lastRide: addDays(AS_OF, -16), lastHard: undefined });
    expect(s.factors.some((f) => f.label === 'Inactive')).toBe(true);
    const none = computeStaleness({ asOf: AS_OF, daily: daily.map((d) => ({ ...d, load: 0 })), tsb: [], lastRide: null, lastHard: undefined });
    expect(none.level).toBe('unknown');
  });
});

describe('team data', () => {
  it('parses team.json tolerantly', () => {
    const d = parseTeamData({
      updated: 'x',
      today: AS_OF,
      riders: [
        { id: 'i1', rider: 'A', state: 'ok', hours_this_week: 3.5, eftp_watts: 280, eftp_wkg: 4, p3m: 380, p12m: 300, weeks: [{ week: '2026-11-16', hours: 3.5, miles: 50, rides: 2 }], trend: [], recent_rides: [], prs: [] },
        { id: 'i2', rider: 'B', state: 'blocked' },
      ],
      feed: [],
    });
    expect(d.riders).toHaveLength(2);
    expect(d.riders[1].weeks).toEqual([]);
    const m = riderMetrics(d.riders[0], AS_OF);
    expect(m.weightKg).toBe(70);
    expect(m.vo2.value).toBeGreaterThan(50);
    expect(() => parseTeamData({ nope: true })).toThrow();
  });

  it('builds a demo team with live-style detailed metrics for every rider', () => {
    const { team, deep } = demoTeam(AS_OF);
    const ok = team.riders.filter((r) => r.state === 'ok');
    expect(ok.length).toBe(5);
    expect(team.riders.some((r) => r.state === 'blocked')).toBe(true);
    expect(team.feed.length).toBeGreaterThan(5);
    for (const r of ok) {
      const m = riderMetrics(r, AS_OF, deep[r.id]);
      expect(m.loadFocus).not.toBeNull();
      expect(m.readiness).not.toBeNull();
      expect(m.vo2.value).toBeGreaterThan(30);
      expect(r.weeks).toHaveLength(8);
    }
    const riley = ok.find((r) => r.rider === 'Riley')!;
    const rm = riderMetrics(riley, AS_OF, deep[riley.id]);
    expect(rm.staleness.factors.some((f) => f.label === 'Inactive')).toBe(true);
    expect(['moderate', 'high']).toContain(rm.staleness.level);
  });
});

describe('load buckets without detailed data', () => {
  it('estimates from team.json rides when a rider is not shared with the coach key', () => {
    const asOf = '2026-11-24';
    const d = parseTeamData({
      updated: 'x',
      today: asOf,
      riders: [
        {
          id: 'i1', rider: 'A', state: 'ok', hours_this_week: 3, hours_last_week: 4, hours_month: 10, hours_ytd: 100, miles_ytd: 1000, fitness: 30, form: 0, prs: [], weeks: [], trend: [],
          recent_rides: [
            { start: '2026-11-20T10:00:00', date: '2026-11-20', name: 'Easy', type: 'Ride', hours: 2, miles: 30, load: 90 }, // IF ≈ 0.67 → low
            { start: '2026-11-18T10:00:00', date: '2026-11-18', name: 'Intervals', type: 'Ride', hours: 1, miles: 15, load: 80 }, // IF ≈ 0.89 → high
            { start: '2026-09-01T10:00:00', date: '2026-09-01', name: 'Old', type: 'Ride', hours: 1, miles: 15, load: 50 },
          ],
        },
        { id: 'i2', rider: 'B', state: 'ok', hours_this_week: 0, hours_last_week: 0, hours_month: 0, hours_ytd: 0, miles_ytd: 0, fitness: 0, form: 0, prs: [], weeks: [], trend: [], recent_rides: [] },
      ],
      feed: [],
    });
    const blocked = riderMetrics(d.riders[0], asOf, { activities: [], wellness: [], profile: null, fetchedAt: '', error: '403' });
    expect(blocked.loadFocus?.estimated).toBe(true);
    expect(blocked.loadFocus?.load.low).toBe(90);
    expect(blocked.loadFocus?.load.high).toBe(80);
    expect(riderMetrics(d.riders[0], asOf).loadFocus?.estimated).toBe(true); // not loaded yet
    expect(riderMetrics(d.riders[1], asOf).loadFocus).toBeNull();
  });
});
