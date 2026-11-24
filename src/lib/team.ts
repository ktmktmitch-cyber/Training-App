import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, diffDays } from '../engine/dates';
import { parseTeamData, riderFromData, riderMetrics, withLiveActivities, type DeepRider, type RiderMetrics, type TeamData, type TeamFeedItem } from '../engine/team';
import { demoData, type DemoOpts } from './demo';
import { fetchAthleteData, fetchEvents } from './intervals';
import { readDoc } from './cloudSync';
import { load, save } from './storage';
import { useApp } from './store';

/** team.json published by the team-dashboard repository's GitHub Action. Every user of
 * the app reads this same file, so the Team tab shows the same standings for everyone. */
export const DEFAULT_TEAM_URL = 'https://raw.githubusercontent.com/ktmktmitch-cyber/team-dashboard/main/data/team.json';

const K_TEAM = 'ta.team.v1';
const K_DEEP = 'ta.teamdeep.v1';

/** intervals.icu refused because the rider hasn't added this key's athlete as a coach. */
export const isNotShared = (e: Error) => /\b(401|403)\b|forbidden|unauthori[sz]ed|permission|access denied/i.test(e.message);

export async function fetchTeam(url: string): Promise<TeamData> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    throw new Error(`Couldn’t reach the team data URL (${(e as Error).message}).`);
  }
  if (!res.ok) throw new Error(`Team data URL returned ${res.status}. Check Settings → Team.`);
  return parseTeamData(await res.json());
}

const DEMO_RIDERS: [string, string, DemoOpts][] = [
  ['demo-1', 'Alex', { seed: 11, scale: 1.2, ftp: 300, weightKg: 72 }],
  ['demo-2', 'Sam', { seed: 23, scale: 0.8, ftp: 240, weightKg: 64 }],
  ['demo-3', 'Jordan', { seed: 37, scale: 1.0, ftp: 278, weightKg: 79 }],
  ['demo-4', 'Riley', { seed: 51, scale: 0.6, ftp: 215, weightKg: 70, stopDaysAgo: 11 }],
  ['demo-5', 'Casey', { seed: 67, scale: 1.45, ftp: 322, weightKg: 75 }],
];

export function demoTeam(asOf: string): { team: TeamData; deep: Record<string, DeepRider> } {
  const deep: Record<string, DeepRider> = {};
  const riders = DEMO_RIDERS.map(([id, name, opts]) => {
    const d = demoData(asOf, opts);
    deep[id] = { activities: d.activities, wellness: d.wellness, profile: d.profile, fetchedAt: new Date().toISOString() };
    const r = riderFromData(id, name, d.activities, d.wellness, d.profile, asOf);
    if (id === 'demo-1' || id === 'demo-5') {
      r.p5s_pr = true;
      r.p12m_pr = id === 'demo-5';
      r.prs = [
        { rider: name, duration: '5 s', watts: r.p5s ?? 0, wkg: r.p5s && opts.weightKg ? Math.round((r.p5s / opts.weightKg) * 10) / 10 : null, date: addDays(asOf, -6), ride: 'Group ride' },
        ...(id === 'demo-5' ? [{ rider: name, duration: '12 min', watts: r.p12m ?? 0, wkg: r.p12m ? Math.round((r.p12m / 75) * 10) / 10 : null, date: addDays(asOf, -3), ride: 'Threshold 3×12' }] : []),
      ];
    }
    return r;
  });
  const feed: TeamFeedItem[] = riders
    .flatMap((r) => r.recent_rides.filter((a) => diffDays(asOf, a.date) < 14).map((a) => ({ rider: r.rider, start: a.start, date: a.date, name: a.name, type: a.type, hours: a.hours, miles: a.miles, load: a.load })))
    .sort((a, b) => b.start.localeCompare(a.start))
    .slice(0, 30);
  return { team: { updated: 'demo data', today: asOf, riders: riders.concat([{ ...riders[0], id: 'demo-6', rider: 'Taylor', state: 'blocked' }]), feed }, deep };
}

export interface TeamState {
  team: TeamData | null;
  metrics: Record<string, RiderMetrics>;
  deep: Record<string, DeepRider>;
  loading: boolean;
  error: string | null;
  deepProgress: { done: number; total: number } | null;
  deepAvailable: boolean;
  refresh: () => Promise<void>;
  loadDeep: () => Promise<void>;
  source: 'demo' | 'url';
}

