// Act V: mammals, the first people, cave art, civilization, the space race (the ascent, Sputnik in
// orbit, the Moon landing), Earth at night, NOW.
import { Camera, Sprites, allocSprites, keys, m4, prog, rng, starSphere, type Look, type Mat4, type Shot, type Vec3 } from '@engine';
import { beat, cues, span, timeline } from '../lib';
import { civilization } from './civilization';
import { moonLanding } from './apollo';
import { sputnik, sputnikMoon } from './sputnik';
import { ascent } from './ascent';
import { Planet, loadEarth, type EarthMaps } from '@engine';
import { PALE_BLUE_DOT } from './end';

const latLon = (lat: number, lon: number): Vec3 => {
  const a = (lat * Math.PI) / 180, o = (lon * Math.PI) / 180;
  return [Math.cos(a) * Math.sin(o), Math.sin(a), Math.cos(a) * Math.cos(o)];
};

// ------------------------------------------------------------------ the age of mammals
// shaders/mammals.glsl: the first clear dawn after the impact winter. The Sun rises through
// the mist of a dead forest with a new one coming up under it; a small mammal watches from a
// fallen trunk.
const MAMMALS_HY = -0.115;
function mammalsLight(time: number) {
  const t = time - beat('mammals').start;
  const dawn = prog(t, -0.6, 5.2, 'inOutSine');
  const pan = keys(t, [[-1, -0.02], [7, 0.035, 'inOutSine']]);
  return { t, dawn, pan, sun: [-0.42, MAMMALS_HY - 0.03 + 0.105 * dawn] as [number, number], elev: -2.5 + 9 * dawn };
}

function mammals(): Shot {
  return {
    ...span('mammals', { dIn: 1.2, dOut: 1.0 }),
    render(c) {
      const m = mammalsLight(c.time);
      c.fullscreen(c.e.program('#include <arrow-of-time/mammals>', 'mammals'), { uT: m.t, uDawn: m.dawn, uPan: m.pan, uSun: m.sun, uElev: m.elev });
    },
  };
}

/** Light shafts from the rising Sun through the dead forest (merged into the look in project.ts). */
export function mammalsLook(time: number): Partial<Look> {
  const b = beat('mammals');
  if (time < b.start - 0.6 || time > b.end + 0.5) return {};
  const m = mammalsLight(time);
  const amt = 0.13 * m.dawn * keys(time, [[b.start - 0.6, 0], [b.start + 0.6, 1], [b.end - 0.5, 1], [b.end + 0.5, 0]]);
  // The far layers move a tenth as far as the camera pans: so does the Sun.
  return { rays: amt, raysCenter: [(m.sun[0] - m.pan * 0.05) / (16 / 9) + 0.5, m.sun[1] + 0.5], raysThreshold: 3.2, raysDecay: 0.97, raysTint: [1.0, 0.82, 0.6] };
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
  [59.3, 18.1], [50.1, 8.7], [45.5, 9.2], [38.0, 23.7], [33.6, -7.6], [36.8, 10.2], [9.0, 38.7], [-4.3, 15.3],
  [5.6, -0.2], [14.7, -17.5], [-33.9, 18.4], [-6.8, 39.3], [24.7, 46.7], [35.7, 51.4], [24.9, 67.0], [23.8, 90.4],
  [13.0, 77.6], [41.3, 69.2], [60.2, 24.9], [53.3, -6.3], [38.7, -9.1], [15.6, 32.5], [33.3, 44.4], [-18.9, 47.5],
  [43.2, 76.9], [-8.8, 13.2], [12.6, -8.0], [64.1, -21.9], [-34.6, -58.4], [21.0, 105.8],
];

/**
 * Air routes between the cities: every pair within reach has a chance, the busiest hubs (the
 * first cities in the list) a better one. Each is a great-circle arc drawn as a thread of
 * sprites close enough together to read as a hairline.
 */
