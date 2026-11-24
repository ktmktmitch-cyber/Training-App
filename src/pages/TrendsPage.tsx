import { useMemo, useState } from 'react';
import { addDays, diffDays, fmtShort } from '../engine/dates';
import { mean, projectLoad, round, sd } from '../engine/stats';
import { FORM_ZONES } from '../engine/status';
import { loadSeries } from '../engine/trends';
import { BarChart, LineChart } from '../components/charts';
import { AerobicCard, LoadFocusCard, PowerProfileCard, ProgressionCard, StatusChip } from '../components/insights';
import { JournalCard } from '../components/JournalCard';
import { BestEffortsCard, EfficiencyCard, FtpCard, ImprovementCard, StalenessCard, Vo2Card } from '../components/performance';
import { Seg, useToast } from '../components/ui';
import { TAG_BY_KEY } from '../engine/journal';
import { HeatCard } from '../components/HeatCard';
import { DataGapNotes } from '../components/EmptyStates';
import { useApp } from '../lib/store';

function rolling(vals: (number | null)[], n: number): (number | null)[] {
  return vals.map((_, i) => {
    const win = vals.slice(Math.max(0, i - n + 1), i + 1).filter((v): v is number => v != null);
    return win.length >= Math.min(3, n) ? round(mean(win), 1) : null;
  });
}

type Tab = 'performance' | 'recovery' | 'load';

