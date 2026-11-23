import { dowLong } from '../engine/dates';
import { buildStrengthSession } from '../engine/strength';
import type { Equipment, Experience, LiftPlacement, StrengthPhase, StrengthSettings } from '../engine/types';
import { Seg } from '../components/ui';
import { useApp } from '../lib/store';

const PHASES: { id: StrengthPhase; when: string; dose: string }[] = [
  { id: 'AA', when: 'Prep / first weeks back', dose: '2-3×/wk · 2-3 sets × 10-15 · RPE 6-7' },
  { id: 'MS', when: 'Base / accumulation', dose: '2×/wk · 3-4 sets × 4-6 · RPE 8 (~80-85% 1RM)' },
  { id: 'SP', when: 'Early build', dose: '1-2×/wk · 3 × 3-5 heavy + jumps' },
  { id: 'MT', when: 'Late build / peak', dose: '1×/wk · 2-3 × 3-5 heavy, ~30 min' },
  { id: 'DL', when: 'Recovery weeks', dose: 'Same lifts, ~half the sets, RPE 6' },
  { id: 'TP', when: 'Final 10 days', dose: 'Optional · 2 × 3 fast reps + a few jumps, ≥5 days out' },
];

export function StrengthPage() {
  const app = useApp();
  const st = app.settings.strength;
  const set = (patch: Partial<StrengthSettings>) => app.updateSettings((s) => ({ ...s, strength: { ...s.strength, ...patch } }));
  const liftDays = app.plan.days.filter((d) => d.strength);
  const phase = liftDays[0]?.strength?.phase ?? app.plan.macroWeek?.strengthPhase ?? 'MS';
  const preview = buildStrengthSession(phase, st.equipment, st.experience, 0);

  return (
    <>
      <h1>Strength</h1>
      <div className="card stack-lg">
        <div className="grid-2">
          <div className="stack">
            <h3>Sessions per week</h3>
            <Seg<0 | 1 | 2 | 3>
              value={st.frequency}
              onChange={(v) => set({ frequency: v })}
              options={[
                { value: 0, label: 'None' },
                { value: 1, label: '1×' },
                { value: 2, label: '2×' },
                { value: 3, label: '3×' },
              ]}
            />
            <label className="check small">
              <input type="checkbox" checked={st.followPhaseCaps} onChange={(e) => set({ followPhaseCaps: e.target.checked })} />
              <span>Let the plan reduce lifting in build/peak/taper (recommended)</span>
            </label>
          </div>
          <div className="stack">
            <h3>Equipment</h3>
            <Seg<Equipment>
              value={st.equipment}
              onChange={(v) => set({ equipment: v })}
              options={[
                { value: 'gym', label: 'Full gym' },
                { value: 'barbell', label: 'Home barbell' },
                { value: 'dumbbell', label: 'Dumbbells / KB' },
                { value: 'bodyweight', label: 'Bodyweight / bands' },
              ]}
            />
          </div>
          <div className="stack">
            <h3>Lifting experience</h3>
            <Seg<Experience>
              value={st.experience}
              onChange={(v) => set({ experience: v })}
              options={[
                { value: 'new', label: 'New' },
                { value: 'intermediate', label: 'Some' },
                { value: 'advanced', label: 'Experienced' },
              ]}
            />
          </div>
          <div className="stack">
            <h3>Which days?</h3>
            <Seg<LiftPlacement>
              value={st.placement}
              onChange={(v) => set({ placement: v })}
              options={[
                { value: 'hard_days', label: 'Hard days (recommended)' },
                { value: 'easy_days', label: 'Easy days' },
                { value: 'any', label: 'Whatever fits' },
              ]}
            />
            <label className="check small">
              <input type="checkbox" checked={st.includeMobility} onChange={(e) => set({ includeMobility: e.target.checked })} />
              <span>Suggest short mobility sessions on rest/recovery days</span>
            </label>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 8 }}>This week</h2>
        {liftDays.length ? (
          <ul className="why">
            {liftDays.map((d) => (
              <li key={d.date}>
                <b>{dowLong(d.date)}</b> — {d.strength!.title} (~{d.strength!.durationMin} min). {d.strength!.timing}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{st.frequency === 0 ? 'Strength is off.' : 'No lifting days this week (race/taper or all days blocked).'}</p>
        )}
        <div className="callout" style={{ marginTop: 12 }}>
          <b>How lift days are chosen.</b> Lifting goes on the same day as your hard rides when possible (ride first, lift later — ideally 6+ hours apart), so easy days stay easy. Heavy leg work is kept away from the day before intervals, long rides, group rides and races, sessions are spaced at least 48 h apart, and nothing heavy happens in the last week before an A race. Mark any day “No lifting” in your week setup.
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>
            Current phase: {preview.title.replace(/ A$/, '')}
          </h2>
          <span className="chip">~{preview.durationMin} min</span>
        </div>
        <p className="small ink2" style={{ marginBottom: 10 }}>
          {preview.focus}
        </p>
        <div className="table-wrap">
          <table className="steps">
            <thead>
              <tr>
                <th>Exercise (session A)</th>
                <th className="num">Sets × reps</th>
                <th>Load</th>
                <th>Rest</th>
              </tr>
            </thead>
            <tbody>
              {preview.exercises.map((e, i) => (
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
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 10 }}>Season progression</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Phase</th>
                <th>When</th>
                <th>Dose</th>
              </tr>
            </thead>
            <tbody>
              {PHASES.map((p) => (
                <tr key={p.id} className={p.id === phase ? 'current' : ''}>
                  <td>
                    <b>{p.id}</b> {buildStrengthSession(p.id, 'gym', 'intermediate', 0).title.replace(/ A$/, '')}
                  </td>
                  <td>{p.when}</td>
                  <td style={{ whiteSpace: 'normal' }}>{p.dose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="why" style={{ marginTop: 10 }}>
          <li>Heavy, low-rep strength work (with maximal intent on the way up) improves cycling economy, peak power and late-race performance in trained cyclists, with little or no weight gain when combined with endurance training.</li>
          <li>Plyometrics/jumps in the build phase help convert strength into rate of force development (sprints, surges).</li>
          <li>Adductors (Copenhagen planks), single-leg work and anti-rotation core help hip stability on the bike.</li>
        </ul>
      </div>
    </>
  );
}
