// Act VI: the future, from the clock resuming to the death of the Sun (the end of time is in end.ts).
import {
  Camera,
  Planet,
  Sprites,
  allocSprites,
  blackbody,
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
  type SpriteData,
  type Vec3,
} from '@engine';
import type { Look } from '@engine';
import { beat, cues, scratch, span, timeline } from '../lib';
import { endShots } from './end';

const COPY_ADD = `
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uSrc;
void main() { fragColor = vec4(texture(uSrc, vUv).rgb, 1.0); }`;

// ------------------------------------------------------------------ the clock keeps ticking
const DIAL = `
#include <common>
#include <stars>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uHand, uPrev, uGhost, uVis;
uniform float uAge[6];                    // seconds since each tick (negative: not yet)
// A hair line: 1 on the line, falling off over about a pixel.
float hair(float d, float w) { return exp(-d * d / (w * w)); }
float handAt(vec2 p, float a, float px, float R) {
  vec2 hd = vec2(sin(a), cos(a));
  float along = dot(p, hd);
  float perp = abs(dot(p, vec2(hd.y, -hd.x)));
  // A needle that tapers to its tip, with a short counterweight behind the pivot.
  float w = px * mix(1.5, 0.7, saturate(along / R));
  return hair(perp, w) * smoothstep(-0.052, -0.046, along) * smoothstep(R - 0.02, R - 0.03, along)
       + hair(perp, px * 2.2) * smoothstep(-0.05, -0.044, along) * smoothstep(-0.018, -0.024, along) * 0.7;
}
void main() {
  vec2 p = centered(vUv, uAspect);
  float px = 1.0 / uRes.y;
  vec3 col = starField(p, px, uGTime, 21.0, 0.35);
  p.y -= 0.05;                            // the dial sits a little high: its line goes underneath
  float r = length(p);
  float a = atan(p.x, p.y);               // 0 at 12 o'clock, clockwise
  float R = 0.24;
  // The bezel: a fine ring with a hairline inside it.
  float ring = hair(r - R, px * 1.2) * 0.4 + hair(r - (R - 0.03), px * 0.8) * 0.1;
  // Sixty marks; every fifth is longer and brighter, and twelve o'clock is a double stroke.
  float sa = mod(a + PI / 60.0, TAU / 60.0) - PI / 60.0;
  float fa = mod(a + PI / 12.0, TAU / 12.0) - PI / 12.0;
  float minor = hair(sa * r, px * 0.9) * band(r, R - 0.014, R - 0.006, px * 1.5) * 0.3;
  float major = hair(fa * r, px * 1.3) * band(r, R - 0.026, R - 0.006, px * 1.5) * 0.85 * step(0.2, abs(a));
  float twelve = (hair(abs(a * r) - px * 3.0, px * 1.1)) * band(r, R - 0.026, R - 0.006, px * 1.5) * step(abs(a), 0.2) * 0.85;
  float marks = max(minor, max(major, twelve));
  // The second hand, and the ghost of where it stood a moment ago.
  float hand = handAt(p, uHand, px, R) + handAt(p, uPrev, px, R) * 0.22 * uGhost;
  // Each tick sends a faint ring out from the bezel.
  float ripple = 0.0;
  for (int i = 0; i < 6; i++) {
    float age = uAge[i];
    if (age < 0.0) continue;
    ripple += hair(r - (R + 0.012 + 0.11 * age), px * (1.5 + 14.0 * age)) * exp(-age * 2.6) * 0.22;
  }
  vec3 ivory = vec3(0.88, 0.82, 0.72);
  col += ivory * (ring + marks * 0.7 + hand * 0.95 + ripple) * uVis;
  // The pivot: a small warm light, where the pale blue dot was.
  col += vec3(1.0, 0.88, 0.7) * (exp(-r / (px * 2.5)) * 0.7 + exp(-r / 0.02) * 0.03) * uVis;
  fragColor = vec4(col, 1.0);
}`;

