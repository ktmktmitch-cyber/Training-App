// Short mobility sessions built for cyclists. Riding holds the hips flexed, the spine rounded
// and the shoulders/neck loaded for hours, so a few minutes on the same handful of areas gives
// most of the benefit: hip flexors & quads, hamstrings, glutes/piriformis, thoracic spine,
// low back, neck/shoulders — plus glute and trunk activation to counter the riding posture.
// Approach (current consensus): short sessions done often beat long ones done rarely;
// dynamic moves before riding, ~30 s static holds after riding or on rest days, and a couple
// of activation drills. Tight spots you pick get extra moves and come first.
import type { ISODate } from './types';

export type MobilityArea =
  | 'hip_flexors'
  | 'hamstrings'
  | 'glutes'
  | 'lower_back'
  | 'thoracic'
  | 'neck_shoulders'
  | 'quads'
  | 'it_band'
  | 'calves'
  | 'adductors'
  | 'wrists';

export const AREA_LABEL: Record<MobilityArea, string> = {
  hip_flexors: 'Hip flexors',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes / piriformis',
  lower_back: 'Lower back',
  thoracic: 'Upper back',
  neck_shoulders: 'Neck & shoulders',
  quads: 'Quads',
  it_band: 'Outer hip / IT band',
  calves: 'Calves / Achilles',
  adductors: 'Inner thigh',
  wrists: 'Wrists & forearms',
};

export const AREAS = Object.keys(AREA_LABEL) as MobilityArea[];

/** The areas riding tightens most — always covered, whatever you pick. */
const CORE: MobilityArea[] = ['hip_flexors', 'thoracic', 'hamstrings', 'glutes'];

export type MoveKind = 'dynamic' | 'hold' | 'activate' | 'release';

export interface MobilityMove {
  id: string;
  name: string;
  areas: MobilityArea[];
  kind: MoveKind;
  dose: string;
  secs: number; // total time including both sides
  how: string;
  needs?: 'roller' | 'band' | 'wall';
}

