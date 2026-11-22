import { useMemo, useRef, useState } from 'react';
import { fmtLong, fmtShort } from '../engine/dates';
import { FOCUS_LABEL, type FocusKey } from '../engine/loadFocus';
import { FORM_ZONES } from '../engine/status';
import { POWER_KEY_LABEL, POWER_KEYS, type RiderMetrics, type TeamRider } from '../engine/team';
import { BarChart, LineChart } from '../components/charts';
import { LoadFocusCard } from '../components/insights';
import { StatusIcon } from '../components/ui';
import type { ReadinessStatus } from '../engine/types';
import { useApp } from '../lib/store';
import { useTeam } from '../lib/team';

const dash = '—';
const h1 = (v: number | null | undefined) => (v == null ? dash : v.toFixed(1));
const n0 = (v: number | null | undefined) => (v == null ? dash : Math.round(v).toLocaleString('en-US'));
const STALE_ST: Record<string, ReadinessStatus> = { low: 'green', moderate: 'amber', high: 'red', unknown: 'unknown' };
const STALE_LABEL: Record<string, string> = { low: 'Low', moderate: 'Watch', high: 'High', unknown: 'No data' };
const FOCUS_FILL: Record<FocusKey, string> = { low: 'var(--z2)', high: 'var(--z4)', anaerobic: 'var(--z6)' };

type SortKey = keyof TeamRider | 'vo2' | 'stale' | 'lowShare';

function MixBar({ m }: { m: RiderMetrics | undefined }) {
  const f = m?.loadFocus;
  if (!f || !(f.load.low + f.load.high + f.load.anaerobic)) return <span className="muted">{dash}</span>;
  return (
    <span className="mixbar" title={`Low aerobic ${Math.round(f.share.low * 100)}% · High aerobic ${Math.round(f.share.high * 100)}% · Anaerobic ${Math.round(f.share.anaerobic * 100)}%${f.shortage ? ` — ${FOCUS_LABEL[f.shortage]} shortage` : ''}`}>
      {(['low', 'high', 'anaerobic'] as FocusKey[]).map((k) => (
        <i key={k} style={{ flex: Math.max(0.0001, f.share[k]), background: FOCUS_FILL[k] }} />
      ))}
    </span>
  );
}