function turn(): Shot {
  const b = beat('turn');
  // The hand jumps on each tick of the resumed clock, and settles with a small rebound.
  const tickTimes = [0, 1.5, 2.5, 3.5, 4.5, 5.5].map((d) => cues.resumeTick + d);
  const STEP = (Math.PI * 2) / 60;
  return {
    ...span('turn', { dIn: 0.6, dOut: 1.6 }),
    render(c) {
      let k = 0, n = 0, last = -1;
      for (const tt of tickTimes) {
        if (c.time < tt) continue;
        const dt = c.time - tt;
        k += 1 - Math.exp(-dt * 26) * Math.cos(dt * 38);
        n++;
        last = dt;
      }
      c.fullscreen(c.e.program(DIAL, 'dial'), {
        uHand: (k + 44) * STEP,
        uPrev: (n + 43) * STEP,
        uGhost: last >= 0 ? Math.exp(-last * 5) : 0,
        uAge: tickTimes.map((tt) => (c.time >= tt ? c.time - tt : -1)),
        uVis: prog(c.time, b.start, b.start + 1.2, 'inOutSine'),
      });
    },
  };
}

// ------------------------------------------------------------------ Mars
function mars(): Shot<{ planet: Planet; cam: Camera; sky: Sprites }> {
  return {
    ...span('mars', { dIn: 1.6, dOut: 1.0 }),
    setup: (e) => ({ planet: new Planet(e), cam: new Camera({ fov: 32 }), sky: new Sprites(e, starSphere(rng(220), { count: 8000, brightness: 0.35 })) }),
    render(c, s) {
      const t = c.time - beat('mars').start;
      const tf = prog(t, 0.8, 7.2, 'inOutSine');
      s.cam.set({ pos: [0.2, 0.2, keys(t, [[-1, 3.8], [9, 3.3]])], target: [0.25, 0.02, 0] });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      s.planet.draw(c, s.cam, {
        center: [0, 0, 0], radius: 1, spin: c.time * 0.05, tilt: 0.44, sunDir: [-0.7, 0.3, 0.65], seed: 31,
        mars: 1, terraform: tf, veg: prog(t, 3, 8, 'inOutSine'), ocean: tf, oceanColor: [0.02, 0.08, 0.18], ice: 0.12 + 0.05 * tf,
        clouds: 0.05 + 0.4 * tf, cloudT: c.time * 0.03, atmo: 0.35 + 0.55 * tf,
        atmoColor: [0.85 - 0.55 * tf, 0.55 - 0.0 * tf, 0.45 + 0.55 * tf], glint: 0.15,
      });
    },
  };
}

// ------------------------------------------------------------------ the constellations dissolve
// Big Dipper stars: position (deg, RA-offset x cos dec, dec offset) and proper motion (mas/yr).
// Positions, proper motions and magnitudes from the Hipparcos catalogue (ESA).
const DIPPER: { x: number; y: number; pmx: number; pmy: number; m: number }[] = [
  { x: -11.36, y: 6.25, pmx: -134, pmy: -35, m: 1.8 },
  { x: -11.63, y: 0.88, pmx: 82, pmy: 34, m: 2.4 },
  { x: -4.27, y: -1.81, pmx: 108, pmy: 11, m: 2.4 },
  { x: -1.21, y: 1.53, pmx: 104, pmy: 8, m: 3.3 },
  { x: 4.25, y: 0.46, pmx: 112, pmy: -9, m: 1.8 },
  { x: 8.48, y: -0.57, pmx: 120, pmy: -22, m: 2.2 },
  { x: 11.82, y: -6.19, pmx: -121, pmy: -15, m: 1.9 },
];

