import { AREA_LABEL, AREAS, FREQ_LABEL, type MobilityArea, type MobilityFrequency, type MobilitySession } from '../engine/mobility';
import { mobilityPrefs } from '../engine/planner';
import type { MobilityPrefs } from '../engine/types';
import { useApp } from '../lib/store';
import { Seg } from './ui';

export function useMobilityPrefs(): [MobilityPrefs, (patch: Partial<MobilityPrefs>) => void] {
  const app = useApp();
  const m = mobilityPrefs(app.settings.strength);
  const set = (patch: Partial<MobilityPrefs>) =>
    app.updateSettings((s) => {
      const cur = mobilityPrefs(s.strength);
      const next = { ...cur, ...patch };
      return { ...s, strength: { ...s.strength, includeMobility: next.frequency !== 'off', mobility: next } };
    });
  return [m, set];
}

/** Tap the spots that feel tight — the sessions add extra moves for them and put them first. */
export function TightSpotPicker({ compact }: { compact?: boolean }) {
  const [m, set] = useMobilityPrefs();
  const toggle = (a: MobilityArea) => set({ focus: m.focus.includes(a) ? m.focus.filter((x) => x !== a) : [...m.focus, a] });
  return (
    <div className="stack" style={{ gap: 6 }}>
      {!compact && <span className="tiny muted" style={{ fontWeight: 600 }}>Tight spots to emphasise</span>}
      <div className="row" style={{ gap: 6 }} role="group" aria-label="Tight spots">
        {AREAS.map((a) => (
          <button key={a} className={`chip chip-btn ${m.focus.includes(a) ? 'on' : ''}`} aria-pressed={m.focus.includes(a)} onClick={() => toggle(a)}>
            {AREA_LABEL[a]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MobilityBlock({ session }: { session: MobilitySession }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>Mobility · {session.minutes} min</h3>
        <span className="tiny muted">{session.title}</span>
      </div>
      <ol className="mob-list">
        {session.moves.map((mv) => (
          <li key={mv.id}>
            <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
              <b className="small">{mv.name}</b>
              <span className="tiny muted num">{mv.dose}</span>
              {mv.areas.some((a) => session.focus.includes(a)) && <span className="chip tiny">tight spot</span>}
            </div>
            <div className="tiny ink2">{mv.how}</div>
          </li>
        ))}
      </ol>
      <p className="tiny muted">{session.note}</p>
      <details className="more">
        <summary className="tiny">Feeling tight somewhere? Pick spots to emphasise</summary>
        <div style={{ marginTop: 8 }}>
          <TightSpotPicker compact />
        </div>
      </details>
    </div>
  );
}

export function MobilitySettings() {
  const [m, set] = useMobilityPrefs();
  return (
    <div className="stack">
      <h3>Mobility</h3>
      <p className="small ink2">Short sessions aimed at what riding tightens: hip flexors, hamstrings, glutes, upper back, low back, neck. A few minutes often beats a long session now and then.</p>
      <label className="field">
        <span>When</span>
        <Seg<MobilityFrequency> value={m.frequency} onChange={(v) => set({ frequency: v })} ariaLabel="Mobility frequency" options={(Object.keys(FREQ_LABEL) as MobilityFrequency[]).map((k) => ({ value: k, label: FREQ_LABEL[k] }))} />
      </label>
      {m.frequency !== 'off' && (
        <>
          <label className="field">
            <span>Rest-day session length (after-ride sessions are shorter)</span>
            <Seg<number>
              value={m.minutes}
              onChange={(v) => set({ minutes: v })}
              ariaLabel="Mobility length"
              options={[5, 8, 10, 15].map((v) => ({ value: v, label: `${v} min` }))}
            />
          </label>
          <TightSpotPicker />
          <div className="row" style={{ gap: 12 }}>
            <label className="check small">
              <input type="checkbox" checked={m.roller} onChange={(e) => set({ roller: e.target.checked })} />
              <span>I have a foam roller</span>
            </label>
            <label className="check small">
              <input type="checkbox" checked={m.band} onChange={(e) => set({ band: e.target.checked })} />
              <span>I have a strap or band</span>
            </label>
          </div>
        </>
      )}
    </div>
  );
}
