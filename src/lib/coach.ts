// Coach tools: put a workout on riders' intervals.icu calendars (coach access needed).
import { ICU_TYPE, workoutDescription } from '../engine/icuExport';
import { instantiate } from '../engine/planner';
import type { ExportMode } from '../engine/targets';
import type { TeamRider } from '../engine/team';
import type { AthleteProfile, ISODate } from '../engine/types';
import type { WorkoutTemplate } from '../engine/workouts';
import { COACH_PREFIX, fetchRiderCalendar, pushEvents, type Connection } from './intervals';

export function coachError(e: Error, name: string): string {
  return /403|forbidden|permission/i.test(e.message)
    ? `${name} hasn’t added you as their coach on intervals.icu (or not with permission to edit their calendar).`
    : e.message;
}

export interface SendResult {
  rider: TeamRider;
  ok: boolean;
  detail: string;
}

/**
 * Send one library workout to several riders on the same day. Each rider gets it scaled to
 * their own numbers: power from their FTP in intervals.icu (or eFTP from the team data), heart
 * rate from their LTHR; runs and swims as % of their own threshold pace.
 */
export async function sendToRiders(
  conn: Connection,
  riders: TeamRider[],
  t: WorkoutTemplate,
  durationMin: number,
  level: number,
  date: ISODate,
  mode: ExportMode,
  note: string,
  onProgress?: (done: number) => void,
): Promise<SendResult[]> {
  const out: SendResult[] = [];
  const queue = [...riders];
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const r = queue.shift()!;
      try {
        const profile: AthleteProfile | null = (await fetchRiderCalendar(conn, r.id, date, date)).profile;
        const ftp = Math.round(profile?.ftp ?? profile?.eftp ?? r.eftp_watts ?? 0);
        const lthr = (t.sport === 'run' ? profile?.runLthr : null) ?? profile?.lthr ?? null;
        if ((t.sport ?? 'ride') === 'ride' && mode === 'power' && !ftp) throw new Error(`no FTP for ${r.rider} — set one in intervals.icu`);
        if (mode === 'hr' && !lthr) throw new Error(`no threshold HR for ${r.rider} in intervals.icu — use power/pace instead`);
        const w = instantiate(t, durationMin, level, profile?.weightKg ?? null, undefined, []);
        const targets = { mode, ftp, lthr };
        const desc = [note.trim() ? `Coach: ${note.trim()}` : '', workoutDescription(w, mode, (t.sport ?? 'ride') === 'ride' ? { targets, icuLthr: profile?.lthr ?? null } : undefined)].filter(Boolean).join('\n\n');
        await pushEvents(
          { ...conn, athleteId: r.id },
          [
            {
              category: 'WORKOUT',
              start_date_local: `${date}T00:00:00`,
              type: ICU_TYPE[t.sport ?? 'ride'],
              name: w.name,
              description: desc,
              moving_time: Math.round(w.durationMin * 60),
              icu_training_load: w.tss,
              external_id: `${COACH_PREFIX}-${date}-${w.templateId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
            },
          ],
          [],
        );
        out.push({ rider: r, ok: true, detail: (t.sport ?? 'ride') === 'ride' ? (mode === 'hr' ? `HR ${lthr} bpm` : `FTP ${ftp} W`) : mode === 'hr' ? `HR ${lthr} bpm` : 'their threshold pace' });
      } catch (e) {
        out.push({ rider: r, ok: false, detail: coachError(e as Error, r.rider) });
      }
      onProgress?.(++done);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return riders.map((r) => out.find((x) => x.rider.id === r.id)!);
}
