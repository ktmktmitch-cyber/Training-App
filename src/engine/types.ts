import type { MobilityArea, MobilityFrequency, MobilitySession } from './mobility';
// Shared domain types for the training engine. Everything here is plain data so the
// engine stays pure and unit-testable (no React, no fetch).

export type ISODate = string; // YYYY-MM-DD (athlete-local calendar date)

// ---------- Data coming in ----------

/** One best effort on intervals.icu's power curve, with the ride it came from. */
export interface CurvePoint {
  secs: number;
  watts: number;
  activityId: string | null;
  activityName: string | null;
  date: ISODate | null;
}

/** intervals.icu mean-maximal power curve for a window (e.g. last 90 days). */
export interface PowerCurve {
  id: string; // '42d' | '90d' | '1y'
  label: string;
  start: ISODate | null;
  end: ISODate | null;
  weightKg: number | null;
  points: CurvePoint[];
}

export interface AthleteProfile {
  id: string;
  name: string;
  ftp: number | null; // watts
  eftp: number | null; // intervals.icu estimated FTP
  lthr: number | null;
  maxHr: number | null;
  restingHr: number | null;
  weightKg: number | null;
  powerZones: number[]; // upper bounds in % FTP, e.g. [55,75,90,105,120,150,999]
  hrZones: number[]; // upper bounds in bpm
  birthYear?: number | null;
  sex?: string | null;
  cp?: number | null; // critical power (W)
  wPrime?: number | null; // J
  pMax?: number | null; // W
  runThresholdMps?: number | null; // threshold running speed (m/s) from intervals.icu
  runLthr?: number | null;
  swimCssMps?: number | null; // critical swim speed (m/s)
}

export interface Activity {
  id: string;
  date: ISODate;
  startTime?: string;
  name: string;
  type: string; // Ride, VirtualRide, Run, WeightTraining ...
  isRide: boolean;
  isStrength: boolean;
  movingSec: number;
  distanceM?: number | null;
  tss: number | null; // training load
  intensity: number | null; // IF 0..1.5
  normalizedPower: number | null;
  avgHr: number | null;
  // Seconds per power zone (Z1..Z7) and per HR zone, when available
  powerZoneSecs: number[] | null;
  hrZoneSecs: number[] | null;
  source: 'intervals' | 'strava' | 'demo';
  limited?: boolean; // intervals.icu returned a stub (e.g. Strava-sourced activity)
  stravaId?: string;
  ssSecs?: number | null; // seconds in intervals.icu "sweet spot" band
  decoupling?: number | null; // aerobic decoupling Pw:HR (%)
  efficiencyFactor?: number | null; // NP / avg HR
  rpe?: number | null; // 1..10
  feel?: number | null; // intervals.icu 1 (strong) .. 5 (weak)
  pairedEventId?: string | null;
  efforts?: { reps: number; secs: number; watts: number }[] | null; // intervals.icu detected intervals
  ftp?: number | null; // FTP at the time of the activity
  vi?: number | null; // variability index
  tempC?: number | null; // average temperature during the ride
  indoor?: boolean; // trainer / virtual ride
  avgPower?: number | null;
  pmFtp?: number | null; // intervals.icu per-ride power-model FTP estimate
  pmFtpSecs?: number | null; // duration of the effort that defines it
  pmFtpWatts?: number | null; // power of that effort
}

export interface Wellness {
  date: ISODate;
  hrv: number | null; // rMSSD (ms)
  rhr: number | null; // bpm
  sleepSec: number | null;
  sleepScore: number | null;
  ctl: number | null;
  atl: number | null;
  rampRate: number | null;
  soreness: number | null; // intervals.icu 1..4 (higher = worse)
  fatigue: number | null;
  stress: number | null;
  mood: number | null;
  motivation: number | null;
  eftp: number | null;
  wPrime?: number | null;
  pMax?: number | null;
  vo2max?: number | null; // device (Garmin) VO2max estimate
  weightKg?: number | null;
}

export type EventCategory = 'RACE_A' | 'RACE_B' | 'RACE_C' | 'WORKOUT' | 'NOTE' | 'HOLIDAY' | 'SICK' | 'INJURED' | string;

export interface CalendarEvent {
  id: string;
  date: ISODate;
  endDate?: ISODate;
  category: EventCategory;
  name: string;
  type?: string;
  externalId?: string | null;
  plannedSec?: number | null;
  plannedTss?: number | null;
  description?: string | null;
}

// ---------- User settings ----------

export type EventType =
  | 'road_race'
  | 'crit'
  | 'gran_fondo'
  | 'gravel'
  | 'tt'
  | 'hill_climb'
  | 'mtb_xc'
  | 'cx'
  | 'stage_race'
  | 'ultra'
  | 'fitness';

