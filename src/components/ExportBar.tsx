import { useState } from 'react';
import { safeFileName, workoutToFit, workoutToMrc } from '../engine/exporters';
import { workoutDescription } from '../engine/icuExport';
import { targetsLabel, type ExportMode, type ExportTargets } from '../engine/targets';
import type { ISODate, PlannedWorkout } from '../engine/types';
import { workoutToZwo } from '../engine/zwo';
import { formatPace, parsePace } from '../engine/runswim';
import { useApp } from '../lib/store';
import { Seg } from './ui';

export function download(name: string, data: BlobPart, type: string) {
  const blob = new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1500);
}

type Dest = 'icu' | 'fit' | 'zwo' | 'mrc' | 'copy';

const DEST: Record<Dest, { label: string; action: string; hr: boolean; note: string }> = {
  icu: { label: 'Send to intervals.icu', action: 'Send to intervals.icu', hr: true, note: 'Adds it to your intervals.icu calendar, which syncs to Garmin/Wahoo/Zwift.' },
  fit: { label: 'Garmin .FIT', action: 'Download .FIT', hr: true, note: 'Copy to the Garmin/NewFiles folder on your Edge or watch.' },
  zwo: { label: 'Zwift .zwo', action: 'Download .zwo', hr: false, note: 'Zwift scales the workout to the FTP set in Zwift, and has no heart-rate targets.' },
  mrc: { label: '.MRC', action: 'Download .MRC', hr: false, note: 'Indoor apps scale .MRC to the FTP set in that app, and it has no heart-rate targets.' },
  copy: { label: 'Copy text', action: 'Copy text', hr: true, note: 'intervals.icu workout-builder text.' },
};

/**
 * Export a workout everywhere it can go. Every export first asks what to export against —
 * power (default, from your eFTP) or heart rate (from your threshold HR) — and lets you
 * type the FTP / threshold HR to use.
 *  - intervals.icu calendar (→ Garmin Connect / Wahoo / Zwift via intervals.icu sync)
 *  - Garmin .FIT workout (USB: copy to Garmin/NewFiles)
 *  - Zwift .zwo, .MRC (most indoor-trainer apps), intervals.icu text
 */
