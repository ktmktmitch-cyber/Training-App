import { useEffect, useState } from 'react';
import { addDays, fmtShort, mondayOf } from '../engine/dates';
import { TAGS } from '../engine/journal';
import { SPORT_LABEL } from '../engine/multisport';
import type { TeamRider } from '../engine/team';
import type { LoadPattern, PeriodizationModel, PlannedRace, RacePriority, SportMode } from '../engine/types';
import { coachError } from '../lib/coach';
import { flatten, readDoc, restamp, unflatten, writeDoc, type SyncDoc } from '../lib/cloudSync';
import { useApp } from '../lib/store';

type Goal = { model?: PeriodizationModel; loadPattern?: LoadPattern; eventName?: string; eventDate?: string | null; restWeeks?: string[]; awayWeeks?: string[]; races?: PlannedRace[] };
type Prefs = { sport?: SportMode };
type Strength = { frequency?: number };

const MODELS: { id: PeriodizationModel; label: string }[] = [
  { id: 'linear', label: 'Traditional (linear)' },
  { id: 'block', label: 'Block' },
  { id: 'reverse', label: 'Reverse' },
  { id: 'hrv_flex', label: 'HRV-guided' },
];

/**
 * Coach view of a rider's app settings (read from — and written back to — the settings note on
 * their intervals.icu calendar; needs coach access with permission to edit their calendar). Their
 * app picks up your changes the next time it syncs. Their journal only shows if they chose to share it.
 */
