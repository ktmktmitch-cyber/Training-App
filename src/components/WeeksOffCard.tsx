import { useState } from 'react';
import { addDays, diffDays, fmtShort, fromISO, mondayOf } from '../engine/dates';
import { macroWeekFor } from '../engine/periodization';
import { setWeekOff, type WeekOffKind } from '../lib/restWeeks';
import { useApp } from '../lib/store';
import { Seg } from './ui';

const KIND_HINT: Record<WeekOffKind, string> = {
  rest: 'Easy riding only, ~40% less volume. The loading weeks are rearranged around it so you don’t get two easy weeks close together.',
  away: 'No training planned (travel, vacation, busy week). The plan treats it as a break and restarts the loading cycle after it.',
};

/** Pick future weeks you already know will be rest weeks or weeks away; the season plan builds around them. */
export function WeeksOffCard() {
  const app = useApp();
  const { asOf, macro } = app;
  const [date, setDate] = useState(addDays(asOf, 28));
  const [kind, setKind] = useState<WeekOffKind>('rest');
  const thisMonday = mondayOf(asOf);
  const chosen = [
    ...(app.settings.goal.restWeeks ?? []).map((d) => ({ d, k: 'rest' as const })),
    ...(app.settings.goal.awayWeeks ?? []).map((d) => ({ d, k: 'away' as const })),
  ]
    .filter((x) => diffDays(x.d, thisMonday) >= 0)
    .sort((a, b) => a.d.localeCompare(b.d));
  const monday = mondayOf(date);
  const mw = macroWeekFor(macro, monday);
  const blocked = mw && ['taper', 'race'].includes(mw.weekType) && !mw.userRest;

  return (
    <div className="card stack-lg">
      <div className="stack" style={{ gap: 2 }}>
        <h2>Weeks off</h2>
        <span className="small ink2">Already know a week will be light or that you’ll be away? Add it here (or tap a bar on the timeline below) and the season plan builds around it.</span>
      </div>
      {chosen.length > 0 ? (
        <ul className="weeks-off">
          {chosen.map(({ d, k }) => (
            <li key={d}>
              <span className={`chip ${k === 'away' ? '' : 'on'}`}>{k === 'away' ? 'Away' : 'Rest'}</span>
              <span>
                Week of {fromISO(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                <span className="tiny muted"> ({fmtShort(d)} – {fmtShort(addDays(d, 6))})</span>
              </span>
              <span className="spacer" />
              <button className="btn sm ghost" onClick={() => setWeekOff(app, d, k === 'rest' ? 'away' : 'rest')}>
                Make {k === 'rest' ? 'away' : 'rest'}
              </button>
              <button className="btn sm ghost" onClick={() => setWeekOff(app, d, null)} aria-label={`Remove week of ${fmtShort(d)}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">None yet — the plan places recovery weeks itself.</p>
      )}
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '0 1 180px' }}>
          <span>Any day in the week</span>
          <input className="input" type="date" min={asOf} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Week to take off" />
        </label>
        <div className="field">
          <span>Type</span>
          <Seg<WeekOffKind>
            value={kind}
            onChange={setKind}
            ariaLabel="Week type"
            options={[
              { value: 'rest', label: 'Rest week' },
              { value: 'away', label: 'Away / no training' },
            ]}
          />
        </div>
        <button className="btn primary" disabled={!!blocked || diffDays(monday, thisMonday) < 0} onClick={() => setWeekOff(app, monday, kind)}>
          Add week of {fmtShort(monday)}
        </button>
      </div>
      <span className="tiny muted">{blocked ? 'That week is your taper or race week — move the race instead.' : KIND_HINT[kind]}</span>
    </div>
  );
}
