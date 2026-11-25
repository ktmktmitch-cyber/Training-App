import { RIDE_TAGS, type RideTag } from '../engine/rideContext';
import { useApp } from '../lib/store';

/** Log what might have changed your heart rate on this ride (caffeine, stimulant, indoor no fan…). */
export function RideContextPicker({ activityId, compact }: { activityId: string; compact?: boolean }) {
  const app = useApp();
  const tags = app.rideContext[activityId] ?? [];
  const toggle = (t: RideTag) => {
    let next = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
    // fan and no fan are exclusive
    if (t === 'fan' && next.includes('fan')) next = next.filter((x) => x !== 'no_fan');
    if (t === 'no_fan' && next.includes('no_fan')) next = next.filter((x) => x !== 'fan');
    app.setRideContext(activityId, next);
  };
  return (
    <div className="stack" style={{ gap: 4 }}>
      {!compact && <span className="tiny muted" style={{ fontWeight: 600 }}>Ride context — what might have changed your heart rate?</span>}
      <div className="row ride-context" style={{ gap: 6 }} role="group" aria-label="Ride context">
        {RIDE_TAGS.map((t) => (
          <button key={t.key} type="button" className={`chip-btn ${tags.includes(t.key) ? 'on' : ''}`} aria-pressed={tags.includes(t.key)} title={t.why} onClick={() => toggle(t.key)}>
            {t.short}
          </button>
        ))}
      </div>
    </div>
  );
}
