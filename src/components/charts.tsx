import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Block } from '../engine/types';
import { zoneOf } from './ui';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0].contentRect.width;
      if (cw > 0) setW(cw);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!isFinite(min) || !isFinite(max)) return [];
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

export interface LineSeries {
  name: string;
  color: string;
  values: (number | null)[];
  width?: number;
  opacity?: number;
}

export interface Zone {
  from: number;
  to: number;
  color: string;
  label: string;
}

export function LineChart(props: {
  labels: string[];
  series: LineSeries[];
  band?: { low: (number | null)[]; high: (number | null)[]; color: string; name: string };
  height?: number;
  yFormat?: (v: number) => string;
  zeroLine?: boolean;
  tickLabel?: (label: string, i: number) => string | null;
  title?: string;
  zones?: Zone[];
  marker?: number; // index of a vertical "today" marker
  markers?: { index: number; label: string }[]; // annotation triangles along the top
}) {
  const { labels, series, band, height = 180, yFormat = (v) => String(Math.round(v)), zeroLine, tickLabel, zones, marker, markers } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 36;
  const padR = 10;
  const padT = 8;
  const padB = 22;
  const n = labels.length;
  const all: number[] = [];
  series.forEach((s) => s.values.forEach((v) => v != null && all.push(v)));
  band?.low.forEach((v) => v != null && all.push(v));
  band?.high.forEach((v) => v != null && all.push(v));
  if (zeroLine) all.push(0);
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (zones) {
    min = Math.min(min, -32);
    max = Math.max(max, 27);
  }
  const pad = (max - min) * 0.08 || 1;
  min -= pad;
  max += pad;
  const ticks = niceTicks(min, max, 4);
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (width - padL - padR));
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (height - padT - padB);

  const path = (vals: (number | null)[]) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  let bandPath = '';
  if (band) {
    const idx = band.low.map((v, i) => (v != null && band.high[i] != null ? i : -1)).filter((i) => i >= 0);
    if (idx.length > 1) {
      bandPath =
        idx.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(band.high[i]!).toFixed(1)}`).join('') +
        [...idx].reverse().map((i) => `L${x(i).toFixed(1)},${y(band.low[i]!).toFixed(1)}`).join('') +
        'Z';
    }
  }
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - padL) / (width - padL - padR)) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };
  const tickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((width - padL) / 70))));

  return (
    <div className="chart" ref={ref}>
      {series.length > 1 || band ? (
        <div className="legend">
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color, opacity: s.opacity ?? 1 }} />
              {s.name}
            </span>
          ))}
          {band && (
            <span>
              <i className="box" style={{ background: band.color, opacity: 0.25 }} />
              {band.name}
            </span>
          )}
        </div>
      ) : null}
      <svg height={height} viewBox={`0 0 ${width} ${height}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={props.title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)" className="num">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {zones?.map((z) => {
          const top = y(Math.min(z.to, max));
          const bot = y(Math.max(z.from, min));
          if (bot - top <= 0) return null;
          return (
            <g key={z.label}>
              <rect x={padL} y={top} width={Math.max(0, width - padL - padR)} height={bot - top} fill={z.color} opacity={0.1} />
              {bot - top >= 16 && (
                <text
                  x={padL + 6}
                  y={(top + bot) / 2 + 3.5}
                  fontSize={10}
                  fill="var(--muted)"
                  stroke="var(--surface)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {z.label}
                </text>
              )}
            </g>
          );
        })}
        {zeroLine && min < 0 && max > 0 && <line x1={padL} x2={width - padR} y1={y(0)} y2={y(0)} stroke="var(--axis)" strokeWidth={1} />}
        {marker != null && <line x1={x(marker)} x2={x(marker)} y1={padT} y2={height - padB} stroke="var(--axis)" strokeWidth={1} />}
        {markers?.map((mk) => (
          <path key={mk.index} d={`M${x(mk.index) - 4},${padT - 6}L${x(mk.index) + 4},${padT - 6}L${x(mk.index)},${padT}Z`} fill="var(--ink-2)">
            <title>{`${labels[mk.index]}: ${mk.label}`}</title>
          </path>
        ))}
        {bandPath && <path d={bandPath} fill={band!.color} opacity={0.14} />}
        {series.map((s) => (
          <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeLinejoin="round" strokeLinecap="round" opacity={s.opacity ?? 1} />
        ))}
        {labels.map((l, i) => {
          const txt = tickLabel ? tickLabel(l, i) : i % tickEvery === 0 ? l : null;
          return txt ? (
            <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--muted)">
              {txt}
            </text>
          ) : null;
        })}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={height - padB} stroke="var(--axis)" strokeWidth={1} />
            {series.map((s) =>
              s.values[hover] != null ? (
                <circle key={s.name} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ) : null,
            )}
          </g>
        )}
        <rect x={padL} y={0} width={Math.max(0, width - padL - padR)} height={height} fill="transparent" />
      </svg>
      {hover != null && (
        <div className="tip" style={{ left: x(hover), top: Math.min(...series.map((s) => (s.values[hover] != null ? y(s.values[hover]!) : height))) }}>
          <div className="muted">{labels[hover]}</div>
          {series.map((s) =>
            s.values[hover] != null ? (
              <div key={s.name} className="row" style={{ gap: 6 }}>
                <span className="dot" style={{ background: s.color }} />
                {s.name}: <b className="num">{yFormat(s.values[hover]!)}</b>
              </div>
            ) : null,
          )}
          {markers?.find((mk) => mk.index === hover) && <div className="muted">▼ {markers.find((mk) => mk.index === hover)!.label}</div>}
          {band && band.low[hover] != null && (
            <div className="muted">
              {band.name}: {yFormat(band.low[hover]!)}–{yFormat(band.high[hover]!)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function BarChart(props: {
  labels: string[];
  values: number[];
  color?: string;
  height?: number;
  format?: (v: number) => string;
  tooltip?: (i: number) => ReactNode;
  highlight?: number;
  title?: string;
}) {
  const { labels, values, color = 'var(--s1)', height = 170, format = (v) => String(Math.round(v)), tooltip, highlight } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 36;
  const padR = 6;
  const padT = 8;
  const padB = 22;
  const max = Math.max(1, ...values) * 1.08;
  const ticks = niceTicks(0, max, 4);
  const n = values.length;
  const band = (width - padL - padR) / Math.max(1, n);
  const bw = Math.min(24, band * 0.62);
  const y = (v: number) => padT + (1 - v / max) * (height - padT - padB);
  const base = y(0);
  return (
    <div className="chart" ref={ref}>
      <svg height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={props.title} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)" className="num">
              {format(t)}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const cx = padL + band * i + band / 2;
          const top = y(v);
          const h = base - top;
          const r = Math.min(4, h / 2, bw / 2);
          const x0 = cx - bw / 2;
          const d =
            h <= 0
              ? ''
              : `M${x0},${base}L${x0},${top + r}Q${x0},${top} ${x0 + r},${top}L${x0 + bw - r},${top}Q${x0 + bw},${top} ${x0 + bw},${top + r}L${x0 + bw},${base}Z`;
          return (
            <g key={i} onPointerEnter={() => setHover(i)}>
              <rect x={padL + band * i} y={padT} width={band} height={height - padT - padB} fill="transparent" />
              {d && <path d={d} fill={color} opacity={highlight != null && highlight !== i ? 0.55 : hover != null && hover !== i ? 0.75 : 1} />}
              {(() => {
                const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(width / 52))));
                return (i % step === 0 && n - 1 - i >= step) || i === n - 1;
              })() && (
                <text x={cx} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--muted)">
                  {labels[i]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="tip" style={{ left: padL + band * hover + band / 2, top: y(values[hover]) }}>
          {tooltip ? (
            tooltip(hover)
          ) : (
            <>
              <div className="muted">{labels[hover]}</div>
              <b className="num">{format(values[hover])}</b>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Workout profile ("skyline"): width = time, height = %FTP, colour = zone (one-hue ramp). */
export function Skyline({ blocks, large, ftp }: { blocks: Block[]; large?: boolean; ftp?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = large ? 84 : 40;
  const segs: { sec: number; low: number; high: number; ramp: boolean; label?: string }[] = [];
  for (const b of blocks) for (let r = 0; r < b.reps; r++) for (const s of b.steps) segs.push({ sec: s.durationSec, low: s.low, high: s.high, ramp: !!s.ramp, label: s.label });
  const total = segs.reduce((a, s) => a + s.sec, 0) || 1;
  const maxPct = 160;
  const y = (p: number) => height - (Math.min(p, maxPct) / maxPct) * (height - 2);
  let t = 0;
  const shapes = segs.map((s, i) => {
    const x0 = (t / total) * width;
    t += s.sec;
    const x1 = (t / total) * width;
    const w = x1 - x0;
    const gap = w > 6 ? 1 : 0;
    const a = s.ramp ? s.low : (s.low + s.high) / 2;
    const b = s.ramp ? s.high : (s.low + s.high) / 2;
    const z = zoneOf((a + b) / 2);
    const d = `M${x0 + gap / 2},${height}L${x0 + gap / 2},${y(a)}L${x1 - gap / 2},${y(b)}L${x1 - gap / 2},${height}Z`;
    return (
      <path
        key={i}
        d={d}
        fill={`var(--z${z})`}
        opacity={hover != null && hover !== i ? 0.6 : 1}
        onPointerEnter={() => setHover(i)}
      />
    );
  });
  let hx = 0;
  if (hover != null) {
    const before = segs.slice(0, hover).reduce((a, s) => a + s.sec, 0);
    hx = ((before + segs[hover].sec / 2) / total) * width;
  }
  const hs = hover != null ? segs[hover] : null;
  return (
    <div className="chart" ref={ref} onPointerLeave={() => setHover(null)}>
      <svg className={large ? 'skyline skyline-lg' : 'skyline'} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Workout profile">
        {large && <line x1={0} x2={width} y1={y(100)} y2={y(100)} stroke="var(--axis)" strokeWidth={1} strokeDasharray="0" />}
        {shapes}
      </svg>
      {large && hs && (
        <div className="tip" style={{ left: hx, top: 0 }}>
          {hs.label ? <div className="muted">{hs.label}</div> : null}
          <b className="num">
            {Math.round(hs.sec / 60) >= 1 ? `${Math.floor(hs.sec / 60)}:${String(hs.sec % 60).padStart(2, '0')}` : `${hs.sec}s`} @{' '}
            {hs.ramp ? `${hs.low}→${hs.high}%` : hs.low === hs.high ? `${hs.low}%` : `${hs.low}-${hs.high}%`}
          </b>
          {ftp ? <span className="muted num"> · {Math.round((hs.low * ftp) / 100)}{hs.low !== hs.high ? `-${Math.round((hs.high * ftp) / 100)}` : ''} W</span> : null}
        </div>
      )}
    </div>
  );
}

export function ScoreRing({ score, color, label }: { score: number | null; color: string; label: string }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const frac = score == null ? 0 : score / 100;
  return (
    <div className="score-ring">
      <svg width={104} height={104} viewBox="0 0 104 104">
        <circle cx={52} cy={52} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={8} />
        <circle
          cx={52}
          cy={52}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          transform="rotate(-90 52 52)"
        />
      </svg>
      <div className="val">
        <div>
          <b>{score ?? '–'}</b>
          <div className="tiny muted">{label}</div>
        </div>
      </div>
    </div>
  );
}
