// A barred spiral galaxy made of sprites (the Milky Way in The Arrow of Time), with
// differential rotation. Three layers: point-like stars at full resolution, a soft glow layer
// at half resolution (it is smooth, and it is most of the sprites' fill cost), and dust lanes
// that absorb light behind them.
//
//   const galaxy = new Galaxy(e, { seed: 70 });
//   galaxy.draw(c, cam, { spin: 0.02 * t });   // after the sky, into c.target

import type { Camera } from '../core/camera';
import { blackbody } from '../core/color';
import type { Engine } from '../core/engine';
import { rng, type Vec3 } from '../core/math';
import type { ShotContext } from '../core/types';
import type { RenderTarget } from '../gl/gl';
import { Sprites, allocSprites, type SpriteData } from './sprites';

/** Sprite `animate` hook: flat rotation curve (omega ~ 1/r) with a solid-body core. Uniform: uSpin. */
export const GALAXY_SPIN = `
uniform float uSpin;
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  float r = length(p.xz);
  // Flat rotation curve with a solid-body core: omega ~ 1/r outside ~0.12.
  float omega = 1.0 / max(r, 0.12);
  float a = -uSpin * omega;
  float c = cos(a), s = sin(a);
  return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
}`;

/** Sprite `shade` hook for absorbers: opacity = col.r * Gaussian. Draw with blend 'premul'. */
export const ABSORBER_SHADE = `
vec4 shade(vec2 q, vec3 col, vec4 x) {
  float g = exp(-0.5 * dot(q, q));
  float a = g * col.r;
  return vec4(0.0, 0.0, 0.0, a);
}`;

const COMPOSITE = `
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uSrc;
void main() { fragColor = vec4(texture(uSrc, vUv).rgb, 1.0); }`;

/**
 * Sprite data for a barred spiral (disk radius ~1, in the xz plane): sparkle stars with pink
 * star-forming knots, a smooth luminous glow layer following the same arms plus a warm bulge,
 * and patchy dust lanes (drawn as absorbers). Draw it with `Galaxy`, or build your own layers.
 */
