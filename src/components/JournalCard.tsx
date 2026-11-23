import { useState } from 'react';
import { addDays, fmtLong } from '../engine/dates';
import { TAG_BY_KEY, TAGS, type Journal, type TagImpact, type TagKey } from '../engine/journal';
import type { ISODate } from '../engine/types';

/** Quick tag toggles for one evening (used on the Week page for "last night"). */
export function TagPicker({ date, journal, onChange, label }: { date: ISODate; journal: Journal; onChange: (date: ISODate, tags: TagKey[]) => void; label?: string }) {
  const cur = journal[date] ?? [];
  const toggle = (k: TagKey) => {
    let next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    // the two alcohol tags are mutually exclusive
    if (k === 'alcohol_light' && next.includes('alcohol_light')) next = next.filter((x) => x !== 'alcohol_heavy');
    if (k === 'alcohol_heavy' && next.includes('alcohol_heavy')) next = next.filter((x) => x !== 'alcohol_light');
    onChange(date, next);
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      {label && (
        <span className="small" style={{ fontWeight: 600 }}>
          {label}
        </span>
      )}
      <div className="tagchips">
        {TAGS.map((t) => (
          <button key={t.key} type="button" className={`tagchip ${cur.includes(t.key) ? 'on' : ''}`} onClick={() => toggle(t.key)} title={t.why} aria-pressed={cur.includes(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function JournalCard({ journal, onChange, impacts, asOf }: { journal: Journal; onChange: (date: ISODate, tags: TagKey[]) => void; impacts: TagImpact[]; asOf: ISODate }) {
  const [date, setDate] = useState(addDays(asOf, -1));
  const entries = Object.entries(journal)
    .filter(([, t]) => t.length)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 12);
  return (
    <div className="card stack-lg">
      <div className="stack" style={{ gap: 2 }}>
        <h2>Journal</h2>
        <span className="small ink2">
          Log what happened the day/evening before an unusual reading. Where it’s biologically justified, those mornings are kept out of your HRV / resting-HR baseline and
          your 7-day trend, so one night out doesn’t rewrite your normal ranges or cut a week of training.
        </span>
      </div>
      <div className="row">
        <label className="field">
          <span>Day / evening of</span>
          <input className="input" type="date" value={date} max={asOf} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <span className="small muted" style={{ alignSelf: 'flex-end', paddingBottom: 8 }}>
          affects the reading on {fmtLong(addDays(date, 1))}
        </span>
      </div>
      <TagPicker date={date} journal={journal} onChange={onChange} />

      {entries.length > 0 && (
        <div className="table-wrap">
          <table className="steps">
            <thead>
              <tr>
                <th>Evening</th>
                <th>Logged</th>
                <th>Baseline</th>
                <th>7-day trend</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([d, tags]) => {
                const defs = tags.map((t) => TAG_BY_KEY[t]).filter(Boolean);
                return (
                  <tr key={d}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtLong(d)}</td>
                    <td>{defs.map((x) => x.short).join(', ')}</td>
                    <td>{defs.some((x) => x.excludeBaseline) ? 'excluded' : 'kept'}</td>
                    <td>{defs.some((x) => x.excludeTrend) ? 'excluded' : 'kept'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="stack">
        <h3>Your personal impact</h3>
        {impacts.length ? (
          <div className="table-wrap">
            <table className="steps">
              <thead>
                <tr>
                  <th>Behaviour</th>
                  <th className="num">Mornings</th>
                  <th className="num">HRV</th>
                  <th className="num">Resting HR</th>
                </tr>
              </thead>
              <tbody>
                {impacts.map((i) => (
                  <tr key={i.key}>
                    <td>{i.label}</td>
                    <td className="num">{i.n}</td>
                    <td className="num">{i.hrvPct != null ? `${i.hrvPct >= 0 ? '+' : ''}${i.hrvPct}%` : '—'}</td>
                    <td className="num">{i.rhrDelta != null ? `${i.rhrDelta >= 0 ? '+' : ''}${i.rhrDelta} bpm` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted">Log a few entries and the app will show how each behaviour shifts your HRV and resting HR compared with your clean baseline.</p>
        )}
      </div>
      <details className="more">
        <summary>How each tag is treated, and why</summary>
        <ul className="why" style={{ marginTop: 8 }}>
          {TAGS.map((t) => (
            <li key={t.key}>
              <b>{t.label}</b> — baseline: {t.excludeBaseline ? 'excluded' : 'kept'}, trend: {t.excludeTrend ? 'excluded' : 'kept'}, affects {t.mornings} morning{t.mornings > 1 ? 's' : ''}. {t.why}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