const DRIFT = `
#include <common>
#include <color>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime;
uniform vec2 uNow[7], uThen[7];
uniform float uMag[7], uLines, uGhost, uTrail;
// Distance to the segment a-b (x) and how far along it the nearest point is, 0..1 (y).
vec2 seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = saturate(dot(pa, ba) / dot(ba, ba)); return vec2(length(pa - ba * h), h); }
void main() {
  vec2 p = centered(vUv, uAspect);
  float px = 1.0 / uRes.y;
  vec3 col = vec3(0.0);
  // The figure as a star chart draws it: hair lines that stop short of the stars. Under it,
  // dotted, the shape we know today.
  int A[7] = int[7](0, 1, 2, 3, 4, 5, 3);
  int B[7] = int[7](1, 2, 3, 4, 5, 6, 0);
  float ln = 0.0, gh = 0.0;
  for (int i = 0; i < 7; i++) {
    vec2 a = uNow[A[i]], b = uNow[B[i]];
    vec2 d = seg(p, a, b);
    float len = length(b - a);
    float gap = smoothstep(0.011, 0.016, d.y * len) * smoothstep(0.011, 0.016, (1.0 - d.y) * len);
    ln += exp(-pow(d.x / (px * 1.0), 2.0)) * gap;
    a = uThen[A[i]]; b = uThen[B[i]];
    d = seg(p, a, b);
    len = length(b - a);
    float dots = smoothstep(0.35, 0.5, abs(fract(d.y * len / 0.011) - 0.5) * 2.0);
    gh += exp(-pow(d.x / (px * 1.0), 2.0)) * (1.0 - dots);
  }
  col += vec3(0.5, 0.65, 0.95) * min(ln, 1.0) * 0.3 * uLines;
  col += vec3(0.85, 0.72, 0.5) * min(gh, 1.0) * 0.16 * uGhost;
  for (int i = 0; i < 7; i++) {
    vec2 q = p - uNow[i];
    float d = length(q);
    float b = pow(2.512, -(uMag[i] - 1.5)) * 6.0;
    vec3 tint = blackbody(i == 0 ? 4700.0 : 9500.0);
    // The path each star has travelled, fading back towards where it began.
    vec2 tr = seg(p, uThen[i], uNow[i]);
    col += tint * exp(-pow(tr.x / (px * 1.2), 2.0)) * tr.y * tr.y * 0.1 * b * uTrail;
    // The star: a point, a little glare, and a fine four-pointed glint.
    float sig = px * 1.3;
    float glint = (exp(-abs(q.y) / (px * 0.8)) * exp(-abs(q.x) / (px * 9.0)) + exp(-abs(q.x) / (px * 0.8)) * exp(-abs(q.y) / (px * 9.0))) * 0.05;
    col += tint * b * (exp(-d * d / (2.0 * sig * sig)) + exp(-d / (px * 5.0)) * 0.05 + glint);
  }
  fragColor = vec4(col, 1.0);
}`;

// Field stars wander too, each trailing the last third of its journey like a long exposure.
// The trail is drawn inside the star's own sprite: the vertex hook enlarges the quad to hold it
// (and keeps the star's flux), the fragment hook draws the point and the fading streak behind it.
const WANDER = `
uniform float uYears;
const float RATE = 6e-7;       // radians per year for a star of unit proper motion
const float TRAIL = 0.32;      // the fraction of its journey a star trails behind it
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  vec3 n = normalize(p);
  vec3 u = normalize(cross(n, vec3(0.0, 1.0, 0.0)));
  vec3 v = cross(u, n);
  vec3 q = normalize(n + (u * x.x + v * x.y) * uYears * RATE) * length(p);
  float pxPerRad = uProj[1][1] * uRes.y * 0.5;
  float z = -(uView * vec4(q + uCamPos * uSkyFollow, 1.0)).z;
  float own = size / z * pxPerRad;                       // the star's own sigma in pixels
  float trail = length(x.xy) * uYears * RATE * TRAIL * pxPerRad;
  col *= min(own * own / (uMinPx * uMinPx), 1.0);
  size = max((trail + 6.0 * uMinPx) / uExtent, uMinPx) * z / pxPerRad;
  return q;
}`;
const WANDER_SHADE = `
uniform float uYears, uMinPx, uExtent;
uniform mat4 uProj;
uniform vec2 uRes;
const float RATE = 6e-7;
const float TRAIL = 0.32;
vec4 shade(vec2 q, vec3 col, vec4 x) {
  float trail = length(x.xy) * uYears * RATE * TRAIL * uProj[1][1] * uRes.y * 0.5;
  vec2 p = q * max((trail + 6.0 * uMinPx) / uExtent, uMinPx);   // pixels from the star
  float s2 = uMinPx * uMinPx;
  float g = exp(-0.5 * dot(p, p) / s2);
  if (trail > 0.5) {
    vec2 dir = normalize(x.xy);
    float along = -dot(p, dir), across = dot(p, vec2(-dir.y, dir.x));
    float h = saturate(along / trail);
    // The streak carries about half the star's light, brightest just behind it.
    g += step(0.0, along) * (1.0 - h) * (1.0 - h) * exp(-0.5 * across * across / s2) * min(3.8 * uMinPx / trail, 0.6);
  }
  return vec4(col * g, g);
}`;

