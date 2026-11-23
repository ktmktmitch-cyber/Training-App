import { useState } from 'react';
import { safeFileName, workoutToFit, workoutToMrc } from '../engine/exporters';
import { workoutDescription } from '../engine/icuExport';
import { targetsLabel, type ExportMode, type ExportTargets } from '../engine/targets';
import type { ISODate, PlannedWorkout } from '../engine/types';
import { workoutToZwo } from '../engine/zwo';
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
  const base = safeFileName(workout.name);
  const say = (m: string) => onDone?.(m);
  if (!structured) return null;

  const open = (d: Dest) => {
    // Start from the defaults every time: power and your eFTP (or what the library shows)
    const b = defaults ?? app.exportDefaults;
    setMode(b.mode);
    setFtp(String(b.ftp));
    setLthr(b.lthr ? String(b.lthr) : lthr);
    setDest(d);
  };

  const ftpN = Number(ftp);
  const lthrN = Number(lthr);
  const powerOnly = dest ? !DEST[dest].hr : false;
  const effMode: ExportMode = powerOnly ? 'power' : mode;
  const valid = effMode === 'power' ? ftpN >= 50 && ftpN <= 700 : lthrN >= 100 && lthrN <= 220;
  const targets: ExportTargets = { mode: effMode, ftp: Math.round(ftpN), lthr: lthrN ? Math.round(lthrN) : null };
  const suffix = effMode === 'hr' ? `_HR${targets.lthr}` : `_${targets.ftp}W`;

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
        say(`Copied in intervals.icu format — ${targetsLabel(targets)}.`);
      } catch {
        say('Clipboard not available.');
      }
    } else say(`Exported ${DEST[dest].label} — ${powerOnly ? '% FTP (scaled by the app you open it in)' : targetsLabel(targets)}.`);
    setDest(null);
  };

  return (
    <div className="stack" style={{ gap: 6 }}>
      {!compact && <span className="tiny muted" style={{ fontWeight: 600 }}>Export</span>}
      <div className="row" style={{ gap: 6 }}>
        {(Object.keys(DEST) as Dest[]).map((d) => (
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
            {DEST[dest].label}: export based on power or heart rate?
          </div>
          {powerOnly ? (
            <p className="tiny muted">{DEST[dest].note} Use Garmin .FIT or intervals.icu for heart-rate targets.</p>
          ) : (
            <Seg<ExportMode>
              value={mode}
              onChange={setMode}
              ariaLabel="Export targets"
              options={[
                { value: 'power', label: 'Power' },
                { value: 'hr', label: 'Heart rate' },
              ]}
            />
          )}
          {!powerOnly && effMode === 'power' && (
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
          {!valid && <span className="tiny" style={{ color: 'var(--bad)' }}>{effMode === 'power' ? 'Enter an FTP between 50 and 700 W.' : 'Enter a threshold HR between 100 and 220 bpm.'}</span>}
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm primary" onClick={confirm} disabled={!valid || busy}>
              {busy ? 'Sending…' : `${DEST[dest].action}${powerOnly ? '' : effMode === 'hr' ? ` · HR ${lthr} bpm` : ` · ${ftp} W`}`}
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
