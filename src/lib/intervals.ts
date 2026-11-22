// intervals.icu API client + normalisation into engine types.
// Works through the bundled Node proxy (/api/icu → intervals.icu, no CORS issues, key
// can live server-side) or directly from the browser with your API key.
import type { Activity, AthleteProfile, CalendarEvent, ISODate, Wellness } from '../engine/types';
import type { IcuEvent } from '../engine/icuExport';

export interface Connection {
  base: string; // 'api/icu' (proxy) or 'https://intervals.icu/api/v1'
  apiKey: string; // may be empty when the server holds the key
  athleteId: string; // 'i12345' or '0' (= key owner)
  appPassword?: string;
}

const RIDE_TYPES = new Set(['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'EBikeRide', 'EMountainBikeRide', 'TrackRide', 'Cyclocross', 'Velomobile', 'Handcycle']);

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(conn: Connection, path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...(init.headers as Record<string, string>) };
  if (conn.apiKey) headers.authorization = 'Basic ' + btoa(`API_KEY:${conn.apiKey}`);
  if (conn.appPassword) headers['x-app-password'] = conn.appPassword;
  if (init.body) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${conn.base}${path}`, { ...init, headers });
  } catch (e) {
    throw new ApiError(0, `Network error reaching intervals.icu (${(e as Error).message}). If you're running the static build, the browser may be blocking the request — run the bundled server instead (npm start).`);
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j.error || j.message || msg;
    } catch {
      /* not json */
    }
    if (res.status === 401 || res.status === 403) msg = `intervals.icu rejected the credentials (${res.status}). Check your API key and athlete ID.`;
    throw new ApiError(res.status, msg);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

const aid = (c: Connection) => encodeURIComponent(c.athleteId || '0');

// ---------- raw shapes (subset) ----------
interface RawSport {
  types: string[];
  ftp: number | null;
  lthr: number | null;
  max_hr: number | null;
  power_zones: number[] | null;
  hr_zones: number[] | null;
  mmp_model?: { ftp?: number } | null;
}
interface RawAthlete {
  id: string;
  name?: string;
  firstname?: string;
  icu_resting_hr?: number | null;
  icu_weight?: number | null;
  weight?: number | null;
  icu_date_of_birth?: string | null;
  sex?: string | null;
  sportSettings?: RawSport[];
}
interface RawWellness {
  id: string;
  ctl?: number | null;
  atl?: number | null;
  rampRate?: number | null;
  hrv?: number | null;
  restingHR?: number | null;
  sleepSecs?: number | null;
  sleepScore?: number | null;
  soreness?: number | null;
  fatigue?: number | null;
  stress?: number | null;
  mood?: number | null;
  motivation?: number | null;
  sportInfo?: { type: string; eftp?: number | null }[] | null;
}
interface RawActivity {
  id: string;
  start_date_local?: string;
  type?: string;
  name?: string;
  moving_time?: number | null;
  elapsed_time?: number | null;
  icu_training_load?: number | null;
  icu_intensity?: number | null;
  icu_weighted_avg_watts?: number | null;
  average_heartrate?: number | null;
  icu_zone_times?: { id: string; secs: number }[] | null;
  icu_hr_zone_times?: number[] | null;
  strava_id?: string | null;
  source?: string;
  _note?: string;
}
interface RawEvent {
  id: number | string;
  start_date_local: string;
  end_date_local?: string | null;
  category: string;
  name?: string | null;
  type?: string | null;
  external_id?: string | null;
}

// ---------- normalisers ----------
export function normalizeAthlete(a: RawAthlete, latestEftp: number | null): AthleteProfile {
  const ride = a.sportSettings?.find((s) => s.types?.includes('Ride')) ?? a.sportSettings?.[0];
  return {
    id: a.id,
    name: a.name || a.firstname || 'Athlete',
    ftp: ride?.ftp ?? null,
    eftp: latestEftp ?? ride?.mmp_model?.ftp ?? null,
    lthr: ride?.lthr ?? null,
    maxHr: ride?.max_hr ?? null,
    restingHr: a.icu_resting_hr ?? null,
    weightKg: a.icu_weight ?? a.weight ?? null,
    powerZones: ride?.power_zones ?? [55, 75, 90, 105, 120, 150, 999],
    hrZones: ride?.hr_zones ?? [],
    birthYear: a.icu_date_of_birth ? Number(a.icu_date_of_birth.slice(0, 4)) : null,
    sex: a.sex ?? null,
  };
}

export function normalizeWellness(w: RawWellness): Wellness {
  return {
    date: w.id,
    hrv: w.hrv ?? null,
    rhr: w.restingHR ?? null,
    sleepSec: w.sleepSecs ?? null,
    sleepScore: w.sleepScore ?? null,
    ctl: w.ctl ?? null,
    atl: w.atl ?? null,
    rampRate: w.rampRate ?? null,
    soreness: w.soreness ?? null,
    fatigue: w.fatigue ?? null,
    stress: w.stress ?? null,
    mood: w.mood ?? null,
    motivation: w.motivation ?? null,
    eftp: w.sportInfo?.find((s) => s.type === 'Ride')?.eftp ?? null,
  };
}

export function normalizeActivity(a: RawActivity): Activity {
  const type = a.type ?? 'Other';
  const zones = a.icu_zone_times?.filter((z) => /^Z\d$/.test(z.id)).sort((x, y) => x.id.localeCompare(y.id));
  return {
    id: String(a.id),
    date: (a.start_date_local ?? '').slice(0, 10),
    startTime: a.start_date_local,
    name: a.name ?? type,
    type,
    isRide: RIDE_TYPES.has(type),
    isStrength: type === 'WeightTraining',
    movingSec: a.moving_time ?? a.elapsed_time ?? 0,
    tss: a.icu_training_load ?? null,
    intensity: a.icu_intensity != null ? a.icu_intensity / 100 : null,
    normalizedPower: a.icu_weighted_avg_watts ?? null,
    avgHr: a.average_heartrate ?? null,
    powerZoneSecs: zones?.length ? zones.map((z) => z.secs) : null,
    hrZoneSecs: a.icu_hr_zone_times ?? null,
    source: 'intervals',
    limited: Boolean(a._note) || (a.source === 'STRAVA' && !a.moving_time),
    stravaId: a.strava_id ? String(a.strava_id) : undefined,
  };
}

export function normalizeEvent(e: RawEvent): CalendarEvent {
  return {
    id: String(e.id),
    date: e.start_date_local.slice(0, 10),
    endDate: e.end_date_local ? e.end_date_local.slice(0, 10) : undefined,
    category: e.category,
    name: e.name ?? e.category,
    type: e.type ?? undefined,
    externalId: e.external_id ?? null,
  };
}

// ---------- API ----------
export async function fetchAll(conn: Connection, oldest: ISODate, newest: ISODate, futureEnd: ISODate) {
  const [athlete, wellnessRaw, activitiesRaw, eventsRaw] = await Promise.all([
    call<RawAthlete>(conn, `/athlete/${aid(conn)}`),
    call<RawWellness[]>(conn, `/athlete/${aid(conn)}/wellness?oldest=${oldest}&newest=${newest}`),
    call<RawActivity[]>(conn, `/athlete/${aid(conn)}/activities?oldest=${oldest}&newest=${newest}`),
    call<RawEvent[]>(conn, `/athlete/${aid(conn)}/events?oldest=${oldest}&newest=${futureEnd}`),
  ]);
  const wellness = (wellnessRaw ?? []).map(normalizeWellness).sort((a, b) => a.date.localeCompare(b.date));
  const latestEftp = [...wellness].reverse().find((w) => w.eftp)?.eftp ?? null;
  return {
    profile: normalizeAthlete(athlete, latestEftp),
    wellness,
    activities: (activitiesRaw ?? []).map(normalizeActivity).filter((a) => a.date),
    events: (eventsRaw ?? []).map(normalizeEvent),
  };
}

export async function testConnection(conn: Connection): Promise<string> {
  const a = await call<RawAthlete>(conn, `/athlete/${aid(conn)}`);
  return a.name || a.firstname || a.id;
}

export async function pushEvents(conn: Connection, events: IcuEvent[], staleExternalIds: string[]): Promise<number> {
  if (staleExternalIds.length) {
    try {
      await call(conn, `/athlete/${aid(conn)}/events/bulk-delete`, {
        method: 'PUT',
        body: JSON.stringify(staleExternalIds.map((external_id) => ({ external_id }))),
      });
    } catch {
      // Nothing to delete is fine
    }
  }
  if (!events.length) return 0;
  const res = await call<unknown[]>(conn, `/athlete/${aid(conn)}/events/bulk?upsert=true`, {
    method: 'POST',
    body: JSON.stringify(events),
  });
  return Array.isArray(res) ? res.length : events.length;
}