function drift(): Shot<{ sky: Sprites; cam: Camera }> {
  return {
    ...span('drift', { dIn: 1.0, dOut: 1.0 }),
    setup(e) {
      // Most stars are far away and barely move in a hundred thousand years; the few near ones
      // cross the sky.
      const r = rng(228);
      const d = starSphere(r, { count: 16000, brightness: 0.4 });
      for (let i = 0; i < d.count; i++) {
        const near = 0.2 + 2.8 * Math.pow(r.next(), 5);
        d.extra!.set([r.gauss() * near, r.gauss() * near, 0, 0], i * 4);
      }
      return { sky: new Sprites(e, d, { animate: WANDER, shade: WANDER_SHADE }), cam: new Camera({ fov: 40 }) };
    },
    render(c, s) {
      const t = c.time - beat('drift').start;
      const years = keys(t, [[-0.5, 0], [0.8, 0], [6.2, 120000, 'inOutSine']]);
      const scale = 0.017; // screen units per degree
      const now = DIPPER.map((st) => [(st.x + (st.pmx * years) / 3.6e6) * scale, (st.y + (st.pmy * years) / 3.6e6) * scale + 0.04]).flat();
      const then = DIPPER.map((st) => [st.x * scale, st.y * scale + 0.04]).flat();
      s.cam.set({ pos: [0, 0, 0], target: [0, 0.1, -1] });
      s.sky.draw(s.cam, c.time, { uYears: years }, { sky: true, brightness: 0.7 });
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE);
      c.fullscreen(c.e.program(DRIFT, 'drift'), {
        uNow: now,
        uThen: then,
        uMag: DIPPER.map((st) => st.m),
        uLines: prog(t, 0.0, 1.0, 'inOutSine'),
        uGhost: prog(t, 1.5, 3.0, 'inOutSine'),
        uTrail: prog(t, 1.2, 3.0, 'inOutSine'),
      });
      c.gl.disable(c.gl.BLEND);
    },
  };
}

// ------------------------------------------------------------------ Earth's oceans boil away
function hotEarth(): Shot<{ planet: Planet; cam: Camera; sky: Sprites }> {
  return {
    ...span('hotearth', { dIn: 1.0, dOut: 1.0 }),
    async setup(e) {
      const maps = await loadEarth(e);
      return { planet: new Planet(e, maps), cam: new Camera({ fov: 32 }), sky: new Sprites(e, starSphere(rng(234), { count: 8000, brightness: 0.3 })) };
    },
    render(c, s) {
      const t = c.time - beat('hotearth').start;
      const k = prog(t, 0.3, 6.3, 'inOutSine');
      s.cam.set({ pos: [0.2, 0.3, keys(t, [[-1, 4.0], [7, 3.6]])], target: [-0.75, 0.1, 0] });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      s.planet.draw(c, s.cam, {
        center: [0, 0, 0], radius: 1, yaw: -0.6 - t * 0.02, spin: 0, tilt: 0.35, sunDir: [-0.65, 0.3, 0.7],
        sunColor: [1.7 + 0.5 * k, 1.6 + 0.4 * k, 1.45 + 0.2 * k], earth: 1, desert: k, retreat: 0.02 + 0.85 * k,
        clouds: 0.4 * (1 - k), cloudT: 0.9 + c.time * 0.01, atmo: 0.9 - 0.4 * k, atmoColor: [0.3 + 0.6 * k, 0.55 + 0.2 * k, 1.0 - 0.5 * k],
        haze: 0.25 * k, hazeColor: [0.95, 0.75, 0.55], glint: 0.8,
      });
    },
  };
}

// ------------------------------------------------------------------ red giant
// The Sun as a red giant, ray-traced in AU (film/shaders/giant.glsl): giant convection cells
// boiling on a strongly limb-darkened surface under an extended atmosphere of plumes and wind.
// First it swells past the orbits of Mercury and Venus (each flares as it is swallowed); then
// the view from a scorched, dried-out Earth, silhouetted against a star that fills half the sky
// from 1.3 AU. The star is rendered in AU with the same camera orientation as the Earth-scale
// camera, so they composite.
const GIANT = '#include <arrow-of-time/giant>';

const ORBITS = { mercury: 0.39, venus: 0.72, earth: 1.3 };
/** The star's radius (AU) during the swell: past Mercury's orbit, then Venus's. */
const giantR = (t: number) => keys(t, [[-1, 0.26], [0.2, 0.28], [3.6, 1.0, 'inOutSine'], [9, 1.06]]);

