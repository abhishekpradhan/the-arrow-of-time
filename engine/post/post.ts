// HDR post pipeline: bloom (Jimenez 13-tap down / tent up), anamorphic streaks,
// tonemapping, grading, vignette, grain, dithering, letterbox and text composite.

import { FULLSCREEN_VS, Program, RenderTarget, setBlend, type GL, type Texture } from '../gl/gl';
import type { Engine } from '../core/engine';
import type { Look } from '../core/types';

const DOWN = `
#include <common>
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uSrc; uniform vec2 uTexel; uniform int uKaris;
vec3 s(vec2 o) {
  vec3 c = texture(uSrc, vUv + o * uTexel).rgb;
  // Never let a NaN/Inf pixel bloom into a black hole.
  return (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : min(c, vec3(6.0e4));
}
float kw(vec3 c) { return 1.0 / (1.0 + luma(c)); }
// Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare" (SIGGRAPH 2014):
// 13 bilinear taps forming five overlapping 2x2 boxes, the inner box weighted 1/2 and the four
// corner boxes 1/8 each. On the first downsample each box is weighted by 1 / (1 + luma)
// (Karis average), which keeps single hot pixels from blooming into flickering blobs.
void main() {
  vec3 grid[9]; // 3x3 taps two texels apart, row by row from (-2, -2)
  for (int y = 0; y < 3; y++)
    for (int x = 0; x < 3; x++) grid[y * 3 + x] = s(vec2(float(x - 1), float(y - 1)) * 2.0);
  vec3 inner = 0.25 * (s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0)));
  float w = 0.5 * (uKaris == 1 ? kw(inner) : 1.0);
  vec3 sum = inner * w;
  float wsum = w;
  for (int y = 0; y < 2; y++)
    for (int x = 0; x < 2; x++) {
      int o = y * 3 + x;
      vec3 box = 0.25 * (grid[o] + grid[o + 1] + grid[o + 3] + grid[o + 4]);
      float wb = 0.125 * (uKaris == 1 ? kw(box) : 1.0);
      sum += box * wb;
      wsum += wb;
    }
  fragColor = vec4(max(sum / wsum, 0.0), 1.0);
}`;

const UP = `
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uRadius;
vec3 s(vec2 o) { return texture(uSrc, vUv + o * uTexel * uRadius).rgb; }
void main() {
  vec3 c = s(vec2(-1, 1)) + 2.0 * s(vec2(0, 1)) + s(vec2(1, 1))
         + 2.0 * s(vec2(-1, 0)) + 4.0 * s(vec2(0, 0)) + 2.0 * s(vec2(1, 0))
         + s(vec2(-1, -1)) + 2.0 * s(vec2(0, -1)) + s(vec2(1, -1));
  fragColor = vec4(c / 16.0, 1.0);
}`;

const STREAK = `
#include <common>
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uSrc, uLow; uniform vec2 uTexel; uniform float uThreshold;
void main() {
  // Only compact highlights streak: subtract a much blurrier level so bright extended
  // regions (a galaxy core, a planet) don't smear across the frame.
  vec3 acc = vec3(0.0); float wsum = 0.0;
  for (int i = -40; i <= 40; i++) {
    float x = float(i);
    float w = exp(-abs(x) / 11.0);
    vec2 uv = vUv + vec2(x * 3.0 * uTexel.x, 0.0);
    vec3 c = texture(uSrc, uv).rgb - 1.5 * texture(uLow, uv).rgb;
    c = max(c - uThreshold, 0.0);
    acc += c * w; wsum += w;
  }
  fragColor = vec4(acc / wsum * 6.0, 1.0);
}`;

// Light shafts: a radial smear towards a light source (after Mitchell, "Volumetric Light
// Scattering as a Post-Process", GPU Gems 3). Two passes: a long one from the bright parts of
// the frame, then a short one over its result that fills the gaps between the first pass's taps.
const RAYS = `
#include <common>
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uSrc; uniform vec2 uCenter; uniform float uThreshold, uSpan, uDecay; uniform int uFirst;
void main() {
  vec2 d = (uCenter - vUv) * uSpan / 32.0;
  vec3 acc = vec3(0.0);
  float w = 1.0, wsum = 0.0;
  vec2 uv = vUv;
  for (int i = 0; i < 32; i++) {
    vec3 c = texture(uSrc, uv).rgb;
    if (uFirst == 1) c = (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : max(min(c, vec3(60.0)) - uThreshold, 0.0);
    acc += c * w;
    wsum += w;
    w *= uDecay;
    uv += d;
  }
  fragColor = vec4(acc / wsum, 1.0);
}`;

