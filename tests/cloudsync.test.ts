import { describe, expect, it } from 'vitest';
import { flatten, mergeDocs, restamp, trim, unflatten, type SyncState } from '../src/lib/cloudSync';

const base = (): SyncState => ({
  settings: { connection: { apiKey: 'SECRET' }, demo: false, goal: { model: 'block', restWeeks: [] }, prefs: { sport: 'cycling' }, usualHours: 8 },
  journal: {},
  weeks: {},
  scheduled: {},
});

describe('settings sync (intervals.icu note)', () => {
  it('never syncs the API key or device-only settings', () => {
    const f = flatten(base());
    expect(Object.keys(f).some((k) => k.includes('connection') || k.includes('demo'))).toBe(false);
    expect(JSON.stringify(f)).not.toContain('SECRET');
    expect(unflatten(f).settings).toEqual({ goal: { model: 'block', restWeeks: [] }, prefs: { sport: 'cycling' }, usualHours: 8 });
  });

  it('keeps changes from both devices (different items)', () => {
    const a0 = flatten(base());
    const phone = base();
    phone.journal = { '2026-11-24': ['alcohol_light'] };
    const laptop = base();
    (laptop.settings!.goal as Record<string, unknown>).restWeeks = ['2026-12-28'];
    const ps = restamp(a0, flatten(phone), {}, 1000);
    const ls = restamp(a0, flatten(laptop), {}, 2000);
    const m = mergeDocs({ items: flatten(laptop), stamps: ls }, { items: flatten(phone), stamps: ps });
    const st = unflatten(m.items);
    expect(st.journal).toEqual({ '2026-11-24': ['alcohol_light'] });
    expect((st.settings!.goal as Record<string, unknown>).restWeeks).toEqual(['2026-12-28']);
    expect((st.settings!.goal as Record<string, unknown>).model).toBe('block');
    expect(m.changedLocal && m.changedRemote).toBe(true);
  });

  it('newest change wins on the same item, and deletions stick', () => {
    const a0 = flatten({ ...base(), journal: { '2026-11-20': ['travel'] } });
    const older = { ...base(), journal: { '2026-11-20': ['travel'] }, settings: { ...base().settings, usualHours: 10 } };
    const newer = { ...base(), journal: {}, settings: { ...base().settings, usualHours: 6 } }; // removed the journal day
    const os = restamp(a0, flatten(older), {}, 1000);
    const ns = restamp(a0, flatten(newer), {}, 2000);
    const m = mergeDocs({ items: flatten(older), stamps: os }, { items: flatten(newer), stamps: ns });
    const st = unflatten(m.items);
    expect(st.settings!.usualHours).toBe(6);
    expect(st.journal ?? {}).toEqual({});
  });

  it('a brand-new device adopts what is already saved', () => {
    const saved = base();
    (saved.settings!.prefs as Record<string, unknown>).sport = 'triathlon';
    const items = flatten(saved);
    const stamps = Object.fromEntries(Object.keys(items).map((k) => [k, 5000]));
    const fresh = flatten(base()); // defaults, nothing stamped
    const m = mergeDocs({ items: fresh, stamps: {} }, { items, stamps });
    expect((unflatten(m.items).settings!.prefs as Record<string, unknown>).sport).toBe('triathlon');
    expect(m.changedLocal).toBe(true);
    expect(m.changedRemote).toBe(false);
  });

  it('drops old dated entries to keep the note small', () => {
    const items = flatten({ ...base(), journal: { '2026-01-01': ['travel'], '2026-11-01': ['illness'] } });
    const t = trim(items, {}, '2026-11-24');
    expect(Object.keys(t.items)).toContain('journal.2026-11-01');
    expect(Object.keys(t.items)).not.toContain('journal.2026-01-01');
  });
});
