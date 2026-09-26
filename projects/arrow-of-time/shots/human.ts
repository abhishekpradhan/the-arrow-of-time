// Act V: mammals, the first people, cave art, civilization, the Moon landing, Earth at night, NOW.
import { Camera, Sprites, allocSprites, keys, m4, prog, rng, starSphere, type Mat4, type Shot, type Vec3 } from '@engine';
import { beat, cues, span, timeline } from '../lib';
import { Planet, loadEarth, type EarthMaps } from '@engine';

const latLon = (lat: number, lon: number): Vec3 => {
  const a = (lat * Math.PI) / 180, o = (lon * Math.PI) / 180;
  return [Math.cos(a) * Math.sin(o), Math.sin(a), Math.cos(a) * Math.cos(o)];
};

// ------------------------------------------------------------------ the age of mammals
const MAMMALS = `
#include <noise>
#include <color>
#include <creatures>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uT, uDawn;
void main() {
  vec2 p = centered(vUv, uAspect);
  float px = 1.5 / uRes.y;
  vec2 sun = vec2(-0.45, -0.1 + 0.12 * uDawn);
  // Ash-grey sky warming into a golden dawn.
  float h = p.y + 0.12;
  vec3 ash = mix(vec3(0.16, 0.14, 0.13), vec3(0.06, 0.06, 0.08), smoothstep(0.0, 0.5, h));
  vec3 gold = mix(vec3(1.0, 0.62, 0.3), vec3(0.35, 0.45, 0.65), smoothstep(0.0, 0.5, h));
  vec3 col = mix(ash, gold, uDawn);
  float sd = length(p - sun);
  col += mix(vec3(0.5, 0.35, 0.25), vec3(1.0, 0.75, 0.45), uDawn) * exp(-sd * 6.0) * (0.3 + 0.9 * uDawn);
  col += vec3(1.0, 0.9, 0.7) * smoothstep(0.045, 0.04, sd) * 2.0 * uDawn;
  // God rays through the settling dust.
  float a = atan(p.y - sun.y, p.x - sun.x);
  col += vec3(1.0, 0.8, 0.5) * pow(vnoise(vec2(a * 14.0, 1.0)), 4.0) * exp(-sd * 2.0) * 0.4 * uDawn;
  // Hills with young trees.
  vec3 haze = col * 0.7;
  float hill = -0.14 + 0.04 * fbm(vec2(p.x * 2.5, 2.0), 4);
  vec3 silc = vec3(0.02, 0.018, 0.02);
  col = mix(col, mix(silc, haze, 0.5), 1.0 - smoothstep(-px, px, p.y - hill));
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float x = -0.9 + fi * 0.23 + 0.05 * sin(fi * 7.1);
    float s = 0.05 + 0.03 * fract(fi * 0.77);
    vec2 q = (p - vec2(x, hill - 0.005)) / s;
    float d = sdConifer(q, 1.0) * s;
    col = mix(col, mix(silc, haze, 0.45), 1.0 - smoothstep(-px, px, d));
  }
  // A branch reaching in from the right, with a small mammal watching the sunrise.
  float br = sdBezierTaper(p, vec2(1.0, -0.2), vec2(0.6, -0.12), vec2(0.22, -0.02), 0.028, 0.008);
  br = min(br, sdBezierTaper(p, vec2(0.55, -0.12), vec2(0.5, 0.02), vec2(0.42, 0.1), 0.012, 0.003));
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 c = vec2(0.3 + fi * 0.09, -0.04 - fi * 0.012 + 0.02 * sin(fi * 2.0));
    br = min(br, sdEllipse(rot2(0.6 + fi) * (p - c), vec2(0.025, 0.009)));
  }
  col = mix(col, silc, 1.0 - smoothstep(-px, px, br));
  vec2 q = (p - vec2(0.36, -0.046)) / 0.085;
  q.x = -q.x;
  col = mix(col, silc, 1.0 - smoothstep(-px, px, sdMammal(q, uGTime) * 0.085));
  fragColor = vec4(col, 1.0);
}`;

function mammals(): Shot {
  return {
    ...span('mammals', { dIn: 1.2, dOut: 1.0 }),
    render(c) {
      const t = c.time - beat('mammals').start;
      c.fullscreen(c.e.program(MAMMALS, 'mammals'), { uT: t, uDawn: prog(t, -0.5, 5.5, 'inOutSine') });
    },
  };
}