const FINAL = `
#include <common>
#include <color>
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uScene, uBloom, uStreak, uText, uRays;
uniform float uRaysAmt;
uniform vec3 uRaysTint;
uniform vec2 uRes, uShake;
uniform float uBloomAmt, uBloomNorm, uStreakAmt, uExposure, uContrast, uSaturation;
uniform float uVignette, uGrain, uAberration, uLetterbox, uLetterboxAspect, uFade, uFlash, uTextOpacity;
uniform float uFrame, uFlipY, uHasText, uScrim;
uniform vec2 uScrimCenter, uScrimRadius;
uniform vec3 uStreakTint, uLift, uGamma, uGain, uFlashColor;
uniform int uTonemap;

// High-quality per-pixel noise (integer PCG hash): no lattice patterns in flat areas.
vec3 pixelNoise(vec2 px, float frame) {
  return vec3(pcg3d(uvec3(uvec2(px), uint(frame) + 1u))) * (1.0 / 4294967295.0);
}

void main() {
  vec2 uv = vUv;
  if (uFlipY > 0.5) uv.y = 1.0 - uv.y;
  vec2 suv = uv - uShake / uRes;

  vec2 dir = suv - 0.5;
  vec2 off = dir * dot(dir, dir) * (uAberration / uRes.x) * 8.0;
  vec3 col;
  if (uAberration > 0.0) {
    col.r = texture(uScene, suv - off).r;
    col.g = texture(uScene, suv).g;
    col.b = texture(uScene, suv + off).b;
  } else {
    col = texture(uScene, suv).rgb;
  }
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  col += texture(uBloom, suv).rgb * uBloomNorm * uBloomAmt;
  if (uStreakAmt > 0.0) col += texture(uStreak, suv).rgb * uStreakTint * uStreakAmt;
  if (uRaysAmt > 0.0) col += texture(uRays, suv).rgb * uRaysTint * uRaysAmt;
  col = max(col, 0.0) * exp2(uExposure);

  col = tonemap(col, uTonemap);

  // Grade (linear): contrast around 18% grey, saturation, lift/gamma/gain.
  col = 0.18 * pow(max(col, 1e-6) / 0.18, vec3(uContrast));
  col = max(adjustSaturation(col, uSaturation), 0.0);
  col = col * uGain + uLift * (1.0 - col);
  col = pow(max(col, 0.0), 1.0 / uGamma);

  // Vignette (aspect-aware, smooth).
  vec2 vp = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float vig = 1.0 - uVignette * smoothstep(0.35, 1.05, length(vp) * 1.15);
  col *= vig;

  // Caption scrim: a soft elliptical darkening behind the captions (caption space: x across,
  // y down the visible picture).
  if (uScrim > 0.0) {
    float visibleH = min((uRes.x / uLetterboxAspect) / uRes.y, 1.0);
    float band0 = (1.0 - mix(1.0, visibleH, uLetterbox)) * 0.5;
    float yb = (uv.y - band0) / max(1.0 - 2.0 * band0, 1e-3);
    vec2 q = (vec2(uv.x, 1.0 - yb) - uScrimCenter) / max(uScrimRadius, vec2(1e-3));
    col *= 1.0 - uScrim * 0.55 * smoothstep(1.0, 0.0, length(q));
  }
  col = linearToSrgb(saturate(col));

  if (uHasText > 0.5) {
    vec4 tx = texture(uText, uv) * uTextOpacity;
    col = col * (1.0 - tx.a) + tx.rgb;
  }

  col += uFlash * uFlashColor;
  col *= uFade;

  // Film grain, strongest in the mid-tones, re-seeded every frame.
  vec2 px = floor(uv * uRes);
  vec3 nz = pixelNoise(px, uFrame);
  float g = (nz.x + nz.y + nz.z) - 1.5; // ~N(0, 0.5)
  float l = luma(col);
  float gw = 0.35 + 2.4 * l * (1.0 - l);
  col += g * uGrain * gw;

  // Letterbox bars.
  float visible = (uRes.x / uLetterboxAspect) / uRes.y;
  float bar = (1.0 - min(visible, 1.0)) * 0.5 * uLetterbox * uRes.y;
  float y = uv.y * uRes.y;
  float inPic = smoothstep(bar - 0.5, bar + 0.5, y) * smoothstep(bar - 0.5, bar + 0.5, uRes.y - y);
  col *= inPic;

  // Triangular dither to hide 8-bit banding in dark gradients.
  vec3 nz2 = pixelNoise(px + vec2(7919.0, 104.0), uFrame);
  float dz = nz2.x + nz2.y - 1.0;
  col += dz / 255.0;

  fragColor = vec4(saturate(col), 1.0);
}`;

const TONEMAP_ID = { aces: 0, neutral: 1, agx: 2 } as const;

export class Post {
  gl: GL;
  mips: RenderTarget[] = [];
  streakRT: RenderTarget;
  raysA: RenderTarget;
  raysB: RenderTarget;
  rays: Program;
  down: Program;
  up: Program;
  streak: Program;
  final: Program;
  blank: Texture;

