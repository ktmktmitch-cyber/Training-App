import { useState } from 'react';
import { SPORT_LABEL } from '../engine/multisport';
import { formatPace, parsePace } from '../engine/runswim';
import type { SportMode } from '../engine/types';
import { useApp } from '../lib/store';

const HINT: Record<SportMode, string> = {
  cycling: 'Bike plan with lifting and mobility.',
  running: 'Runs replace rides: same periodization and readiness, run-specific workouts, a long-run cap and safe weekly ramp.',
  run_bike: 'About 60% bike / 40% run. Quality run kept away from hard rides; long run on the other weekend day from the long ride.',
  triathlon: 'About 50% bike / 30% run / 20% swim. CSS and technique swims, brick runs off key rides in build and peak.',
};

function PaceInput({ label, value, fallback, sport, onSave }: { label: string; value: number | null | undefined; fallback: number | null | undefined; sport: 'run' | 'swim'; onSave: (v: number | null) => void }) {
  const [txt, setTxt] = useState(formatPace(value, sport));
  const parsed = txt.trim() ? parsePace(txt, sport) : null;
  const bad = txt.trim() !== '' && !parsed;
  return (
    <label className="field" style={{ flex: '0 1 220px' }}>
      <span>{label}</span>
      <input
        className="input num"
        value={txt}
        placeholder={fallback ? `${formatPace(fallback, sport)} (from intervals.icu)` : sport === 'run' ? 'e.g. 4:30' : 'e.g. 1:45'}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => !bad && onSave(parsed)}
        aria-label={label}
        aria-invalid={bad}
      />
      <span className="tiny muted">{bad ? 'Use min:sec' : sport === 'run' ? 'Pace you could hold ~1 hour (≈ 10 km–half-marathon race pace). Empty = intervals.icu value.' : 'Critical swim speed (≈ 1500 m race pace per 100 m). Empty = intervals.icu value.'}</span>
    </label>
  );
}

/** Choose the sport(s) the plan is built for. */
export function SportCard() {
  const app = useApp();
  const p = app.settings.prefs;
  const sport = p.sport ?? 'cycling';
  const setPrefs = (patch: Partial<typeof p>) => app.updateSettings((s) => ({ ...s, prefs: { ...s.prefs, ...patch } }));
  return (
    <div className="card stack">
      <h2>Your sport</h2>
      <div className="model-cards">
        {(Object.keys(SPORT_LABEL) as SportMode[]).map((k) => (
          <button key={k} className={`model-card ${sport === k ? 'on' : ''}`} onClick={() => setPrefs({ sport: k })} aria-pressed={sport === k}>
            <b>{SPORT_LABEL[k]}</b>
            <span>{HINT[k]}</span>
          </button>
        ))}
      </div>
      {sport !== 'cycling' && (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <PaceInput label="Threshold run pace (min:sec /km)" value={p.runPaceMps} fallback={app.profile?.runThresholdMps} sport="run" onSave={(v) => setPrefs({ runPaceMps: v })} />
          {sport === 'triathlon' && <PaceInput label="Swim CSS (min:sec /100 m)" value={p.swimCssMps} fallback={app.profile?.swimCssMps} sport="swim" onSave={(v) => setPrefs({ swimCssMps: v })} />}
        </div>
      )}
      {sport !== 'cycling' && <p className="tiny muted">Your weekly hours on the Week page are split across sports. Running volume never jumps more than ~15% above your recent weeks, whatever hours you set.</p>}
    </div>
  );
}
