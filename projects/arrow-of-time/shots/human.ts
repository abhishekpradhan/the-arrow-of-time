// Act V: mammals, the first people, cave art, civilization, the space race (the ascent, Sputnik in
// orbit, the Moon landing), Earth at night, NOW.
import { Camera, Sprites, allocSprites, keys, m4, prog, rng, starSphere, type Mat4, type Shot, type Vec3 } from '@engine';
import { beat, cues, span, timeline } from '../lib';
import { civilization } from './civilization';
import { moonLanding } from './apollo';
import { sputnik } from './sputnik';
import { ascent } from './ascent';
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

// ------------------------------------------------------------------ Homo sapiens: dusk on the savanna
// shaders/humans.glsl: a glowing dusk over the rift, giraffes and acacias, a band round a fire on a
// granite kopje, and a meteor that one of them stands up to watch.
function humans(): Shot {
  return {
    ...span('humans', { dIn: 1.0, dOut: 1.0 }),
    render(c) {
      const t = c.time - beat('humans').start;
      c.fullscreen(c.e.program('#include <arrow-of-time/humans>', 'humans'), {
        uT: t,
        uPan: keys(t, [[-1, -0.03], [9, 0.05, 'inOutSine']]),
        uElev: keys(t, [[-1, -2.2], [9, -5.5, 'inOutSine']]),
      });
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
  return [mammals(), humans(), caves(), civilization(), ascent(), sputnik(), moonLanding(), nightEarth(), now()];
}
