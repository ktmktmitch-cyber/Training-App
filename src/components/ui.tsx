import { useEffect, useState, type ReactNode } from 'react';
import type { AthleteProfile, Intensity, ReadinessStatus, WorkoutCategory } from '../engine/types';

export function zoneOf(pct: number, zones = [55, 75, 90, 105, 120, 150, 999]): number {
  for (let i = 0; i < zones.length; i++) if (pct <= zones[i]) return i + 1;
  return 7;
}

export function watts(pct: number, ftp: number): number {
  return Math.round((pct * ftp) / 100);
}

/** Approximate HR range (bpm) for a %FTP target using the athlete's HR zones. */
export function hrFor(pct: number, profile: AthleteProfile | null): string | null {
  const z = profile?.hrZones;
  if (!z || z.length < 4) return null;
  const pz = zoneOf(pct);
  if (pz === 1) return `<${z[0]}`;
  if (pz === 2) return `${z[0]}-${z[1]}`;
  if (pz === 3) return `${z[1]}-${z[2]}`;
  if (pz === 4) return `${z[2]}-${z[3]}`;
  return `>${z[3]}`;
}

export const CATEGORY_LABEL: Record<WorkoutCategory, string> = {
  rest: 'Rest',
  recovery: 'Recovery',
  endurance: 'Endurance',
  tempo: 'Tempo',
  sweetspot: 'Sweet spot',
  threshold: 'Threshold',
  vo2max: 'VO2max',
  anaerobic: 'Anaerobic',
  sprint: 'Sprint',
  race_sim: 'Race-specific',
  durability: 'Durability',
  openers: 'Openers',
  test: 'Test',
  group: 'Group ride',
  race: 'Race',
};

export const INTENSITY_ZONE: Record<Intensity, number> = { rest: 1, easy: 2, moderate: 4, hard: 6 };

export function IntensityChip({ intensity, category }: { intensity: Intensity; category: WorkoutCategory }) {
  const label = intensity === 'hard' ? 'Hard' : intensity === 'moderate' ? 'Moderate' : intensity === 'easy' ? 'Easy' : 'Rest';
  return (
    <span className="chip">
      <span className="dot" style={{ background: `var(--z${INTENSITY_ZONE[intensity]})` }} />
      {CATEGORY_LABEL[category]} · {label}
    </span>
  );
}

export const STATUS: Record<ReadinessStatus, { color: string; label: string; icon: string }> = {
  green: { color: 'var(--good)', label: 'Ready', icon: '✓' },
  amber: { color: 'var(--warning)', label: 'Caution', icon: '!' },
  red: { color: 'var(--critical)', label: 'Recover', icon: '×' },
  unknown: { color: 'var(--s-neutral)', label: 'No data', icon: '?' },
};

export function StatusIcon({ status }: { status: ReadinessStatus }) {
  const s = STATUS[status];
  return (
    <span className="status-icon" style={{ background: s.color, color: status === 'amber' ? '#0b0b0b' : '#fff' }} aria-hidden>
      {s.icon}
    </span>
  );
}

export function Seg<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function useToast(): [ReactNode, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg ? <div className="toast" role="status">{msg}</div> : null, setMsg];
}

export function Icon({ name, size = 18 }: { name: 'week' | 'season' | 'trends' | 'strength' | 'settings' | 'guide' | 'bolt' | 'sync' | 'library' | 'more'; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'week':
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="17" rx="3" />
          <path d="M3 9h18M8 2v4M16 2v4" />
        </svg>
      );
    case 'season':
      return (
        <svg {...p}>
          <path d="M3 20h18M5 20V12M10 20V8M15 20v-6M20 20V4" />
        </svg>
      );
    case 'trends':
      return (
        <svg {...p}>
          <path d="M3 17l5-6 4 4 8-9" />
          <path d="M14 6h6v6" />
        </svg>
      );
    case 'strength':
      return (
        <svg {...p}>
          <path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    case 'guide':
      return (
        <svg {...p}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
          <path d="M20 17v4H6.5A2.5 2.5 0 0 1 4 18.5" />
        </svg>
      );
    case 'bolt':
      return (
        <svg {...p} fill="currentColor" stroke="none">
          <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
        </svg>
      );
    case 'library':
      return (
        <svg {...p}>
          <rect x="3" y="4" width="5" height="16" rx="1" />
          <rect x="10" y="4" width="5" height="16" rx="1" />
          <path d="M17.5 5.5l3 14" />
        </svg>
      );
    case 'more':
      return (
        <svg {...p}>
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      );
    case 'sync':
      return (
        <svg {...p}>
          <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12a9 9 0 0 1 15.5-6.3L21 8" />
          <path d="M21 3v5h-5M3 21v-5h5" />
        </svg>
      );
  }
}
