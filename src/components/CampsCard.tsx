import { useState } from 'react';
import { addDays, diffDays, fmtMinutes, fmtShort } from '../engine/dates';
import { campMinutes } from '../engine/planner';
import type { TrainingCamp } from '../engine/types';
import { useApp } from '../lib/store';

export const newCampId = () => `camp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Camp form shared by the Season page and the coach's team settings. */
export function CampForm({ onAdd, weeklyHours, cta }: { onAdd: (c: TrainingCamp) => void; weeklyHours: number; cta: string }) {
  const app = useApp();
  const [name, setName] = useState('Winter base camp');
  const [start, setStart] = useState(addDays(app.asOf, 30));
  const [end, setEnd] = useState(addDays(app.asOf, 36));
  const [hours, setHours] = useState<number | ''>('');
  const valid = start && end && end >= start && diffDays(end, start) <= 30;
  const preview = campMinutes({ id: '', name, start, end, hoursPerDay: hours || null }, weeklyHours);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '2 1 180px' }}>
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Camp name" />
        </label>
        <label className="field" style={{ flex: '1 1 140px' }}>
          <span>First day</span>
          <input className="input" type="date" value={start} min={app.asOf} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} aria-label="Camp first day" />
        </label>
        <label className="field" style={{ flex: '1 1 140px' }}>
          <span>Last day</span>
          <input className="input" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} aria-label="Camp last day" />
        </label>
        <label className="field" style={{ flex: '0 1 130px' }}>
          <span>Hours / day</span>
          <input className="input num" type="number" min={1} max={8} step={0.5} placeholder="Auto" value={hours} onChange={(e) => setHours(e.target.value ? Number(e.target.value) : '')} aria-label="Camp hours per day" />
        </label>
        <button className="btn primary" disabled={!valid} onClick={() => onAdd({ id: newCampId(), name: name.trim() || 'Training camp', start, end, hoursPerDay: hours || null })}>
          {cta}
        </button>
      </div>
      <span className="tiny muted">
        {valid ? `${diffDays(end, start) + 1} days · full days up to ${fmtMinutes(preview)}${hours ? '' : ' (auto: about double your usual week over the camp)'} · every 4th day easier · 2 easy days before, ~5 days of recovery after.` : 'Pick a first and last day (up to a month).'}
      </span>
    </div>
  );
}

/** Your training camps (Season page). */
export function CampsCard() {
  const app = useApp();
  const camps = (app.settings.goal.camps ?? []).filter((c) => c.end >= app.asOf).sort((a, b) => a.start.localeCompare(b.start));
  const set = (fn: (c: TrainingCamp[]) => TrainingCamp[]) => app.updateSettings((s) => ({ ...s, goal: { ...s.goal, camps: fn(s.goal.camps ?? []) } }));
  return (
    <div className="card stack">
      <div className="stack" style={{ gap: 2 }}>
        <h2>Training camps</h2>
        <span className="small ink2">
          A base camp is a short block of much more riding, almost all Zone 2: long steady days, every 4th day easier, one tempo day and a few short sprints to keep some top end. The plan eases you in (two easy days before) and gives you ~5 days of recovery after — the fitness from a camp shows up once you’ve recovered from it.
        </span>
      </div>
      {camps.length > 0 && (
        <ul className="weeks-off">
          {camps.map((c) => (
            <li key={c.id}>
              <b>{c.name}</b>
              <span className="small ink2">
                {fmtShort(c.start)} – {fmtShort(c.end)} · {diffDays(c.end, c.start) + 1} days · {fmtMinutes(campMinutes(c, app.week.hours))} / day
              </span>
              {c.fromCoach && <span className="chip tiny coach-chip">From your coach</span>}
              <span className="spacer" />
              <button className="btn sm ghost" onClick={() => set((cs) => cs.filter((x) => x.id !== c.id))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <CampForm weeklyHours={app.week.hours} cta="Add camp" onAdd={(c) => set((cs) => [...cs, c])} />
    </div>
  );
}