// ------------------------------------------------------------------ Homo sapiens: fire under the Milky Way
const CAMPFIRE = `
#include <noise>
#include <color>
#include <stars>
#include <creatures>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uT;
void main() {
  vec2 p = centered(vUv, uAspect);
  float px = 1.5 / uRes.y;
  float t = uGTime;
  // Night sky with the Milky Way arching across.
  vec3 col = mix(vec3(0.004, 0.006, 0.014), vec3(0.01, 0.018, 0.04), smoothstep(-0.2, 0.5, p.y));
  vec2 bd = normalize(vec2(1.0, 0.55));
  float across = dot(p - vec2(-0.2, 0.05), vec2(-bd.y, bd.x));
  float along = dot(p, bd);
  float band = exp(-pow(across / 0.13, 2.0));
  float core = exp(-pow((along + 0.55) / 0.5, 2.0));
  float n = fbm(vec2(along * 6.0, across * 14.0), 6);
  float rift = smoothstep(0.45, 0.7, fbm(vec2(along * 9.0 + 3.0, across * 30.0), 5)) * exp(-pow(across / 0.05, 2.0));
  vec3 glow = mix(vec3(0.5, 0.55, 0.75), vec3(1.0, 0.8, 0.6), core) * band * (0.25 + 0.6 * n) * (0.45 + 0.8 * core);
  col += glow * (1.0 - rift * 0.85) * 0.55;
  col += starField(p, 1.0 / uRes.y, t, 5.0, 1.0 + 1.5 * band);
  // Ground and an acacia.
  float ground = -0.2 + 0.015 * gnoise(vec2(p.x * 3.0, 1.0));
  vec3 silc = vec3(0.006, 0.005, 0.006);
  col = mix(col, silc, 1.0 - smoothstep(-px, px, p.y - ground));
  vec2 aq = (p - vec2(0.62, ground)) / 0.3;
  col = mix(col, silc, 1.0 - smoothstep(-px, px, sdAcacia(aq, 1.0) * 0.3));
  // The fire.
  vec2 fp = vec2(-0.2, ground + 0.005);
  float flick = 0.8 + 0.2 * sin(t * 13.0) * sin(t * 7.7) + 0.1 * vnoise(vec2(t * 6.0, 1.0));
  // Warm light on the ground around the fire.
  float lg = exp(-length((p - fp) * vec2(1.0, 3.5)) * 5.0) * step(p.y, ground + 0.002);
  col += vec3(1.0, 0.45, 0.15) * lg * 0.35 * flick;
  // People around the fire (rim-lit on the fire side).
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float dir = i == 1 ? -1.0 : 1.0;
    vec2 base = fp + vec2(i == 0 ? -0.2 : i == 1 ? 0.17 : -0.32, 0.0);
    float s = i == 2 ? 0.11 : 0.13;
    vec2 q = (p - base) / s;
    q.x *= dir;
    float d = sdSitter(q, t, fi) * s;
    float inside = 1.0 - smoothstep(-px, px, d);
    float rim = exp(-abs(d) / 0.003) * step(0.0, -((p.x - fp.x) * dir)) * 0.0;
    col = mix(col, silc + vec3(0.25, 0.08, 0.02) * flick * 0.15, inside);
    col += vec3(1.0, 0.5, 0.2) * rim;
  }
  // One stands a little apart, looking up.
  {
    float s = 0.2;
    vec2 q = (p - vec2(0.2, ground)) / s;
    float d = sdPerson(q, 1.0, t) * s;
    col = mix(col, silc, 1.0 - smoothstep(-px, px, d));
  }
  // Flames.
  vec2 fq = (p - fp) / 0.06;
  float fn = fbm(vec2(fq.x * 3.0, fq.y * 2.0 - t * 4.0), 4);
  float shape = smoothstep(0.9, 0.2, length(vec2(fq.x * (1.4 + fq.y * 0.8), fq.y * 0.55 - 0.35))) * step(0.0, fq.y);
  float fl = saturate(shape * (fn * 1.6 - 0.2) * flick);
  col += fireRamp(0.3 + 0.7 * fl) * fl * 3.0;
  col += vec3(1.0, 0.5, 0.18) * exp(-length(p - fp - vec2(0.0, 0.02)) / 0.05) * 0.35 * flick;
  // Rising embers.
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    vec3 h = hash31(fi * 13.1);
    float life = fract(t * (0.25 + 0.2 * h.x) + h.y);
    vec2 ep = fp + vec2((h.z - 0.5) * 0.06 + 0.04 * sin(life * 6.0 + fi), life * 0.35);
    col += vec3(1.0, 0.55, 0.2) * exp(-length(p - ep) / 0.0025) * (1.0 - life) * 1.5;
  }
  fragColor = vec4(col, 1.0);
}`;

