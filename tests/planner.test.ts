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
