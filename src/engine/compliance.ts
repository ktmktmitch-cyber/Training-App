// Planned vs completed (inspired by TrainingPeaks' compliance colours and JOIN's
// "missed it or swapped it for a group ride? the plan adapts").
import { diffDays } from './dates';
import type { Activity, CalendarEvent, ISODate } from './types';

export interface PlanSnapshot {
  date: ISODate;
  name: string;
  templateId: string;
  durationMin: number;
  tss: number;
  key: boolean;
}

export type ComplianceColor = 'green' | 'yellow' | 'orange' | 'red' | 'unplanned' | 'rest' | 'pending';

export interface ComplianceDay {
  date: ISODate;
  planned: { name: string; sec: number | null; tss: number | null; key: boolean; templateId: string | null; source: 'intervals' | 'app' } | null;
  done: Activity[];
  ratio: number | null;
  color: ComplianceColor;
  label: string;
}

// Every endurance sport counts for planned-vs-done; strength sessions are tracked separately
const NOT_ENDURANCE = new Set(['WeightTraining', 'Workout', 'Yoga', 'Pilates']);

/** ride / run / swim / other — so a planned run is compared with the run you did, not the ride */
export function sportFamily(type: string | null | undefined): string {
  const t = (type ?? '').toLowerCase();
  if (!t) return 'any';
  if (t.includes('ride') || t.includes('cycl') || t === 'velomobile') return 'ride';
  if (t.includes('run') || t === 'walk' || t === 'hike') return 'run';
  if (t.includes('swim')) return 'swim';
  return 'other';
}

export function computeCompliance(
  days: ISODate[],
  asOf: ISODate,
  events: CalendarEvent[],
  activities: Activity[],
  snapshots: Record<ISODate, PlanSnapshot>,
): ComplianceDay[] {
  return days.map((date) => {
    const evs = events.filter((e) => e.date === date && e.category === 'WORKOUT' && !NOT_ENDURANCE.has(e.type ?? ''));
    const snap = snapshots[date];
    let planned: ComplianceDay['planned'] = null;
    if (evs.length) {
      planned = {
        name: evs.map((e) => e.name).join(' + '),
        sec: evs.reduce((a, e) => a + (e.plannedSec ?? 0), 0) || null,
        tss: evs.reduce((a, e) => a + (e.plannedTss ?? 0), 0) || null,
        key: snap?.key ?? false,
        templateId: snap && evs.some((e) => e.externalId?.startsWith('trainingapp')) ? snap.templateId : null,
        source: 'intervals',
      };
    } else if (snap) {
      planned = { name: snap.name, sec: snap.durationMin * 60, tss: snap.tss, key: snap.key, templateId: snap.templateId, source: 'app' };
    }
    const allDone = activities.filter((a) => a.date === date && !a.isStrength && !NOT_ENDURANCE.has(a.type));
    // Planned by sport on the calendar: only compare the same sports
    const fams = new Set(evs.map((e) => sportFamily(e.type)));
    const done = evs.length && !fams.has('any') ? allDone.filter((a) => fams.has(sportFamily(a.type))) : allDone;
    const doneTss = done.reduce((a, x) => a + (x.tss ?? 0), 0);
    const doneSec = done.reduce((a, x) => a + x.movingSec, 0);
    let ratio: number | null = null;
    if (planned && done.length) {
      if (planned.tss && doneTss) ratio = doneTss / planned.tss;
      else if (planned.sec) ratio = doneSec / planned.sec;
    }
    let color: ComplianceColor;
    let label: string;
    if (!planned) {
      color = done.length ? 'unplanned' : 'rest';
      label = done.length ? 'Unplanned session' : 'Rest';
    } else if (!done.length) {
      color = diffDays(asOf, date) > 0 ? 'red' : 'pending';
      label = color === 'red' ? 'Missed' : 'Planned';
    } else if (ratio == null) {
      color = 'green';
      label = 'Done';
    } else if (ratio >= 0.8 && ratio <= 1.2) {
      color = 'green';
      label = `${Math.round(ratio * 100)}% of plan`;
    } else if ((ratio >= 0.5 && ratio < 0.8) || (ratio > 1.2 && ratio <= 1.5)) {
      color = 'yellow';
      label = `${Math.round(ratio * 100)}% of plan`;
    } else {
      color = 'orange';
      label = `${Math.round(ratio * 100)}% of plan`;
    }
    return { date, planned, done, ratio, color, label };
  });
}

/** Key sessions missed in the last few days that are worth rescheduling. */
export function missedKeySessions(compliance: ComplianceDay[], asOf: ISODate, withinDays = 3): { date: ISODate; templateId: string; name: string }[] {
  return compliance
    .filter((c) => c.color === 'red' && c.planned?.key && c.planned.templateId && diffDays(asOf, c.date) <= withinDays && diffDays(asOf, c.date) > 0)
    .map((c) => ({ date: c.date, templateId: c.planned!.templateId!, name: c.planned!.name }));
}
