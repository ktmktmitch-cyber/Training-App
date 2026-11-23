import { addDays, diffDays, fmtShort, mondayOf } from '../engine/dates';
import { canChooseRest, EVENT_LABELS, PHASE_LABELS, taperDaysFor } from '../engine/periodization';
import { projectSeason } from '../engine/projection';
import type { EventType, GoalSettings, IntensityModel, LoadPattern, Phase, PeriodizationModel } from '../engine/types';
import { LineChart } from '../components/charts';
import { Field, Seg } from '../components/ui';
import { toggleRestWeek } from '../lib/restWeeks';
import { useApp } from '../lib/store';

const MODELS: { id: PeriodizationModel; name: string; desc: string }[] = [
  { id: 'linear', name: 'Traditional (linear)', desc: 'Base → Build → Peak → Taper. Volume first, then intensity and specificity. The most common, well-understood structure.' },
  { id: 'block', name: 'Block', desc: 'Concentrated 3-4 week blocks (accumulation ↔ transmutation with a HIT-block week), then realization. Strong evidence in trained cyclists.' },
  { id: 'reverse', name: 'Reverse', desc: 'Intensity first while hours are limited (winter), then volume and long, race-like rides as the event nears. Good for long events.' },
  { id: 'hrv_flex', name: 'HRV-guided', desc: 'Traditional phases, but intensity only happens when your HRV is in range — otherwise easy. Re-plan each morning.' },
];

const DISTS: { id: IntensityModel; name: string; desc: string }[] = [
  { id: 'auto', name: 'Auto (recommended)', desc: 'Pyramidal in base, polarized in build/peak; sweet-spot heavy if you have <6 h/week.' },
  { id: 'polarized', name: 'Polarized', desc: '~80% easy, ~15-20% hard, little in between. Best evidence for VO2max gains in trained athletes.' },
  { id: 'pyramidal', name: 'Pyramidal', desc: 'Mostly easy, more tempo/threshold than hard. What most elite cyclists actually do in base.' },
  { id: 'sweetspot', name: 'Sweet spot / time-crunched', desc: 'More moderate-hard work per hour. Effective when weekly hours are low.' },
];

export const PHASE_COLOR: Record<Phase, string> = {
  prep: 'var(--s-neutral)',
  base: 'var(--s1)',
  accumulation: 'var(--s1)',
  volume: 'var(--s1)',
  maintain: 'var(--s1)',
  transition: 'var(--s-neutral)',
  build: 'var(--s2)',
  transmutation: 'var(--s2)',
  intensity: 'var(--s2)',
  peak: 'var(--s3)',
  realization: 'var(--s3)',
  specific: 'var(--s3)',
  taper: 'var(--s4)',
  race: 'var(--s5)',
};

