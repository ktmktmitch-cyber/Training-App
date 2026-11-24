import { useEffect, useRef } from 'react';
import { fmtMinutes } from '../engine/dates';
import type { DayConfig, GroupIntensity } from '../engine/types';
import { useApp } from '../lib/store';
import { SecondSessionSelect } from './SecondSessionSelect';
import { Seg } from './ui';

const DAYS: [number, string][] = [
  [1, 'Monday'],
  [2, 'Tuesday'],
  [3, 'Wednesday'],
  [4, 'Thursday'],
  [5, 'Friday'],
  [6, 'Saturday'],
  [0, 'Sunday'],
];
const CAPS = [null, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360];
type Kind = 'available' | 'off' | 'group';

/** Settings → your usual week: hours, days you can't train, regular group rides, time caps. New weeks start from this. */
export function UsualWeekCard({ onToast }: { onToast: (m: string) => void }) {
  const app = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const days = app.settings.usualDays;
  const set = (dow: number, c: DayConfig | null) =>
    app.updateSettings((s) => {
      const u = { ...s.usualDays };
      if (c && !(c.status === 'available' && c.maxMinutes == null && !c.noLift && !c.second)) u[dow] = c;
      else delete u[dow];
      return { ...s, usualDays: u };
    });

  // Arrived from the Week page's "Edit usual week" button: scroll here
  useEffect(() => {
    try {
      if (sessionStorage.getItem('ta.scrollTo') === 'usual-week') {
        sessionStorage.removeItem('ta.scrollTo');
        setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      }
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="card stack" id="usual-week" ref={ref}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>Your usual week</h2>
        <span className="tiny muted">Every new week starts from this. Change a single week on the Week page.</span>
      </div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '0 1 160px' }}>
          <span>Hours available</span>
          <input
            className="input num"
            type="number"
            min={1}
            max={30}
            step={0.5}
            value={app.settings.usualHours}
            onChange={(e) => app.updateSettings((s) => ({ ...s, usualHours: Math.max(1, Math.min(30, Number(e.target.value) || 1)) }))}
            aria-label="Usual hours per week"
          />
        </label>
        <input type="range" style={{ flex: '1 1 200px' }} min={2} max={25} step={0.5} value={app.settings.usualHours} onChange={(e) => app.updateSettings((s) => ({ ...s, usualHours: Number(e.target.value) }))} aria-label="Usual hours slider" />
      </div>
      <div className="usual-days">
        {DAYS.map(([dow, name]) => {
          const c: DayConfig = days[dow] ?? { status: 'available', maxMinutes: null };
          const kind: Kind = c.status === 'off' ? 'off' : c.status === 'group' ? 'group' : 'available';
          return (
            <div key={dow} className="usual-day">
              <b className="small">{name}</b>
              <Seg<Kind>
                value={kind}
                onChange={(v) =>
                  set(dow, v === 'group' ? { status: 'group', maxMinutes: null, group: c.group ?? { durationMin: 120, intensity: 'hard' } } : v === 'off' ? { status: 'off', maxMinutes: null } : { status: 'available', maxMinutes: c.maxMinutes ?? null, noLift: c.noLift })
                }
                ariaLabel={`${name} usually`}
                options={[
                  { value: 'available', label: 'Train' },
                  { value: 'off', label: 'Can’t train' },
                  { value: 'group', label: 'Group ride' },
                ]}
              />
              {kind === 'available' && (
                <div className="row" style={{ gap: 8 }}>
                <label className="field inline">
                  <span>Max</span>
                  <select className="select" value={c.maxMinutes ?? ''} onChange={(e) => set(dow, { ...c, status: 'available', maxMinutes: e.target.value ? Number(e.target.value) : null })} aria-label={`${name} max time`}>
                    {CAPS.map((m) => (
                      <option key={String(m)} value={m ?? ''}>
                        {m == null ? 'Flexible' : fmtMinutes(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <SecondSessionSelect c={c} onChange={(patch) => set(dow, { ...c, status: 'available', ...patch })} label={`${name} second session`} />
                </div>
              )}
              {kind === 'group' && c.group && (
                <div className="row" style={{ gap: 6 }}>
                  <input className="input" style={{ maxWidth: 170 }} placeholder="Ride name" value={c.group.name ?? ''} onChange={(e) => set(dow, { ...c, group: { ...c.group!, name: e.target.value } })} aria-label={`${name} group ride name`} />
                  <select className="select" style={{ maxWidth: 110 }} value={c.group.durationMin} onChange={(e) => set(dow, { ...c, group: { ...c.group!, durationMin: Number(e.target.value) } })} aria-label={`${name} group ride length`}>
                    {[45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300].map((m) => (
                      <option key={m} value={m}>
                        {fmtMinutes(m)}
                      </option>
                    ))}
                  </select>
                  <Seg<GroupIntensity>
                    value={c.group.intensity}
                    onChange={(v) => set(dow, { ...c, group: { ...c.group!, intensity: v } })}
                    ariaLabel={`${name} group ride intensity`}
                    options={[
                      { value: 'social', label: 'Social' },
                      { value: 'tempo', label: 'Steady' },
                      { value: 'hard', label: 'Hard' },
                      { value: 'race', label: 'Race' },
                    ]}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="row">
        <button
          className="btn sm"
          onClick={() => {
            app.resetWeek();
            onToast('This week now matches your usual week.');
          }}
        >
          Apply to this week too
        </button>
        <span className="tiny muted">Changes here apply to weeks you haven’t edited yet; use this to reset the current week to your usual one.</span>
      </div>
    </div>
  );
}
