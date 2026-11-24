import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, fmtLong, fmtMinutes, fmtShort } from '../engine/dates';
import { instantiate } from '../engine/planner';
import type { ExportMode } from '../engine/targets';
import type { TeamRider } from '../engine/team';
import type { AthleteProfile, CalendarEvent, ISODate, WorkoutCategory } from '../engine/types';
import { ALL_WORKOUTS, WORKOUT_BY_ID } from '../engine/workouts';
import { coachError, sendToRiders, type SendResult } from '../lib/coach';
import { COACH_PREFIX, fetchRiderCalendar, pushEvents } from '../lib/intervals';
import { useApp } from '../lib/store';
import { CATEGORY_LABEL, Seg } from './ui';

const CATS: WorkoutCategory[] = ['recovery', 'endurance', 'tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic', 'sprint', 'race_sim', 'durability', 'openers', 'test'];
const EVERYONE = '__everyone__';

export interface SentGroup {
  key: string;
  date: ISODate;
  name: string;
  plannedSec?: number | null;
  items: { rider: TeamRider; event: CalendarEvent }[];
}

/** Group the coach's sends across riders: one send to many riders = one group (same date, workout and level). */
export function groupSent(cals: { rider: TeamRider; events: CalendarEvent[] }[]): SentGroup[] {
  const map = new Map<string, SentGroup>();
  for (const { rider, events } of cals)
    for (const e of events) {
      const x = e.externalId ?? '';
      if (!x.startsWith(`${COACH_PREFIX}-`)) continue;
      const base = x.replace(/-[a-z0-9]+$/, '');
      const key = `${base}|${e.name}`;
      const g: SentGroup = map.get(key) ?? { key, date: e.date, name: e.name, plannedSec: e.plannedSec, items: [] };
      if (!g.items.some((i) => i.rider.id === rider.id)) g.items.push({ rider, event: e });
      map.set(key, g);
    }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

const SPORT_NAME = { ride: 'Ride', run: 'Run', swim: 'Swim' } as const;

/**
 * Coach: put a library workout on riders' intervals.icu calendars — everyone, or the riders you tick.
 * Targets are sent relative (% FTP / HR zones / % pace), so each rider gets their own numbers,
 * and their app rebuilds it as a normal workout they can make easier, harder or shorter.
 */
export function CoachSchedule({ riders, onToast }: { riders: TeamRider[]; onToast: (m: string) => void }) {
  const app = useApp();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(riders.map((r) => r.id)));
  const inited = useRef(riders.length > 0);
  useEffect(() => {
    if (!inited.current && riders.length) {
      inited.current = true;
      setPicked(new Set(riders.map((r) => r.id)));
    }
  }, [riders]);
  const [date, setDate] = useState<ISODate>(addDays(app.asOf, 1));
  const [templateId, setTemplateId] = useState('sweetspot');
  const t = WORKOUT_BY_ID[templateId];
  const [duration, setDuration] = useState(75);
  const [level, setLevel] = useState(2);
  const [mode, setMode] = useState<ExportMode>('power');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [results, setResults] = useState<SendResult[] | null>(null);
  // One rider's calendar, to see what's already there and remove what you sent
  const [viewId, setViewId] = useState(EVERYONE);
  const viewRider = viewId === EVERYONE ? undefined : (riders.find((r) => r.id === viewId) ?? riders[0]);
  // "Everyone": what you've sent across the whole team, grouped so one send = one row
  const [allSent, setAllSent] = useState<{ groups: SentGroup[]; failed: string[] } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [cal, setCal] = useState<{ profile: AthleteProfile; events: CalendarEvent[] } | null>(null);
  const [calErr, setCalErr] = useState<string | null>(null);

  const loadAll = async () => {
    setAllSent(null);
    const conn = app.getConnection();
    const res = await Promise.all(
      riders.map((r) =>
        fetchRiderCalendar(conn, r.id, app.asOf, addDays(app.asOf, 42))
          .then((c) => ({ r, events: c.events }))
          .catch(() => ({ r, events: null as CalendarEvent[] | null })),
      ),
    );
    setAllSent({ groups: groupSent(res.filter((x) => x.events).map((x) => ({ rider: x.r, events: x.events! }))), failed: res.filter((x) => !x.events).map((x) => x.r.rider) });
  };
  const load = () => {
    if (viewId === EVERYONE) {
      loadAll();
      return;
    }
    if (!viewRider) return;
    setCal(null);
    setCalErr(null);
    fetchRiderCalendar(app.getConnection(), viewRider.id, app.asOf, addDays(app.asOf, 28))
      .then(setCal)
      .catch((e) => setCalErr(coachError(e as Error, viewRider.rider)));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [viewId]);

  const lvl = Math.min(level, (t?.levels ?? 1) - 1);
  const dur = t ? Math.max(t.minMin, Math.min(t.maxMin, duration)) : duration;
  const w = useMemo(() => (t ? instantiate(t, dur, lvl, null, undefined, []) : null), [t, dur, lvl]);
  const sel = riders.filter((r) => picked.has(r.id));
  const all = sel.length === riders.length && riders.length > 0;

  const send = async () => {
    if (!t || !sel.length) return;
    setResults(null);
    setBusy(0);
    const res = await sendToRiders(app.getConnection(), sel, t, dur, lvl, date, mode, note, (n) => setBusy(n));
    setBusy(null);
    setResults(res);
    // Sent to yourself too: refresh your own calendar so it shows in your week right away
    if (res.some((x) => x.ok && x.rider.id === app.data.profile?.id)) app.sync().catch(() => {});
    const okN = res.filter((r) => r.ok).length;
    onToast(`Sent “${w?.name}” to ${okN} of ${res.length} rider${res.length === 1 ? '' : 's'} for ${fmtShort(date)}.`);
    if (viewId === EVERYONE || sel.some((r) => r.id === viewRider?.id)) load();
  };

  const cancelGroup = async (g: SentGroup, only?: TeamRider) => {
    const list = only ? g.items.filter((i) => i.rider.id === only.id) : g.items;
    setRemoving(g.key + (only?.id ?? ''));
    const conn = app.getConnection();
    const out = await Promise.all(
      list.map((i) =>
        pushEvents({ ...conn, athleteId: i.rider.id }, [], [i.event.externalId!])
          .then(() => true)
          .catch(() => false),
      ),
    );
    setRemoving(null);
    const okN = out.filter(Boolean).length;
    onToast(`Cancelled “${g.name}” (${fmtShort(g.date)}) for ${okN} of ${list.length} rider${list.length === 1 ? '' : 's'}.`);
    if (list.some((i) => i.rider.id === app.data.profile?.id)) app.sync().catch(() => {});
    loadAll();
  };

  const remove = async (e: CalendarEvent) => {
    if (!viewRider || !e.externalId) return;
    try {
      await pushEvents({ ...app.getConnection(), athleteId: viewRider.id }, [], [e.externalId]);
      onToast(`Removed “${e.name}” from ${viewRider.rider}’s calendar.`);
      load();
    } catch (err) {
      onToast(`Couldn’t remove: ${coachError(err as Error, viewRider.rider)}`);
    }
  };

  if (!riders.length) return null;
  const upcoming = (cal?.events ?? []).filter((e) => ['WORKOUT', 'RACE_A', 'RACE_B', 'RACE_C', 'NOTE'].includes(e.category));

  return (
    <div className="stack-lg">
      <span className="small ink2">
        Puts a workout on your riders’ intervals.icu calendars — everyone, or the riders you tick. Targets are sent as % of FTP (or heart-rate zones / % of threshold pace), so each rider gets their own watts and bpm. It syncs to their Garmin/Wahoo/Zwift, and they can make it easier, harder or shorter in their week.
      </span>

      <div className="stack" style={{ gap: 6 }}>
        <span className="tiny muted" style={{ fontWeight: 600 }}>
          Send to
        </span>
        <div className="rider-checklist" role="group" aria-label="Riders to send to">
          <label className="check rider-all">
            <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = sel.length > 0 && !all; }} onChange={() => setPicked(all ? new Set() : new Set(riders.map((r) => r.id)))} />
            <b>Everyone</b>
            <span className="tiny muted">({riders.length})</span>
          </label>
          {riders.map((r) => (
            <label key={r.id} className="check">
              <input
                type="checkbox"
                checked={picked.has(r.id)}
                onChange={() => {
                  const n = new Set(picked);
                  if (n.has(r.id)) n.delete(r.id);
                  else n.add(r.id);
                  setPicked(n);
                }}
              />
              <span>{r.rider}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '1 1 150px' }}>
          <span>Date</span>
          <input className="input" type="date" min={app.asOf} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Workout date" />
        </label>
        <label className="field" style={{ flex: '2 1 240px' }}>
          <span>Workout</span>
          <select
            className="select"
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              const nt = WORKOUT_BY_ID[e.target.value];
              setDuration(Math.max(nt.minMin, Math.min(nt.maxMin, duration)));
            }}
            aria-label="Workout"
          >
            {(['ride', 'run', 'swim'] as const).map((sp) =>
              CATS.map((c) => {
                const ws = ALL_WORKOUTS.filter((x) => (x.sport ?? 'ride') === sp && x.category === c);
                return ws.length ? (
                  <optgroup key={`${sp}-${c}`} label={`${SPORT_NAME[sp]} · ${CATEGORY_LABEL[c]}`}>
                    {ws.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              }),
            )}
          </select>
        </label>
      </div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '0 1 120px' }}>
          <span>Minutes</span>
          <input className="input num" type="number" min={t?.minMin} max={t?.maxMin} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 0)} aria-label="Workout minutes" />
        </label>
        {t && t.levels > 1 && (
          <label className="field" style={{ flex: '1 1 160px' }}>
            <span>
              Level {lvl + 1} / {t.levels}
            </span>
            <input type="range" min={0} max={t.levels - 1} value={lvl} onChange={(e) => setLevel(Number(e.target.value))} aria-label="Workout level" />
          </label>
        )}
        <div className="field">
          <span>Targets</span>
          <Seg<ExportMode>
            value={mode}
            onChange={setMode}
            ariaLabel="Coach targets"
            options={[
              { value: 'power', label: (t?.sport ?? 'ride') === 'ride' ? 'Power (their FTP)' : 'Pace (their threshold)' },
              { value: 'hr', label: 'Heart rate (their zones)' },
            ]}
          />
        </div>
      </div>
      <label className="field">
        <span>Note to riders (optional)</span>
        <input className="input" value={note} placeholder="e.g. Keep the last rep honest — openers for Saturday" onChange={(e) => setNote(e.target.value)} aria-label="Note to rider" />
      </label>
      {w && (
        <div className="row small ink2" style={{ gap: 12 }}>
          <b>{w.name}</b>
          <span>{fmtMinutes(w.durationMin)}</span>
          <span>{w.tss} TSS</span>
          <span>IF {w.ifactor.toFixed(2)}</span>
          <span className="spacer" />
          <button className="btn primary" disabled={busy != null || !sel.length} onClick={send}>
            {busy != null ? `Sending ${busy}/${sel.length}…` : `Send to ${all ? 'everyone' : `${sel.length} rider${sel.length === 1 ? '' : 's'}`} · ${fmtShort(date)}`}
          </button>
        </div>
      )}
      {results && (
        <ul className="weeks-off" aria-label="Send results">
          {results.map((r) => (
            <li key={r.rider.id}>
              <span className={`chip ${r.ok ? 'on' : ''}`}>{r.ok ? '✓ Sent' : '✗ Not sent'}</span>
              <b>{r.rider.rider}</b>
              <span className="tiny muted">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {results?.some((r) => !r.ok) && <p className="tiny muted">Riders marked “not sent” need to add you as their coach in intervals.icu (Settings → Coaches) with permission to edit their calendar.</p>}

      <div className="stack">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <h3 style={{ margin: 0 }}>Rider calendar</h3>
          <select className="select" style={{ maxWidth: 200 }} value={viewId === EVERYONE ? EVERYONE : viewRider?.id} onChange={(e) => setViewId(e.target.value)} aria-label="Rider">
            <option value={EVERYONE}>Everyone — what I’ve sent</option>
            {riders.map((r) => (
              <option key={r.id} value={r.id}>
                {r.rider}
              </option>
            ))}
          </select>
          <span className="tiny muted">{viewId === EVERYONE ? 'next 6 weeks' : 'next 4 weeks'}</span>
          {viewId === EVERYONE && (
            <button className="btn sm ghost" onClick={loadAll}>
              Refresh
            </button>
          )}
        </div>
        {viewId === EVERYONE &&
          (!allSent ? (
            <p className="small muted">Loading everyone’s calendars…</p>
          ) : (
            <>
              {allSent.groups.length ? (
                <ul className="weeks-off sent-groups" aria-label="Workouts you sent">
                  {allSent.groups.map((g) => (
                    <li key={g.key} className="stack" style={{ alignItems: 'stretch', gap: 6 }}>
                      <div className="row" style={{ alignItems: 'center' }}>
                        <span className="tiny muted" style={{ minWidth: 90 }}>
                          {fmtLong(g.date)}
                        </span>
                        <span>
                          <b>{g.name}</b>
                          {g.plannedSec ? <span className="tiny muted"> · {fmtMinutes(Math.round(g.plannedSec / 60))}</span> : null}
                          <span className="tiny muted">
                            {' '}
                            · {g.items.length === riders.length ? `everyone (${g.items.length})` : `${g.items.length} rider${g.items.length === 1 ? '' : 's'}`}
                          </span>
                        </span>
                        <span className="spacer" />
                        <button className="btn sm danger" disabled={removing != null} onClick={() => cancelGroup(g)}>
                          {removing === g.key ? 'Cancelling…' : g.items.length > 1 ? 'Cancel for all' : 'Cancel'}
                        </button>
                      </div>
                      {g.items.length > 1 && (
                        <div className="row" style={{ gap: 6 }}>
                          {g.items.map((i) => (
                            <span key={i.rider.id} className="chip tiny">
                              {i.rider.rider}
                              <button className="chip-x" title={`Cancel for ${i.rider.rider} only`} aria-label={`Cancel for ${i.rider.rider} only`} disabled={removing != null} onClick={() => cancelGroup(g, i.rider)}>
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small muted">You haven’t sent anything for the next 6 weeks.</p>
              )}
              {allSent.failed.length > 0 && <p className="tiny muted">Couldn’t read: {allSent.failed.join(', ')} (not shared with you as coach).</p>}
            </>
          ))}
        {viewId !== EVERYONE && calErr && <div className="callout warn">{calErr}</div>}
        {viewId !== EVERYONE &&
          cal &&
          (upcoming.length ? (
            <ul className="weeks-off">
              {upcoming.map((e) => (
                <li key={e.id}>
                  <span className="tiny muted" style={{ minWidth: 90 }}>
                    {fmtLong(e.date)}
                  </span>
                  <span>
                    {e.category.startsWith('RACE_') ? `${e.category.slice(5)} race: ` : ''}
                    {e.name}
                    {e.plannedSec ? <span className="tiny muted"> · {fmtMinutes(Math.round(e.plannedSec / 60))}</span> : null}{' '}
                    {e.externalId?.startsWith(`${COACH_PREFIX}-`) ? <span className="chip tiny">from you</span> : null}
                  </span>
                  <span className="spacer" />
                  {e.externalId?.startsWith(`${COACH_PREFIX}-`) && (
                    <button className="btn sm ghost" onClick={() => remove(e)}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Nothing scheduled.</p>
          ))}
      </div>
    </div>
  );
}
