// Act I: prologue, Big Bang, inflation, first elements, first light.
import { Camera, Sprites, allocSprites, blackbody, keys, rng, prog, type RenderTarget, type Shot } from '@engine';
import { beat, bt, cues, scratch, span } from '../lib';

// ------------------------------------------------------------------ prologue
const PROLOGUE = `
#include <noise>
#include <color>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime;
uniform float uPoint, uGather, uFoam, uMotes;
void main() {
  vec2 p = centered(vUv, uAspect);
  float r = length(p);
  float px = 1.0 / uRes.y;
  vec3 col = vec3(0.0);
  // Faint quantum foam: barely-there shimmering texture in the void.
  float foam = fbm(vec3(p * 5.0, uGTime * 0.12), 4);
  col += vec3(0.30, 0.26, 0.45) * pow(foam, 4.0) * uFoam;
  // Motes of light drifting in along slow spirals towards the centre, where the point will be:
  // more of them, and faster, as the clock runs on.
  for (int i = 0; i < 70; i++) {
    vec3 h = hash31(float(i) * 3.71 + 0.5);
    float phase = fract(h.x + uGTime * (0.015 + 0.03 * h.z) * (0.6 + 1.8 * uMotes));
    float rr = mix(0.9, 0.015, phase * phase);
    float ang = h.y * TAU + phase * (2.0 + 2.0 * h.z);
    vec2 mp = vec2(cos(ang), sin(ang)) * rr * vec2(0.5 * uAspect, 0.5);
    vec2 dm = p - mp;
    float on = smoothstep(0.0, 0.25, phase) * smoothstep(1.0, 0.8, phase) * step(h.z, 0.25 + 0.75 * uMotes);
    col += vec3(0.7, 0.8, 1.0) * on * uMotes * 2.2e-6 / (dot(dm, dm) + 3.0e-6);
  }
  // Spiralling streaks of energy flowing inward.
  if (uGather > 0.0) {
    float a = atan(p.y, p.x);
    float lr = log(max(r, 1e-4));
    float u = a / TAU + lr * 0.12;
    float n = vnoise(vec2(fract(u) * 90.0, lr * 1.6 + uGTime * 2.4));
    float n2 = vnoise(vec2(fract(u + 0.37) * 140.0, lr * 2.3 + uGTime * 3.1));
    float s = pow(n, 14.0) + 0.6 * pow(n2, 18.0);
    float w = smoothstep(0.004, 0.06, r) * exp(-r * 4.0);
    col += vec3(0.75, 0.85, 1.0) * s * w * uGather * 3.0;
  }
  // The point: sub-pixel core plus a tight halo.
  float sig = 1.1 * px;
  col += vec3(1.0, 0.96, 0.9) * uPoint * (exp(-r * r / (2.0 * sig * sig)) + 0.015 * exp(-r / (0.012 + 0.01 * uPoint / 40.0)));
  fragColor = vec4(col, 1.0);
}`;

function prologue(): Shot {
  const b = beat('prologue');
  return {
    ...span('prologue', { dIn: 0, dOut: 0 }),
    render(c) {
      const t = c.time;
      const riser = cues.riserStart;
      const appear = prog(t, 14.0, 16.0, 'inOutSine');
      const grow = prog(t, 16.0, 19.55, 'inQuad');
      // Trembling brightness that swells, then a held breath just before the bang.
      const flicker = 1 + 0.25 * Math.sin(t * 23.0) * Math.sin(t * 7.3);
      let point = appear * (1.2 + 45 * grow) * flicker;
      if (t > 19.62) point *= 0.25;
      c.fullscreen(c.e.program(PROLOGUE, 'prologue'), {
        uPoint: point,
        uGather: prog(t, riser + 2.0, 19.5, 'inCubic') * (t > 19.62 ? 0 : 1),
        uFoam: 0.06 + 0.1 * prog(t, 2, b.end, 'linear'),
        uMotes: prog(t, 1.0, 15.0, 'inQuad') * (t > 19.62 ? 0 : 1),
      });
    },
  };
}

