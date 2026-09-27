// Act IV: the first life, oxygen, snowball Earth, the Cambrian seas, onto land, dinosaurs, the asteroid.
import {
  Camera,
  Planet,
  Sprites,
  allocSprites,
  blackbody,
  ease,
  keys,
  loadEarth,
  prog,
  rng,
  smoothstep,
  starSphere,
  v3,
  type EarthMaps,
  type RenderTarget,
  type Shot,
  type Vec3,
} from '@engine';
import { beat, cues, scratch, span } from '../lib';

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
// Binary fission of a rod-shaped microbe. Life 3.8 billion years ago was bacteria- and
// archaea-like: no nucleus, just a tangle of DNA (the nucleoid), ribosomes, storage granules and a
// flagellum. The cell grows, copies its DNA and pulls the copies apart, a protein ring (FtsZ)
// constricts the middle, and the daughters snap apart. Interior textures are looked up in material
// coordinates that each daughter carries away, so the two halves are never copies of each other.
const CELLS = `
#include <noise>
#include <sdf>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uCycle, uSnap, uDrift, uZoom;
const float R = 0.066;             // rod radius (screen heights)
const float H0 = 0.08, H1 = 0.2;   // half-length of the rod's axis at birth and before division

float sdRod(vec2 p, float h, float r) { p.x -= clamp(p.x, -h, h); return length(p) - r; }

// Dividing cell in its own frame: h = parent half-length, k = neck blend, th/gap = snap apart.
// qa, qb are the daughters' rest-frame coordinates (equal to l until they separate).
float cellSd(vec2 l, float h, float k, float th, float gap, out vec2 qa, out vec2 qb, out float da, out float db) {
  vec2 ca = vec2(-(h + R) * 0.5, 0.0);
  float hd = (h - R) * 0.5;
  qa = rot2(-th) * l + vec2(gap, 0.0);
  qb = rot2(th) * l - vec2(gap, 0.0);
  da = sdRod(qa - ca, hd, R);
  db = sdRod(qb + ca, hd, R);
  float d = k > 1e-5 ? smin(da, db, k) : min(da, db);
  return th > 0.0 ? d : max(d, sdRod(l, h, R));
}

vec3 water(vec2 p) {
  vec3 col = mix(vec3(0.0, 0.02, 0.032), vec3(0.006, 0.07, 0.09), smoothstep(-0.7, 0.6, p.y + p.x * 0.25));
  col *= 0.75 + 0.5 * fbm(vec3(p * 2.2, uGTime * 0.03), 3);
  // Warm glow from the vent, off frame to the lower left.
  col += vec3(0.32, 0.13, 0.04) * 0.07 * exp(-1.7 * length(p - vec2(-1.0, -0.55)));
  // Other microbes, out of focus at different depths: rods and cocci.
  for (int i = 0; i < 7; i++) {
    vec3 h = hash31(float(i) * 11.7 + 3.0);
    vec2 c = vec2(h.x * 2.0 - 1.0, h.y * 0.8 - 0.4) + 0.02 * vec2(sin(uGTime * 0.2 + h.z * 7.0), cos(uGTime * 0.17 + h.x * 5.0));
    float r = 0.025 + 0.03 * h.y;
    float hl = h.x > 0.4 ? r * (0.6 + 1.2 * h.z) : 0.0;
    float d = sdRod(rot2(-h.z * 6.28 - uGTime * 0.03 * (h.x - 0.5)) * (p - c), hl, r);
    float blur = 0.018 + 0.03 * h.z;
    col += vec3(0.2, 0.6, 0.65) * (exp(-abs(d) / (0.003 + blur)) * 0.22 + smoothstep(blur, -blur, d) * 0.04) / (1.0 + blur * 40.0);
  }
  // Marine snow: fine specks and a few large out-of-focus motes.
  vec2 g = p * 48.0 + vec2(uGTime * 0.3, uGTime * 0.7);
  vec3 hs = hash32(floor(g));
  vec2 f = fract(g) - hs.xy;
  col += vec3(0.45, 0.8, 0.9) * step(0.92, hs.z) * exp(-dot(f, f) / 0.008) * 0.12;
  vec2 g2 = p * 9.0 + vec2(uGTime * 0.08, uGTime * 0.18);
  vec3 hb = hash32(floor(g2) + 31.0);
  vec2 fb = fract(g2) - (0.2 + 0.6 * hb.xy);
  col += vec3(0.3, 0.6, 0.7) * step(0.8, hb.z) * smoothstep(0.12, 0.09, length(fb)) * 0.025;
  return col;
}

void main() {
  vec2 C = vec2(-0.09, 0.035) + 0.004 * vec2(sin(uGTime * 0.7), cos(uGTime * 0.53));
  vec2 p = C + (centered(vUv, uAspect) - C) / uZoom;
  vec3 col = water(p);
  float ang = 0.33 + 0.03 * sin(uGTime * 0.2);
  vec2 l = rot2(-ang) * (p - C);

  // Cell cycle: elongate, segregate the DNA, constrict, pinch; then snap apart and drift.
  float e = smoothstep(0.0, 0.55, uCycle);
  float h = mix(H0, H1, e);
  float seg = smoothstep(0.08, 0.62, uCycle);
  float u = seg * (h + R) * 0.5;
  float con = smoothstep(0.4, 0.97, uCycle);
  float w = R * (1.0 - con);                             // neck radius
  float k = 4.0 * (sqrt(R * R + w * w) - R);             // smin blend that gives that neck
  float th = 0.22 * uSnap, gap = 0.012 * uSnap + 0.012 * uDrift;
  float sx = mix(1.0, (H0 + R) / (h + R), 0.65);         // the cytoplasm stretches as the cell grows

  vec2 qa, qb, qa2, qb2; float da, db, t1, t2;
  float d = cellSd(l, h, k, th, gap, qa, qb, da, db);
  vec2 n = vec2(cellSd(l + vec2(0.0015, 0.0), h, k, th, gap, qa2, qb2, t1, t2) - d,
                cellSd(l + vec2(0.0, 0.0015), h, k, th, gap, qa2, qb2, t1, t2) - d);
  n = rot2(ang) * normalize(n + 1e-7);
  vec2 m = (da < db ? qa : qb) * vec2(sx, 1.0);

  float inside = smoothstep(0.0025, -0.0025, d);
  // Depth for shading: the parent rod's until the neck forms (the blended field is shallow there).
  float s = clamp(-(th > 0.0 ? d : mix(sdRod(l, h, R), d, con)) / R, 0.0, 1.0);
  float thick = sqrt(max(2.0 * s - s * s, 0.0));          // optical depth through a round rod
  col *= 1.0 - 0.35 * inside;

  // Cytoplasm, ribosomes.
  float cyto = 0.7 + 0.6 * fbm(vec3(m * 25.0, uGTime * 0.1), 3);
  float ribo = smoothstep(0.25, 0.75, gnoise(vec3(m * 170.0, uGTime * 0.25)));
  col += (vec3(0.03, 0.13, 0.15) * cyto + vec3(0.25, 0.55, 0.55) * ribo * 0.12) * thick * inside;

  // Nucleoid: two copies of a fibrous DNA tangle, overlapping at first, pulled to the daughters.
  float rx = mix(0.085, 0.07, seg), ry = 0.04;
  vec2 na = qa + vec2(u, 0.0), nb = qb - vec2(u, 0.0);
  float ga = exp(-2.2 * (na.x * na.x / (rx * rx) + na.y * na.y / (ry * ry)));
  float gb = exp(-2.2 * (nb.x * nb.x / (rx * rx) + nb.y * nb.y / (ry * ry)));
  float dna = 1.0 - (1.0 - ga * ridged(vec3(na * 60.0, uGTime * 0.12), 3)) * (1.0 - gb * ridged(vec3(nb * 60.0 + 17.3, uGTime * 0.12 + 5.0), 3));
  col += vec3(0.5, 0.42, 1.0) * dna * inside * 0.5;

  // Storage granules, away from the division plane.
  for (int i = 0; i < 6; i++) {
    vec3 hh = hash31(float(i) * 3.7 + 1.3);
    float gx = (0.03 + 0.08 * hh.x) * (i < 3 ? -1.0 : 1.0);
    vec2 gp = vec2(gx, (hh.y - 0.5) * 0.08);
    float r = 0.006 + 0.005 * hh.z;
    float gd = length(m - gp);
    col += (vec3(1.0, 0.72, 0.42) * (smoothstep(r, r * 0.6, gd) * 0.07 + exp(-abs(gd - 0.8 * r) / (0.12 * r)) * 0.1)
          + vec3(1.0, 0.9, 0.75) * exp(-length(m - gp - r * vec2(-0.3, 0.4)) / (0.15 * r)) * 0.18) * inside;
  }

  // FtsZ ring at the division plane, seen edge-on: bright where it meets the membrane.
  float ring = exp(-l.x * l.x / 1.5e-5) * smoothstep(0.32, 0.55, uCycle) * (1.0 - smoothstep(0.9, 1.0, uCycle)) * (1.0 - uSnap);
  col += vec3(0.6, 1.0, 1.0) * ring * inside * (0.012 + 0.7 * exp(-abs(d) / 0.006));

  // Envelope: inner membrane and the wall just outside it, lit cool from above and warm by the vent.
  vec3 rim = vec3(0.35, 0.9, 0.95) * (0.35 + 0.65 * max(dot(n, vec2(-0.45, 0.89)), 0.0))
           + vec3(1.0, 0.55, 0.25) * 0.6 * max(dot(n, vec2(-0.8, -0.6)), 0.0);
  col += rim * (exp(-abs(d) / 0.0032) * 1.1 + exp(-abs(d - 0.0055) / 0.0022) * 0.4 + exp(-max(d, 0.0) / 0.02) * (1.0 - inside) * 0.06);

  // Flagellum on the right-hand pole: a waving filament that leaves with that daughter.
  float fs = qb.x - (h + R - 0.003);
  if (fs > -0.01 && fs < 0.26) {
    float amp = 0.016 * smoothstep(0.0, 0.07, fs), ph = fs * 42.0 - uGTime * 10.0;
    float fd = abs(qb.y - amp * sin(ph)) / sqrt(1.0 + amp * amp * 1764.0 * cos(ph) * cos(ph));
    col += vec3(0.45, 0.9, 0.95) * exp(-fd / 0.0016) * (1.0 - smoothstep(0.15, 0.26, fs)) * smoothstep(-0.004, 0.01, fs) * 0.45 * (1.0 - inside);
  }
  fragColor = vec4(col, 1.0);
}`;

