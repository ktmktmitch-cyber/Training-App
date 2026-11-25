// Sync the app's own state (settings, rest/away weeks, races, journal, check-ins, week edits,
// library picks, workout feedback) across devices by keeping it in one hidden note on your
// intervals.icu calendar — no server needed, so it works on GitHub Pages.
//
// Conflicts: every item (a setting group, a journal day, a week, a pick, …) carries the time it
// was last changed on a device. When two devices both saved, each item keeps the newest change, so
// a journal entry from your phone and a rest week from your laptop both survive; deletions are
// remembered too ("tombstones") so a removed item doesn't come back from an older device.
import type { CalendarEvent, ISODate, PlannedRace } from '../engine/types';
import { fetchEvents, pushEvents, type Connection } from './intervals';

export const SYNC_DATE = '2099-12-31';
export const SYNC_EXTERNAL_ID = 'trainingapp-settings';
export const RACE_PREFIX = 'trainingapp-race-';

/** The synced state: the same shape the optional server stores for signed-in users. */
export interface SyncState {
  settings?: Record<string, unknown>;
  weeks?: Record<string, unknown>;
  checkins?: Record<string, unknown>;
  feedback?: Record<string, unknown>;
  history?: Record<string, unknown>;
  journal?: Record<string, unknown>;
  scheduled?: Record<string, unknown>;
  rideContext?: Record<string, unknown>;
}

export interface SyncDoc {
  app: 'trainingapp';
  v: 1;
  savedAt: number;
  device: string;
  stamps: Record<string, number>; // item key → last-changed time (ms); missing value + stamp = deleted
  data: SyncState;
}

/** Settings that belong to this device only — never synced. */
const LOCAL_ONLY = new Set(['connection', 'demo', 'cloudSync']);
/** Settings groups merged one level deeper, so e.g. goal.races and goal.restWeeks merge independently. */
const DEEP = new Set(['goal', 'strength', 'prefs']);
const MAPS = ['weeks', 'checkins', 'feedback', 'history', 'journal', 'scheduled', 'rideContext'] as const;

/** Flatten state into independently mergeable items. */
export function flatten(s: SyncState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.settings ?? {})) {
    if (LOCAL_ONLY.has(k)) continue;
    if (DEEP.has(k) && v && typeof v === 'object') for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) out[`settings.${k}.${k2}`] = JSON.stringify(v2 ?? null);
    else out[`settings.${k}`] = JSON.stringify(v ?? null);
  }
  for (const m of MAPS) for (const [k, v] of Object.entries((s[m] as Record<string, unknown>) ?? {})) out[`${m}.${k}`] = JSON.stringify(v);
  return out;
}

export function unflatten(items: Record<string, string>): SyncState {
  const s: SyncState = { settings: {} };
  for (const [key, raw] of Object.entries(items)) {
    const v = JSON.parse(raw);
    const parts = key.split('.');
    const head = parts[0];
    if (head === 'settings') {
      if (parts.length === 3) ((s.settings![parts[1]] ??= {}) as Record<string, unknown>)[parts[2]] = v;
      else s.settings![parts.slice(1).join('.')] = v;
    } else {
      const m = head as (typeof MAPS)[number];
      ((s[m] ??= {}) as Record<string, unknown>)[parts.slice(1).join('.')] = v;
    }
  }
  return s;
}

/** Update local stamps for every item that changed between two snapshots (including deletions). */
export function restamp(prev: Record<string, string>, next: Record<string, string>, stamps: Record<string, number>, now = Date.now()): Record<string, number> {
  const out = { ...stamps };
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) if (prev[k] !== next[k]) out[k] = now;
  return out;
}

/**
 * Merge two sides item by item: the newer change wins; a newer deletion removes the item.
 * Items with no stamp on either side keep whichever value exists (local first).
 */