function humans(): Shot {
  return {
    ...span('humans', { dIn: 1.0, dOut: 1.0 }),
    render(c) {
      c.fullscreen(c.e.program(CAMPFIRE, 'campfire'), { uT: c.time - beat('humans').start });
    },
  };
}

// ------------------------------------------------------------------ cave hand stencils
const CAVE = `
#include <noise>
#include <color>
#include <sdf>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uT;
uniform vec3 uTorch;
float sdHand(vec2 p) {
  float palm = sdRoundBox(p - vec2(0.0, 0.0), vec2(0.18, 0.2), 0.08);
  float d = palm;
  d = min(d, sdTaper(p, vec2(-0.13, 0.15), vec2(-0.2, 0.45), 0.045, 0.035));
  d = min(d, sdTaper(p, vec2(-0.045, 0.18), vec2(-0.06, 0.55), 0.048, 0.038));
  d = min(d, sdTaper(p, vec2(0.045, 0.18), vec2(0.06, 0.52), 0.046, 0.036));
  d = min(d, sdTaper(p, vec2(0.13, 0.14), vec2(0.2, 0.4), 0.042, 0.032));
  d = min(d, sdTaper(p, vec2(0.16, -0.05), vec2(0.36, 0.12), 0.05, 0.038));
  d = min(d, sdTaper(p, vec2(0.0, -0.15), vec2(0.0, -0.45), 0.14, 0.12));
  return d;
}
float wallH(vec2 p) {
  return fbm(vec3(p * 3.0, 1.0), 5) * 0.7 + fbm(vec3(p * 14.0, 2.0), 4) * 0.25;
}
void main() {
  vec2 p = centered(vUv, uAspect);
  // Bumpy rock wall, lit by a moving, flickering torch.
  float e = 0.003;
  float h = wallH(p);
  vec3 n = normalize(vec3(-(wallH(p + vec2(e, 0.0)) - h) / e * 0.06, -(wallH(p + vec2(0.0, e)) - h) / e * 0.06, 1.0));
  vec3 pos = vec3(p, h * 0.05);
  vec3 L = uTorch - pos;
  float dist = length(L);
  float flick = 0.85 + 0.15 * sin(uGTime * 11.0) * sin(uGTime * 5.3 + 1.0);
  float diff = max(dot(n, L / dist), 0.0) / (0.25 + dist * dist * 2.5) * flick;
  vec3 rock = mix(vec3(0.42, 0.3, 0.2), vec3(0.62, 0.48, 0.34), smoothstep(0.3, 0.7, h));
  // Ochre stencils: pigment sprayed around each hand, leaving the hand shape bare.
  float pig = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec3 hh = hash31(fi * 3.7 + 2.0);
    vec2 c = vec2(-0.72 + fi * 0.36 + (hh.x - 0.5) * 0.12, (hh.y - 0.5) * 0.3 + 0.03);
    float s = 0.1 + 0.04 * hh.z;
    vec2 q = rot2((hh.x - 0.5) * 0.9) * (p - c) / s;
    if (i == 3) q.x = -q.x;
    float d = sdHand(q) * s;
    float spray = smoothstep(0.075, 0.0, d) * step(0.0, d);
    float speckle = smoothstep(0.35, 0.6, vnoise(p * 900.0 + fi));
    pig = max(pig, spray * (0.55 + 0.45 * speckle) * (0.7 + 0.3 * hh.z));
  }
  // A scatter of ochre dots.
  vec2 g = p * 22.0;
  vec3 hd = hash32(floor(g) + 5.0);
  float dots = step(0.93, hd.z) * smoothstep(0.18, 0.1, length(fract(g) - hd.xy));
  pig = max(pig, dots * 0.8 * step(abs(p.y), 0.25));
  vec3 ochre = vec3(0.55, 0.12, 0.05);
  vec3 alb = mix(rock, ochre, pig * 0.85);
  vec3 col = alb * diff * vec3(1.0, 0.6, 0.32) * 3.2;
  col += alb * vec3(0.02, 0.025, 0.04);
  fragColor = vec4(col, 1.0);
}`;

function caves(): Shot {
  return {
    ...span('caves', { dIn: 1.0, dOut: 0.8 }),
    render(c) {
      const t = c.time - beat('caves').start;
      c.fullscreen(c.e.program(CAVE, 'cave'), {
        uT: t,
        uTorch: [keys(t, [[-1, -0.9], [7, 0.75, 'inOutSine']]), -0.1 + 0.03 * Math.sin(t * 1.3), 0.32],
      });
    },
  };
}

