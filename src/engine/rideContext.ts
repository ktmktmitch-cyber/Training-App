// Ride context: things you log about a ride that change heart rate at a given power, so the app's
// heart-rate based numbers (power at LTHR, efficiency, aerobic decoupling, heat acclimation) aren't
// fooled by them.
//
// How they're used:
//  * Once at least 4 rides carry a tag (and at least 4 don't), the conditions model learns YOUR effect
//    of it in bpm (like it does for temperature and indoor riding) and standardises it away.
//  * Until then, tags with a strong effect keep that ride out of the heart-rate model and out of
//    aerobic decoupling, so a Vyvanse day or a fan-less trainer session doesn't look like lost fitness.
//  * Indoor tags mark the ride as indoor; riding indoors without a fan counts as heat exposure.
//
// Typical effects (literature, individual responses vary a lot — which is why it's learned per rider):
//  * Caffeine 3-6 mg/kg: little change in submaximal exercise HR (±0-5 bpm); lower perceived effort.
//  * Prescription stimulants (lisdexamfetamine/Vyvanse, amphetamine, methylphenidate): raise resting
//    and exercise HR, commonly ~5-10 bpm.
//  * Indoor without a fan: no convective cooling → core temperature and HR climb steadily (cardiac drift).
//  * Dehydration: ~+3-5 bpm per 1 % of body mass lost; fasted/under-fuelled riding raises drift late on.
//  * Illness, short sleep and altitude raise HR at a given power.
import type { Activity } from './types';

export type RideTag = 'caffeine' | 'stimulant' | 'fan' | 'no_fan' | 'fasted' | 'underfuelled' | 'hot' | 'unwell' | 'short_sleep' | 'altitude';

export interface RideTagDef {
  key: RideTag;
  label: string;
  short: string;
  /** strong: kept out of HR metrics until its effect can be learned; mild: kept in (learned when possible) */
  effect: 'strong' | 'mild' | 'none';
  /** learnable as a personal bpm effect (illness is never "normal", so it's always excluded instead) */
  learn: boolean;
  indoor?: boolean;
  why: string;
}

export const RIDE_TAGS: RideTagDef[] = [
  { key: 'caffeine', label: 'Caffeine', short: 'Caffeine', effect: 'mild', learn: true, why: 'Usually little change in heart rate at the same power (0-5 bpm), but it lowers how hard the effort feels.' },
  { key: 'stimulant', label: 'Stimulant medication (Vyvanse, Adderall, Ritalin…)', short: 'Stimulant', effect: 'strong', learn: true, why: 'Prescription stimulants commonly raise heart rate by ~5-10 bpm at rest and during exercise.' },
  { key: 'fan', label: 'Indoor, with fan', short: 'Indoor + fan', effect: 'none', learn: false, indoor: true, why: 'Marks the ride as indoor (the normal indoor case).' },
  { key: 'no_fan', label: 'Indoor, no fan', short: 'Indoor, no fan', effect: 'strong', learn: true, indoor: true, why: 'Without airflow you can’t shed heat, so core temperature and heart rate climb through the ride. Counts as heat exposure.' },
  { key: 'fasted', label: 'Fasted', short: 'Fasted', effect: 'mild', learn: true, why: 'Can raise heart-rate drift late in longer rides as glycogen runs low.' },
  { key: 'underfuelled', label: 'Under-fuelled / dehydrated', short: 'Low fuel/fluid', effect: 'strong', learn: true, why: 'Dehydration raises heart rate roughly 3-5 bpm per 1 % of body weight lost and inflates decoupling.' },
  { key: 'hot', label: 'Hot / humid', short: 'Hot', effect: 'strong', learn: true, why: 'Heat raises heart rate at the same power; use it when your bike computer’s temperature is missing or wrong.' },
  { key: 'unwell', label: 'Unwell / coming down with something', short: 'Unwell', effect: 'strong', learn: false, why: 'Illness raises heart rate and isn’t representative — always kept out of fitness numbers.' },
  { key: 'short_sleep', label: 'Short sleep the night before', short: 'Short sleep', effect: 'mild', learn: true, why: 'Sleep loss can nudge heart rate up and makes efforts feel harder.' },
  { key: 'altitude', label: 'Altitude', short: 'Altitude', effect: 'strong', learn: true, why: 'Less oxygen means a higher heart rate at the same power until you acclimatise.' },
];
export const RIDE_TAG_BY_KEY = Object.fromEntries(RIDE_TAGS.map((t) => [t.key, t])) as Record<RideTag, RideTagDef>;

export type RideContext = Record<string, RideTag[]>;

/** Attach your logged context to activities (and mark fan / no-fan rides as indoor). */
export function applyRideContext(activities: Activity[], ctx: RideContext): Activity[] {
  if (!Object.keys(ctx).length) return activities;
  return activities.map((a) => {
    const tags = ctx[a.id];
    if (!tags?.length) return a;
    return { ...a, context: tags as string[], indoor: a.indoor || tags.some((t) => RIDE_TAG_BY_KEY[t]?.indoor) };
  });
}

/** Tags on this ride that make its heart rate unrepresentative (and can't be corrected for). */
export function hrConfounders(a: Activity, learned: ReadonlySet<RideTag> = new Set()): RideTag[] {
  return ((a.context ?? []) as RideTag[]).filter((t) => {
    const d = RIDE_TAG_BY_KEY[t];
    return d && d.effect === 'strong' && !(d.learn && learned.has(t));
  });
}