export const MOVES: MobilityMove[] = [
  // hip flexors / quads
  { id: 'kneeling_hf', name: 'Half-kneeling hip-flexor stretch', areas: ['hip_flexors', 'quads'], kind: 'hold', dose: '2 × 30 s / side', secs: 140, how: 'Tuck the pelvis (squeeze the back glute) before leaning forward; reach the same-side arm up.' },
  { id: 'couch', name: 'Couch stretch', areas: ['quads', 'hip_flexors'], kind: 'hold', dose: '45 s / side', secs: 100, how: 'Back knee against a wall or sofa, front foot forward; stay tall and squeeze the glute.', needs: 'wall' },
  { id: 'lunge_reach', name: 'Lunge with rotation', areas: ['hip_flexors', 'thoracic'], kind: 'dynamic', dose: '5 / side', secs: 60, how: 'Long lunge, drop the back knee, rotate the chest over the front leg and reach up.' },
  { id: 'worlds_greatest', name: 'World’s greatest stretch', areas: ['hip_flexors', 'hamstrings', 'thoracic', 'adductors'], kind: 'dynamic', dose: '4 / side', secs: 80, how: 'Lunge, elbow to instep, rotate and reach up, then straighten the front leg.' },
  // hamstrings
  { id: 'hs_floss', name: 'Hamstring floss', areas: ['hamstrings'], kind: 'dynamic', dose: '10 / side', secs: 60, how: 'Lying on your back, hold behind the thigh and straighten/bend the knee slowly.' },
  { id: 'hs_strap', name: 'Supine hamstring stretch', areas: ['hamstrings', 'calves'], kind: 'hold', dose: '30 s / side × 2', secs: 130, how: 'Strap or towel around the foot; keep the other leg flat and the back neutral.', needs: 'band' },
  { id: 'hinge', name: 'Standing hip hinge reach', areas: ['hamstrings', 'lower_back'], kind: 'dynamic', dose: '10 reps', secs: 45, how: 'Soft knees, push the hips back with a flat back until you feel the hamstrings, then stand tall.' },
  // glutes / piriformis
  { id: 'figure4', name: 'Figure-4 stretch', areas: ['glutes', 'lower_back'], kind: 'hold', dose: '40 s / side', secs: 90, how: 'On your back, ankle over the opposite knee, pull the bottom thigh towards you.' },
  { id: 'pigeon', name: 'Pigeon stretch', areas: ['glutes', 'hip_flexors', 'it_band'], kind: 'hold', dose: '45 s / side', secs: 100, how: 'Front shin across the mat, back leg long; fold forward only as far as the hips allow.' },
  { id: '9090', name: '90/90 hip switches', areas: ['glutes', 'adductors', 'hip_flexors'], kind: 'dynamic', dose: '8 / side', secs: 75, how: 'Seated, both knees at 90°, rotate the knees side to side keeping the chest up.' },
  { id: 'bridge', name: 'Glute bridge', areas: ['glutes', 'lower_back', 'hip_flexors'], kind: 'activate', dose: '12 reps, 2 s squeeze', secs: 60, how: 'Drive through the heels, ribs down, squeeze the glutes at the top — counters a day of sitting.' },
  { id: 'clamshell', name: 'Clamshells', areas: ['glutes', 'it_band'], kind: 'activate', dose: '12 / side', secs: 70, how: 'Side-lying, heels together, open the top knee without rolling the pelvis back.' },
  // lower back / trunk
  { id: 'cat_cow', name: 'Cat–cow', areas: ['lower_back', 'thoracic'], kind: 'dynamic', dose: '8 slow reps', secs: 45, how: 'On hands and knees, round fully then arch fully, moving one segment at a time.' },
  { id: 'childs', name: 'Child’s pose with side reach', areas: ['lower_back', 'thoracic', 'neck_shoulders'], kind: 'hold', dose: '30 s centre + 20 s / side', secs: 75, how: 'Sit back on the heels, arms long; walk the hands to each side to open the lats.' },
  { id: 'dead_bug', name: 'Dead bug', areas: ['lower_back'], kind: 'activate', dose: '8 / side', secs: 60, how: 'Low back pressed to the floor; extend the opposite arm and leg slowly.' },
  { id: 'knee_rocks', name: 'Lying knee rocks', areas: ['lower_back', 'glutes'], kind: 'dynamic', dose: '10 / side', secs: 50, how: 'On your back, knees bent, let both knees fall side to side with the shoulders flat.' },
  // thoracic / shoulders / neck
  { id: 'open_book', name: 'Open book', areas: ['thoracic', 'neck_shoulders'], kind: 'dynamic', dose: '6 / side', secs: 70, how: 'Side-lying, knees stacked, sweep the top arm open and follow it with your eyes.' },
  { id: 'tspine_roll', name: 'Foam-roller thoracic extension', areas: ['thoracic'], kind: 'release', dose: '60 s', secs: 60, how: 'Roller across the upper back, hands behind the head, extend over it at 3–4 spots.', needs: 'roller' },
  { id: 'thread_needle', name: 'Thread the needle', areas: ['thoracic', 'neck_shoulders'], kind: 'dynamic', dose: '6 / side', secs: 60, how: 'On hands and knees, slide one arm under the body, then rotate it up to the ceiling.' },
  { id: 'doorway_pec', name: 'Doorway chest stretch', areas: ['neck_shoulders', 'thoracic'], kind: 'hold', dose: '30 s / side', secs: 70, how: 'Forearm on a door frame at shoulder height, step through until the chest opens.', needs: 'wall' },
  { id: 'chin_tuck', name: 'Chin tucks + upper-trap stretch', areas: ['neck_shoulders'], kind: 'dynamic', dose: '10 tucks, 20 s / side', secs: 60, how: 'Glide the head straight back (double chin), then ear towards shoulder with the opposite hand low.' },
  { id: 'wall_angel', name: 'Wall angels', areas: ['neck_shoulders', 'thoracic'], kind: 'activate', dose: '10 reps', secs: 45, how: 'Back and head on the wall, slide the arms up and down keeping contact.', needs: 'wall' },
  // outer hip / IT band, adductors, calves, wrists
  { id: 'tfl_roll', name: 'Outer-hip (TFL) roll', areas: ['it_band', 'quads'], kind: 'release', dose: '45 s / side', secs: 100, how: 'Roll the front-outer hip and outer quad slowly — not the IT band itself, which doesn’t stretch.', needs: 'roller' },
  { id: 'standing_it', name: 'Standing cross-over side bend', areas: ['it_band', 'lower_back'], kind: 'hold', dose: '30 s / side', secs: 70, how: 'Cross one leg behind, push the hip out and reach overhead to the other side.' },
  { id: 'adductor_rock', name: 'Adductor rock-back', areas: ['adductors', 'hip_flexors'], kind: 'dynamic', dose: '8 / side', secs: 60, how: 'On hands and knees, one leg straight out to the side; rock the hips back and forth.' },
  { id: 'calf_wall', name: 'Wall calf stretch (straight + bent knee)', areas: ['calves'], kind: 'hold', dose: '30 s each / side', secs: 130, how: 'Straight knee for the calf, then bend the knee to reach the Achilles/soleus.', needs: 'wall' },
  { id: 'ankle_rock', name: 'Knee-to-wall ankle rocks', areas: ['calves'], kind: 'dynamic', dose: '10 / side', secs: 60, how: 'Foot a hand-width from the wall, drive the knee to the wall keeping the heel down.', needs: 'wall' },
  { id: 'wrist_flex', name: 'Wrist flexor/extensor stretch', areas: ['wrists'], kind: 'hold', dose: '20 s each way / side', secs: 90, how: 'Arm straight, gently pull the fingers back, then the back of the hand down.' },
  { id: 'nerve_glide', name: 'Ulnar/median nerve glides', areas: ['wrists', 'neck_shoulders'], kind: 'dynamic', dose: '8 / side', secs: 60, how: 'Helps hand numbness from the bars: slow, gentle sweeps of the arm with the wrist extended.' },
];

