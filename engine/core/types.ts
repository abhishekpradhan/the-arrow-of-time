import type { Engine } from './engine';
import type { GL, RenderTarget, Program, UniformValue } from '../gl/gl';
import type { Vec2, Vec3 } from './math';
import type { TextItem } from '../text/text';

/** Everything a shot needs to draw one (sub)frame. */
export interface ShotContext {
  e: Engine;
  gl: GL;
  /** Seconds since the shot started. */
  t: number;
  /** Shot duration in seconds. */
  dur: number;
  /** Progress through the shot, 0..1. */
  p: number;
  /** Global film time in seconds. */
  time: number;
  frame: number;
  fps: number;
  width: number;
  height: number;
  aspect: number;
  /** HDR target the shot draws into (already bound and cleared to black). */
  target: RenderTarget;
  /** Draw `prog` over the whole target with the standard uniforms (uRes, uTime, uDur, uProg, uGTime, uAspect) plus `uniforms`. */
  fullscreen(prog: Program, uniforms?: Record<string, UniformValue>): void;
}

export interface Shot<S = any> {
  id: string;
  start: number;
  end: number;
  /** Seconds to fade/dissolve in from black or from the previous shot (overlap them for a dissolve). */
  fadeIn?: number;
  fadeOut?: number;
  /** Sub-frame samples for motion blur in this shot (overrides the project default). */
  motionBlur?: number;
  /** Create GPU resources once. May be async (textures, heavy precomputation). */
  setup?(e: Engine): S | Promise<S>;
  render(c: ShotContext, state: S): void;
}

export type Tonemapper = 'aces' | 'neutral' | 'agx';

/** Post-processing "look". Every field can be animated through `Project.look(t)`. */
export interface Look {
  exposure: number; // EV stops
  bloom: number; // bloom mix amount (0.02 subtle .. 0.3 dreamy)
  bloomRadius: number;
  streak: number; // anamorphic streak amount
  streakThreshold: number;
  streakTint: Vec3;
  tonemap: Tonemapper;
  contrast: number;
  saturation: number;
  lift: Vec3;
  gamma: Vec3;
  gain: Vec3;
  vignette: number;
  grain: number;
  aberration: number;
  /** 0 = full 16:9 frame, 1 = bars for `letterboxAspect`. */
  letterbox: number;
  letterboxAspect: number;
  /** Global fade multiplier (0 = black). */
  fade: number;
  /** Additive flash (display space). */
  flash: number;
  flashColor: Vec3;
  /** Whole-frame offset in pixels (camera shake). */
  shake: Vec2;
  textOpacity: number;
  /** Darken the lower third of the picture (behind captions), 0..1. */
  scrim: number;
}

export const DEFAULT_LOOK: Look = {
  exposure: 0,
  bloom: 0.06,
  bloomRadius: 1,
  streak: 0,
  streakThreshold: 1.0,
  streakTint: [0.55, 0.7, 1.0],
  tonemap: 'aces',
  contrast: 1,
  saturation: 1,
  lift: [0, 0, 0],
  gamma: [1, 1, 1],
  gain: [1, 1, 1],
  vignette: 0.25,
  grain: 0.03,
  aberration: 0,
  letterbox: 0,
  letterboxAspect: 2.39,
  fade: 1,
  flash: 0,
  flashColor: [1, 1, 1],
  shake: [0, 0],
  textOpacity: 1,
  scrim: 0,
};

export interface Project {
  id: string;
  title: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  /** Path (served by Vite) of the soundtrack used by the preview and the final mux. */
  audio?: string;
  /** CSS font shorthands to preload before text renders, e.g. '500 64px Cinzel'. */
  fonts?: string[];
  /** Default motion-blur sub-samples (1 = off). */
  motionBlur?: number;
  /** Shutter as a fraction of the frame interval (0.5 = 180-degree shutter). */
  shutter?: number;
  setup?(e: Engine): void | Promise<void>;
  shots: Shot[];
  text?: TextItem[];
  look?: (t: number) => Partial<Look>;
  /** Named markers shown in the preview timeline. */
  markers?: { t: number; label: string }[];
}

export function defineProject(p: Project): Project {
  return p;
}

export function defineShot<S>(s: Shot<S>): Shot<S> {
  return s;
}
