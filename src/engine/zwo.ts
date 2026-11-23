// Export a planned workout as a Zwift .zwo file (also imported by many other indoor apps).
import type { Block, PlannedWorkout, Step } from './types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pw = (pct: number) => (pct / 100).toFixed(3);
const mid = (s: Step) => (s.low + s.high) / 2;
const cad = (s: Step) => {
  const m = s.cadence?.match(/(\d+)(?:-(\d+))?/);
  if (!m) return '';
  const c = m[2] ? Math.round((Number(m[1]) + Number(m[2])) / 2) : Number(m[1]);
  return ` Cadence="${c}"`;
};

function stepXml(s: Step, isFirst: boolean, isLast: boolean): string {
  if (s.ramp) {
    if (isFirst && s.high > s.low) return `<Warmup Duration="${s.durationSec}" PowerLow="${pw(s.low)}" PowerHigh="${pw(s.high)}"${cad(s)}/>`;
    if (isLast && s.high < s.low) return `<Cooldown Duration="${s.durationSec}" PowerLow="${pw(s.low)}" PowerHigh="${pw(s.high)}"${cad(s)}/>`;
    return `<Ramp Duration="${s.durationSec}" PowerLow="${pw(s.low)}" PowerHigh="${pw(s.high)}"${cad(s)}/>`;
  }
  return `<SteadyState Duration="${s.durationSec}" Power="${pw(mid(s))}"${cad(s)}/>`;
}

export function blocksToZwo(blocks: Block[]): string[] {
  const lines: string[] = [];
  const total = blocks.length;
  blocks.forEach((b, bi) => {
    if (b.reps > 1 && b.steps.length === 2 && !b.steps[0].ramp && !b.steps[1].ramp) {
      const [on, off] = b.steps;
      lines.push(
        `<IntervalsT Repeat="${b.reps}" OnDuration="${on.durationSec}" OffDuration="${off.durationSec}" OnPower="${pw(mid(on))}" OffPower="${pw(mid(off))}"${cad(on)}/>`,
      );
      return;
    }
    for (let r = 0; r < b.reps; r++)
      b.steps.forEach((s, si) => lines.push(stepXml(s, bi === 0 && r === 0 && si === 0, bi === total - 1 && r === b.reps - 1 && si === b.steps.length - 1)));
  });
  return lines;
}

export function workoutToZwo(w: PlannedWorkout): string {
  return [
    '<workout_file>',
    '  <author>Training App</author>',
    `  <name>${esc(w.name)}</name>`,
    `  <description>${esc(w.purpose)}</description>`,
    '  <sportType>bike</sportType>',
    '  <tags/>',
    '  <workout>',
    ...blocksToZwo(w.blocks).map((l) => `    ${l}`),
    '  </workout>',
    '</workout_file>',
    '',
  ].join('\n');
}