/** The inner planets during the swell: to the camera's left of the star, a little in front of it. */
const INNER: Vec3[] = [
  v3.scale(v3.norm([-0.9, 0.05, 0.42]), ORBITS.mercury),
  v3.scale(v3.norm([-0.93, -0.04, 0.36]), ORBITS.venus),
  v3.scale(v3.norm([-0.95, 0.03, 0.3]), ORBITS.earth),
];
/** When the surface reaches each of them (seconds into the beat); Earth survives. */
const SWALLOWED = INNER.map((q, i) => {
  if (i === 2) return Infinity;
  let lo = 0, hi = 9;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (giantR(mid) < v3.len(q)) lo = mid;
    else hi = mid;
  }
  return hi;
});

function redGiantSwell(): Shot<{ cam: Camera; sky: Sprites }> {
  const b = beat('redgiant');
  return {
    id: 'redgiant-swell',
    start: b.start - 0.5,
    end: b.start + 3.7,
    fadeIn: 1.0,
    fadeOut: 0.8,
    setup: (e) => ({ cam: new Camera({ fov: 40, far: 100 }), sky: new Sprites(e, starSphere(rng(240), { count: 9000, brightness: 0.3 })) }),
    render(c, s) {
      const t = c.time - b.start;
      s.cam.set({
        pos: [keys(t, [[-1, -1.3], [4, -1.0]]), 0.45, keys(t, [[-1, 3.0], [4, 3.3]])],
        target: [keys(t, [[-1, -0.25], [4, -0.05]]), 0.0, 0.0],
      });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      const R = giantR(t);
      const flash = SWALLOWED.map((tE) => (t > tE ? Math.exp(-(t - tE) * 3.2) : 0));
      const uPl = INNER.flatMap((q, i) => [...q, t > SWALLOWED[i] ? 0 : [0.008, 0.013, 0.014][i]]);
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE_MINUS_SRC_ALPHA);
      c.fullscreen(c.e.program(GIANT, 'giant'), { ...s.cam.uniforms(), uStar: [0, 0, 0], uR: R, uHeat: 1.0, uDetail: 1, uAtmo: 1, uTurn: 0, uPl, uFlash: flash });
      c.gl.disable(c.gl.BLEND);
    },
  };
}

function redGiantEarth(): Shot<{ planet: Planet; cam: Camera; starCam: Camera; maps: EarthMaps }> {
  const b = beat('redgiant');
  // Earth at 1.3 AU; the star, 1 AU in radius, fills half the sky. The view is past Earth's
  // night side, toward the star's limb: Earth in silhouette against the boiling surface.
  const earthAU: Vec3 = [ORBITS.earth, 0, 0];
  const toStar = v3.norm(v3.scale(earthAU, -1));
  return {
    id: 'redgiant-earth',
    start: b.start + 3.1,
    end: b.end + 0.5,
    fadeIn: 0.9,
    fadeOut: 1.0,
    async setup(e) {
      const maps = await loadEarth(e);
      return { maps, planet: new Planet(e, maps), cam: new Camera({ fov: 42 }), starCam: new Camera({ fov: 42, far: 100 }) };
    },
    render(c, s) {
      const t = c.time - b.start - 3.1;
      // Earth-scale camera (Earth radius 1): behind and to the side of Earth, looking starward.
      // Look 43 degrees off the star's centre: its limb crosses just left of centre, and Earth
      // (shifted left and a little down on screen) sits on the limb, half against the star.
      const dist = keys(t, [[0, 6.2], [5.5, 5.3, 'inOutSine']]);
      const fwd = v3.norm(v3.add(toStar, [0, 0, Math.tan((43 * Math.PI) / 180)]));
      s.cam.set({ pos: v3.scale(fwd, -dist), target: [0, 0, 0], up: [0, 1, 0], roll: 0.04 });
      const { right, up } = s.cam.basis();
      const pos = v3.add(v3.scale(fwd, -dist), v3.add(v3.scale(right, dist * 0.16), v3.scale(up, dist * 0.06)));
      s.cam.set({ pos, target: v3.add(pos, fwd), up: [0, 1, 0], roll: 0.04 });
      // The star is drawn from Earth's position in AU with the same orientation.
      s.starCam.set({ pos: earthAU, target: v3.add(earthAU, fwd), up: [0, 1, 0], roll: 0.04 });
      s.starCam.aspect = c.aspect;
      c.fullscreen(c.e.program(GIANT, 'giant'), {
        ...s.starCam.uniforms(), uStar: [0, 0, 0], uR: giantR(t + 3.1), uHeat: 1.8, uDetail: 2.2, uAtmo: 0.45, uTurn: 0.9,
        uPl: new Array(12).fill(0), uFlash: [0, 0, 0],
      });
      s.planet.draw(c, s.cam, {
        center: [0, 0, 0], radius: 1, spin: c.time * 0.03, tilt: 0.41, yaw: 2.2, sunDir: toStar,
        // Seen from behind: a black disc veined with the glow of its melting crust, ringed by
        // what is left of its air catching the star's light all the way round the limb.
        sunColor: [2.6, 1.0, 0.42], earth: 1, desert: 1, retreat: 1, lava: 0.6, crust: 0.8,
        nightGlow: 0.3, atmo: 0.7, atmoColor: [0.75, 0.6, 0.5], atmoHeight: 0.02, glint: 0,
      });
    },
  };
}