function arcData() {
  const r = rng(202);
  const SIGMA = 0.0011;
  const routes: { A: Vec3; B: Vec3; om: number }[] = [];
  for (let a = 0; a < CITIES.length; a++)
    for (let b = a + 1; b < CITIES.length; b++) {
      const A = latLon(...CITIES[a]), B = latLon(...CITIES[b]);
      const om = Math.acos(Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
      const hub = (a < 8 ? 2.2 : 1) * (b < 24 ? 1.4 : 1);
      if (om > 0.1 && om < 1.7 && r.next() < 0.034 * hub) routes.push({ A, B, om });
    }
  const counts = routes.map((q) => Math.ceil(q.om / SIGMA));
  const d = allocSprites(counts.reduce((x, y) => x + y, 0));
  let i = 0;
  routes.forEach(({ A, B, om }, k) => {
    const delay = r.range(0, 4.2), seed = r.next();
    const per = counts[k];
    for (let j = 0; j < per; j++) {
      const s = j / (per - 1);
      const sa = Math.sin((1 - s) * om) / Math.sin(om), sb = Math.sin(s * om) / Math.sin(om);
      const alt = 1.003 + 0.02 * om * Math.sin(Math.PI * s);
      d.position.set([(A[0] * sa + B[0] * sb) * alt, (A[1] * sa + B[1] * sb) * alt, (A[2] * sa + B[2] * sb) * alt], i * 3);
      d.color.set([0.1, 0.15, 0.22], i * 3);
      d.size[i] = SIGMA;
      d.extra!.set([s, delay, om, seed], i * 4);
      i++;
    }
  });
  return d;
}

function nightEarth(): Shot<{ planet: Planet; cam: Camera; sky: Sprites; arcs: Sprites }> {
  return {
    ...span('nightearth', { dIn: 3.0, dOut: 0 }),
    async setup(e) {
      const maps = await loadEarth(e);
      return {
        planet: new Planet(e, maps),
        cam: new Camera({ fov: 34 }),
        sky: new Sprites(e, starSphere(rng(203), { count: 8000, brightness: 0.3 })),
        arcs: new Sprites(e, arcData(), {
          // Each route draws itself out from its origin as a faint thread, then carries
          // aircraft: points of light that run along it, there and back.
          animate: `
            uniform mat4 uRot; uniform float uReveal;
            vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
              float head = (uReveal - x.y) * 0.55 / max(x.z, 0.25);
              float vis = smoothstep(x.x - 0.04, x.x, head);
              float lead = exp(-abs(head - x.x) * 16.0 * x.z);
              float ph = fract(uReveal * (0.035 + 0.03 * x.w) / max(x.z, 0.25) + x.w * 7.0);
              float plane = exp(-pow((x.x - abs(2.0 * ph - 1.0)) * x.z * 150.0, 2.0)) * smoothstep(0.0, 0.3, head - 1.0 + 0.3);
              col = col * vis * (0.42 + 1.6 * lead) + vec3(1.0, 0.93, 0.8) * plane * 0.16 * vis;
              size *= 1.0 + 0.7 * plane;
              return (uRot * vec4(p, 1.0)).xyz;
            }`,
          minPixels: 0.75,
        }),
      };
    },
    render(c, s) {
      const t = c.time - beat('nightearth').start;
      const yaw = (-30 * Math.PI) / 180 - t * 0.012;
      // Coming in from the Moon's Earth through the dissolve, then settling.
      s.cam.set({ pos: [0.2, 0.9, keys(t, [[-1.5, 3.3], [7, 2.55, 'outSine']])], target: [0.05, 0.38, 0] });
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
// The sunbeams are the epilogue's (end.ts), which comes back to this frame: Voyager's fan of
// scattered light, with the Earth in its brightest ray.
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
      c.fullscreen(c.e.program(PALE_BLUE_DOT, 'palebluedot'), { uAmt: prog(t, 0.8, 5.0, 'inOutSine'), uWarm: 0, uDot: 0, uDotPos: [0, 0] });
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
  return [mammals(), humans(), caves(), civilization(), ascent(), sputnik(), sputnikMoon(), moonLanding(), nightEarth(), now()];
}
