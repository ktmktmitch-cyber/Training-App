import { useState } from 'react';
import { dowShort, fmtMinutes, fromISO } from '../engine/dates';
import type { AthleteProfile, Block, PlannedDay, TargetMode } from '../engine/types';
import { WORKOUTS } from '../engine/workouts';
import { Skyline } from './charts';
import { CATEGORY_LABEL, hrFor, IntensityChip, watts } from './ui';

function fmtStep(sec: number) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}:${String(s).padStart(2, '0')}` : `${m} min`;
}

function StepsTable({ blocks, ftp, profile, mode }: { blocks: Block[]; ftp: number; profile: AthleteProfile | null; mode: TargetMode }) {
  return (
    <div className="table-wrap">
      <table className="steps">
        <thead>
          <tr>
            <th>Step</th>
            <th className="num">Time</th>
            <th className="num">{mode === 'hr' ? 'HR (bpm)' : '% FTP'}</th>
            <th className="num">{mode === 'hr' ? '% FTP' : 'Watts'}</th>
            {mode === 'power' && <th className="num">HR</th>}
          </tr>
        </thead>
        <tbody>
          {blocks.map((b, bi) => (
            <BlockRows key={bi} b={b} ftp={ftp} profile={profile} mode={mode} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockRows({ b, ftp, profile, mode }: { b: Block; ftp: number; profile: AthleteProfile | null; mode: TargetMode }) {
  const head = b.reps > 1 || b.name;
  return (
    <>
      {head && (
        <tr className="set-head">
          <td colSpan={mode === 'power' ? 5 : 4}>
            {b.name ?? 'Recover'}
            {b.reps > 1 ? ` · ${b.reps}×` : ''}
          </td>
        </tr>
      )}
      {b.steps.map((s, i) => {
        const pct = s.ramp ? `${s.low}→${s.high}%` : s.low === s.high ? `${s.low}%` : `${s.low}-${s.high}%`;
        const w = s.ramp ? `${watts(s.low, ftp)}→${watts(s.high, ftp)}` : s.low === s.high ? `${watts(s.low, ftp)}` : `${watts(s.low, ftp)}-${watts(s.high, ftp)}`;
        const hr = hrFor((s.low + s.high) / 2, profile);
        return (
          <tr key={i}>
            <td>
              {s.label ?? (s.low >= 100 ? 'Work' : s.low <= 56 ? 'Easy' : 'Steady')}
              {s.cadence ? <span className="muted"> · {s.cadence}</span> : null}
            </td>
            <td className="num">{fmtStep(s.durationSec)}</td>
            <td className="num">{mode === 'hr' ? (s.durationSec >= 120 ? hr ?? '—' : 'RPE 9') : pct}</td>
            <td className="num">{mode === 'hr' ? pct : w}</td>
            {mode === 'power' && <td className="num muted">{s.durationSec >= 120 ? hr ?? '' : ''}</td>}
          </tr>
        );
      })}
    </>
  );
}

export function DayCard(props: {
  day: PlannedDay;
  ftp: number;
  profile: AthleteProfile | null;
  mode: TargetMode;
  isToday: boolean;
  customized: boolean;
  onSwap: (templateId: string, durationMin: number) => void;
  onRest: () => void;
  onReset: () => void;
}) {
  const { day, ftp, profile, mode, isToday, customized } = props;
  const [open, setOpen] = useState(false);
  const r = day.ride;
  const [swapId, setSwapId] = useState(r?.templateId && !['group', 'race'].includes(r.templateId) ? r.templateId : 'endurance');
  const [swapDur, setSwapDur] = useState(r?.durationMin ?? 60);
  const off = day.status === 'off';
  const title = r ? r.name : off ? 'Unavailable' : 'Rest day';
  const d = fromISO(day.date);

  return (
    <div className={`day ${r ? '' : 'rest'}`}>
      <div className="day-head" onClick={() => setOpen((o) => !o)} role="button" aria-expanded={open} tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen((o) => !o)}>
        <div className={`day-date ${isToday ? 'today' : ''}`}>
          <div className="dow">{dowShort(day.date)}</div>
          <div className="dom">{d.getDate()}</div>
        </div>
        <div className="day-title">
          <div className="name">{title}</div>
          <div className="day-meta">
            {r && <IntensityChip intensity={r.intensity} category={r.category} />}
            {day.strength && <span className="chip">🏋 {day.strength.title}</span>}
            {r?.fixed === 'group' && <span className="chip">Your group ride</span>}
            {r?.fixed === 'pinned' && <span className="chip">Your pick</span>}
            {!r && day.mobility && <span className="chip">Mobility</span>}
          </div>
          {r && r.blocks.length > 0 && <Skyline blocks={r.blocks} />}
        </div>
        <div className="day-right">
          {r ? (
            <>
              <div className="dur num">{fmtMinutes(r.durationMin)}</div>
              <div className="tiny muted num">{r.tss} TSS</div>
            </>
          ) : (
            <div className="tiny muted">{day.strength ? `${day.strength.durationMin} min lift` : '—'}</div>
          )}
        </div>
      </div>
      {open && (
        <div className="day-body">
          {r && (
            <div className="stack">
              <p className="ink2">{r.purpose}</p>
              {r.blocks.length > 0 && (
                <>
                  <Skyline blocks={r.blocks} large ftp={ftp} />
                  <div className="row tiny muted">
                    <span>IF {r.ifactor.toFixed(2)}</span>·<span>{r.tss} TSS</span>·<span>FTP {ftp} W</span>
                  </div>
                  <StepsTable blocks={r.blocks} ftp={ftp} profile={profile} mode={mode} />
                </>
              )}
              {r.why.length > 0 && (
                <ul className="why">
                  {r.why.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              {r.fueling && (
                <div className="callout">
                  <b>Fueling:</b> {r.fueling}
                </div>
              )}
            </div>
          )}
          {day.notes.length > 0 && (
            <ul className="why">
              {day.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          {day.strength && (
            <div className="lift stack">
              <div className="row">
                <h3>Strength · {day.strength.title}</h3>
                <span className="spacer" />
                <span className="chip">~{day.strength.durationMin} min</span>
              </div>
              <p className="small ink2">{day.strength.focus}</p>
              <div className="table-wrap">
                <table className="steps">
                  <thead>
                    <tr>
                      <th>Exercise</th>
                      <th className="num">Sets × reps</th>
                      <th>Load</th>
                      <th>Rest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.strength.exercises.map((e, i) => (
                      <tr key={i}>
                        <td>
                          {e.name}
                          {e.notes ? <div className="tiny muted">{e.notes}</div> : null}
                        </td>
                        <td className="num">
                          {e.sets} × {e.reps}
                        </td>
                        <td>{e.load}</td>
                        <td>{e.rest}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small">
                <b>When:</b> {day.strength.timing}
              </p>
              <ul className="why">
                {day.strength.why.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {day.mobility && <p className="small ink2">{day.mobility}</p>}

          <div className="divider" />
          <div className="setup-extra">
            <label className="field">
              <span>Swap workout</span>
              <select className="select" value={swapId} onChange={(e) => setSwapId(e.target.value)}>
                {(['recovery', 'endurance', 'tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic', 'sprint', 'race_sim', 'durability', 'openers', 'test'] as const).map((cat) => {
                  const ws = WORKOUTS.filter((w) => w.category === cat);
                  return ws.length ? (
                    <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
                      {ws.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
            </label>
            <label className="field" style={{ flex: '0 1 110px' }}>
              <span>Minutes</span>
              <input className="input num" type="number" min={20} max={420} step={5} value={swapDur} onChange={(e) => setSwapDur(Number(e.target.value))} />
            </label>
            <button className="btn sm" onClick={() => props.onSwap(swapId, swapDur)}>
              Use this
            </button>
            <button className="btn sm ghost" onClick={props.onRest}>
              Can’t train
            </button>
            {customized && (
              <button className="btn sm ghost" onClick={props.onReset}>
                Reset day
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
