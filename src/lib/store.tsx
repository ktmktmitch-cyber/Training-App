import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { addDays, diffDays, dow, range, today } from '../engine/dates';
import { computeCompliance, missedKeySessions, type ComplianceDay, type PlanSnapshot } from '../engine/compliance';
import { allExternalIdsFor, dayToIcuEvents, ICU_TYPE, workoutDescription, EXTERNAL_PREFIX } from '../engine/icuExport';
import { affectedMornings, tagImpacts, type Journal, type MorningEffect, type TagImpact, type TagKey } from '../engine/journal';
import { computeLoadFocus, type LoadFocus } from '../engine/loadFocus';
import { analyzePerformance, type PerformanceAnalysis } from '../engine/performance';
import { computeStaleness, type Staleness } from '../engine/staleness';
import { isHardSession } from '../engine/trends';
import { heatAdaptation, type HeatAdaptation } from '../engine/heat';
import { estimateVo2, type Vo2Estimate } from '../engine/vo2max';
import { powerProfile, type PowerProfile } from '../engine/powerProfile';
import { computeProgression, type Feedback, type Progression } from '../engine/progression';
import { trainingStatus, type TrainingStatus } from '../engine/status';
import { buildMacroPlan, macroWeekFor, withAppRaces, withAwayWeeks } from '../engine/periodization';
import { deviceName, flatten, mergeDocs, readDoc, restamp, syncRaces, trim, unflatten, writeDoc, type SyncState } from './cloudSync';
import { planWeek } from '../engine/planner';
import { applySecondSessions, applySports, bikeHoursFor } from '../engine/multisport';
import { targetsLabel, type ExportTargets } from '../engine/targets';
import { assessReadiness } from '../engine/readiness';
import { computeTrends } from '../engine/trends';
import type {
  Activity,
  AthleteProfile,
  CalendarEvent,
  CheckIn,
  DayConfig,
  PlannedRace,
  PlannedWorkout,
  PowerCurve,
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
import { useAuth, type PublicUser, type ServerInfo } from './auth';
import { DEFAULT_PREFS, DEFAULT_STRENGTH, defaultGoal } from './defaults';
import { demoData, demoJournal, demoSnapshots } from './demo';
import { fetchAll, fetchEvents, pushEvents, testConnection, type Connection } from './intervals';
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
  teamUrl: string; // team-dashboard data/team.json
  cloudSync?: boolean; // sync settings across devices via intervals.icu (default on)
  shareJournalWithCoach?: boolean; // let coaches see your journal in their Team tab (default off)
}

export interface DataState {
  profile: AthleteProfile | null;
  activities: Activity[];
  wellness: Wellness[];
  events: CalendarEvent[];
  powerCurves?: PowerCurve[];
  source: 'demo' | 'intervals' | 'none';
  lastSync: string | null;
  info: string | null;
}

export type { ServerInfo } from './auth';

/** localStorage keys, namespaced per signed-in user ('local' keeps the original single-user keys). */
function keysFor(ns: string) {
  const p = ns === 'local' ? 'ta.' : `ta.${ns}.`;
  return {
    settings: `${p}settings.v1`,
    weeks: `${p}weeks.v1`,
    checkins: `${p}checkins.v1`,
    data: `${p}data.v1`,
    feedback: `${p}feedback.v1`,
    history: `${p}history.v1`,
    journal: `${p}journal.v1`,
    stamps: `${p}syncstamps.v1`,
    scheduled: `${p}scheduled.v1`,
  };
}
type Keys = ReturnType<typeof keysFor>;

/** What follows a signed-in user across devices (stored on the server with their account). */
export interface CloudStatus {
  state: 'off' | 'syncing' | 'on' | 'error';
  at: string | null;
  error: string | null;
}

interface RemoteState {
  settings?: Partial<AppSettings>;
  weeks?: Record<ISODate, WeekConfig>;
  checkins?: Record<ISODate, CheckIn>;
  feedback?: Record<string, Feedback>;
  history?: Record<ISODate, PlanSnapshot>;
  journal?: Journal;
  scheduled?: Record<ISODate, Scheduled>;
}

export interface Scheduled {
  workoutId: string;
  durationMin: number;
  level: number;
}

