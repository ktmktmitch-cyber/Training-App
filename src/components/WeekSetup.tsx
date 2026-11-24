import { addDays, dowShort, fmtMinutes, fromISO, range } from '../engine/dates';
import type { DayConfig, DayStatus, GroupIntensity, ISODate, WeekConfig } from '../engine/types';
import { WORKOUTS } from '../engine/workouts';
import { SecondSessionSelect } from './SecondSessionSelect';
import { useApp } from '../lib/store';
import { Seg } from './ui';

const CAPS = [null, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360];

export function WeekSetup({ week, onChange, onSaveUsual, onResetUsual }: { week: WeekConfig; onChange: (w: WeekConfig) => void; onSaveUsual: () => void; onResetUsual: () => void }) {
  const app = useApp();
  const days = range(week.startDate, 7);
  const get = (d: ISODate): DayConfig => week.days[d] ?? { status: 'available', maxMinutes: null };
  const set = (d: ISODate, patch: Partial<DayConfig>) => onChange({ ...week, days: { ...week.days, [d]: { ...get(d), ...patch } } });

  const setStatus = (d: ISODate, status: DayStatus) => {
    const c = get(d);
    const patch: Partial<DayConfig> = { status };
    if (status === 'group' && !c.group) patch.group = { durationMin: 120, intensity: 'hard' };
    if (status === 'pinned' && !c.pinned) patch.pinned = { workoutId: 'sweetspot', durationMin: 75 };
    if (status === 'race' && !c.race) patch.race = { name: 'Race', durationMin: 120, priority: 'B' };
    set(d, patch);
  };

  return (
    <div className="stack-lg">
      <div className="stack">
        <div className="row">
          <div>
            <div className="tiny muted" style={{ fontWeight: 600 }}>
              Hours available {fromISO(week.startDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {fromISO(addDays(week.startDate, 6)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </div>
            <div className="hours-big num">{week.hours} h</div>
          </div>
          <span className="spacer" />
          <input
            className="input num"
            style={{ width: 90 }}
            type="number"
            min={1}
            max={30}
            step={0.5}
            value={week.hours}
            onChange={(e) => onChange({ ...week, hours: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })}
            aria-label="Hours available"
          />
        </div>
        <input type="range" min={2} max={25} step={0.5} value={week.hours} onChange={(e) => onChange({ ...week, hours: Number(e.target.value) })} aria-label="Hours available slider" />
        <p className="tiny muted">The planner uses up to this much — less in recovery/taper weeks or when your recovery markers are down.</p>
      </div>

      <div className="setup-days">
        {days.map((d) => {
          const c = get(d);
          return (
            <div className="setup-day" key={d}>
              <div className="label">
                {dowShort(d)} {fromISO(d).getDate()}
                {(() => {
                  const ev = c.status === 'available' && !c.skipCalendar ? app.events.find((e) => e.date === d && e.category === 'WORKOUT' && !(e.externalId ?? '').startsWith('trainingapp-')) : undefined;
                  const moved = Object.entries(week.days).find(([, x]) => x.status === 'pinned' && x.pinned?.fromCoach && x.pinned.movedFrom === d);
                  const tag = ev ? ((ev.externalId ?? '').startsWith('tacoach-') ? 'From your coach' : 'On your calendar') : c.status === 'pinned' && c.pinned?.fromCoach ? 'From your coach (moved here)' : null;
                  return tag || moved ? (
                    <div className="tiny" style={{ fontWeight: 400 }}>
                      {tag && (
                        <span className={tag.startsWith('From your coach') ? 'coach-note' : 'muted'} style={{ display: 'inline-block' }}>
                          {tag}
                          {ev ? `: ${ev.name}` : ''}
                        </span>
                      )}
                      {moved && <span className="muted">Coach’s workout moved to {dowShort(moved[0])}</span>}
                    </div>
                  ) : null;
                })()}
              </div>
              <div className="controls">
                <Seg<DayStatus>
                  value={c.status}
                  onChange={(v) => setStatus(d, v)}
                  ariaLabel={`${dowShort(d)} plan`}
                  options={[
                    { value: 'available', label: 'Auto' },
                    { value: 'off', label: 'Can’t train' },
                    { value: 'group', label: 'Group ride' },
                    { value: 'pinned', label: 'Pick workout' },
                    { value: 'race', label: 'Race' },
                  ]}
                />
                {c.status !== 'off' && (
                  <div className="setup-extra">
                    {c.status === 'available' && (
                      <label className="field">
                        <span>Max time</span>
                        <select className="select" value={c.maxMinutes ?? ''} onChange={(e) => set(d, { maxMinutes: e.target.value ? Number(e.target.value) : null })}>
                          {CAPS.map((m) => (
                            <option key={String(m)} value={m ?? ''}>
                              {m == null ? 'Flexible' : fmtMinutes(m)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {c.status === 'group' && c.group && (
                      <>
                        <label className="field">
                          <span>Name</span>
                          <input className="input" placeholder="Saturday shop ride" value={c.group.name ?? ''} onChange={(e) => set(d, { group: { ...c.group!, name: e.target.value } })} />
                        </label>
                        <label className="field" style={{ flex: '0 1 110px' }}>
                          <span>Duration</span>
                          <select className="select" value={c.group.durationMin} onChange={(e) => set(d, { group: { ...c.group!, durationMin: Number(e.target.value) } })}>
                            {[45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300].map((m) => (
                              <option key={m} value={m}>
                                {fmtMinutes(m)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="field">
                          <span>How hard is it usually?</span>
                          <Seg<GroupIntensity>
                            value={c.group.intensity}
                            onChange={(v) => set(d, { group: { ...c.group!, intensity: v } })}
                            options={[
                              { value: 'social', label: 'Social' },
                              { value: 'tempo', label: 'Steady' },
                              { value: 'hard', label: 'Hard' },
                              { value: 'race', label: 'Race pace' },
                            ]}
                          />
                        </div>
                      </>
                    )}
                    {c.status === 'pinned' && c.pinned && (
                      <>
                        <label className="field">
                          <span>Workout</span>
                          <select className="select" value={c.pinned.workoutId} onChange={(e) => set(d, { pinned: { ...c.pinned!, workoutId: e.target.value } })}>
                            {WORKOUTS.map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field" style={{ flex: '0 1 110px' }}>
                          <span>Minutes</span>
                          <input className="input num" type="number" min={20} max={420} step={5} value={c.pinned.durationMin} onChange={(e) => set(d, { pinned: { ...c.pinned!, durationMin: Number(e.target.value) } })} />
                        </label>
                      </>
                    )}
                    {c.status === 'race' && c.race && (
                      <>
                        <label className="field">
                          <span>Event</span>
                          <input className="input" value={c.race.name} onChange={(e) => set(d, { race: { ...c.race!, name: e.target.value } })} />
                        </label>
                        <label className="field" style={{ flex: '0 1 110px' }}>
                          <span>Duration</span>
                          <select className="select" value={c.race.durationMin} onChange={(e) => set(d, { race: { ...c.race!, durationMin: Number(e.target.value) } })}>
                            {[30, 45, 60, 90, 120, 180, 240, 300, 360, 480].map((m) => (
                              <option key={m} value={m}>
                                {fmtMinutes(m)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="field">
                          <span>Priority</span>
                          <Seg<'A' | 'B' | 'C'>
                            value={c.race.priority}
                            onChange={(v) => set(d, { race: { ...c.race!, priority: v } })}
                            options={[
                              { value: 'A', label: 'A' },
                              { value: 'B', label: 'B' },
                              { value: 'C', label: 'C' },
                            ]}
                          />
                        </div>
                      </>
                    )}
                    <SecondSessionSelect c={c} onChange={(patch) => set(d, patch)} label={`${dowShort(d)} second session`} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="row">
        <button className="btn sm" onClick={onSaveUsual}>
          Save as my usual week
        </button>
        <button className="btn sm ghost" onClick={onResetUsual}>
          Reset to usual
        </button>
        <span className="tiny muted">Your usual week (hours, blocked days, group rides, time caps) pre-fills every new week.</span>
      </div>
    </div>
  );
}
