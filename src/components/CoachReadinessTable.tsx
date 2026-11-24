import { fmtShort } from '../engine/dates';
import { riderAvailability, type DeepRider, type RiderMetrics, type TeamRider } from '../engine/team';
import { StatusIcon } from './ui';

const dash = '—';

/** Coach-only: everyone's readiness at a glance, with sick / injured / away flags. */
export function CoachReadinessTable({ riders, metrics, deep, asOf, onOpen, loading }: { riders: TeamRider[]; metrics: Record<string, RiderMetrics>; deep: Record<string, DeepRider>; asOf: string; onOpen: (id: string) => void; loading: string | null }) {
  const readable = riders.filter((r) => deep[r.id] && !deep[r.id].error);
  if (readable.length < 2 && !loading) return null; // not a coach for this team (or nothing loaded yet)
  const order = { red: 0, amber: 1, green: 2, unknown: 3 } as const;
  const rows = [...riders].sort((a, b) => {
    const ra = metrics[a.id]?.readiness?.status ?? 'unknown';
    const rb = metrics[b.id]?.readiness?.status ?? 'unknown';
    return order[ra] - order[rb] || a.rider.localeCompare(b.rider);
  });
  return (
    <div className="card">
      <div className="card-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2>Readiness · coach only</h2>
          <span className="small ink2">From each rider’s HRV, resting HR, sleep and load in intervals.icu, plus sick days and planned breaks. Lowest readiness first.</span>
        </div>
        {loading && <span className="chip">{loading}</span>}
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Rider</th>
              <th>Readiness</th>
              <th className="num">HRV 7d</th>
              <th className="num">Resting HR</th>
              <th className="num">Sleep</th>
              <th className="num">Form</th>
              <th>Status</th>
              <th>Availability</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = deep[r.id];
              const m = metrics[r.id];
              const rd = m?.readiness;
              const av = riderAvailability(d, asOf);
              if (!d || d.error)
                return (
                  <tr key={r.id}>
                    <td>{r.rider}</td>
                    <td colSpan={7} className="muted small">
                      {d?.error ? 'Not shared with you on intervals.icu (they need to add you as coach)' : 'Loading…'}
                    </td>
                  </tr>
                );
              return (
                <tr key={r.id}>
                  <td>
                    <button className="link-btn" onClick={() => onOpen(r.id)}>
                      {r.rider}
                    </button>
                  </td>
                  <td>
                    {rd && rd.status !== 'unknown' ? (
                      <span className="status-pill">
                        <StatusIcon status={rd.status} />
                        {rd.score}
                      </span>
                    ) : (
                      <span className="muted small" title="Needs Garmin/Oura/Whoop wellness syncing to intervals.icu">no HRV — connect Garmin wellness</span>
                    )}
                  </td>
                  <td className="num">
                    {rd?.hrv.avg7 ?? dash}
                    {rd?.hrv.low != null ? <span className="tiny muted"> ({rd.hrv.low}–{rd.hrv.high})</span> : null}
                  </td>
                  <td className="num">
                    {rd?.rhr.avg7 ?? dash}
                    {rd?.rhr.baseline != null ? <span className="tiny muted"> (base {Math.round(rd.rhr.baseline)})</span> : null}
                  </td>
                  <td className="num">{rd?.sleepAvg3h != null ? `${rd.sleepAvg3h.toFixed(1)} h` : dash}</td>
                  <td className="num">{rd?.tsb != null ? Math.round(rd.tsb) : (r.form ?? dash)}</td>
                  <td className="small">{m?.status?.label ?? dash}</td>
                  <td className="small">
                    {av.today ? <b className={av.today === 'sick' || av.today === 'injured' ? 'warn-ink' : ''}>{av.today[0].toUpperCase() + av.today.slice(1)}</b> : 'Available'}
                    {av.sickRecent.length > 0 && av.today !== 'sick' ? <span className="tiny muted"> · sick {av.sickRecent.map((x) => fmtShort(x)).slice(-2).join(', ')}</span> : null}
                    {av.next ? <span className="tiny muted"> · next: {av.next}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
