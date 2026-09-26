// Act IV: the first life, oxygen, snowball Earth, the Cambrian seas, onto land, dinosaurs, the asteroid.
import { Camera, Sprites, allocSprites, blackbody, keys, prog, rng, starSphere, type RenderTarget, type Shot, type Vec3 } from '@engine';
import { beat, cues, scratch, span } from '../lib';
import { Planet, loadEarth, type EarthMaps } from '../planet';

// ------------------------------------------------------------------ hydrothermal vent
const VENT = `
#include <noise>
#include <color>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uT;
float chimneyW(float y) { return mix(0.075, 0.03, saturate((y + 0.5) / 0.62)); }
void main() {
  vec2 p = centered(vUv, uAspect);
  float px = 1.0 / uRes.y;
  vec3 col = mix(vec3(0.001, 0.01, 0.02), vec3(0.01, 0.055, 0.09), smoothstep(-0.5, 0.5, p.y));
  // Distant chimney, lost in the murk.
  float cx2 = 0.42 + 0.01 * gnoise(vec2(p.y * 9.0, 2.0));
  float far = step(abs(p.x - cx2), mix(0.04, 0.018, saturate((p.y + 0.5) / 0.45))) * step(p.y, -0.05);
  col = mix(col, vec3(0.005, 0.02, 0.035), far * 0.8);
  // Main chimney: rough column.
  float top = 0.12;
  float cx = -0.22 + 0.015 * gnoise(vec2(p.y * 7.0, 1.0)) + 0.008 * gnoise(vec2(p.y * 25.0, 4.0));
  float dx = abs(p.x - cx) - chimneyW(p.y) * (1.0 + 0.25 * gnoise(vec2(p.y * 14.0, 3.0)));
  float body = (1.0 - smoothstep(-px, px, dx)) * (1.0 - smoothstep(top - px, top + px, p.y));
  float glowCracks = pow(vnoise(vec2(p.x * 40.0, p.y * 12.0 - uT * 0.3)), 6.0) * smoothstep(0.0, -0.4, p.y);
  vec3 rock = vec3(0.014, 0.012, 0.011) + fireRamp(0.45) * glowCracks * 1.4 + vec3(0.02, 0.04, 0.05) * smoothstep(0.0, 0.04, dx + 0.03);
  col = mix(col, rock, body);
  // Black smoke billowing from the top, underlit orange near the mouth.
  vec2 sp = vec2(p.x - cx, p.y - top);
  float h = max(sp.y, 0.0);
  float width = 0.03 + h * 0.55;
  vec3 sq = vec3(sp.x * 5.0, (sp.y - uT * 0.09) * 5.0, uT * 0.25);
  float n = fbm(sq + fbm(sq * 1.7, 3) * 1.2, 5);
  float plume = smoothstep(width, width * 0.2, abs(sp.x + 0.03 * sin(h * 6.0 + uT * 0.6))) * smoothstep(-0.01, 0.02, sp.y);
  float dens = saturate(plume * (0.3 + 1.2 * n) * exp(-h * 1.2));
  vec3 smoke = mix(vec3(0.02, 0.018, 0.016), fireRamp(0.5) * 0.35, exp(-h * 18.0));
  col = mix(col, smoke, dens * 0.95);
  // Hot mouth glow.
  float mouth = exp(-length(sp - vec2(0.0, 0.004)) / 0.02);
  col += fireRamp(0.55) * mouth * 1.2;
  // Seafloor mounds.
  float floorY = -0.44 + 0.03 * gnoise(vec2(p.x * 4.0, 0.0)) + 0.01 * gnoise(vec2(p.x * 20.0, 1.0));
  col = mix(col, vec3(0.004, 0.01, 0.014), smoothstep(floorY + px, floorY - px, p.y));
  // Drifting specks: a little bioluminescence.
  vec2 g = p * 60.0 + vec2(0.0, uT * 2.0);
  vec2 cell = floor(g);
  vec3 hh = hash32(cell);
  float spec = step(0.93, hh.z) * exp(-dot(fract(g) - hh.xy, fract(g) - hh.xy) / 0.004);
  col += vec3(0.2, 0.7, 1.0) * spec * 0.5 * (0.5 + 0.5 * sin(uT * 3.0 + hh.x * 20.0));
  fragColor = vec4(col, 1.0);
}`;

