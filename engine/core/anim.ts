// Time-based animation helpers. Everything is a pure function of time so any
// frame can be rendered in isolation (a hard requirement for parallel,
// deterministic, frame-accurate rendering).

import { clamp, fbm1, lerp, saturate } from './math';

export type Easing = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inQuart: (t: number) => t * t * t * t,
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  inOutQuart: (t: number) => (t < 0.5 ? 8 * t ** 4 : 1 - Math.pow(-2 * t + 2, 4) / 2),
  inQuint: (t: number) => t ** 5,
  outQuint: (t: number) => 1 - Math.pow(1 - t, 5),
  inOutQuint: (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  inSine: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  outSine: (t: number) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  inExpo: (t: number) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t: number) =>
    t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  inCirc: (t: number) => 1 - Math.sqrt(1 - t * t),
  outCirc: (t: number) => Math.sqrt(1 - (t - 1) * (t - 1)),
  outBack: (t: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  smooth: (t: number) => t * t * (3 - 2 * t),
  smoother: (t: number) => t * t * t * (t * (t * 6 - 15) + 10),
} satisfies Record<string, Easing>;

export type EaseName = keyof typeof ease;

/** 0..1 progress of t through [a, b], optionally eased. */
export function prog(t: number, a: number, b: number, e: Easing | EaseName = 'linear'): number {
  const f = typeof e === 'string' ? ease[e] : e;
  return f(saturate((t - a) / (b - a)));
}

/**
 * Envelope that rises over `inDur` after `start`, holds, and falls over
 * `outDur` before `end`. Returns 0 outside [start, end].
 */
export function envelope(
  t: number,
  start: number,
  end: number,
  inDur = 0.5,
  outDur = 0.5,
  e: Easing | EaseName = 'inOutSine',
): number {
  if (t <= start || t >= end) return 0;
  const f = typeof e === 'string' ? ease[e] : e;
  const a = inDur > 0 ? saturate((t - start) / inDur) : 1;
  const b = outDur > 0 ? saturate((end - t) / outDur) : 1;
  return f(Math.min(a, b));
}

export type Key<T> = [time: number, value: T, easing?: Easing | EaseName];

/**
 * Keyframe interpolation. `keys` must be sorted by time. Each key's easing
 * shapes the segment that *arrives* at that key.
 *
 *   const zoom = keys(t, [[0, 1], [4, 3, 'inOutCubic'], [8, 10, 'inExpo']]);
 */
export function keys(t: number, k: Key<number>[]): number;
export function keys(t: number, k: Key<number[]>[]): number[];
export function keys(t: number, k: Key<number | number[]>[]): number | number[] {
  if (k.length === 0) return 0;
  if (t <= k[0][0]) return k[0][1];
  const last = k[k.length - 1];
  if (t >= last[0]) return last[1];
  let i = 1;
  while (i < k.length && k[i][0] < t) i++;
  const [t0, v0] = k[i - 1];
  const [t1, v1, e] = k[i];
  const f = e ? (typeof e === 'string' ? ease[e] : e) : ease.linear;
  const u = f(clamp((t - t0) / (t1 - t0 || 1)));
  if (typeof v0 === 'number') return lerp(v0, v1 as number, u);
  return (v0 as number[]).map((a, j) => lerp(a, (v1 as number[])[j], u));
}

/** Organic hand-held drift, amplitude `amp`, speed `freq` (Hz-ish). */
export function drift(t: number, amp = 1, freq = 0.2, seed = 0): number {
  return fbm1(t * freq, seed) * amp;
}

/** Decaying shake after an impact at `t0` (for camera or post offsets). */
export function shake(t: number, t0: number, amp = 1, decay = 2.5, freq = 18, seed = 3): number {
  if (t < t0) return 0;
  const k = Math.exp(-(t - t0) * decay);
  return fbm1((t - t0) * freq, seed, 2) * amp * k;
}

/** Stagger helper: progress of item i of n appearing across [a,b] with overlap. */
export function stagger(t: number, a: number, b: number, i: number, n: number, overlap = 0.5): number {
  const span = (b - a) / (n - (n - 1) * overlap);
  const s = a + i * span * (1 - overlap);
  return saturate((t - s) / span);
}
