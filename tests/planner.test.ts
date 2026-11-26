import { describe, expect, it } from 'vitest';
import { effectiveDayConfig as edc } from '../src/engine/planner';
describe('moving a coach workout', () => {
  const ev = { id: 'e1', date: '2026-11-26', category: 'WORKOUT', type: 'Ride', name: 'VO2max', plannedSec: 3600, externalId: 'tacoach-2026-11-26-vo2max-L2-abc' } as any;
  const week = { startDate: '2026-11-25', hours: 8, days: {} } as any;
  it('the coach day is scheduled until you move it away', () => {
    expect(edc('2026-11-26', week, [ev], null).status).toBe('scheduled');
    const moved = { ...week, days: { '2026-11-26': { status: 'available', maxMinutes: null, skipCalendar: true } } };
    expect(edc('2026-11-26', moved, [ev], null).status).toBe('available');
  });
});

import { goalPhase } from '../src/engine/strength';
describe('strength goal', () => {
  it('maintain swaps build blocks for the maintenance program', () => {
    expect(goalPhase('MS', 'maintain')).toBe('MT');
    expect(goalPhase('AA', 'maintain')).toBe('MT');
    expect(goalPhase('TP', 'maintain')).toBe('TP');
    expect(goalPhase('MS', 'build')).toBe('MS');
    expect(goalPhase('MS', undefined)).toBe('MS');
    expect(goalPhase('MT', 'build')).toBe('MS');
    expect(goalPhase('MT', undefined)).toBe('MS');
    expect(goalPhase('DL', 'build')).toBe('DL');
    expect(goalPhase('TP', 'build')).toBe('TP');
  });
});

import { groupSent } from '../src/components/CoachSchedule';
describe('coach: everyone view', () => {
  it('groups one send to many riders into one row, ignoring non-coach events', () => {
    const ev = (x: string, name: string, date = '2026-11-26') => ({ id: x, date, category: 'WORKOUT', name, externalId: x }) as any;
    const g = groupSent([
      { rider: { id: 'a', rider: 'A' } as any, events: [ev('tacoach-2026-11-26-vo2_4x4-L2-aaa1', 'VO2'), ev('trainingapp-2026-11-27-ride', 'Mine')] },
      { rider: { id: 'b', rider: 'B' } as any, events: [ev('tacoach-2026-11-26-vo2_4x4-L2-bbb2', 'VO2'), ev('tacoach-2026-11-28-tempo-L1-ccc3', 'Tempo', '2026-11-28')] },
    ]);
    expect(g.map((x) => [x.name, x.items.length])).toEqual([['VO2', 2], ['Tempo', 1]]);
  });
});

import { buildWindow, dayAt, writeWindow } from '../src/lib/store';
describe('availability by calendar week', () => {
  const usual = { hours: 8, days: { 3: { status: 'off' as const, maxMinutes: null } } }; // Wednesdays off
  it('keeps day changes as the window rolls forward, and reads old rolling-window entries', () => {
    const legacy: any = { '2026-11-24': { startDate: '2026-11-24', hours: 9, days: { '2026-11-28': { status: 'pinned', maxMinutes: null, pinned: { workoutId: 'threshold', durationMin: 60 } } } } };
    expect(dayAt(legacy, '2026-11-28', usual)!.status).toBe('pinned');
    expect(dayAt(legacy, '2026-11-25', usual)!.status).toBe('off'); // usual Wednesday
    // edit next week from today's window: survives into a later window
    const w = buildWindow(legacy, '2026-11-26', 11, usual);
    w.days['2026-12-04'] = { status: 'off', maxMinutes: null };
    const saved = writeWindow(legacy, w, usual, false);
    expect(buildWindow(saved, '2026-12-01', 7, usual).days['2026-12-04'].status).toBe('off');
    expect(saved['2026-11-30'].days['2026-12-04'].status).toBe('off'); // stored under its calendar week
  });
  it('removing a day setting goes back to the usual week; hours are per calendar week', () => {
    let weeks: any = writeWindow({}, { startDate: '2026-11-30', hours: 12, days: { '2026-12-02': { status: 'group', maxMinutes: null } } }, usual, true);
    expect(weeks['2026-11-30'].hours).toBe(12);
    weeks = writeWindow(weeks, { startDate: '2026-11-30', hours: 12, days: {} }, usual, true);
    expect(dayAt(weeks, '2026-12-02', usual)!.status).toBe('off');
    // a window spanning two calendar weeks averages their hours by days
    expect(buildWindow(weeks, '2026-11-27', 7, usual).hours).toBe(10.5);
  });
});

import { campMinutes, campSession } from '../src/engine/planner';
describe('training camps', () => {
  it('camp days are mostly long Zone 2, every 4th easier, one tempo mid-camp', () => {
    const n = 7;
    const days = Array.from({ length: n }, (_, i) => campSession({ name: 'Camp', index: i, length: n, minutes: 240 }));
    expect(days.filter((d) => d.id === 'end_tempo')).toHaveLength(1);
    expect(days[3].minutes).toBeLessThan(150); // 4th day easier
    expect(days[6].minutes).toBeLessThan(150); // last day shorter
    expect(days.filter((d) => d.minutes === 240).length).toBeGreaterThanOrEqual(3);
    expect(days.every((d) => ['endurance', 'end_tempo', 'end_sprints'].includes(d.id))).toBe(true);
  });
  it('auto hours scale with your usual week (about double it over a camp week), within sane limits', () => {
    expect(campMinutes({ id: 'c', name: 'C', start: '', end: '', hoursPerDay: null }, 8)).toBe(165);
    expect(campMinutes({ id: 'c', name: 'C', start: '', end: '', hoursPerDay: null }, 20)).toBe(300);
    expect(campMinutes({ id: 'c', name: 'C', start: '', end: '', hoursPerDay: 4.5 }, 8)).toBe(270);
  });
});
