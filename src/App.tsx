import { useEffect, useState } from 'react';
import { Icon } from './components/ui';
import { AppProvider, useApp } from './lib/store';
import { GuidePage } from './pages/GuidePage';
import { LibraryPage } from './pages/LibraryPage';
import { SeasonPage } from './pages/SeasonPage';
import { SettingsPage } from './pages/SettingsPage';
import { StrengthPage } from './pages/StrengthPage';
import { TrendsPage } from './pages/TrendsPage';
import { WeekPage } from './pages/WeekPage';

function MorePage() {
  return (
    <>
      <h1>More</h1>
      <div className="more-links">
        {[
          { id: 'strength', label: 'Strength', icon: 'strength' as const },
          { id: 'settings', label: 'Settings', icon: 'settings' as const },
          { id: 'guide', label: 'Guide & science', icon: 'guide' as const },
        ].map((x) => (
          <a key={x.id} className="card" href={`#/${x.id}`}>
            <Icon name={x.icon} size={20} />
            {x.label}
          </a>
        ))}
      </div>
    </>
  );
}

const ROUTES = [
  { id: 'week', label: 'Week', icon: 'week' as const, el: <WeekPage />, mobile: true },
  { id: 'season', label: 'Season', icon: 'season' as const, el: <SeasonPage />, mobile: true },
  { id: 'library', label: 'Library', icon: 'library' as const, el: <LibraryPage />, mobile: true },
  { id: 'progress', label: 'Progress', icon: 'trends' as const, el: <TrendsPage />, mobile: true },
  { id: 'strength', label: 'Strength', icon: 'strength' as const, el: <StrengthPage />, mobile: false },
  { id: 'settings', label: 'Settings', icon: 'settings' as const, el: <SettingsPage />, mobile: false },
  { id: 'guide', label: 'Guide', icon: 'guide' as const, el: <GuidePage />, mobile: false },
  { id: 'more', label: 'More', icon: 'more' as const, el: <MorePage />, mobile: true, hidden: true },
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
  const current = ROUTES.find((x) => x.id === (route === 'trends' ? 'progress' : route)) ?? ROUTES[0];
  const moreActive = ['strength', 'settings', 'guide', 'more'].includes(current.id);
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
            {ROUTES.filter((x) => !x.hidden).map((x) => (
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
        {ROUTES.filter((x) => x.mobile).map((x) => (
          <a key={x.id} href={`#/${x.id}`} className={x.id === current.id || (x.id === 'more' && moreActive) ? 'active' : ''}>
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
