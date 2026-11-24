import { Fragment, useState } from 'react';
import { dowLong, dowShort, fmtMinutes, fromISO } from '../engine/dates';
import type { AthleteProfile, Block, GroupIntensity, ISODate, PlannedDay, TargetMode } from '../engine/types';
import { parseCoachId, workoutAlternatives } from '../engine/planner';
import { DIFFICULTY_LABEL, type Difficulty, type Progression } from '../engine/progression';
import { paceLabel, type Sport } from '../engine/runswim';
import { ALL_WORKOUTS, WORKOUT_BY_ID } from '../engine/workouts';
import { useApp } from '../lib/store';
import { Skyline } from './charts';
import { ExportBar } from './ExportBar';
import { MobilityBlock } from './MobilityCard';
import { DifficultyChip } from './insights';
import { CATEGORY_LABEL, hrFor, IntensityChip, Seg, watts } from './ui';

function fmtStep(sec: number) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}:${String(s).padStart(2, '0')}` : `${m} min`;
}

export function StepsTable({ blocks, ftp, profile, mode, sport = 'ride', paceMps }: { blocks: Block[]; ftp: number; profile: AthleteProfile | null; mode: TargetMode; sport?: Sport; paceMps?: number | null }) {
  if (sport !== 'ride') return <PaceSteps blocks={blocks} sport={sport} paceMps={paceMps ?? null} />;
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

function PaceSteps({ blocks, sport, paceMps }: { blocks: Block[]; sport: Sport; paceMps: number | null }) {
  return (
    <div className="table-wrap">
      <table className="steps">
        <thead>
          <tr>
            <th>Step</th>
            <th className="num">Time</th>
            <th className="num">% {sport === 'swim' ? 'CSS' : 'threshold pace'}</th>
            <th className="num">Pace</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((b, bi) => (
            <Fragment key={bi}>
              {(b.reps > 1 || b.name) && (
                <tr className="set-head">
                  <td colSpan={4}>
                    {b.name ?? 'Recover'}
                    {b.reps > 1 ? ` · ${b.reps}×` : ''}
                  </td>
                </tr>
              )}
              {b.steps.map((st, i) => {
                const pct = st.ramp ? `${st.low}→${st.high}%` : st.low === st.high ? `${st.low}%` : `${st.low}-${st.high}%`;
                const pl = (x: number) => paceLabel(x, paceMps, sport)?.replace(/\/.*$/, '') ?? null;
                // faster % = quicker pace, so the high % gives the low time
                const pace = paceMps && st.low > 55 ? (st.low === st.high ? pl(st.low) : `${pl(st.high)}–${pl(st.low)}`) : st.low <= 55 ? 'rest' : 'by feel';
                return (
                  <tr key={i}>
                    <td>{st.label ?? (st.low >= 100 ? 'Hard' : st.low <= 72 ? 'Easy' : 'Steady')}</td>
                    <td className="num">{fmtStep(st.durationSec)}</td>
                    <td className="num">{pct}</td>
                    <td className="num">
                      {pace}
                      {paceMps && st.low > 55 ? <span className="muted">{sport === 'swim' ? '/100m' : '/km'}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </Fragment>
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

const SPORT_NAME: Record<Sport, string> = { ride: 'Ride', run: 'Run', swim: 'Swim' };

export function DayCard(props: {
  day: PlannedDay;
  ftp: number;
  profile: AthleteProfile | null;
  mode: TargetMode;
  isToday: boolean;
  customized: boolean;
  progression: Progression;
  onSwap: (templateId: string, durationMin: number, level?: number) => void;
  onRest: () => void;
  onReset: () => void;
  onGroup: (g: { name?: string; durationMin: number; intensity: GroupIntensity }) => void;
  groupCfg?: { name?: string; durationMin: number; intensity: GroupIntensity } | null;
  onToast?: (msg: string) => void;
  /** other days of this week you can move this workout to */
  moveTargets?: { date: ISODate; label: string }[];
  onMove?: (to: ISODate) => void;
  /** you moved your coach's workout from this day to another */
  movedTo?: ISODate | null;
}) {
  const { day, ftp, profile, mode, isToday, customized } = props;
  const [open, setOpen] = useState(false);
  const r = day.ride;
  const [swapId, setSwapId] = useState(r?.templateId && !['group', 'race'].includes(r.templateId) ? r.templateId : 'endurance');
  const [swapDur, setSwapDur] = useState(r?.durationMin ?? 60);
  const [grp, setGrp] = useState(() => props.groupCfg ?? { name: '', durationMin: 120, intensity: 'hard' as GroupIntensity });
  const app = useApp();
  const mode2 = app.settings.prefs.sport ?? 'cycling';
  const sportsAllowed: Sport[] = mode2 === 'cycling' ? ['ride'] : mode2 === 'running' ? ['run'] : mode2 === 'run_bike' ? ['ride', 'run'] : ['ride', 'run', 'swim'];
  const paceFor = (sp: Sport) => (sp === 'run' ? (app.settings.prefs.runPaceMps ?? profile?.runThresholdMps ?? null) : sp === 'swim' ? (app.settings.prefs.swimCssMps ?? profile?.swimCssMps ?? null) : null);
  const extras = day.extras ?? [];
  // The coach's workout for this day, if the rider has replaced it (kept on their calendar as a note)
  const coachEv = r?.fixed !== 'calendar' ? app.events.find((e) => e.date === day.date && (e.externalId ?? '').startsWith('tacoach-')) : undefined;
  const coachTpl = coachEv ? parseCoachId(coachEv.externalId) : null;
  const hasRec = r?.fixed === 'calendar' && day.recommended !== undefined;
  const rec = hasRec ? day.recommended : null;
  const off = day.status === 'off';
  const fromCoach = !!r?.why[0]?.startsWith('From your coach');
  const [moveTo, setMoveTo] = useState<ISODate>('');
  const title = r ? r.name : extras[0] ? extras[0].name : off ? 'Unavailable' : 'Rest day';
  const allMin = (r?.durationMin ?? 0) + extras.reduce((a, x) => a + x.durationMin, 0);
  const allTss = (r?.tss ?? 0) + extras.reduce((a, x) => a + x.tss, 0);
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
            {r && r.key && <DifficultyChip difficulty={r.progression?.difficulty} />}
            {day.strength && <span className="chip">🏋 {day.strength.title}</span>}
            {r?.fixed === 'group' && <span className="chip">Your group ride</span>}
            {r?.fixed === 'pinned' && !fromCoach && <span className="chip">{r.why[0]?.startsWith('Moved here') ? 'Moved' : 'Your pick'}</span>}
            {fromCoach && (
              <span className="chip coach-chip">
                <span className="coach-dot" />
                From your coach
              </span>
            )}
            {r?.fixed === 'calendar' && !fromCoach && <span className="chip">On your calendar</span>}
            {day.mobility && <span className="chip">Mobility {day.mobility.minutes}′</span>}
            {r && (r.sport ?? 'ride') !== 'ride' && <span className="chip">{SPORT_NAME[r.sport!]}</span>}
            {extras.map((x, i) => (
              <span key={i} className="chip">
                {r || i > 0 ? '+ ' : ''}
                {SPORT_NAME[x.sport ?? 'ride']} {fmtMinutes(x.durationMin)}
              </span>
            ))}
          </div>
          {fromCoach && (
            <div className="tiny coach-note">
              Scheduled by your coach{r?.why[0]?.match(/moved it here from (\w+)/) ? ` — you moved it here from ${r.why[0].match(/moved it here from (\w+)/)![1]}` : ''}. You can still make it easier, swap it or move it to another day.
            </div>
          )}
          {props.movedTo && <div className="tiny muted">You moved your coach’s workout to {dowLong(props.movedTo)}.</div>}
          {r && r.blocks.length > 0 && <Skyline blocks={r.blocks} />}
        </div>
        <div className="day-right">
          {r || extras.length ? (
            <>
              <div className="dur num">{fmtMinutes(allMin)}</div>
              <div className="tiny muted num">{allTss} TSS</div>
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
                    <span>IF {r.ifactor.toFixed(2)}</span>·<span>{r.tss} TSS</span>
                    {(r.sport ?? 'ride') === 'ride' && (
                      <>
                        ·<span>FTP {ftp} W</span>
                      </>
                    )}
                  </div>
                  <StepsTable blocks={r.blocks} ftp={ftp} profile={profile} mode={mode} sport={r.sport ?? 'ride'} paceMps={paceFor(r.sport ?? 'ride')} />
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
          {hasRec && (
            <div className="callout row" style={{ alignItems: 'center' }}>
              <span className="small">
                <b>Plan’s recommendation</b> for this day: {rec ? `${rec.name} · ${fmtMinutes(rec.durationMin)} · ${rec.tss} TSS` : 'rest'}
              </span>
              <span className="spacer" />
              {rec && WORKOUT_BY_ID[rec.templateId] && (
                <button className="btn sm" onClick={() => props.onSwap(rec.templateId, rec.durationMin, rec.level)}>
                  Use this instead
                </button>
              )}
            </div>
          )}
          {coachEv && coachTpl && !props.movedTo && (
            <div className="callout row" style={{ alignItems: 'center' }}>
              <span className="small">
                <b>Your coach planned:</b> {coachEv.name.replace(/^Coach’s plan: /, '').replace(/ \(you changed this day\)$/, '')}
                {coachEv.plannedSec ? ` · ${fmtMinutes(Math.round(coachEv.plannedSec / 60))}` : ''}
              </span>
              <span className="spacer" />
              <button className="btn sm" onClick={() => props.onSwap(coachTpl.templateId, coachEv.plannedSec ? Math.round(coachEv.plannedSec / 60) : 60, coachTpl.level ?? undefined)}>
                Switch back to coach’s workout
              </button>
            </div>
          )}
          {extras.map((x, i) => (
            <div key={i} className="stack extra-session">
              <div className="row" style={{ alignItems: 'baseline' }}>
                <h3 style={{ margin: 0 }}>
                  {SPORT_NAME[x.sport ?? 'ride']} · {x.name}
                </h3>
                <span className="spacer" />
                <span className="chip">
                  {fmtMinutes(x.durationMin)} · {x.tss} TSS
                </span>
              </div>
              <p className="small ink2">{x.purpose}</p>
              {x.blocks.length > 0 && <StepsTable blocks={x.blocks} ftp={ftp} profile={profile} mode={mode} sport={x.sport ?? 'ride'} paceMps={paceFor(x.sport ?? 'ride')} />}
              {x.why.length > 0 && <p className="tiny muted">{x.why.join(' ')}</p>}
              {x.blocks.length > 0 && <ExportBar workout={x} date={day.date} onDone={props.onToast} compact />}
            </div>
          ))}
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
          {day.mobility && <MobilityBlock session={day.mobility} />}

          <div className="divider" />
          {(r || customized) && (() => {
            const alts = r ? workoutAlternatives(r, props.progression, profile?.weightKg ?? null) : [];
            return alts.length || customized ? (
              <div className="stack">
                <h3>Swap</h3>
                <div className="alts">
                  {customized && (
                    <button className="alt alt-reset" onClick={props.onReset}>
                      <b>↺ Recommended</b>
                      <span>Back to the plan’s pick</span>
                      <span className="muted">Undo your changes to this day</span>
                    </button>
                  )}
                  {alts.map((a) => (
                    <button key={a.label} className="alt" onClick={() => props.onSwap(a.templateId, a.durationMin, a.level)}>
                      <b>{a.label}</b>
                      <span>
                        {a.workout.name} · {fmtMinutes(a.workout.durationMin)}
                      </span>
                      <span className="muted">
                        {a.workout.progression?.difficulty ? `${DIFFICULTY_LABEL[a.workout.progression.difficulty as Difficulty]} · ` : ''}
                        {a.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null;
          })()}
          <details className="more" open={day.status === 'group' || undefined}>
            <summary>{day.status === 'group' ? 'Group ride — edit' : 'Group ride this day…'}</summary>
            <div className="setup-extra" style={{ marginTop: 8 }}>
              <label className="field" style={{ flex: '1 1 160px' }}>
                <span>Name (optional)</span>
                <input className="input" placeholder="Saturday shop ride" value={grp.name ?? ''} onChange={(e) => setGrp({ ...grp, name: e.target.value })} />
              </label>
              <label className="field" style={{ flex: '0 1 110px' }}>
                <span>Length</span>
                <select className="select" value={grp.durationMin} onChange={(e) => setGrp({ ...grp, durationMin: Number(e.target.value) })} aria-label="Group ride length">
                  {[45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360].map((m) => (
                    <option key={m} value={m}>
                      {fmtMinutes(m)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field">
                <span>Intensity</span>
                <Seg<GroupIntensity>
                  value={grp.intensity}
                  onChange={(v) => setGrp({ ...grp, intensity: v })}
                  ariaLabel="Group ride intensity"
                  options={[
                    { value: 'social', label: 'Social' },
                    { value: 'tempo', label: 'Steady' },
                    { value: 'hard', label: 'Hard' },
                    { value: 'race', label: 'Race pace' },
                  ]}
                />
              </div>
              <button className="btn sm primary" onClick={() => props.onGroup({ ...grp, name: grp.name?.trim() || undefined })}>
                {day.status === 'group' ? 'Update group ride' : 'Add group ride'}
              </button>
            </div>
            <p className="tiny muted" style={{ marginTop: 6 }}>The rest of the week re-plans around it — a hard group ride counts as a quality day.</p>
          </details>
          <details className="more">
            <summary>Pick any workout…</summary>
          <div className="setup-extra" style={{ marginTop: 8 }}>
            <label className="field">
              <span>Swap workout</span>
              <select className="select" value={swapId} onChange={(e) => setSwapId(e.target.value)}>
                {(['recovery', 'endurance', 'tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic', 'sprint', 'race_sim', 'durability', 'openers', 'test'] as const).map((cat) => {
                  const ws = ALL_WORKOUTS.filter((w) => w.category === cat && sportsAllowed.includes(w.sport ?? 'ride'));
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
          </div>
          </details>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <button className="btn sm ghost" onClick={props.onRest}>
              Can’t train
            </button>
            {r && WORKOUT_BY_ID[r.templateId] && props.onMove && (props.moveTargets?.length ?? 0) > 0 && (
              <>
                <span className="spacer" />
                <label className="field" style={{ flex: '0 1 170px' }}>
                  <span>Move to another day</span>
                  <select className="select" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move to day">
                    <option value="">Pick a day…</option>
                    {props.moveTargets!.map((t) => (
                      <option key={t.date} value={t.date}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn sm" disabled={!moveTo} onClick={() => { props.onMove!(moveTo); setMoveTo(''); }}>
                  Move
                </button>
              </>
            )}
          </div>
          {r && r.blocks.length > 0 && <ExportBar workout={r} date={day.date} onDone={props.onToast} />}
        </div>
      )}
    </div>
  );
}