export const MOVE_BY_ID: Record<string, MobilityMove> = Object.fromEntries(MOVES.map((m) => [m.id, m]));

export type MobilityKind = 'rest_day' | 'post_ride' | 'pre_ride';

export const KIND_LABEL: Record<MobilityKind, string> = {
  rest_day: 'Rest-day mobility',
  post_ride: 'After your ride',
  pre_ride: 'Before you ride',
};

export interface MobilitySession {
  kind: MobilityKind;
  title: string;
  minutes: number;
  focus: MobilityArea[];
  moves: MobilityMove[];
  note: string;
}

export interface MobilityOptions {
  focus: MobilityArea[];
  minutes: number; // target length
  equipment: { roller: boolean; band: boolean };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const KIND_ALLOWED: Record<MobilityKind, MoveKind[]> = {
  pre_ride: ['dynamic', 'activate'],
  post_ride: ['hold', 'dynamic', 'release'],
  rest_day: ['dynamic', 'hold', 'activate', 'release'],
};

/**
 * Build a short session. Areas you marked tight get roughly twice the moves and go first;
 * the core riding areas are always covered. Rotates moves by date so it doesn't get stale.
 */
export function buildMobility(kind: MobilityKind, date: ISODate, opts: MobilityOptions): MobilitySession {
  const budget = Math.max(4, opts.minutes) * 60;
  const focus = opts.focus.filter((a) => AREAS.includes(a));
  const ok = (m: MobilityMove) =>
    KIND_ALLOWED[kind].includes(m.kind) && (m.needs !== 'roller' || opts.equipment.roller) && (m.needs !== 'band' || opts.equipment.band);
  const seed = hash(`${date}:${kind}`);
  const pool = MOVES.filter(ok).sort((a, b) => (hash(a.id + seed) % 997) - (hash(b.id + seed) % 997));

  // Each area's need: tight spots count twice, core riding areas once
  const want = new Map<MobilityArea, number>();
  for (const a of CORE) want.set(a, 1);
  for (const a of focus) want.set(a, (want.get(a) ?? 0) + 2);
  const picked: MobilityMove[] = [];
  let used = 0;
  const cover = new Map<MobilityArea, number>();
  const score = (m: MobilityMove) => m.areas.reduce((s, a, i) => s + Math.max(0, (want.get(a) ?? 0) - (cover.get(a) ?? 0)) * (i === 0 ? 1.5 : 1), 0);
  while (used < budget) {
    let best: MobilityMove | null = null;
    let bestScore = 0;
    for (const m of pool) {
      if (picked.includes(m) || used + m.secs > budget + 30) continue;
      const sc = score(m);
      if (sc > bestScore) {
        best = m;
        bestScore = sc;
      }
    }
    if (!best) {
      // every need met: top up with whatever fits, preferring tight spots then core areas
      best = pool.find((m) => !picked.includes(m) && used + m.secs <= budget && m.areas.some((a) => focus.includes(a) || CORE.includes(a))) ?? null;
      if (!best) break;
    }
    picked.push(best);
    used += best.secs;
    for (const a of best.areas) cover.set(a, (cover.get(a) ?? 0) + 1);
  }
  // Order: dynamic → release → holds → activation last (wake the glutes up before you stand up and go)
  const ORDER: MoveKind[] = kind === 'pre_ride' ? ['dynamic', 'activate', 'release', 'hold'] : ['dynamic', 'release', 'hold', 'activate'];
  const focusFirst = (m: MobilityMove) => (m.areas.some((a) => focus.includes(a)) ? 0 : 1);
  picked.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || focusFirst(a) - focusFirst(b));
  const minutes = Math.max(1, Math.round(used / 60));
  const note =
    kind === 'post_ride'
      ? 'Within an hour of riding, while you’re warm. Ease into each hold — mild tension, never pain.'
      : kind === 'pre_ride'
        ? 'Dynamic only — no long static holds right before efforts.'
        : 'Any time today. Breathe slowly through the holds; little and often beats long and rare.';
  return {
    kind,
    title: focus.length ? `${KIND_LABEL[kind]} · extra ${focus.map((a) => AREA_LABEL[a].toLowerCase()).join(', ')}` : KIND_LABEL[kind],
    minutes,
    focus,
    moves: picked,
    note,
  };
}

export type MobilityFrequency = 'off' | 'rest_days' | 'most_days' | 'daily';

export const FREQ_LABEL: Record<MobilityFrequency, string> = {
  off: 'Off',
  rest_days: 'Rest & easy days',
  most_days: 'Most days',
  daily: 'Every day',
};
