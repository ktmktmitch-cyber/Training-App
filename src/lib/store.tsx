import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { addDays, dow, range, today } from '../engine/dates';
import { allExternalIdsFor, dayToIcuEvents } from '../engine/icuExport';
import { buildMacroPlan } from '../engine/periodization';
import { planWeek } from '../engine/planner';
import { assessReadiness } from '../engine/readiness';
import { computeTrends } from '../engine/trends';
import type {
  Activity,
  AthleteProfile,
  CalendarEvent,
  CheckIn,
  DayConfig,
  GoalSettings,
  ISODate,
  MacroPlan,
  PlannerPrefs,
  Readiness,
  StrengthSettings,
  Trends,
  WeekConfig,
  WeekPlan,
  Wellness,
} from '../engine/types';
import { DEFAULT_PREFS, DEFAULT_STRENGTH, defaultGoal } from './defaults';
import { demoData } from './demo';
import { fetchAll, pushEvents, testConnection, type Connection } from './intervals';
import { load, save } from './storage';
import { mergeActivities, stravaActivities, stravaStatus, type StravaStatus } from './strava';

export interface ConnectionSettings {
  mode: 'auto' | 'proxy' | 'direct';
  apiKey: string;
  athleteId: string;
  appPassword: string;
  useStrava: boolean;
}

export interface AppSettings {
  connection: ConnectionSettings;
  demo: boolean;
  goal: GoalSettings;
  strength: StrengthSettings;
  prefs: PlannerPrefs;
  ftpOverride: number | null;
  usualHours: number;
  usualDays: Partial<Record<number, DayConfig>>;
  startOffset: 0 | 1; // plan from today (0) or tomorrow (1)
}

export interface DataState {
  profile: AthleteProfile | null;
  activities: Activity[];
  wellness: Wellness[];
  events: CalendarEvent[];
  source: 'demo' | 'intervals' | 'none';
  lastSync: string | null;
  info: string | null;
}

export interface ServerInfo {
  proxy: boolean;
  authRequired: boolean;
  authed: boolean;
  serverIcuKey: boolean;
  serverAthleteId: string | null;
  strava: boolean;
}

const K = {
  settings: 'ta.settings.v1',
  weeks: 'ta.weeks.v1',
  checkins: 'ta.checkins.v1',
  data: 'ta.data.v1',
};

function initialSettings(): AppSettings {
  const t = today();
  const stored = load<Partial<AppSettings> | null>(K.settings, null);
  const base: AppSettings = {
    connection: { mode: 'auto', apiKey: '', athleteId: '', appPassword: '', useStrava: false },
    demo: true,
    goal: defaultGoal(t),
    strength: DEFAULT_STRENGTH,
    prefs: DEFAULT_PREFS,
    ftpOverride: null,
    usualHours: 8,
    usualDays: {},
    startOffset: 1,
  };
  if (!stored) return base;
  return {
    ...base,
    ...stored,
    connection: { ...base.connection, ...stored.connection },
    goal: { ...base.goal, ...stored.goal },
    strength: { ...base.strength, ...stored.strength },
    prefs: { ...base.prefs, ...stored.prefs },
  };
}

const EMPTY_DATA: DataState = { profile: null, activities: [], wellness: [], events: [], source: 'none', lastSync: null, info: null };

interface Ctx {
  settings: AppSettings;
  updateSettings: (fn: (s: AppSettings) => AppSettings) => void;
  data: DataState;
  server: ServerInfo | null;
  strava: StravaStatus | null;
  syncing: boolean;
  syncError: string | null;
  sync: () => Promise<void>;
  test: () => Promise<string>;
  asOf: ISODate;
  startDate: ISODate;
  week: WeekConfig;
  setWeek: (w: WeekConfig) => void;
  saveAsUsual: (w: WeekConfig) => void;
  resetWeek: () => void;
  checkIn: CheckIn | null;
  setCheckIn: (c: CheckIn | null) => void;
  profile: AthleteProfile | null;
  ftp: number;
  macro: MacroPlan;
  readiness: Readiness;
  trends: Trends;
  plan: WeekPlan;
  push: (plan: WeekPlan) => Promise<string>;
  canPush: boolean;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [weeks, setWeeks] = useState<Record<ISODate, WeekConfig>>(() => load(K.weeks, {}));
  const [checkins, setCheckins] = useState<Record<ISODate, CheckIn>>(() => load(K.checkins, {}));
  const [stored, setStored] = useState<DataState>(() => load(K.data, EMPTY_DATA));
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [strava, setStrava] = useState<StravaStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState(today());

