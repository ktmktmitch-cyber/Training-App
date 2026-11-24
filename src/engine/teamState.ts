// Training state for every rider on the team, from the shared team data (so everyone can see
// everyone's): fitness/fatigue/form history (intervals.icu CTL/ATL/TSB, all sports) and power PRs.
//
// Fitness (CTL) change is the most robust whole-team signal — it reflects sustained training load
// regardless of sport or power meter. Power PRs at ≥1 min confirm real performance gains where a
// rider has power. Form (TSB) and the fatigue/fitness ratio flag acute strain and functional
// overreaching (high fatigue for weeks without fitness rising — the pattern that precedes
// non-functional overreaching / overtraining).
import { diffDays } from './dates';
import type { TeamRider } from './team';
import type { ISODate } from './types';

export type TeamStateKey = 'improving' | 'maintaining' | 'plateau' | 'recovering' | 'detraining' | 'overreaching' | 'strained' | 'inactive' | 'nodata';

export interface TeamState {
  key: TeamStateKey;
  label: string;
  symbol: string;
  why: string;
  basis: string;
  ctlChange28: number | null;
}

export const STATE_META: Record<TeamStateKey, { label: string; symbol: string; tone: 'good' | 'info' | 'neutral' | 'warn' | 'serious' | 'bad' }> = {
  improving: { label: 'Improving', symbol: '↗', tone: 'good' },
  maintaining: { label: 'Maintaining', symbol: '→', tone: 'info' },
  plateau: { label: 'Plateauing', symbol: '▬', tone: 'neutral' },
  recovering: { label: 'Recovering', symbol: '↺', tone: 'info' },
  detraining: { label: 'Detraining', symbol: '↘', tone: 'warn' },
  overreaching: { label: 'Overreaching', symbol: '⚠', tone: 'serious' },
  strained: { label: 'Strained', symbol: '!', tone: 'bad' },
  inactive: { label: 'Inactive', symbol: '○', tone: 'neutral' },
  nodata: { label: 'No data', symbol: '?', tone: 'neutral' },
};

const MIN_PR_SECS = 60; // sprint PRs say little about aerobic fitness

function prSecs(d: string): number {
  const m = d.match(/([\d.]+)\s*(s|min|h)/);
  if (!m) return 0;
  const v = Number(m[1]);
  return m[2] === 's' ? v : m[2] === 'min' ? v * 60 : v * 3600;
}

export function riderTrainingState(r: TeamRider, asOf: ISODate): TeamState {
  const t = [...r.trend].sort((a, b) => a.date.localeCompare(b.date));
  const make = (key: TeamStateKey, why: string, basis: string, d28: number | null = null): TeamState => ({ key, ...STATE_META[key], why, basis, ctlChange28: d28 });
  const hours8 = r.weeks.reduce((a, w) => a + w.hours, 0);
  if (t.length < 10) return hours8 > 0 ? make('nodata', 'Not enough fitness history yet.', '—') : make('inactive', 'No recent training.', '—');
  const last = t[t.length - 1];
  const at = (daysAgo: number) => {
    let best = t[0];
    for (const p of t) if (diffDays(last.date, p.date) >= daysAgo) best = p;
    return best;
  };
  const ctl = last.fitness;
  const ctl7 = at(7).fitness;
  const ctl28 = at(28).fitness;
  const d7 = ctl - ctl7;
  const d28 = ctl - ctl28;
  const recentForm = t.filter((p) => diffDays(last.date, p.date) < 14).map((p) => p.form);
  const avgForm14 = recentForm.reduce((a, b) => a + b, 0) / Math.max(1, recentForm.length);
  const ratio = ctl >= 10 ? last.fatigue / ctl : 0;
  const prs = r.prs.filter((p) => p.date && prSecs(p.duration) >= MIN_PR_SECS);
  const prs28 = prs.filter((p) => diffDays(asOf, p.date!) <= 28);
  const prs56 = prs.filter((p) => diffDays(asOf, p.date!) <= 56);
  const hasPower = r.eftp_watts != null || r.prs.length > 0;
  const basis = hasPower ? 'fitness, form and power PRs' : 'fitness and form (no power data)';
  const recentHours = r.weeks.slice(-4).reduce((a, w) => a + w.hours, 0);
  const sig = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;

  if (ctl < 3 && recentHours < 1) return make('inactive', 'Little or no training in the last month.', basis, d28);
  if (last.form < -30 || ratio > 1.5) return make('strained', `Fatigue is far above fitness (form ${Math.round(last.form)}). Ease off for a few days.`, basis, d28);
  if (avgForm14 < -25 && d28 <= 1) return make('overreaching', `Form has averaged ${Math.round(avgForm14)} for two weeks but fitness isn’t rising (${sig(d28)} in 4 weeks) — risk of overtraining. Plan a recovery week.`, basis, d28);
  const upThresh = Math.max(3, ctl28 * 0.08);
  const downThresh = Math.max(4, ctl28 * 0.12);
  if (d28 >= upThresh || (prs28.length > 0 && d28 >= 0)) {
    const prTxt = prs28.length ? ` · ${prs28.length} power PR${prs28.length === 1 ? '' : 's'} (≥1 min) this month` : '';
    return make('improving', `Fitness ${sig(d28)} over 4 weeks${prTxt}.`, basis, d28);
  }
  if (d28 <= -downThresh) return make('detraining', `Fitness ${sig(d28)} over 4 weeks — training load has dropped.`, basis, d28);
  if (d7 < -1 && last.form > 0) return make('recovering', `Fitness dipping (${sig(d7)} this week) with form positive (+${Math.round(last.form)}) — absorbing training or resting.`, basis, d28);
  if (ctl >= 20 && Math.abs(d28) < 3 && prs56.length === 0 && recentHours >= 10) return make('plateau', `Training steadily, but fitness (${sig(d28)} in 4 weeks) and power haven’t moved in 8 weeks — time to change the stimulus.`, basis, d28);
  return make('maintaining', `Fitness steady (${sig(d28)} over 4 weeks).`, basis, d28);
}