// ------------------------------------------------------------------ civilization
const CIV = `
#include <noise>
#include <color>
#include <stars>
#include <structures>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uT;
uniform float uS[10];        // stage visibility 0..1 (fades in on its montage beat)
uniform float uPhase;        // day/night phase (radians)
uniform float uPlane, uRocket;
float sil(inout vec3 col, float d, float px, vec3 c) {
  float a = 1.0 - smoothstep(-px, px, d);
  col = mix(col, c, a);
  return a;
}
// A structure that rises out of the ground as it appears and sinks when replaced.
float rise(float appear, float vanish) { return saturate(appear) * (1.0 - saturate(vanish)); }
void main() {
  vec2 p = centered(vUv, uAspect);
  float px = 1.5 / uRes.y;
  float horizon = -0.1;
  float sunEl = sin(uPhase) * 0.34;
  vec2 sun = vec2(-0.9 + mod(uPhase / TAU, 1.0) * 1.8, horizon + sunEl);
  float day = smoothstep(-0.08, 0.14, sunEl);
  float dusk = exp(-pow(sunEl / 0.1, 2.0));
  // Sky.
  float h = p.y - horizon;
  vec3 dayC = mix(vec3(0.62, 0.72, 0.85), vec3(0.18, 0.35, 0.62), smoothstep(0.0, 0.45, h));
  vec3 duskC = mix(vec3(1.0, 0.5, 0.22), vec3(0.3, 0.2, 0.35), smoothstep(0.0, 0.4, h));
  vec3 nightC = mix(vec3(0.03, 0.04, 0.08), vec3(0.005, 0.008, 0.02), smoothstep(0.0, 0.4, h));
  vec3 col = mix(nightC, dayC, day);
  col = mix(col, duskC, dusk * 0.8);
  col += starField(p, 1.0 / uRes.y, uGTime, 3.0, 0.8) * (1.0 - day);
  float sd = length(p - sun);
  col += vec3(1.0, 0.8, 0.5) * (exp(-sd * 8.0) * 0.6 + smoothstep(0.03, 0.026, sd) * 3.0) * step(horizon, p.y) * saturate(sunEl * 8.0 + 0.8);
  vec3 skyAtH = mix(mix(nightC, dayC, day), duskC, dusk * 0.8);
  vec3 far = mix(vec3(0.02, 0.02, 0.03), skyAtH * 0.8, 0.55);
  vec3 mid = mix(vec3(0.015, 0.015, 0.02), skyAtH * 0.7, 0.3);
  vec3 near = vec3(0.012, 0.011, 0.012);
  float night = 1.0 - day;
  // Far: the pyramids, which outlast everything.
  float pyr = uS[3];
  if (pyr > 0.0) {
    float k = 0.2 + 0.8 * pyr;
    float d = sdPyramid((p - vec2(-0.52, horizon)) / 0.16, 1.0, 0.72 * k) * 0.16;
    d = min(d, sdPyramid((p - vec2(-0.3, horizon)) / 0.13, 1.0, 0.72 * k) * 0.13);
    d = min(d, sdPyramid((p - vec2(-0.14, horizon)) / 0.07, 1.0, 0.72 * k) * 0.07);
    sil(col, d, px, mix(skyAtH, far, pyr));
  }
  // Rolling land.
  float ground = horizon + 0.01 * gnoise(vec2(p.x * 3.0, 4.0)) + 0.07 * exp(-pow((p.x - 0.62) / 0.12, 2.0));
  sil(col, p.y - ground, px, mid);
  // Mid-ground eras.
  float huts = rise(uS[0] * 3.0, uS[2] * 2.0);
  if (huts > 0.0) {
    for (int i = 0; i < 5; i++) {
      float x = 0.28 + float(i) * 0.09;
      float s = 0.06 * huts;
      sil(col, sdHut((p - vec2(x, ground - 0.002)) / max(s, 1e-3)) * s, px, mid);
    }
  }
  float city = rise(uS[1] * 3.0, uS[5] * 2.0);
  if (city > 0.0) {
    sil(col, sdOldCity((p - vec2(0.12, ground - 0.002)) / (0.11 * city), 3.0) * 0.11 * city, px, mid);
    sil(col, sdZiggurat((p - vec2(0.46, ground - 0.002)) / (0.18 * city)) * 0.18 * city, px, mid);
  }
  float obel = rise(uS[2] * 3.0, uS[6] * 2.0);
  if (obel > 0.0) sil(col, sdObelisk((p - vec2(-0.04, ground - 0.002)) / (0.14 * obel)) * 0.14 * obel, px, mid);
  float temple = uS[4];
  if (temple > 0.0) sil(col, sdTemple((p - vec2(0.62, ground - 0.002)) / (0.13 * temple)) * 0.13 * temple, px, mid);
  float medieval = rise(uS[5] * 3.0, uS[9] * 2.0);
  if (medieval > 0.0) {
    sil(col, sdCathedral((p - vec2(0.2, ground - 0.002)) / (0.12 * medieval)) * 0.12 * medieval, px, mid);
    sil(col, sdWindmill((p - vec2(-0.78, ground - 0.002)) / (0.11 * medieval), uGTime) * 0.11 * medieval, px, mid);
  }
  float industry = rise(uS[6] * 3.0, uS[9] * 2.5);
  if (industry > 0.0) {
    float s = 0.13 * industry;
    vec2 q = (p - vec2(0.33, ground - 0.002)) / s;
    sil(col, sdFactory(q) * s, px, mid);
    // Smoke from the stacks.
    vec2 sp = p - vec2(0.33 - 0.5 * s, ground + 1.4 * s);
    float plume = fbm(vec3(sp * 9.0 - vec2(uGTime * 0.3, uGTime * 0.5), uGTime * 0.2), 4);
    float pm = smoothstep(0.03 + max(sp.y, 0.0) * 0.8, 0.0, abs(sp.x + sp.y * 0.8)) * step(0.0, sp.y) * industry;
    col = mix(col, mix(vec3(0.25, 0.23, 0.22), vec3(0.05), night), saturate(pm * plume * 1.3) * 0.7);
  }
  float towers = uS[8];
  if (towers > 0.0) {
    for (int i = 0; i < 2; i++) {
      float s = 0.1 * towers;
      vec2 base = vec2(-0.72 + float(i) * 0.12, ground - 0.002);
      sil(col, sdCoolingTower((p - base) / s) * s, px, mid);
      vec2 sp = p - base - vec2(0.0, s);
      float steam = fbm(vec3(sp * 10.0 - vec2(0.0, uGTime * 0.4), uGTime * 0.3 + float(i)), 4);
      float sm = smoothstep(0.035 + max(sp.y, 0.0) * 0.4, 0.0, abs(sp.x - sp.y * 0.3)) * step(0.0, sp.y);
      col = mix(col, mix(vec3(0.8), vec3(0.15), night), saturate(sm * steam * 1.5) * 0.6 * towers);
    }
  }
  float modern = uS[9];
  if (modern > 0.0) {
    float win;
    float s = 0.15 * modern;
    float d = sdSkyline((p - vec2(0.45, ground - 0.002)) / s, 7.0, win) * s;
    float a = sil(col, d, px, near);
    col += vec3(1.0, 0.8, 0.45) * win * a * night * 1.4;
  }
  // Night lights spreading along the ground as civilization grows.
  float lightsAmt = saturate(uS[5] * 0.3 + uS[6] * 0.4 + uS[9] * 0.6) * night;
  vec2 g = vec2(p.x * 90.0, (p.y - ground) * 400.0);
  vec3 hl = hash32(floor(g));
  float bulbs = step(0.9 - 0.15 * lightsAmt, hl.z) * exp(-dot(fract(g) - hl.xy, fract(g) - hl.xy) / 0.02) * smoothstep(0.0, -0.01, p.y - ground) * smoothstep(-0.05, -0.005, p.y - ground);
  col += vec3(1.0, 0.75, 0.4) * bulbs * lightsAmt * 1.5;
  // Foreground fields (early farming) fading into roads later.
  float fg = -0.25 + 0.01 * gnoise(vec2(p.x * 2.0, 9.0));
  if (p.y < fg) {
    float z = 1.0 / max(fg + 0.02 - p.y, 0.01);
    float rows = 0.5 + 0.5 * sin(p.x * z * 3.0);
    // Fields give way to roads and street lights as the modern world arrives.
    float farm = uS[0] * (1.0 - 0.85 * uS[6]);
    vec3 field = mix(vec3(0.05, 0.06, 0.03), vec3(0.2, 0.18, 0.08), rows) * (0.3 + 0.7 * day) * farm;
    col = mix(near, near + field * 0.6, 0.8);
    float road = exp(-abs(p.x * z * 0.4 - 0.2) * 6.0) * uS[6];
    col += vec3(1.0, 0.75, 0.4) * road * night * 0.25 * step(0.5, fract(z * 2.0));
  }
  // Flight: a biplane crossing. Space: a rocket climbing on a pillar of fire.
  if (uPlane > 0.0 && uPlane < 1.0) {
    vec2 c = vec2(-1.0 + uPlane * 2.1, 0.18 + 0.03 * sin(uPlane * 6.0));
    sil(col, sdBiplane((p - c) / 0.05) * 0.05, px, vec3(0.03));
  }
  if (uRocket > 0.0) {
    float k = uRocket;
    vec2 base = vec2(0.78, ground + k * k * 0.55);
    float s = 0.05;
    sil(col, sdRocket((p - base) / s) * s, px, vec3(0.05));
    vec2 tp = p - base;
    float trail = exp(-abs(tp.x) / (0.004 + max(-tp.y, 0.0) * 0.05)) * step(tp.y, 0.0) * exp(tp.y * 4.0);
    col += fireRamp(0.8) * trail * 2.5 + vec3(1.0, 0.9, 0.7) * exp(-length(tp) / 0.012) * 4.0;
    col = mix(col, vec3(0.7, 0.68, 0.65) * (0.3 + 0.7 * day), saturate(exp(-abs(tp.x) / (0.01 + max(-tp.y, 0.0) * 0.2)) * step(tp.y, -0.02) * 0.5 * fbm(vec3(tp * 20.0, uGTime), 3)));
  }
  fragColor = vec4(col, 1.0);
}`;