// ------------------------------------------------------------------ big bang
const BANG_PLASMA = `
#include <noise>
#include <color>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uT;
float radiusAt(float t) { return 1.6 * (1.0 - exp(-t * 0.45)) + 0.03; }
void main() {
  vec2 p = centered(vUv, uAspect);
  float r = length(p);
  float R = max(radiusAt(uT), 1e-3);
  float x = r / R;
  // Turbulent plasma that expands with the fireball (coordinates scale with R).
  vec3 q = vec3(p / (0.35 + R) * 3.2, uT * 0.22);
  float w = fbm(q * 1.3 + vec3(3.1, 7.7, 1.9), 3);
  float n = fbm(q + w * 1.6, 5);
  float n2 = fbm(q * 3.1 - w, 4);
  // Shell-like density: bright edge, filled interior, ragged boundary, strong filaments.
  float edge = smoothstep(1.0 + 0.3 * (n - 0.5), 0.7, x);
  float fil = pow(n, 3.0) * 3.2 + pow(n2, 4.0) * 1.5;
  float dens = edge * (0.45 + 0.7 * smoothstep(0.1, 0.95, x)) * (0.16 + fil);
  // Cooling with radius and time: white-gold core, orange body, red-magenta edges.
  float cool = saturate(x * 0.5 + uT * 0.045 + (0.5 - n) * 0.5);
  float heat = 1.0 - cool;
  vec3 col = fireRamp(heat) * (0.35 + 1.4 * heat * heat);
  float energy = 1.6 * exp(-uT * 0.9) + 0.75 + 0.25 * exp(-uT * 0.1);
  col *= dens * energy * 1.5;
  // Violet haze beyond the front.
  col += vec3(0.3, 0.06, 0.4) * smoothstep(1.7, 0.95, x) * (1.0 - edge) * n * 0.35;
  fragColor = vec4(col, 1.0);
}`;

const BANG_COMPOSITE = `
#include <noise>
#include <color>
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uPlasma;
uniform vec2 uRes; uniform float uAspect, uT;
void main() {
  vec2 p = centered(vUv, uAspect);
  float r = length(p);
  float a = atan(p.y, p.x);
  vec3 col = texture(uPlasma, vUv).rgb;
  // Blinding core.
  float core = exp(-r / (0.01 + uT * 0.035)) * (60.0 * exp(-uT * 2.5) + 2.5 * exp(-uT * 0.35));
  col += vec3(1.0, 0.95, 0.85) * core;
  // Radial rays streaming outward.
  float rays = pow(vnoise(vec2(a * 40.0, 3.0)), 5.0) * 0.7 + pow(vnoise(vec2(a * 110.0 + 5.0, 7.0)), 9.0);
  float rayLen = 0.25 + uT * 0.5;
  col += vec3(1.0, 0.85, 0.6) * rays * exp(-r / rayLen) * 3.0 * exp(-uT * 1.1);
  // Shock ring racing ahead of the fireball.
  float Rs = 2.3 * (1.0 - exp(-uT * 0.9));
  float ring = exp(-pow((r - Rs) / (0.006 + 0.012 * uT), 2.0)) * (0.5 + vnoise(vec2(a * 12.0, uT)));
  col += vec3(1.0, 0.8, 0.6) * ring * 0.9 * exp(-uT * 0.8);
  fragColor = vec4(col, 1.0);
}`;

function bigBang(): Shot<{ half: RenderTarget }> {
  return {
    ...span('bigbang', { dIn: 0, dOut: 1.2 }),
    motionBlur: 3,
    setup: (e) => ({ half: scratch(e, 0.5) }),
    render(c, s) {
      const T = Math.max(0, bt(c, 'bigbang'));
      s.half.bind();
      c.fullscreen(c.e.program(BANG_PLASMA, 'bang.plasma'), { uT: T });
      c.target.bind();
      c.fullscreen(c.e.program(BANG_COMPOSITE, 'bang.comp'), { uT: T, uPlasma: s.half });
    },
  };
}