// ------------------------------------------------------------------ planetary nebula and white dwarf
// The nebula is a volume (film/shaders/pneb.glsl) marched at reduced resolution; the composite
// adds it to the sky at full resolution with the white dwarf, which is far smaller than a pixel:
// a point, a little glare, and the faint cross a telescope's struts would give it.
const PNEB_COMPOSITE = `
#include <common>
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uRes, uStarAt;
uniform float uAspect, uStar;
void main() {
  vec3 col = texture(uSrc, vUv).rgb;
  vec2 p = centered(vUv, uAspect) - uStarAt;
  float px = 1.0 / uRes.y;
  float r = length(p);
  float core = exp(-r * r / (2.8 * px * px)) * 60.0 + exp(-r / (px * 5.0)) * 1.2 + exp(-r / 0.02) * 0.1;
  vec2 q = rot2(0.5) * p;
  float cross = exp(-abs(q.y) / (px * 0.9)) * exp(-abs(q.x) / 0.035) + exp(-abs(q.x) / (px * 0.9)) * exp(-abs(q.y) / 0.035);
  col += vec3(0.72, 0.84, 1.0) * (core + cross * 1.6) * uStar;
  fragColor = vec4(col, 1.0);
}`;

function whiteDwarf(): Shot<{ half: RenderTarget; cam: Camera; sky: Sprites }> {
  return {
    ...span('whitedwarf', { dIn: 1.0, dOut: 1.0 }),
    setup: (e) => ({ half: scratch(e, 0.75), cam: new Camera({ fov: 38 }), sky: new Sprites(e, starSphere(rng(248), { count: 8000, brightness: 0.3 })) }),
    render(c, s) {
      const t = c.time - beat('whitedwarf').start;
      // The shell is still spreading as we arrive, and slows.
      const expand = keys(t, [[-0.5, 0.6], [6.5, 1.0, 'outQuad']]);
      const az = 0.6 + t * 0.05;
      const el = 0.74;
      const dist = 4.7;
      // Nebula right of centre: the caption sits at lower left.
      s.cam.aspect = c.aspect;
      s.cam.set({ pos: [Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist], target: [0, 0, 0] }).pan(-1.0, 0.03);
      s.half.bind();
      c.fullscreen(c.e.program('#include <arrow-of-time/pneb>', 'pnebula'), { ...s.cam.uniforms(), uExpand: expand, uGain: 1.0 });
      c.target.bind();
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      const at = s.cam.project([0, 0, 0]);
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE);
      c.fullscreen(c.e.program(PNEB_COMPOSITE, 'pnebula.composite'), { uSrc: s.half, uStarAt: [(at.x - 0.5) * c.aspect, at.y - 0.5], uStar: 1.0 });
      c.gl.disable(c.gl.BLEND);
    },
  };
}

export function futureShots(): Shot[] {
  return [turn(), mars(), drift(), hotEarth(), redGiantSwell(), redGiantEarth(), whiteDwarf(), ...endShots()];
}

/**
 * Look overrides for this file's beats (bloom, streak, exposure, grade...), merged last in
 * project.ts. Return {} outside them so other shots keep the film's look.
 */
export function futureLook(time: number): Partial<Look> {
  // The white dwarf draws its own diffraction cross: keep the anamorphic streak faint beside it
  // (the film's look has it off until a second into the beat, and back up for the merger).
  const wd = beat('whitedwarf');
  if (time > wd.start + 1 && time < wd.end + 0.5) return { streak: keys(time, [[wd.start + 1, 0], [wd.start + 2, 0.03], [wd.end - 0.5, 0.03], [wd.end + 0.5, 0.09]]) };
  return {};
}