function civilization(): Shot {
  const b = beat('civilization') as (typeof timeline.beats)[number] & { montage: { t: number }[] };
  const times = b.montage.map((m) => m.t);
  return {
    ...span('civilization', { dIn: 0.8, dOut: 0.8 }),
    render(c) {
      const t = c.time - b.start;
      const stages = times.map((t0) => prog(c.time, t0 - 0.15, t0 + 0.45, 'outCubic'));
      c.fullscreen(c.e.program(CIV, 'civilization'), {
        uT: t,
        uS: stages,
        uPhase: Math.PI * 2 * (0.12 + 0.08 * t + 0.012 * t * t),
        uPlane: prog(c.time, times[7] - 0.1, times[7] + 1.6),
        uRocket: prog(c.time, times[9], b.end + 0.4, 'inQuad'),
      });
    },
  };
}

// ------------------------------------------------------------------ the Moon landing: Earthrise
const LUNAR = `
#include <noise>
#include <color>
#include <sdf>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uT;
void main() {
  vec2 p = centered(vUv, uAspect);
  float px = 1.5 / uRes.y;
  float horizon = -0.08 - 0.05 * p.x * p.x + 0.006 * gnoise(vec2(p.x * 8.0, 1.0));
  if (p.y > horizon + px) {
    // Lander and flag on the horizon; otherwise leave the sky (and Earth) visible.
    vec2 lp = (p - vec2(-0.5, horizon - 0.003)) / 1.8;
    float d = sdBox(lp - vec2(0.0, 0.025), vec2(0.022, 0.014));
    d = min(d, sdTriangle(lp, vec2(-0.02, 0.039), vec2(0.02, 0.039), vec2(0.0, 0.052)));
    d = min(d, sdSegment(lp, vec2(-0.018, 0.012), vec2(-0.034, 0.0)) - 0.002);
    d = min(d, sdSegment(lp, vec2(0.018, 0.012), vec2(0.034, 0.0)) - 0.002);
    d *= 1.8;
    vec2 fp = p - vec2(-0.36, horizon - 0.003);
    d = min(d, sdSegment(fp, vec2(0.0), vec2(0.0, 0.08)) - 0.0015);
    d = min(d, sdBox(fp - vec2(0.02, 0.07), vec2(0.02, 0.011)));
    float a = 1.0 - smoothstep(-px, px, d);
    fragColor = vec4(vec3(0.01) * a, a);
    return;
  }
  // Regolith in perspective, lit by a low sun from the left.
  float depth = 1.0 / max(horizon + 0.02 - p.y, 0.005);
  vec2 g = vec2(p.x * depth, depth);
  vec2 w = worley(g * 0.6);
  vec2 w2 = worley(g * 2.1 + 3.0);
  float crater = smoothstep(0.45, 0.25, w.x) * 0.5 + smoothstep(0.4, 0.2, w2.x) * 0.3;
  float rim = smoothstep(0.02, 0.0, abs(w.x - 0.4)) * 0.6;
  float grain = fbm(g * 8.0, 4);
  float lit = 0.55 + 0.35 * grain - 0.4 * crater + 0.5 * rim;
  vec3 col = vec3(0.42, 0.41, 0.4) * lit * (0.35 + 0.65 * smoothstep(0.0, 0.25, horizon - p.y + 0.05));
  // Boot prints marching away from the camera.
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    float y = -0.36 + fi * 0.03;
    float x = 0.25 - fi * 0.04 + (mod(fi, 2.0) < 1.0 ? 0.012 : -0.012) * (1.0 - fi * 0.08);
    float s = 0.018 * (1.0 - fi * 0.08);
    vec2 q = (p - vec2(x, y)) / vec2(s, s * 0.45);
    float print = sdRoundBox(q, vec2(0.5, 1.1), 0.45) * s;
    float tread = step(0.5, fract(q.y * 3.0));
    col *= 1.0 - (1.0 - smoothstep(-px, px, print)) * (0.45 + 0.15 * tread);
  }
  fragColor = vec4(col, 1.0);
}`;

