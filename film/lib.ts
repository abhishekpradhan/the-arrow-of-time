// Shared helpers for this film's shots.
import { type RenderTarget, type Shot, type ShotContext, type Engine } from '@engine';
import T from './timeline.json';

export type BeatId = (typeof T.beats)[number]['id'];
export const cues = T.cues;
export const timeline = T;

export function beat(id: string) {
  const b = T.beats.find((x) => x.id === id);
  if (!b) throw new Error(`unknown beat ${id}`);
  return b;
}

/**
 * Shot timing for a beat, with dissolves centred on the beat boundaries.
 * `dIn`/`dOut` are dissolve durations (0 = hard cut). `pre`/`post` extend the shot further.
 */
export function span(id: string, o: { dIn?: number; dOut?: number; pre?: number; post?: number } = {}) {
  const b = beat(id);
  const dIn = o.dIn ?? 1;
  const dOut = o.dOut ?? 1;
  return {
    id,
    start: b.start - dIn / 2 - (o.pre ?? 0),
    end: b.end + dOut / 2 + (o.post ?? 0),
    fadeIn: dIn,
    fadeOut: dOut,
  };
}

/** Time since the beat started (negative during an incoming dissolve). */
export function bt(c: ShotContext, id: string) {
  return c.time - beat(id).start;
}

/** Lazily-sized scratch target at a fraction of the output resolution. */
export function scratch(e: Engine, scale = 0.5, depth = false): RenderTarget {
  return e.target({ scale, depth });
}

export type AotShot<S = any> = Shot<S>;
