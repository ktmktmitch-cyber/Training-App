import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAll, normalizeActivity, normalizeAthlete, normalizeWellness, pushEvents } from '../src/lib/intervals';
import { mergeActivities, normalizeStrava } from '../src/lib/strava';

const conn = { base: 'https://intervals.icu/api/v1', apiKey: 'KEY', athleteId: 'i123' };

afterEach(() => vi.unstubAllGlobals());

function mockFetch(handler: (url: string, init: RequestInit) => unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const body = handler(url, init);
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  return calls;
}

describe('intervals.icu client', () => {
  it('fetches athlete, wellness, activities and events with Basic auth', async () => {
    const calls = mockFetch((url) => {
      if (url.endsWith('/athlete/i123')) return { id: 'i123', name: 'A', icu_resting_hr: 50, sportSettings: [{ types: ['Ride'], ftp: 290, lthr: 179, max_hr: 199, power_zones: [55, 75, 90, 105, 120, 150, 999], hr_zones: [143, 160, 167, 178, 183, 188, 199] }] };
      if (url.includes('/wellness')) return [{ id: '2026-11-21', hrv: 42, restingHR: 52, ctl: 53, atl: 58, sportInfo: [{ type: 'Ride', eftp: 293 }] }];
      if (url.includes('/activities'))
        return [
          { id: 'i1', start_date_local: '2026-11-21T13:27:12', type: 'Ride', moving_time: 3600, icu_training_load: 60, icu_intensity: 77.5, icu_zone_times: [{ id: 'Z1', secs: 100 }, { id: 'SS', secs: 50 }, { id: 'Z2', secs: 200 }], icu_hr_zone_times: [1, 2, 3] },
          { id: 'i2', start_date_local: '2026-11-20T10:00:00', type: 'Ride', source: 'STRAVA', _note: 'Strava activities are not available via the API' },
        ];
      if (url.includes('/events')) return [{ id: 9, start_date_local: '2027-04-25T00:00:00', category: 'RACE_A', name: 'Big race' }];
      return null;
    });
    const res = await fetchAll(conn, '2026-08-01', '2026-11-22', '2027-11-22');
    expect(calls.map((c) => c.url)).toEqual([
      'https://intervals.icu/api/v1/athlete/i123',
      'https://intervals.icu/api/v1/athlete/i123/wellness?oldest=2026-08-01&newest=2026-11-22',
      'https://intervals.icu/api/v1/athlete/i123/activities?oldest=2026-08-01&newest=2026-11-22',
      'https://intervals.icu/api/v1/athlete/i123/events?oldest=2026-08-01&newest=2027-11-22',
      'https://intervals.icu/api/v1/athlete/i123/power-curves?type=Ride&curves=42d,90d,1y',
    ]);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Basic ' + btoa('API_KEY:KEY'));
    expect(res.profile.ftp).toBe(290);
    expect(res.profile.eftp).toBe(293);
    expect(res.wellness[0].hrv).toBe(42);
    expect(res.activities[0].intensity).toBeCloseTo(0.775);
    expect(res.activities[0].powerZoneSecs).toEqual([100, 200]); // SS bucket ignored
    expect(res.activities[1].limited).toBe(true);
    expect(res.events[0]).toMatchObject({ date: '2027-04-25', category: 'RACE_A' });
  });

  it('upserts workouts in bulk and deletes stale ones by external_id', async () => {
    const calls = mockFetch((_url, init) => (init.method === 'POST' ? JSON.parse(String(init.body)) : {}));
    const n = await pushEvents(
      conn,
      [{ category: 'WORKOUT', start_date_local: '2026-11-23T00:00:00', type: 'Ride', name: 'X', description: 'd', external_id: 'trainingapp-2026-11-23-ride' }],
      ['trainingapp-2026-11-24-ride'],
    );
    expect(n).toBe(1);
    expect(calls[0].url).toBe('https://intervals.icu/api/v1/athlete/i123/events/bulk-delete');
    expect(calls[0].init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0].init.body))).toEqual([{ external_id: 'trainingapp-2026-11-24-ride' }]);
    expect(calls[1].url).toBe('https://intervals.icu/api/v1/athlete/i123/events/bulk?upsert=true');
    expect(calls[1].init.method).toBe('POST');
  });

  it('normalises sparse objects safely', () => {
    expect(normalizeAthlete({ id: 'x' }, null).ftp).toBeNull();
    expect(normalizeWellness({ id: '2026-01-01' }).hrv).toBeNull();
    expect(normalizeActivity({ id: '1', start_date_local: '2026-01-01T08:00:00', type: 'WeightTraining' }).isStrength).toBe(true);
  });
});

describe('strava merge', () => {
  it('fills intervals.icu stubs and adds missing rides', () => {
    const profile = normalizeAthlete({ id: 'x', icu_resting_hr: 50, sportSettings: [{ types: ['Ride'], ftp: 300, lthr: 175, max_hr: 195, power_zones: null, hr_zones: null }] }, null);
    const icu = [normalizeActivity({ id: 'i2', start_date_local: '2026-11-20T10:00:00', type: 'Ride', source: 'STRAVA', strava_id: '55', _note: 'stub' })];
    const strava = [
      normalizeStrava({ id: 55, name: 'Morning', sport_type: 'Ride', start_date_local: '2026-11-20T10:00:00Z', moving_time: 3600, weighted_average_watts: 240, device_watts: true }, profile),
      normalizeStrava({ id: 56, name: 'Evening', sport_type: 'Ride', start_date_local: '2026-11-21T18:00:00Z', moving_time: 1800, average_heartrate: 140 }, profile),
    ];
    const m = mergeActivities(icu, strava);
    expect(m.filled).toBe(1);
    expect(m.added).toBe(1);
    expect(m.merged[0].tss).toBe(64); // 1h at IF 0.8
    expect(m.merged[1].tss).toBeGreaterThan(0);
  });
});