function moonLanding(): Shot<{ planet: Planet; cam: Camera; sky: Sprites }> {
  return {
    ...span('moonlanding', { dIn: 1.0, dOut: 1.0 }),
    async setup(e) {
      const maps = await loadEarth(e);
      return { planet: new Planet(e, maps), cam: new Camera({ fov: 30 }), sky: new Sprites(e, starSphere(rng(196), { count: 6000, brightness: 0.18 })) };
    },
    render(c, s) {
      const t = c.time - beat('moonlanding').start;
      s.cam.set({ pos: [0, 0, 0], target: [0, 0.02, -1] });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      // Earth, half lit, rising slowly above the lunar horizon.
      const y = keys(t, [[-1, -0.03], [7, 0.1, 'outSine']]);
      s.planet.draw(c, s.cam, {
        center: [0.08, y, -1], radius: 0.06, yaw: -0.5, spin: 0, tilt: 0.3, sunDir: [-1, 0.1, 0.25], earth: 1,
        clouds: 0.5, cloudT: 0.8, atmo: 1.0, atmoColor: [0.3, 0.55, 1.0], glint: 0.8,
      });
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE_MINUS_SRC_ALPHA);
      c.fullscreen(c.e.program(LUNAR, 'lunar'), { uT: t });
      c.gl.disable(c.gl.BLEND);
    },
  };
}

