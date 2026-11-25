import { formZone } from '../engine/status';
import type { TeamRider } from '../engine/team';
import type { TeamState } from '../engine/teamState';
import { STATE_META } from '../engine/teamState';

export type FormKey = 'transition' | 'fresh' | 'grey' | 'optimal' | 'risk';

export function formKey(tsb: number): FormKey {
  const z = formZone(tsb).label;
  return z === 'Optimal' ? 'optimal' : z === 'Fresh' ? 'fresh' : z === 'Transition' ? 'transition' : z === 'High risk' ? 'risk' : 'grey';
}

const ICON: Record<FormKey, string> = { optimal: '✓', fresh: '↑', grey: '•', transition: '↓', risk: '!' };
export const FORM_HINT: Record<FormKey, string> = {
  optimal: 'Optimal — productive training load',
  fresh: 'Fresh — ready to race or test',
  grey: 'Grey zone — maintaining, not building',
  transition: 'Transition — losing fitness',
  risk: 'High risk — too much fatigue, ease off',
};

/** Large, coloured form (TSB) badge with a symbol, using intervals.icu's form zones. */
export function FormBadge({ tsb, size = 'lg' }: { tsb: number | null | undefined; size?: 'lg' | 'sm' }) {
  if (tsb == null) return <span className="muted">—</span>;
  const k = formKey(tsb);
  return (
    <span className={`form-badge form-${k} ${size}`} title={FORM_HINT[k]} aria-label={`Form ${Math.round(tsb)}: ${FORM_HINT[k]}`}>
      <span className="form-icon" aria-hidden>
        {ICON[k]}
      </span>
      <b className="num">{tsb > 0 ? `+${Math.round(tsb)}` : Math.round(tsb)}</b>
      <span className="form-label">{formZone(tsb).label}</span>
    </span>
  );
}

/** Team form at a glance: how many riders are in each zone, and who. */
export function TeamFormCard({ riders, onOpen }: { riders: TeamRider[]; onOpen: (id: string) => void }) {
  // lowest form (most fatigued) on the left → freshest on the right, like intervals.icu's form chart
  const order: FormKey[] = ['risk', 'optimal', 'grey', 'fresh', 'transition'];
  const withForm = riders.filter((r) => r.form != null);
  const groups = order.map((k) => ({ k, rs: withForm.filter((r) => formKey(r.form!) === k).sort((a, b) => a.form! - b.form!) }));
  const inOptimal = groups.find((g) => g.k === 'optimal')!.rs.length;
  return (
    <div className="card team-form">
      <div className="card-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2>Team form</h2>
          <span className="small ink2">
            <b>{inOptimal}</b> of {withForm.length} riders in the optimal zone (form −10 to −30) — where training builds fitness.
          </span>
        </div>
      </div>
      <div className="team-form-zones">
        {groups.map(({ k, rs }) => (
          <div key={k} className={`team-form-zone form-${k}`}>
            <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
              <span className="form-icon" aria-hidden>
                {ICON[k]}
              </span>
              <b className="num team-form-count">{rs.length}</b>
              <span className="small">{FORM_HINT[k].split(' — ')[0]}</span>
            </div>
            <div className="row" style={{ gap: 4 }}>
              {rs.map((r) => (
                <button key={r.id} className="chip chip-btn" onClick={() => onOpen(r.id)} title={`Form ${r.form}`}>
                  {r.rider} <span className="num muted">{r.form! > 0 ? `+${Math.round(r.form!)}` : Math.round(r.form!)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="tiny muted" style={{ marginTop: 8 }}>
        Form = fitness − fatigue (intervals.icu TSB), lowest on the left: ! high risk (below −30) · ✓ optimal (−30 to −10) · • grey zone · ↑ fresh · ↓ transition (above +25).
      </p>
    </div>
  );
}

/** Large training-state badge (improving, maintaining, plateauing, recovering, detraining, overreaching, strained). */
export function StateBadge({ state, size = 'lg' }: { state: TeamState; size?: 'lg' | 'sm' }) {
  const tone = STATE_META[state.key].tone;
  return (
    <span className={`state-badge tone-${tone} ${size}`} title={`${state.why} Based on ${state.basis}.`} aria-label={`${state.label}: ${state.why}`}>
      <span className="state-icon" aria-hidden>
        {state.symbol}
      </span>
      {state.label}
    </span>
  );
}