export type PeriodizationModel = 'linear' | 'block' | 'reverse' | 'hrv_flex';
export type IntensityModel = 'auto' | 'polarized' | 'pyramidal' | 'sweetspot';
export type LoadPattern = '2:1' | '3:1' | '4:1';

export interface GoalSettings {
  eventName: string;
  eventDate: ISODate | null;
  eventType: EventType;
  eventDurationHours: number; // expected race duration
  model: PeriodizationModel;
  intensity: IntensityModel;
  loadPattern: LoadPattern;
  typicalWeeklyHours: number; // for season projection
  planStart: ISODate | null; // null = from this week
  useCalendarRaces: boolean; // read RACE_A/B/C from intervals.icu
  restWeeks?: ISODate[]; // Mondays of weeks you chose to make rest weeks
  awayWeeks?: ISODate[]; // Mondays of weeks you can't train at all (travel, vacation)
  races?: PlannedRace[]; // races you added in the app
}

export type RacePriority = 'A' | 'B' | 'C';

export interface PlannedRace {
  id: string;
  name: string;
  date: ISODate;
  priority: RacePriority;
  durationMin: number;
}

export type Equipment = 'gym' | 'barbell' | 'dumbbell' | 'bodyweight';
export type Experience = 'new' | 'intermediate' | 'advanced';
export type LiftPlacement = 'hard_days' | 'easy_days' | 'any';

export interface StrengthSettings {
  frequency: 0 | 1 | 2 | 3;
  equipment: Equipment;
  experience: Experience;
  placement: LiftPlacement;
  followPhaseCaps: boolean; // let the planner cap frequency in peak/taper
  includeMobility: boolean;
  mobility?: MobilityPrefs;
}

export interface MobilityPrefs {
  frequency: MobilityFrequency;
  minutes: number; // rest-day session length; after-ride sessions are shorter
  focus: MobilityArea[]; // tight spots to emphasise
  roller: boolean;
  band: boolean;
}

export type DayStatus = 'available' | 'off' | 'group' | 'pinned' | 'race' | 'scheduled';
export type GroupIntensity = 'social' | 'tempo' | 'hard' | 'race';

export interface DayConfig {
  status: DayStatus;
  maxMinutes: number | null; // null = no explicit cap
  group?: { durationMin: number; intensity: GroupIntensity; name?: string };
  pinned?: { workoutId: string; durationMin: number; level?: number };
  race?: { name: string; durationMin: number; priority: 'A' | 'B' | 'C' };
  /** a workout already on your intervals.icu calendar (from a coach, TrainerRoad, etc.) */
  scheduled?: { name: string; durationMin: number; tss: number | null; description?: string | null; type?: string | null };
  noLift?: boolean;
}

export interface WeekConfig {
  startDate: ISODate; // first day of the 7-day window
  hours: number; // hours available this week
  days: Record<ISODate, DayConfig>;
}

export type TargetMode = 'power' | 'hr';

export type SportMode = 'cycling' | 'running' | 'run_bike' | 'triathlon';

export interface PlannerPrefs {
  sport?: SportMode; // default cycling
  runPaceMps?: number | null; // your threshold run pace (overrides intervals.icu)
  swimCssMps?: number | null; // your CSS (overrides intervals.icu)
  longRideDay: 'sat' | 'sun' | 'auto';
  minRestDays: 0 | 1 | 2;
  targetMode: TargetMode;
  maxRampPerWeek: number; // CTL points per week
  indoorFriendly: boolean;
}

export interface CheckIn {
  date: ISODate;
  feel: 'great' | 'normal' | 'tired' | 'sore' | 'sick';
}

// ---------- Workouts ----------

export type WorkoutCategory =
  | 'rest'
  | 'recovery'
  | 'endurance'
  | 'tempo'
  | 'sweetspot'
  | 'threshold'
  | 'vo2max'
  | 'anaerobic'
  | 'sprint'
  | 'race_sim'
  | 'durability'
  | 'openers'
  | 'test'
  | 'group'
  | 'race';

export type Intensity = 'rest' | 'easy' | 'moderate' | 'hard';

export interface Step {
  durationSec: number;
  low: number; // % FTP
  high: number; // % FTP
  ramp?: boolean;
  cadence?: string; // e.g. "95-105rpm"
  label?: string;
}

export interface Block {
  name?: string;
  reps: number;
  steps: Step[];
}

export interface PlannedWorkout {
  templateId: string;
  name: string;
  category: WorkoutCategory;
  intensity: Intensity;
  durationMin: number;
  tss: number;
  ifactor: number;
  blocks: Block[]; // empty for unstructured (group ride, race)
  purpose: string;
  why: string[]; // rationale lines
  fueling: string;
  key: boolean; // counts as a key/quality session
  fixed?: 'group' | 'pinned' | 'race' | 'calendar';
  indoorAlt?: string;
  progression?: { zone: string; workoutLevel: number; athleteLevel: number | null; difficulty: string | null };
  level?: number;
  sport?: 'ride' | 'run' | 'swim'; // default ride
}

