import { fmtShort } from '../engine/dates';
import type { PerformanceAnalysis } from '../engine/performance';
import { LineChart } from './charts';
import { StatusIcon } from './ui';

const VERDICT = {
  improving: { st: 'green', label: 'Improving' },
  stable: { st: 'unknown', label: 'Stable' },
  declining: { st: 'red', label: 'Declining' },
  unknown: { st: 'unknown', label: 'Not enough data' },
} as const;

export function FtpCard({ perf, onUse }: { perf: PerformanceAnalysis; onUse: (w: number) => void }) {
  const f = perf.ftp;
  const conf = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence', none: '' }[f.confidence];
  return (
    <div className="card">
      <div className="card-head">
        <h2>Estimated FTP</h2>
        {conf && <span className="chip">{conf}</span>}
      </div>
      {f.estimate ? (
        <div className="stack">
          <div className="row" style={{ alignItems: 'flex-end', gap: 14 }}>
            <div>
              <div className="big-number num">{f.estimate} W</div>
              <div className="small muted">
                range {f.low}–{f.high} W{f.current ? ` · your setting ${f.current} W` : ''}
              </div>
            </div>
            <span className="spacer" />
            {f.current && Math.abs(f.estimate - f.current) / f.current >= 0.03 && (
              <button className="btn sm primary" onClick={() => onUse(f.estimate!)}>
                Use {f.estimate} W
              </button>
            )}
          </div>
          <div className="table-wrap">
            <table className="steps">
              <thead>
                <tr>
                  <th>Source</th>
                  <th className="num">FTP</th>
                  <th className="num">Weight</th>
                  <th>Based on</th>
                </tr>
              </thead>
              <tbody>
                {f.sources.map((s) => (
                  <tr key={s.key}>
                    <td style={{ whiteSpace: 'nowrap' }}>{s.label}</td>
                    <td className="num">{s.value} W</td>
                    <td className="num">{Math.round(s.weight * 100)}%</td>
                    <td className="ink2">{s.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small ink2">{f.suggestion}</p>
        </div>
      ) : (
        <p className="muted small">{f.suggestion}</p>
      )}
      {f.history.length > 5 && (
        <div style={{ marginTop: 10 }}>
          <LineChart title="eFTP history" labels={f.history.map((h) => fmtShort(h.date))} series={[{ name: 'eFTP', color: 'var(--s1)', values: f.history.map((h) => h.eftp) }]} height={150} yFormat={(v) => `${Math.round(v)}`} />
          <p className="tiny muted">intervals.icu eFTP over the last 6 months (W).</p>
        </div>
      )}
    </div>
  );
}

export function ImprovementCard({ perf }: { perf: PerformanceAnalysis }) {
  const v = VERDICT[perf.improvement.verdict];
  return (
    <div className="card">
      <div className="card-head">
        <h2>Am I improving?</h2>
        <span className="status-pill">
          <StatusIcon status={v.st} />
          {v.label}
        </span>
      </div>
      <p className="small ink2" style={{ marginBottom: 6 }}>
        {perf.improvement.summary}
      </p>
      <div>
        {perf.improvement.factors.map((f) => (
          <div key={f.label} className="factor-row">
            <StatusIcon status={f.good == null ? 'unknown' : f.good ? 'green' : 'red'} />
            <div>
              <div className="small" style={{ fontWeight: 650 }}>
                {f.label}
              </div>
              <div className="tiny muted">{f.detail}</div>
            </div>
            <div className="small num" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
              {f.direction === 'up' ? '↑ ' : f.direction === 'down' ? '↓ ' : f.direction === 'flat' ? '→ ' : ''}
              {f.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EfficiencyCard({ perf }: { perf: PerformanceAnalysis }) {
  const pts = perf.points.slice(-40);
  return (
    <div className="card">
      <div className="card-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2>Aerobic efficiency</h2>
          <span className="small ink2">Power per heartbeat on steady rides{perf.model ? ', corrected for heat, indoor riding, fatigue and duration' : ''}.</span>
        </div>
        {perf.efTrendPctPerMonth != null && (
          <span className="chip">
            {perf.efTrendPctPerMonth >= 0 ? '+' : ''}
            {perf.efTrendPctPerMonth}%/month
          </span>
        )}
      </div>
      {pts.length >= 3 ? (
        <LineChart
          title="Efficiency per ride"
          labels={pts.map((p) => `${fmtShort(p.date)}${p.indoor ? ' (indoor)' : ''} · ${Math.round(p.tempC)}°C`)}
          series={[
            { name: 'Raw NP/HR', color: 'var(--axis)', values: pts.map((p) => p.ef), width: 1.5 },
            ...(perf.model ? [{ name: 'Conditions-adjusted', color: 'var(--s1)', values: pts.map((p) => p.efAdj) }] : []),
          ]}
          yFormat={(v) => v.toFixed(2)}
          tickLabel={(_, i) => (i % Math.ceil(pts.length / 5) === 0 ? fmtShort(pts[i].date) : null)}
          height={170}
        />
      ) : (
        <p className="muted small">Needs a few steady rides with both power and heart rate.</p>
      )}
      {perf.conditionsNote && <p className="tiny muted" style={{ marginTop: 6 }}>{perf.conditionsNote}</p>}
      {perf.model && (
        <div className="grid-3" style={{ marginTop: 8 }}>
          <div className="metric">
            <div className="label">Heat</div>
            <div className="value num">{perf.model.bpmPerDegree != null ? `+${(perf.model.bpmPerDegree * 10).toFixed(1)} bpm` : '—'}</div>
            <div className="sub">per +10 °C at the same power</div>
          </div>
          <div className="metric">
            <div className="label">Indoors</div>
            <div className="value num">{perf.model.bpmIndoor != null ? `${perf.model.bpmIndoor >= 0 ? '+' : ''}${perf.model.bpmIndoor} bpm` : '—'}</div>
            <div className="sub">vs outdoor at the same power</div>
          </div>
          <div className="metric">
            <div className="label">Fitness drift</div>
            <div className="value num">
              {perf.model.wattsPerMonthAtSameHr >= 0 ? '+' : ''}
              {perf.model.wattsPerMonthAtSameHr} W
            </div>
            <div className="sub">per month at the same heart rate</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function BestEffortsCard({ perf }: { perf: PerformanceAnalysis }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Best efforts</h2>
        <span className="small muted">last 6 weeks vs the 6 before</span>
      </div>
      <div className="table-wrap">
        <table className="steps">
          <thead>
            <tr>
              <th>Duration</th>
              <th className="num">Recent</th>
              <th className="num">Previous</th>
              <th className="num">Change</th>
            </tr>
          </thead>
          <tbody>
            {perf.bestEfforts.map((b) => (
              <tr key={b.label}>
                <td>{b.label}</td>
                <td className="num">{b.recent ? `${b.recent} W` : '—'}</td>
                <td className="num">{b.previous ? `${b.previous} W` : '—'}</td>
                <td className="num" style={{ fontWeight: 650 }}>
                  {b.changePct != null ? `${b.changePct >= 0 ? '+' : ''}${b.changePct}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tiny muted" style={{ marginTop: 6 }}>
        From efforts intervals.icu detected in your rides (a lower bound of your true best). Efforts done while very fatigued understate fitness.
      </p>
    </div>
  );
}
