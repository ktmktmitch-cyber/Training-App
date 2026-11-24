import { useApp } from '../lib/store';

function ago(iso: string | null): string {
  if (!iso) return '';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(iso).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
}

/** Settings → sync across devices through a hidden note on your intervals.icu calendar. */
export function CloudSyncCard() {
  const app = useApp();
  const c = app.cloud;
  const enabled = app.settings.cloudSync !== false;
  if (app.account) return null; // signed-in accounts already sync through the server
  return (
    <div className="card stack">
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>Sync across devices</h2>
        <span className={`chip ${c.state === 'on' ? 'on' : ''}`}>
          {c.state === 'off' ? (enabled ? 'Connect intervals.icu to turn on' : 'Off') : c.state === 'syncing' ? 'Syncing…' : c.state === 'error' ? 'Problem' : `On · saved ${ago(c.at)}`}
        </span>
      </div>
      <p className="small ink2">
        Your settings, races, rest and away weeks, journal, check-ins, week edits and library picks are kept in one hidden note on your intervals.icu calendar (dated 31 Dec 2099), so any phone or computer where you enter your API key picks them up automatically. Your API key itself is never stored there. Races also appear on your intervals.icu calendar as A/B/C races.
      </p>
      {c.error && <div className="callout warn">Couldn’t sync: {c.error}</div>}
      <div className="row">
        <label className="check small">
          <input type="checkbox" checked={enabled} onChange={(e) => app.updateSettings((s) => ({ ...s, cloudSync: e.target.checked }))} />
          <span>Sync this device</span>
        </label>
        <span className="spacer" />
        <button className="btn sm" disabled={c.state === 'off' || c.state === 'syncing'} onClick={() => app.cloudSyncNow()}>
          Sync settings now
        </button>
      </div>
      <p className="tiny muted">If two devices change different things, both are kept; if they change the same thing, the most recent change wins.</p>
    </div>
  );
}