export interface StrengthExercise {
  name: string;
  sets: number;
  reps: string;
  load: string;
  rest: string;
  notes?: string;
}

export type StrengthPhase = 'AA' | 'MS' | 'SP' | 'MT' | 'DL' | 'TP';

export interface StrengthSession {
  phase: StrengthPhase;
  title: string;
  durationMin: number;
  focus: string;
  exercises: StrengthExercise[];
  timing: string; // e.g. "After the ride, ideally 6+ h later"
  why: string[];
}

export interface PlannedDay {
  date: ISODate;
  dow: number; // 0=Sun
  phase: Phase;
  weekType: WeekType;
  ride: PlannedWorkout | null;
  strength: StrengthSession | null;
  mobility?: MobilitySession | null;
  /** run / swim sessions (and brick runs) alongside or instead of the ride */
  extras?: PlannedWorkout[];
  notes: string[];
  status: DayStatus;
}

// ---------- Periodization ----------

export type Phase =
  | 'prep'
  | 'base'
  | 'build'
  | 'peak'
  | 'taper'
  | 'race'
  | 'accumulation'
  | 'transmutation'
  | 'realization'
  | 'intensity'
  | 'volume'
  | 'specific'
  | 'maintain'
  | 'transition';

export type WeekType = 'load' | 'recovery' | 'taper' | 'race' | 'hit_block';

export interface MacroWeek {
  index: number;
  start: ISODate; // Monday
  phase: Phase;
  weekType: WeekType;
  weekInPhase: number; // 1-based
  phaseWeeks: number; // total weeks in this phase
  loadStep: number; // 1..n position inside the current loading run (for progression)
  volumeFactor: number; // fraction of available hours to use
  focus: string;
  strengthPhase: StrengthPhase;
  races: CalendarEvent[];
  estTssPerHour: number;
  userRest?: boolean; // a rest week you chose (vs one the plan scheduled)
  userAway?: boolean; // a week you can't train at all
}

export interface MacroPlan {
  weeks: MacroWeek[];
  goalDate: ISODate | null;
  taperDays: number;
  summary: string[];
}

// ---------- Readiness & trends ----------

export type ReadinessStatus = 'green' | 'amber' | 'red' | 'unknown';

export interface ReadinessFlag {
  id: string;
  level: 'good' | 'info' | 'warn' | 'bad';
  title: string;
  detail: string;
}

export interface Readiness {
  status: ReadinessStatus;
  score: number | null;
  flags: ReadinessFlag[];
  hrv: {
    today: number | null;
    avg7: number | null;
    baseline: number | null;
    low: number | null;
    high: number | null; // normal range in ms (from ln space)
    cv7: number | null;
    trend: 'up' | 'down' | 'flat' | null;
    status: 'balanced' | 'unbalanced' | 'low' | 'poor' | null; // Garmin-style HRV status
  };
  rhr: { today: number | null; avg7: number | null; baseline: number | null; sd: number | null };
  tsb: number | null;
  ctl: number | null;
  atl: number | null;
  rampRate: number | null;
  sleepAvg3h: number | null;
  volumeModifier: number; // multiply week volume by this
  maxKeySessionsDelta: number; // e.g. -1
  firstDayEasy: boolean;
  easyDays: number; // number of leading days forced easy
  summary: string;
}

export interface WeeklyLoad {
  weekStart: ISODate;
  hours: number;
  tss: number;
  rides: number;
  strength: number;
}

export interface Trends {
  weekly: WeeklyLoad[];
  distribution28: { low: number; mid: number; high: number; source: 'power' | 'hr' | 'none' };
  longestRideMin28: number;
  avgWeeklyHours4: number;
  avgWeeklyTss4: number;
  hardSessions14: number;
  strengthSessions28: number;
  daysSinceStrength: number | null;
  monotony7: number | null;
  strain7: number | null;
  daysSinceHard: number | null;
  ctl: number | null;
  atl: number | null;
  aerobic: {
    rides: { date: ISODate; decoupling: number; ef: number | null; minutes: number }[];
    median: number | null;
    efChange: number | null; // % change in efficiency factor, last 4 weeks vs the 4 before
    verdict: 'solid' | 'developing' | 'needs_work' | 'unknown';
  };
  notes: string[];
}

export interface WeekPlan {
  days: PlannedDay[];
  totalMin: number;
  totalTss: number;
  budgetMin: number;
  macroWeek: MacroWeek | null;
  readiness: Readiness;
  summary: string[];
  warnings: string[];
  projectedCtl: number | null;
  projectedTsb: number | null;
}
