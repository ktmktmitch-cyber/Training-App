import { useMemo, useRef, useState } from 'react';
import { addDays, fmtLong, fmtMinutes } from '../engine/dates';
import { instantiate, levelForTarget } from '../engine/planner';
import { DIFFICULTY_LABEL, PROG_LABEL, progressionCapable, TEMPLATE_ZONE, type Difficulty } from '../engine/progression';
import { lthrZones, type ExportMode, type ExportTargets } from '../engine/targets';
import type { WorkoutCategory } from '../engine/types';
import { ALL_WORKOUTS, WORKOUT_BY_ID, type WorkoutTemplate } from '../engine/workouts';
import { formatPace, type Sport } from '../engine/runswim';
import { Skyline } from '../components/charts';
import { StepsTable } from '../components/DayCard';
import { ExportBar } from '../components/ExportBar';
import { DifficultyChip } from '../components/insights';
import { CATEGORY_LABEL, IntensityChip, Seg, useToast } from '../components/ui';
import { useApp } from '../lib/store';

const CATS: WorkoutCategory[] = ['recovery', 'endurance', 'tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic', 'sprint', 'race_sim', 'durability', 'openers', 'test'];
const TAG_LABEL: Record<string, string> = { indoor: 'Indoor', outdoor: 'Outdoor', climbing: 'Climbing', race: 'Race-specific', evidence: 'Research-backed', classic: 'Classic', test: 'Test' };

function previewDuration(t: WorkoutTemplate) {
  return Math.max(t.minMin, Math.min(t.maxMin, t.minMin >= 120 ? t.minMin : 75));
}

