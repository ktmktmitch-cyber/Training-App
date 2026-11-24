// Convert planned workouts into intervals.icu workout-builder text so they appear as
// structured workouts on the intervals.icu calendar (and sync on to Garmin/Zwift/Wahoo).
// Syntax: section headers ("Main set 5x"), steps "- 4m 110-118% 95rpm", "ramp" for ramps.
import { hrBand, hrSteerable, wattBand, type ExportTargets } from './targets';
import type { AthleteProfile, Block, PlannedDay, PlannedWorkout, Step, StrengthSession, TargetMode } from './types';

/**
 * Absolute targets for an export: watts from the chosen FTP, or heart rate from the chosen
 * threshold HR. intervals.icu stores HR as % of the LTHR in its own settings, so bpm are
 * converted against `icuLthr` (falls back to the chosen LTHR) to land on the right numbers.
 */
export interface AbsTargets {
  targets: ExportTargets;
  icuLthr?: number | null;
}

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

function stepLine(st: Step, mode: TargetMode, abs?: AbsTargets, sport: 'ride' | 'run' | 'swim' = 'ride'): string {
  const dur = fmtDur(st.durationSec);
  let target: string;
  const t = abs?.targets;
  if (sport !== 'ride') {
    // Runs & swims: % of threshold pace (intervals.icu "% Pace"), or HR zones for long steps in HR mode
    const hr = (t?.mode ?? mode) === 'hr' && st.durationSec >= 120;
    if (hr) target = hrZoneFor((st.low + st.high) / 2);
    else if (st.ramp) target = `ramp ${Math.round(st.low)}-${Math.round(st.high)}% Pace`;
    else target = Math.round(st.low) === Math.round(st.high) ? `${Math.round(st.low)}% Pace` : `${Math.round(st.low)}-${Math.round(st.high)}% Pace`;
    const label = st.label ? `${st.label} ` : '';
    return `- ${label}${dur} ${target}`;
  }
  if (t?.mode === 'hr' && t.lthr && hrSteerable(st)) {
    const ref = abs?.icuLthr || t.lthr;
    const [lo, hi] = hrBand(st, t.lthr);
    target = `${Math.round((lo / ref) * 100)}-${Math.round((hi / ref) * 100)}% LTHR`;
  } else if (t?.mode === 'power' || (t?.mode === 'hr' && !hrSteerable(st))) {
    const ftp = t.ftp;
    if (st.ramp) target = `ramp ${Math.round((st.low * ftp) / 100)}-${Math.round((st.high * ftp) / 100)}w`;
    else {
      const [lo, hi] = wattBand(st, ftp);
      target = lo === hi ? `${lo}w` : `${lo}-${hi}w`;
    }
  } else if (mode === 'hr' && st.durationSec >= 120) {
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

export function blocksToIcuText(blocks: Block[], mode: TargetMode, abs?: AbsTargets, sport: 'ride' | 'run' | 'swim' = 'ride'): string {
  const out: string[] = [];
  blocks.forEach((b, i) => {
    const header = b.reps > 1 ? `${b.name ?? 'Set'} ${b.reps}x` : b.name ?? (i === 0 ? 'Warmup' : 'Recover');
    out.push(header);
    for (const st of b.steps) out.push(stepLine(st, mode, abs, sport));
    out.push('');
  });
  return out.join('\n').trim();
}

export function workoutDescription(w: PlannedWorkout, mode: TargetMode, abs?: AbsTargets): string {
  const parts = [w.purpose];
  const t = abs?.targets;
  const sport = w.sport ?? 'ride';
  if (t) parts.push('', t.mode === 'hr' ? `Targets: heart rate, threshold HR ${t.lthr} bpm.` : sport === 'ride' ? `Targets: power, FTP ${t.ftp} W.` : `Targets: % of threshold ${sport === 'swim' ? 'swim pace (CSS)' : 'pace'}.`);
  if (w.blocks.length) parts.push('', blocksToIcuText(w.blocks, t ? t.mode : mode, abs, sport));
  if (w.fueling) parts.push('', `Fueling: ${w.fueling}`);
  if ((t ? t.mode : mode) === 'hr') parts.push('', sport === 'ride' ? 'Short efforts (<2 min) keep power targets — ride them by feel (RPE 9) if you have no power meter.' : 'Short efforts (<2 min) keep pace targets — run/swim them by feel.');
  return parts.join('\n');
}

export function strengthDescription(s: StrengthSession): string {
  const lines = [s.focus, '', ...s.exercises.map((e) => `• ${e.name}: ${e.sets} × ${e.reps} @ ${e.load}, rest ${e.rest}${e.notes ? ` — ${e.notes}` : ''}`)];
  lines.push('', s.timing);
  return lines.join('\n');
}

export interface IcuEvent {
  category: 'WORKOUT' | 'NOTE' | 'RACE_A' | 'RACE_B' | 'RACE_C' | 'HOLIDAY';
  start_date_local: string;
  type: string;
  name: string;
  description: string;
  moving_time?: number;
  icu_training_load?: number;
  external_id: string;
}

export const EXTERNAL_PREFIX = 'trainingapp';

/** intervals.icu activity type for each sport */
export const ICU_TYPE: Record<'ride' | 'run' | 'swim', string> = { ride: 'Ride', run: 'Run', swim: 'Swim' };

export function dayToIcuEvents(day: PlannedDay, _profile: AthleteProfile, mode: TargetMode): IcuEvent[] {
  const out: IcuEvent[] = [];
  const start = `${day.date}T00:00:00`;
  const r = day.ride;
  // Don't duplicate events the athlete already has (group rides are added as notes-only workouts, races are on the calendar)
  if (r && r.category !== 'race' && r.fixed !== 'calendar') {
    out.push({
      category: 'WORKOUT',
      start_date_local: start,
      type: ICU_TYPE[r.sport ?? 'ride'],
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
  (day.extras ?? []).forEach((w, i) => {
    out.push({
      category: 'WORKOUT',
      start_date_local: start,
      type: ICU_TYPE[w.sport ?? 'ride'],
      name: w.name,
      description: workoutDescription(w, mode),
      moving_time: Math.round(w.durationMin * 60),
      icu_training_load: w.tss,
      external_id: `${EXTERNAL_PREFIX}-${day.date}-x${i}`,
    });
  });
  if (day.mobility) {
    out.push({
      category: 'WORKOUT',
      start_date_local: start,
      type: 'Workout',
      name: `Mobility — ${day.mobility.minutes} min`,
      description: [day.mobility.title, '', ...day.mobility.moves.map((m) => `• ${m.name}: ${m.dose} — ${m.how}`), '', day.mobility.note].join('\n'),
      moving_time: day.mobility.minutes * 60,
      external_id: `${EXTERNAL_PREFIX}-${day.date}-mobility`,
    });
  }
  return out;
}

export function allExternalIdsFor(date: string): string[] {
  return [`${EXTERNAL_PREFIX}-${date}-ride`, `${EXTERNAL_PREFIX}-${date}-strength`, `${EXTERNAL_PREFIX}-${date}-mobility`, ...[0, 1, 2, 3].map((i) => `${EXTERNAL_PREFIX}-${date}-x${i}`)];
}
