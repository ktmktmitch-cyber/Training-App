// Optional Strava source (via the bundled server's OAuth). Used to fill gaps where
// intervals.icu only has a stub for a Strava-imported activity, or activities that
// never reached intervals.icu. If your Garmin syncs directly to intervals.icu (best),
// this adds little — but it's here if you need it.
import { diffDays } from '../engine/dates';
import type { Activity, AthleteProfile } from '../engine/types';

export interface StravaStatus {
  configured: boolean;
  connected: boolean;
  athlete: { id: number; name: string } | null;
}

interface RawStrava {
  id: number;
  name: string;
  sport_type?: string;
  type?: string;
  start_date_local: string;
  moving_time: number;
  weighted_average_watts?: number;
  average_watts?: number;
  device_watts?: boolean;
  average_heartrate?: number;
  suffer_score?: number;
}

const RIDE = new Set(['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'EBikeRide', 'EMountainBikeRide', 'Velomobile']);

function withPw(pw?: string): HeadersInit {
  return pw ? { 'x-app-password': pw } : {};
}

export async function stravaStatus(pw?: string): Promise<StravaStatus | null> {
  try {
    const r = await fetch('api/strava/status', { headers: withPw(pw) });
    if (!r.ok) return null;
    return (await r.json()) as StravaStatus;
  } catch {
    return null;
  }
}

export async function stravaDisconnect(pw?: string): Promise<void> {
  await fetch('api/strava/disconnect', { method: 'POST', headers: { ...withPw(pw), 'x-ta': '1' } });
}

export function normalizeStrava(a: RawStrava, profile: AthleteProfile | null): Activity {
  const type = a.sport_type || a.type || 'Other';
  const hours = a.moving_time / 3600;
  let tss: number | null = null;
  let intensity: number | null = null;
  const ftp = profile?.ftp;
  if (ftp && a.device_watts && (a.weighted_average_watts || a.average_watts)) {
    intensity = (a.weighted_average_watts ?? a.average_watts!) / ftp;
    tss = Math.round(hours * intensity * intensity * 100);
  } else if (a.average_heartrate && profile?.lthr && profile.restingHr) {
    const hrIf = Math.max(0.3, (a.average_heartrate - profile.restingHr) / (profile.lthr - profile.restingHr));
    intensity = Math.min(1.1, hrIf);
    tss = Math.round(hours * intensity * intensity * 100);
  } else if (a.suffer_score) {
    tss = a.suffer_score; // rough proxy
  }
  return {
    id: `strava-${a.id}`,
    date: a.start_date_local.slice(0, 10),
    startTime: a.start_date_local,
    name: a.name,
    type,
    isRide: RIDE.has(type),
    isStrength: type === 'WeightTraining',
    movingSec: a.moving_time,
    tss,
    intensity: intensity != null ? Math.round(intensity * 100) / 100 : null,
    normalizedPower: a.weighted_average_watts ?? null,
    avgHr: a.average_heartrate ?? null,
    powerZoneSecs: null,
    hrZoneSecs: null,
    source: 'strava',
    stravaId: String(a.id),
  };
}

export async function stravaActivities(afterEpoch: number, profile: AthleteProfile | null, pw?: string): Promise<Activity[]> {
  const r = await fetch(`api/strava/activities?after=${afterEpoch}`, { headers: withPw(pw) });
  if (!r.ok) throw new Error(`Strava: ${(await r.json().catch(() => ({}))).error ?? r.statusText}`);
  const raw = (await r.json()) as RawStrava[];
  return raw.map((a) => normalizeStrava(a, profile));
}

/** Merge: intervals.icu wins; Strava fills stubs and missing activities. */
export function mergeActivities(icu: Activity[], strava: Activity[]): { merged: Activity[]; filled: number; added: number } {
  const merged = [...icu];
  let filled = 0;
  let added = 0;
  for (const s of strava) {
    const idx = merged.findIndex(
      (a) =>
        (a.stravaId && a.stravaId === s.stravaId) ||
        (a.date === s.date &&
          a.startTime &&
          s.startTime &&
          Math.abs(new Date(a.startTime).getTime() - new Date(s.startTime).getTime()) < 15 * 60_000 &&
          diffDays(a.date, s.date) === 0),
    );
    if (idx >= 0) {
      const a = merged[idx];
      if (a.limited || a.tss == null) {
        merged[idx] = { ...s, id: a.id };
        filled++;
      }
    } else {
      merged.push(s);
      added++;
    }
  }
  return { merged, filled, added };
}
