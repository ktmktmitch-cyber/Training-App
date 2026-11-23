import { useMemo, useState } from 'react';
import type { ComplianceDay } from '../engine/compliance';
import { dowShort, fmtLong, fmtMinutes, fmtShort, fromISO } from '../engine/dates';
import { FOCUS_LABEL, type FocusKey, type LoadFocus } from '../engine/loadFocus';
import { workoutAlternatives } from '../engine/planner';
import { POWER_LABEL, POWER_SECS, powerProfile, type PowerKey } from '../engine/powerProfile';
import { DIFFICULTY_LABEL, FEEDBACK_LABEL, PROG_LABEL, PROG_ZONES, rpeToFeedback, type Difficulty, type Feedback, type Progression } from '../engine/progression';
import type { TrainingStatus } from '../engine/status';
import type { AthleteProfile, CurvePoint, PlannedDay, PowerCurve, Readiness, Trends } from '../engine/types';
import { Skyline } from './charts';
import { ExportBar } from './ExportBar';
import { CATEGORY_LABEL, IntensityChip, Seg, STATUS, StatusIcon } from './ui';

const TONE_STATUS = { good: 'green', neutral: 'unknown', warn: 'amber', bad: 'red' } as const;

export function StatusChip({ status }: { status: TrainingStatus }) {
  return (
    <span className="status-pill" title={status.detail}>
      <StatusIcon status={TONE_STATUS[status.tone]} />
      {status.label}
    </span>
  );
}

export function DifficultyChip({ difficulty, level }: { difficulty: string | null | undefined; level?: number }) {
  if (!difficulty) return null;
  const d = difficulty as Difficulty;
  const bars = { recovery: 1, achievable: 2, productive: 3, stretch: 4, breakthrough: 5, not_recommended: 5 }[d];
  return (
    <span className="chip" title="Workout difficulty relative to your current progression level">
      <span className="diff-bars" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} className={i <= bars ? 'on' : ''} />
        ))}
      </span>
      {DIFFICULTY_LABEL[d]}
      {level != null ? ` · ${level.toFixed(1)}` : ''}
    </span>
  );
}

// ---------- Next workout hero (Garmin daily suggested workout / JOIN "today") ----------
export function NextWorkoutCard(props: {
  day: PlannedDay;
  readiness: Readiness;
  status: TrainingStatus;
  ftp: number;
  isToday: boolean;
  progression: Progression;
  weightKg: number | null;
  onPick: (templateId: string, durationMin: number, level: number) => void;
  onToast?: (msg: string) => void;
}) {
  const { day, readiness, status, ftp, isToday, progression } = props;
  const r = day.ride;
  const alts = r ? workoutAlternatives(r, progression, props.weightKg).filter((a) => ['Easier', 'Shorter', 'Harder'].includes(a.label)) : [];
  const rs = STATUS[readiness.status];
  return (
    <div className="card hero">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
          <span className="tiny muted" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {isToday ? 'Today' : 'Tomorrow'} · {fmtLong(day.date)}
          </span>
          <h2 className="hero-title">{r ? r.name : day.status === 'off' ? 'Unavailable' : 'Rest day'}</h2>
          <div className="day-meta">
            {r && <IntensityChip intensity={r.intensity} category={r.category} />}
            {r && <DifficultyChip difficulty={r.progression?.difficulty} level={r.progression?.workoutLevel} />}
            {day.strength && <span className="chip">🏋 {day.strength.title}</span>}
          </div>
        </div>
        <div className="stack" style={{ alignItems: 'flex-end', gap: 6 }}>
          <span className="status-pill" title={readiness.summary}>
            <StatusIcon status={readiness.status} />
            {rs.label}
            {readiness.score != null ? ` ${readiness.score}` : ''}
          </span>
          <StatusChip status={status} />
        </div>
      </div>
      {r ? (
        <>
          {r.blocks.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Skyline blocks={r.blocks} large ftp={ftp} />
            </div>
          )}
          <div className="hero-stats">
            <div>
              <b className="num">{fmtMinutes(r.durationMin)}</b>
              <span>Duration</span>
            </div>
            <div>
              <b className="num">{r.tss}</b>
              <span>TSS</span>
            </div>
            <div>
              <b className="num">{r.ifactor.toFixed(2)}</b>
              <span>IF</span>
            </div>
            <div>
              <b>{CATEGORY_LABEL[r.category]}</b>
              <span>Primary benefit</span>
            </div>
          </div>
          <p className="small ink2" style={{ marginTop: 8 }}>
            {r.purpose}
          </p>
          <div className="row" style={{ marginTop: 10 }}>
            {alts.map((a) => (
              <button key={a.label} className="btn sm" title={`${a.workout.name} · ${fmtMinutes(a.workout.durationMin)} — ${a.hint}`} onClick={() => props.onPick(a.templateId, a.durationMin, a.level)}>
                {a.label}
              </button>
            ))}
          </div>
          {r.blocks.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <ExportBar workout={r} date={day.date} onDone={props.onToast} compact />
            </div>
          )}
        </>
      ) : (
        <p className="small ink2" style={{ marginTop: 8 }}>
          {day.notes[0] ?? 'Recovery is when the adaptation happens.'}
          {day.strength ? ` Strength today: ${day.strength.title} (~${day.strength.durationMin} min).` : ''}
        </p>
      )}
      <p className="tiny muted" style={{ marginTop: 10 }}>
        {status.detail}
      </p>
    </div>
  );
}

