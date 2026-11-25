import type { ReactNode } from 'react';
import { formZone } from '../engine/status';
import type { CheckIn, Readiness, ReadinessStatus } from '../engine/types';
import { ScoreRing } from './charts';
import { Seg, STATUS, StatusIcon } from './ui';

const FLAG_STATUS = { good: 'green', info: 'unknown', warn: 'amber', bad: 'red' } as const;

function Factor({ status, label }: { status: ReadinessStatus; label: string }) {
  return (
    <div className="row tiny" style={{ gap: 5, marginTop: 4, flexWrap: 'nowrap' }}>
      <StatusIcon status={status} />
      <span style={{ fontWeight: 600 }}>{label}</span>
    </div>
  );
}

export function ReadinessCard({ r, asOf, checkIn, onCheckIn, extra }: { r: Readiness; asOf: string; checkIn: CheckIn | null; onCheckIn: (c: CheckIn | null) => void; extra?: ReactNode }) {
  const s = STATUS[r.status];
  const sign = (v: number) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`);
  const hrvF = r.hrv.status
    ? ({ balanced: ['green', 'Balanced'], unbalanced: ['amber', 'Unbalanced'], low: ['red', 'Low'], poor: ['red', 'Poor'] } as const)[r.hrv.status]
    : null;
  const rhrF =
    r.rhr.avg7 != null && r.rhr.baseline != null && r.rhr.sd != null
      ? r.rhr.avg7 > r.rhr.baseline + Math.max(r.rhr.sd, 2.5)
        ? (['amber', 'Elevated'] as const)
        : (['green', 'Normal'] as const)
      : null;
  const fz = r.tsb != null ? formZone(r.tsb) : null;
  const formF = fz ? ([fz.tone === 'good' ? 'green' : fz.tone === 'bad' ? 'red' : 'unknown', fz.label] as const) : null;
  const sleepF = r.sleepAvg3h != null ? (r.sleepAvg3h >= 7 ? (['green', 'Good'] as const) : r.sleepAvg3h >= 6 ? (['amber', 'Fair'] as const) : (['red', 'Poor'] as const)) : null;
  return (
    <div className="card">
      <div className="readiness">
        <ScoreRing score={r.score} color={s.color} label="readiness" />
        <div className="stack">
          <div className="row">
            <span className="status-pill">
              <StatusIcon status={r.status} />
              {s.label}
            </span>
            <span className="small ink2">{r.summary}</span>
          </div>
          <div className="metrics">
            <div className="metric">
              <div className="label">HRV · 7-day</div>
              <div className="value num">{r.hrv.avg7 != null ? `${r.hrv.avg7} ms` : '—'}</div>
              <div className="sub num">
                {r.hrv.low != null ? `normal ${r.hrv.low}–${r.hrv.high}` : 'no data'}
                {r.hrv.trend ? ` · ${r.hrv.trend === 'up' ? '↑' : r.hrv.trend === 'down' ? '↓' : '→'}` : ''}
              </div>
              {hrvF && <Factor status={hrvF[0]} label={hrvF[1]} />}
            </div>
            <div className="metric">
              <div className="label">Resting HR · 7-day</div>
              <div className="value num">{r.rhr.avg7 != null ? `${Math.round(r.rhr.avg7)} bpm` : '—'}</div>
              <div className="sub num">{r.rhr.baseline != null ? `baseline ${Math.round(r.rhr.baseline)}` : 'no data'}</div>
              {rhrF && <Factor status={rhrF[0]} label={rhrF[1]} />}
            </div>
            <div className="metric">
              <div className="label">Form (TSB)</div>
              <div className="value num">{r.tsb != null ? sign(r.tsb) : '—'}</div>
              <div className="sub num">{r.ctl != null ? `fitness ${Math.round(r.ctl)} · fatigue ${Math.round(r.atl ?? 0)}` : 'no data'}</div>
              {formF && <Factor status={formF[0]} label={formF[1]} />}
            </div>
            <div className="metric">
              <div className="label">Sleep · 3-night</div>
              <div className="value num">{r.sleepAvg3h != null ? `${r.sleepAvg3h} h` : '—'}</div>
              <div className="sub num">{r.rampRate != null ? `CTL ramp ${r.rampRate >= 0 ? '+' : ''}${r.rampRate}/wk` : ''}</div>
              {sleepF && <Factor status={sleepF[0]} label={sleepF[1]} />}
            </div>
          </div>
          <div className="flags">
            {r.flags.map((f) => (
              <div className="flag" key={f.id}>
                <StatusIcon status={FLAG_STATUS[f.level]} />
                <div>
                  <b>{f.title}.</b> <span className="ink2">{f.detail}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 4 }}>
            <span className="small" style={{ fontWeight: 600 }}>
              How do you feel today?
            </span>
            <Seg<string>
              value={checkIn?.feel ?? ''}
              onChange={(v) => onCheckIn(v === checkIn?.feel ? null : { date: asOf, feel: v as CheckIn['feel'] })}
              options={[
                { value: 'great', label: 'Great' },
                { value: 'normal', label: 'Normal' },
                { value: 'tired', label: 'Tired' },
                { value: 'sore', label: 'Sore' },
                { value: 'sick', label: 'Sick' },
              ]}
            />
          </div>
          <span className="tiny muted">
            {checkIn?.feel === 'great'
              ? 'Feeling great moves readiness up one level (Rest → Caution → Ready). Tap again to undo.'
              : checkIn?.feel === 'tired'
                ? 'Feeling tired moves readiness down one level and eases the plan. Tap again to undo.'
                : checkIn?.feel === 'sick'
                  ? 'Sick always means rest. Tap again to undo.'
                  : checkIn?.feel === 'sore'
                    ? 'Sore lowers readiness a little and keeps heavy leg lifting off today.'
                    : 'Your answer adjusts the readiness meter — Great or Tired move it a level up or down.'}
          </span>
          {extra}
        </div>
      </div>
    </div>
  );
}