export function galaxyData(seed: number, o: { stars?: number; glow?: number } = {}): { stars: SpriteData; glow: SpriteData; dust: SpriteData } {
  const r = rng(seed);
  const nStars = o.stars ?? 110000, nGlow = o.glow ?? 26000, nHII = 900, nBulge = 9000;
  // Point-like stars render at full resolution; the smooth glow layer at half resolution.
  const stars = allocSprites(nStars + nHII);
  const glow = allocSprites(nGlow + nBulge);
  let i = 0, j = 0;
  const put = (p: Vec3, c: Vec3, b: number, size: number) => {
    stars.position.set(p, i * 3);
    stars.color.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    stars.size[i] = size;
    i++;
  };
  const putGlow = (p: Vec3, c: Vec3, b: number, size: number) => {
    glow.position.set(p, j * 3);
    glow.color.set([c[0] * b, c[1] * b, c[2] * b], j * 3);
    glow.size[j] = size;
    j++;
  };
  const barAngle = 0.45, barLen = 0.2;
  const pitch = (19 * Math.PI) / 180;
  const arms = [
    { phase: barAngle, w: 1.0 },
    { phase: barAngle + Math.PI, w: 1.0 },
    { phase: barAngle + Math.PI / 2, w: 0.55 },
    { phase: barAngle + (3 * Math.PI) / 2, w: 0.55 },
  ];
  const armAngle = (phase: number, rr: number) => phase + Math.log(Math.max(rr, barLen) / barLen) / Math.tan(pitch);
  /** Sample a disk point: in an arm (with physical width) or in the smooth disk / bar. */
  const sample = (armFrac: number, width: number) => {
    let rr = 0;
    do rr = -Math.log(1 - r.next()) * 0.3 + 0.03; while (rr > 1.1);
    let th: number, armW = 0;
    if (r.next() < armFrac && rr > barLen * 0.8) {
      const a = arms[r.next() < 0.7 ? r.int(0, 1) : r.int(2, 3)];
      armW = a.w;
      th = armAngle(a.phase, rr) + (r.gauss() * width) / rr;
    } else if (rr < barLen * 1.1 && r.next() < 0.6) {
      // Bar: an elongated distribution along barAngle.
      const x = r.gauss() * barLen * 0.55, z = r.gauss() * barLen * 0.16;
      const c = Math.cos(barAngle), sn = Math.sin(barAngle);
      return { p: [c * x - sn * z, r.gauss() * 0.015, sn * x + c * z] as Vec3, rr: Math.hypot(x, z), armW: 0, bar: true };
    } else th = r.next() * Math.PI * 2;
    const y = r.gauss() * (0.01 + 0.012 * rr);
    return { p: [rr * Math.cos(th), y, rr * Math.sin(th)] as Vec3, rr, armW, bar: false };
  };
  for (let k = 0; k < nStars; k++) {
    const s0 = sample(0.7, 0.05);
    const young = s0.armW > 0 && r.next() < 0.6 * s0.armW;
    const T = young ? r.range(8000, 18000) : s0.bar || s0.rr < 0.15 ? r.range(3600, 5200) : r.range(4300, 7500);
    const bri = (young ? r.range(0.25, 1.1) : r.range(0.12, 0.5)) * (Math.pow(r.next(), 6) * 3 + 0.6) * 0.085;
    put(s0.p, blackbody(T), bri, young ? 0.0026 : 0.0022);
  }
  for (let k = 0; k < nGlow; k++) {
    const s0 = sample(0.62, 0.055);
    const warm = Math.exp(-s0.rr * 5);
    const arm = s0.armW > 0 ? 1 : 0;
    const cool: Vec3 = arm ? [0.55, 0.72, 1.0] : [0.85, 0.85, 0.9];
    const hot: Vec3 = [1.0, 0.7, 0.38];
    const c: Vec3 = [cool[0] + (hot[0] - cool[0]) * warm, cool[1] + (hot[1] - cool[1]) * warm, cool[2] + (hot[2] - cool[2]) * warm];
    putGlow(s0.p, c, 0.0032 * (0.6 + 0.8 * warm + 0.45 * s0.armW), r.range(0.022, 0.045));
  }
  for (let k = 0; k < nHII; k++) {
    let rr = 0;
    do rr = -Math.log(1 - r.next()) * 0.3 + 0.22; while (rr > 1.0);
    const a = arms[r.int(0, 3)];
    const th = armAngle(a.phase, rr) + (r.gauss() * 0.03) / rr + 0.04;
    put([rr * Math.cos(th), r.gauss() * 0.006, rr * Math.sin(th)], [1.0, 0.3, 0.45], r.range(0.3, 1.0) * 0.45, r.range(0.003, 0.008));
  }
  for (let k = 0; k < nBulge; k++) {
    const rr = Math.abs(r.gauss()) * 0.07;
    const d = r.onSphere();
    putGlow([d[0] * rr, d[1] * rr * 0.6, d[2] * rr], blackbody(r.range(3200, 4200)), 0.011, r.range(0.012, 0.03));
  }
  const nDust = 30000;
  const dust = allocSprites(nDust);
  for (let k = 0; k < nDust; k++) {
    let rr = 0;
    do rr = -Math.log(1 - r.next()) * 0.3 + 0.12; while (rr > 1.0);
    const a = arms[r.next() < 0.75 ? r.int(0, 1) : r.int(2, 3)];
    // Break the lanes into patches: skip dust where a slow noise along the arm is low.
    const patch = 0.5 + 0.5 * Math.sin(rr * 23 + a.phase * 3) * Math.sin(rr * 9.7 + a.phase);
    if (r.next() > 0.25 + 0.75 * patch) {
      dust.size[k] = 0;
      continue;
    }
    const th = armAngle(a.phase, rr) - 0.05 / rr + (r.gauss() * 0.02) / rr + (r.next() < 0.3 ? r.gauss() * 0.05 : 0);
    dust.position.set([rr * Math.cos(th), r.gauss() * 0.005, rr * Math.sin(th)], k * 3);
    dust.color.set([r.range(0.04, 0.16) * a.w, 0, 0], k * 3);
    dust.size[k] = r.range(0.006, 0.016);
  }
  return { stars, glow, dust };
}

export interface GalaxyOptions {
  seed?: number;
  /** Sprite counts (defaults 110k stars, 26k glow). */
  stars?: number;
  glow?: number;
  /** Resolution scale of the glow layer's target (default 0.5). */
  glowScale?: number;
}

export class Galaxy {
  stars: Sprites;
  glow: Sprites;
  dust: Sprites;
  private half: RenderTarget;

  constructor(e: Engine, o: GalaxyOptions = {}) {
    const d = galaxyData(o.seed ?? 70, o);
    this.half = e.target({ scale: o.glowScale ?? 0.5 });
    this.glow = new Sprites(e, d.glow, { animate: GALAXY_SPIN, minPixels: 1.0, extent: 2.6 });
    this.stars = new Sprites(e, d.stars, { animate: GALAXY_SPIN, minPixels: 0.6 });
    this.dust = new Sprites(e, d.dust, { animate: GALAXY_SPIN, shade: ABSORBER_SHADE, minPixels: 1.0 });
  }

  /**
   * Draws the galaxy into `c.target` (draw the sky first). `spin` is the rotation angle at
   * r = 1 in radians; the galaxy's frame is the camera's world frame.
   */
  draw(c: ShotContext, cam: Camera, o: { spin?: number; brightness?: number; dust?: boolean } = {}) {
    const u = { uSpin: o.spin ?? 0 };
    const brightness = o.brightness ?? 1;
    this.half.clear(0, 0, 0, 1);
    this.glow.draw(cam, c.time, u, { blend: 'add', brightness });
    c.target.bind();
    c.gl.enable(c.gl.BLEND);
    c.gl.blendFunc(c.gl.ONE, c.gl.ONE);
    c.fullscreen(c.e.program(COMPOSITE, 'galaxy.composite'), { uSrc: this.half });
    c.gl.disable(c.gl.BLEND);
    this.stars.draw(cam, c.time, u, { blend: 'add', brightness });
    if (o.dust !== false) this.dust.draw(cam, c.time, u, { blend: 'premul' });
  }
}
