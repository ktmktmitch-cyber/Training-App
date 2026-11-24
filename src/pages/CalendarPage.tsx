import { useEffect, useMemo, useState } from 'react';
import { computeCompliance } from '../engine/compliance';
import { addDays, diffDays, fmtMinutes, fromISO, mondayOf, range } from '../engine/dates';
import { TAGS } from '../engine/journal';
import { macroWeekFor, PHASE_LABELS } from '../engine/periodization';
import type { Activity, CalendarEvent, ISODate, PlannedDay } from '../engine/types';
import { StepsTable } from '../components/DayCard';
import { ExportBar } from '../components/ExportBar';
import { C_COLOR, C_ICON } from '../components/insights';
import { MobilityBlock } from '../components/MobilityCard';
import { useToast } from '../components/ui';
import { fetchHistory } from '../lib/intervals';
import { useApp } from '../lib/store';

type Sport = 'ride' | 'run' | 'swim' | 'strength' | 'other';

function sportOf(type: string | undefined): Sport {
  const t = (type ?? '').toLowerCase();
  if (t.includes('ride') || t === 'velomobile' || t.includes('cycl')) return 'ride';
  if (t.includes('run') || t === 'walk' || t === 'hike') return 'run';
  if (t.includes('swim')) return 'swim';
  if (t === 'weighttraining' || t.includes('workout') || t === 'yoga') return 'strength';
  return 'other';
}

const SPORT_LABEL: Record<Sport, string> = { ride: 'Ride', run: 'Run', swim: 'Swim', strength: 'Gym', other: 'Other' };

function monthStart(d: ISODate): ISODate {
  return `${d.slice(0, 7)}-01`;
}