export function LibraryPage() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<WorkoutCategory | 'all'>('all');
  const mode = app.settings.prefs.sport ?? 'cycling';
  const [sport, setSport] = useState<Sport>(mode === 'running' ? 'run' : 'ride');
  const [tag, setTag] = useState<string>('all');
  const [maxMin, setMaxMin] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const list = useMemo(
    () =>
      ALL_WORKOUTS.filter((t) => (t.sport ?? 'ride') === sport && (cat === 'all' || t.category === cat) && (tag === 'all' || t.tags?.includes(tag)) && (!maxMin || t.minMin <= maxMin) && (!q || `${t.name} ${t.purpose}`.toLowerCase().includes(q.toLowerCase()))),
    [cat, tag, maxMin, q, sport],
  );
  const previews = useMemo(
    () =>
      Object.fromEntries(
        ALL_WORKOUTS.map((t) => {
          const lvl = Math.floor((t.levels - 1) / 2);
          return [t.id, instantiate(t, previewDuration(t), lvl, null, undefined, [])];
        }),
      ),
    [],
  );

  const open = (id: string) => {
    setSel(id);
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  return (
    <>
      <div className="row">
        <h1>Workout library</h1>
        <span className="chip">{ALL_WORKOUTS.length} workouts</span>
      </div>
      <p className="small ink2" style={{ marginTop: -8 }}>
        Pick any session, set the level and duration, then add it to your plan on any day or send it straight to intervals.icu / Garmin / Zwift.
      </p>

      <div ref={detailRef}>{sel && WORKOUT_BY_ID[sel] && <WorkoutDetail key={sel} t={WORKOUT_BY_ID[sel]} onClose={() => setSel(null)} />}</div>

      <div className="card stack">
        <Seg<Sport>
          value={sport}
          onChange={(v) => { setSport(v); setCat('all'); setSel(null); }}
          ariaLabel="Sport"
          options={[
            { value: 'ride', label: `Ride (${ALL_WORKOUTS.filter((t) => (t.sport ?? 'ride') === 'ride').length})` },
            { value: 'run', label: `Run (${ALL_WORKOUTS.filter((t) => t.sport === 'run').length})` },
            { value: 'swim', label: `Swim (${ALL_WORKOUTS.filter((t) => t.sport === 'swim').length})` },
          ]}
        />
        <div className="row">
          <input className="input" style={{ flex: '1 1 200px' }} placeholder="Search (e.g. 30/15, climb, threshold)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search workouts" />
          <select className="select" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
            <option value="all">All types</option>
            {Object.entries(TAG_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select className="select" value={maxMin} onChange={(e) => setMaxMin(Number(e.target.value))} aria-label="Maximum time">
            <option value={0}>Any length</option>
            {[45, 60, 75, 90, 120, 180].map((m) => (
              <option key={m} value={m}>
                ≤ {fmtMinutes(m)} minimum
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {(['all', ...CATS.filter((c) => ALL_WORKOUTS.some((t) => (t.sport ?? 'ride') === sport && t.category === c))] as const).map((c) => (
            <button key={c} className={`chip chip-btn ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>
              {c === 'all' ? 'All' : CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      <div className="lib-grid">
        {list.map((t) => {
          const p = previews[t.id];
          return (
            <button key={t.id} className={`lib-card ${sel === t.id ? 'on' : ''}`} onClick={() => open(t.id)}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <b>{t.name}</b>
                <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>
                  {t.levels > 1 ? `${t.levels} levels` : ''}
                </span>
              </div>
              <IntensityChip intensity={t.intensity} category={t.category} />
              {p.blocks.length > 0 && <Skyline blocks={p.blocks} />}
              <span className="tiny muted">from {fmtMinutes(t.minMin)}{t.tags?.length ? ` · ${t.tags.map((x) => TAG_LABEL[x]).filter(Boolean).join(' · ')}` : ''}</span>
              <span className="lib-purpose">{t.purpose}</span>
            </button>
          );
        })}
        {!list.length && <p className="muted">No workouts match those filters.</p>}
      </div>
      {app.data.source === 'none' && null}
    </>
  );
}

function WorkoutDetail({ t, onClose }: { t: WorkoutTemplate; onClose: () => void }) {
  const app = useApp();
  const [toast, showToast] = useToast();
  const zone = TEMPLATE_ZONE[t.id];
  const pl = zone && zone !== 'endurance' && progressionCapable(t) && app.progression[zone]?.source === 'history' ? app.progression[zone].level : null;
  const [duration, setDuration] = useState(previewDuration(t));
  const [level, setLevel] = useState(() => (pl != null ? levelForTarget(t, previewDuration(t), pl + 0.5) : Math.floor((t.levels - 1) / 2)));
  const days = Array.from({ length: 21 }, (_, i) => addDays(app.asOf, i));
  const [date, setDate] = useState(addDays(app.asOf, 1));
  const w = useMemo(() => instantiate(t, duration, level, app.profile?.weightKg ?? null, app.progression, []), [t, duration, level, app.profile, app.progression]);
  const scheduledHere = app.scheduled[date];
  // Targets: preview and export the workout against any FTP / threshold HR (default: power, your eFTP)
  const [tMode, setTMode] = useState<ExportMode>('power');
  const [ftpIn, setFtpIn] = useState(String(app.exportDefaults.ftp));
  const [lthrIn, setLthrIn] = useState(app.exportDefaults.lthr ? String(app.exportDefaults.lthr) : '');
  const ftpUse = Number(ftpIn) >= 50 && Number(ftpIn) <= 700 ? Math.round(Number(ftpIn)) : app.exportDefaults.ftp;
  const lthrUse = Number(lthrIn) >= 100 && Number(lthrIn) <= 220 ? Math.round(Number(lthrIn)) : app.exportDefaults.lthr;
  const viewProfile = useMemo(() => (app.profile && lthrUse ? { ...app.profile, hrZones: lthrZones(lthrUse) } : app.profile ?? (lthrUse ? { id: 'x', name: '', ftp: ftpUse, eftp: null, lthr: lthrUse, maxHr: null, restingHr: null, weightKg: null, powerZones: [], hrZones: lthrZones(lthrUse) } : null)), [app.profile, lthrUse, ftpUse]);
  const libTargets: ExportTargets = { mode: tMode, ftp: ftpUse, lthr: lthrUse ?? null };
  const tSport: Sport = t.sport ?? 'ride';
  const paceMps = tSport === 'run' ? (app.settings.prefs.runPaceMps ?? app.profile?.runThresholdMps ?? null) : tSport === 'swim' ? (app.settings.prefs.swimCssMps ?? app.profile?.swimCssMps ?? null) : null;

  return (
    <div className="card stack-lg hero">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
          <span className="tiny muted" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {CATEGORY_LABEL[t.category]}
          </span>
          <h2 className="hero-title">{w.name}</h2>
          <div className="day-meta">
            <IntensityChip intensity={t.intensity} category={t.category} />
            {w.progression?.difficulty && <DifficultyChip difficulty={w.progression.difficulty} level={w.progression.workoutLevel} />}
            {pl != null && zone && <span className="chip">Your {PROG_LABEL[zone]} level {pl.toFixed(1)}</span>}
          </div>
        </div>
        <button className="btn sm ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="small ink2">{t.purpose}</p>
      {t.science && <p className="tiny muted">{t.science}</p>}

      <div className="grid-2">
        {t.levels > 1 && (
          <label className="field">
            <span>
              Level {level + 1} / {t.levels}
              {w.progression?.difficulty ? ` · ${DIFFICULTY_LABEL[w.progression.difficulty as Difficulty]} for you` : ''}
            </span>
            <input type="range" min={0} max={t.levels - 1} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
          </label>
        )}
        <label className="field">
          <span>Duration (min) · {fmtMinutes(w.durationMin)} as built</span>
          <input className="input num" type="number" min={t.minMin} max={t.maxMin} step={5} value={duration} onChange={(e) => setDuration(Math.max(t.minMin, Math.min(t.maxMin, Number(e.target.value) || t.minMin)))} />
        </label>
      </div>

      {tSport !== 'ride' ? (
        <p className="tiny muted">
          Targets are % of your threshold {tSport === 'swim' ? 'swim pace (CSS)' : 'run pace'}
          {paceMps ? ` (${formatPace(paceMps, tSport)}${tSport === 'swim' ? '/100 m' : '/km'})` : ' — set it in Settings → Your sport to see paces'}.
        </p>
      ) : (
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field">
          <span>Targets</span>
          <Seg<ExportMode>
            value={tMode}
            onChange={setTMode}
            ariaLabel="Workout targets"
            options={[
              { value: 'power', label: 'Power' },
              { value: 'hr', label: 'Heart rate' },
            ]}
          />
        </label>
        {tMode === 'power' ? (
          <label className="field">
            <span>FTP (W){app.profile?.eftp ? ` · eFTP ${Math.round(app.profile.eftp)}` : ''}</span>
            <input className="input num" style={{ width: 110 }} type="number" min={50} max={700} value={ftpIn} onChange={(e) => setFtpIn(e.target.value)} aria-label="FTP for this workout" />
          </label>
        ) : (
          <label className="field">
            <span>Threshold HR (bpm)</span>
            <input className="input num" style={{ width: 110 }} type="number" min={100} max={220} value={lthrIn} placeholder="e.g. 170" onChange={(e) => setLthrIn(e.target.value)} aria-label="Threshold HR for this workout" />
          </label>
        )}
        <span className="tiny muted" style={{ flex: '1 1 200px' }}>
          {tMode === 'power' ? `Watts below are for ${ftpUse} W.` : lthrUse ? `bpm below are for a threshold HR of ${lthrUse}. Efforts under 2 min are by feel.` : 'Enter your threshold HR to see bpm targets.'}
        </span>
      </div>
      )}
      {w.blocks.length > 0 && <Skyline blocks={w.blocks} large ftp={ftpUse} />}
      <div className="hero-stats">
        <div>
          <b className="num">{fmtMinutes(w.durationMin)}</b>
          <span>Duration</span>
        </div>
        <div>
          <b className="num">{w.tss}</b>
          <span>TSS</span>
        </div>
        <div>
          <b className="num">{w.ifactor.toFixed(2)}</b>
          <span>IF</span>
        </div>
        <div>
          <b className="num">{w.progression ? w.progression.workoutLevel.toFixed(1) : '—'}</b>
          <span>Workout level</span>
        </div>
      </div>
      <details className="more" open>
        <summary>Steps & targets</summary>
        <div style={{ marginTop: 8 }}>
          <StepsTable blocks={w.blocks} ftp={ftpUse} profile={viewProfile} mode={tMode} sport={tSport} paceMps={paceMps} />
        </div>
      </details>
      <p className="small">
        <b>Fueling:</b> {w.fueling}
      </p>

      <div className="divider" style={{ margin: 0 }} />
      <div className="row">
        <label className="field" style={{ flex: '1 1 200px' }}>
          <span>Date</span>
          <select className="select" value={date} onChange={(e) => setDate(e.target.value)}>
            {days.map((d) => (
              <option key={d} value={d}>
                {fmtLong(d)}
                {d === app.asOf ? ' (today)' : ''}
                {app.scheduled[d] ? ` — has ${WORKOUT_BY_ID[app.scheduled[d].workoutId]?.name ?? 'a workout'}` : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn"
          style={{ alignSelf: 'flex-end' }}
          onClick={() => {
            app.schedule(date, { workoutId: t.id, durationMin: duration, level });
            showToast(`Added ${w.name} to your plan on ${fmtLong(date)} — the rest of that week re-plans around it.`);
          }}
        >
          {scheduledHere ? 'Replace in plan' : 'Add to my plan'}
        </button>
      </div>
      <ExportBar workout={w} date={date} onDone={showToast} defaults={tSport === 'ride' ? libTargets : undefined} />
      <p className="tiny muted">
        <b>Garmin:</b> “Send to intervals.icu” lands on your Garmin calendar automatically if Garmin upload is on in intervals.icu. The .FIT file can also be copied to <code>Garmin/NewFiles</code> on your Edge or watch over USB. Zwift uses .zwo; most other indoor apps import .MRC.
      </p>
      {toast}
    </div>
  );
}
