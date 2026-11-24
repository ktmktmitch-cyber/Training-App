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
  const [mode, setMode] = useState<'week' | 'dates'>('week');
  const [from, setFrom] = useState(addDays(asOf, 14));
  const [until, setUntil] = useState(addDays(asOf, 20));
  const [note, setNote] = useState('');
  const ranges = (app.settings.goal.offRanges ?? []).filter((r) => diffDays(r.end, asOf) >= 0).sort((a, b) => a.start.localeCompare(b.start));
  const setRanges = (next: NonNullable<typeof app.settings.goal.offRanges>) => app.updateSettings((s) => ({ ...s, goal: { ...s.goal, offRanges: next } }));
  const fmtD = (d: string) => fromISO(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
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
        <span className="small ink2">Already know a week will be light or that you’ll be away? Add a whole week or exact dates (e.g. back mid-week), or tap a bar on the timeline below — the season plan builds around it.</span>
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
      {ranges.length > 0 && (
        <ul className="weeks-off" aria-label="Days off">
          {ranges.map((r) => (
            <li key={r.id}>
              <span className="chip">Off</span>
              <span>
                {fmtD(r.start)} – {fmtD(r.end)}
                <span className="tiny muted">
                  {' '}
                  ({diffDays(r.end, r.start) + 1} days · back {fmtD(addDays(r.end, 1))}){r.note ? ` · ${r.note}` : ''}
                </span>
              </span>
              <span className="spacer" />
              <button className="btn sm ghost" onClick={() => setRanges((app.settings.goal.offRanges ?? []).filter((x) => x.id !== r.id))} aria-label={`Remove days off ${fmtShort(r.start)}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <Seg<'week' | 'dates'>
        value={mode}
        onChange={setMode}
        ariaLabel="Time off by"
        options={[
          { value: 'week', label: 'Whole week' },
          { value: 'dates', label: 'Exact dates' },
        ]}
      />
      {mode === 'dates' ? (
        <>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: '0 1 170px' }}>
              <span>First day off</span>
              <input className="input" type="date" min={asOf} value={from} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); if (e.target.value > until) setUntil(e.target.value); } }} aria-label="First day off" />
            </label>
            <label className="field" style={{ flex: '0 1 170px' }}>
              <span>Last day off</span>
              <input className="input" type="date" min={from} value={until} onChange={(e) => e.target.value && setUntil(e.target.value)} aria-label="Last day off" />
            </label>
            <label className="field" style={{ flex: '1 1 160px' }}>
              <span>Note (optional)</span>
              <input className="input" value={note} placeholder="e.g. Work trip" onChange={(e) => setNote(e.target.value)} aria-label="Days off note" />
            </label>
            <button
              className="btn primary"
              disabled={until < from}
              onClick={() => {
                setRanges([...(app.settings.goal.offRanges ?? []), { id: Date.now().toString(36), start: from, end: until, note: note.trim() || undefined }]);
                setNote('');
              }}
            >
              Add days off
            </button>
          </div>
          <span className="tiny muted">No training on those days; you’re back on {fmtD(addDays(until, 1))}. If it covers most of a week, the season plan treats that week as a break and restarts the loading cycle after it.</span>
        </>
      ) : (
      <>
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
      </>
      )}
    </div>
  );
}
