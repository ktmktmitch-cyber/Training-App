import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, fmtShort, mondayOf } from '../engine/dates';
import type { TeamRider } from '../engine/team';
import type { IntensityModel, LoadPattern, PeriodizationModel, StrengthGoal, TrainingCamp } from '../engine/types';
import { CampForm } from './CampsCard';
import { coachError, readRiderSettings, updateRiderSettings } from '../lib/coach';
import { useApp } from '../lib/store';

const MODEL_LABEL: Record<PeriodizationModel, string> = { linear: 'Traditional', block: 'Block', reverse: 'Reverse', hrv_flex: 'HRV-guided' };
const INTENSITY_LABEL: Record<IntensityModel, string> = { auto: 'Auto', polarized: 'Polarized', pyramidal: 'Pyramidal', sweetspot: 'Sweet spot' };
const STRENGTH_LABEL: Record<StrengthGoal, string> = { build: 'Build', maintain: 'Maintain' };
const PATTERNS: LoadPattern[] = ['2:1', '3:1', '4:1'];

interface RiderRow {
  strengthGoal: StrengthGoal;
  model: PeriodizationModel;
  intensity: IntensityModel;
  loadPattern: LoadPattern;
  restWeeks: string[];
  camps: TrainingCamp[];
  savedAt: number | null;
}

type Loaded = { ok: true; row: RiderRow } | { ok: false; error: string };

function rowFrom(s: Record<string, unknown>, savedAt: number | null): RiderRow {
  const goal = (s.goal ?? {}) as { model?: PeriodizationModel; intensity?: IntensityModel; loadPattern?: LoadPattern; restWeeks?: string[]; camps?: TrainingCamp[] };
  const strength = (s.strength ?? {}) as { goal?: StrengthGoal };
  return {
    strengthGoal: strength.goal ?? 'build',
    model: goal.model ?? 'linear',
    intensity: goal.intensity ?? 'auto',
    loadPattern: goal.loadPattern ?? '3:1',
    restWeeks: [...(goal.restWeeks ?? [])].sort(),
    camps: goal.camps ?? [],
    savedAt,
  };
}

/** A setting in the form: "keep" leaves each rider's own value alone. */
type Pick<T> = T | 'keep';

/**
 * Coach: see every rider's training settings at a glance and change them for everyone at once, for
 * the riders you tick, or for one rider. Written to each rider's synced settings on intervals.icu;
 * their app picks the change up the next time it syncs.
 */
