import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, diffDays } from '../engine/dates';
import { parseTeamData, riderFromData, riderMetrics, type DeepRider, type RiderMetrics, type TeamData, type TeamFeedItem } from '../engine/team';
import { demoData, type DemoOpts } from './demo';
import { fetchAthleteData } from './intervals';
import { load, save } from './storage';
import { useApp } from './store';

/** team.json published by the team-dashboard repository's GitHub Action. */
export const DEFAULT_TEAM_URL = 'https://raw.githubusercontent.com/ktmktmitch-cyber/team-dashboard/main/data/team.json';

const K_TEAM = 'ta.team.v1';
const K_DEEP = 'ta.teamdeep.v1';

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
  const url = app.settings.teamUrl || DEFAULT_TEAM_URL;
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

  const current = demoSet?.team ?? team;
  const currentDeep = demoSet?.deep ?? deep;
  const deepAvailable = !demo && app.canPush;

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
          const d = await fetchAthleteData(conn, id, addDays(asOf, -63), asOf);
          out[id] = { ...d, fetchedAt: new Date().toISOString() };
        } catch (e) {
          out[id] = { activities: [], wellness: [], profile: null, fetchedAt: new Date().toISOString(), error: (e as Error).message };
        }
        done++;
        setDeepProgress({ done, total: ids.length });
      }
    };
    await Promise.all([worker(), worker()]);
    setDeep(out);
    save(K_DEEP, out);
    setDeepProgress(null);
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
