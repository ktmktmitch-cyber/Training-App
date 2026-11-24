import { useEffect, useState } from 'react';
import type { PlannerPrefs, TargetMode } from '../engine/types';
import { SportCard } from '../components/SportCard';
import { Field, Seg, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useApp } from '../lib/store';
import { stravaDisconnect } from '../lib/strava';
import { remove } from '../lib/storage';
import { DEFAULT_TEAM_URL } from '../lib/team';

export function SettingsPage() {
  const app = useApp();
  const auth = useAuth();
  const { settings, server, strava, data } = app;
  const [newKey, setNewKey] = useState('');
  const c = settings.connection;
  const [toast, showToast] = useToast();
  const [testing, setTesting] = useState(false);
  const setConn = (patch: Partial<typeof c>) => app.updateSettings((s) => ({ ...s, connection: { ...s.connection, ...patch } }));
  const setPrefs = (patch: Partial<PlannerPrefs>) => app.updateSettings((s) => ({ ...s, prefs: { ...s.prefs, ...patch } }));

  useEffect(() => {
    const q = window.location.hash.split('?')[1];
    const st = q ? new URLSearchParams(q).get('strava') : null;
    if (st === 'connected') showToast('Strava connected.');
    if (st === 'error' || st === 'denied') showToast('Strava connection was not completed.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doTest = async () => {
    setTesting(true);
    try {
      const name = await app.test();
      showToast(`Connected to intervals.icu as ${name}.`);
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setTesting(false);
    }
  };
  const doSync = async () => {
    try {
      await app.sync();
      showToast('Synced from intervals.icu.');
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  const exportSettings = () => {
    const blob = new Blob([JSON.stringify({ ...settings, connection: { ...settings.connection, apiKey: '', appPassword: '' } }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'training-app-settings.json';
    a.click();
  };
  const importSettings = (file: File) => {
    file.text().then((t) => {
      try {
        const j = JSON.parse(t);
        app.updateSettings((s) => ({ ...s, ...j, connection: { ...s.connection } }));
        showToast('Settings imported.');
      } catch {
        showToast('That file is not valid settings JSON.');
      }
    });
  };

  return (
    <>
      <h1>Settings</h1>
      <SportCard />

      {app.account && (
        <div className="card stack">
          <div className="card-head" style={{ marginBottom: 0 }}>
            <h2>Your account</h2>
            <span className="chip">{{ idle: 'Synced', saving: 'Saving…', saved: 'Saved to your account', error: 'Couldn’t save — will retry' }[auth.syncState]}</span>
          </div>
          <p className="small ink2">
            Signed in as <b>{app.account.name}</b> ({app.account.id}) with your intervals.icu {app.account.authType === 'oauth' ? 'login' : 'API key'} · {app.account.role === 'coach' ? 'coach' : 'athlete'}.
            Your plan, availability, journal and settings are saved to your account and follow you to any device. Your intervals.icu credential is stored encrypted on this server and is never sent back to the browser.
          </p>
          {app.account.authType === 'apikey' && (
            <div className="row">
              <input className="input" type="password" style={{ flex: '1 1 220px' }} placeholder="New intervals.icu API key (if you regenerated it)" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
              <button
                className="btn sm"
                disabled={newKey.trim().length < 10}
                onClick={() =>
                  auth
                    .loginWithKey(newKey)
                    .then(() => {
                      setNewKey('');
                      showToast('API key updated.');
                    })
                    .catch((e) => showToast((e as Error).message))
                }
              >
                Update key
              </button>
            </div>
          )}
          <div className="row">
            <button className="btn sm" onClick={() => auth.logout()}>
              Log out
            </button>
            <button className="btn sm ghost" onClick={() => auth.logout(true)}>
              Log out on all devices
            </button>
            <button
              className="btn sm ghost"
              onClick={() => {
                if (confirm('Delete your account and everything saved with it on this server? Your intervals.icu data is not affected.')) auth.deleteAccount().catch((e) => showToast((e as Error).message));
              }}
            >
              Delete my account
            </button>
          </div>
        </div>
      )}
      {app.guest && (
        <div className="callout">
          You’re exploring the demo. <button className="link-btn" onClick={() => auth.setGuest(false)}>Log in with your intervals.icu account</button> to see your own plan and numbers.
        </div>
      )}

      <div className="card stack-lg">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <h2>intervals.icu</h2>
          <span className="chip">{data.source === 'intervals' ? `Synced ${data.lastSync ? new Date(data.lastSync).toLocaleString() : ''}` : settings.demo ? 'Using demo data' : 'Not synced'}</span>
        </div>
        <p className="small ink2">
          intervals.icu is the hub: it receives activities and wellness (HRV, resting HR, sleep) from Garmin, and sends planned workouts back to your Garmin calendar. Find your API key and athlete ID in intervals.icu → Settings → Developer Settings.
        </p>
        {!app.account && (
        <>
        <div className="grid-2">
          <Field label="API key" hint={server?.serverIcuKey ? 'The server already has a key (.env) — you can leave this empty.' : 'Stored only in this browser.'}>
            <input className="input" type="password" autoComplete="off" value={c.apiKey} onChange={(e) => setConn({ apiKey: e.target.value })} placeholder="intervals.icu API key" />
          </Field>
          <Field label="Athlete ID" hint="Looks like i12345. Leave empty to use the key owner.">
            <input className="input" value={c.athleteId} onChange={(e) => setConn({ athleteId: e.target.value })} placeholder={server?.serverAthleteId ?? 'i12345'} />
          </Field>
        </div>
        {server?.authRequired && (
          <Field label="Server password" hint={server.authed ? 'Accepted.' : 'This server is password-protected (APP_PASSWORD).'}>
            <input className="input" type="password" value={c.appPassword} onChange={(e) => setConn({ appPassword: e.target.value })} />
          </Field>
        )}
        <div className="row">
          <span className="small" style={{ fontWeight: 600 }}>
            Connection
          </span>
          <Seg<'auto' | 'proxy' | 'direct'>
            value={c.mode}
            onChange={(v) => setConn({ mode: v })}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'proxy', label: 'Via this server' },
              { value: 'direct', label: 'Direct from browser' },
            ]}
          />
          <span className="tiny muted">{server ? 'Bundled server detected — requests go through it.' : 'No server detected — calling intervals.icu directly.'}</span>
        </div>
        </>
        )}
        <div className="row">
          <button className="btn" onClick={doTest} disabled={testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <button className="btn primary" onClick={doSync} disabled={app.syncing}>
            {app.syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <label className="check small" style={{ marginLeft: 'auto' }}>
            <input type="checkbox" checked={settings.demo} onChange={(e) => app.updateSettings((s) => ({ ...s, demo: e.target.checked }))} />
            <span>Use demo data</span>
          </label>
        </div>
        {app.syncError && <div className="callout bad">{app.syncError}</div>}
        {data.source === 'intervals' && (
          <p className="tiny muted">
            {data.activities.length} activities · {data.wellness.filter((w) => w.hrv).length} days with HRV · {data.events.length} calendar events · FTP {app.ftp} W
          </p>
        )}
      </div>

      <div className="card stack">
        <h2>Team (coach view)</h2>
        <p className="small ink2">
          The Team tab reads <code>data/team.json</code> from your team-dashboard repository, which its GitHub Action rebuilds every few hours from your coach account. With your intervals.icu (coach) key added above, the Team tab can also pull each rider’s wellness and activities for load buckets, readiness and Garmin VO2max.
        </p>
        <p className="small ink2">
          Everyone who uses this app sees the same team standings, read from the team dashboard (<code>{DEFAULT_TEAM_URL.replace('https://raw.githubusercontent.com/', '')}</code>).
        </p>
      </div>

      <div className="card stack">
        <h2>Garmin</h2>
        <p className="small ink2">
          Garmin’s API is only open to approved businesses, so this app connects to Garmin through intervals.icu (which is an official Garmin partner). In intervals.icu → Settings → Garmin, turn on <b>Sync activities</b>, <b>Download wellness</b> (HRV, resting HR, sleep) and <b>Upload planned workouts</b>. Workouts you send from this app then appear on your Garmin calendar and on your device as structured workouts.
        </p>
      </div>

      <div className="card stack">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <h2>Strava (optional)</h2>
          {strava?.connected && <span className="chip">Connected{strava.athlete?.name ? ` · ${strava.athlete.name}` : ''}</span>}
        </div>
        <p className="small ink2">
          Only needed if some rides reach intervals.icu via Strava (Strava’s API terms stop intervals.icu from sharing those with other apps). If your Garmin syncs straight to intervals.icu you can skip this.
        </p>
        {server?.strava ? (
          <div className="row">
            {strava?.connected ? (
              <>
                <label className="check small">
                  <input type="checkbox" checked={c.useStrava} onChange={(e) => setConn({ useStrava: e.target.checked })} />
                  <span>Use Strava to fill gaps when syncing</span>
                </label>
                <button
                  className="btn sm ghost"
                  onClick={() =>
                    stravaDisconnect(c.appPassword || undefined).then(() => {
                      showToast('Strava disconnected.');
                      setTimeout(() => window.location.reload(), 800);
                    })
                  }
                >
                  Disconnect
                </button>
              </>
            ) : (
              <a className="btn" href="api/strava/login">
                Connect Strava
              </a>
            )}
          </div>
        ) : (
          <p className="tiny muted">To enable: create an API app at strava.com/settings/api, put STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET in the server’s .env and restart (see README).</p>
        )}
      </div>

      <div className="card stack-lg">
        <h2>Training preferences</h2>
        <div className="grid-2">
          <div className="stack">
            <h3>Long ride day</h3>
            <Seg<PlannerPrefs['longRideDay']>
              value={settings.prefs.longRideDay}
              onChange={(v) => setPrefs({ longRideDay: v })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'sat', label: 'Saturday' },
                { value: 'sun', label: 'Sunday' },
              ]}
            />
          </div>
          <div className="stack">
            <h3>Minimum rest days / week</h3>
            <Seg<0 | 1 | 2>
              value={settings.prefs.minRestDays}
              onChange={(v) => setPrefs({ minRestDays: v })}
              options={[
                { value: 0, label: '0' },
                { value: 1, label: '1' },
                { value: 2, label: '2' },
              ]}
            />
          </div>
          <div className="stack">
            <h3>Workout targets</h3>
            <Seg<TargetMode>
              value={settings.prefs.targetMode}
              onChange={(v) => setPrefs({ targetMode: v })}
              options={[
                { value: 'power', label: 'Power (% FTP)' },
                { value: 'hr', label: 'Heart rate' },
              ]}
            />
          </div>
          <Field label="Max fitness ramp (CTL / week)" hint="5-8 is a common sustainable range. Lower = safer.">
            <input className="input num" type="number" min={2} max={12} step={0.5} value={settings.prefs.maxRampPerWeek} onChange={(e) => setPrefs({ maxRampPerWeek: Number(e.target.value) || 6 })} />
          </Field>
          <Field label="FTP override (W)" hint={`From intervals.icu: ${app.data.profile?.ftp ?? '—'} W${app.data.profile?.eftp ? ` · eFTP ${Math.round(app.data.profile.eftp)} W` : ''}`}>
            <input
              className="input num"
              type="number"
              min={80}
              max={600}
              value={settings.ftpOverride ?? ''}
              placeholder="use intervals.icu"
              onChange={(e) => app.updateSettings((s) => ({ ...s, ftpOverride: e.target.value ? Number(e.target.value) : null }))}
            />
          </Field>
        </div>
      </div>

      <div className="card stack">
        <h2>Data</h2>
        <div className="row">
          <button className="btn sm" onClick={exportSettings}>
            Export settings
          </button>
          <label className="btn sm">
            Import settings
            <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importSettings(e.target.files[0])} />
          </label>
          <button
            className="btn sm ghost"
            onClick={() => {
              if (!confirm('Reset all settings, weeks and cached data in this browser?')) return;
              ['ta.settings.v1', 'ta.weeks.v1', 'ta.checkins.v1', 'ta.data.v1', 'ta.feedback.v1', 'ta.history.v1', 'ta.journal.v1', 'ta.scheduled.v1', 'ta.team.v1', 'ta.team.v1.at', 'ta.teamdeep.v1'].forEach(remove);
              window.location.reload();
            }}
          >
            Reset everything
          </button>
        </div>
        <p className="tiny muted">Everything is stored in this browser only. Exported settings never include your API key.</p>
      </div>
      {toast}
    </>
  );
}