export function SeasonPage() {
  const app = useApp();
  const { settings, macro, asOf } = app;
  const g = settings.goal;
  const set = (patch: Partial<GoalSettings>) => app.updateSettings((s) => ({ ...s, goal: { ...s.goal, ...patch } }));
  const currentMonday = mondayOf(addDays(asOf, 1));
  const weeks = macro.weeks.filter((w) => diffDays(addDays(w.start, 6), asOf) >= 0);
  const ctl0 = app.readiness.ctl ?? app.trends.ctl ?? 40;
  const atl0 = app.readiness.atl ?? app.trends.atl ?? 40;
  const proj = projectSeason(macro, g.typicalWeeklyHours, ctl0, atl0, addDays(asOf, 1));

  // contiguous phase segments for direct labels
  const segs: { phase: Phase; n: number }[] = [];
  for (const w of weeks) {
    const last = segs[segs.length - 1];
    if (last && last.phase === w.phase) last.n++;
    else segs.push({ phase: w.phase, n: 1 });
  }

  return (
    <>
      <h1>Season plan</h1>
      <div className="card stack-lg">
        <h2>Goal</h2>
        <div className="grid-3">
          <Field label="Event name">
            <input className="input" value={g.eventName} placeholder="e.g. Unbound 100" onChange={(e) => set({ eventName: e.target.value })} />
          </Field>
          <Field label="Event date" hint={!g.eventDate && g.useCalendarRaces ? 'Empty = use your next A race from intervals.icu' : undefined}>
            <input className="input" type="date" value={g.eventDate ?? ''} min={asOf} onChange={(e) => set({ eventDate: e.target.value || null, eventType: g.eventType === 'fitness' && e.target.value ? 'road_race' : g.eventType })} />
          </Field>
          <Field label="Event type">
            <select className="select" value={g.eventType} onChange={(e) => set({ eventType: e.target.value as EventType })}>
              {Object.entries(EVENT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Expected event duration (h)">
            <input className="input num" type="number" min={0.25} max={24} step={0.25} value={g.eventDurationHours} onChange={(e) => set({ eventDurationHours: Number(e.target.value) || 1 })} />
          </Field>
          <Field label="Typical hours / week" hint="Used for the season projection; you set exact hours each week.">
            <input className="input num" type="number" min={2} max={30} step={0.5} value={g.typicalWeeklyHours} onChange={(e) => set({ typicalWeeklyHours: Number(e.target.value) || 6 })} />
          </Field>
          <Field label="Plan started" hint="Phases are anchored to this date so recovery weeks don’t shift.">
            <div className="row">
              <input className="input" type="date" value={g.planStart ?? ''} onChange={(e) => set({ planStart: e.target.value || null })} />
              <button className="btn sm ghost" onClick={() => set({ planStart: currentMonday })}>
                Restart now
              </button>
            </div>
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={g.useCalendarRaces} onChange={(e) => set({ useCalendarRaces: e.target.checked })} />
          <span>Read A/B/C races (and sick/holiday days) from my intervals.icu calendar</span>
        </label>

        <div className="stack">
          <h3>Macro periodization</h3>
          <div className="model-cards">
            {MODELS.map((m) => (
              <button key={m.id} className={`model-card ${g.model === m.id ? 'on' : ''}`} onClick={() => set({ model: m.id })}>
                <b>{m.name}</b>
                <span>{m.desc}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="stack">
          <h3>Intensity distribution</h3>
          <div className="model-cards">
            {DISTS.map((m) => (
              <button key={m.id} className={`model-card ${g.intensity === m.id ? 'on' : ''}`} onClick={() => set({ intensity: m.id })}>
                <b>{m.name}</b>
                <span>{m.desc}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <h3>Loading pattern</h3>
          <Seg<LoadPattern>
            value={g.loadPattern}
            onChange={(v) => set({ loadPattern: v })}
            options={[
              { value: '2:1', label: '2:1' },
              { value: '3:1', label: '3:1' },
              { value: '4:1', label: '4:1' },
            ]}
          />
          <span className="small muted">Load weeks : recovery week. 3:1 is standard; 2:1 suits masters riders or high life stress.</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="stack" style={{ gap: 2 }}>
            <h2>Timeline</h2>
            <span className="small ink2">{macro.summary.join(' ')}</span>
          </div>
          {macro.goalDate && <span className="chip">Taper ≈ {taperDaysFor(g.eventType, g.eventDurationHours)} days</span>}
        </div>
        <div className="tl-scroll">
        <div style={{ minWidth: weeks.length * 16 }}>
        <div className="timeline" role="img" aria-label="Weekly volume by phase">
          {weeks.map((w) => (
            <div
              key={w.start}
              className={`tl-week ${w.start === currentMonday ? 'current' : ''}`}
              title={`${fmtShort(w.start)} · ${PHASE_LABELS[w.phase]} ${w.weekType !== 'load' ? `(${w.weekType})` : ''} · ${Math.round(w.volumeFactor * 100)}% volume`}
              style={{ height: `${Math.round(w.volumeFactor * 100)}%`, background: PHASE_COLOR[w.phase], opacity: w.weekType === 'recovery' ? 0.45 : 1 }}
            />
          ))}
        </div>
        <div className="tl-labels">
          {segs.map((s, i) => (
            <div key={i} style={{ flex: `${s.n} 0 ${s.n * 14}px`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.n >= 2 ? PHASE_LABELS[s.phase] : ''}
            </div>
          ))}
        </div>
        </div>
        </div>
        <p className="tiny muted" style={{ marginTop: 6 }}>
          Bar height = share of your available hours. Faded bars are recovery weeks. Outlined = this week.
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="stack" style={{ gap: 2 }}>
            <h2>Projected fitness</h2>
            <span className="small ink2">
              At {g.typicalWeeklyHours} h/week. Fitness (CTL) from {Math.round(ctl0)}
              {proj.raceDay ? ` to ~${Math.round(proj.raceDay.ctl)} on race day, form ${proj.raceDay.tsb >= 0 ? '+' : ''}${Math.round(proj.raceDay.tsb)} (aim for roughly +5 to +25)` : ''}.
            </span>
          </div>
        </div>
        {proj.points.length > 1 ? (
          <LineChart
            title="Projected fitness and form"
            labels={proj.points.map((p) => fmtShort(p.date))}
            series={[
              { name: 'Fitness (CTL)', color: 'var(--s1)', values: proj.points.map((p) => p.ctl) },
              { name: 'Form (TSB)', color: 'var(--s2)', values: proj.points.map((p) => p.tsb) },
            ]}
            zeroLine
            height={200}
          />
        ) : (
          <p className="muted">Set a goal date to see the projection.</p>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 10 }}>Weeks</h2>
        <div className="table-wrap" style={{ maxHeight: 420 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Week of</th>
                <th>Phase</th>
                <th>Type</th>
                <th className="num">Volume</th>
                <th className="num">≈ Hours</th>
                <th className="num">TSS target</th>
                <th className="num">CTL (end)</th>
                <th>Strength</th>
                <th>Focus</th>
                <th>Races</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.start} className={w.start === currentMonday ? 'current' : ''}>
                  <td>{fmtShort(w.start)}</td>
                  <td>
                    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <span className="dot" style={{ background: PHASE_COLOR[w.phase] }} />
                      {PHASE_LABELS[w.phase]} {w.weekInPhase}/{w.phaseWeeks}
                    </span>
                  </td>
                  <td>
                    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      {w.userRest ? 'rest (yours)' : w.weekType === 'hit_block' ? 'HIT block' : w.weekType}
                      {canChooseRest(w) && (
                        <button className="btn sm ghost" onClick={() => toggleRestWeek(app, w.start)} title={w.userRest ? 'Undo this rest week' : 'Make this a rest week (the loading cycle restarts after it)'}>
                          {w.userRest ? 'Undo' : 'Rest'}
                        </button>
                      )}
                    </span>
                  </td>
                  <td className="num">{Math.round(w.volumeFactor * 100)}%</td>
                  <td className="num">{(g.typicalWeeklyHours * w.volumeFactor).toFixed(1)}</td>
                  <td className="num">{Math.round(g.typicalWeeklyHours * w.volumeFactor * w.estTssPerHour)}</td>
                  <td className="num">{(() => {
                    const pt = proj.points.find((p) => p.date >= w.start && p.date <= addDays(w.start, 6));
                    return pt ? Math.round(pt.ctl) : '—';
                  })()}</td>
                  <td>{w.strengthPhase}</td>
                  <td style={{ whiteSpace: 'normal', minWidth: 220 }}>{w.focus}</td>
                  <td>{w.races.map((r) => `${r.category.replace('RACE_', '')}: ${r.name} (${fmtShort(r.date)})`).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Strength phases: AA adaptation · MS max strength · SP strength→power · MT maintenance · DL deload · TP taper.
        </p>
      </div>
    </>
  );
}