function vent(): Shot {
  const b = beat('life');
  return {
    id: 'vent',
    start: b.start - 0.6,
    end: b.start + 4.2,
    fadeIn: 1.2,
    fadeOut: 1.0,
    render(c) {
      c.fullscreen(c.e.program(VENT, 'vent'), { uT: c.time - b.start });
    },
  };
}

// ------------------------------------------------------------------ cells
const CELLS = `
#include <noise>
#include <color>
#include <sdf>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uT, uSplit;
// Membrane glow for a signed distance d (units of screen height), blurred by "blur" for depth of field.
vec3 cellLook(float d, vec2 q, float r, float blur, float seed) {
  float w = 0.004 + blur;
  float mem = exp(-abs(d) / w) * (0.35 + 0.65 * smoothstep(-0.5, 0.5, q.y / r + 0.3));
  float inside = smoothstep(w, -w, d);
  float org = smoothstep(0.62, 0.8, fbm(vec3(q * 18.0 / r, uGTime * 0.2 + seed), 4)) * inside;
  float nuc = exp(-pow(length(q - vec2(0.12, 0.08) * r) / (0.35 * r), 4.0)) * inside;
  vec3 c = vec3(0.3, 0.85, 0.9) * mem * 1.3 + vec3(0.05, 0.25, 0.3) * inside * 0.35;
  c += vec3(0.9, 0.6, 0.35) * org * 0.35 + vec3(0.7, 0.45, 0.8) * nuc * 0.3;
  return c / (1.0 + blur * 60.0);
}
void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 col = mix(vec3(0.0, 0.03, 0.045), vec3(0.01, 0.09, 0.11), smoothstep(-0.6, 0.6, p.y + p.x * 0.2));
  // Caustic shimmer.
  vec2 w = worley(p * 7.0 + vec2(uGTime * 0.1, -uGTime * 0.07));
  col += vec3(0.05, 0.2, 0.22) * pow(max(1.0 - (w.y - w.x), 0.0), 8.0) * 0.08;
  // Background cells (out of focus).
  for (int i = 0; i < 6; i++) {
    vec3 h = hash31(float(i) * 7.3 + 1.0);
    vec2 c = vec2(h.x * 2.2 - 1.1, h.y * 1.1 - 0.55) + 0.03 * vec2(sin(uGTime * 0.3 + h.z * 9.0), cos(uGTime * 0.25 + h.x * 7.0));
    float r = 0.05 + 0.08 * h.z;
    vec2 q = p - c;
    col += cellLook(length(q) - r, q, r, 0.02 + 0.03 * h.z, h.x * 10.0) * 0.7;
  }
  // The dividing cell: two lobes separating, joined by a smooth union that pinches off.
  float R = 0.2;
  float sep = uSplit * R * 1.15;
  vec2 c1 = vec2(-sep, 0.0), c2 = vec2(sep, 0.0);
  float k = mix(0.12, 0.0, smoothstep(0.55, 1.0, uSplit));
  float r1 = R * mix(1.0, 0.8, uSplit);
  float d1 = length(p - c1) - r1, d2 = length(p - c2) - r1;
  float d = k > 0.0 ? smin(d1, d2, k) : min(d1, d2);
  d += 0.004 * gnoise(vec3(p * 12.0, uGTime * 0.5));
  vec2 q = p - (length(p - c1) < length(p - c2) ? c1 : c2);
  col += cellLook(d, q, r1, 0.0, 3.0) * 1.2;
  // Floating specks.
  vec2 g = p * 50.0 + vec2(uGTime * 0.4, uGTime * 0.9);
  vec3 hh = hash32(floor(g));
  col += vec3(0.5, 0.9, 1.0) * step(0.9, hh.z) * exp(-dot(fract(g) - hh.xy, fract(g) - hh.xy) / 0.01) * 0.2;
  fragColor = vec4(col, 1.0);
}`;

