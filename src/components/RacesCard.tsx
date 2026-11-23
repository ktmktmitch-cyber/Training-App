import { useState } from 'react';
import { addDays, diffDays, fmtMinutes, fmtShort, fromISO } from '../engine/dates';
import { isAppRace } from '../engine/periodization';
import type { ISODate, PlannedRace, RacePriority } from '../engine/types';
import { useApp } from '../lib/store';
import { Seg } from './ui';

const PRI_HINT: Record<RacePriority, string> = {
  A: 'Your peak: the plan builds, peaks and tapers for it',
  B: 'Important: a short mini-taper (easier 2–3 days before) and openers',
  C: 'Train through: ride it as a hard session, little or no taper',
};

function fmtDate(d: ISODate) {
  return fromISO(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function until(asOf: ISODate, d: ISODate) {
  const n = diffDays(d, asOf);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n < 14) return `in ${n} days`;
  return `in ${Math.round(n / 7)} weeks`;
}

/** Schedule races months ahead with A/B/C priority; the season and week plans build around them. */
export function RacesCard() {
  const app = useApp();
  const { asOf } = app;
  const races = app.settings.goal.races ?? [];
  const setRaces = (next: PlannedRace[]) => app.updateSettings((s) => ({ ...s, goal: { ...s.goal, races: next.sort((a, b) => a.date.localeCompare(b.date)) } }));
  const [name, setName] = useState('');
  const [date, setDate] = useState(addDays(asOf, 56));
  const [priority, setPriority] = useState<RacePriority>('B');
  const [dur, setDur] = useState(120);
  const [editing, setEditing] = useState<string | null>(null);

  const calendarRaces = app.data.events.filter((e) => e.category.startsWith('RACE_') && !isAppRace(e) && diffDays(e.date, asOf) >= 0);
  const upcoming = races.filter((r) => diffDays(r.date, asOf) >= 0);
  const past = races.filter((r) => diffDays(r.date, asOf) < 0);
  const nextA = upcoming.find((r) => r.priority === 'A');

  const save = () => {
    if (!date || diffDays(date, asOf) < 0) return;
    const r: PlannedRace = { id: editing ?? `${Date.now().toString(36)}`, name: name.trim() || `${priority} race`, date, priority, durationMin: dur };
    setRaces([...races.filter((x) => x.id !== editing), r]);
    setEditing(null);
    setName('');
  };
  const edit = (r: PlannedRace) => {
    setEditing(r.id);
    setName(r.name);
    setDate(r.date);
    setPriority(r.priority);
    setDur(r.durationMin);
  };

  return (
    <div className="card stack-lg">
      <div className="stack" style={{ gap: 2 }}>
        <h2>Races</h2>
        <span className="small ink2">
          Add races as far ahead as you like. {nextA ? `Your next A race (${nextA.name}, ${fmtShort(nextA.date)}) is the season goal: the plan peaks and tapers for it.` : 'Your first A race becomes the season goal: the plan builds, peaks and tapers for it.'}
        </span>
      </div>

      {upcoming.length + calendarRaces.length > 0 ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Race</th>
                <th>Date</th>
                <th className="num">Length</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[
                ...upcoming.map((r) => ({ key: r.id, r, cal: false as const })),
                ...calendarRaces.map((e) => ({ key: e.id, r: { id: e.id, name: e.name, date: e.date, priority: e.category.slice(5) as RacePriority, durationMin: e.plannedSec ? e.plannedSec / 60 : 0 }, cal: true as const })),
              ]
                .sort((a, b) => a.r.date.localeCompare(b.r.date))
                .map(({ key, r, cal }) => (
                  <tr key={key}>
                    <td>
                      <span className={`chip pri-${r.priority}`} title={PRI_HINT[r.priority]}>
                        {r.priority}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'normal' }}>
                      {r.name}
                      {cal && <span className="tiny muted"> · from intervals.icu</span>}
                    </td>
                    <td>
                      {fmtDate(r.date)} <span className="tiny muted">({until(asOf, r.date)})</span>
                    </td>
                    <td className="num">{r.durationMin ? fmtMinutes(r.durationMin) : '—'}</td>
                    <td>
                      {!cal && (
                        <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                          <button className="btn sm ghost" onClick={() => edit(r)}>
                            Edit
                          </button>
                          <button className="btn sm ghost" onClick={() => setRaces(races.filter((x) => x.id !== r.id))} aria-label={`Remove ${r.name}`}>
                            Remove
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="small muted">No races yet.</p>
      )}

      <div className="stack">
        <h3>{editing ? 'Edit race' : 'Add a race'}</h3>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '2 1 200px' }}>
            <span>Name</span>
            <input className="input" placeholder="e.g. State road race" value={name} onChange={(e) => setName(e.target.value)} aria-label="Race name" />
          </label>
          <label className="field" style={{ flex: '1 1 150px' }}>
            <span>Date</span>
            <input className="input" type="date" min={asOf} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Race date" />
          </label>
          <label className="field" style={{ flex: '0 1 120px' }}>
            <span>Length</span>
            <select className="select" value={dur} onChange={(e) => setDur(Number(e.target.value))} aria-label="Race length">
              {[30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360, 480, 600].map((m) => (
                <option key={m} value={m}>
                  {fmtMinutes(m)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="field">
          <span>Priority</span>
          <Seg<RacePriority>
            value={priority}
            onChange={setPriority}
            ariaLabel="Race priority"
            options={[
              { value: 'A', label: 'A · peak' },
              { value: 'B', label: 'B · important' },
              { value: 'C', label: 'C · train through' },
            ]}
          />
          <span className="tiny muted">{PRI_HINT[priority]}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn primary" onClick={save} disabled={!date || diffDays(date, asOf) < 0}>
            {editing ? 'Save race' : 'Add race'}
          </button>
          {editing && (
            <button className="btn ghost" onClick={() => { setEditing(null); setName(''); }}>
              Cancel
            </button>
          )}
        </div>
      </div>
      {past.length > 0 && (
        <details className="more">
          <summary className="tiny">Past races ({past.length})</summary>
          <ul className="why">
            {past.map((r) => (
              <li key={r.id}>
                {r.priority} · {r.name} · {fmtDate(r.date)}{' '}
                <button className="btn sm ghost" onClick={() => setRaces(races.filter((x) => x.id !== r.id))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