export function ExportBar({ workout, date, onDone, compact, defaults }: { workout: PlannedWorkout; date: ISODate; onDone?: (msg: string) => void; compact?: boolean; defaults?: ExportTargets }) {
  const app = useApp();
  const base0 = defaults ?? app.exportDefaults;
  const [busy, setBusy] = useState(false);
  const [dest, setDest] = useState<Dest | null>(null);
  const [mode, setMode] = useState<ExportMode>(base0.mode);
  const [ftp, setFtp] = useState<string>(String(base0.ftp));
  const [lthr, setLthr] = useState<string>(base0.lthr ? String(base0.lthr) : '');
  const structured = workout.blocks.length > 0;
  const sport = workout.sport ?? 'ride';
  const defaultPace = app.settings.prefs.runPaceMps ?? app.profile?.runThresholdMps ?? null;
  const [pace, setPace] = useState(formatPace(defaultPace, 'run'));
  const dests = (Object.keys(DEST) as Dest[]).filter((d) => sport === 'ride' || d === 'icu' || d === 'copy' || (d === 'fit' && sport === 'run'));
  const base = safeFileName(workout.name);
  const say = (m: string) => onDone?.(m);
  if (!structured) return null;

  const open = (d: Dest) => {
    // Start from the defaults every time: power and your eFTP (or what the library shows)
    const b = defaults ?? app.exportDefaults;
    setMode(b.mode);
    setFtp(String(b.ftp));
    setLthr(sport === 'run' && app.profile?.runLthr ? String(app.profile.runLthr) : b.lthr ? String(b.lthr) : lthr);
    setPace(formatPace(defaultPace, 'run'));
    setDest(d);
  };

  const ftpN = Number(ftp);
  const lthrN = Number(lthr);
  const powerOnly = dest ? !DEST[dest].hr : false;
  const effMode: ExportMode = powerOnly ? 'power' : mode;
  const paceMps = sport === 'run' && pace.trim() ? parsePace(pace, 'run') : null;
  const valid =
    effMode === 'hr' ? lthrN >= 100 && lthrN <= 220 : sport === 'ride' ? ftpN >= 50 && ftpN <= 700 : sport === 'run' ? !pace.trim() || (paceMps != null && paceMps > 2 && paceMps < 7) : true;
  const targets: ExportTargets = { mode: effMode, ftp: Math.round(ftpN), lthr: lthrN ? Math.round(lthrN) : null, paceMps };
  const suffix = effMode === 'hr' ? `_HR${targets.lthr}` : sport === 'ride' ? `_${targets.ftp}W` : paceMps ? `_${pace.replace(':', 'm')}` : '';

  const confirm = async () => {
    if (!dest || !valid) return;
    if (dest === 'icu') {
      setBusy(true);
      try {
        say(await app.pushWorkout(date, workout, targets));
        setDest(null);
      } catch (e) {
        say(`Couldn’t send: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (dest === 'fit') download(`${base}${suffix}.fit`, workoutToFit(workout, targets) as BlobPart, 'application/vnd.ant.fit');
    if (dest === 'zwo') download(`${base}.zwo`, workoutToZwo(workout), 'application/xml');
    if (dest === 'mrc') download(`${base}.mrc`, workoutToMrc(workout), 'text/plain');
    if (dest === 'copy') {
      try {
        await navigator.clipboard.writeText(workoutDescription(workout, effMode, { targets, icuLthr: app.profile?.lthr ?? null }));
        say(`Copied in intervals.icu format — ${targetsLabel(targets, sport)}.`);
      } catch {
        say('Clipboard not available.');
      }
    } else say(`Exported ${DEST[dest].label} — ${powerOnly ? '% FTP (scaled by the app you open it in)' : targetsLabel(targets, sport)}.`);
    setDest(null);
  };

  return (
    <div className="stack" style={{ gap: 6 }}>
      {!compact && <span className="tiny muted" style={{ fontWeight: 600 }}>Export</span>}
      <div className="row" style={{ gap: 6 }}>
        {dests.map((d) => (
          <button
            key={d}
            className={`btn sm ${d === 'icu' ? 'primary' : d === 'copy' ? 'ghost' : ''} ${dest === d ? 'active' : ''}`}
            onClick={() => (dest === d ? setDest(null) : open(d))}
            disabled={d === 'icu' && !app.canPush}
            title={d === 'icu' && !app.canPush ? 'Connect intervals.icu in Settings first' : DEST[d].note}
          >
            {DEST[d].label}
          </button>
        ))}
      </div>

      {dest && (
        <div className="card stack export-confirm" style={{ gap: 10, padding: 12 }} role="dialog" aria-label="Confirm export targets">
          <div className="small" style={{ fontWeight: 600 }}>
            {DEST[dest].label}: export based on {sport === 'ride' ? 'power' : 'pace'} or heart rate?
          </div>
          {powerOnly ? (
            <p className="tiny muted">{DEST[dest].note} Use Garmin .FIT or intervals.icu for heart-rate targets.</p>
          ) : (
            <Seg<ExportMode>
              value={mode}
              onChange={setMode}
              ariaLabel="Export targets"
              options={[
                { value: 'power', label: sport === 'ride' ? 'Power' : 'Pace' },
                { value: 'hr', label: 'Heart rate' },
              ]}
            />
          )}
          {sport === 'run' && effMode === 'power' && (
            <label className="field">
              <span>Threshold pace (min:sec per km){app.profile?.runThresholdMps ? ` · intervals.icu: ${formatPace(app.profile.runThresholdMps, 'run')}` : ''}</span>
              <input className="input num" value={pace} placeholder="e.g. 4:30" onChange={(e) => setPace(e.target.value)} aria-label="Threshold pace for export" style={{ maxWidth: 140 }} />
              <span className="tiny muted">{dest === 'fit' ? (paceMps ? 'Garmin gets pace ranges for every step.' : 'Without a threshold pace the steps are by feel (open targets).') : 'intervals.icu shows the steps as % of the threshold pace in your intervals.icu settings.'}</span>
            </label>
          )}
          {sport === 'swim' && effMode === 'power' && <p className="tiny muted">Swim steps are % of your CSS (threshold swim pace) set in intervals.icu.</p>}
          {!powerOnly && sport === 'ride' && effMode === 'power' && (
            <label className="field">
              <span>FTP (W) · default is your eFTP{app.profile?.eftp ? ` (${Math.round(app.profile.eftp)} W)` : ''}</span>
              <input className="input num" type="number" min={50} max={700} value={ftp} onChange={(e) => setFtp(e.target.value)} aria-label="FTP for export" style={{ maxWidth: 140 }} />
            </label>
          )}
          {effMode === 'hr' && (
            <label className="field">
              <span>Threshold HR (bpm){app.profile?.lthr ? ` · yours in intervals.icu is ${app.profile.lthr}` : ''}</span>
              <input className="input num" type="number" min={100} max={220} value={lthr} placeholder="e.g. 170" onChange={(e) => setLthr(e.target.value)} aria-label="Threshold heart rate for export" style={{ maxWidth: 140 }} />
              <span className="tiny muted">Steps of 2 min or longer get bpm ranges; shorter efforts are ridden by feel.</span>
            </label>
          )}
          {!valid && <span className="tiny" style={{ color: 'var(--critical-ink)' }}>{effMode === 'hr' ? 'Enter a threshold HR between 100 and 220 bpm.' : sport === 'run' ? 'Enter pace as min:sec, e.g. 4:30.' : 'Enter an FTP between 50 and 700 W.'}</span>}
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm primary" onClick={confirm} disabled={!valid || busy}>
              {busy ? 'Sending…' : `${DEST[dest].action}${powerOnly ? '' : effMode === 'hr' ? ` · HR ${lthr} bpm` : sport === 'ride' ? ` · ${ftp} W` : sport === 'run' && paceMps ? ` · ${pace}/km` : ''}`}
            </button>
            <button className="btn sm ghost" onClick={() => setDest(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