// ---------- Planned vs done (TrainingPeaks compliance + JOIN/TrainerRoad post-ride survey) ----------
const C_COLOR: Record<ComplianceDay['color'], string> = {
  green: 'var(--good)',
  yellow: 'var(--warning)',
  orange: 'var(--serious)',
  red: 'var(--critical)',
  unplanned: 'var(--s-neutral)',
  rest: 'transparent',
  pending: 'var(--accent)',
};
const C_ICON: Record<ComplianceDay['color'], string> = { green: '✓', yellow: '~', orange: '!', red: '×', unplanned: '+', rest: '', pending: '•' };

export function ComplianceStrip({
  days,
  feedback,
  onFeedback,
}: {
  days: ComplianceDay[];
  feedback: Record<string, Feedback>;
  onFeedback: (activityId: string, f: Feedback | null) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const sel = days.find((d) => d.date === open) ?? null;
  return (
    <div className="card">
      <div className="card-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2>Last 7 days</h2>
          <span className="small ink2">Planned vs done. Tap a ride to tell the plan how it felt — that tunes your levels.</span>
        </div>
      </div>
      <div className="tiles">
        {days.map((d) => {
          const act = d.done[0];
          const fb = act ? feedback[act.id] ?? (act.rpe ? rpeToFeedback(act.rpe) : null) : null;
          return (
            <button key={d.date} className={`tile ${open === d.date ? 'on' : ''}`} onClick={() => setOpen(open === d.date ? null : d.date)} disabled={!d.done.length && !d.planned}>
              <span className="tile-top">
                <span className="tiny muted" style={{ fontWeight: 700 }}>
                  {dowShort(d.date)} {fromISO(d.date).getDate()}
                </span>
                {d.color !== 'rest' && (
                  <span className="status-icon" style={{ background: C_COLOR[d.color], color: d.color === 'yellow' ? '#0b0b0b' : '#fff', width: 16, height: 16, fontSize: 10 }} aria-hidden>
                    {C_ICON[d.color]}
                  </span>
                )}
              </span>
              <span className="tile-name">{act ? act.name : d.planned ? d.planned.name : 'Rest'}</span>
              <span className="tiny muted">{d.label}</span>
              {act && <span className="tiny">{fb ? FEEDBACK_LABEL[fb] : <span className="muted">How did it feel?</span>}</span>}
            </button>
          );
        })}
      </div>
      {sel && (
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="small">
            <b>{fmtLong(sel.date)}</b>
            {sel.planned ? (
              <>
                {' '}
                · planned <b>{sel.planned.name}</b>
                {sel.planned.sec ? ` (${fmtMinutes(sel.planned.sec / 60)}${sel.planned.tss ? `, ${sel.planned.tss} TSS` : ''})` : ''}
              </>
            ) : null}
            {sel.done.map((a) => (
              <span key={a.id}>
                {' '}
                · did <b>{a.name}</b> ({fmtMinutes(a.movingSec / 60)}
                {a.tss ? `, ${Math.round(a.tss)} TSS` : ''})
              </span>
            ))}
          </div>
          {sel.done.map((a) => (
            <div key={a.id} className="row">
              <span className="small" style={{ fontWeight: 600 }}>
                {a.name}: how hard was it?
              </span>
              <div className="seg">
                {(Object.keys(FEEDBACK_LABEL) as Feedback[]).map((f) => (
                  <button key={f} className={feedback[a.id] === f ? 'on' : ''} onClick={() => onFeedback(a.id, feedback[a.id] === f ? null : f)}>
                    {FEEDBACK_LABEL[f]}
                  </button>
                ))}
              </div>
              {a.rpe ? <span className="tiny muted">intervals.icu RPE {a.rpe}/10</span> : null}
            </div>
          ))}
        </div>
      )}
      <div className="legend" style={{ marginTop: 10, marginBottom: 0 }}>
        {(['green', 'yellow', 'orange', 'red', 'unplanned'] as const).map((c) => (
          <span key={c}>
            <i className="box" style={{ background: C_COLOR[c] }} />
            {{ green: '80-120% of plan', yellow: '50-80 / 120-150%', orange: '<50 / >150%', red: 'Missed', unplanned: 'Unplanned' }[c]}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- Load focus (Garmin) ----------
const FOCUS_FILL: Record<FocusKey, [string, string]> = { low: ['var(--z2)', 'var(--on-z2)'], high: ['var(--z4)', 'var(--on-z4)'], anaerobic: ['var(--z6)', 'var(--on-z6)'] };

export function LoadFocusCard({ focus }: { focus: LoadFocus }) {
  const keys: FocusKey[] = ['low', 'high', 'anaerobic'];
  const max = Math.max(0.8, ...keys.map((k) => Math.max(focus.share[k], focus.target[k][1]))) * 1.05;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Load focus · 4 weeks</h2>
        <span className="small muted">target band for this phase</span>
      </div>
      <p className="small ink2" style={{ marginBottom: 12 }}>
        {focus.headline}
      </p>
      <div className="stack" style={{ gap: 12 }}>
        {keys.map((k) => {
          const st = focus.status[k];
          return (
            <div key={k} className="hrow">
              <div className="hrow-label">
                <span className="small" style={{ fontWeight: 600 }}>
                  {FOCUS_LABEL[k]}
                </span>
                <span className="tiny muted num">{focus.load[k]} TSS</span>
              </div>
              <div className="htrack" role="img" aria-label={`${FOCUS_LABEL[k]} ${Math.round(focus.share[k] * 100)}%, target ${Math.round(focus.target[k][0] * 100)}-${Math.round(focus.target[k][1] * 100)}%`}>
                <div className="hband" style={{ left: `${(focus.target[k][0] / max) * 100}%`, width: `${((focus.target[k][1] - focus.target[k][0]) / max) * 100}%` }} />
                <div className="hfill" style={{ width: `${(focus.share[k] / max) * 100}%`, background: FOCUS_FILL[k][0] }} />
                <div className="hband-edges" style={{ left: `${(focus.target[k][0] / max) * 100}%`, width: `${((focus.target[k][1] - focus.target[k][0]) / max) * 100}%` }} />
              </div>
              <span className="hrow-val small">
                <b className="num">{Math.round(focus.share[k] * 100)}%</b>{' '}
                <span className="status-icon" style={{ background: st === 'ok' ? 'var(--good)' : st === 'short' ? 'var(--warning)' : 'var(--serious)', color: st === 'short' ? '#0b0b0b' : '#fff', width: 16, height: 16, fontSize: 10, display: 'inline-grid' }} aria-hidden>
                  {st === 'ok' ? '✓' : st === 'short' ? '↓' : '↑'}
                </span>{' '}
                <span className="tiny muted">{st === 'ok' ? 'on target' : st === 'short' ? 'short' : 'over'}</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="tiny muted" style={{ marginTop: 10 }}>
        Low aerobic = Zones 1-2 · high aerobic = tempo → VO2max · anaerobic = above VO2max. Shaded band = target share for this phase.
      </p>
    </div>
  );
}

// ---------- Progression levels (TrainerRoad) ----------
export function ProgressionCard({ progression }: { progression: Progression }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Progression levels</h2>
        <span className="small muted">1-10 · from your rides and feedback</span>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        {PROG_ZONES.map((z) => {
          const p = progression[z];
          return (
            <div key={z} className="hrow">
              <div className="hrow-label">
                <span className="small" style={{ fontWeight: 600 }}>
                  {PROG_LABEL[z]}
                </span>
                <span className="tiny muted">{p.date ? `set ${fmtShort(p.date)}` : 'no data yet'}</span>
              </div>
              <div className="htrack" role="img" aria-label={`${PROG_LABEL[z]} level ${p.level}`}>
                {[2, 4, 6, 8].map((t) => (
                  <i key={t} className="htick" style={{ left: `${t * 10}%` }} />
                ))}
                <div className="hfill" style={{ width: `${p.level * 10}%`, background: 'var(--s1)', opacity: p.source === 'none' ? 0.35 : 1 }} />
              </div>
              <span className="hrow-val small">
                <b className="num">{p.level.toFixed(1)}</b>
              </span>
            </div>
          );
        })}
      </div>
      <p className="tiny muted" style={{ marginTop: 10 }}>
        Levels rise when you complete harder work in a zone and fade slowly when you don’t. Workouts are chosen to be <b>productive</b> (just above your level), <b>achievable</b> in recovery weeks or on tired days, and a <b>stretch</b> late in a block.
      </p>
    </div>
  );
}

// ---------- Power profile (JOIN / 4DP / TrainingPeaks) ----------
function fmtSecs(secs: number): string {
  if (secs < 60) return `${secs} s`;
  if (secs < 3600) return `${secs / 60} min`;
  return `${secs / 3600} h`;
}

function fmtDay(d: string | null | undefined): string {
  return d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

function RideLink({ pt }: { pt: CurvePoint }) {
  const name = pt.activityName ?? 'ride';
  return pt.activityId ? (
    <a href={`https://intervals.icu/activities/${pt.activityId}`} target="_blank" rel="noreferrer">
      {name}
    </a>
  ) : (
    <>{name}</>
  );
}

const WINDOWS: { id: string; label: string }[] = [
  { id: '42d', label: '42 days' },
  { id: '90d', label: '90 days' },
  { id: '1y', label: '1 year' },
];

export function PowerProfileCard({ profile, curves }: { profile: AthleteProfile | null; curves: PowerCurve[] }) {
  const [win, setWin] = useState('90d');
  const power = useMemo(() => powerProfile(profile, curves, win), [profile, curves, win]);
  const curve = curves.find((c) => c.id === win) ?? null;
  const weight = profile?.weightKg ?? curve?.weightKg ?? null;
  if (!power)
    return (
      <div className="card">
        <h2 style={{ marginBottom: 6 }}>Power profile</h2>
        <p className="muted small">Needs your weight and either your intervals.icu power curve or power model (eFTP, W′, Pmax), which appear after a few rides with a power meter.</p>
      </div>
    );
  const keys: PowerKey[] = ['sprint', 'anaerobic', 'vo2', 'threshold'];
  const available = WINDOWS.filter((w) => curves.some((c) => c.id === w.id && c.points.length));
  return (
    <div className="card">
      <div className="card-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2>Power profile</h2>
          <span className="small ink2">
            Rider type: <b>{power.type}</b> · strength: {POWER_LABEL[power.strength].split(' (')[0].toLowerCase()} · limiter: {POWER_LABEL[power.limiter].split(' (')[0].toLowerCase()}
          </span>
        </div>
        {available.length > 0 && (
          <Seg<string> value={win} onChange={setWin} ariaLabel="Best-effort window" options={available.map((w) => ({ value: w.id, label: w.label }))} />
        )}
      </div>
      <div className="stack" style={{ gap: 10 }}>
        {keys.map((k) => {
          const src = power.sources[k];
          return (
            <div key={k} className="hrow">
              <div className="hrow-label">
                <span className="small" style={{ fontWeight: 600 }}>
                  {POWER_LABEL[k]}
                </span>
                <span className="tiny muted num">
                  {power.watts[k]} W · {power.wkg[k].toFixed(1)} W/kg
                </span>
                <span className="tiny muted">
                  {src.kind === 'best' && src.point ? (
                    <>
                      Best {fmtSecs(src.secs!)} · <RideLink pt={src.point} /> · {fmtDay(src.point.date)}
                    </>
                  ) : src.kind === 'model' ? (
                    <>Model estimate (no {fmtSecs(src.secs!)} best on the curve)</>
                  ) : (
                    <>Your FTP</>
                  )}
                </span>
              </div>
              <div className="htrack" role="img" aria-label={`${POWER_LABEL[k]} score ${power.score[k]} of 100`}>
                {[25, 50, 75].map((t) => (
                  <i key={t} className="htick" style={{ left: `${t}%` }} />
                ))}
                <div className="hfill" style={{ width: `${Math.max(2, power.score[k])}%`, background: k === power.limiter ? 'var(--s2)' : 'var(--s1)' }} />
              </div>
              <span className="hrow-val small">
                <b className="num">{power.score[k]}</b>
                {k === power.limiter ? <span className="tiny muted"> limiter</span> : null}
              </span>
            </div>
          );
        })}
      </div>
      <div className="hrow" style={{ marginTop: 4 }}>
        <span />
        <div className="row tiny muted" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          <span>Untrained</span>
          <span>Club</span>
          <span>Elite</span>
          <span>World class</span>
        </div>
        <span />
      </div>
      <p className="tiny muted" style={{ marginTop: 8 }}>
        {power.note} When a phase offers a choice, sessions that target your limiter are preferred.
      </p>
      {curve && curve.points.length > 0 && (
        <details className="more" style={{ marginTop: 8 }}>
          <summary>
            All best efforts · {curve.label.toLowerCase()}
            {curve.start && curve.end ? ` (${fmtDay(curve.start)} – ${fmtDay(curve.end)})` : ''}
          </summary>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Duration</th>
                  <th className="num">Watts</th>
                  <th className="num">W/kg</th>
                  <th>Ride</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {curve.points.map((pt) => (
                  <tr key={pt.secs}>
                    <td>{fmtSecs(pt.secs)}</td>
                    <td className="num">{pt.watts}</td>
                    <td className="num">{weight ? (pt.watts / weight).toFixed(1) : '—'}</td>
                    <td style={{ whiteSpace: 'normal', minWidth: 160 }}>
                      <RideLink pt={pt} />
                    </td>
                    <td>{fmtDay(pt.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tiny muted" style={{ marginTop: 6 }}>
            From intervals.icu’s power curve (Ride). Weight {weight ? `${Math.round(weight * 10) / 10} kg` : 'not set'}.
            {(['sprint', 'anaerobic', 'vo2'] as const).some((k) => power.sources[k].modelWatts) && (
              <>
                {' '}For comparison, the power model predicts{' '}
                {(['sprint', 'anaerobic', 'vo2'] as const)
                  .filter((k) => power.sources[k].modelWatts)
                  .map((k) => `${fmtSecs(POWER_SECS[k])} ${power.sources[k].modelWatts} W`)
                  .join(', ')}
                .
              </>
            )}
          </p>
        </details>
      )}
    </div>
  );
}

// ---------- Aerobic base (decoupling / efficiency factor) ----------
export function AerobicCard({ trends }: { trends: Trends }) {
  const a = trends.aerobic;
  const verdict = { solid: 'Solid aerobic base', developing: 'Aerobic base developing', needs_work: 'Aerobic base needs work', unknown: 'Not enough steady rides' }[a.verdict];
  const st = { solid: 'green', developing: 'amber', needs_work: 'red', unknown: 'unknown' }[a.verdict] as 'green' | 'amber' | 'red' | 'unknown';
  return (
    <div className="card">
      <div className="card-head">
        <h2>Aerobic base</h2>
        <span className="status-pill">
          <StatusIcon status={st} />
          {verdict}
        </span>
      </div>
      <div className="grid-3">
        <div className="metric">
          <div className="label">Decoupling (median)</div>
          <div className="value num">{a.median != null ? `${a.median}%` : '—'}</div>
          <div className="sub">&lt;5% is a well-developed base</div>
        </div>
        <div className="metric">
          <div className="label">Efficiency factor</div>
          <div className="value num">{a.efChange != null ? `${a.efChange >= 0 ? '+' : ''}${a.efChange}%` : '—'}</div>
          <div className="sub">last 4 wk vs the 4 before</div>
        </div>
        <div className="metric">
          <div className="label">Steady rides used</div>
          <div className="value num">{a.rides.length}</div>
          <div className="sub">≥75 min, IF ≤ 0.78, last 6 wk</div>
        </div>
      </div>
      {a.rides.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="steps">
            <thead>
              <tr>
                <th>Ride</th>
                <th className="num">Duration</th>
                <th className="num">Decoupling</th>
                <th className="num">EF</th>
              </tr>
            </thead>
            <tbody>
              {a.rides.map((r) => (
                <tr key={r.date + r.minutes}>
                  <td>{fmtShort(r.date)}</td>
                  <td className="num">{fmtMinutes(r.minutes)}</td>
                  <td className="num">{r.decoupling}%</td>
                  <td className="num">{r.ef?.toFixed(2) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="tiny muted" style={{ marginTop: 8 }}>
        Aerobic decoupling is how much heart rate drifts relative to power over a steady ride (Pw:HR). Heat, dehydration and stops inflate it, so look at the trend.
      </p>
    </div>
  );
}