export function mergeDocs(
  local: { items: Record<string, string>; stamps: Record<string, number> },
  remote: { items: Record<string, string>; stamps: Record<string, number> },
): { items: Record<string, string>; stamps: Record<string, number>; changedLocal: boolean; changedRemote: boolean } {
  const items: Record<string, string> = {};
  const stamps: Record<string, number> = {};
  let changedLocal = false;
  let changedRemote = false;
  const keys = new Set([...Object.keys(local.items), ...Object.keys(remote.items), ...Object.keys(local.stamps), ...Object.keys(remote.stamps)]);
  for (const k of keys) {
    const ls = local.stamps[k] ?? 0;
    const rs = remote.stamps[k] ?? 0;
    const useRemote = rs > ls || (rs === ls && !(k in local.items) && k in remote.items);
    const v = useRemote ? remote.items[k] : local.items[k];
    const st = Math.max(ls, rs);
    if (st) stamps[k] = st;
    if (v !== undefined) items[k] = v;
    if (v !== local.items[k]) changedLocal = true;
    if (v !== remote.items[k]) changedRemote = true;
  }
  return { items, stamps, changedLocal, changedRemote };
}

/** Keep the note small: drop journal/check-in/history days older than ~6 months and old stamps. */
export function trim(items: Record<string, string>, stamps: Record<string, number>, today: ISODate) {
  const cutoff = new Date(`${today}T00:00:00Z`).getTime() - 183 * 86400_000;
  const dated = /^(journal|checkins|history|weeks|scheduled)\.(\d{4}-\d{2}-\d{2})$/;
  const keep = (k: string) => {
    const m = k.match(dated);
    return !m || new Date(`${m[2]}T00:00:00Z`).getTime() >= cutoff;
  };
  return {
    items: Object.fromEntries(Object.entries(items).filter(([k]) => keep(k))),
    stamps: Object.fromEntries(Object.entries(stamps).filter(([k]) => keep(k))),
  };
}

export function parseDoc(e: CalendarEvent | null | undefined): SyncDoc | null {
  if (!e?.description) return null;
  try {
    const d = JSON.parse(e.description) as SyncDoc;
    return d && d.app === 'trainingapp' && d.data ? d : null;
  } catch {
    return null;
  }
}

/** Read the settings note from intervals.icu (null if there isn't one yet). */
export async function readDoc(conn: Connection): Promise<SyncDoc | null> {
  const evs = await fetchEvents(conn, SYNC_DATE, SYNC_DATE);
  const e = evs.find((x) => x.externalId === SYNC_EXTERNAL_ID) ?? evs.find((x) => x.category === 'NOTE' && x.name.startsWith('Training App settings'));
  return parseDoc(e);
}

export async function writeDoc(conn: Connection, doc: SyncDoc): Promise<void> {
  await pushEvents(
    conn,
    [
      {
        category: 'NOTE',
        start_date_local: `${SYNC_DATE}T00:00:00`,
        type: 'Note',
        name: 'Training App settings (used by the app — please keep)',
        description: JSON.stringify(doc),
        external_id: SYNC_EXTERNAL_ID,
      },
    ],
    [],
  );
}

/** Your races as real A/B/C races on the intervals.icu calendar (added, changed or removed). */
export async function syncRaces(conn: Connection, races: PlannedRace[], calendar: CalendarEvent[]): Promise<number> {
  const want = races.map((r) => ({
    category: `RACE_${r.priority}` as 'RACE_A' | 'RACE_B' | 'RACE_C',
    start_date_local: `${r.date}T00:00:00`,
    type: 'Ride',
    name: r.name,
    description: 'Added in Training App.',
    moving_time: r.durationMin * 60,
    external_id: `${RACE_PREFIX}${r.id}`,
  }));
  const wantIds = new Set(want.map((w) => w.external_id));
  const stale = calendar.filter((e) => e.externalId?.startsWith(RACE_PREFIX) && !wantIds.has(e.externalId)).map((e) => e.externalId as string);
  // Only send what changed
  const changed = want.filter((w) => {
    const e = calendar.find((x) => x.externalId === w.external_id);
    return !e || e.name !== w.name || e.date !== w.start_date_local.slice(0, 10) || e.category !== w.category || (e.plannedSec ?? 0) !== w.moving_time;
  });
  if (!changed.length && !stale.length) return 0;
  await pushEvents(conn, changed, stale);
  return changed.length + stale.length;
}

export function deviceName(): string {
  try {
    const ua = navigator.userAgent;
    return /iPhone|Android.+Mobile/.test(ua) ? 'phone' : /iPad|Android/.test(ua) ? 'tablet' : 'computer';
  } catch {
    return 'device';
  }
}
