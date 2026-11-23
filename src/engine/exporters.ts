// Workout file exporters:
//  * Garmin FIT workout (.fit) — copy to the device's Garmin/NewFiles folder over USB, or
//    let intervals.icu sync it to Garmin Connect automatically.
//  * MRC (% FTP over time) — widely supported by indoor-trainer software.
// Zwift .zwo lives in zwo.ts.
import type { Block, PlannedWorkout } from './types';

// ---------- FIT ----------
const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];

export function fitCrc(bytes: ArrayLike<number>, start = 0, end = bytes.length, crc = 0): number {
  for (let i = start; i < end; i++) {
    const b = bytes[i];
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[b & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf];
  }
  return crc;
}

// FIT base types
const ENUM = 0x00;
const UINT16 = 0x84;
const UINT32 = 0x86;
const UINT32Z = 0x8c;
const STRING = 0x07;
const SIZES: Record<number, number> = { [ENUM]: 1, [UINT16]: 2, [UINT32]: 4, [UINT32Z]: 4 };

type FieldDef = [num: number, size: number, base: number];

class Writer {
  bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 0xff);
  }
  u16(v: number) {
    this.u8(v);
    this.u8(v >> 8);
  }
  u32(v: number) {
    this.u16(v & 0xffff);
    this.u16((v >>> 16) & 0xffff);
  }
  str(s: string, size: number) {
    const enc = new TextEncoder().encode(s).slice(0, size - 1);
    for (let i = 0; i < size; i++) this.u8(i < enc.length ? enc[i] : 0);
  }
  definition(local: number, global: number, fields: FieldDef[]) {
    this.u8(0x40 | local);
    this.u8(0); // reserved
    this.u8(0); // little-endian
    this.u16(global);
    this.u8(fields.length);
    for (const [num, size, base] of fields) {
      this.u8(num);
      this.u8(size);
      this.u8(base);
    }
  }
  data(local: number, fields: FieldDef[], values: (number | string)[]) {
    this.u8(local);
    fields.forEach(([, size, base], i) => {
      const v = values[i];
      if (base === STRING) this.str(String(v), size);
      else if (SIZES[base] === 1) this.u8(Number(v));
      else if (SIZES[base] === 2) this.u16(Number(v));
      else this.u32(Number(v));
    });
  }
}

const FIT_EPOCH = Date.UTC(1989, 11, 31, 0, 0, 0);

interface FitStep {
  name: string;
  kind: 'time' | 'repeat';
  seconds?: number;
  low?: number; // % FTP
  high?: number;
  intensity?: number; // 0 active, 1 rest, 2 warmup, 3 cooldown, 4 recovery
  repeatFrom?: number;
  repeatCount?: number;
}

function intensityOf(blockName: string | undefined, low: number, high: number, isFirst: boolean, isLast: boolean): number {
  const n = (blockName ?? '').toLowerCase();
  if (n.startsWith('warm') || (isFirst && high <= 80)) return 2;
  if (n.startsWith('cool') || (isLast && high <= 65)) return 3;
  if ((low + high) / 2 < 60) return 4;
  return 0;
}

function toFitSteps(blocks: Block[]): FitStep[] {
  const steps: FitStep[] = [];
  blocks.forEach((b, bi) => {
    const start = steps.length;
    b.steps.forEach((st, si) => {
      const label = st.label ?? (b.name && si === 0 ? b.name : '');
      steps.push({
        name: `${label}${st.cadence ? ` ${st.cadence}` : ''}`.trim().slice(0, 15),
        kind: 'time',
        seconds: st.durationSec,
        low: Math.round(st.low),
        high: Math.round(Math.max(st.low, st.high)),
        intensity: intensityOf(b.name, st.low, st.high, bi === 0 && si === 0, bi === blocks.length - 1 && si === b.steps.length - 1),
      });
    });
    if (b.reps > 1) steps.push({ name: '', kind: 'repeat', repeatFrom: start, repeatCount: b.reps });
  });
  return steps;
}

/** Encode a planned workout as a FIT workout file (power targets in % FTP). */
export function workoutToFit(w: PlannedWorkout, created = new Date()): Uint8Array {
  const body = new Writer();
  const fileId: FieldDef[] = [
    [0, 1, ENUM], // type
    [1, 2, UINT16], // manufacturer
    [2, 2, UINT16], // product
    [3, 4, UINT32Z], // serial number
    [4, 4, UINT32], // time created
  ];
  body.definition(0, 0, fileId);
  body.data(0, fileId, [5, 255, 0, 20261122, Math.max(0, Math.floor((created.getTime() - FIT_EPOCH) / 1000))]);

  const steps = toFitSteps(w.blocks);
  const workout: FieldDef[] = [
    [4, 1, ENUM], // sport
    [11, 1, ENUM], // sub sport
    [6, 2, UINT16], // num valid steps
    [8, 32, STRING], // name
  ];
  body.definition(1, 26, workout);
  body.data(1, workout, [2, 0, steps.length, w.name]);

  const step: FieldDef[] = [
    [254, 2, UINT16], // message index
    [0, 16, STRING], // step name
    [1, 1, ENUM], // duration type
    [2, 4, UINT32], // duration value
    [3, 1, ENUM], // target type
    [4, 4, UINT32], // target value
    [5, 4, UINT32], // custom target low
    [6, 4, UINT32], // custom target high
    [7, 1, ENUM], // intensity
  ];
  body.definition(2, 27, step);
  steps.forEach((st, i) => {
    if (st.kind === 'repeat') body.data(2, step, [i, '', 6, st.repeatFrom!, 2, st.repeatCount!, 0, 0, 0]);
    // power target: values 0-1000 are % FTP on Garmin devices
    else body.data(2, step, [i, st.name, 0, Math.round(st.seconds! * 1000), 4, 0, st.low!, st.high!, st.intensity!]);
  });

  const header = new Writer();
  header.u8(14);
  header.u8(0x20); // protocol 2.0
  header.u16(2132); // profile version 21.32
  header.u32(body.bytes.length);
  for (const c of '.FIT') header.u8(c.charCodeAt(0));
  header.u16(fitCrc(header.bytes));
  const all = [...header.bytes, ...body.bytes];
  const crc = fitCrc(all);
  all.push(crc & 0xff, (crc >> 8) & 0xff);
  return new Uint8Array(all);
}

// ---------- MRC ----------
export function workoutToMrc(w: PlannedWorkout): string {
  const rows: string[] = [];
  let t = 0;
  for (const b of w.blocks)
    for (let r = 0; r < b.reps; r++)
      for (const st of b.steps) {
        const a = st.ramp ? st.low : (st.low + st.high) / 2;
        const z = st.ramp ? st.high : a;
        rows.push(`${(t / 60).toFixed(2)}\t${Math.round(a)}`);
        t += st.durationSec;
        rows.push(`${(t / 60).toFixed(2)}\t${Math.round(z)}`);
      }
  return [
    '[COURSE HEADER]',
    'VERSION = 2',
    'UNITS = ENGLISH',
    `DESCRIPTION = ${w.purpose.replace(/\n/g, ' ')}`,
    `FILE NAME = ${w.name}`,
    'MINUTES PERCENT',
    '[END COURSE HEADER]',
    '[COURSE DATA]',
    ...rows,
    '[END COURSE DATA]',
    '',
  ].join('\r\n');
}

export function safeFileName(name: string): string {
  return name.replace(/×/g, 'x').replace(/[^\w\-+ ]+/g, '').trim().replace(/\s+/g, '_') || 'workout';
}
