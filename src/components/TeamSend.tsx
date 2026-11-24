import { useEffect, useRef, useState } from 'react';
import { addDays, fmtLong } from '../engine/dates';
import type { ExportMode } from '../engine/targets';
import type { WorkoutTemplate } from '../engine/workouts';
import { sendToRiders, type SendResult } from '../lib/coach';
import { useApp } from '../lib/store';
import { useTeam } from '../lib/team';
import { Seg } from './ui';

/** Coach: send this library workout to several (or all) riders on the same day. */
export function TeamSend({ t, durationMin, level }: { t: WorkoutTemplate; durationMin: number; level: number }) {
  const app = useApp();
  const team = useTeam();
  const riders = (team.team?.riders ?? []).filter((r) => r.state === 'ok');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(riders.map((r) => r.id)));
  const [date, setDate] = useState(addDays(app.asOf, 1));
  const [mode, setMode] = useState<ExportMode>('power');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const inited = useRef(riders.length > 0);
  useEffect(() => {
    if (!inited.current && riders.length) {
      inited.current = true;
      setPicked(new Set(riders.map((r) => r.id)));
    }
  }, [riders]);
  const coach = team.source === 'url' && app.canPush && (!app.account || app.account.role === 'coach');
  if (!coach || !riders.length) return null;
  const sel = riders.filter((r) => picked.has(r.id));
  const all = sel.length === riders.length;
  const sport = t.sport ?? 'ride';

  const send = async () => {
    setResults(null);
    setBusy(0);
    const res = await sendToRiders(app.getConnection(), sel, t, durationMin, level, date, mode, note, (n) => setBusy(n));
    setBusy(null);
    setResults(res);
    // Sent to yourself too: refresh your own calendar so it shows in your week right away
    if (res.some((x) => x.ok && x.rider.id === app.data.profile?.id)) app.sync().catch(() => {});
  };

  return (
    <details className="more team-send">
      <summary>
        <b>Coach: send to riders</b> <span className="tiny muted">— the same workout, same day, scaled to each rider</span>
      </summary>
      <div className="stack" style={{ marginTop: 10 }}>
        <div className="rider-checklist" role="group" aria-label="Riders">
          <label className="check rider-all">
            <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = sel.length > 0 && !all; }} onChange={() => setPicked(all ? new Set() : new Set(riders.map((r) => r.id)))} />
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
                }}
              />
              <span>{r.rider}</span>
            </label>
          ))}
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '0 1 170px' }}>
            <span>Day</span>
            <input className="input" type="date" min={app.asOf} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Team workout date" />
          </label>
          <div className="field">
            <span>Targets</span>
            <Seg<ExportMode>
              value={mode}
              onChange={setMode}
              ariaLabel="Team targets"
              options={[
                { value: 'power', label: sport === 'ride' ? 'Power (their FTP)' : 'Pace (their threshold)' },
                { value: 'hr', label: 'Heart rate (their LTHR)' },
              ]}
            />
          </div>
        </div>
        <label className="field">
          <span>Note to riders (optional)</span>
          <input className="input" value={note} placeholder="e.g. Team session — meet at the shop 6pm, or ride it on Zwift" onChange={(e) => setNote(e.target.value)} aria-label="Note to riders" />
        </label>
        <div className="row">
          <button className="btn primary" disabled={!sel.length || busy != null} onClick={send}>
            {busy != null ? `Sending ${busy}/${sel.length}…` : `Send to ${all ? 'everyone' : `${sel.length} rider${sel.length === 1 ? '' : 's'}`} · ${fmtLong(date)}`}
          </button>
          <span className="tiny muted">Sent as % of FTP / HR zones, so each rider gets their own watts or bpm — and they can adjust it in their week.</span>
        </div>
        {results && (
          <ul className="weeks-off" aria-label="Send results">
            {results.map((r) => (
              <li key={r.rider.id}>
                <span className={`chip ${r.ok ? 'on' : ''}`}>{r.ok ? '✓ Sent' : '✗ Not sent'}</span>
                <b>{r.rider.rider}</b>
                <span className="tiny muted">{r.detail}</span>
              </li>
            ))}
          </ul>
        )}
        {results?.some((r) => !r.ok) && <p className="tiny muted">Riders marked “not sent” need to add you as their coach in intervals.icu (Settings → Coaches) with permission to edit their calendar.</p>}
      </div>
    </details>
  );
}