export function CoachTeamSettings({ riders, onToast }: { riders: TeamRider[]; onToast: (m: string) => void }) {
  const app = useApp();
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(riders.map((r) => r.id)));
  const inited = useRef(riders.length > 0);
  useEffect(() => {
    if (!inited.current && riders.length) {
      inited.current = true;
      setPicked(new Set(riders.map((r) => r.id)));
    }
  }, [riders]);

  const [strengthGoal, setStrengthGoal] = useState<Pick<StrengthGoal>>('keep');
  const [model, setModel] = useState<Pick<PeriodizationModel>>('keep');
  const [intensity, setIntensity] = useState<Pick<IntensityModel>>('keep');
  const [loadPattern, setLoadPattern] = useState<Pick<LoadPattern>>('keep');
  const [restAdd, setRestAdd] = useState<string[]>([]);
  const [restRemove, setRestRemove] = useState<string[]>([]);
  const [weekDate, setWeekDate] = useState(addDays(app.asOf, 21));
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<{ rider: string; ok: boolean; detail: string }[] | null>(null);

  const loadAll = async () => {
    setLoading(true);
    const conn = app.getConnection();
    const out: Record<string, Loaded> = {};
    await Promise.all(
      riders.map((r) =>
        readRiderSettings(conn, r.id)
          .then((x) => (out[r.id] = { ok: true, row: rowFrom(x.settings, x.savedAt) }))
          .catch((e) => (out[r.id] = { ok: false, error: coachError(e as Error, r.rider) })),
      ),
    );
    setLoaded(out);
    setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void loadAll(), [riders.map((r) => r.id).join(',')]);

  const sel = riders.filter((r) => picked.has(r.id));
  const all = sel.length === riders.length && riders.length > 0;
  const one = sel.length === 1 ? sel[0] : null;
  const oneRow = one && loaded[one.id]?.ok ? (loaded[one.id] as { ok: true; row: RiderRow }).row : null;

  // Picking a single rider fills the form with their current values, so you edit what's there
  const pickOnly = (id: string) => {
    setPicked(new Set([id]));
    const l = loaded[id];
    if (l?.ok) {
      setStrengthGoal(l.row.strengthGoal);
      setModel(l.row.model);
      setIntensity(l.row.intensity);
      setLoadPattern(l.row.loadPattern);
    } else {
      setStrengthGoal('keep');
      setModel('keep');
      setIntensity('keep');
      setLoadPattern('keep');
    }
    setRestAdd([]);
    setRestRemove([]);
    setResults(null);
  };
  const resetForm = () => {
    setStrengthGoal('keep');
    setModel('keep');
    setIntensity('keep');
    setLoadPattern('keep');
    setRestAdd([]);
    setRestRemove([]);
  };

  // Rest weeks already set for the selected riders (to remove from everyone who has them)
  const existingRest = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of sel) {
      const l = loaded[r.id];
      if (l?.ok) for (const w of l.row.restWeeks) if (w >= mondayOf(app.asOf)) m.set(w, (m.get(w) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sel, loaded, app.asOf]);

  const changes = [
    strengthGoal !== 'keep' && `strength → ${STRENGTH_LABEL[strengthGoal]}`,
    model !== 'keep' && `periodization → ${MODEL_LABEL[model]}`,
    intensity !== 'keep' && `intensity → ${INTENSITY_LABEL[intensity]}`,
    loadPattern !== 'keep' && `loading → ${loadPattern}`,
    restAdd.length > 0 && `add rest week${restAdd.length === 1 ? '' : 's'} ${restAdd.map(fmtShort).join(', ')}`,
    restRemove.length > 0 && `remove rest week${restRemove.length === 1 ? '' : 's'} ${restRemove.map(fmtShort).join(', ')}`,
  ].filter(Boolean) as string[];

  // Camps already set across the selected riders (same camp id = one row)
  const teamCamps = useMemo(() => {
    const m = new Map<string, { camp: TrainingCamp; riders: string[] }>();
    for (const r of sel) {
      const l = loaded[r.id];
      if (l?.ok) for (const c of l.row.camps) if (c.end >= app.asOf) (m.get(c.id) ?? m.set(c.id, { camp: c, riders: [] }).get(c.id)!).riders.push(r.rider);
    }
    return [...m.values()].sort((a, b) => a.camp.start.localeCompare(b.camp.start));
  }, [sel, loaded, app.asOf]);

  const campChange = async (label: string, mutate: (cs: TrainingCamp[]) => TrainingCamp[]) => {
    setSaving(true);
    setResults(null);
    const conn = app.getConnection();
    const res = await Promise.all(
      sel.map((r) =>
        updateRiderSettings(conn, r.id, (s) => {
          const goal = { ...((s.goal as Record<string, unknown>) ?? {}) };
          goal.camps = mutate((goal.camps as TrainingCamp[] | undefined) ?? []);
          return { ...s, goal };
        })
          .then(() => ({ rider: r.rider, ok: true, detail: 'saved — their app picks it up next time it syncs' }))
          .catch((e) => ({ rider: r.rider, ok: false, detail: coachError(e as Error, r.rider) })),
      ),
    );
    setSaving(false);
    setResults(res);
    onToast(`${label} for ${res.filter((x) => x.ok).length} of ${res.length} rider${res.length === 1 ? '' : 's'}.`);
    if (sel.some((r) => r.id === app.data.profile?.id)) app.sync().catch(() => {});
    loadAll();
  };
  const addCamp = (c: TrainingCamp) => campChange(`Added “${c.name}”`, (cs) => [...cs.filter((x) => x.id !== c.id), { ...c, fromCoach: true }]);
  const removeCamp = (c: TrainingCamp) => campChange(`Removed “${c.name}”`, (cs) => cs.filter((x) => x.id !== c.id));

  const apply = async () => {
    if (!sel.length || !changes.length) return;
    setSaving(true);
    setResults(null);
    const conn = app.getConnection();
    const res = await Promise.all(
      sel.map((r) =>
        updateRiderSettings(conn, r.id, (s) => {
          const goal = { ...((s.goal as Record<string, unknown>) ?? {}) };
          const strength = { ...((s.strength as Record<string, unknown>) ?? {}) };
          if (strengthGoal !== 'keep') strength.goal = strengthGoal;
          if (model !== 'keep') goal.model = model;
          if (intensity !== 'keep') goal.intensity = intensity;
          if (loadPattern !== 'keep') goal.loadPattern = loadPattern;
          if (restAdd.length || restRemove.length) {
            const rw = new Set<string>((goal.restWeeks as string[] | undefined) ?? []);
            restAdd.forEach((w) => rw.add(w));
            restRemove.forEach((w) => rw.delete(w));
            goal.restWeeks = [...rw].sort();
            // a week can't be both a rest week and an away week
            goal.awayWeeks = ((goal.awayWeeks as string[] | undefined) ?? []).filter((w) => !restAdd.includes(w));
          }
          return { ...s, goal, strength };
        })
          .then(() => ({ rider: r.rider, ok: true, detail: 'saved — their app picks it up next time it syncs' }))
          .catch((e) => ({ rider: r.rider, ok: false, detail: coachError(e as Error, r.rider) })),
      ),
    );
    setSaving(false);
    setResults(res);
    const okN = res.filter((x) => x.ok).length;
    onToast(`Updated ${okN} of ${res.length} rider${res.length === 1 ? '' : 's'}: ${changes.join(', ')}.`);
    // Your own settings: refresh this app so the change shows here straight away
    if (sel.some((r) => r.id === app.data.profile?.id)) app.sync().catch(() => {});
    if (!one) resetForm();
    else {
      setRestAdd([]);
      setRestRemove([]);
    }
    loadAll();
  };

  if (!riders.length) return null;
  const sameFor = <K extends keyof RiderRow>(k: K) => {
    const vals = sel.map((r) => loaded[r.id]).filter((l): l is { ok: true; row: RiderRow } => !!l?.ok).map((l) => String(l.row[k]));
    return vals.length && vals.every((v) => v === vals[0]) ? vals[0] : null;
  };
  const keepLabel = (k: keyof RiderRow, fmt: (v: string) => string) => {
    const v = sameFor(k);
    return one ? `Keep (${v ? fmt(v) : '—'})` : v ? `Keep each rider’s (all ${fmt(v)})` : 'Keep each rider’s own';
  };

  return (
    <div className="stack-lg">
      <span className="small ink2">
        Set training settings for the whole team at once, for the riders you tick, or for one rider (tap a name in the table). Changes go to each rider’s synced app settings on intervals.icu; their app applies them the next time it syncs. Anything left on “Keep” isn’t touched.
      </span>

      {Object.values(loaded).some((l) => !l.ok) && (
        <div className="row" style={{ alignItems: 'center' }}>
          <span className="tiny muted">Some riders couldn’t be read.</span>
          <button className="btn sm" disabled={loading} onClick={loadAll}>
            {loading ? 'Loading…' : 'Try again'}
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table className="data team-settings-table" aria-label="Riders’ training settings">
          <thead>
            <tr>
              <th className="sticky-col">Rider</th>
              <th>Strength</th>
              <th>Periodization</th>
              <th>Intensity</th>
              <th>Loading</th>
              <th>Rest weeks (upcoming)</th>
              <th>Camps</th>
            </tr>
          </thead>
          <tbody>
            {riders.map((r) => {
              const l = loaded[r.id];
              const on = picked.has(r.id);
              return (
                <tr key={r.id} className={on && sel.length === 1 ? 'sel' : ''}>
                  <td className="sticky-col">
                    <button className="link-btn" onClick={() => pickOnly(r.id)} title={`Edit ${r.rider} only`}>
                      {r.rider}
                    </button>
                  </td>
                  {!l ? (
                    <td colSpan={6} className="muted small">
                      {loading ? 'Loading…' : '—'}
                    </td>
                  ) : !l.ok ? (
                    <td colSpan={6} className="muted small">
                      {l.error}
                    </td>
                  ) : (
                    <>
                      <td>{STRENGTH_LABEL[l.row.strengthGoal]}</td>
                      <td>{MODEL_LABEL[l.row.model]}</td>
                      <td>{INTENSITY_LABEL[l.row.intensity]}</td>
                      <td>{l.row.loadPattern}</td>
                      <td className="small">
                        {l.row.restWeeks.filter((w) => w >= mondayOf(app.asOf)).map(fmtShort).join(', ') || <span className="muted">none</span>}
                        {l.row.savedAt == null && <span className="tiny muted"> · not synced yet</span>}
                      </td>
                      <td className="small">{l.row.camps.filter((c) => c.end >= app.asOf).map((c) => `${c.name} (${fmtShort(c.start)})`).join(', ') || <span className="muted">none</span>}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <span className="tiny muted" style={{ fontWeight: 600 }}>
          Apply to
        </span>
        <div className="rider-checklist" role="group" aria-label="Riders to update">
          <label className="check rider-all">
            <input
              type="checkbox"
              checked={all}
              ref={(el) => {
                if (el) el.indeterminate = sel.length > 0 && !all;
              }}
              onChange={() => {
                setPicked(all ? new Set() : new Set(riders.map((r) => r.id)));
                resetForm();
                setResults(null);
              }}
            />
            <b>Everyone</b>
            <span className="tiny muted">({riders.length})</span>
          </label>
          {riders.map((r) => (
            <label key={r.id} className="check">
              <input
                type="checkbox"
                checked={picked.has(r.id)}
                onChange={() => {
                  const n = new Set(picked);
                  if (n.has(r.id)) n.delete(r.id);
                  else n.add(r.id);
                  setPicked(n);
                  setResults(null);
                }}
              />
              <span>{r.rider}</span>
            </label>
          ))}
        </div>
        {one && <span className="tiny muted">Editing {one.rider} only — the form shows their current settings.</span>}
      </div>

      <div className="grid-2">
        <label className="field">
          <span>Strength goal</span>
          <select className="select" value={strengthGoal} onChange={(e) => setStrengthGoal(e.target.value as Pick<StrengthGoal>)} aria-label="Strength goal for selected riders">
            <option value="keep">{keepLabel('strengthGoal', (v) => STRENGTH_LABEL[v as StrengthGoal])}</option>
            <option value="build">Build strength</option>
            <option value="maintain">Maintain</option>
          </select>
        </label>
        <label className="field">
          <span>Macro periodization</span>
          <select className="select" value={model} onChange={(e) => setModel(e.target.value as Pick<PeriodizationModel>)} aria-label="Periodization for selected riders">
            <option value="keep">{keepLabel('model', (v) => MODEL_LABEL[v as PeriodizationModel])}</option>
            {(Object.keys(MODEL_LABEL) as PeriodizationModel[]).map((k) => (
              <option key={k} value={k}>
                {MODEL_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Intensity distribution</span>
          <select className="select" value={intensity} onChange={(e) => setIntensity(e.target.value as Pick<IntensityModel>)} aria-label="Intensity distribution for selected riders">
            <option value="keep">{keepLabel('intensity', (v) => INTENSITY_LABEL[v as IntensityModel])}</option>
            {(Object.keys(INTENSITY_LABEL) as IntensityModel[]).map((k) => (
              <option key={k} value={k}>
                {INTENSITY_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Loading pattern (load : recovery weeks)</span>
          <select className="select" value={loadPattern} onChange={(e) => setLoadPattern(e.target.value as Pick<LoadPattern>)} aria-label="Loading pattern for selected riders">
            <option value="keep">{keepLabel('loadPattern', (v) => v)}</option>
            {PATTERNS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <span className="tiny muted" style={{ fontWeight: 600 }}>
          Rest weeks
        </span>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '0 1 180px' }}>
            <span>Week of</span>
            <input className="input" type="date" min={app.asOf} value={weekDate} onChange={(e) => e.target.value && setWeekDate(e.target.value)} aria-label="Rest week date" />
          </label>
          <button
            className="btn sm"
            onClick={() => {
              const w = mondayOf(weekDate);
              setRestAdd((x) => [...new Set([...x, w])].sort());
              setRestRemove((x) => x.filter((y) => y !== w));
            }}
          >
            Add rest week {fmtShort(mondayOf(weekDate))}
          </button>
        </div>
        {(restAdd.length > 0 || existingRest.length > 0) && (
          <div className="row" style={{ gap: 6 }}>
            {restAdd.map((w) => (
              <span key={`a${w}`} className="chip on">
                + {fmtShort(w)}
                <button className="chip-x" aria-label={`Don’t add ${fmtShort(w)}`} onClick={() => setRestAdd((x) => x.filter((y) => y !== w))}>
                  ×
                </button>
              </span>
            ))}
            {existingRest
              .filter(([w]) => !restAdd.includes(w))
              .map(([w, n]) => {
                const rm = restRemove.includes(w);
                return (
                  <span key={`e${w}`} className="chip" style={rm ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                    {fmtShort(w)}
                    {!one && sel.length > 1 ? <span className="tiny muted"> · {n === sel.length ? 'all' : `${n} of ${sel.length}`}</span> : null}
                    <button
                      className="chip-x"
                      aria-label={rm ? `Keep rest week ${fmtShort(w)}` : `Remove rest week ${fmtShort(w)}`}
                      title={rm ? 'Keep it' : 'Remove this rest week'}
                      onClick={() => setRestRemove((x) => (rm ? x.filter((y) => y !== w) : [...x, w]))}
                    >
                      {rm ? '↺' : '×'}
                    </button>
                  </span>
                );
              })}
          </div>
        )}
        <span className="tiny muted">Rest weeks are about 40% less volume and easy riding; the loading cycle restarts after each one.</span>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <span className="tiny muted" style={{ fontWeight: 600 }}>
          Training camp
        </span>
        <span className="tiny ink2">
          Added straight away to {all ? 'everyone' : one ? one.rider : `the ${sel.length} ticked riders`}. Each rider’s plan builds the camp days from their own usual hours (or the hours/day you set), with an easy run-in and recovery after.
        </span>
        <CampForm weeklyHours={8} cta={`Add to ${all ? 'everyone' : one ? one.rider : `${sel.length} riders`}`} onAdd={addCamp} />
        {teamCamps.length > 0 && (
          <ul className="weeks-off">
            {teamCamps.map(({ camp, riders: who }) => (
              <li key={camp.id}>
                <b>{camp.name}</b>
                <span className="small ink2">
                  {fmtShort(camp.start)} – {fmtShort(camp.end)} · {camp.hoursPerDay ? `${camp.hoursPerDay} h/day` : 'auto hours'} · {who.length === riders.length ? 'everyone' : who.join(', ')}
                </span>
                <span className="spacer" />
                <button className="btn sm ghost" disabled={saving} onClick={() => removeCamp(camp)}>
                  Remove{sel.length < riders.length ? ' for selected' : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="row" style={{ alignItems: 'center' }}>
        <span className="small ink2" style={{ flex: '1 1 260px' }}>
          {changes.length ? (
            <>
              <b>{all ? 'Everyone' : one ? one.rider : `${sel.length} riders`}:</b> {changes.join(' · ')}
            </>
          ) : (
            <span className="muted">Pick what to change.</span>
          )}
        </span>
        <button className="btn primary" disabled={saving || !sel.length || !changes.length} onClick={apply}>
          {saving ? 'Saving…' : `Apply to ${all ? 'everyone' : one ? one.rider : `${sel.length} riders`}`}
        </button>
      </div>
      {oneRow && oneRow.savedAt == null && <p className="tiny muted">{one!.rider} hasn’t synced the app yet — their app uses these settings the first time it connects.</p>}
      {results && (
        <ul className="weeks-off" aria-label="Settings results">
          {results.map((r) => (
            <li key={r.rider}>
              <span className={`chip ${r.ok ? 'on' : ''}`}>{r.ok ? '✓ Saved' : '✗ Not saved'}</span>
              <b>{r.rider}</b>
              <span className="tiny muted">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