function cells(): Shot {
  const b = beat('life');
  return {
    id: 'cells',
    start: b.start + 3.2,
    end: b.end + 0.5,
    fadeIn: 1.0,
    fadeOut: 1.0,
    render(c) {
      c.fullscreen(c.e.program(CELLS, 'cells'), { uT: c.time - b.start, uSplit: prog(c.time, b.start + 4.6, b.end + 0.3, 'inOutSine') });
    },
  };
}

// ------------------------------------------------------------------ Earth from orbit (oxygen, snowball)
interface EarthShot {
  planet: Planet;
  cam: Camera;
  sky: Sprites;
}

function oxygen(): Shot<EarthShot> {
  return {
    ...span('oxygen', { dIn: 1.0, dOut: 0.8 }),
    setup: (e) => ({ planet: new Planet(e), cam: new Camera({ fov: 32 }), sky: new Sprites(e, starSphere(rng(124), { count: 8000, brightness: 0.35 })) }),
    render(c, s) {
      const t = c.time - beat('oxygen').start;
      const k = prog(t, 0.8, 5.2, 'inOutSine');
      s.cam.set({ pos: [0.2, 0.3, keys(t, [[-1, 3.7], [7, 3.3]])], target: [0.25, 0, 0] });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      s.planet.draw(c, s.cam, {
        center: [0, 0, 0], radius: 1, spin: c.time * 0.05, tilt: 0.3, sunDir: [-0.85, 0.35, 0.4], seed: 7,
        ocean: 1, seaLevel: 0.12, glint: 0.4,
        oceanColor: [0.03 + 0.0 * k, 0.12 - 0.02 * k, 0.1 + 0.12 * k],
        bloom: 0.6 + 0.4 * k,
        clouds: 0.45, cloudT: c.time * 0.02,
        atmo: 0.8, atmoColor: [0.95 - 0.7 * k, 0.55 - 0.05 * k, 0.25 + 0.75 * k],
        haze: 0.35 * (1 - k), hazeColor: [0.85, 0.55, 0.28],
      });
    },
  };
}

function snowball(): Shot<EarthShot> {
  return {
    ...span('snowball', { dIn: 0.8, dOut: 1.0 }),
    setup: (e) => ({ planet: new Planet(e), cam: new Camera({ fov: 32 }), sky: new Sprites(e, starSphere(rng(130), { count: 8000, brightness: 0.35 })) }),
    render(c, s) {
      const t = c.time - beat('snowball').start;
      s.cam.set({ pos: [-0.3, 0.2, keys(t, [[-1, 3.4], [5, 3.1]])], target: [-0.2, 0, 0] });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      s.planet.draw(c, s.cam, {
        center: [0, 0, 0], radius: 1, spin: c.time * 0.05, tilt: 0.3, sunDir: [-0.75, 0.3, 0.55], seed: 9,
        ocean: 1, seaLevel: 0.1, oceanColor: [0.02, 0.07, 0.16], glint: 0.4, sunColor: [1.25, 1.22, 1.2],
        ice: keys(c.time, [[cues.snowballFreeze - 0.8, 0.2], [cues.snowballFreeze + 2.6, 1.0, 'inOutCubic']]),
        clouds: 0.25, cloudT: c.time * 0.02,
        atmo: 0.7, atmoColor: [0.4, 0.6, 1.0],
      });
    },
  };
}

