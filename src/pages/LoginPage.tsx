import { useState } from 'react';
import { Icon } from '../components/ui';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const auth = useAuth();
  const [key, setKey] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const q = window.location.hash.split('?')[1];
    const e = q ? new URLSearchParams(q).get('error') : null;
    return e === 'denied' ? 'intervals.icu login was cancelled.' : e ? 'intervals.icu login didn’t complete — please try again.' : null;
  });
  const needPw = auth.server?.authRequired && !auth.server.authed;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.loginWithKey(key);
      window.location.hash = '#/week';
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="card login-card stack-lg">
        <div className="row" style={{ gap: 10 }}>
          <span className="brand-mark" style={{ color: '#fff', width: 34, height: 34, borderRadius: 10 }}>
            <Icon name="bolt" size={18} />
          </span>
          <div>
            <h1 style={{ fontSize: 20 }}>Training App</h1>
            <span className="small muted">Your plan, your numbers — plus the team standings</span>
          </div>
        </div>

        {needPw ? (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              await auth.setSitePassword(pw);
            }}
          >
            <label className="field">
              <span>Team password</span>
              <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            </label>
            <button className="btn primary" type="submit">
              Continue
            </button>
          </form>
        ) : (
          <>
            {auth.server?.oauth && (
              <>
                <a className="btn primary" href="api/auth/oauth/start" style={{ textDecoration: 'none' }}>
                  Log in with intervals.icu
                </a>
                <div className="or">
                  <span>or use your API key</span>
                </div>
              </>
            )}
            <form className="stack" onSubmit={submit}>
              <label className="field">
                <span>intervals.icu API key</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="Paste your API key"
                  autoFocus={!auth.server?.oauth}
                />
                <span className="hint">
                  intervals.icu → Settings → Developer Settings → API Key. It proves which intervals.icu account is yours; it’s stored encrypted on this server and only used to read your training data and add workouts to your calendar.
                </span>
              </label>
              <button className={`btn ${auth.server?.oauth ? '' : 'primary'}`} type="submit" disabled={busy || key.trim().length < 10}>
                {busy ? 'Checking with intervals.icu…' : 'Log in'}
              </button>
            </form>
            {error && <div className="callout bad">{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}