  useEffect(() => save(K.settings, settings), [settings]);
  useEffect(() => save(K.weeks, weeks), [weeks]);
  useEffect(() => save(K.checkins, checkins), [checkins]);

  // Refresh "today" when the tab regains focus (app left open overnight)
  useEffect(() => {
    const f = () => setAsOf(today());
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);

  // Detect the bundled server (proxy + Strava)
  useEffect(() => {
    const pw = settings.connection.appPassword;
    if (pw) document.cookie = `app_pw=${encodeURIComponent(pw)}; path=/; max-age=31536000; SameSite=Lax`;
    fetch('api/health', { headers: pw ? { 'x-app-password': pw } : {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        setServer(j && j.proxy ? (j as ServerInfo) : null);
        if (j?.strava) stravaStatus(pw).then(setStrava);
      })
      .catch(() => setServer(null));
  }, [settings.connection.appPassword]);

  const updateSettings = useCallback((fn: (s: AppSettings) => AppSettings) => setSettings((s) => fn(s)), []);

  const demo = useMemo(() => demoData(asOf), [asOf]);
  const data: DataState = settings.demo
    ? { ...demo, source: 'demo', lastSync: null, info: 'Demo data — connect intervals.icu in Settings to use your own.' }
    : stored;

  const connection = useCallback((): Connection => {
    const c = settings.connection;
    const useProxy = c.mode === 'proxy' || (c.mode === 'auto' && server?.proxy);
    return {
      base: useProxy ? 'api/icu' : 'https://intervals.icu/api/v1',
      apiKey: c.apiKey.trim(),
      athleteId: c.athleteId.trim() || server?.serverAthleteId || '0',
      appPassword: c.appPassword || undefined,
    };
  }, [settings.connection, server]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const conn = connection();
      if (!conn.apiKey && !server?.serverIcuKey) throw new Error('Add your intervals.icu API key in Settings first.');
      const oldest = addDays(asOf, -120);
      const res = await fetchAll(conn, oldest, asOf, addDays(asOf, 365));
      let activities = res.activities;
      let info: string | null = null;
      const limited = activities.filter((a) => a.limited).length;
      if (settings.connection.useStrava && strava?.connected) {
        try {
          const after = Math.floor(new Date(`${oldest}T00:00:00`).getTime() / 1000);
          const st = await stravaActivities(after, res.profile, settings.connection.appPassword || undefined);
          const m = mergeActivities(activities, st);
          activities = m.merged;
          info = `Strava filled ${m.filled} stub(s) and added ${m.added} activit${m.added === 1 ? 'y' : 'ies'}.`;
        } catch (e) {
          info = `Strava fetch failed: ${(e as Error).message}`;
        }
      } else if (limited > 0) {
        info = `${limited} activit${limited === 1 ? 'y' : 'ies'} came from Strava and are hidden by intervals.icu's API. Connect Garmin directly in intervals.icu, or enable Strava here.`;
      }
      const next: DataState = { ...res, activities, source: 'intervals', lastSync: new Date().toISOString(), info };
      setStored(next);
      save(K.data, next);
      setSettings((s) => ({ ...s, demo: false }));
    } catch (e) {
      setSyncError((e as Error).message);
      throw e;
    } finally {
      setSyncing(false);
    }
  }, [connection, server, asOf, settings.connection.useStrava, settings.connection.appPassword, strava]);

  const test = useCallback(async () => testConnection(connection()), [connection]);

  // Auto-sync once per session if connected and data is stale (> 3 h)
  useEffect(() => {
    if (settings.demo) return;
    const age = stored.lastSync ? Date.now() - new Date(stored.lastSync).getTime() : Infinity;
    if (age > 3 * 3600_000 && (settings.connection.apiKey || server?.serverIcuKey)) sync().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, settings.demo]);

  const startDate = addDays(asOf, settings.startOffset);

