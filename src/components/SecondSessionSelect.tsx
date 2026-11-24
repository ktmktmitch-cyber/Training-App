import type { DayConfig, SecondSession } from '../engine/types';

type Choice = 'auto' | 'none' | SecondSession;

const OPTIONS: { value: Choice; label: string }[] = [
  { value: 'auto', label: 'Auto (lifting if planned)' },
  { value: 'none', label: 'None — no lifting' },
  { value: 'am_swim', label: 'AM swim' },
  { value: 'pm_swim', label: 'PM swim' },
  { value: 'am_run', label: 'AM run' },
  { value: 'pm_run', label: 'PM run' },
  { value: 'spin', label: 'Easy spin' },
];

/** Per-day second session: let the plan decide, nothing extra, or a specific extra session (e.g. a morning swim). */
export function SecondSessionSelect({ c, onChange, label }: { c: DayConfig; onChange: (patch: Partial<DayConfig>) => void; label: string }) {
  const value: Choice = c.second ?? (c.noLift ? 'none' : 'auto');
  return (
    <label className="field inline" title="A second session that day. A swim, run or spin replaces lifting that day and is kept easy if the day already has a hard session.">
      <span>2nd session</span>
      <select
        className="select"
        value={value}
        onChange={(e) => {
          const v = e.target.value as Choice;
          onChange(v === 'auto' ? { second: null, noLift: false } : v === 'none' ? { second: null, noLift: true } : { second: v, noLift: false });
        }}
        aria-label={label}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