// ------------------------------------------------------------------ the Cambrian sea
const CAMBRIAN = `
#include <noise>
#include <color>
#include <aot/creatures>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uT;
vec3 water(float y) {
  vec3 top = vec3(0.18, 0.5, 0.55), mid = vec3(0.025, 0.16, 0.22), deep = vec3(0.005, 0.04, 0.07);
  return y > 0.0 ? mix(mid, top, smoothstep(0.0, 0.55, y)) : mix(deep, mid, smoothstep(-0.5, 0.0, y));
}
// Silhouette over the background, faded into the water by distance (fog).
void layer(inout vec3 col, float d, float px, float fog, float y) {
  float a = 1.0 - smoothstep(-px, px, d);
  vec3 sil = mix(vec3(0.004, 0.02, 0.03), water(y) * 0.9, fog);
  col = mix(col, sil, a);
}
void main() {
  vec2 p = centered(vUv, uAspect);
  float px = 1.5 / uRes.y;
  float t = uGTime;
  vec3 col = water(p.y);
  // Light shafts from the surface.
  float ray = pow(vnoise(vec2((p.x + p.y * 0.4) * 9.0, t * 0.15)), 3.0) + 0.6 * pow(vnoise(vec2((p.x + p.y * 0.4) * 23.0 + 4.0, t * 0.2)), 4.0);
  col += vec3(0.35, 0.7, 0.65) * ray * smoothstep(-0.45, 0.5, p.y) * 0.35;
  // Rippling surface glow at the very top.
  vec2 w = worley(vec2(p.x * 9.0, t * 0.5) + vec2(0.0, p.y * 3.0));
  col += vec3(0.6, 0.9, 0.85) * pow(max(1.0 - (w.y - w.x), 0.0), 10.0) * smoothstep(0.3, 0.5, p.y) * 0.8;
  // Seafloor with caustics.
  float fy = -0.33 + 0.025 * sin(p.x * 2.7 + 1.0) + 0.012 * gnoise(vec2(p.x * 9.0, 0.0));
  if (p.y < fy) {
    vec2 cw = worley(vec2(p.x * 14.0, (p.y - fy) * 40.0) + vec2(t * 0.3, t * 0.2));
    vec2 cw2 = worley(vec2(p.x * 9.0 + 3.0, (p.y - fy) * 25.0) - vec2(t * 0.2, t * 0.25));
    float caus = pow(max(1.0 - (cw.y - cw.x), 0.0), 6.0) * 0.6 + pow(max(1.0 - (cw2.y - cw2.x), 0.0), 8.0) * 0.5;
    vec3 sand = mix(vec3(0.09, 0.14, 0.12), vec3(0.2, 0.28, 0.22), smoothstep(fy - 0.2, fy, p.y));
    col = sand * (0.6 + 0.9 * caus);
    col = mix(col, water(fy), 0.35);
  }
  // Far layer: sponges and crinoids in the haze.
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float x = -0.95 + fi * 0.38 + 0.07 * sin(fi * 5.3);
    float s = 0.07 + 0.03 * fract(fi * 0.71);
    vec2 q = (p - vec2(x, fy + 0.01)) / s;
    float d = mod(fi, 2.0) < 1.0 ? sdCrinoid(q, t, fi) : sdSponge(q);
    layer(col, d * s, px, 0.6, p.y);
  }
  // Trilobites crawling along the bottom.
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float s = 0.07 + 0.02 * fract(fi * 0.37);
    float dir = mod(fi, 2.0) < 1.0 ? 1.0 : -1.0;
    float x = -0.6 + fi * 0.45 + dir * uT * 0.015;
    vec2 q = (p - vec2(x, fy - 0.004)) / s;
    q.x *= dir;
    layer(col, sdTrilobite(q, t + fi) * s, px, 0.25, p.y);
  }
  // Glowing jellyfish drifting up.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 c = vec2(-0.55 + fi * 0.62, 0.05 + 0.08 * fi + uT * 0.01 * (1.0 + fi));
    float s = 0.1 - 0.02 * fi;
    vec2 q = (p - c) / s;
    float d = sdJelly(q, t, fi * 2.0) * s;
    float glow = exp(-max(d, 0.0) / 0.006) * 0.35 + (1.0 - smoothstep(-px, px, d)) * 0.25;
    col += vec3(0.35, 0.8, 1.0) * glow * (0.5 + 0.5 * sin(t * 2.2 + fi * 2.0 + 1.0)) * 0.8;
  }
  // Anomalocaris sweeping through the foreground, right to left.
  {
    float s = 0.21;
    vec2 c = vec2(1.25 - uT * 0.3, 0.02 + 0.03 * sin(uT * 0.9));
    vec2 q = (p - c) / s;
    q.x = -q.x;
    q = rot2(0.05 * sin(uT * 0.9)) * q;
    layer(col, sdAnomalocaris(q, t) * s, px, 0.05, p.y);
  }
  // Big crinoid in the near foreground.
  {
    float s = 0.25;
    vec2 q = (p - vec2(0.72, -0.5)) / s;
    layer(col, sdCrinoid(q, t, 3.0) * s, px, 0.0, p.y);
  }
  // Marine snow.
  vec2 g = p * 70.0 + vec2(t * 0.3, t * 1.2);
  vec3 hh = hash32(floor(g));
  col += vec3(0.6, 0.85, 0.8) * step(0.94, hh.z) * exp(-dot(fract(g) - hh.xy, fract(g) - hh.xy) / 0.008) * 0.12;
  fragColor = vec4(col, 1.0);
}`;