export function useTeam(): TeamState {
  const app = useApp();
  const demo = app.settings.demo;
  const url = DEFAULT_TEAM_URL;
  const [team, setTeam] = useState<TeamData | null>(() => (demo ? null : load<TeamData | null>(K_TEAM, null)));
  const [deep, setDeep] = useState<Record<string, DeepRider>>(() => (demo ? {} : load<Record<string, DeepRider>>(K_DEEP, {})));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deepProgress, setDeepProgress] = useState<{ done: number; total: number } | null>(null);
  const demoSet = useMemo(() => (demo ? demoTeam(app.asOf) : null), [demo, app.asOf]);

  const refresh = useCallback(async () => {
    if (demo) return;
    setLoading(true);
    setError(null);
    try {
      const t = await fetchTeam(url);
      setTeam(t);
      save(K_TEAM, t);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [demo, url]);

  useEffect(() => {
    if (!demo && (!team || Date.now() - (load<number>(`${K_TEAM}.at`, 0) || 0) > 30 * 60_000)) {
      save(`${K_TEAM}.at`, Date.now());
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, url]);

  const currentDeep = demoSet?.deep ?? deep;
  // Add rides synced since the last team update: yours from your live data, coached riders' from their loaded details
  const myId = app.data.profile?.id ?? null;
  const myActs = app.data.activities;
  const current = useMemo(() => {
    const base = demoSet?.team ?? team;
    if (!base || demoSet) return base;
    const live: Record<string, import('../engine/types').Activity[]> = {};
    for (const [id, d] of Object.entries(deep)) if (!d.error && d.activities.length) live[id] = d.activities;
    if (myId && myActs.length) live[myId] = myActs;
    return withLiveActivities(base, live);
  }, [demoSet, team, deep, myId, myActs]);
  // Detailed per-rider health data (HRV, readiness) is for the coach only
  const deepAvailable = !demo && app.canPush && (!app.account || app.account.role === 'coach');

  const loadDeep = useCallback(async () => {
    if (!current || demo) return;
    const ids = current.riders.filter((r) => r.state === 'ok').map((r) => r.id);
    const conn = app.getConnection();
    const asOf = app.asOf;
    const out: Record<string, DeepRider> = { ...deep };
    setDeepProgress({ done: 0, total: ids.length });
    let done = 0;
    const queue = [...ids];
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift()!;
        try {
          // One retry after a short pause for anything but "not shared" (throttling, network blips)
          const d = await fetchAthleteData(conn, id, addDays(asOf, -63), asOf).catch(async (e: Error) => {
            if (isNotShared(e)) throw e;
            await new Promise((r) => setTimeout(r, 1500));
            return fetchAthleteData(conn, id, addDays(asOf, -63), asOf);
          });
          // Calendar (sick/injured/holiday days) and their synced app settings (planned breaks) — best effort
          const rc = { ...conn, athleteId: id };
          const [events, doc] = await Promise.all([fetchEvents(rc, addDays(asOf, -28), addDays(asOf, 90)).catch(() => undefined), readDoc(rc).catch(() => null)]);
          const st = doc?.data;
          const goal = (st?.settings as { goal?: { restWeeks?: string[]; awayWeeks?: string[]; offRanges?: { start: string; end: string; note?: string }[] }; prefs?: { sport?: string } } | undefined) ?? {};
          const sickDays = [
            ...Object.entries((st?.checkins ?? {}) as Record<string, { feel?: string }>).filter(([, c]) => c.feel === 'sick').map(([d]) => d),
            ...Object.entries((st?.journal ?? {}) as Record<string, string[]>).filter(([, t]) => t.includes('illness')).map(([d]) => d),
          ];
          out[id] = {
            ...d,
            events,
            plan: doc ? { restWeeks: goal.goal?.restWeeks ?? [], awayWeeks: goal.goal?.awayWeeks ?? [], offRanges: goal.goal?.offRanges ?? [], sickDays, sport: goal.prefs?.sport } : null,
            fetchedAt: new Date().toISOString(),
          };
        } catch (e) {
          const err = e as Error;
          const prev = out[id];
          // Keep the last good data if this was just a temporary failure
          if (prev && !prev.error && !isNotShared(err)) out[id] = { ...prev, stale: true };
          else out[id] = { activities: [], wellness: [], profile: null, fetchedAt: new Date().toISOString(), error: err.message, notShared: isNotShared(err) };
        }
        done++;
        setDeepProgress({ done, total: ids.length });
      }
    };
    await Promise.all([worker(), worker()]);
    setDeepProgress(null);
    const fresh = ids.map((id) => out[id]);
    if (fresh.length && fresh.every((d) => d.error)) {
      setError('Rider details are coach-only — they need the coach’s intervals.icu key. The standings above are the same for everyone.');
      return;
    }
    setDeep(out);
    save(K_DEEP, out);
  }, [current, demo, app, deep]);

  const metrics = useMemo(() => {
    const m: Record<string, RiderMetrics> = {};
    if (!current) return m;
    const asOf = current.today || app.asOf;
    for (const r of current.riders) if (r.state === 'ok') m[r.id] = riderMetrics(r, asOf, currentDeep[r.id]);
    return m;
  }, [current, currentDeep, app.asOf]);

  return { team: current, metrics, deep: currentDeep, loading, error, deepProgress, deepAvailable, refresh, loadDeep, source: demo ? 'demo' : 'url' };
}