export function RiderSettingsPanel({ r }: { r: TeamRider }) {
  const app = useApp();
  const conn = { ...app.getConnection(), athleteId: r.id };
  const [doc, setDoc] = useState<SyncDoc | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [goal, setGoal] = useState<Goal>({});
  const [prefs, setPrefs] = useState<Prefs>({});
  const [strength, setStrength] = useState<Strength>({});
  const [hours, setHours] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [weekDate, setWeekDate] = useState(addDays(app.asOf, 21));
  const [race, setRace] = useState<{ name: string; date: string; priority: RacePriority; durationMin: number }>({ name: '', date: addDays(app.asOf, 60), priority: 'B', durationMin: 120 });

  const load = () => {
    setDoc(undefined);
    setErr(null);
    setMsg(null);
    readDoc(conn)
      .then((d) => {
        setDoc(d);
        const s = (d?.data.settings ?? {}) as Record<string, unknown>;
        setGoal({ ...((s.goal as Goal) ?? {}) });
        setPrefs({ ...((s.prefs as Prefs) ?? {}) });
        setStrength({ ...((s.strength as Strength) ?? {}) });
        setHours(typeof s.usualHours === 'number' ? s.usualHours : '');
      })
      .catch((e) => setErr(coachError(e as Error, r.rider)));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [r.id]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const cur = (await readDoc(conn)) ?? { app: 'trainingapp' as const, v: 1 as const, savedAt: 0, device: 'coach', stamps: {}, data: { settings: {} } };
      const before = flatten(cur.data);
      const s = { ...(cur.data.settings ?? {}) } as Record<string, unknown>;
      s.goal = { ...((s.goal as object) ?? {}), ...goal };
      s.prefs = { ...((s.prefs as object) ?? {}), ...prefs };
      s.strength = { ...((s.strength as object) ?? {}), ...strength };
      if (hours !== '') s.usualHours = hours;
      const data = { ...cur.data, settings: s };
      const after = flatten(data);
      const stamps = restamp(before, after, cur.stamps ?? {});
      await writeDoc(conn, { ...cur, savedAt: Date.now(), device: 'coach', stamps, data: unflatten(after) });
      setMsg(`Saved. ${r.rider}’s app picks this up the next time it syncs (when they open it).`);
      load();
    } catch (e) {
      setMsg(`Couldn’t save: ${coachError(e as Error, r.rider)}`);
    } finally {
      setSaving(false);
    }
  };

  const shareJournal = Boolean((doc?.data.settings as Record<string, unknown> | undefined)?.shareJournalWithCoach);
  const journal = (doc?.data.journal ?? {}) as Record<string, string[]>;
  const recent = Object.entries(journal)
    .filter(([d]) => d >= addDays(app.asOf, -28))
    .sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="card stack" style={{ boxShadow: 'none' }}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>{r.rider}’s app settings</h3>
        <span className="tiny muted">{doc ? `last saved ${new Date(doc.savedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} from their ${doc.device}` : ''}</span>
      </div>
      {doc === undefined && !err && <p className="small muted">Loading…</p>}
      {err && <div className="callout warn">{err}</div>}
      {doc === null && <p className="small muted">{r.rider} hasn’t synced the app yet. You can still set things up below — their app will pick it up the first time they connect.</p>}
      {doc !== undefined && !err && (
        <>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: '1 1 150px' }}>
              <span>Sport</span>
              <select className="select" value={prefs.sport ?? 'cycling'} onChange={(e) => setPrefs({ ...prefs, sport: e.target.value as SportMode })} aria-label="Rider sport">
                {(Object.keys(SPORT_LABEL) as SportMode[]).map((k) => (
                  <option key={k} value={k}>
                    {SPORT_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: '0 1 120px' }}>
              <span>Usual hours/week</span>
              <input className="input num" type="number" min={1} max={30} step={0.5} value={hours} onChange={(e) => setHours(e.target.value === '' ? '' : Number(e.target.value))} aria-label="Rider usual hours" />
            </label>
            <label className="field" style={{ flex: '1 1 170px' }}>
              <span>Periodization</span>
              <select className="select" value={goal.model ?? 'linear'} onChange={(e) => setGoal({ ...goal, model: e.target.value as PeriodizationModel })} aria-label="Rider periodization">
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: '0 1 110px' }}>
              <span>Loading</span>
              <select className="select" value={goal.loadPattern ?? '3:1'} onChange={(e) => setGoal({ ...goal, loadPattern: e.target.value as LoadPattern })} aria-label="Rider loading pattern">
                {(['2:1', '3:1', '4:1'] as LoadPattern[]).map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: '0 1 120px' }}>
              <span>Lifting / week</span>
              <select className="select" value={strength.frequency ?? 2} onChange={(e) => setStrength({ ...strength, frequency: Number(e.target.value) })} aria-label="Rider lifting frequency">
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <b className="small">Races</b>
            {(goal.races ?? []).length ? (
              <ul className="weeks-off">
                {[...(goal.races ?? [])].sort((a, b) => a.date.localeCompare(b.date)).map((x) => (
                  <li key={x.id}>
                    <span className={`chip pri-${x.priority}`}>{x.priority}</span>
                    {x.name} · {fmtShort(x.date)}
                    <span className="spacer" />
                    <button className="btn sm ghost" onClick={() => setGoal({ ...goal, races: (goal.races ?? []).filter((y) => y.id !== x.id) })}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="tiny muted">None</span>
            )}
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <input className="input" style={{ flex: '2 1 160px' }} placeholder="Race name" value={race.name} onChange={(e) => setRace({ ...race, name: e.target.value })} aria-label="Rider race name" />
              <input className="input" style={{ flex: '1 1 140px' }} type="date" min={app.asOf} value={race.date} onChange={(e) => setRace({ ...race, date: e.target.value })} aria-label="Rider race date" />
              <select className="select" style={{ flex: '0 1 80px' }} value={race.priority} onChange={(e) => setRace({ ...race, priority: e.target.value as RacePriority })} aria-label="Rider race priority">
                {(['A', 'B', 'C'] as RacePriority[]).map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              <button
                className="btn sm"
                disabled={!race.date}
                onClick={() => {
                  setGoal({ ...goal, races: [...(goal.races ?? []), { id: `c${Date.now().toString(36)}`, name: race.name.trim() || `${race.priority} race`, date: race.date, priority: race.priority, durationMin: race.durationMin }] });
                  setRace({ ...race, name: '' });
                }}
              >
                Add race
              </button>
            </div>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <b className="small">Rest & away weeks</b>
            <div className="row" style={{ gap: 6 }}>
              {[...(goal.restWeeks ?? []).map((d) => ({ d, k: 'rest' as const })), ...(goal.awayWeeks ?? []).map((d) => ({ d, k: 'away' as const }))]
                .sort((a, b) => a.d.localeCompare(b.d))
                .map(({ d, k }) => (
                  <span key={`${k}${d}`} className="chip">
                    {k === 'away' ? 'Away' : 'Rest'} · wk of {fmtShort(d)}{' '}
                    <button className="drop-clear" style={{ position: 'static' }} aria-label={`Remove ${k} week of ${fmtShort(d)}`} onClick={() => setGoal({ ...goal, restWeeks: (goal.restWeeks ?? []).filter((x) => x !== d), awayWeeks: (goal.awayWeeks ?? []).filter((x) => x !== d) })}>
                      ×
                    </button>
                  </span>
                ))}
            </div>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <input className="input" style={{ flex: '0 1 170px' }} type="date" min={app.asOf} value={weekDate} onChange={(e) => setWeekDate(e.target.value)} aria-label="Rider week off" />
              <button className="btn sm" onClick={() => setGoal({ ...goal, restWeeks: [...new Set([...(goal.restWeeks ?? []), mondayOf(weekDate)])].sort(), awayWeeks: (goal.awayWeeks ?? []).filter((x) => x !== mondayOf(weekDate)) })}>
                Add rest week
              </button>
              <button className="btn sm" onClick={() => setGoal({ ...goal, awayWeeks: [...new Set([...(goal.awayWeeks ?? []), mondayOf(weekDate)])].sort(), restWeeks: (goal.restWeeks ?? []).filter((x) => x !== mondayOf(weekDate)) })}>
                Add away week
              </button>
            </div>
          </div>

          <div className="row">
            <button className="btn primary" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : `Save ${r.rider}’s settings`}
            </button>
            {msg && <span className="small ink2">{msg}</span>}
          </div>

          <div className="stack" style={{ gap: 4 }}>
            <b className="small">Journal · last 4 weeks</b>
            {shareJournal ? (
              recent.length ? (
                <ul className="why">
                  {recent.map(([d, tags]) => (
                    <li key={d}>
                      {fmtShort(d)}: {tags.map((t) => TAGS.find((x) => x.key === t)?.short ?? t).join(', ')}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="tiny muted">Nothing logged.</span>
              )
            ) : (
              <span className="tiny muted">Private — {r.rider} hasn’t chosen to share their journal with coaches (Settings → Sync across devices in their app).</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
