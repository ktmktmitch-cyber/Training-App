import { useEffect, useState } from 'react';
import { Icon } from './components/ui';
import { AppProvider, useApp } from './lib/store';
import { GuidePage } from './pages/GuidePage';
import { SeasonPage } from './pages/SeasonPage';
import { SettingsPage } from './pages/SettingsPage';
import { StrengthPage } from './pages/StrengthPage';
import { TrendsPage } from './pages/TrendsPage';
import { WeekPage } from './pages/WeekPage';

const ROUTES = [
  { id: 'week', label: 'Week', icon: 'week' as const, el: <WeekPage /> },
  { id: 'season', label: 'Season', icon: 'season' as const, el: <SeasonPage /> },
  { id: 'trends', label: 'Trends', icon: 'trends' as const, el: <TrendsPage /> },
  { id: 'strength', label: 'Strength', icon: 'strength' as const, el: <StrengthPage /> },
  { id: 'settings', label: 'Settings', icon: 'settings' as const, el: <SettingsPage /> },
  { id: 'guide', label: 'Guide', icon: 'guide' as const, el: <GuidePage /> },
];

function useRoute() {
  const get = () => (window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'week').split('/')[0];
  const [r, setR] = useState(get);
  useEffect(() => {
    const f = () => {
      setR(get());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return r;
}

function Shell() {
  const route = useRoute();
  const app = useApp();
  const current = ROUTES.find((x) => x.id === route) ?? ROUTES[0];
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/week" style={{ color: 'inherit', textDecoration: 'none' }}>
            <span className="brand-mark" style={{ color: '#fff' }}>
              <Icon name="bolt" size={15} />
            </span>
            Training App
          </a>
          <nav className="nav" aria-label="Main">
            {ROUTES.map((x) => (
              <a key={x.id} href={`#/${x.id}`} className={x.id === current.id ? 'active' : ''}>
                {x.label}
              </a>
            ))}
          </nav>
          <div className="topbar-status row">
            {app.settings.demo ? (
              <a className="chip" href="#/settings" style={{ textDecoration: 'none' }}>
                Demo data
              </a>
            ) : (
              <button className="btn sm ghost" onClick={() => app.sync().catch(() => {})} disabled={app.syncing} title="Sync from intervals.icu">
                <Icon name="sync" size={15} />
                {app.syncing ? 'Syncing…' : ''}
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="main">{current.el}</main>
      <nav className="bottom-nav" aria-label="Main">
        {ROUTES.filter((x) => x.id !== 'guide').map((x) => (
          <a key={x.id} href={`#/${x.id}`} className={x.id === current.id ? 'active' : ''}>
            <Icon name={x.icon} size={20} />
            {x.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