export function TeamPage() {
  const t = useTeam();
  const app = useApp();
  const team = t.team;
  const meId = app.account?.id ?? (app.data.source === 'intervals' ? app.data.profile?.id : null) ?? null;
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'hours_this_week', dir: -1 });
  const [sel, setSel] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const ok = useMemo(() => (team?.riders ?? []).filter((r) => r.state === 'ok'), [team]);
  const blocked = useMemo(() => (team?.riders ?? []).filter((r) => r.state !== 'ok'), [team]);
  const sum = (k: keyof TeamRider) => ok.reduce((a, r) => a + ((r[k] as number) || 0), 0);
  const ranked = ok.filter((r) => r.hours_this_week > 0).sort((a, b) => b.hours_this_week - a.hours_this_week);
  const prs = ok.flatMap((r) => r.prs).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const staleWatch = ok.filter((r) => ['moderate', 'high'].includes(t.metrics[r.id]?.staleness.level));
  const vo2s = ok.map((r) => t.metrics[r.id]?.vo2.value).filter((v): v is number => v != null);
  const hasDeep = ok.some((r) => t.metrics[r.id]?.loadFocus);
  const me = ok.find((r) => r.id === meId) ?? null;
  const rank = (k: keyof TeamRider) => (me ? [...ok].sort((a, b) => ((b[k] as number) ?? -1) - ((a[k] as number) ?? -1)).findIndex((r) => r.id === me.id) + 1 : null);

  const val = (r: TeamRider, k: SortKey): number | string | null => {
    const m = t.metrics[r.id];
    if (k === 'vo2') return m?.vo2.value ?? null;
    if (k === 'stale') return m?.staleness.score ?? null;
    if (k === 'lowShare') return m?.loadFocus ? m.loadFocus.share.low : null;
    return r[k] as number | string | null;
  };
  const rows = [...ok].sort((a, b) => {
    const x = val(a, sort.key);
    const y = val(b, sort.key);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
  });
  const th = (key: SortKey, label: string, cls = '') => (
    <th
      className={`sortable-th ${cls}`}
      aria-sort={sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}
      tabIndex={0}
      onClick={() => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'rider' ? 1 : -1 }))}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'rider' ? 1 : -1 })))}
    >
      {label}
      {sort.key === key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}
    </th>
  );
  const open = (id: string) => {
    setSel(id);
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const selRider = ok.find((r) => r.id === sel) ?? null;

  if (!team) {
    return (
      <>
        <h1>Team</h1>
        <div className="card stack">
          <p className="ink2">{t.loading ? 'Loading team data…' : t.error ?? 'No team data yet.'}</p>
          <p className="small muted">
            Data comes from your team-dashboard repository’s <code>data/team.json</code>, which its GitHub Action rebuilds every few hours from your coach account on intervals.icu. Change the URL in Settings → Team.
          </p>
          <div className="row">
            <button className="btn" onClick={t.refresh} disabled={t.loading}>
              Retry
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="row">
        <div className="stack" style={{ gap: 2 }}>
          <h1>Team</h1>
          <span className="small ink2">
            {ranked.length ? (
              <>
                This week the team has ridden <b>{h1(sum('hours_this_week'))}</b> hours, led by <b>{ranked[0].rider}</b> with <b>{h1(ranked[0].hours_this_week)}</b> h.
              </>
            ) : (
              'No rides or runs logged by the team yet this week (weeks start Monday).'
            )}
          </span>
          <span className="tiny muted">
            {t.source === 'demo' ? 'Demo team — turn off demo data in Settings to load your real team.' : `Updated ${team.updated} · from team-dashboard`}
          </span>
        </div>
        <span className="spacer" />
        {t.source === 'url' && (
          <button className="btn sm ghost" onClick={t.refresh} disabled={t.loading}>
            {t.loading ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
        {t.deepAvailable && (
          <button className="btn sm primary" onClick={t.loadDeep} disabled={!!t.deepProgress} title="Pull each rider’s wellness and activities from intervals.icu with your coach key">
            {t.deepProgress ? `Loading ${t.deepProgress.done}/${t.deepProgress.total}…` : hasDeep ? 'Refresh detailed metrics' : 'Load detailed metrics'}
          </button>
        )}
      </div>
      {t.error && <div className="callout warn">{t.error}</div>}
      {!hasDeep && t.source === 'url' && (
        <div className="callout">
          Load buckets, HRV-based readiness, training status and Garmin VO2max need each rider’s detailed data.{' '}
          {t.deepAvailable
            ? 'Tap “Load detailed metrics” to pull it from intervals.icu with your coach key.'
            : app.account && app.account.role !== 'coach'
              ? 'Those per-rider health details are visible to your coach; your own are on your Progress page.'
              : 'Add your intervals.icu (coach) API key in Settings to enable it.'}
        </div>
      )}

      <div className="team-tiles">
        {me && (
          <div className="card" style={{ borderColor: 'var(--accent)' }}>
            <div className="label">Your standing</div>
            <div className="team-big num">#{rank('hours_this_week')}</div>
            <div className="tiny muted">
              in hours this week · #{rank('fitness')} fitness · #{rank('eftp_wkg') || '—'} W/kg of {ok.length}
            </div>
          </div>
        )}
        <div className="card">
          <div className="label">Team hours · this week</div>
          <div className="team-big num">{h1(sum('hours_this_week'))} h</div>
          <div className="tiny muted">Last week {h1(sum('hours_last_week'))} h</div>
        </div>
        <div className="card">
          <div className="label">Team hours · this month</div>
          <div className="team-big num">{h1(sum('hours_month'))} h</div>
          <div className="tiny muted">
            Year {n0(sum('hours_ytd'))} h · {n0(sum('miles_ytd'))} mi
          </div>
        </div>
        <div className="card">
          <div className="label">Riders out this week</div>
          <div className="team-big num">{ranked.length}</div>
          <div className="tiny muted">
            of {team.riders.length} on the roster · {ok.length} connected
          </div>
        </div>
        <div className="card">
          <div className="label">Power PRs · last 8 weeks</div>
          <div className="team-big num">{prs.length}</div>
          <div className="tiny muted">Best of the past year, 5 s to 20 min</div>
        </div>
        <div className="card">
          <div className="label">Staleness watch</div>
          <div className="team-big num">{staleWatch.length}</div>
          <div className="tiny muted">{staleWatch.length ? staleWatch.map((r) => r.rider).join(', ') : 'Nobody flagged'}</div>
        </div>
        <div className="card">
          <div className="label">Avg VO2max estimate</div>
          <div className="team-big num">{vo2s.length ? (vo2s.reduce((a, b) => a + b, 0) / vo2s.length).toFixed(1) : dash}</div>
          <div className="tiny muted">ml/kg/min · {vo2s.length} riders with power data</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="stack" style={{ gap: 2 }}>
            <h2>Leaderboard</h2>
            <span className="small ink2">Tap a column to sort, a name for that rider’s details. ★ = best of the past year.</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data team-table">
            <thead>
              <tr>
                <th className="sticky-col" />
                <th className="group" colSpan={5}>
                  Volume (rides + runs)
                </th>
                <th className="group" colSpan={5}>
                  Fitness
                </th>
                <th className="group" colSpan={2}>
                  Health & load
                </th>
                <th className="group" colSpan={5}>
                  Best power, 8 weeks (W)
                </th>
              </tr>
              <tr>
                {th('rider', 'Rider', 'sticky-col l')}
                {th('hours_this_week', 'Week h', 'num')}
                {th('hours_last_week', 'Last wk', 'num')}
                {th('hours_month', 'Month', 'num')}
                {th('hours_ytd', 'Year h', 'num')}
                {th('miles_ytd', 'Year mi', 'num')}
                {th('fitness', 'Fitness', 'num')}
                {th('form', 'Form', 'num')}
                {th('eftp_watts', 'eFTP', 'num')}
                {th('eftp_wkg', 'W/kg', 'num')}
                {th('vo2', 'VO2max', 'num')}
                {th('stale', 'Staleness')}
                {th('lowShare', 'Load mix 4 wk')}
                {POWER_KEYS.map((k) => th(k, POWER_KEY_LABEL[k], 'num'))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const m = t.metrics[r.id];
                return (
                  <tr key={r.id} className={`${sel === r.id ? 'current' : ''} ${r.id === meId ? 'me' : ''}`}>
                    <td className="sticky-col">
                      <button className="link-btn" onClick={() => open(r.id)}>
                        {r.rider}
                      </button>
                      {r.id === meId && <span className="tiny muted"> (you)</span>}
                    </td>
                    <td className="num">{h1(r.hours_this_week)}</td>
                    <td className="num">{h1(r.hours_last_week)}</td>
                    <td className="num">{h1(r.hours_month)}</td>
                    <td className="num">{h1(r.hours_ytd)}</td>
                    <td className="num">{n0(r.miles_ytd)}</td>
                    <td className="num">{r.fitness ?? dash}</td>
                    <td className={`num ${r.form != null && r.form < -30 ? 'bad-ink' : r.form != null && r.form <= -10 ? 'good-ink' : ''}`} title={m?.formZone ?? ''}>
                      {r.form ?? dash}
                    </td>
                    <td className="num">{r.eftp_watts ?? dash}</td>
                    <td className="num">{r.eftp_wkg?.toFixed(2) ?? dash}</td>
                    <td className="num" title={m?.vo2.method}>
                      {m?.vo2.value?.toFixed(0) ?? dash}
                    </td>
                    <td>
                      {m && (
                        <span className="row" style={{ gap: 5, flexWrap: 'nowrap' }} title={m.staleness.factors.map((f) => f.label).join(', ') || m.staleness.summary}>
                          <StatusIcon status={STALE_ST[m.staleness.level]} />
                          {STALE_LABEL[m.staleness.level]}
                        </span>
                      )}
                    </td>
                    <td>
                      <MixBar m={m} />
                    </td>
                    {POWER_KEYS.map((k) => (
                      <td key={k} className={`num ${r[`${k}_pr` as keyof TeamRider] ? 'pr-ink' : ''}`}>
                        {r[`${k}_pr` as keyof TeamRider] ? '★ ' : ''}
                        {r[k] ?? dash}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {blocked.map((r) => (
                <tr key={r.id}>
                  <td className="sticky-col">{r.rider}</td>
                  <td colSpan={17} className="muted">
                    Waiting for coach access on intervals.icu
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Only activities that reach intervals.icu directly count (Garmin, Wahoo, Coros, Zwift, uploads). Strava-only activities are hidden by Strava’s API rules.
          {ok.some((r) => r.hidden_strava) ? ` Hidden Strava activities: ${ok.filter((r) => r.hidden_strava).map((r) => `${r.rider} ${r.hidden_strava}`).join(', ')}.` : ''}
        </p>
      </div>

      <div ref={detailRef}>{selRider && <RiderDetail r={selRider} m={t.metrics[selRider.id]} riders={ok} onPick={setSel} />}</div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Hours by rider</h2>
          </div>
          <div className="legend">
            <span>
              <i className="box" style={{ background: 'var(--s1)' }} />
              This week
            </span>
            <span>
              <i className="box" style={{ background: 'var(--z2)' }} />
              Last week
            </span>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            {[...ok]
              .sort((a, b) => b.hours_this_week - a.hours_this_week)
              .map((r) => {
                const max = Math.max(1, ...ok.map((x) => Math.max(x.hours_this_week, x.hours_last_week)));
                return (
                  <div key={r.id} className="hrow">
                    <div className="hrow-label">
                      <span className="small" style={{ fontWeight: 600 }}>
                        {r.rider}
                      </span>
                    </div>
                    <div className="stack" style={{ gap: 3 }}>
                      <div className="htrack thin">
                        <div className="hfill" style={{ width: `${(r.hours_this_week / max) * 100}%`, background: 'var(--s1)' }} />
                      </div>
                      <div className="htrack thin">
                        <div className="hfill" style={{ width: `${(r.hours_last_week / max) * 100}%`, background: 'var(--z2)' }} />
                      </div>
                    </div>
                    <span className="hrow-val tiny num">
                      {h1(r.hours_this_week)} / {h1(r.hours_last_week)} h
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Training load buckets · 4 weeks</h2>
          </div>
          {hasDeep ? (
            <>
              <div className="legend">
                {(['low', 'high', 'anaerobic'] as FocusKey[]).map((k) => (
                  <span key={k}>
                    <i className="box" style={{ background: FOCUS_FILL[k] }} />
                    {FOCUS_LABEL[k]}
                  </span>
                ))}
              </div>
              <div className="stack" style={{ gap: 10 }}>
                {ok
                  .filter((r) => t.metrics[r.id]?.loadFocus)
                  .map((r) => {
                    const f = t.metrics[r.id].loadFocus!;
                    const total = f.load.low + f.load.high + f.load.anaerobic;
                    return (
                      <div key={r.id} className="hrow">
                        <div className="hrow-label">
                          <span className="small" style={{ fontWeight: 600 }}>
                            {r.rider}
                          </span>
                          <span className="tiny muted num">{total} TSS</span>
                        </div>
                        <div className="segbar thin-seg">
                          {total > 0 &&
                            (['low', 'high', 'anaerobic'] as FocusKey[]).map((k) =>
                              f.share[k] > 0 ? <div key={k} style={{ flex: f.share[k], background: FOCUS_FILL[k] }} title={`${FOCUS_LABEL[k]} ${Math.round(f.share[k] * 100)}%`} /> : null,
                            )}
                        </div>
                        <span className="hrow-val tiny">{f.shortage ? `${FOCUS_LABEL[f.shortage]} short` : total ? 'balanced' : 'no data'}</span>
                      </div>
                    );
                  })}
              </div>
              <p className="tiny muted" style={{ marginTop: 8 }}>
                Share of each rider’s training load: low aerobic (Z1-2), high aerobic (tempo → VO2max), anaerobic (above VO2max). Compared with general base-phase targets.
              </p>
            </>
          ) : (
            <p className="small muted">Needs detailed metrics (button above).</p>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Recent PRs</h2>
            <span className="small muted">last 8 weeks vs past year</span>
          </div>
          <div className="table-wrap">
            <table className="steps">
              <thead>
                <tr>
                  <th>Rider</th>
                  <th>Duration</th>
                  <th className="num">Watts</th>
                  <th className="num">W/kg</th>
                  <th>Date</th>
                  <th>Ride</th>
                </tr>
              </thead>
              <tbody>
                {prs.map((p, i) => (
                  <tr key={i}>
                    <td>{p.rider}</td>
                    <td>{p.duration}</td>
                    <td className="num pr-ink">★ {p.watts}</td>
                    <td className="num">{p.wkg?.toFixed(1) ?? dash}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.date ? fmtLong(p.date) : dash}</td>
                    <td>{p.ride ?? dash}</td>
                  </tr>
                ))}
                {!prs.length && (
                  <tr>
                    <td colSpan={6} className="muted">
                      Nothing yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Recent activity</h2>
            <span className="small muted">last 14 days</span>
          </div>
          <div className="table-wrap" style={{ maxHeight: 380 }}>
            <table className="steps">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Rider</th>
                  <th>Activity</th>
                  <th className="num">Hours</th>
                  <th className="num">Miles</th>
                  <th className="num">Load</th>
                </tr>
              </thead>
              <tbody>
                {team.feed.map((a, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtShort(a.date)}</td>
                    <td>{a.rider}</td>
                    <td>
                      {a.name}
                      <span className="tiny muted"> · {a.type}</span>
                    </td>
                    <td className="num">{h1(a.hours)}</td>
                    <td className="num">{a.miles?.toFixed(1) ?? dash}</td>
                    <td className="num">{a.load ?? dash}</td>
                  </tr>
                ))}
                {!team.feed.length && (
                  <tr>
                    <td colSpan={6} className="muted">
                      Nothing yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <details className="card more">
        <summary>What the numbers mean</summary>
        <ul className="why" style={{ marginTop: 10 }}>
          <li><b>Hours and miles</b> — moving time and distance from every ride and run, by calendar week (Mon-Sun), month and year.</li>
          <li><b>Fitness / form</b> — intervals.icu CTL (≈6-week load average) and TSB (fitness − fatigue). −10 to −30 is productive (green), below −30 is high risk (red), above +5 is fresh.</li>
          <li><b>eFTP</b> — intervals.icu’s estimated FTP from recent rides, in watts and per kg.</li>
          <li><b>VO2max estimate</b> — maximal aerobic power ≈ best 5-min power (from 3- and 12-min bests with a critical-power model, or the rider’s power-duration model), converted with the ACSM cycling equation (10.8 × W/kg + 7 ml/kg/min). Averaged with the Garmin estimate when detailed metrics are loaded. A field estimate — a lab test is the reference.</li>
          <li><b>Staleness</b> — risk of the flat, overreached state that precedes overtraining (Foster’s monotony/strain model), plus chronically deep fatigue, no top-end stimulus for 3+ weeks, inactivity, stalled power with rising load, and (with detailed metrics) suppressed HRV / elevated resting HR. Hover for the reasons.</li>
          <li><b>Load mix</b> — 4-week split of training load into low aerobic / high aerobic / anaerobic (Garmin-style load focus), from each rider’s power or heart-rate zones.</li>
          <li><b>Power PR</b> — a best effort in the last 8 weeks matching or beating the rider’s best for that duration over the past year.</li>
        </ul>
      </details>
    </>
  );
}

function RiderDetail({ r, m, riders, onPick }: { r: TeamRider; m: RiderMetrics | undefined; riders: TeamRider[]; onPick: (id: string) => void }) {
  const trend = r.trend;
  return (
    <div className="card stack-lg hero">
      <div className="row">
        <h2 className="hero-title" style={{ margin: 0 }}>
          {r.rider}
        </h2>
        <span className="spacer" />
        <label className="row small">
          Rider
          <select className="select" value={r.id} onChange={(e) => onPick(e.target.value)}>
            {[...riders]
              .sort((a, b) => a.rider.localeCompare(b.rider))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.rider}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="hero-stats">
        <div>
          <b className="num">{r.fitness ?? dash}</b>
          <span>Fitness (CTL)</span>
        </div>
        <div>
          <b className="num">
            {r.form ?? dash} {m?.formZone ? <span className="tiny muted">{m.formZone}</span> : null}
          </b>
          <span>Form (TSB)</span>
        </div>
        <div>
          <b className="num">{r.eftp_watts ? `${r.eftp_watts} W` : dash}</b>
          <span>eFTP {r.eftp_wkg ? `· ${r.eftp_wkg.toFixed(2)} W/kg` : ''}</span>
        </div>
        <div>
          <b className="num">{m?.vo2.value?.toFixed(1) ?? dash}</b>
          <span>VO2max est. (ml/kg/min)</span>
        </div>
      </div>
      <div className="grid-2">
        <div>
          <h3 style={{ marginBottom: 6 }}>Hours by week</h3>
          {r.weeks.length ? (
            <BarChart
              title="Hours by week"
              labels={r.weeks.map((w) => fmtShort(w.week))}
              values={r.weeks.map((w) => w.hours)}
              format={(v) => (v % 1 ? v.toFixed(1) : String(v))}
              highlight={r.weeks.length - 1}
              height={160}
              tooltip={(i) => (
                <>
                  <div className="muted">Week of {fmtShort(r.weeks[i].week)}</div>
                  <b className="num">{r.weeks[i].hours} h</b> · {r.weeks[i].rides} rides · {r.weeks[i].miles} mi
                </>
              )}
            />
          ) : (
            <p className="muted small">No data</p>
          )}
        </div>
        <div>
          <h3 style={{ marginBottom: 6 }}>Fitness, fatigue & form · 8 weeks</h3>
          {trend.length > 1 ? (
            <LineChart
              title="Fitness, fatigue and form"
              labels={trend.map((p) => fmtShort(p.date))}
              series={[
                { name: 'Fitness', color: 'var(--s1)', values: trend.map((p) => p.fitness) },
                { name: 'Fatigue', color: 'var(--s2)', values: trend.map((p) => p.fatigue) },
                { name: 'Form', color: 'var(--s3)', values: trend.map((p) => p.form) },
              ]}
              zeroLine
              height={170}
            />
          ) : (
            <p className="muted small">No fitness data yet</p>
          )}
        </div>
      </div>
      {m && (
        <div className="grid-2">
          <div className="card" style={{ boxShadow: 'none' }}>
            <div className="card-head">
              <h3>Staleness risk</h3>
              <span className="status-pill">
                <StatusIcon status={STALE_ST[m.staleness.level]} />
                {STALE_LABEL[m.staleness.level]}
                {m.staleness.score != null ? ` · ${m.staleness.score}` : ''}
              </span>
            </div>
            <p className="small ink2">{m.staleness.summary}</p>
            <div className="grid-3" style={{ marginTop: 8 }}>
              <div className="metric">
                <div className="label">Monotony</div>
                <div className="value num">{m.staleness.monotony ?? dash}</div>
                <div className="sub">&gt;2.0 = risky</div>
              </div>
              <div className="metric">
                <div className="label">Strain vs usual</div>
                <div className="value num">{m.staleness.strainVsUsual != null ? `${m.staleness.strainVsUsual}×` : dash}</div>
                <div className="sub">this week</div>
              </div>
              <div className="metric">
                <div className="label">Last ride</div>
                <div className="value num" style={{ fontSize: 15 }}>
                  {m.lastRide ? fmtShort(m.lastRide) : dash}
                </div>
                <div className="sub">ramp {m.rampRate != null ? `${m.rampRate >= 0 ? '+' : ''}${m.rampRate}/wk` : dash}</div>
              </div>
            </div>
            {m.staleness.factors.length > 0 && (
              <ul className="why" style={{ marginTop: 8 }}>
                {m.staleness.factors.map((f) => (
                  <li key={f.label}>
                    <b>{f.label}:</b> {f.detail}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card" style={{ boxShadow: 'none' }}>
            <div className="card-head">
              <h3>VO2max estimate</h3>
              {m.vo2.category && <span className="chip">{m.vo2.category}</span>}
            </div>
            <div className="grid-3">
              <div className="metric">
                <div className="label">Estimate</div>
                <div className="value num">{m.vo2.value?.toFixed(1) ?? dash}</div>
                <div className="sub">ml/kg/min</div>
              </div>
              <div className="metric">
                <div className="label">From power</div>
                <div className="value num">{m.vo2.power?.toFixed(1) ?? dash}</div>
                <div className="sub">{m.vo2.p5 ? `5-min ≈ ${m.vo2.p5} W` : 'no power data'}</div>
              </div>
              <div className="metric">
                <div className="label">Garmin</div>
                <div className="value num">{m.vo2.garmin ?? dash}</div>
                <div className="sub">{m.vo2.weightKg ? `${m.vo2.weightKg} kg` : ''}</div>
              </div>
            </div>
            <p className="tiny muted" style={{ marginTop: 8 }}>
              {m.vo2.method || 'Needs power data (3- and 12-min bests) and weight.'}
            </p>
            {m.readiness && m.readiness.status !== 'unknown' && (
              <div className="stack" style={{ marginTop: 10 }}>
                <h3>Readiness today</h3>
                <div className="row small">
                  <span className="status-pill">
                    <StatusIcon status={m.readiness.status} />
                    {m.readiness.score}
                  </span>
                  <span className="ink2">{m.readiness.summary}</span>
                </div>
                <div className="tiny muted">
                  HRV 7-day {m.readiness.hrv.avg7 ?? dash} ms (normal {m.readiness.hrv.low ?? dash}–{m.readiness.hrv.high ?? dash}) · resting HR {m.readiness.rhr.avg7 ?? dash} bpm · {m.status ? `status ${m.status.label}` : ''}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {m?.loadFocus && <LoadFocusCard focus={m.loadFocus} />}
      <div>
        <h3 style={{ marginBottom: 6 }}>Latest rides and runs</h3>
        <div className="table-wrap">
          <table className="steps">
            <thead>
              <tr>
                <th>Date</th>
                <th>Ride</th>
                <th>Type</th>
                <th className="num">Hours</th>
                <th className="num">Miles</th>
                <th className="num">Avg W</th>
                <th className="num">NP</th>
                <th className="num">Load</th>
              </tr>
            </thead>
            <tbody>
              {r.recent_rides.map((a, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtLong(a.date)}</td>
                  <td>{a.name}</td>
                  <td>{a.type}</td>
                  <td className="num">{h1(a.hours)}</td>
                  <td className="num">{a.miles?.toFixed(1) ?? dash}</td>
                  <td className="num">{a.avg_watts ?? dash}</td>
                  <td className="num">{a.np ?? dash}</td>
                  <td className="num">{a.load ?? dash}</td>
                </tr>
              ))}
              {!r.recent_rides.length && (
                <tr>
                  <td colSpan={8} className="muted">
                    No rides or runs yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="tiny muted">Form zones: {FORM_ZONES.map((z) => z.label).join(' · ')}.</p>
    </div>
  );
}