// ------------------------------------------------------------------ inflation
const INFLATION_FIELD = `
#include <noise>
#include <color>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uLz;
// Seamless infinite zoom-in: layers grow by 2x per unit of lz and cross-fade in log scale.
float zoomNoise(vec2 p, float lz, float base) {
  float acc = 0.0, wsum = 0.0;
  float k0 = floor(lz);
  for (int j = 0; j < 5; j++) {
    float k = k0 - float(j);
    float u = lz - k;                     // 0..5: age of this layer
    float w = sin(PI * saturate(u / 5.0)); w *= w;
    vec2 o = hash22(vec2(k, 7.0)) * 100.0;
    acc += w * fbm(p * base / exp2(u) + o, 4);
    wsum += w;
  }
  return acc / max(wsum, 1e-4);
}
// Bright quantum fluctuations riding the same expansion.
float specks(vec2 p, float lz) {
  float acc = 0.0;
  float k0 = floor(lz);
  for (int j = 0; j < 5; j++) {
    float k = k0 - float(j);
    float u = lz - k;
    float w = sin(PI * saturate(u / 5.0)); w *= w;
    vec2 q = p * 60.0 / exp2(u) + hash22(vec2(k, 3.0)) * 50.0;
    vec2 cell = floor(q);
    vec3 h = hash32(cell + k * 17.0);
    vec2 d = fract(q) - 0.5 - (h.xy - 0.5) * 0.6;
    acc += w * step(0.6, h.z) * exp(-dot(d, d) / 0.0025) * (0.5 + h.z);
  }
  return acc;
}
void main() {
  vec2 p = centered(vUv, uAspect);
  float n = zoomNoise(p, uLz, 18.0);
  float n2 = zoomNoise(p * 1.7 + 3.3, uLz + 0.5, 30.0);
  fragColor = vec4(n, n2, specks(p, uLz), 1.0);
}`;

const INFLATION = `
#include <noise>
#include <color>
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uField;
uniform vec2 uRes; uniform float uAspect, uLz, uHeat, uGrid, uBlur;
void main() {
  vec2 p = centered(vUv, uAspect);
  // Radial zoom blur: space streaming outward from the centre.
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 14; i++) {
    float k = float(i) / 13.0;
    float sc = 1.0 - uBlur * k;
    float w = 1.0 - 0.6 * k;
    acc += texture(uField, 0.5 + (vUv - 0.5) * sc).rgb * w;
    wsum += w;
  }
  vec3 f3 = acc / wsum;
  float f = smoothstep(0.36, 0.7, f3.x);
  float seeds = pow(smoothstep(0.55, 0.78, f3.y), 3.0);
  vec3 col = fireRamp(0.28 + 0.5 * f * uHeat + 0.3 * seeds) * (0.22 + 1.2 * f * f + 2.2 * seeds) * (0.55 + 0.8 * uHeat);
  col += vec3(1.0, 0.92, 0.8) * f3.z * 5.0;
  // A faint, bowed lattice: the fabric of space itself being stretched.
  float r = length(p);
  vec2 bp = p * (1.0 + 0.35 * r * r);
  float gs = exp2(fract(uLz)) * 5.0;
  vec2 g = abs(fract(bp * gs + 0.5) - 0.5) / gs;
  float px = 1.0 / uRes.y;
  float line = exp(-min(g.x, g.y) / (px * 0.9)) * (1.0 - fract(uLz));
  vec2 g2 = abs(fract(bp * gs * 0.5 + 0.5) - 0.5) / (gs * 0.5);
  float line2 = exp(-min(g2.x, g2.y) / (px * 0.9));
  col += vec3(0.55, 0.7, 1.0) * (line + line2) * 0.12 * uGrid * smoothstep(0.05, 0.4, r);
  fragColor = vec4(col, 1.0);
}`;

function inflation(): Shot<{ half: RenderTarget }> {
  return {
    ...span('inflation', { dIn: 1.2, dOut: 1.0 }),
    setup: (e) => ({ half: scratch(e, 0.5) }),
    render(c, s) {
      const t = bt(c, 'inflation');
      // Exponential expansion, easing out as inflation ends.
      const lz = 4.2 * (1 - Math.exp(-Math.max(0, t + 0.8) * 0.55)) + 0.25 * t;
      const speed = 4.2 * 0.55 * Math.exp(-Math.max(0, t + 0.8) * 0.55) + 0.25;
      s.half.bind();
      c.fullscreen(c.e.program(INFLATION_FIELD, 'inflation.field'), { uLz: lz });
      c.target.bind();
      c.fullscreen(c.e.program(INFLATION, 'inflation'), {
        uField: s.half,
        uLz: lz,
        uHeat: keys(t, [[-1, 1], [4, 0.8], [7, 0.6]]),
        uGrid: keys(t, [[-0.6, 0], [0.6, 1], [3.5, 0.7], [5.5, 0]]),
        uBlur: Math.min(0.22, speed * 0.09),
      });
    },
  };
}