function cambrian(): Shot {
  return {
    ...span('cambrian', { dIn: 1.0, dOut: 1.0 }),
    render(c) {
      c.fullscreen(c.e.program(CAMBRIAN, 'cambrian'), { uT: c.time - beat('cambrian').start });
    },
  };
}

// ------------------------------------------------------------------ onto land
const LAND = `
#include <noise>
#include <color>
#include <aot/creatures>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uT;
vec3 sky(vec2 p, vec2 sun) {
  float h = p.y + 0.1;
  vec3 c = mix(vec3(1.0, 0.55, 0.28), vec3(0.55, 0.3, 0.45), smoothstep(0.0, 0.25, h));
  c = mix(c, vec3(0.08, 0.08, 0.2), smoothstep(0.2, 0.6, h));
  float sd = length(p - sun);
  c += vec3(1.0, 0.7, 0.4) * exp(-sd * 9.0) * 1.2 + vec3(1.0, 0.85, 0.6) * exp(-sd * 40.0) * 2.5;
  c += vec3(1.0, 0.95, 0.85) * smoothstep(0.034, 0.03, sd) * 2.5;
  // Streaky clouds lit from below.
  float cl = fbm(vec2(p.x * 2.0 + uGTime * 0.01, p.y * 12.0), 5);
  c = mix(c, vec3(1.0, 0.6, 0.4) * 0.8 * (0.5 + h * 2.0), smoothstep(0.55, 0.75, cl) * smoothstep(0.02, 0.15, h) * 0.6);
  return c;
}
void main() {
  vec2 p = centered(vUv, uAspect);
  float px = 1.5 / uRes.y;
  vec2 sun = vec2(-0.35, -0.045);
  float horizon = -0.1;
  vec3 col = sky(p, sun);
  // The sea, reflecting the sky with a glittering path under the sun.
  if (p.y < horizon) {
    float dy = horizon - p.y;
    float wave = gnoise(vec2(p.x * 30.0 / (dy + 0.05), dy * 90.0 - uGTime * 1.5)) * 0.5;
    vec2 rp = vec2(p.x + wave * dy * 0.4, horizon + dy * 0.7);
    col = sky(rp, sun) * 0.55;
    float glit = pow(saturate(gnoise(vec2(p.x * 120.0, dy * 400.0 - uGTime * 3.0))), 5.0) * exp(-abs(p.x - sun.x) / (0.02 + dy * 0.4));
    col += vec3(1.0, 0.8, 0.5) * glit * 1.2;
  }
  // Land rising on the right, with a foamy shoreline.
  float land = -0.5 + 0.55 * smoothstep(-0.25, 0.9, p.x) + 0.03 * gnoise(vec2(p.x * 6.0, 1.0)) + 0.01 * gnoise(vec2(p.x * 30.0, 2.0));
  float shore = land + 0.004 * sin(p.x * 50.0 + uGTime * 2.0);
  float foam = exp(-abs(p.y - shore) / 0.004) * step(horizon, 0.0) * smoothstep(0.9, -0.2, p.x);
  col += vec3(1.0, 0.85, 0.7) * foam * 0.5 * (0.6 + 0.4 * sin(uGTime * 1.3 + p.x * 20.0));
  vec3 silhouette = vec3(0.012, 0.01, 0.014);
  col = mix(col, silhouette, 1.0 - smoothstep(-px, px, p.y - land));
  // Early plants on the shore.
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float x = 0.25 + fi * 0.11 + 0.03 * sin(fi * 3.1);
    float base = -0.5 + 0.55 * smoothstep(-0.25, 0.9, x) - 0.005;
    float s = 0.08 + 0.05 * fract(fi * 0.53);
    vec2 q = (p - vec2(x, base)) / s;
    float d = sdFern(q, uGTime, fi, 1.0) * s;
    col = mix(col, silhouette, 1.0 - smoothstep(-px, px, d));
  }
  // Tiktaalik hauling itself onto the shore.
  {
    float s = 0.13;
    float x = 0.3 + uT * 0.01;
    float base = -0.5 + 0.55 * smoothstep(-0.25, 0.9, x) - 0.012;
    vec2 q = rot2(-0.22) * ((p - vec2(x, base)) / s);
    float d = sdTiktaalik(q, uT) * s;
    col = mix(col, silhouette, 1.0 - smoothstep(-px, px, d));
  }
  // Low mist.
  float mist = fbm(vec2(p.x * 3.0 - uGTime * 0.02, p.y * 8.0), 4);
  col += vec3(1.0, 0.65, 0.45) * smoothstep(0.1, -0.2, p.y - land) * mist * 0.08 * smoothstep(-0.5, -0.1, p.y);
  fragColor = vec4(col, 1.0);
}`;