// ------------------------------------------------------------------ Earth at night
const CITIES: [number, number][] = [
  [51.5, -0.1], [40.7, -74.0], [48.9, 2.35], [25.2, 55.3], [19.1, 72.9], [35.7, 139.7], [39.9, 116.4], [55.8, 37.6],
  [30.0, 31.2], [6.5, 3.4], [-26.2, 28.0], [-23.5, -46.6], [34.0, -118.2], [1.35, 103.8], [41.0, 28.9], [28.6, 77.2],
  [31.2, 121.5], [40.4, -3.7], [52.5, 13.4], [-1.3, 36.8], [22.3, 114.2], [19.4, -99.1], [41.9, -87.6], [13.7, 100.5],
];
const ROUTES: [number, number][] = [
  [0, 1], [0, 3], [3, 4], [3, 5], [2, 7], [0, 8], [8, 9], [9, 10], [2, 11], [1, 12], [13, 5], [14, 3], [15, 3], [16, 5],
  [17, 11], [18, 7], [19, 3], [20, 13], [21, 12], [22, 1], [23, 4], [0, 16], [2, 15], [7, 6], [14, 18], [8, 19],
];

function arcData() {
  const per = 220;
  const d = allocSprites(ROUTES.length * per);
  let i = 0;
  const r = rng(202);
  ROUTES.forEach(([a, b], k) => {
    const A = latLon(...CITIES[a]), B = latLon(...CITIES[b]);
    const dot = Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
    const om = Math.acos(dot);
    const delay = r.range(0, 3.5);
    for (let j = 0; j < per; j++) {
      const s = j / (per - 1);
      const sa = Math.sin((1 - s) * om) / Math.sin(om), sb = Math.sin(s * om) / Math.sin(om);
      const alt = 1.004 + 0.05 * om * Math.sin(Math.PI * s);
      d.position.set([(A[0] * sa + B[0] * sb) * alt, (A[1] * sa + B[1] * sb) * alt, (A[2] * sa + B[2] * sb) * alt], i * 3);
      d.color.set([0.55, 0.75, 1.0], i * 3);
      d.size[i] = 0.0026;
      d.extra!.set([s, delay, k, 0], i * 4);
      i++;
    }
  });
  return d;
}