  const makeWeek = useCallback(
    (start: ISODate): WeekConfig => {
      const days: Record<ISODate, DayConfig> = {};
      for (const d of range(start, 7)) {
        const u = settings.usualDays[dow(d)];
        if (u) days[d] = { ...u };
      }
      return { startDate: start, hours: settings.usualHours, days };
    },
    [settings.usualDays, settings.usualHours],
  );

  const week = weeks[startDate] ?? makeWeek(startDate);
  const setWeek = useCallback((w: WeekConfig) => setWeeks((all) => ({ ...all, [w.startDate]: w })), []);
  const resetWeek = useCallback(() => setWeeks((all) => {
    const n = { ...all };
    delete n[startDate];
    return n;
  }), [startDate]);
  const saveAsUsual = useCallback(
    (w: WeekConfig) => {
      const usual: Partial<Record<number, DayConfig>> = {};
      for (const d of range(w.startDate, 7)) {
        const c = w.days[d];
        // Keep recurring things (blocked days, group rides, time caps); not one-off pins/races
        if (c && (c.status === 'off' || c.status === 'group' || c.maxMinutes != null || c.noLift))
          usual[dow(d)] = c.status === 'pinned' || c.status === 'race' ? { status: 'available', maxMinutes: c.maxMinutes } : c;
      }
      setSettings((s) => ({ ...s, usualHours: w.hours, usualDays: usual }));
    },
    [],
  );

  const checkIn = checkins[asOf] ?? null;
  const setCheckIn = useCallback(
    (c: CheckIn | null) =>
      setCheckins((all) => {
        const n = { ...all };
        if (c) n[c.date] = c;
        else delete n[asOf];
        return n;
      }),
    [asOf],
  );

  const profile = data.profile;
  const ftp = settings.ftpOverride ?? profile?.ftp ?? profile?.eftp ?? 250;
  const effProfile = useMemo<AthleteProfile | null>(() => (profile ? { ...profile, ftp } : null), [profile, ftp]);

  const macro = useMemo(() => buildMacroPlan(settings.goal, data.events, asOf), [settings.goal, data.events, asOf]);
  const readiness = useMemo(
    () => assessReadiness(data.wellness, asOf, { checkIn, model: settings.goal.model }),
    [data.wellness, asOf, checkIn, settings.goal.model],
  );
  const trends = useMemo(() => computeTrends(data.activities, data.wellness, asOf), [data.activities, data.wellness, asOf]);
  const plan = useMemo(
    () =>
      planWeek({
        startDate,
        asOf,
        week,
        goal: settings.goal,
        macro,
        prefs: settings.prefs,
        strength: settings.strength,
        readiness,
        trends,
        profile: effProfile ?? {
          id: 'none',
          name: 'Athlete',
          ftp,
          eftp: null,
          lthr: null,
          maxHr: null,
          restingHr: null,
          weightKg: null,
          powerZones: [55, 75, 90, 105, 120, 150, 999],
          hrZones: [],
        },
        events: data.events,
      }),
    [startDate, asOf, week, settings.goal, macro, settings.prefs, settings.strength, readiness, trends, effProfile, ftp, data.events],
  );

  const canPush = !settings.demo && (Boolean(settings.connection.apiKey) || Boolean(server?.serverIcuKey));

  const push = useCallback(
    async (p: WeekPlan) => {
      const conn = connection();
      const prof = effProfile!;
      const events = p.days.flatMap((d) => dayToIcuEvents(d, prof, settings.prefs.targetMode));
      const keep = new Set(events.map((e) => e.external_id));
      const stale = p.days.flatMap((d) => allExternalIdsFor(d.date)).filter((id) => !keep.has(id));
      const n = await pushEvents(conn, events, stale);
      return `Sent ${n} workout${n === 1 ? '' : 's'} to your intervals.icu calendar. They sync on to Garmin Connect if "Upload planned workouts" is on in intervals.icu.`;
    },
    [connection, effProfile, settings.prefs.targetMode],
  );

  const value: Ctx = {
    settings,
    updateSettings,
    data,
    server,
    strava,
    syncing,
    syncError,
    sync,
    test,
    asOf,
    startDate,
    week,
    setWeek,
    saveAsUsual,
    resetWeek,
    checkIn,
    setCheckIn,
    profile: effProfile,
    ftp,
    macro,
    readiness,
    trends,
    plan,
    push,
    canPush,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