function land(): Shot {
  return {
    ...span('land', { dIn: 1.0, dOut: 1.0 }),
    render(c) {
      c.fullscreen(c.e.program(LAND, 'land'), { uT: c.time - beat('land').start });
    },
  };
}

// ------------------------------------------------------------------ dinosaurs
const DINOS = `
#include <noise>
#include <color>
#include <aot/creatures>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uT, uStreak, uPan;
vec3 skyCol(vec2 p, vec2 sun, float disk) {
  float h = p.y + 0.08;
  vec3 c = mix(vec3(1.0, 0.42, 0.12), vec3(0.62, 0.2, 0.18), smoothstep(0.0, 0.2, h));
  c = mix(c, vec3(0.16, 0.07, 0.16), smoothstep(0.15, 0.55, h));
  float sd = length(p - sun);
  c += vec3(1.0, 0.55, 0.2) * exp(-sd * 5.0) * 0.9 + vec3(1.0, 0.8, 0.5) * exp(-sd * 25.0) * 1.5;
  c += vec3(1.0, 0.92, 0.75) * smoothstep(0.075, 0.07, sd) * 3.0 * disk;
  float cl = fbm(vec2(p.x * 1.5 + uGTime * 0.006, p.y * 7.0), 5);
  float band = smoothstep(0.52, 0.72, cl) * smoothstep(0.03, 0.2, h);
  c = mix(c, mix(vec3(0.95, 0.45, 0.25), vec3(0.3, 0.1, 0.15), smoothstep(0.1, 0.4, h)), band * 0.75);
  return c;
}
void sil(inout vec3 col, float d, float px, vec3 haze, float fog) {
  col = mix(col, mix(vec3(0.015, 0.008, 0.01), haze, fog), 1.0 - smoothstep(-px, px, d));
}
void main() {
  vec2 p = centered(vUv, uAspect);
  p.x += uPan;
  float px = 1.5 / uRes.y;
  vec2 sun = vec2(-0.2, -0.02);
  vec3 col = skyCol(p, sun, 1.0);
  vec3 haze = skyCol(vec2(p.x, -0.1), sun, 0.0) * 0.7;
  // Asteroid streak across the upper sky.
  if (uStreak > 0.0) {
    vec2 a = vec2(1.1 - uStreak * 1.2, 0.42 - uStreak * 0.25);
    vec2 dir = normalize(vec2(-1.2, -0.25));
    vec2 rel = p - a;
    float along = dot(rel, -dir);
    float perp = abs(dot(rel, vec2(-dir.y, dir.x)));
    float tail = exp(-perp / (0.002 + max(along, 0.0) * 0.01)) * exp(-max(along, 0.0) * 3.0) * step(0.0, along);
    col += vec3(1.0, 0.85, 0.6) * (tail * 3.0 + exp(-length(rel) / 0.006) * 8.0);
  }
  // Distant volcano and ridge.
  float ridge = -0.06 + 0.035 * fbm(vec2(p.x * 3.0, 1.0), 4);
  float vx = abs(p.x - 0.62);
  float vol = -0.08 + 0.21 * pow(max(0.0, 1.0 - vx / 0.34), 1.8) + 0.012 * gnoise(vec2(p.x * 25.0, 7.0));
  vol = min(vol, 0.13 - 0.02 * smoothstep(0.03, 0.0, vx));
  float mt = max(ridge, vol);
  sil(col, p.y - mt, px, haze, 0.55);
  // Smoke plume and crater glow.
  vec2 sp = p - vec2(0.62, 0.13);
  float plume = fbm(vec3(sp * 6.0 - vec2(0.0, uGTime * 0.08), uGTime * 0.05), 5);
  float pm = smoothstep(0.06 + sp.y * 0.6, 0.0, abs(sp.x - sp.y * 0.35)) * step(0.0, sp.y);
  col = mix(col, vec3(0.12, 0.06, 0.06), saturate(pm * plume * 1.4) * 0.85);
  col += fireRamp(0.6) * exp(-length(sp - vec2(0.0, -0.005)) / 0.012) * 1.5;
  // Plain.
  float ground = -0.2 + 0.02 * gnoise(vec2(p.x * 3.0, 3.0));
  sil(col, p.y - ground, px, haze, 0.3);
  // Sauropod herd on the plain.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float s = 0.13 - fi * 0.02;
    vec2 base = vec2(-0.75 + fi * 0.3 + uT * 0.012, -0.12 - fi * 0.01);
    vec2 q = (p - base) / s;
    sil(col, sdSauropod(q, uGTime * 0.6, fi * 1.7) * s, px, haze, 0.28 + fi * 0.05);
  }
  // Pterosaurs.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 c = vec2(-1.1 + uT * (0.1 + fi * 0.02) + fi * 0.35, 0.3 + 0.08 * fi + 0.02 * sin(uT * 0.7 + fi));
    float s = 0.05 - fi * 0.008;
    vec2 q = (p - c) / s;
    sil(col, sdPtero(q, uGTime, fi * 2.0) * s, px, haze, 0.15);
  }
  // Foreground: T. rex striding right, with ferns and cycads.
  float fg = -0.42 + 0.02 * gnoise(vec2(p.x * 4.0, 5.0));
  sil(col, p.y - fg, px, haze, 0.0);
  {
    float s = 0.34;
    vec2 base = vec2(-0.55 + uT * 0.045, fg - 0.01);
    vec2 q = (p - base) / s;
    sil(col, sdTrex(q, uGTime, 0.0) * s, px, haze, 0.0);
  }
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float x = fi < 2.0 ? -1.05 + fi * 0.2 : 0.75 + (fi - 2.0) * 0.25;
    float s = 0.22 + 0.08 * fract(fi * 0.61);
    vec2 q = (p - vec2(x, fg - 0.01)) / s;
    float d = mod(fi, 2.0) < 1.0 ? sdCycad(q, uGTime, fi, 1.0) : sdFern(q, uGTime, fi, 1.0);
    sil(col, d * s, px, haze, 0.0);
  }
  fragColor = vec4(col, 1.0);
}`;

