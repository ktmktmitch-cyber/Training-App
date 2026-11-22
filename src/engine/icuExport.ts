// Convert planned workouts into intervals.icu workout-builder text so they appear as
// structured workouts on the intervals.icu calendar (and sync on to Garmin/Zwift/Wahoo).
// Syntax: section headers ("Main set 5x"), steps "- 4m 110-118% 95rpm", "ramp" for ramps.
import type { AthleteProfile, Block, PlannedDay, PlannedWorkout, Step, StrengthSession, TargetMode } from './types';

function fmtDur(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h && !m && !r) return `${h}h`;
  if (!h && m && !r) return `${m}m`;
  if (!h && !m) return `${r}s`;
  if (h) return `${h}h${m ? `${m}m` : ''}${r ? `${r}s` : ''}`;
  return `${m}m${r}s`;
}

/** Map a %FTP target to an intervals.icu HR zone (approximate Coggan power → HR zones). */
function hrZoneFor(pct: number): string {
  if (pct < 56) return 'Z1 HR';
  if (pct < 76) return 'Z2 HR';
  if (pct < 91) return 'Z3 HR';
  if (pct < 106) return 'Z4 HR';
  return 'Z5 HR';
}

function stepLine(st: Step, mode: TargetMode): string {
  const dur = fmtDur(st.durationSec);
  let target: string;
  if (mode === 'hr' && st.durationSec >= 120) {
    target = hrZoneFor((st.low + st.high) / 2);
  } else if (st.ramp) {
    target = `ramp ${Math.round(st.low)}-${Math.round(st.high)}%`;
  } else if (Math.round(st.low) === Math.round(st.high)) {
    target = `${Math.round(st.low)}%`;
  } else {
    target = `${Math.round(st.low)}-${Math.round(st.high)}%`;
  }
  const cad = st.cadence ? ` ${st.cadence.replace(/\s/g, '').replace(/\+rpm$/, 'rpm')}` : '';
  const label = st.label ? `${st.label} ` : '';
  return `- ${label}${dur} ${target}${cad}`;
}

export function blocksToIcuText(blocks: Block[], mode: TargetMode): string {
  const out: string[] = [];
  blocks.forEach((b, i) => {
    const header = b.reps > 1 ? `${b.name ?? 'Set'} ${b.reps}x` : b.name ?? (i === 0 ? 'Warmup' : 'Recover');
    out.push(header);
    for (const st of b.steps) out.push(stepLine(st, mode));
    out.push('');
  });
  return out.join('\n').trim();
}

export function workoutDescription(w: PlannedWorkout, mode: TargetMode): string {
  const parts = [w.purpose];
  if (w.blocks.length) parts.push('', blocksToIcuText(w.blocks, mode));
  if (w.fueling) parts.push('', `Fueling: ${w.fueling}`);
  if (mode === 'hr') parts.push('', 'Short efforts (<2 min) keep power targets — ride them by feel (RPE 9) if you have no power meter.');
  return parts.join('\n');
}

export function strengthDescription(s: StrengthSession): string {
  const lines = [s.focus, '', ...s.exercises.map((e) => `• ${e.name}: ${e.sets} × ${e.reps} @ ${e.load}, rest ${e.rest}${e.notes ? ` — ${e.notes}` : ''}`)];
  lines.push('', s.timing);
  return lines.join('\n');
}

export interface IcuEvent {
  category: 'WORKOUT' | 'NOTE';
  start_date_local: string;
  type: string;
  name: string;
  description: string;
  moving_time?: number;
  icu_training_load?: number;
  external_id: string;
}

export const EXTERNAL_PREFIX = 'trainingapp';

export function dayToIcuEvents(day: PlannedDay, _profile: AthleteProfile, mode: TargetMode): IcuEvent[] {
  const out: IcuEvent[] = [];
  const start = `${day.date}T00:00:00`;
  const r = day.ride;
  // Don't duplicate events the athlete already has (group rides are added as notes-only workouts, races are on the calendar)
  if (r && r.category !== 'race') {
    out.push({
      category: 'WORKOUT',
      start_date_local: start,
      type: 'Ride',
      name: r.name,
      description: r.fixed === 'group' ? `${r.purpose}\n\nFueling: ${r.fueling}` : workoutDescription(r, mode),
      moving_time: Math.round(r.durationMin * 60),
      icu_training_load: r.tss,
      external_id: `${EXTERNAL_PREFIX}-${day.date}-ride`,
    });
  }
  if (day.strength) {
    out.push({
      category: 'WORKOUT',
      start_date_local: start,
      type: 'WeightTraining',
      name: `Strength — ${day.strength.title}`,
      description: strengthDescription(day.strength),
      moving_time: day.strength.durationMin * 60,
      external_id: `${EXTERNAL_PREFIX}-${day.date}-strength`,
    });
  }
  return out;
}

export function allExternalIdsFor(date: string): string[] {
  return [`${EXTERNAL_PREFIX}-${date}-ride`, `${EXTERNAL_PREFIX}-${date}-strength`];
}
