import { dowShort, fmtMinutes, fromISO } from '../engine/dates';
import type { ISODate } from '../engine/types';
import { useApp } from '../lib/store';
import { ReviewToggle } from './WorkoutReview';

/** A day earlier this week: what was planned, what you did, and a review of how it went. */
export function PastDay({ date }: { date: ISODate }) {
  const app = useApp();
  const acts = app.data.activities.filter((a) => a.date === date && a.movingSec >= 300);
  const planned = app.events.find((e) => e.date === date && e.category === 'WORKOUT') ?? null;
  const snap = app.snapshots[date];
  const plannedName = planned?.name ?? snap?.name ?? null;
  const missed = !acts.some((a) => !a.isStrength) && plannedName;
  return (
    <div className={`day past ${missed ? 'missed' : ''}`}>
      <div className="day-head past-head">
        <div className="day-date">
          <div className="dow">{dowShort(date)}</div>
          <div className="dom">{fromISO(date).getDate()}</div>
        </div>
        <div className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
          {acts.length ? (
            acts.map((a) => (
              <div key={a.id} className="stack" style={{ gap: 6 }}>
                <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                  <b>{a.name}</b>
                  <span className="small ink2 num">
                    {fmtMinutes(Math.round(a.movingSec / 60))}
                    {a.tss ? ` · ${Math.round(a.tss)} TSS` : ''}
                    {a.intensity ? ` · IF ${a.intensity.toFixed(2)}` : ''}
                  </span>
                  <span className="chip tiny">Done</span>
                </div>
                {plannedName && !a.isStrength && <span className="tiny muted">Planned: {plannedName}</span>}
                {!a.isStrength && (plannedName ? <ReviewToggle activity={a} /> : null)}
              </div>
            ))
          ) : (
            <span className="small">{plannedName ? <>Missed · planned <b>{plannedName}</b></> : <span className="muted">Rest day</span>}</span>
          )}
        </div>
      </div>
    </div>
  );
}