export function TrendsPage() {
  const app = useApp();
  const { data, trends, asOf, effects } = app;
  const [toast, showToast] = useToast();
  const [tab, setTab] = useState<Tab>(() => {
    const q = window.location.hash.split('?')[1];
    const t = q ? new URLSearchParams(q).get('tab') : null;
    return t === 'recovery' || t === 'load' ? t : 'performance';
  });
  const days = 90;
  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(asOf, -(days - 1 - i))), [asOf]);
  const byDate = useMemo(() => new Map(data.wellness.map((w) => [w.date, w])), [data.wellness]);
  const labels = dates.map(fmtShort);

  const hrv = dates.map((d) => byDate.get(d)?.hrv ?? null);
  const rhr = dates.map((d) => byDate.get(d)?.rhr ?? null);
  // Journal: explained nights are left out of the 7-day trend and the baseline band
  const inTrend = (d: string) => !effects[d]?.excludeTrend;
  const inBase = (d: string) => !effects[d]?.excludeBaseline;
  const hrv7 = rolling(dates.map((d, i) => (inTrend(d) ? hrv[i] : null)), 7);
  const rhr7 = rolling(dates.map((d, i) => (inTrend(d) ? rhr[i] : null)), 7);
  const markers = dates
    .map((d, i) => (effects[d] ? { index: i, label: `${effects[d].tags.map((t) => TAG_BY_KEY[t]?.short).join(', ')}${effects[d].excludeBaseline ? ' — excluded from baseline' : ''}` } : null))
    .filter((x): x is { index: number; label: string } => x != null);
  // Rolling normal range: 60-day baseline (ending 7 days before) ± 0.5 SD in ln space
  const hrvBand = dates.map((d) => {
    const base = data.wellness
      .filter((w) => w.hrv && inBase(w.date) && diffDays(d, w.date) >= 7 && diffDays(d, w.date) <= 67)
      .map((w) => Math.log(w.hrv as number));
    if (base.length < 14) return { low: null, high: null };
    const mu = mean(base);
    const s = sd(base);
    return { low: round(Math.exp(mu - 0.5 * s), 1), high: round(Math.exp(mu + 0.5 * s), 1) };
  });
  const rhrBand = dates.map((d) => {
    const base = data.wellness.filter((w) => w.rhr && inBase(w.date) && diffDays(d, w.date) >= 7 && diffDays(d, w.date) <= 67).map((w) => w.rhr as number);
    if (base.length < 14) return { low: null, high: null };
    const mu = mean(base);
    const s = Math.max(sd(base), 1.5);
    return { low: round(mu - s, 1), high: round(mu + s, 1) };
  });

  const hasWellnessLoad = data.wellness.some((w) => w.ctl != null);
  const series = hasWellnessLoad
    ? dates.map((d) => ({ ctl: byDate.get(d)?.ctl ?? null, atl: byDate.get(d)?.atl ?? null }))
    : (() => {
        const s = loadSeries(data.activities, addDays(asOf, -200), asOf);
        const m = new Map(s.map((x) => [x.date, x]));
        return dates.map((d) => ({ ctl: m.get(d)?.ctl ?? null, atl: m.get(d)?.atl ?? null }));
      })();
  const ctl = series.map((s) => (s.ctl != null ? round(s.ctl, 1) : null));
  const atl = series.map((s) => (s.atl != null ? round(s.atl, 1) : null));
  const tsb = series.map((_, i) => (i > 0 && series[i - 1].ctl != null && series[i - 1].atl != null ? round(series[i - 1].ctl! - series[i - 1].atl!, 1) : null));

  // PMC with the planned week appended (TrainingPeaks-style projection)
  const future = app.plan.days.filter((d) => d.date > asOf);
  const lastCtl = ctl[ctl.length - 1];
  const lastAtl = atl[atl.length - 1];
  const proj = lastCtl != null && lastAtl != null ? projectLoad(lastCtl, lastAtl, future.map((d) => d.ride?.tss ?? 0)) : null;
  const pmcLabels = [...labels, ...future.map((d) => fmtShort(d.date))];
  const pad = (arr: (number | null)[]) => [...arr, ...future.map(() => null)];
  const projCtl = proj ? [...ctl.map((_, i) => (i === ctl.length - 1 ? lastCtl : null)), ...proj.ctl.map((v) => round(v, 1))] : [];
  const projAtl = proj ? [...atl.map((_, i) => (i === atl.length - 1 ? lastAtl : null)), ...proj.atl.map((v) => round(v, 1))] : [];
  const tsbAll = proj ? [...tsb, ...proj.tsb.map((v) => round(v, 1))] : tsb;

  const dist = trends.distribution28;
  const hasHrv = hrv.some((v) => v != null);
  const hasRhr = rhr.some((v) => v != null);

  return (
    <>
      <div className="row">
        <h1>Progress</h1>
        <span className="spacer" />
        <StatusChip status={app.status} />
      </div>
      <p className="small ink2" style={{ marginTop: -8 }}>
        <b>{app.status.label}:</b> {app.status.detail}
      </p>
      <DataGapNotes />
      <Seg<Tab>
        value={tab}
        onChange={setTab}
        ariaLabel="Progress section"
        options={[
          { value: 'performance', label: 'Performance & FTP' },
          { value: 'recovery', label: 'Recovery & journal' },
          { value: 'load', label: 'Training load' },
        ]}
      />
      {tab === 'performance' && (
        <>
          <HeatCard heat={app.heat} />
          <div className="grid-2">
            <FtpCard
              perf={app.performance}
              onUse={(w) => {
                app.updateSettings((s) => ({ ...s, ftpOverride: w }));
                showToast(`FTP set to ${w} W in this app. Update it in intervals.icu too so its zones and TSS match.`);
              }}
            />
            <ImprovementCard perf={app.performance} />
          </div>
          <EfficiencyCard perf={app.performance} />
          <div className="grid-2">
            <Vo2Card vo2={app.vo2} history={app.vo2History} />
            <BestEffortsCard perf={app.performance} />
          </div>
          <PowerProfileCard profile={app.profile} curves={app.powerCurves} />
          <AerobicCard trends={trends} />
        </>
      )}
      {tab === 'load' && (
      <>
      <div className="grid-2">
        <LoadFocusCard focus={app.loadFocus} />
        <StalenessCard s={app.staleness} />
      </div>
      <ProgressionCard progression={app.progression} />
      {trends.notes.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>What your data says</h2>
          <ul className="why">
            {trends.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      </>
      )}
      {tab === 'recovery' && (
      <>
      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h2>HRV (rMSSD)</h2>
            <span className="small muted">90 days</span>
          </div>
          {hasHrv ? (
            <LineChart
              title="HRV daily and 7-day average with normal range"
              labels={labels}
              series={[
                { name: 'Daily', color: 'var(--axis)', values: hrv, width: 1.5 },
                { name: '7-day average', color: 'var(--s1)', values: hrv7 },
              ]}
              band={{ low: hrvBand.map((b) => b.low), high: hrvBand.map((b) => b.high), color: 'var(--s1)', name: 'Normal range' }}
              yFormat={(v) => `${Math.round(v)}`}
              markers={markers}
            />
          ) : (
            <p className="muted">No HRV data. Enable Garmin (or Oura/Whoop/HRV4Training) wellness sync in intervals.icu.</p>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Resting heart rate</h2>
            <span className="small muted">90 days</span>
          </div>
          {hasRhr ? (
            <LineChart
              title="Resting HR daily and 7-day average with baseline range"
              labels={labels}
              series={[
                { name: 'Daily', color: 'var(--axis)', values: rhr, width: 1.5 },
                { name: '7-day average', color: 'var(--s1)', values: rhr7 },
              ]}
              band={{ low: rhrBand.map((b) => b.low), high: rhrBand.map((b) => b.high), color: 'var(--s1)', name: 'Baseline ±1 SD' }}
              markers={markers}
            />
          ) : (
            <p className="muted">No resting HR data yet.</p>
          )}
        </div>
      </div>
      {markers.length > 0 && <p className="tiny muted" style={{ marginTop: -6 }}>▼ = journal-tagged mornings. Excluded nights don’t shape the normal range or the 7-day average.</p>}
      <JournalCard journal={app.journal} onChange={app.setJournalTags} impacts={app.impacts} asOf={asOf} />
      </>
      )}
      {tab === 'load' && (
      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Fitness & fatigue</h2>
            <span className="small muted">CTL (42 d) / ATL (7 d)</span>
          </div>
          <LineChart
            title="Fitness and fatigue"
            labels={pmcLabels}
            series={[
              { name: 'Fitness (CTL)', color: 'var(--s1)', values: pad(ctl) },
              { name: 'Fatigue (ATL)', color: 'var(--s2)', values: pad(atl) },
              ...(proj
                ? [
                    { name: 'Planned fitness', color: 'var(--s1)', values: projCtl, opacity: 0.4 },
                    { name: 'Planned fatigue', color: 'var(--s2)', values: projAtl, opacity: 0.4 },
                  ]
                : []),
            ]}
            marker={labels.length - 1}
          />
          <p className="tiny muted">Faded lines = where this week’s plan takes you. Vertical line = today.</p>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Form (TSB)</h2>
            <span className="small muted">with intervals.icu form zones</span>
          </div>
          <LineChart
            title="Form"
            labels={pmcLabels}
            series={[{ name: 'Form', color: 'var(--s1)', values: tsbAll }]}
            zeroLine
            marker={labels.length - 1}
            zones={FORM_ZONES.map((z) => ({ from: z.from, to: z.to, label: z.label, color: z.tone === 'good' ? 'var(--good)' : z.tone === 'bad' ? 'var(--critical)' : 'var(--s-neutral)' }))}
          />
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Weekly training hours</h2>
            <span className="small muted">last 12 weeks</span>
          </div>
          <BarChart
            title="Weekly hours"
            labels={trends.weekly.map((w) => fmtShort(w.weekStart))}
            values={trends.weekly.map((w) => w.hours)}
            format={(v) => (v % 1 ? v.toFixed(1) : String(v))}
            highlight={trends.weekly.length - 1}
            tooltip={(i) => {
              const w = trends.weekly[i];
              return (
                <>
                  <div className="muted">Week of {fmtShort(w.weekStart)}</div>
                  <div>
                    <b className="num">{w.hours} h</b> · <span className="num">{w.tss} TSS</span>
                  </div>
                  <div className="muted">
                    {[
                      [w.rides, 'ride'],
                      [w.runs ?? 0, 'run'],
                      [w.swims ?? 0, 'swim'],
                      [w.strength, 'lift'],
                    ]
                      .filter(([n]) => (n as number) > 0)
                      .map(([n, l]) => `${n} ${l}${n === 1 ? '' : 's'}`)
                      .join(' · ') || 'no sessions'}
                  </div>
                </>
              );
            }}
          />
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Intensity distribution</h2>
            <span className="small muted">last 28 days · {dist.source === 'none' ? 'no zone data' : `by ${dist.source}`}</span>
          </div>
          {dist.source !== 'none' ? (
            <div className="stack">
              <div className="segbar" role="img" aria-label={`Easy ${Math.round(dist.low * 100)}%, moderate ${Math.round(dist.mid * 100)}%, hard ${Math.round(dist.high * 100)}%`}>
                {[
                  { v: dist.low, bg: 'var(--z2)', ink: 'var(--on-z2)', name: 'Easy' },
                  { v: dist.mid, bg: 'var(--z4)', ink: 'var(--on-z4)', name: 'Moderate' },
                  { v: dist.high, bg: 'var(--z6)', ink: 'var(--on-z6)', name: 'Hard' },
                ]
                  .filter((s) => s.v > 0)
                  .map((s) => (
                    <div key={s.name} style={{ flex: s.v, background: s.bg, color: s.ink }} title={`${s.name}: ${Math.round(s.v * 100)}%`}>
                      {s.v >= 0.08 ? `${Math.round(s.v * 100)}%` : ''}
                    </div>
                  ))}
              </div>
              <div className="legend">
                <span>
                  <i className="box" style={{ background: 'var(--z2)' }} />
                  Easy (&lt;LT1, Z1-2)
                </span>
                <span>
                  <i className="box" style={{ background: 'var(--z4)' }} />
                  Moderate (Z3-4)
                </span>
                <span>
                  <i className="box" style={{ background: 'var(--z6)' }} />
                  Hard (Z5+)
                </span>
              </div>
              <div className="grid-3" style={{ marginTop: 6 }}>
                <div className="metric">
                  <div className="label">Hard sessions · 14 d</div>
                  <div className="value num">{trends.hardSessions14}</div>
                </div>
                <div className="metric">
                  <div className="label">Longest ride · 28 d</div>
                  <div className="value num">{Math.floor(trends.longestRideMin28 / 60)}h{String(trends.longestRideMin28 % 60).padStart(2, '0')}</div>
                </div>
                <div className="metric">
                  <div className="label">Lifts · 28 d</div>
                  <div className="value num">{trends.strengthSessions28}</div>
                </div>
              </div>
            </div>
          ) : (
            <p className="muted">No zone data yet.</p>
          )}
        </div>
      </div>
      )}
      {toast}
    </>
  );
}