// ------------------------------------------------------------------ first elements
const FOG = `
#include <noise>
#include <color>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uBright;
void main() {
  vec2 p = centered(vUv, uAspect);
  float n = fbm(vec3(p * 1.6, uGTime * 0.08), 5);
  float n2 = fbm(vec3(p * 4.0 + 7.0, uGTime * 0.15), 4);
  vec3 col = mix(vec3(0.9, 0.28, 0.06), vec3(1.0, 0.62, 0.25), n) * (0.25 + 0.9 * n * n2) * uBright;
  fragColor = vec4(col, 1.0);
}`;

const NUCLEI_ANIMATE = `
uniform float uFocus, uAperture, uFuse;
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  float t = uTime;
  // Brownian jitter.
  vec3 j = vec3(sin(t * (1.3 + x.x * 2.0) + x.y * 40.0), sin(t * (1.1 + x.y * 2.0) + x.z * 50.0), sin(t * (0.9 + x.z * 2.0) + x.x * 30.0));
  vec3 wp = p + j * 0.05;
  // Fusion events: brief bright flashes at pseudo-random times.
  float period = 2.5 + x.w * 3.0;
  float ph = fract(t / period + x.x);
  float flash = exp(-ph * 30.0) * step(0.6, x.y) * uFuse;
  col *= 1.0 + flash * 25.0;
  // Depth of field: blur circle grows away from the focal plane (flux is conserved by the sprite shader).
  vec4 vp = uView * vec4(wp, 1.0);
  float coc = abs(-vp.z - uFocus) * uAperture;
  float s0 = size;
  size = sqrt(size * size + coc * coc);
  col *= (s0 * s0) / (size * size); // a defocused point spreads the same light over a larger disc
  return wp;
}`;

const NUCLEI_SHADE = `
vec4 shade(vec2 q, vec3 col, vec4 x) {
  float d = length(q) / 3.0;
  // Bokeh disc with a slightly brighter rim.
  float disc = smoothstep(1.0, 0.86, d) * (0.75 + 0.35 * smoothstep(0.5, 0.95, d));
  float g = exp(-0.5 * dot(q, q));
  float a = mix(g, disc * 0.35, 0.55);
  return vec4(col * a, a);
}`;

function elements(): Shot<{ nuclei: Sprites; cam: Camera }> {
  return {
    ...span('elements', { dIn: 1.0, dOut: 1.0 }),
    setup(e) {
      const r = rng(36);
      const n = 2600;
      const d = allocSprites(n);
      for (let i = 0; i < n; i++) {
        const z = r.range(-2, 18);
        d.position.set([r.range(-9, 9), r.range(-5, 5), -z], i * 3);
        const proton = r.next() < 0.55;
        const c = proton ? blackbody(2400) : [0.75, 0.85, 1.0];
        const b = r.range(0.4, 1.4) * (proton ? 1.4 : 1.0);
        d.color.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
        d.size[i] = r.range(0.035, 0.06);
        d.extra!.set([r.next(), r.next(), r.next(), r.next()], i * 4);
      }
      return { nuclei: new Sprites(e, d, { animate: NUCLEI_ANIMATE, shade: NUCLEI_SHADE, minPixels: 0.8 }), cam: new Camera({ fov: 55 }) };
    },
    render(c, s) {
      const t = bt(c, 'elements');
      c.fullscreen(c.e.program(FOG, 'fog'), { uBright: 0.35 });
      s.cam.set({ pos: [0.3 * Math.sin(t * 0.2), 0.1, 2 - t * 0.35], target: [0, 0, -8 - t * 0.35] });
      s.nuclei.draw(s.cam, c.t, { uFocus: 5.0, uAperture: 0.06, uFuse: 1.0 }, { blend: 'add', brightness: 1.2 });
    },
  };
}