function dinosaurs(): Shot {
  return {
    ...span('dinosaurs', { dIn: 1.0, dOut: 0, post: cues.asteroidStreak + 0.7 - beat('dinosaurs').end }),
    render(c) {
      const t = c.time - beat('dinosaurs').start;
      c.fullscreen(c.e.program(DINOS, 'dinos'), {
        uT: t,
        uStreak: prog(c.time, cues.asteroidStreak - 0.4, cues.asteroidStreak + 0.7, 'linear'),
        uPan: keys(t, [[-1, -0.04], [9.5, 0.06, 'inOutSine']]),
      });
    },
  };
}

// ------------------------------------------------------------------ the asteroid
const YUCATAN: Vec3 = (() => {
  const lat = (21.4 * Math.PI) / 180, lon = (-89.5 * Math.PI) / 180;
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
})();

function impact(): Shot<EarthShot & { maps: EarthMaps; rock: Planet; ejecta: Sprites }> {
  const start = cues.asteroidStreak + 0.7;
  return {
    id: 'impact',
    start,
    end: beat('impact').end + 0.6,
    fadeIn: 0,
    fadeOut: 1.2,
    async setup(e) {
      const maps = await loadEarth(e);
      const r = rng(158);
      const n = 1200;
      const d = allocSprites(n);
      for (let i = 0; i < n; i++) {
        const dir = r.onSphere();
        d.position.set(dir, i * 3);
        const c = blackbody(r.range(1500, 3500));
        const b = r.range(0.3, 1.2);
        d.color.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
        d.size[i] = r.range(0.0015, 0.004);
        d.extra!.set([r.next(), r.next(), r.next(), r.next()], i * 4);
      }
      const ejecta = new Sprites(e, d, {
        animate: `
          uniform float uAge; uniform vec3 uSite;
          vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
            if (uAge < 0.0) { size = 0.0; return p; }
            vec3 n = normalize(uSite);
            vec3 dir = normalize(n * (0.6 + x.x) + p * 0.7);
            float sp = 0.12 + 0.35 * x.y;
            float tt = uAge;
            vec3 pos = uSite * 1.0 + dir * sp * tt - n * 0.06 * tt * tt;
            col *= exp(-tt * 1.3) * (1.0 + 2.0 * exp(-tt * 3.0));
            return pos;
          }`,
      });
      return {
        maps,
        planet: new Planet(e, maps),
        rock: new Planet(e),
        cam: new Camera({ fov: 34 }),
        sky: new Sprites(e, starSphere(rng(157), { count: 8000, brightness: 0.35 })),
        ejecta,
      };
    },
    render(c, s) {
      const age = c.time - cues.asteroidImpact;
      const yaw = (89.5 * Math.PI) / 180;
      s.cam.set({ pos: [0.35, 0.55, keys(c.time, [[start, 2.6], [cues.asteroidImpact, 2.75], [163, 3.3, 'outCubic']])], target: [0.05, 0.25, 0] });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      const sun: Vec3 = [-0.55, 0.45, 0.7];
      // Site in world space (tilt 0, yaw rotates longitude -89.5 deg to face +z).
      const site: Vec3 = [0.0, Math.sin((21.4 * Math.PI) / 180), Math.cos((21.4 * Math.PI) / 180)];
      s.planet.draw(c, s.cam, {
        center: [0, 0, 0], radius: 1, spin: 0, yaw, tilt: 0, sunDir: sun, earth: 1, clouds: 0.4, cloudT: 0.3 + c.time * 0.004,
        atmo: 0.9, atmoColor: [0.3, 0.55, 1.0], glint: 0.6,
        impacts: age >= 0 ? [[YUCATAN[0], YUCATAN[1], YUCATAN[2], age * 2.5]] : [],
        dustDir: YUCATAN, dustR: age > 0 ? 0.1 + 0.9 * (1 - Math.exp(-age * 0.55)) : 0, dust: age > 0 ? 0.92 : 0,
      });
      if (age < 0) {
        // The asteroid streaking in, wrapped in plasma.
        const k = -age;
        const pos: Vec3 = [site[0] + 0.55 * k, site[1] + 0.9 * k, site[2] + 0.25 * k];
        s.rock.draw(c, s.cam, { center: pos, radius: 0.012, sunDir: sun, seed: 5, lava: 0.6, crust: 0.8, atmo: 0 });
      }
      s.ejecta.draw(s.cam, c.time, { uAge: age, uSite: site }, { blend: 'add' });
    },
  };
}

export function lifeShots(): Shot[] {
  return [vent(), cells(), oxygen(), snowball(), cambrian(), land(), dinosaurs(), impact()];
}
