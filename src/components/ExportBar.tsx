import { useState } from 'react';
import { safeFileName, workoutToFit, workoutToMrc } from '../engine/exporters';
import { workoutDescription } from '../engine/icuExport';
import type { ISODate, PlannedWorkout } from '../engine/types';
import { workoutToZwo } from '../engine/zwo';
import { useApp } from '../lib/store';

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

/**
 * Export a workout everywhere it can go:
 *  - intervals.icu calendar (→ Garmin Connect / Wahoo / Zwift via intervals.icu sync)
 *  - Garmin .FIT workout (USB: copy to Garmin/NewFiles)
 *  - Zwift .zwo, .MRC (most indoor-trainer apps), intervals.icu text
 */
export function ExportBar({ workout, date, onDone, compact }: { workout: PlannedWorkout; date: ISODate; onDone?: (msg: string) => void; compact?: boolean }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const structured = workout.blocks.length > 0;
  const base = safeFileName(workout.name);
  const say = (m: string) => onDone?.(m);
  const send = async () => {
    setBusy(true);
    try {
      say(await app.pushWorkout(date, workout));
    } catch (e) {
      say(`Couldn’t send: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  if (!structured) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {!compact && <span className="tiny muted" style={{ fontWeight: 600 }}>Export</span>}
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm primary" onClick={send} disabled={!app.canPush || busy} title={app.canPush ? 'Adds it to your intervals.icu calendar, which syncs to Garmin/Wahoo/Zwift' : 'Connect intervals.icu in Settings first'}>
          {busy ? 'Sending…' : 'Send to intervals.icu'}
        </button>
        <button className="btn sm" onClick={() => download(`${base}.fit`, workoutToFit(workout) as BlobPart, 'application/vnd.ant.fit')} title="Garmin workout file — copy to the Garmin/NewFiles folder on your Edge or watch">
          Garmin .FIT
        </button>
        <button className="btn sm" onClick={() => download(`${base}.zwo`, workoutToZwo(workout), 'application/xml')} title="Zwift workout file">
          Zwift .zwo
        </button>
        <button className="btn sm" onClick={() => download(`${base}.mrc`, workoutToMrc(workout), 'text/plain')} title="% FTP course file for most indoor-trainer apps">
          .MRC
        </button>
        <button
          className="btn sm ghost"
          onClick={() =>
            navigator.clipboard
              .writeText(workoutDescription(workout, app.settings.prefs.targetMode))
              .then(() => say('Copied in intervals.icu workout-builder format.'))
              .catch(() => say('Clipboard not available.'))
          }
        >
          Copy text
        </button>
      </div>
    </div>
  );
}