// ------------------------------------------------------------------ first light (CMB)
const CMB = `
#include <noise>
#include <color>
#include <camera>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uFog, uMap, uRot, uBurst;
vec3 planck(float v) {
  // Planck-style diverging map: deep blue - cyan - pale - orange - red.
  vec3 c0 = vec3(0.02, 0.05, 0.35), c1 = vec3(0.1, 0.45, 0.9), c2 = vec3(1.0, 0.9, 0.62);
  vec3 c3 = vec3(1.0, 0.55, 0.12), c4 = vec3(0.65, 0.05, 0.02);
  v = saturate(v);
  if (v < 0.25) return mix(c0, c1, v / 0.25);
  if (v < 0.5) return mix(c1, c2, (v - 0.25) / 0.25);
  if (v < 0.75) return mix(c2, c3, (v - 0.5) / 0.25);
  return mix(c3, c4, (v - 0.75) / 0.25);
}
void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 col = vec3(0.0);
  vec2 h = raySphere(uCamPos, rd, vec3(0.0), 1.0);
  if (h.y > 0.0) {
    vec3 n = normalize(uCamPos + rd * h.x);
    vec3 q = rotY(uRot) * n;
    float v = 0.5 + 1.1 * (gfbm(q * 9.0, 5) * 0.75 + gnoise(q * 2.2) * 0.3);
    vec3 mapped = planck(v) * 0.55;
    vec3 thermal = fireRamp(0.55 + 0.25 * v) * 0.5;
    col = mix(thermal, mapped, uMap);
    // Soft limb darkening plus a thin luminous rim.
    float limb = saturate((h.y - h.x) / 0.5);
    col *= 0.45 + 0.55 * limb;
    col += vec3(0.25, 0.35, 0.6) * pow(1.0 - limb, 6.0) * 0.25 * uMap;
  }
  // The opaque fireball fog we are emerging from.
  float fogN = fbm(vec3(p * 2.2, uGTime * 0.1), 5);
  float fogN2 = fbm(vec3(p * 6.0 + 3.0, uGTime * 0.2), 4);
  vec3 fog = fireRamp(0.5 + 0.35 * fogN + 0.15 * fogN2) * (0.45 + 0.9 * fogN * fogN2);
  col = mix(col, fog, uFog);
  // Light breaks free: photons streaming outward as the fog turns transparent.
  if (uBurst > 0.0) {
    float a = atan(p.y, p.x);
    float r = length(p);
    float s1 = pow(vnoise(vec2(a * 70.0, r * 1.5 - uGTime * 6.0)), 10.0);
    float s2 = pow(vnoise(vec2(a * 130.0 + 3.0, r * 2.5 - uGTime * 9.0)), 14.0);
    col += vec3(1.0, 0.86, 0.65) * (s1 + 0.8 * s2) * smoothstep(0.03, 0.35, r) * uBurst * 1.4;
    col += vec3(1.0, 0.8, 0.55) * exp(-r * 4.0) * uBurst * 0.35;
  }
  fragColor = vec4(col, 1.0);
}`;

function firstLight(): Shot<{ cam: Camera }> {
  return {
    ...span('cmb', { dIn: 1.0, dOut: 1.2 }),
    setup: () => ({ cam: new Camera({ fov: 40 }) }),
    render(c, s) {
      const t = bt(c, 'cmb');
      const clear = cues.cmbClear - beat('cmb').start;
      const dist = keys(t, [[-1, 1.02], [clear, 1.05], [clear + 2.8, 3.6, 'inOutCubic'], [8.5, 4.6, 'outQuad']]);
      const az = keys(t, [[-1, 0.2], [9, -0.25]]);
      s.cam.set({ pos: [Math.sin(az) * dist, 0.25 * dist * 0.3, Math.cos(az) * dist], target: [0, 0, 0], fov: 40 });
      c.fullscreen(c.e.program(CMB, 'cmb'), {
        ...s.cam.uniforms(),
        uFog: 1 - prog(t, clear - 0.3, clear + 1.6, 'inOutSine'),
        uMap: prog(t, clear + 1.2, clear + 3.2, 'inOutSine'),
        uBurst: prog(t, clear - 0.5, clear + 0.3, 'inOutSine') * (1 - prog(t, clear + 0.8, clear + 2.6, 'inOutSine')),
        uRot: t * 0.05,
      });
    },
  };
}

export function universeShots(): Shot[] {
  return [prologue(), bigBang(), inflation(), elements(), firstLight()];
}
