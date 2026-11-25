import { useEffect, useMemo, useState } from 'react';
import { fmtMinutes } from '../engine/dates';
import { alignLaps, flattenBlocks, reviewWorkout, sliceStream, type LapLike, type Review, type StepStatus } from '../engine/review';
import type { Activity, CalendarEvent } from '../engine/types';
import { fetchActivityLaps, fetchActivityStreams, fetchEvents, parseWorkoutDoc } from '../lib/intervals';
import { useApp } from '../lib/store';

const STATUS: Record<StepStatus, { label: string; cls: string }> = {
  on: { label: 'On target', cls: 'good' },
  over: { label: 'Too hard', cls: 'warn' },
  under: { label: 'Too easy', cls: 'warn' },
  short: { label: 'Cut short', cls: 'warn' },
  missed: { label: 'Missed', cls: 'bad' },
  open: { label: 'Free', cls: '' },
};

const fmtDur = (s: number) => (s >= 3600 ? fmtMinutes(Math.round(s / 60)) : s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.round(s)} s`);
const sign = (d: number | null) => (d == null ? '' : `${d >= 0 ? '+' : ''}${Math.round(d * 100)}%`);

/** Find the planned workout an activity was meant to be (intervals.icu's pairing first, then same day). */
export function plannedFor(a: Activity, events: CalendarEvent[]): CalendarEvent | null {
  const sport = /run/i.test(a.type) ? 'Run' : /swim/i.test(a.type) ? 'Swim' : 'Ride';
  return (
    events.find((e) => e.pairedActivityId === a.id) ??
    events.find((e) => e.date === a.date && e.category === 'WORKOUT' && (!e.type || (sport === 'Ride' ? /ride/i.test(e.type) : e.type.includes(sport)))) ??
    null
  );
}

/** Planned vs actual for one ride: a score, the headline numbers and every step against its lap. */
export function WorkoutReview({ activity: a }: { activity: Activity }) {
  const app = useApp();
  const ftp = a.ftp ?? app.ftp;
  const snapshot = app.snapshots[a.date];
  const [ev, setEv] = useState<CalendarEvent | null>(() => plannedFor(a, app.events));
  const [matched, setMatched] = useState<{ m: (LapLike | null)[] | null; source: Review['source'] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Events synced before the review existed don't carry the workout's steps: fetch that day once
  useEffect(() => {
    if (ev?.workoutDoc || !app.canPush || a.source !== 'intervals') return;
    fetchEvents(app.getConnection(), a.date, a.date)
      .then((evs) => setEv(plannedFor(a, evs) ?? ev))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id]);

  const blocks = useMemo(() => (ev?.workoutDoc ? parseWorkoutDoc(ev.workoutDoc, ftp) : null), [ev, ftp]);
  const steps = useMemo(() => (blocks ? flattenBlocks(blocks) : []), [blocks]);

  useEffect(() => {
    setMatched(null);
    setErr(null);
    if (!steps.length || a.source !== 'intervals' || !app.canPush) {
      setMatched({ m: null, source: 'none' });
      return;
    }
    const conn = app.getConnection();
    (async () => {
      try {
        const laps = await fetchActivityLaps(conn, a.id);
        const m = alignLaps(steps, laps, ftp);
        if (m) return setMatched({ m, source: 'laps' });
        const s = await fetchActivityStreams(conn, a.id);
        setMatched(s.watts.length ? { m: sliceStream(steps, s), source: 'stream' } : { m: null, source: 'none' });
      } catch (e) {
        setErr((e as Error).message);
        setMatched({ m: null, source: 'none' });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id, steps.length, ftp]);

  if (!ev && !snapshot) return <p className="small muted">Nothing was planned for this day, so there’s nothing to compare it with.</p>;
  if (!matched) return <p className="small muted">Loading laps…</p>;

  const r = reviewWorkout({
    planned: { secs: ev?.plannedSec ?? (snapshot ? snapshot.durationMin * 60 : null), tss: ev?.plannedTss ?? snapshot?.tss ?? null, blocks },
    actual: { secs: a.movingSec, tss: a.tss, ifactor: a.intensity, np: a.normalizedPower },
    ftp,
    matched: matched.m,
    source: matched.source,
  });
  const name = ev?.name ?? snapshot?.name ?? 'Planned workout';
  const maxPct = Math.max(120, ...r.steps.map((s) => Math.max(s.step.high, s.pct ?? 0))) + 5;
  const total = r.steps.reduce((x, s) => x + s.step.secs, 0) || 1;

  return (
    <div className="review stack" aria-label={`Review of ${a.name}`}>
      <div className="row" style={{ alignItems: 'center', gap: 14 }}>
        <div className={`review-score tone-${r.tone}`} aria-label={`Score ${r.score} out of 100`}>
          <b className="num">{r.score}</b>
          <span className="tiny">{r.label}</span>
        </div>
        <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
          <span className="small">
            Planned <b>{name}</b> · did <b>{a.name}</b>
          </span>
          {r.notes.map((n, i) => (
            <span key={i} className="tiny ink2">
              {n}
            </span>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table className="steps review-table">
          <thead>
            <tr>
              <th />
              <th className="num">Planned</th>
              <th className="num">Actual</th>
              <th className="num">Difference</th>
            </tr>
          </thead>
          <tbody>
            {r.metrics.map((m) => (
              <tr key={m.key}>
                <td>{m.label}</td>
                <td className="num">{m.planned == null ? '—' : m.key === 'duration' ? fmtDur(m.planned) : m.key === 'if' ? m.planned.toFixed(2) : m.key === 'np' ? `${m.planned} W` : Math.round(m.planned)}</td>
                <td className="num">{m.actual == null ? '—' : m.key === 'duration' ? fmtDur(m.actual) : m.key === 'if' ? m.actual.toFixed(2) : m.key === 'np' ? `${m.actual} W` : Math.round(m.actual)}</td>
                <td className={`num ${m.diffPct != null && Math.abs(m.diffPct) >= (m.key === 'if' || m.key === 'np' ? 0.05 : 0.1) ? 'review-off' : 'muted'}`}>{sign(m.diffPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {r.steps.length > 0 && (
        <>
          <svg className="review-chart" viewBox={`0 0 ${total} 100`} preserveAspectRatio="none" role="img" aria-label="Planned targets (shaded) and what you rode (bars) for each step">
            {(() => {
              let x = 0;
              return r.steps.map((s, i) => {
                const w = s.step.secs;
                const y = (p: number) => 100 - (p / maxPct) * 100;
                const el = (
                  <g key={i}>
                    {!s.step.open && <rect x={x} y={y(s.step.high + 3)} width={w} height={Math.max(1.5, y(s.step.low - 3) - y(s.step.high + 3))} className="rv-target" />}
                    {s.pct != null && <rect x={x + w * 0.15} y={y(s.pct)} width={w * 0.7} height={100 - y(s.pct)} className={`rv-actual st-${STATUS[s.status].cls || 'open'}`} />}
                  </g>
                );
                x += w;
                return el;
              });
            })()}
          </svg>
          <div className="legend" style={{ margin: 0 }}>
            <span>
              <i className="box rv-target" /> planned target (±3 % FTP)
            </span>
            <span>
              <i className="box rv-actual st-good" /> your average power
            </span>
            <span className="muted">{r.source === 'laps' ? 'matched to your laps' : 'from your power data, by planned step times'}</span>
          </div>
          <div className="table-wrap">
            <table className="steps review-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Step</th>
                  <th className="num">Planned</th>
                  <th className="num">Actual</th>
                  <th className="num">HR</th>
                  <th className="num">Cad</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {r.steps.map((s) => (
                  <tr key={s.step.n} className={s.step.work ? 'rv-work' : ''}>
                    <td className="num muted">{s.step.n}</td>
                    <td>{s.step.label}</td>
                    <td className="num">
                      {fmtDur(s.step.secs)} · {s.step.open ? 'free' : s.step.low === s.step.high ? `${s.step.low}%` : `${s.step.low}-${s.step.high}%`}
                      {!s.step.open && <span className="muted"> ({Math.round((s.step.low * ftp) / 100)}-{Math.round((s.step.high * ftp) / 100)} W)</span>}
                    </td>
                    <td className="num">
                      {s.actual ? (
                        <>
                          {fmtDur(s.actual.secs)} · {s.actual.avgW != null ? `${Math.round(s.actual.avgW)} W` : '—'}
                          {s.pct != null && <span className="muted"> ({Math.round(s.pct)}%)</span>}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">{s.actual?.hr ? Math.round(s.actual.hr) : '—'}</td>
                    <td className="num">{s.actual?.cadence ? Math.round(s.actual.cadence) : '—'}</td>
                    <td>
                      <span className={`chip tiny rv-chip ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {err && <p className="tiny muted">Couldn’t load laps: {err}</p>}
      <p className="tiny muted">Score: mostly how well the work intervals hit their targets (by duration), plus how close duration, TSS and intensity came to the plan. Easier-than-planned recoveries don’t count against you.</p>
    </div>
  );
}

/** A "Review" toggle that opens the review under it. */
export function ReviewToggle({ activity }: { activity: Activity }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <button className="btn sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'Hide review' : 'Review workout'}
      </button>
      {open && <WorkoutReview activity={activity} />}
    </div>
  );
}