function nightEarth(): Shot<{ planet: Planet; cam: Camera; sky: Sprites; arcs: Sprites }> {
  return {
    ...span('nightearth', { dIn: 1.0, dOut: 0 }),
    async setup(e) {
      const maps = await loadEarth(e);
      return {
        planet: new Planet(e, maps),
        cam: new Camera({ fov: 34 }),
        sky: new Sprites(e, starSphere(rng(203), { count: 8000, brightness: 0.3 })),
        arcs: new Sprites(e, arcData(), {
          animate: `
            uniform mat4 uRot; uniform float uReveal;
            vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
              float head = (uReveal - x.y) * 0.8;
              float vis = smoothstep(x.x - 0.05, x.x, head);
              col *= vis * (0.35 + 1.2 * exp(-abs(head - x.x) * 12.0));
              return (uRot * vec4(p, 1.0)).xyz;
            }`,
        }),
      };
    },
    render(c, s) {
      const t = c.time - beat('nightearth').start;
      const yaw = (-30 * Math.PI) / 180 - t * 0.012;
      s.cam.set({ pos: [0.2, 0.9, keys(t, [[-1, 2.9], [7, 2.55, 'inOutSine']])], target: [0.05, 0.38, 0] });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      const tilt = 0.0;
      const rot: Mat4 = m4.mul(m4.rotateZ(tilt), m4.rotateY(yaw));
      c.gl.enable(c.gl.DEPTH_TEST);
      c.gl.clear(c.gl.DEPTH_BUFFER_BIT);
      s.planet.draw(c, s.cam, {
        center: [0, 0, 0], radius: 1, yaw, spin: 0, tilt, sunDir: [0.85, 0.15, -0.5], earth: 1, city: 1.2,
        clouds: 0.35, cloudT: 0.5, atmo: 0.9, atmoColor: [0.3, 0.55, 1.0], depthWrite: true,
      });
      s.arcs.draw(s.cam, c.time, { uRot: rot, uReveal: t + 0.5 }, { blend: 'add', depthTest: true });
    },
  };
}

// ------------------------------------------------------------------ NOW: the pale blue dot
const BEAM = `
#include <noise>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uAmt;
void main() {
  vec2 p = centered(vUv, uAspect);
  // Scattered sunlight in the camera optics: soft diagonal bands with a faint prismatic edge.
  vec2 d = normalize(vec2(0.35, 1.0));
  float x = dot(p - vec2(0.12, 0.0), vec2(d.y, -d.x));
  float band = exp(-pow(x / 0.09, 2.0)) * 0.5 + exp(-pow((x + 0.24) / 0.05, 2.0)) * 0.22 + exp(-pow((x - 0.3) / 0.06, 2.0)) * 0.15;
  vec3 tint = vec3(0.95 + 0.12 * sin(x * 30.0), 0.82 + 0.08 * sin(x * 30.0 + 2.0), 0.7 + 0.1 * sin(x * 30.0 + 4.0));
  float n = 0.85 + 0.3 * fbm(vec2(dot(p, d) * 3.0, x * 20.0), 3);
  fragColor = vec4(tint * band * n * uAmt * 0.12, 1.0);
}`;

function now(): Shot<{ planet: Planet; cam: Camera; sky: Sprites; dot: Sprites }> {
  return {
    ...span('now', { dIn: 0, dOut: 1.2 }),
    async setup(e) {
      const maps = await loadEarth(e);
      const d = allocSprites(1);
      d.position.set([0, 0, 0]);
      d.color.set([0.35, 0.55, 1.0]);
      d.size[0] = 1;
      return {
        planet: new Planet(e, maps),
        cam: new Camera({ fov: 32, far: 1e7 }),
        sky: new Sprites(e, starSphere(rng(208), { count: 7000, brightness: 0.22 })),
        dot: new Sprites(e, d, { minPixels: 0.9 }),
      };
    },
    render(c, s) {
      const t = c.time - cues.now;
      // A slow pull-back: Earth shrinks to a single point of light.
      const dist = Math.exp(keys(t, [[0, Math.log(9)], [3.5, Math.log(260), 'inOutCubic'], [8.6, Math.log(1400), 'outSine']]));
      s.cam.set({ pos: [0.0, 0.0, dist], target: [0.0, 0.0, 0] });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE);
      c.fullscreen(c.e.program(BEAM, 'beam'), { uAmt: prog(t, 0.5, 4.5, 'inOutSine') });
      c.gl.disable(c.gl.BLEND);
      const pxR = (1 / dist) / Math.tan((32 * Math.PI) / 360) * (c.height / 2);
      if (pxR > 1.2) {
        s.planet.draw(c, s.cam, {
          center: [0, 0, 0], radius: 1, yaw: 0.35, spin: 0, tilt: 0.25, sunDir: [-0.6, 0.25, 0.75], earth: 1,
          clouds: 0.45, cloudT: 1.2, atmo: 0.9, atmoColor: [0.3, 0.55, 1.0],
        });
      }
      // Point-source Earth once it is smaller than a couple of pixels (flux-conserving handover).
      const k = 1 - Math.min(1, Math.max(0, (pxR - 1.2) / 1.5));
      if (k > 0) s.dot.draw(s.cam, c.time, {}, { brightness: 2.4 * k, sizeScale: 1 });
    },
  };
}

export function humanShots(): Shot[] {
  return [mammals(), humans(), caves(), civilization(), moonLanding(), nightEarth(), now()];
}