function initialSettings(K: Keys, remote: RemoteState | null, _signedIn: boolean, _guest: boolean): AppSettings {
  const t = today();
  const stored = remote?.settings ?? load<Partial<AppSettings> | null>(K.settings, null);
  const base: AppSettings = {
    connection: { mode: 'auto', apiKey: '', athleteId: '', appPassword: '', useStrava: false },
    demo: false, // no example data: pages ask you to connect intervals.icu
    goal: defaultGoal(t),
    strength: DEFAULT_STRENGTH,
    prefs: DEFAULT_PREFS,
    ftpOverride: null,
    usualHours: 8,
    usualDays: {},
    startOffset: 1,
    teamUrl: '',
  };
  if (!stored) return base;
  const merged: AppSettings = {
    ...base,
    ...stored,
    connection: { ...base.connection, ...stored.connection },
    goal: { ...base.goal, ...stored.goal },
    strength: { ...base.strength, ...stored.strength },
    prefs: { ...base.prefs, ...stored.prefs },
  };
  return { ...merged, demo: false };
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
  progression: Progression;
  loadFocus: LoadFocus;
  status: TrainingStatus;
  compliance: ComplianceDay[];
  power: PowerProfile | null;
  powerCurves: PowerCurve[];
  heat: HeatAdaptation;
  cloud: CloudStatus;
  cloudSyncNow: () => Promise<void>;
  /** intervals.icu calendar + races added in the app */
  events: CalendarEvent[];
  /** what the app planned for past days (for planned-vs-done) */
  snapshots: Record<ISODate, PlanSnapshot>;
  feedback: Record<string, Feedback>;
  setFeedback: (activityId: string, f: Feedback | null) => void;
  journal: Journal;
  setJournalTags: (date: ISODate, tags: TagKey[]) => void;
  effects: Record<ISODate, MorningEffect>;
  impacts: TagImpact[];
  performance: PerformanceAnalysis;
  scheduled: Record<ISODate, Scheduled>;
  schedule: (date: ISODate, s: Scheduled | null) => void;
  pushWorkout: (date: ISODate, w: PlannedWorkout, targets?: ExportTargets) => Promise<string>;
  /** Default export targets: power from your eFTP (falls back to FTP), HR from your LTHR. */
  exportDefaults: ExportTargets;
  getConnection: () => Connection;
  account: PublicUser | null;
  guest: boolean;
  vo2: Vo2Estimate;
  vo2History: { date: ISODate; vo2: number }[];
  staleness: Staleness;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const account = auth.user;
  const guest = !account && auth.guest;
  const [K] = useState<Keys>(() => keysFor(account ? `u.${account.id}` : guest ? 'guest' : 'local'));
  const [remote] = useState<RemoteState | null>(() => (account ? (auth.remoteState as RemoteState | null) : null));
  const [settings, setSettings] = useState<AppSettings>(() => initialSettings(K, remote, Boolean(account), guest));
  const [weeks, setWeeks] = useState<Record<ISODate, WeekConfig>>(() => remote?.weeks ?? load(K.weeks, {}));
  const [checkins, setCheckins] = useState<Record<ISODate, CheckIn>>(() => remote?.checkins ?? load(K.checkins, {}));
  const [stored, setStored] = useState<DataState>(() => load(K.data, EMPTY_DATA));
  const server: ServerInfo | null = auth.server;
  const [strava, setStrava] = useState<StravaStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState(today());
  const [feedback, setFeedbackState] = useState<Record<string, Feedback>>(() => remote?.feedback ?? load(K.feedback, {}));
  const [history, setHistory] = useState<Record<ISODate, PlanSnapshot>>(() => remote?.history ?? load(K.history, {}));
  const [journalState, setJournalState] = useState<Journal>(() => remote?.journal ?? load(K.journal, {}));
  const [scheduled, setScheduled] = useState<Record<ISODate, Scheduled>>(() => remote?.scheduled ?? load(K.scheduled, {}));
  useEffect(() => save(K.journal, journalState), [journalState]);
  useEffect(() => save(K.scheduled, scheduled), [scheduled]);
  const setJournalTags = useCallback(
    (date: ISODate, tags: TagKey[]) =>
      setJournalState((j) => {
        const n = { ...j };
        if (tags.length) n[date] = tags;
        else delete n[date];
        return n;
      }),
    [],
  );
  const schedule = useCallback(
    (date: ISODate, sch: Scheduled | null) =>
      setScheduled((all) => {
        const n = { ...all };
        if (sch) n[date] = sch;
        else delete n[date];
        return n;
      }),
    [],
  );
  useEffect(() => save(K.feedback, feedback), [feedback]);
  useEffect(() => save(K.history, history), [history]);
  const setFeedback = useCallback(
    (id: string, f: Feedback | null) =>
      setFeedbackState((all) => {
        const n = { ...all };
        if (f) n[id] = f;
        else delete n[id];
        return n;
      }),
    [],
  );

  useEffect(() => save(K.settings, settings), [K, settings]);
  useEffect(() => save(K.weeks, weeks), [K, weeks]);
  useEffect(() => save(K.checkins, checkins), [K, checkins]);

  // Signed-in users: everything personal follows them to other devices
  const { saveRemote } = auth;
  useEffect(() => {
    if (!account) return;
    saveRemote({
      settings: { ...settings, connection: { ...settings.connection, apiKey: '', appPassword: '' } },
      weeks,
      checkins,
      feedback,
      history,
      journal: journalState,
      scheduled,
    });
  }, [account, saveRemote, settings, weeks, checkins, feedback, history, journalState, scheduled]);

  // Refresh "today" when the tab regains focus (app left open overnight)
  useEffect(() => {
    const f = () => setAsOf(today());
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);

  // Strava status (server feature)
  useEffect(() => {
    const pw = settings.connection.appPassword;
    if (pw) document.cookie = `app_pw=${encodeURIComponent(pw)}; path=/; max-age=31536000; SameSite=Lax`;
    if (server?.strava) stravaStatus(pw).then(setStrava);
  }, [settings.connection.appPassword, server]);

  const updateSettings = useCallback((fn: (s: AppSettings) => AppSettings) => setSettings((s) => fn(s)), []);

  const demo = useMemo(() => demoData(asOf), [asOf]);
  const data: DataState = settings.demo
    ? { ...demo, source: 'demo', lastSync: null, info: 'Demo data — connect intervals.icu in Settings to use your own.' }
    : stored;

  const connection = useCallback((): Connection => {
    // Signed in: the server holds your intervals.icu credentials and injects them
    if (account) return { base: 'api/icu', apiKey: '', athleteId: account.id };
    const c = settings.connection;
    const useProxy = c.mode === 'proxy' || (c.mode === 'auto' && server?.proxy);
    return {
      base: useProxy ? 'api/icu' : 'https://intervals.icu/api/v1',
      apiKey: c.apiKey.trim(),
      athleteId: c.athleteId.trim() || server?.serverAthleteId || '0',
      appPassword: c.appPassword || undefined,
    };
  }, [settings.connection, server, account]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const conn = connection();
      if (!conn.apiKey && !server?.serverIcuKey && !account) throw new Error('Add your intervals.icu API key in Settings first.');
      const oldest = addDays(asOf, -120);
      const res = await fetchAll(conn, oldest, asOf, addDays(asOf, 365));
      let activities = res.activities;
      let info: string | null = null;
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
      } // Strava-hidden activities are explained by the missing-data notes on each page
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
  }, [connection, server, account, asOf, settings.connection.useStrava, settings.connection.appPassword, strava]);

  const test = useCallback(async () => testConnection(connection()), [connection]);

  // Auto-sync once per session if connected and data is stale (> 3 h)
  useEffect(() => {
    if (settings.demo) return;
    const age = stored.lastSync ? Date.now() - new Date(stored.lastSync).getTime() : Infinity;
    if (age > 3 * 3600_000 && (settings.connection.apiKey || server?.serverIcuKey || account)) sync().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, settings.demo]);

  // ---------- Sync across devices via a hidden note on intervals.icu (no server needed) ----------
  const hasKey = Boolean(settings.connection.apiKey || server?.serverIcuKey);
  const cloudOn = !account && !guest && !settings.demo && hasKey && settings.cloudSync !== false;
  const [cloud, setCloud] = useState<CloudStatus>({ state: 'off', at: null, error: null });
  const syncState: SyncState = useMemo(
    () => ({ settings: settings as unknown as Record<string, unknown>, weeks, checkins, feedback, history, journal: journalState, scheduled }),
    [settings, weeks, checkins, feedback, history, journalState, scheduled],
  );
  const flat = useMemo(() => flatten(syncState), [syncState]);
  const prevFlat = useRef<Record<string, string> | null>(null);
  const stampsRef = useRef<Record<string, number>>(load(K.stamps, {}));
  const applying = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const flatRef = useRef(flat);
  flatRef.current = flat;

  // Stamp every item that changed on this device
  useEffect(() => {
    if (prevFlat.current && !applying.current) {
      stampsRef.current = restamp(prevFlat.current, flat, stampsRef.current);
      save(K.stamps, stampsRef.current);
    }
    applying.current = false;
    prevFlat.current = flat;
  }, [flat, K]);

  const applyItems = useCallback((items: Record<string, string>) => {
    const st = unflatten(items);
    applying.current = true;
    const rs = (st.settings ?? {}) as Partial<AppSettings>;
    setSettings((cur) => ({
      ...cur,
      ...rs,
      goal: { ...cur.goal, ...(rs.goal ?? {}) },
      strength: { ...cur.strength, ...(rs.strength ?? {}) },
      prefs: { ...cur.prefs, ...(rs.prefs ?? {}) },
      connection: cur.connection,
      demo: cur.demo,
      cloudSync: cur.cloudSync,
    }));
    setWeeks((st.weeks ?? {}) as Record<ISODate, WeekConfig>);
    setCheckins((st.checkins ?? {}) as Record<ISODate, CheckIn>);
    setFeedbackState((st.feedback ?? {}) as Record<string, Feedback>);
    setHistory((st.history ?? {}) as Record<ISODate, PlanSnapshot>);
    setJournalState((st.journal ?? {}) as Journal);
    setScheduled((st.scheduled ?? {}) as Record<ISODate, Scheduled>);
  }, []);

  /** Pull the note, merge it with this device, and save back if this device had newer changes. */
  const cloudSyncNow = useCallback(
    async (opts: { write?: boolean } = {}) => {
      if (!cloudOn || busyRef.current) return;
      busyRef.current = true;
      setCloud((c) => ({ ...c, state: 'syncing', error: null }));
      try {
        const conn = connection();
        const doc = await readDoc(conn);
        const local = { items: flatRef.current, stamps: stampsRef.current };
        const merged = doc ? mergeDocs(local, { items: flatten(doc.data), stamps: doc.stamps ?? {} }) : { items: local.items, stamps: local.stamps, changedLocal: false, changedRemote: true };
        stampsRef.current = merged.stamps;
        save(K.stamps, merged.stamps);
        if (merged.changedLocal) applyItems(merged.items);
        if (merged.changedRemote && (opts.write ?? true)) {
          // Anything never stamped (e.g. settings set before syncing existed) counts as changed now,
          // so a brand-new device takes these values instead of its own defaults
          const now = Date.now();
          for (const k of Object.keys(merged.items)) if (!merged.stamps[k]) merged.stamps[k] = now;
          stampsRef.current = merged.stamps;
          save(K.stamps, merged.stamps);
          const t = trim(merged.items, merged.stamps, asOf);
          await writeDoc(conn, { app: 'trainingapp', v: 1, savedAt: Date.now(), device: deviceName(), stamps: t.stamps, data: unflatten(t.items) });
        }
        // Races you added → real A/B/C races on the intervals.icu calendar
        const races = ((unflatten(merged.items).settings?.goal as GoalSettings | undefined)?.races ?? []) as PlannedRace[];
        await syncRaces(conn, races, await fetchEvents(conn, asOf, addDays(asOf, 730))).catch(() => 0);
        setCloud({ state: 'on', at: new Date().toISOString(), error: null });
      } catch (e) {
        setCloud((c) => ({ ...c, state: 'error', error: (e as Error).message }));
      } finally {
        busyRef.current = false;
      }
    },
    [cloudOn, connection, applyItems, asOf, K],
  );

  // Load when sync turns on (app opened with a key), and whenever the app comes back into view
  useEffect(() => {
    if (!cloudOn) {
      setCloud({ state: 'off', at: null, error: null });
      return;
    }
    cloudSyncNow();
    const onVis = () => document.visibilityState === 'visible' && cloudSyncNow();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudOn]);

  // After a data sync (button or automatic), check for settings changes from other devices too
  useEffect(() => {
    if (cloudOn && stored.lastSync) cloudSyncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored.lastSync]);

  // Save a few seconds after you change something
  useEffect(() => {
    if (!cloudOn || applying.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => cloudSyncNow(), 3000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat]);

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

  const baseWeek = useMemo(() => weeks[startDate] ?? makeWeek(startDate), [weeks, startDate, makeWeek]);
  const week = useMemo<WeekConfig>(() => {
    const days = { ...baseWeek.days };
    for (const d of range(startDate, 7)) {
      const sc = scheduled[d];
      if (sc && (!days[d] || days[d].status === 'available'))
        days[d] = { ...(days[d] ?? { maxMinutes: null }), status: 'pinned', pinned: { workoutId: sc.workoutId, durationMin: sc.durationMin, level: sc.level } };
    }
    return { ...baseWeek, days };
  }, [baseWeek, scheduled, startDate]);
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
        if (c && (c.status === 'off' || c.status === 'group' || c.maxMinutes != null || c.noLift || c.second))
          usual[dow(d)] = c.status === 'pinned' || c.status === 'race' ? { status: 'available', maxMinutes: c.maxMinutes } : c;
      }
      setSettings((s) => ({ ...s, usualHours: w.hours, usualDays: usual }));
    },
    [],
  );

  const journal = useMemo(() => (settings.demo ? { ...demoJournal(asOf), ...journalState } : journalState), [settings.demo, asOf, journalState]);
  const effects = useMemo(() => affectedMornings(journal), [journal]);
  const checkIn = checkins[asOf] ?? null;
  // A journal "sick" entry counts as a sick check-in unless you've checked in today
  const effectiveCheckIn = useMemo<CheckIn | null>(
    () => checkIn ?? (effects[asOf]?.tags.includes('illness') ? { date: asOf, feel: 'sick' } : null),
    [checkIn, effects, asOf],
  );
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
  const exportDefaults = useMemo<ExportTargets>(
    () => ({ mode: 'power', ftp: Math.round(profile?.eftp ?? ftp), lthr: profile?.lthr ?? null }),
    [profile, ftp],
  );

  const events = useMemo(() => withAwayWeeks(withAppRaces(data.events, settings.goal.races), settings.goal.awayWeeks, settings.goal.offRanges), [data.events, settings.goal.races, settings.goal.awayWeeks, settings.goal.offRanges]);
  const macro = useMemo(() => buildMacroPlan(settings.goal, events, asOf), [settings.goal, events, asOf]);
  const readiness = useMemo(
    () => assessReadiness(data.wellness, asOf, { checkIn: effectiveCheckIn, model: settings.goal.model, effects }),
    [data.wellness, asOf, effectiveCheckIn, settings.goal.model, effects],
  );
  const trends = useMemo(() => computeTrends(data.activities, data.wellness, asOf), [data.activities, data.wellness, asOf]);
  const progression = useMemo(() => computeProgression(data.activities, feedback, asOf), [data.activities, feedback, asOf]);
  const loadFocus = useMemo(() => {
    const mw = macroWeekFor(macro, startDate);
    return computeLoadFocus(data.activities, asOf, mw?.phase ?? 'base', settings.goal.eventType);
  }, [data.activities, asOf, macro, startDate, settings.goal.eventType]);
  const performance = useMemo(() => analyzePerformance(data.activities, data.wellness, effProfile, asOf), [data.activities, data.wellness, effProfile, asOf]);
  const impacts = useMemo(() => tagImpacts(journal, data.wellness, asOf), [journal, data.wellness, asOf]);
  const heat = useMemo(() => heatAdaptation(data.activities, performance.model, asOf), [data.activities, performance.model, asOf]);
  const status = useMemo(() => trainingStatus(data.wellness, readiness, asOf, performance.improvement), [data.wellness, readiness, asOf, performance.improvement]);
  const vo2History = useMemo(
    () => data.wellness.filter((w) => w.vo2max && diffDays(asOf, w.date) >= 0 && diffDays(asOf, w.date) <= 180).map((w) => ({ date: w.date, vo2: w.vo2max as number })),
    [data.wellness, asOf],
  );
  const vo2 = useMemo(() => {
    const p5best = performance.bestEfforts.find((b) => b.secs === 300)?.recent ?? null;
    const latestW = [...data.wellness].reverse().find((w) => w.eftp && w.wPrime && w.pMax);
    return estimateVo2({
      p5: p5best,
      cp: latestW?.eftp ?? effProfile?.cp ?? null,
      wPrime: latestW?.wPrime ?? effProfile?.wPrime ?? null,
      pMax: latestW?.pMax ?? effProfile?.pMax ?? null,
      weightKg: effProfile?.weightKg ?? [...data.wellness].reverse().find((w) => w.weightKg)?.weightKg ?? null,
      garmin: vo2History.length ? vo2History[vo2History.length - 1].vo2 : null,
    });
  }, [performance.bestEfforts, data.wellness, effProfile, vo2History]);
  const staleness = useMemo(() => {
    const byDay = new Map<ISODate, number>();
    for (const a of data.activities) byDay.set(a.date, (byDay.get(a.date) ?? 0) + (a.tss ?? 0));
    const daily = Array.from({ length: 42 }, (_, i) => addDays(asOf, -i)).map((d) => ({ date: d, load: byDay.get(d) ?? 0 }));
    const tsb = data.wellness.filter((w) => w.ctl != null && w.atl != null).map((w) => ({ date: w.date, tsb: (w.ctl as number) - (w.atl as number) }));
    const rides = data.activities.filter((a) => !a.isStrength && diffDays(asOf, a.date) >= 0).sort((a, b) => b.date.localeCompare(a.date)); // any endurance session
    const hard = rides.find(isHardSession);
    const eftpF = performance.improvement.factors.find((f) => f.label.startsWith('eFTP'));
    const ctlF = performance.improvement.factors.find((f) => f.label.startsWith('Fitness'));
    return computeStaleness({
      asOf,
      daily,
      tsb,
      lastRide: rides[0]?.date ?? null,
      lastHard: hard?.date ?? null,
      prsLast8w: null,
      eftpChangePct: eftpF ? parseFloat(eftpF.value) : null,
      ctlChange28: ctlF ? parseFloat(ctlF.value) : null,
      hrvLow: readiness.flags.some((f) => f.id === 'hrv-low' || f.id === 'hrv-below'),
      rhrHigh: readiness.flags.some((f) => f.id === 'rhr-high'),
    });
  }, [data.activities, data.wellness, asOf, performance.improvement, readiness]);
  const snapshots = useMemo(() => (settings.demo ? demoSnapshots(asOf) : history), [settings.demo, asOf, history]);
  const compliance = useMemo(
    () => computeCompliance(range(addDays(asOf, -7), 8), asOf, events, data.activities, snapshots),
    [asOf, events, data.activities, snapshots],
  );
  const carryOver = useMemo(() => missedKeySessions(compliance, asOf), [compliance, asOf]);
  const powerCurves = useMemo(() => data.powerCurves ?? [], [data.powerCurves]);
  const power = useMemo(() => powerProfile(effProfile, powerCurves), [effProfile, powerCurves]);
  const limiter = power ? ({ sprint: 'anaerobic', anaerobic: 'anaerobic', vo2: 'vo2max', threshold: 'threshold' } as const)[power.limiter] : null;
  const sport = settings.prefs.sport ?? 'cycling';
  const planInput = useMemo(
    () => ({
        startDate,
        asOf,
        week: sport === 'run_bike' || sport === 'triathlon' ? { ...week, hours: bikeHoursFor(sport, week.hours) } : week,
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
        events,
        progression,
        loadFocus,
        carryOver,
        limiter,
      }),
    [startDate, asOf, week, settings.goal, macro, settings.prefs, settings.strength, readiness, trends, effProfile, ftp, events, progression, loadFocus, carryOver, limiter],
  );
  const basePlan = useMemo(() => planWeek(planInput), [planInput]);
  // What the plan itself would recommend on days that have a workout from your coach / calendar
  const autoPlan = useMemo(() => {
    if (!basePlan.days.some((d) => d.ride?.fixed === 'calendar')) return null;
    return planWeek({ ...planInput, events: planInput.events.filter((e) => !(e.category === 'WORKOUT' && !(e.externalId ?? '').startsWith(`${EXTERNAL_PREFIX}-`))) });
  }, [basePlan, planInput]);
  const sportsPlan = useMemo(
    () =>
      applySports({
        plan: autoPlan
          ? { ...basePlan, days: basePlan.days.map((d) => (d.ride?.fixed === 'calendar' ? { ...d, recommended: autoPlan.days.find((x) => x.date === d.date)?.ride ?? null } : d)) }
          : basePlan,
        sport,
        hours: week.hours,
        macroWeek: basePlan.macroWeek,
        readiness,
        activities: data.activities,
        asOf,
        weightKg: effProfile?.weightKg ?? null,
        minRestDays: settings.prefs.minRestDays,
      }),
    [basePlan, autoPlan, sport, week.hours, readiness, data.activities, asOf, effProfile, settings.prefs.minRestDays],
  );
  const plan = useMemo(() => applySecondSessions(sportsPlan, (d) => week.days[d], effProfile?.weightKg ?? null, readiness), [sportsPlan, week.days, effProfile, readiness]);

  // Remember what was planned (today onward) so compliance works even without pushing to intervals.icu
  useEffect(() => {
    if (settings.demo) return;
    setHistory((h) => {
      const n: Record<ISODate, PlanSnapshot> = {};
      for (const [d, v] of Object.entries(h)) if (diffDays(asOf, d) <= 60 && d < asOf) n[d] = v;
      for (const d of plan.days) {
        const ws = [d.ride, ...(d.extras ?? [])].filter(Boolean) as PlannedWorkout[];
        if (d.date < asOf || !ws.length) continue;
        n[d.date] = { date: d.date, name: ws.map((w) => w.name).join(' + '), templateId: ws[0].templateId, durationMin: ws.reduce((a, w) => a + w.durationMin, 0), tss: ws.reduce((a, w) => a + w.tss, 0), key: ws.some((w) => w.key) };
      }
      return JSON.stringify(n) === JSON.stringify(h) ? h : n;
    });
  }, [plan, asOf, settings.demo]);

  const canPush = !settings.demo && (Boolean(settings.connection.apiKey) || Boolean(server?.serverIcuKey) || Boolean(account));

  const pushWorkout = useCallback(
    async (date: ISODate, w: PlannedWorkout, targets?: ExportTargets) => {
      const conn = connection();
      const ev = {
        category: 'WORKOUT' as const,
        start_date_local: `${date}T00:00:00`,
        type: ICU_TYPE[w.sport ?? 'ride'],
        name: w.name,
        description: workoutDescription(w, settings.prefs.targetMode, targets ? { targets, icuLthr: profile?.lthr ?? null } : undefined),
        moving_time: Math.round(w.durationMin * 60),
        icu_training_load: w.tss,
        external_id: `${EXTERNAL_PREFIX}-${date}-${(w.sport ?? 'ride') === 'ride' ? 'ride' : 'x0'}`,
      };
      await pushEvents(conn, [ev], []);
      return `Sent “${w.name}” to intervals.icu for ${date}${targets ? ` (${targetsLabel(targets)})` : ''}. It will sync to Garmin if “Upload planned workouts” is on.`;
    },
    [connection, settings.prefs.targetMode, profile],
  );

  const push = useCallback(
    async (p: WeekPlan) => {
      const conn = connection();
      const prof = effProfile!;
      const outgoing = p.days.flatMap((d) => dayToIcuEvents(d, prof, settings.prefs.targetMode));
      const keep = new Set(outgoing.map((e) => e.external_id));
      // A coach workout you replaced stays on your calendar as a note (not a second workout for your Garmin)
      const replaced = p.days
        .filter((d) => d.ride?.fixed !== 'calendar')
        .flatMap((d) => events.filter((e) => e.date === d.date && e.category === 'WORKOUT' && (e.externalId ?? '').startsWith('tacoach-')));
      for (const e of replaced)
        outgoing.push({
          category: 'NOTE',
          start_date_local: `${e.date}T00:00:00`,
          type: e.type ?? 'Ride',
          name: `Coach’s plan: ${e.name} (you changed this day)`,
          description: e.description ?? '',
          moving_time: e.plannedSec ?? undefined,
          external_id: e.externalId as string,
        });
      const stale = p.days.flatMap((d) => allExternalIdsFor(d.date)).filter((id) => !keep.has(id));
      const n = await pushEvents(conn, outgoing, stale);
      return `Sent ${n} workout${n === 1 ? '' : 's'} to your intervals.icu calendar. They sync on to Garmin Connect if "Upload planned workouts" is on in intervals.icu.`;
    },
    [connection, effProfile, settings.prefs.targetMode, events],
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
    progression,
    loadFocus,
    status,
    compliance,
    power,
    powerCurves,
    feedback,
    setFeedback,
    journal,
    setJournalTags,
    effects,
    impacts,
    performance,
    scheduled,
    schedule,
    pushWorkout,
    getConnection: connection,
    exportDefaults,
    heat,
    cloud,
    cloudSyncNow: () => cloudSyncNow(),
    events,
    snapshots,
    account,
    guest,
    vo2,
    vo2History,
    staleness,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
