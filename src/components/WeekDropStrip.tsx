import { useState } from 'react';
import { addDays, dowShort, fmtMinutes, fromISO } from '../engine/dates';
import type { ISODate } from '../engine/types';
import { WORKOUT_BY_ID } from '../engine/workouts';
import { useApp } from '../lib/store';

export const DRAG_TYPE = 'application/x-training-workout';

export interface DragWorkout {
  id: string;
  durationMin: number;
  level: number;
}

export function setDragData(e: React.DragEvent, w: DragWorkout) {
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(w));
  e.dataTransfer.setData('text/plain', WORKOUT_BY_ID[w.id]?.name ?? w.id);
  e.dataTransfer.effectAllowed = 'copy';
}

/**
 * The next two weeks as drop targets: drag a library workout onto a day (or tap a day to place
 * the workout you have open — works on phones). The rest of that week re-plans around it.
 */
export function WeekDropStrip({ armed, onPlaced }: { armed: DragWorkout | null; onPlaced: (msg: string) => void }) {
  const app = useApp();
  const [over, setOver] = useState<ISODate | null>(null);
  const days = Array.from({ length: 14 }, (_, i) => addDays(app.startDate, i));
  const planned = Object.fromEntries(app.plan.days.map((d) => [d.date, d]));

  const place = (date: ISODate, w: DragWorkout) => {
    const t = WORKOUT_BY_ID[w.id];
    if (!t) return;
    app.schedule(date, { workoutId: w.id, durationMin: w.durationMin, level: w.level });
    onPlaced(`${t.name} on ${fromISO(date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} — the rest of that week re-plans around it.`);
  };

  const label = (d: ISODate): { text: string; mine: boolean; coach?: boolean } => {
    const s = app.scheduled[d];
    if (s) return { text: `${WORKOUT_BY_ID[s.workoutId]?.name ?? 'Workout'} · ${fmtMinutes(s.durationMin)}`, mine: true };
    const p = planned[d];
    if (!p) {
      // Beyond this week's plan: still show what's on your intervals.icu calendar (coach workouts etc.)
      const ev = app.events.find((e) => e.date === d && e.category === 'WORKOUT' && !(e.externalId ?? '').startsWith('trainingapp-'));
      return ev ? { text: `${ev.name}${ev.plannedSec ? ` · ${fmtMinutes(Math.round(ev.plannedSec / 60))}` : ''}`, mine: false, coach: (ev.externalId ?? '').startsWith('tacoach-') } : { text: '', mine: false };
    }
    const ws = [p.ride, ...(p.extras ?? [])].filter(Boolean);
    if (p.status === 'off') return { text: 'Unavailable', mine: false };
    return { text: ws.length ? ws.map((w) => w!.name).join(' + ') : 'Rest', mine: false, coach: !!p.ride?.why[0]?.startsWith('From your coach') };
  };

  return (
    <div className="card drop-strip" aria-label="Your next two weeks — drop workouts here">
      <div className="row" style={{ alignItems: 'baseline' }}>
        <b className="small">Your next 2 weeks</b>
        <span className="tiny muted">
          {armed ? `Tap a day to put “${WORKOUT_BY_ID[armed.id]?.name}” there, or drag any workout onto a day.` : 'Drag a workout onto a day (or open one and tap a day).'}
        </span>
      </div>
      <div className="drop-days">
        {days.map((d) => {
          const l = label(d);
          return (
            <div
              key={d}
              role="button"
              tabIndex={0}
              className={`drop-day ${over === d ? 'over' : ''} ${l.mine ? 'mine' : ''} ${l.coach ? 'coach' : ''} ${armed ? 'armed' : ''} ${d === app.asOf ? 'today' : ''}`}
              aria-label={`${fromISO(d).toDateString()}: ${l.coach ? 'from your coach: ' : ''}${l.text || 'nothing planned'}${armed ? ' — tap to place the open workout here' : ''}`}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(DRAG_TYPE)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  setOver(d);
                }
              }}
              onDragLeave={() => setOver((o) => (o === d ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                try {
                  place(d, JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as DragWorkout);
                } catch {
                  /* not a workout */
                }
              }}
              onClick={() => armed && place(d, armed)}
              onKeyDown={(e) => armed && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), place(d, armed))}
            >
              <span className="drop-dow">
                {dowShort(d)} {fromISO(d).getDate()}
              </span>
              <span className="drop-name">
                {l.coach && <span className="coach-dot" title="Scheduled by your coach" />}
                {l.text || '—'}
              </span>
              {l.mine && (
                <button
                  className="drop-clear"
                  aria-label={`Remove your pick on ${fromISO(d).toDateString()}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    app.schedule(d, null);
                    onPlaced('Back to the recommended workout for that day.');
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
