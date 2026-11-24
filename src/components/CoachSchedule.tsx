import { useEffect, useMemo, useState } from 'react';
import { addDays, fmtLong, fmtMinutes, fmtShort } from '../engine/dates';
import { workoutDescription } from '../engine/icuExport';
import { instantiate } from '../engine/planner';
import { targetsLabel, type ExportMode } from '../engine/targets';
import type { TeamRider } from '../engine/team';
import type { AthleteProfile, CalendarEvent, ISODate, WorkoutCategory } from '../engine/types';
import { WORKOUT_BY_ID, WORKOUTS } from '../engine/workouts';
import { COACH_PREFIX, fetchRiderCalendar, pushEvents } from '../lib/intervals';
import { useApp } from '../lib/store';
import { CATEGORY_LABEL, Seg } from './ui';

const CATS: WorkoutCategory[] = ['recovery', 'endurance', 'tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic', 'sprint', 'race_sim', 'durability', 'openers', 'test'];

function explain(e: Error, name: string): string {
  return /403|forbidden|permission/i.test(e.message)
    ? `${name} hasn’t added you as their coach on intervals.icu (or not with permission to edit their calendar). Ask them to add you under intervals.icu → Settings → Coaches.`
    : e.message;
}

/** Coach: put a library workout straight onto a teammate's intervals.icu calendar (→ their Garmin/Wahoo/Zwift and their plan in this app). */
export function CoachSchedule({ riders, onToast }: { riders: TeamRider[]; onToast: (m: string) => void }) {
  const app = useApp();
  const [riderId, setRiderId] = useState(riders[0]?.id ?? '');
  const rider = riders.find((r) => r.id === riderId) ?? riders[0];
  const [date, setDate] = useState<ISODate>(addDays(app.asOf, 1));
  const [templateId, setTemplateId] = useState('sweetspot');
  const t = WORKOUT_BY_ID[templateId];
  const [duration, setDuration] = useState(75);
  const [level, setLevel] = useState(2);
  const [mode, setMode] = useState<ExportMode>('power');
  const [ftp, setFtp] = useState('');
  const [lthr, setLthr] = useState('');
  const [note, setNote] = useState('');
  const [cal, setCal] = useState<{ profile: AthleteProfile; events: CalendarEvent[] } | null>(null);
  const [calErr, setCalErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!rider) return;
    setCal(null);
    setCalErr(null);
    fetchRiderCalendar(app.getConnection(), rider.id, app.asOf, addDays(app.asOf, 28))
      .then((c) => {
        setCal(c);
        setFtp(String(Math.round(c.profile.ftp ?? c.profile.eftp ?? rider.eftp_watts ?? 200)));
        setLthr(c.profile.lthr ? String(c.profile.lthr) : '');
      })
      .catch((e) => {
        setCalErr(explain(e as Error, rider.rider));
        setFtp(String(Math.round(rider.eftp_watts ?? 200)));
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [riderId]);

  const lvl = Math.min(level, (t?.levels ?? 1) - 1);
  const dur = t ? Math.max(t.minMin, Math.min(t.maxMin, duration)) : duration;
  const w = useMemo(() => (t ? instantiate(t, dur, lvl, cal?.profile.weightKg ?? null, undefined, []) : null), [t, dur, lvl, cal]);
  const targets = { mode, ftp: Number(ftp) || 0, lthr: Number(lthr) || null };
  const valid = mode === 'power' ? targets.ftp >= 50 && targets.ftp <= 700 : (targets.lthr ?? 0) >= 100 && (targets.lthr ?? 0) <= 220;

  const send = async () => {
    if (!w || !rider || !valid) return;
    setBusy(true);
    try {
      const desc = [note.trim() ? `Coach: ${note.trim()}` : '', workoutDescription(w, mode, { targets, icuLthr: cal?.profile.lthr ?? null })].filter(Boolean).join('\n\n');
      await pushEvents(
        { ...app.getConnection(), athleteId: rider.id },
        [
          {
            category: 'WORKOUT',
            start_date_local: `${date}T00:00:00`,
            type: 'Ride',
            name: w.name,
            description: desc,
            moving_time: Math.round(w.durationMin * 60),
            icu_training_load: w.tss,
            external_id: `${COACH_PREFIX}-${date}-${w.templateId}-${Date.now().toString(36)}`,
          },
        ],
        [],
      );
      onToast(`Scheduled “${w.name}” for ${rider.rider} on ${fmtShort(date)} (${targetsLabel(targets)}). It syncs to their devices and their plan works around it.`);
      load();
    } catch (e) {
      onToast(`Couldn’t schedule: ${explain(e as Error, rider.rider)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (e: CalendarEvent) => {
    if (!rider || !e.externalId) return;
    try {
      await pushEvents({ ...app.getConnection(), athleteId: rider.id }, [], [e.externalId]);
      onToast(`Removed “${e.name}” from ${rider.rider}’s calendar.`);
      load();
    } catch (err) {
      onToast(`Couldn’t remove: ${explain(err as Error, rider.rider)}`);
    }
  };

  if (!riders.length) return null;
  const upcoming = (cal?.events ?? []).filter((e) => ['WORKOUT', 'RACE_A', 'RACE_B', 'RACE_C', 'NOTE'].includes(e.category));

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 2 }}>
        <span className="small ink2">Puts a workout on a rider’s intervals.icu calendar. It syncs to their Garmin/Wahoo/Zwift, and their plan in this app builds the rest of the week around it.</span>
      </div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '1 1 160px' }}>
          <span>Rider</span>
          <select className="select" value={rider?.id} onChange={(e) => setRiderId(e.target.value)} aria-label="Rider">
            {riders.map((r) => (
              <option key={r.id} value={r.id}>
                {r.rider}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: '1 1 150px' }}>
          <span>Date</span>
          <input className="input" type="date" min={app.asOf} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Workout date" />
        </label>
        <label className="field" style={{ flex: '2 1 220px' }}>
          <span>Workout</span>
          <select className="select" value={templateId} onChange={(e) => { setTemplateId(e.target.value); const nt = WORKOUT_BY_ID[e.target.value]; setDuration(Math.max(nt.minMin, Math.min(nt.maxMin, duration))); }} aria-label="Workout">
            {CATS.map((c) => {
              const ws = WORKOUTS.filter((x) => x.category === c);
              return ws.length ? (
                <optgroup key={c} label={CATEGORY_LABEL[c]}>
                  {ws.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </label>
      </div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '0 1 120px' }}>
          <span>Minutes</span>
          <input className="input num" type="number" min={t?.minMin} max={t?.maxMin} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 0)} aria-label="Workout minutes" />
        </label>
        {t && t.levels > 1 && (
          <label className="field" style={{ flex: '1 1 160px' }}>
            <span>
              Level {lvl + 1} / {t.levels}
            </span>
            <input type="range" min={0} max={t.levels - 1} value={lvl} onChange={(e) => setLevel(Number(e.target.value))} aria-label="Workout level" />
          </label>
        )}
        <div className="field">
          <span>Targets</span>
          <Seg<ExportMode> value={mode} onChange={setMode} ariaLabel="Coach targets" options={[{ value: 'power', label: 'Power' }, { value: 'hr', label: 'Heart rate' }]} />
        </div>
        {mode === 'power' ? (
          <label className="field" style={{ flex: '0 1 120px' }}>
            <span>Their FTP (W)</span>
            <input className="input num" type="number" value={ftp} onChange={(e) => setFtp(e.target.value)} aria-label="Rider FTP" />
          </label>
        ) : (
          <label className="field" style={{ flex: '0 1 140px' }}>
            <span>Their threshold HR</span>
            <input className="input num" type="number" value={lthr} placeholder="e.g. 172" onChange={(e) => setLthr(e.target.value)} aria-label="Rider threshold HR" />
          </label>
        )}
      </div>
      <label className="field">
        <span>Note to the rider (optional)</span>
        <input className="input" value={note} placeholder="e.g. Keep the last rep honest — this is your opener for Saturday" onChange={(e) => setNote(e.target.value)} aria-label="Note to rider" />
      </label>
      {w && (
        <div className="row small ink2" style={{ gap: 12 }}>
          <b>{w.name}</b>
          <span>{fmtMinutes(w.durationMin)}</span>
          <span>{w.tss} TSS</span>
          <span>IF {w.ifactor.toFixed(2)}</span>
          <span className="spacer" />
          <button className="btn primary" disabled={busy || !valid || !!calErr} onClick={send}>
            {busy ? 'Sending…' : `Send to ${rider?.rider}’s calendar · ${fmtShort(date)}`}
          </button>
        </div>
      )}
      {calErr && <div className="callout warn">{calErr}</div>}
      {cal && (
        <div className="stack">
          <h3>{rider?.rider}’s next 4 weeks</h3>
          {upcoming.length ? (
            <ul className="weeks-off">
              {upcoming.map((e) => (
                <li key={e.id}>
                  <span className="tiny muted" style={{ minWidth: 90 }}>
                    {fmtLong(e.date)}
                  </span>
                  <span>
                    {e.category.startsWith('RACE_') ? `${e.category.slice(5)} race: ` : ''}
                    {e.name}
                    {e.plannedSec ? <span className="tiny muted"> · {fmtMinutes(Math.round(e.plannedSec / 60))}</span> : null}
                    {e.externalId?.startsWith(`${COACH_PREFIX}-`) ? <span className="chip tiny" style={{ marginLeft: 6 }}>from you</span> : null}
                  </span>
                  <span className="spacer" />
                  {e.externalId?.startsWith(`${COACH_PREFIX}-`) && (
                    <button className="btn sm ghost" onClick={() => remove(e)}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Nothing scheduled.</p>
          )}
        </div>
      )}
    </div>
  );
}
