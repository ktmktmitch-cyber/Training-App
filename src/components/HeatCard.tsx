import { fmtShort } from '../engine/dates';
import type { HeatAdaptation } from '../engine/heat';
import { LineChart } from './charts';
import { StatusIcon } from './ui';

const ST = { none: 'unknown', partial: 'amber', good: 'green', well: 'green' } as const;

/** Heat adaptation: current acclimation, what heat and indoor riding cost you, and how to adapt. */
export function HeatCard({ heat }: { heat: HeatAdaptation }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2>Heat adaptation</h2>
          <span className="small ink2">How heat and indoor riding affect you, and how heat-acclimated you are now.</span>
        </div>
        <span className="status-pill">
          <StatusIcon status={ST[heat.level]} />
          {heat.label} · {heat.index}%
        </span>
      </div>
      <div className="grid-3">
        <div className="metric">
          <div className="label">Acclimation</div>
          <div className="value num">{heat.index}%</div>
          <div className="sub">
            {heat.hotSessions14} hot session{heat.hotSessions14 === 1 ? '' : 's'} (≥ 27 °C) in 14 d{heat.indoorSessions14 ? ` · ${heat.indoorSessions14} indoor` : ''}
          </div>
        </div>
        <div className="metric">
          <div className="label">Heat cost at 30 °C</div>
          <div className="value num">{heat.bpmAt30 != null ? `+${heat.bpmAt30} bpm` : '—'}</div>
          <div className="sub">{heat.wattsAt30 != null ? `≈ ${heat.wattsAt30} W less at the same heart rate vs 15 °C` : 'needs rides across a range of temperatures'}</div>
        </div>
        <div className="metric">
          <div className="label">Indoor cost</div>
          <div className="value num">{heat.bpmIndoor != null ? `${heat.bpmIndoor >= 0 ? '+' : ''}${heat.bpmIndoor} bpm` : '—'}</div>
          <div className="sub">{heat.wattsIndoor != null ? `≈ ${Math.abs(heat.wattsIndoor)} W ${heat.wattsIndoor >= 0 ? 'less' : 'more'} at the same heart rate indoors` : 'needs a few indoor and outdoor rides'}</div>
        </div>
      </div>
      {heat.series.some((p) => p.index > 0) && (
        <div style={{ marginTop: 10 }}>
          <LineChart title="Heat acclimation, last 6 weeks" labels={heat.series.map((p) => fmtShort(p.date))} series={[{ name: 'Acclimation %', color: 'var(--s2)', values: heat.series.map((p) => p.index) }]} height={120} yFormat={(v) => `${Math.round(v)}%`} />
        </div>
      )}
      <p className="small ink2" style={{ marginTop: 8 }}>{heat.advice}</p>
      <p className="tiny muted">
        {heat.lastHot ? `Last hot session ${fmtShort(heat.lastHot)}. ` : ''}
        {heat.hottest28 ? `Hottest ride in 4 weeks: ${heat.hottest28.tempC} °C (${heat.hottest28.name}, ${fmtShort(heat.hottest28.date)}). ` : ''}
        Heat cost comes from your rides’ heart rate vs power, adjusted for fatigue, duration and fitness. Acclimation builds over ~1-2 weeks of regular heat exposure and fades ~2-3%/day without it. Temperatures come from your bike computer, which reads a little warm in the sun.
      </p>
    </div>
  );
}
