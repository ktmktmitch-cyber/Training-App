import { diffDays } from '../engine/dates';
import { useApp } from '../lib/store';

/** Shown on data pages before intervals.icu is connected. */
export function ConnectPrompt({ what = 'your plan and data' }: { what?: string }) {
  const app = useApp();
  return (
    <div className="card stack connect-prompt">
      <h2 style={{ margin: 0 }}>Connect intervals.icu to see {what}</h2>
      <ol className="small ink2" style={{ margin: 0, paddingLeft: '1.2em' }}>
        <li>
          In <a href="https://intervals.icu/settings" target="_blank" rel="noreferrer">intervals.icu → Settings → Developer settings</a>, copy your <b>API key</b> and <b>athlete ID</b> (like i123456).
        </li>
        <li>Paste them in Settings here and press Sync.</li>
        <li>For HRV, resting HR and sleep, connect Garmin (or Oura, Whoop, Polar, Coros…) to intervals.icu and turn on wellness download.</li>
      </ol>
      <div>
        <a className="btn primary" href="#/settings" onClick={() => setTimeout(() => document.getElementById('connect')?.scrollIntoView({ behavior: 'smooth' }), 200)}>
          {app.syncing ? 'Syncing…' : 'Connect intervals.icu'}
        </a>
      </div>
    </div>
  );
}

export interface DataGaps {
  power: boolean;
  hr: boolean;
  hrv: boolean;
  rhr: boolean;
  sleep: boolean;
  stravaHidden: number;
  any: boolean;
}

/** What's missing from the athlete's data (last ~6 weeks), so pages can say what to connect. */
export function useDataGaps(): DataGaps {
  const { data, asOf } = useApp();
  const recentActs = data.activities.filter((a) => diffDays(asOf, a.date) <= 42);
  const recentWell = data.wellness.filter((w) => diffDays(asOf, w.date) <= 21);
  const endurance = recentActs.filter((a) => !a.isStrength);
  const g = {
    power: endurance.length > 0 && !endurance.some((a) => a.normalizedPower),
    hr: endurance.length > 0 && !endurance.some((a) => a.avgHr),
    hrv: !recentWell.some((w) => w.hrv),
    rhr: !recentWell.some((w) => w.rhr),
    sleep: !recentWell.some((w) => w.sleepSec),
    stravaHidden: recentActs.filter((a) => a.limited).length,
  };
  return { ...g, any: g.power || g.hr || g.hrv || g.rhr || g.sleep || g.stravaHidden > 0 };
}

const WELLNESS_HOW = 'Connect Garmin (or Oura, Whoop, Polar, Coros, Apple Health via a sync app) to intervals.icu and turn on wellness download in intervals.icu → Settings → Connections.';

/** Explain missing data and how to get it. `only` limits which gaps a page cares about. */
export function DataGapNotes({ only }: { only?: (keyof Omit<DataGaps, 'any'>)[] }) {
  const app = useApp();
  const g = useDataGaps();
  if (app.data.source !== 'intervals') return null;
  const want = (k: keyof Omit<DataGaps, 'any'>) => !only || only.includes(k);
  const wellness = [want('hrv') && g.hrv && 'HRV', want('rhr') && g.rhr && 'resting HR', want('sleep') && g.sleep && 'sleep'].filter(Boolean) as string[];
  const notes: string[] = [];
  if (wellness.length) notes.push(`No ${wellness.join(', ')} data — ${WELLNESS_HOW} Readiness uses ${wellness.length === 3 ? 'training load only' : 'what’s available'} until then.`);
  if (want('power') && g.power) notes.push('No power data on recent rides — ride with a power meter or smart trainer to get FTP estimates, the power profile and watt targets. Heart rate is used meanwhile.');
  if (want('hr') && g.hr) notes.push('No heart-rate data on recent sessions — wear a chest strap or watch for heat/indoor effects, efficiency and heart-rate targets.');
  if (want('stravaHidden') && g.stravaHidden) notes.push(`${g.stravaHidden} recent activit${g.stravaHidden === 1 ? 'y came' : 'ies came'} from Strava, which intervals.icu hides from apps — connect Garmin, Wahoo or Zwift directly to intervals.icu.`);
  if (!notes.length) return null;
  return (
    <div className="callout stack" style={{ gap: 4 }}>
      {notes.map((n, i) => (
        <span key={i} className="small">
          {n}
        </span>
      ))}
    </div>
  );
}

/** Renders the page once intervals.icu data is there; otherwise the connect prompt. */
export function RequireData({ children, title, what }: { children: React.ReactNode; title: string; what: string }) {
  const app = useApp();
  if (app.data.source === 'intervals') return <>{children}</>;
  return (
    <>
      <h1>{title}</h1>
      <ConnectPrompt what={what} />
    </>
  );
}