  constructor(private e: Engine) {
    const gl = (this.gl = e.gl);
    let w = e.width, h = e.height;
    for (let i = 0; i < 7; i++) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      this.mips.push(new RenderTarget(gl, w, h, { format: 'rgba16f', filter: 'linear' }));
      if (h <= 8 && this.mips.length >= 2) break;
    }
    const m1 = this.mips[1];
    this.streakRT = new RenderTarget(gl, m1.width, m1.height, { format: 'rgba16f' });
    this.raysA = new RenderTarget(gl, m1.width, m1.height, { format: 'rgba16f' });
    this.raysB = new RenderTarget(gl, m1.width, m1.height, { format: 'rgba16f' });
    this.rays = new Program(gl, FULLSCREEN_VS, RAYS, 'post.rays');
    this.down = new Program(gl, FULLSCREEN_VS, DOWN, 'post.down');
    this.up = new Program(gl, FULLSCREEN_VS, UP, 'post.up');
    this.streak = new Program(gl, FULLSCREEN_VS, STREAK, 'post.streak');
    this.final = new Program(gl, FULLSCREEN_VS, FINAL, 'post.final');
    this.blank = e.blankTexture;
  }

  /** Run the full chain from an HDR target to the canvas (or `out`). */
  run(input: RenderTarget, look: Look, text: Texture | null, frame: number, flipY: boolean, out: RenderTarget | null) {
    const gl = this.gl;
    setBlend(gl, 'none');
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);

    // Bloom down chain.
    let src: RenderTarget = input;
    this.mips.forEach((m, i) => {
      m.bind();
      this.down.use().set({ uSrc: src, uTexel: [1 / src.width, 1 / src.height], uKaris: i === 0 ? 1 : 0 });
      this.e.drawFullscreen();
      src = m;
    });
    // Light shafts from the quarter-resolution level, before the up chain adds bloom into it.
    if (look.rays > 0) {
      const src1 = this.mips[1];
      this.raysA.bind();
      this.rays.use().set({ uSrc: src1, uCenter: look.raysCenter, uThreshold: look.raysThreshold, uSpan: 1.0, uDecay: look.raysDecay, uFirst: 1 });
      this.e.drawFullscreen();
      this.raysB.bind();
      this.rays.use().set({ uSrc: this.raysA, uCenter: look.raysCenter, uThreshold: 0, uSpan: 1.0 / 32.0, uDecay: 1.0, uFirst: 0 });
      this.e.drawFullscreen();
    }
    // Up chain, accumulating into each finer level.
    setBlend(gl, 'add');
    for (let i = this.mips.length - 2; i >= 0; i--) {
      const lo = this.mips[i + 1];
      this.mips[i].bind();
      this.up.use().set({ uSrc: lo, uTexel: [1 / lo.width, 1 / lo.height], uRadius: look.bloomRadius });
      this.e.drawFullscreen();
    }
    setBlend(gl, 'none');

    if (look.streak > 0) {
      this.streakRT.bind();
      const s = this.mips[1];
      this.streak.use().set({
        uSrc: s,
        uLow: this.mips[Math.min(3, this.mips.length - 1)],
        uTexel: [1 / s.width, 1 / s.height],
        uThreshold: look.streakThreshold,
      });
      this.e.drawFullscreen();
    }

    if (out) out.bind();
    else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.e.width, this.e.height);
    }
    this.final.use().set({
      uScene: input,
      uBloom: this.mips[0],
      uStreak: look.streak > 0 ? this.streakRT : this.blank,
      uRays: look.rays > 0 ? this.raysB : this.blank,
      uRaysAmt: look.rays,
      uRaysTint: look.raysTint,
      uText: text ?? this.blank,
      uHasText: text ? 1 : 0,
      uRes: [this.e.width, this.e.height],
      uShake: look.shake,
      uBloomAmt: look.bloom,
      uBloomNorm: 1 / this.mips.length,
      uStreakAmt: look.streak,
      uStreakTint: look.streakTint,
      uExposure: look.exposure,
      uContrast: look.contrast,
      uSaturation: look.saturation,
      uLift: look.lift,
      uGamma: look.gamma,
      uGain: look.gain,
      uVignette: look.vignette,
      uGrain: look.grain,
      uAberration: look.aberration,
      uLetterbox: look.letterbox,
      uLetterboxAspect: look.letterboxAspect,
      uFade: look.fade,
      uFlash: look.flash,
      uFlashColor: look.flashColor,
      uTextOpacity: look.textOpacity,
      uScrim: look.scrim,
      uScrimCenter: look.scrimCenter,
      uScrimRadius: look.scrimRadius,
      uFrame: frame,
      uFlipY: flipY ? 1 : 0,
      uTonemap: TONEMAP_ID[look.tonemap],
    });
    this.e.drawFullscreen();
  }
}