function cells(): Shot {
  const b = beat('life');
  const pinch = b.end - 1.3;
  return {
    id: 'cells',
    start: b.start + 3.2,
    end: b.end + 0.5,
    fadeIn: 1.0,
    fadeOut: 1.0,
    render(c) {
      c.fullscreen(c.e.program(CELLS, 'cells'), {
        uCycle: prog(c.time, b.start + 3.3, pinch, 'inOutSine'),
        uSnap: prog(c.time, pinch, pinch + 0.9, 'outCubic'),
        uDrift: Math.max(0, c.time - pinch),
        uZoom: 1 + 0.08 * prog(c.time, b.start + 3.2, b.end + 0.5, 'inOutSine'),
      });
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
      s.cam.set({ pos: [-0.3, 0.2, keys(t, [[-1, 3.9], [5, 3.6]])], target: [-0.85, 0.05, 0] });
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
#include <creatures>
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
#include <creatures>
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
#include <creatures>
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
// Chicxulub, 66 million years ago: a ~10 km asteroid from the northeast at a steep angle.
// From low orbit over the Gulf of Mexico: entry with a plasma trail, a flash, a fireball dome
// rising from Yucatán with an ejecta curtain and a shock-heated ring, then (pulling back) the
// ejecta re-entering around the planet as a spreading wave of fires under a soot veil.
// Earth here: tilt 0, spin 0, yaw so that longitude -89.5 faces +z (world = local rotated).
const YUCATAN: Vec3 = (() => {
  const lat = (21.4 * Math.PI) / 180, lon = (-89.5 * Math.PI) / 180;
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
})();
const SITE_LAT = (21.4 * Math.PI) / 180;
/** The impact site in world space, with local east and north. */
const SITE: Vec3 = [0, Math.sin(SITE_LAT), Math.cos(SITE_LAT)];
const EAST: Vec3 = [1, 0, 0];
const NORTH: Vec3 = [0, Math.cos(SITE_LAT), -Math.sin(SITE_LAT)];
/** Where the asteroid comes from: northeast, 58 degrees above the horizon. */
const INCOMING = v3.norm(v3.add(v3.scale(v3.norm(v3.add(EAST, NORTH)), Math.cos(1.01)), v3.scale(SITE, Math.sin(1.01))));
const AST_SPEED = 1.15; // Earth radii per second (film time)
const asteroidAt = (age: number): Vec3 => v3.add(v3.scale(SITE, 1.004), v3.scale(INCOMING, -age * AST_SPEED));

const TRAIL = `
#include <common>
#include <noise>
#include <color>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uHeat, uGTime;
uniform vec2 uHead, uTail;
void main() {
  vec2 p = centered(vUv, uAspect);
  vec2 ab = uTail - uHead;
  float h = saturate(dot(p - uHead, ab) / dot(ab, ab));
  float d = length(p - uHead - ab * h);
  // The ionized wake widens and flickers behind the head.
  float w = 0.0018 + 0.012 * h * (0.8 + 0.4 * vnoise(vec2(h * 40.0 - uGTime * 30.0, 0.0)));
  float trail = exp(-d * d / (w * w)) * pow(1.0 - h, 1.2);
  float sheath = exp(-length(p - uHead) / 0.006);
  float halo = exp(-length(p - uHead) / 0.03) * 0.25;
  vec3 col = fireRamp(0.45 + 0.5 * (1.0 - h)) * trail * 2.0 + vec3(1.0, 0.95, 0.85) * sheath * 3.0 + vec3(1.0, 0.6, 0.3) * halo;
  fragColor = vec4(col * uHeat, 1.0);
}`;

/**
 * Fireball plume: an emission-absorption volume on the local vertical, a mushroom cap on a
 * widening stem that rises and cools from white-hot to embers under dark soot (premultiplied).
 */
const FIREBALL = `
#include <common>
#include <noise>
#include <color>
#include <camera>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes;
uniform float uAspect;
uniform vec3 uSite, uSunDir;
uniform float uAge, uR, uLift;
void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p), ro = uCamPos;
  vec3 c = uSite * (1.0 + 0.95 * uR);
  float Rb = uR * (1.7 + 1.6 * smoothstep(1.4, 4.5, uAge));
  vec3 oc = ro - c;
  float b = dot(oc, rd), h = b * b - dot(oc, oc) + Rb * Rb;
  if (h <= 0.0) { fragColor = vec4(0.0); return; }
  float t0 = max(-b - sqrt(h), 0.0), t1 = -b + sqrt(h);
  float be = dot(ro, rd), he = be * be - dot(ro, ro) + 1.0;
  if (he > 0.0) { float te = -be - sqrt(he); if (te > 0.0) t1 = min(t1, te); }
  if (t1 <= t0) { fragColor = vec4(0.0); return; }
  const int N = 40;
  float dt = (t1 - t0) / float(N);
  float T = 1.0;
  vec3 L = vec3(0.0);
  float j = hash12(gl_FragCoord.xy + fract(uAge * 7.31) * 100.0);
  float cool = exp(-uAge * 0.33) * (1.0 - 0.6 * smoothstep(1.4, 3.6, uAge));
  float hc = 0.45 + 0.6 * uLift;   // cap centre height, in plume radii
  // Later the cap spreads sideways and thins into a smoke sheet over the dust veil.
  float spread = 1.0 + 1.6 * smoothstep(1.4, 4.5, uAge);
  float thin = 1.0 - 0.85 * smoothstep(1.6, 4.2, uAge);
  for (int i = 0; i < N; i++) {
    vec3 x = ro + rd * (t0 + (float(i) + j) * dt);
    vec3 d = x - uSite;
    float hh = dot(d, uSite) / uR;
    if (hh < -0.05) continue;
    float l = length(d - uSite * dot(d, uSite)) / uR;
    float n = fbm(d / uR * 2.3 + vec3(0.0, -uAge * 0.9, uAge * 0.2), 4);
    float cap = length(vec2(l / spread, (hh - hc) * spread / 0.72));
    float stem = hh < hc ? l / (0.3 + 0.35 * hh) : 9.0;
    float shape = min(cap, stem) + 0.55 * (n - 0.5);
    float dens = smoothstep(1.0, 0.5, shape) * smoothstep(-0.05, 0.1, hh) * thin;
    if (dens < 0.002) continue;
    float heat = cool * (0.72 + 0.28 * saturate(1.0 - shape)) * (0.6 + 0.4 * n);
    vec3 em = blackbody(1300.0 + 5400.0 * heat) * heat * heat * 11.0;
    float lit = 0.3 + 0.7 * max(dot(normalize(x), uSunDir), 0.0);
    vec3 soot = vec3(0.075, 0.07, 0.065) * lit * (1.0 - cool) * (1.0 - cool);
    float a = 1.0 - exp(-dens * 7.0 * dt / uR);
    L += T * (em + soot) * a;
    T *= 1.0 - a;
    if (T < 0.02) break;
  }
  fragColor = vec4(L, 1.0 - T);
}`;

const OVER = `
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uSrc;
void main() { fragColor = texture(uSrc, vUv); }`;

/** Ejecta curtain: ballistic debris thrown out of the crater at ~45 degrees, all around. */
const CURTAIN = `
#include <color>
uniform float uAge;
uniform vec3 uSite, uE, uN;
// position = (azimuth, speed, elevation); extra = (launch delay, ...)
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  float t = uAge - x.x;
  if (t < 0.0) { size = 0.0; return uSite; }
  vec3 hor = cos(p.x) * uE + sin(p.x) * uN;
  vec3 pos = uSite * 1.002 + (hor * cos(p.z) + uSite * sin(p.z)) * p.y * t;
  pos -= normalize(pos) * 0.5 * 0.42 * t * t;
  if (length(pos) < 1.0) { size = 0.0; return pos; }
  float heat = exp(-t * 1.6);
  col = mix(vec3(0.07, 0.06, 0.05) * col.g, blackbody(1600.0 + 2800.0 * heat) * col.r, heat);
  size *= 1.0 + 1.2 * t;
  return pos;
}`;

/** Re-entering ejecta: flashes that race outward over the globe and leave fires behind. */
const REENTRY = `
#include <color>
uniform float uAge;
// position = point on the surface; extra = (arrival time, ...)
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  float t = uAge - x.x;
  if (t < 0.0) { size = 0.0; return p; }
  float flash = exp(-t * 5.0);
  float ember = 0.18 * smoothstep(0.0, 0.3, t) * (0.6 + 0.4 * sin(t * 13.0 + x.y * 50.0));
  col = blackbody(1500.0 + 1700.0 * flash) * col.r * (flash * 2.0 + ember);
  size *= 1.0 + 1.2 * flash;
  return p;
}`;

function impact(): Shot<EarthShot & { maps: EarthMaps; curtain: Sprites; reentry: Sprites; half: RenderTarget }> {
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
      const nc = 30000;
      const cd = allocSprites(nc);
      for (let i = 0; i < nc; i++) {
        cd.position.set([r.range(0, Math.PI * 2), r.range(0.08, 0.34) * (r.next() < 0.12 ? 1.5 : 1), r.range(0.62, 0.88)], i * 3);
        cd.extra!.set([r.next() ** 2 * 0.4, r.next(), 0, 0], i * 4);
        cd.color.set([r.range(0.35, 1.0), r.range(0.6, 1.4), 0], i * 3);
        cd.size[i] = r.range(0.0005, 0.0013);
      }
      // Re-entry: points on the globe, reached by a front moving ~0.85 rad/s from the site.
      const nr = 14000;
      const rd = allocSprites(nr);
      for (let i = 0; i < nr; i++) {
        const d = r.onSphere();
        const ang = Math.acos(Math.max(-1, Math.min(1, v3.dot(d, SITE))));
        if (ang < 0.12) {
          rd.size[i] = 0;
          continue;
        }
        rd.position.set(v3.scale(d, 1.004), i * 3);
        rd.extra!.set([0.55 + ang / 0.85 + r.range(-0.12, 0.25), r.next(), 0, 0], i * 4);
        rd.color.set([r.range(0.25, 0.8), 0, 0], i * 3);
        rd.size[i] = r.range(0.0011, 0.0026);
      }
      return {
        maps,
        planet: new Planet(e, maps),
        cam: new Camera({ fov: 46, far: 100 }),
        sky: new Sprites(e, starSphere(rng(157), { count: 8000, brightness: 0.35 })),
        curtain: new Sprites(e, cd, { animate: CURTAIN, minPixels: 0.7 }),
        reentry: new Sprites(e, rd, { animate: REENTRY, minPixels: 0.8 }),
        half: scratch(e, 0.5),
      };
    },
    render(c, s) {
      const age = c.time - cues.asteroidImpact;
      // Camera: low over the Gulf looking north (limb above), then a pull-back to the whole planet.
      const closePos = v3.add(v3.add(v3.scale(SITE, 1.62), v3.scale(NORTH, -0.95)), v3.scale(EAST, -0.2));
      const closeTarget = v3.add(v3.scale(SITE, 1.02), v3.scale(NORTH, 0.3));
      const farPos: Vec3 = [0.55, 0.7, 3.1];
      const farTarget: Vec3 = [0.12, 0.18, 0];
      const k = ease.inOutCubic(smoothstep(1.2, 3.8, age));
      const drift = v3.scale(EAST, 0.04 * (c.time - start));
      s.cam.set({
        pos: v3.add(v3.add(v3.scale(closePos, 1 - k), v3.scale(farPos, k)), drift),
        target: v3.add(v3.scale(closeTarget, 1 - k), v3.scale(farTarget, k)),
        up: v3.norm(v3.add(v3.scale(SITE, 1 - k), v3.scale([0, 1, 0], k))),
        fov: 46 - 12 * k,
      });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      const sun: Vec3 = v3.norm([-0.35, 0.55, 0.75]);
      const yaw = (89.5 * Math.PI) / 180;
      const smoke = smoothstep(1.0, 4.0, age);
      s.planet.draw(c, s.cam, {
        center: [0, 0, 0], radius: 1, spin: 0, yaw, tilt: 0, sunDir: sun, earth: 1, clouds: 0.4, cloudT: 0.3 + c.time * 0.004,
        atmo: 0.9, glint: 0.6,
        // Soot turns the blue limb a sick brown as it spreads.
        atmoColor: v3.add(v3.scale([0.3, 0.55, 1.0], 1 - 0.8 * smoke), v3.scale([0.4, 0.26, 0.16], 0.8 * smoke)),
        haze: 0.12 * smoke, hazeColor: [0.16, 0.11, 0.08],
        impacts: age >= 0 ? [[YUCATAN[0] * 2.2, YUCATAN[1] * 2.2, YUCATAN[2] * 2.2, age * 1.8]] : [],
        dustDir: YUCATAN, dustR: age > 0 ? 0.08 + 2.0 * (1 - Math.exp(-age * 0.36)) : 0, dust: age > 0 ? 0.95 : 0,
        depthWrite: true,
      });
      if (age < 0) {
        // Entry: the head in a plasma sheath with an ionized wake; brightest in the atmosphere.
        const head = s.cam.project(asteroidAt(age));
        const tail = s.cam.project(asteroidAt(age - 0.32));
        c.gl.enable(c.gl.BLEND);
        c.gl.blendFunc(c.gl.ONE, c.gl.ONE);
        c.fullscreen(c.e.program(TRAIL, 'trail'), {
          uHead: [(head.x - 0.5) * c.aspect, head.y - 0.5],
          uTail: [(tail.x - 0.5) * c.aspect, tail.y - 0.5],
          uHeat: 0.7 + 1.6 * smoothstep(-0.3, 0.0, age),
        });
        c.gl.disable(c.gl.BLEND);
        return;
      }
      s.curtain.draw(s.cam, c.time, { uAge: age, uSite: SITE, uE: EAST, uN: NORTH }, { blend: 'add', depthTest: true });
      s.reentry.draw(s.cam, c.time, { uAge: age }, { blend: 'add', depthTest: true });
      // The fireball dome at half resolution, composited over the scene (premultiplied).
      const R = 0.004 + 0.1 * (1 - Math.exp(-age * 1.4));
      s.half.clear(0, 0, 0, 0);
      c.fullscreen(c.e.program(FIREBALL, 'fireball'), { ...s.cam.uniforms(), uSite: SITE, uSunDir: sun, uAge: age, uR: R, uLift: smoothstep(0.2, 3.0, age) });
      c.target.bind();
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE_MINUS_SRC_ALPHA);
      c.fullscreen(c.e.program(OVER, 'over'), { uSrc: s.half });
      c.gl.disable(c.gl.BLEND);
    },
  };
}

export function lifeShots(): Shot[] {
  return [vent(), cells(), oxygen(), snowball(), cambrian(), land(), dinosaurs(), impact()];
}