function addMonths(d: ISODate, n: number): ISODate {
  const x = fromISO(monthStart(d));
  x.setMonth(x.getMonth() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`;
}

function km(m: number | null | undefined) {
  return m ? `${(m / 1000).toFixed(m >= 100_000 ? 0 : 1)} km` : null;
}

export function CalendarPage() {
  const app = useApp();
  const { asOf, data, plan, macro } = app;
  const [toast, showToast] = useToast();
  const [month, setMonth] = useState(monthStart(asOf));
  const [selected, setSelected] = useState<ISODate>(asOf);
  const [older, setOlder] = useState<{ activities: Activity[]; events: CalendarEvent[]; ranges: string[] }>({ activities: [], events: [], ranges: [] });
  const [loading, setLoading] = useState(false);

  // The grid: Monday before the 1st → Sunday after the last day
  const first = mondayOf(month);
  const last = addDays(mondayOf(addDays(addMonths(month, 1), -1)), 6);
  const days = range(first, diffDays(last, first) + 1);

  // Synced data covers ~120 days back; fetch older months on demand
  const loadedFrom = data.activities.reduce<ISODate | null>((m, a) => (!m || a.date < m ? a.date : m), null) ?? addDays(asOf, -120);
  const needOlder = data.source === 'intervals' && first < addDays(asOf, -118) && !older.ranges.includes(month);
  useEffect(() => {
    if (!needOlder) return;
    let gone = false;
    setLoading(true);
    fetchHistory(app.getConnection(), first, last < loadedFrom ? last : loadedFrom)
      .then((h) => {
        if (gone) return;
        setOlder((o) => ({
          activities: [...o.activities, ...h.activities.filter((a) => !o.activities.some((x) => x.id === a.id))],
          events: [...o.events, ...h.events.filter((e) => !o.events.some((x) => x.id === e.id))],
          ranges: [...o.ranges, month],
        }));
      })
      .catch((e) => !gone && showToast(`Couldn’t load ${month.slice(0, 7)}: ${(e as Error).message}`))
      .finally(() => !gone && setLoading(false));
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, needOlder]);

  const activities = useMemo(() => [...data.activities, ...older.activities.filter((a) => !data.activities.some((x) => x.id === a.id))], [data.activities, older.activities]);
  const events = useMemo(() => [...app.events, ...older.events.filter((e) => !app.events.some((x) => x.id === e.id))], [app.events, older.events]);
  const compliance = useMemo(() => {
    const past = days.filter((d) => diffDays(d, asOf) <= 0);
    return Object.fromEntries(computeCompliance(past, asOf, events, activities, app.snapshots).map((c) => [c.date, c]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first, last, asOf, events, activities, app.snapshots]);
  const planByDay = useMemo(() => Object.fromEntries(plan.days.map((d) => [d.date, d])) as Record<ISODate, PlannedDay>, [plan.days]);
  const actsByDay = useMemo(() => {
    const m: Record<ISODate, Activity[]> = {};
    for (const a of activities) (m[a.date] ??= []).push(a);
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
    return m;
  }, [activities]);
  const evByDay = useMemo(() => {
    const m: Record<ISODate, CalendarEvent[]> = {};
    for (const e of events) {
      const end = e.endDate && diffDays(e.endDate, e.date) > 0 ? e.endDate : e.date;
      for (let d = e.date; d <= end && diffDays(d, e.date) < 60; d = addDays(d, 1)) (m[d] ??= []).push(e);
    }
    return m;
  }, [events]);

  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  const label = fromISO(month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <>
      <div className="row">
        <h1 style={{ margin: 0 }}>Calendar</h1>
        <span className="spacer" />
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <button className="btn sm ghost" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
            ‹
          </button>
          <b style={{ minWidth: 130, textAlign: 'center' }}>{label}</b>
          <button className="btn sm ghost" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
            ›
          </button>
          <button className="btn sm" onClick={() => { setMonth(monthStart(asOf)); setSelected(asOf); }}>
            Today
          </button>
        </div>
      </div>
      {loading && <div className="callout">Loading {label} from intervals.icu…</div>}

      <div className="card cal">
        <div className="cal-grid cal-head" aria-hidden>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d}>{d}</div>
          ))}
          <div className="cal-wk">Week</div>
        </div>
        {weeks.map((wk) => {
          const mw = macroWeekFor(macro, wk[0]);
          const done = wk.flatMap((d) => actsByDay[d] ?? []);
          const hrs = done.reduce((a, x) => a + x.movingSec, 0) / 3600;
          const tss = done.reduce((a, x) => a + (x.tss ?? 0), 0);
          const planned = wk.map((d) => planByDay[d]?.ride).filter(Boolean);
          const plannedMin = planned.reduce((a, r) => a + (r?.durationMin ?? 0), 0);
          const future = diffDays(wk[0], asOf) > 0;
          return (
            <div key={wk[0]} className={`cal-grid cal-row ${mw && (mw.weekType === 'recovery' || mw.userRest) ? 'rest-week' : ''}`}>
              {wk.map((d) => {
                const inMonth = d.slice(0, 7) === month.slice(0, 7);
                const acts = actsByDay[d] ?? [];
                const evs = evByDay[d] ?? [];
                const p = planByDay[d];
                const c = compliance[d];
                const race = evs.find((e) => e.category.startsWith('RACE_'));
                const plannedEv = !p && diffDays(d, asOf) > 0 ? evs.find((e) => e.category === 'WORKOUT') : undefined;
                const off = evs.find((e) => ['SICK', 'INJURED', 'HOLIDAY'].includes(e.category));
                const tags = app.journal[d] ?? [];
                return (
                  <button
                    key={d}
                    className={`cal-day ${inMonth ? '' : 'out'} ${d === asOf ? 'today' : ''} ${d === selected ? 'sel' : ''}`}
                    onClick={() => setSelected(d)}
                    aria-label={fromISO(d).toDateString()}
                  >
                    <span className="cal-dom">
                      {fromISO(d).getDate()}
                      {c && c.color !== 'rest' && c.color !== 'pending' && (
                        <span className="cal-dot" style={{ background: C_COLOR[c.color] }} title={c.label}>
                          {C_ICON[c.color]}
                        </span>
                      )}
                      {tags.length > 0 && <span className="cal-tag" title={tags.map((t) => TAGS.find((x) => x.key === t)?.short ?? t).join(', ')} />}
                    </span>
                    {race && <span className={`cal-item race pri-${race.category.slice(5)}`}>{race.category.slice(5)} · {race.name}</span>}
                    {off && !race && <span className="cal-item muted">{off.category === 'HOLIDAY' ? 'Holiday' : off.category === 'SICK' ? 'Sick' : 'Injured'}</span>}
                    {acts.map((a) => (
                      <span key={a.id} className={`cal-item done s-${sportOf(a.type)}`}>
                        <b>{SPORT_LABEL[sportOf(a.type)]}</b> {fmtMinutes(Math.round(a.movingSec / 60))}
                        {a.tss ? <span className="muted"> · {Math.round(a.tss)}</span> : null}
                      </span>
                    ))}
                    {p?.ride && !acts.length && (
                      <span className="cal-item plan">
                        {p.ride.name} <span className="muted">· {fmtMinutes(p.ride.durationMin)}</span>
                      </span>
                    )}
                    {p?.strength && !acts.some((a) => a.isStrength) && <span className="cal-item plan">Strength</span>}
                    {plannedEv && (
                      <span className="cal-item plan">
                        {plannedEv.name}
                        {plannedEv.plannedSec ? <span className="muted"> · {fmtMinutes(Math.round(plannedEv.plannedSec / 60))}</span> : null}
                      </span>
                    )}
                  </button>
                );
              })}
              <div className="cal-wk">
                {mw && (
                  <span className="tiny">
                    {mw.userRest ? 'Rest (yours)' : mw.weekType === 'recovery' ? 'Recovery' : mw.weekType === 'hit_block' ? 'HIT block' : PHASE_LABELS[mw.phase]}
                  </span>
                )}
                {hrs > 0 && (
                  <span className="tiny muted num">
                    {hrs.toFixed(1)} h · {Math.round(tss)} TSS
                  </span>
                )}
                {future && plannedMin > 0 && <span className="tiny muted num">plan {fmtMinutes(plannedMin)}</span>}
              </div>
            </div>
          );
        })}
        <div className="row tiny muted" style={{ marginTop: 8, gap: 12 }}>
          <span>✓ ~ ! × planned vs done</span>
          <span>Shaded weeks: rest / recovery</span>
          <span>Dot: journal entry</span>
        </div>
      </div>

      <DayDetail
        date={selected}
        acts={actsByDay[selected] ?? []}
        evs={evByDay[selected] ?? []}
        planned={planByDay[selected]}
        snapshot={app.snapshots[selected]}
        onToast={showToast}
      />
      {toast}
    </>
  );
}

function DayDetail({ date, acts, evs, planned, snapshot, onToast }: { date: ISODate; acts: Activity[]; evs: CalendarEvent[]; planned?: PlannedDay; snapshot?: { name: string; durationMin: number; tss: number }; onToast: (m: string) => void }) {
  const app = useApp();
  const w = app.data.wellness.find((x) => x.date === date);
  const tags = app.journal[date] ?? [];
  const past = diffDays(date, app.asOf) < 0;
  const plannedEvs = evs.filter((e) => e.category === 'WORKOUT' && !(e.externalId ?? '').startsWith('trainingapp'));
  const notes = evs.filter((e) => e.category === 'NOTE' || e.category.startsWith('RACE_') || ['SICK', 'INJURED', 'HOLIDAY'].includes(e.category));
  const nothing = !acts.length && !planned?.ride && !planned?.strength && !planned?.mobility && !plannedEvs.length && !notes.length && !snapshot;
  return (
    <div className="card stack">
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>{fromISO(date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h2>
        {date === app.asOf && <span className="chip">Today</span>}
      </div>
      {w && (w.hrv || w.rhr || w.sleepSec) && (
        <div className="row small ink2" style={{ gap: 14 }}>
          {w.hrv != null && <span>HRV {Math.round(w.hrv)} ms</span>}
          {w.rhr != null && <span>Resting HR {Math.round(w.rhr)}</span>}
          {w.sleepSec != null && <span>Sleep {(w.sleepSec / 3600).toFixed(1)} h</span>}
          {w.ctl != null && w.atl != null && <span>Form {Math.round(w.ctl - w.atl)}</span>}
        </div>
      )}
      {tags.length > 0 && <div className="small">Journal: {tags.map((t) => TAGS.find((x) => x.key === t)?.short ?? t).join(', ')}</div>}

      {notes.map((e) => (
        <div key={e.id} className="callout">
          <b>{e.category.startsWith('RACE_') ? `${e.category.slice(5)} race` : e.category === 'NOTE' ? 'Note' : e.category.toLowerCase()}:</b> {e.name}
        </div>
      ))}

      {acts.length > 0 && (
        <div className="stack">
          <h3>Done</h3>
          {acts.map((a) => (
            <div key={a.id} className="cal-act">
              <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                <b>{a.name}</b>
                <span className="tiny muted">{a.type}</span>
                {a.source === 'intervals' && (
                  <a className="tiny" href={`https://intervals.icu/activities/${a.id}`} target="_blank" rel="noreferrer">
                    Open in intervals.icu
                  </a>
                )}
              </div>
              <div className="row small ink2 num" style={{ gap: 14 }}>
                <span>{fmtMinutes(Math.round(a.movingSec / 60))}</span>
                {km(a.distanceM) && <span>{km(a.distanceM)}</span>}
                {a.tss != null && <span>{Math.round(a.tss)} TSS</span>}
                {a.intensity != null && <span>IF {a.intensity.toFixed(2)}</span>}
                {a.normalizedPower != null && <span>NP {Math.round(a.normalizedPower)} W</span>}
                {a.avgHr != null && <span>HR {Math.round(a.avgHr)}</span>}
                {a.rpe != null && <span>RPE {a.rpe}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {past && snapshot && (
        <p className="small ink2">
          Planned: <b>{snapshot.name}</b> · {fmtMinutes(snapshot.durationMin)} · {snapshot.tss} TSS
        </p>
      )}

      {!past && planned && (planned.ride || planned.strength || planned.mobility) && (
        <div className="stack">
          <h3>Planned</h3>
          {planned.ride && (
            <div className="stack" style={{ gap: 8 }}>
              <div>
                <b>{planned.ride.name}</b>{' '}
                <span className="small muted">
                  · {fmtMinutes(planned.ride.durationMin)} · {planned.ride.tss} TSS
                </span>
              </div>
              <p className="small ink2" style={{ margin: 0 }}>
                {planned.ride.purpose}
              </p>
              {planned.ride.blocks.length > 0 && <StepsTable blocks={planned.ride.blocks} ftp={app.ftp} profile={app.profile} mode={app.settings.prefs.targetMode} />}
              <ExportBar workout={planned.ride} date={date} onDone={onToast} />
            </div>
          )}
          {planned.strength && (
            <div className="small">
              <b>Strength:</b> {planned.strength.title} · {planned.strength.durationMin} min
            </div>
          )}
          {planned.mobility && <MobilityBlock session={planned.mobility} />}
          <a className="small" href="#/week">
            Change this on the Week page →
          </a>
        </div>
      )}

      {plannedEvs.length > 0 && (
        <div className="stack">
          <h3>On your intervals.icu calendar</h3>
          {plannedEvs.map((e) => (
            <div key={e.id} className="small">
              <b>{e.name}</b>
              {e.plannedSec ? ` · ${fmtMinutes(Math.round(e.plannedSec / 60))}` : ''}
              {e.plannedTss ? ` · ${e.plannedTss} TSS` : ''}
            </div>
          ))}
        </div>
      )}

      {!past && !planned && diffDays(date, app.asOf) > 7 && !plannedEvs.length && (
        <p className="small muted">The detailed plan covers the next 7 days. Further out, the Season page shows the week’s phase and volume.</p>
      )}
      {nothing && (past || diffDays(date, app.asOf) <= 7) && <p className="small muted">{past ? 'No activity recorded.' : 'Rest day.'}</p>}
    </div>
  );
}
