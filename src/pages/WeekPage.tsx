import { useState } from 'react';
import { addDays, dowShort, fmtMinutes, fmtShort } from '../engine/dates';
import { workoutDescription } from '../engine/icuExport';
import { canChooseRest, PHASE_LABELS } from '../engine/periodization';
import type { DayConfig } from '../engine/types';
import { DayCard } from '../components/DayCard';
import { ComplianceStrip, NextWorkoutCard } from '../components/insights';
import { TagPicker } from '../components/JournalCard';
import { ReadinessCard } from '../components/ReadinessCard';
import { Seg, useToast } from '../components/ui';
import { WeekSetup } from '../components/WeekSetup';
import { toggleRestWeek } from '../lib/restWeeks';
import { useApp } from '../lib/store';

export function WeekPage() {
  const app = useApp();
  const { plan, week, startDate, settings } = app;
  const [editing, setEditing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [toast, showToast] = useToast();

  const setDay = (date: string, cfg: DayConfig | null) => {
    const days = { ...week.days };
    if (cfg) days[date] = cfg;
    else delete days[date];
    app.setWeek({ ...week, days });
  };

  const blocked = plan.days.filter((d) => d.status === 'off').map((d) => dowShort(d.date));
  const groups = plan.days.filter((d) => d.status === 'group').map((d) => dowShort(d.date));
  const mw = plan.macroWeek;

  const doPush = async () => {
    setPushing(true);
    try {
      showToast(await app.push(plan));
    } catch (e) {
      showToast(`Couldn’t send: ${(e as Error).message}`);
    } finally {
      setPushing(false);
    }
  };

  const copyText = async () => {
    const lines = plan.days.map((d) => {
      const r = d.ride;
      const head = `${dowShort(d.date)} ${fmtShort(d.date)}: ${r ? `${r.name} (${fmtMinutes(r.durationMin)}, ${r.tss} TSS)` : 'Rest'}${d.strength ? ` + Strength (${d.strength.title})` : ''}`;
      return r && r.blocks.length ? `${head}\n${workoutDescription(r, settings.prefs.targetMode)}` : head;
    });
    try {
      await navigator.clipboard.writeText(lines.join('\n\n'));
      showToast('Week copied to clipboard.');
    } catch {
      showToast('Clipboard not available in this browser.');
    }
  };

  return (
    <>
      <div className="row">
        <div className="stack" style={{ gap: 2 }}>
          <h1>
            Your week · {fmtShort(startDate)} – {fmtShort(addDays(startDate, 6))}
          </h1>
          {mw && (
            <div className="row small ink2">
              <span className="chip">
                {PHASE_LABELS[mw.phase]} {mw.weekInPhase}/{mw.phaseWeeks}
              </span>
              {mw.weekType !== 'load' && <span className="chip">{mw.weekType === 'hit_block' ? 'HIT block' : `${mw.weekType} week`}</span>}
              <span>{mw.focus}</span>
              {canChooseRest(mw) && (
                <button
                  className={`btn sm ${mw.userRest ? 'ghost' : ''}`}
                  onClick={() => {
                    toggleRestWeek(app, mw.start);
                    showToast(mw.userRest ? 'Back to the normal plan for this week.' : 'Rest week set — easy riding only. Your next recovery week moves later.');
                  }}
                  title="A planned easy week: ~40% less volume and no hard sessions. The loading cycle restarts after it."
                >
                  {mw.userRest ? 'Undo rest week' : 'Make this a rest week'}
                </button>
              )}
            </div>
          )}
        </div>
        <span className="spacer" />
        <Seg<0 | 1>
          value={settings.startOffset}
          onChange={(v) => app.updateSettings((s) => ({ ...s, startOffset: v }))}
          ariaLabel="Plan start"
          options={[
            { value: 1, label: 'From tomorrow' },
            { value: 0, label: 'From today' },
          ]}
        />
      </div>

      {app.data.info && <div className="callout">{app.data.info}</div>}

      <NextWorkoutCard
        day={plan.days[0]}
        readiness={app.readiness}
        status={app.status}
        ftp={app.ftp}
        isToday={plan.days[0].date === app.asOf}
        progression={app.progression}
        weightKg={app.profile?.weightKg ?? null}
        onPick={(id, dur, level) => setDay(plan.days[0].date, { ...(week.days[plan.days[0].date] ?? { maxMinutes: null }), status: 'pinned', pinned: { workoutId: id, durationMin: dur, level } })}
        onToast={showToast}
      />

      <ReadinessCard
        r={app.readiness}
        asOf={app.asOf}
        checkIn={app.checkIn}
        onCheckIn={app.setCheckIn}
        extra={
          <details className="more" open={Boolean(app.journal[addDays(app.asOf, -1)]?.length)}>
            <summary>Anything unusual yesterday? (alcohol, cannabis, late heavy meal, travel…)</summary>
            <div style={{ marginTop: 8 }}>
              <TagPicker date={addDays(app.asOf, -1)} journal={app.journal} onChange={app.setJournalTags} />
              <p className="tiny muted" style={{ marginTop: 6 }}>
                Explains this morning’s HRV / resting HR. Where it’s biologically justified, the night is kept out of your baseline and 7-day trend. <a href="#/progress?tab=recovery">Journal & personal impact →</a>
              </p>
            </div>
          </details>
        }
      />

      <ComplianceStrip days={app.compliance} feedback={app.feedback} onFeedback={app.setFeedback} />

      <div className="card">
        <div className="card-head" style={{ marginBottom: editing ? 12 : 0 }}>
          <div className="stack" style={{ gap: 2 }}>
            <h2>Availability</h2>
            <span className="small ink2">
              {week.hours} h available
              {blocked.length ? ` · can’t train ${blocked.join(', ')}` : ''}
              {groups.length ? ` · group ride ${groups.join(', ')}` : ''}
            </span>
          </div>
          <button className="btn sm" onClick={() => setEditing((e) => !e)}>
            {editing ? 'Done' : 'Edit this week'}
          </button>
        </div>
        {editing && <WeekSetup week={week} onChange={app.setWeek} onSaveUsual={() => { app.saveAsUsual(week); showToast('Saved as your usual week.'); }} onResetUsual={app.resetWeek} />}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Plan summary</h2>
          <div className="row">
            <button className="btn sm ghost" onClick={copyText}>
              Copy as text
            </button>
            <button className="btn sm primary" disabled={!app.canPush || pushing} onClick={doPush} title={app.canPush ? '' : 'Connect intervals.icu in Settings to send workouts'}>
              {pushing ? 'Sending…' : 'Send to intervals.icu'}
            </button>
          </div>
        </div>
        <ul className="why">
          {plan.summary.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
        {plan.warnings.length > 0 && (
          <div className="callout warn" style={{ marginTop: 10 }}>
            {plan.warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}
        {!app.canPush && (
          <p className="tiny muted" style={{ marginTop: 8 }}>
            Connect intervals.icu in Settings to send these as structured workouts to your calendar — they then sync to your Garmin.
          </p>
        )}
      </div>

      <div className="days">
        {plan.days.map((d) => (
          <DayCard
            key={d.date}
            day={d}
            ftp={app.ftp}
            profile={app.profile}
            mode={settings.prefs.targetMode}
            isToday={d.date === app.asOf}
            customized={!!week.days[d.date] && week.days[d.date].status !== 'available'}
            progression={app.progression}
            onToast={showToast}
            onSwap={(id, dur, level) => setDay(d.date, { ...(week.days[d.date] ?? { maxMinutes: null }), status: 'pinned', pinned: { workoutId: id, durationMin: dur, level } })}
            onRest={() => setDay(d.date, { ...(week.days[d.date] ?? { maxMinutes: null }), status: 'off' })}
            onReset={() => {
              setDay(d.date, null);
              app.schedule(d.date, null);
            }}
          />
        ))}
      </div>
      {toast}
    </>
  );
}
