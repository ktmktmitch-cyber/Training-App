import { useState } from 'react';
import { addDays, dowLong, dowShort, fmtMinutes, fmtShort } from '../engine/dates';
import { workoutDescription } from '../engine/icuExport';
import { canChooseRest, PHASE_LABELS } from '../engine/periodization';
import type { DayConfig } from '../engine/types';
import { DayCard } from '../components/DayCard';
import { ComplianceStrip, NextWorkoutCard } from '../components/insights';
import { TagPicker } from '../components/JournalCard';
import { ReadinessCard } from '../components/ReadinessCard';
import { useToast } from '../components/ui';
import { WeekSetup } from '../components/WeekSetup';
import { DataGapNotes } from '../components/EmptyStates';
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
              <label className={`switch ${canChooseRest(mw) ? '' : 'disabled'}`} title={canChooseRest(mw) ? 'Easy riding only, ~40% less volume; the loading cycle restarts after it' : mw.weekType === 'recovery' ? 'The plan already has this as a recovery week' : 'Taper and race weeks can’t be rest weeks'}>
                <input
                  type="checkbox"
                  role="switch"
                  checked={mw.weekType === 'recovery' || !!mw.userRest}
                  disabled={!canChooseRest(mw)}
                  onChange={() => {
                    toggleRestWeek(app, mw.start);
                    showToast(mw.userRest ? 'Back to the normal plan for this week.' : 'Rest week on — easy riding only. Your next recovery week moves later.');
                  }}
                  aria-label="Rest week"
                />
                <span className="switch-track" aria-hidden />
                Rest week{mw.weekType === 'recovery' && !mw.userRest ? ' (planned)' : ''}
              </label>
            </div>
          )}
        </div>
      </div>

      {app.data.info && <div className="callout">{app.data.info}</div>}
      <DataGapNotes only={['hrv', 'rhr', 'sleep', 'stravaHidden']} />

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
          <div className="row" style={{ gap: 6 }}>
            <a
              className="btn sm ghost"
              href="#/settings"
              onClick={() => {
                try {
                  sessionStorage.setItem('ta.scrollTo', 'usual-week');
                } catch {
                  /* ignore */
                }
              }}
            >
              Edit usual week
            </a>
            <button className="btn sm" onClick={() => setEditing((e) => !e)}>
              {editing ? 'Done' : 'Edit this week'}
            </button>
          </div>
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
              {pushing ? 'Sending…' : 'Send now'}
            </button>
          </div>
        </div>
        {app.canPush && (
          <p className="tiny muted" style={{ margin: '0 0 8px' }} aria-live="polite">
            {app.autoPush.state === 'saving'
              ? 'Updating your intervals.icu calendar…'
              : app.autoPush.state === 'error'
                ? `Couldn’t update intervals.icu (${app.autoPush.error}) — it tries again on the next change, or tap Send now.`
                : `This week stays in sync with your intervals.icu calendar (and Garmin) automatically${app.autoPush.at ? ` · updated ${new Date(app.autoPush.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}.`}
          </p>
        )}
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
            customized={(!!week.days[d.date] && week.days[d.date].status !== 'available') || !!app.scheduled[d.date]}
            groupCfg={week.days[d.date]?.group ?? null}
            progression={app.progression}
            onToast={showToast}
            onSwap={(id, dur, level) => setDay(d.date, { ...(week.days[d.date] ?? { maxMinutes: null }), status: 'pinned', pinned: { workoutId: id, durationMin: dur, level } })}
            onRest={() => setDay(d.date, { ...(week.days[d.date] ?? { maxMinutes: null }), status: 'off' })}
            moveTargets={plan.days
              .filter((x) => x.date !== d.date && x.status !== 'off' && x.status !== 'race')
              .map((x) => ({ date: x.date, label: `${dowLong(x.date)} ${fmtShort(x.date)}${x.ride ? ` (${x.ride.name})` : ' (rest)'}` }))}
            movedTo={Object.entries(week.days).find(([, c]) => c.status === 'pinned' && c.pinned?.fromCoach && c.pinned.movedFrom === d.date)?.[0] ?? null}
            onMove={(to) => {
              const r = d.ride;
              if (!r) return;
              const days = { ...week.days };
              const src = days[d.date];
              const origin = src?.status === 'pinned' && src.pinned?.movedFrom ? src.pinned.movedFrom : d.date;
              const coach = !!r.why[0]?.startsWith('From your coach');
              if (r.fixed === 'calendar') days[d.date] = { ...(src ?? { maxMinutes: null }), status: 'available', skipCalendar: true, pinned: undefined };
              else if (origin !== d.date) delete days[d.date];
              else days[d.date] = { ...(src ?? { maxMinutes: null }), status: 'available', pinned: undefined };
              if (to === origin && coach) {
                // back where the coach put it
                delete days[to];
              } else {
                days[to] = { ...(days[to] ?? { maxMinutes: null }), status: 'pinned', pinned: { workoutId: r.templateId, durationMin: r.durationMin, level: r.level, movedFrom: origin, fromCoach: coach } };
              }
              app.schedule(to, null);
              app.setWeek({ ...week, days });
              showToast(`Moved “${r.name}” to ${dowLong(to)} — the rest of the week re-planned around it.`);
            }}
            onReset={() => {
              const mf = week.days[d.date]?.pinned?.movedFrom;
              if (mf) {
                const days = { ...week.days };
                delete days[d.date];
                if (days[mf]?.skipCalendar) delete days[mf];
                app.setWeek({ ...week, days });
                app.schedule(d.date, null);
                showToast('Moved workout put back.');
                return;
              }
              setDay(d.date, null);
              app.schedule(d.date, null);
              showToast('Back to the recommended workout.');
            }}
            onGroup={(g) => {
              app.schedule(d.date, null);
              setDay(d.date, { ...(week.days[d.date] ?? { maxMinutes: null }), status: 'group', group: g });
              showToast(`Group ride added — the rest of the week re-planned around it.`);
            }}
          />
        ))}
      </div>
      {toast}
    </>
  );
}
