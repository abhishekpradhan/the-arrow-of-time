// Act II: dark ages -> first stars -> galaxies (one continuous flight through the cosmic web)
// and on into one of them, the Milky Way: the same galaxy and the same camera carry across the
// dissolve between the two shots.
import {
  Camera,
  Galaxy,
  Sprites,
  allocSprites,
  blackbody,
  keys,
  prog,
  rng,
  starSphere,
  v3,
  volumeTexture,
  type Engine,
  type RenderTarget,
  type Shot,
  type SpriteData,
  type Texture,
  type Vec3,
} from '@engine';
import type { Look } from '@engine';
import { beat, scratch, span, timeline } from '../lib';

// ------------------------------------------------------------ cosmic web volume
const N = 112; // voxels per side
const CELLS = 5; // Voronoi cells per side (periodic)

/** Periodic cosmic-web density: bright filaments where three Voronoi cells meet, faint walls. */
function buildWeb(seed: number) {
  const r = rng(seed);
  const pts: Vec3[] = [];
  for (let i = 0; i < CELLS ** 3; i++) pts.push([r.next(), r.next(), r.next()]);
  const data = new Uint8Array(N * N * N);
  const dens = new Float32Array(N * N * N);
  for (let z = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const px = ((x + 0.5) / N) * CELLS, py = ((y + 0.5) / N) * CELLS, pz = ((z + 0.5) / N) * CELLS;
        const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
        let f1 = 9, f2 = 9, f3 = 9;
        for (let k = -1; k <= 1; k++)
          for (let j = -1; j <= 1; j++)
            for (let i = -1; i <= 1; i++) {
              const gx = cx + i, gy = cy + j, gz = cz + k;
              const w = (((gx % CELLS) + CELLS) % CELLS) + CELLS * ((((gy % CELLS) + CELLS) % CELLS) + CELLS * (((gz % CELLS) + CELLS) % CELLS));
              const q = pts[w];
              const dx = gx + q[0] - px, dy = gy + q[1] - py, dz = gz + q[2] - pz;
              const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (d < f1) { f3 = f2; f2 = f1; f1 = d; }
              else if (d < f2) { f3 = f2; f2 = d; }
              else if (d < f3) f3 = d;
            }
        const fil = Math.exp(-Math.pow((f3 - f1) / 0.16, 2));
        const wall = Math.exp(-Math.pow((f2 - f1) / 0.1, 2));
        const node = Math.exp(-Math.pow((f3 - f1) / 0.07, 2)) * Math.exp(-f1 * 1.2);
        const v = Math.min(1, fil * 0.75 + wall * 0.12 + node * 0.6);
        const idx = x + N * (y + N * z);
        dens[idx] = v;
        data[idx] = Math.round(v * 255);
      }
  return { data, dens };
}

function sampleDens(dens: Float32Array, p: Vec3) {
  const w = (v: number) => ((Math.floor(v * N) % N) + N) % N;
  return dens[w(p[0]) + N * (w(p[1]) + N * w(p[2]))];
}

const WEB = `
#include <common>
#include <camera>
in vec2 vUv; out vec4 fragColor;
uniform sampler3D uVol;
uniform vec2 uRes; uniform float uAspect, uGTime;
uniform float uGlow, uMarch, uGas;
uniform vec3 uColA, uColB;
void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  // The jitter changes every sub-frame, so it averages out under motion blur and what is
  // left of it reads as grain.
  float jitter = hash12(gl_FragCoord.xy + 37.0 * fract(uGTime * 13.7));
  const int STEPS = 64;
  float stepLen = uMarch / float(STEPS);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + jitter) * stepLen + 0.02;
    vec3 pos = uCamPos + rd * t;
    float d = texture(uVol, pos).r;
    float fade = exp(-t * 1.9) * smoothstep(0.02, 0.12, t);
    float d2 = d * d;
    vec3 c = mix(uColA, uColB, smoothstep(0.35, 0.95, d));
    acc += c * (d2 + uGas * d2 * d2 * 1.2) * fade * stepLen;
  }
  fragColor = vec4(acc * uGlow, 1.0);
}`;

const WEB_COMPOSITE = `
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uSrc;
void main() { fragColor = vec4(texture(uSrc, vUv).rgb, 1.0); }`;

const OBJ_ANIMATE = `
uniform float uStarVis, uGalVis;
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  float age = uTime - x.x;
  if (x.w < 0.5) {
    float on = smoothstep(0.0, 0.06, age);
    float flash = age > 0.0 ? exp(-age * 2.4) * (x.y > 0.5 ? 12.0 : 4.0) : 0.0;
    float settle = mix(1.0, 0.55, smoothstep(0.0, 4.0, age));
    col *= on * (settle + flash) * uStarVis;
    size *= 1.0 + min(flash, 8.0) * 0.35;
  } else {
    col *= uGalVis * smoothstep(0.0, 1.8, age);
  }
  return p;
}`;

const OBJ_SHADE = `
vec4 shade(vec2 q, vec3 col, vec4 x) {
  if (x.w < 0.5) {
    float g = exp(-0.5 * dot(q, q));
    return vec4(col * g, g);
  }
  // A small galaxy, one of three kinds: a warm spheroid, a clumpy blue irregular (most
  // galaxies this early are still assembling) or an inclined disk with soft arms.
  vec2 u = rot2(x.z * TAU) * q / 3.0;
  float kind = fract(x.z * 3.7);
  u.y /= 0.25 + 0.75 * fract(x.z * 7.31);
  float r = length(u);
  float edge = smoothstep(1.0, 0.6, r);
  vec3 c;
  float a;
  if (kind < 0.25) {
    a = exp(-r * 7.0) * 1.1 + exp(-r * r * 120.0) * 1.6;
    c = col * a * vec3(1.0, 0.82, 0.58);
  } else if (kind < 0.6) {
    a = exp(-r * 6.0) * 0.5;
    for (int i = 0; i < 4; i++) {
      vec2 h = hash22(vec2(x.z * 91.0 + float(i) * 7.0, 3.1 + float(i)));
      vec2 d = u - (h - 0.5) * 0.5;
      float sz = 0.05 + 0.11 * fract(h.x * 13.0);
      a += exp(-dot(d, d) / (sz * sz)) * (0.5 + h.y);
    }
    c = col * a * vec3(0.66, 0.8, 1.0);
  } else {
    float th = atan(u.y, u.x);
    float arms = 0.5 + 0.5 * cos(2.0 * (th - log(r + 0.06) * 2.4) + x.z * 40.0);
    float disk = exp(-r * 5.0) * (0.5 + 0.8 * arms * arms);
    float core = exp(-r * r * 80.0) * 1.5;
    a = disk + core;
    c = col * (disk * vec3(0.7, 0.82, 1.0) + core * vec3(1.0, 0.84, 0.6));
  }
  return vec4(c * edge, saturate(a) * edge);
}`;

interface WebState {
  vol: Texture;
  half: RenderTarget;
  objs: Sprites;
  sky: Sprites;
  cam: Camera;
  path: (t: number) => { pos: Vec3; target: Vec3 };
  galaxy: Galaxy;
  gcam: Camera;
}

// ------------------------------------------------------------ the flight to our galaxy
const B_DARK = beat('darkages'), B_GAL = beat('galaxies'), B_MW = beat('milkyway');
/** The galaxy we fly into, in the web's coordinates, and its radius there. */
const HERO: Vec3 = [0.42, 0.33, -1.06];
const RHO = 0.036;
const WEB_START: Vec3 = [0.13, 0.27, 0.05];
const WEB_LEN = v3.len(v3.sub(HERO, WEB_START));
const WEB_DIR = v3.norm(v3.sub(HERO, WEB_START));
/** How far along the line to the galaxy the camera is: a slow drift through the dark, then accelerating. */
const webTravel = (t: number) => keys(t, [[B_DARK.start - 1, 0], [64, 0.42, 'linear'], [70.4, 0.98, 'inQuad']]) * WEB_LEN * 0.985;

/** Camera flight through the cosmic web, straight at the galaxy. */
function webPath(t: number) {
  const d = webTravel(t);
  const wob = (1 - prog(t, 62, 69, 'inOutSine')) * 0.03;
  const pos: Vec3 = [WEB_START[0] + WEB_DIR[0] * d + Math.sin(t * 0.21) * wob, WEB_START[1] + WEB_DIR[1] * d + Math.cos(t * 0.17) * wob, WEB_START[2] + WEB_DIR[2] * d];
  const look = prog(t, 58, 66, 'inOutSine');
  const target: Vec3 = [pos[0] + WEB_DIR[0] + (1 - look) * 0.25, pos[1] + WEB_DIR[1] + (1 - look) * 0.08, pos[2] + WEB_DIR[2]];
  return { pos, target };
}

const DEG = Math.PI / 180;

/**
 * Distance to the galaxy, in its radii. Until T_BRAKE it is the web camera's own distance (a
 * quarter of a second ahead of it, so the rush is over as the music lands); then the camera
 * brakes smoothly to its closest point, low over the edge of the disk, and drifts back out.
 */
const T_BRAKE = 69.8, T_LAND = 70.4, D_LAND = 1.8;
const approachDist = (t: number) => (WEB_LEN - webTravel(t + 0.25)) / RHO;
function galaxyDist(t: number) {
  if (t <= T_BRAKE) return approachDist(t);
  if (t >= T_LAND) return keys(t, [[T_LAND, D_LAND], [78.6, 2.55, 'inOutSine'], [80.6, 2.6]]);
  // A cubic that leaves the approach at its own speed and arrives at rest.
  const h = T_LAND - T_BRAKE, u = (t - T_BRAKE) / h;
  const d0 = approachDist(T_BRAKE), v0 = (d0 - approachDist(T_BRAKE - 0.01)) / 0.01;
  return (2 * u * u * u - 3 * u * u + 1) * d0 + (u * u * u - 2 * u * u + u) * h * v0 + (3 * u * u - 2 * u * u * u) * D_LAND;
}

/**
 * One camera for the whole approach, in the galaxy's own frame (disk radius 1, in the xz
 * plane), shared by the web shot and the Milky Way shot so the galaxy is the same picture in
 * both and the dissolve between them cannot be seen. It rushes in low over the edge of the
 * disk with the web camera, lands as the music arrives, then rises over the disk as it opens.
 */
function galaxyView(t: number): { pos: Vec3; target: Vec3; roll: number; fov: number } {
  const dist = galaxyDist(t);
  const el = keys(t, [[69.6, 13 * DEG], [79.6, 42 * DEG, 'inOutSine']]);
  const az = keys(t, [[69.6, 2.05], [80.6, 2.7, 'inOutSine']]);
  const roll = keys(t, [[69.6, 0.2], [79.6, 0.42, 'inOutSine']]);
  const fov = keys(t, [[69.4, 58], [73, 45, 'inOutSine']]);
  const cam = new Camera({ pos: v3.scale(v3.fromAngles(az, el), dist), target: [0, 0, 0], roll, fov });
  // Slide the galaxy left of centre as we arrive, and further as it shrinks, leaving the upper
  // right to the caption (and lift it a little at first, while its near side fills the bottom
  // of the frame).
  const arrive = prog(t, 69.2, 70.6, 'inOutSine');
  const aside = 0.05 + 0.05 * prog(t, 72.5, 78, 'inOutSine');
  cam.pan(aside * arrive * dist, -0.05 * arrive * (1 - prog(t, 70.8, 73.6, 'inOutSine')) * dist);
  return { pos: cam.pos, target: cam.target, roll, fov };
}

/** The galaxy turns slowly, its arms trailing. */
const galaxySpin = (t: number) => -0.02 * (t - B_MW.start);

/** Sub-frame samples for the rush into the galaxy (the rest of the flight is slow enough for one). */
const RUSH = (time: number) => (time > 69.0 && time < T_LAND + 0.05 ? 3 : 1);
/** Steps through the galaxy's disk: fewer in each of the rush's sub-frames, which average out. */
const galaxySteps = (time: number) => (RUSH(time) > 1 ? 18 : 40);

/** Both shots draw the same galaxy: one baked map between them. */
const galaxies = new WeakMap<Engine, Galaxy>();
function galaxyOf(e: Engine) {
  let g = galaxies.get(e);
  if (!g) galaxies.set(e, (g = new Galaxy(e, { seed: 70 })));
  return g;
}

function webShot(): Shot<WebState> {
  const b0 = B_DARK;
  const b1 = B_GAL;
  const path = webPath;
  return {
    id: 'web',
    start: b0.start - 0.6,
    end: b1.end + 0.7,
    fadeIn: 1.2,
    fadeOut: 1.4,
    motionBlur: RUSH,
    setup(e) {
      const { data, dens } = buildWeb(5);
      const vol = volumeTexture(e.gl, [N, N, N], data, { format: 'r8', wrap: 'repeat' });
      const r = rng(56);
      const cam = new Camera({ fov: 58, near: 0.001, far: 100 });
      // Stars along filaments near the flight path; the first 12 are synced to the score.
      const nStars = 1400, nGal = 2600;
      const d = allocSprites(nStars + nGal);
      let i = 0;
      const ign = timeline.starIgnitions;
      const place = (tries: number, pred: (p: Vec3) => boolean): Vec3 => {
        for (let k = 0; k < tries; k++) {
          const p: Vec3 = [r.range(-0.9, 1.3), r.range(-0.6, 1.2), r.range(-1.6, 0.1)];
          if (pred(p)) return p;
        }
        return [r.range(-0.9, 1.3), r.range(-0.6, 1.2), r.range(-1.6, 0.1)];
      };
      for (let k = 0; k < ign.length; k++) {
        // Hero stars: must be on a dense node and on screen at their ignition time.
        const at = ign[k];
        const { pos, target } = path(at);
        cam.set({ pos, target, aspect: 16 / 9 });
        const p = place(40000, (q) => {
          if (sampleDens(dens, q) < 0.55) return false;
          const pr = cam.project(q);
          const dist = Math.hypot(q[0] - pos[0], q[1] - pos[1], q[2] - pos[2]);
          return pr.visible && dist > 0.12 && dist < 0.6 && pr.x > 0.18 && pr.x < 0.82 && pr.y > 0.34 && pr.y < 0.8 &&
            Math.abs(pr.x - 0.5) + Math.abs(pr.y - 0.55) > 0.08;
        });
        const c = blackbody(r.range(14000, 22000));
        d.position.set(p, i * 3);
        d.color.set([c[0] * 2.4, c[1] * 2.4, c[2] * 2.4], i * 3);
        d.size[i] = 0.0016;
        d.extra!.set([at, 1, r.next(), 0], i * 4);
        i++;
      }
      for (let k = 0; k < nStars - ign.length; k++) {
        const p = place(400, (q) => sampleDens(dens, q) > 0.45);
        const T = r.range(9000, 25000);
        const c = blackbody(T);
        const bri = r.range(0.4, 1.6);
        d.position.set(p, i * 3);
        d.color.set([c[0] * bri, c[1] * bri, c[2] * bri], i * 3);
        d.size[i] = r.range(0.0006, 0.0012);
        d.extra!.set([r.range(56.3, 64.5), 0, r.next(), 0], i * 4);
        i++;
      }
      for (let k = 0; k < nGal; k++) {
        const p = place(400, (q) => sampleDens(dens, q) > 0.4);
        const bri = r.range(0.25, 0.9);
        d.position.set(p, i * 3);
        d.color.set([bri, bri, bri], i * 3);
        d.size[i] = r.range(0.0025, 0.006);
        d.extra!.set([r.range(62.5, 67), 0, r.next(), 1], i * 4);
        i++;
      }
      const objs = new Sprites(e, d, { animate: OBJ_ANIMATE, shade: OBJ_SHADE, minPixels: 0.7, maxPixels: 1200 });
      const sky = new Sprites(e, starSphere(rng(9), { count: 6000, brightness: 0.25 }));
      return { vol, half: scratch(e, 0.5), objs, sky, cam, path, galaxy: galaxyOf(e), gcam: new Camera({ near: 0.01, far: 100 }) };
    },
    render(c, s) {
      const t = c.time;
      const { pos, target } = s.path(t);
      s.cam.set({ pos, target });
      const lit = prog(t, 56, 64, 'inOutSine');
      const gal = prog(t, 63, 67, 'inOutSine');
      s.half.bind();
      c.fullscreen(c.e.program(WEB, 'web'), {
        ...s.cam.uniforms(),
        uVol: s.vol,
        uGlow: keys(t, [[49, 1.1], [55, 1.5], [60, 2.3], [66, 2.2], [70, 1.6]]),
        uMarch: 1.1,
        uGas: lit,
        uColA: [0.10 + 0.1 * lit, 0.04 + 0.12 * lit, 0.22 + 0.25 * lit],
        uColB: [0.45 + 0.3 * lit, 0.35 + 0.45 * lit, 0.9 + 0.2 * lit],
      });
      c.target.bind();
      c.fullscreen(c.e.program(WEB_COMPOSITE, 'web.comp'), { uSrc: s.half });
      s.sky.draw(s.cam, t, {}, { sky: true, brightness: 0.3 * lit });
      s.objs.draw(s.cam, t, { uStarVis: 1 - 0.45 * gal, uGalVis: 1 }, { blend: 'add' });
      // The galaxy we are flying to: young, blue and clumpy when it first shows, growing its
      // bulge, its old stars and its dust as it nears (billions of years pass on the way).
      const grown = prog(t, 65.5, 70.6, 'inOutSine');
      s.gcam.set(galaxyView(t));
      s.galaxy.draw(c, s.gcam, {
        spin: galaxySpin(t),
        fade: prog(t, 63.5, 65.5, 'inOutSine'),
        gain: [0.12 + 0.88 * grown, 1.7 - 0.7 * grown, 2.2 - 1.2 * grown, 0.2 + 0.8 * grown],
        dust: 0.3 + 0.9 * grown,
        stars: prog(t, 67.6, 68.8, 'inOutSine'),
        steps: galaxySteps(t),
      });
    },
  };
}

// ------------------------------------------------------------ the Milky Way
/** Faint galaxies far behind ours, for depth: tiny inclined disks and ellipticals on the sky. */
const FAR_SHADE = `
vec4 shade(vec2 q, vec3 col, vec4 x) {
  vec2 u = rot2(x.x * TAU) * q / 3.0;
  u.y /= x.y;
  float r = length(u);
  float th = atan(u.y, u.x);
  float arms = 0.5 + 0.5 * cos(2.0 * (th - log(r + 0.05) * 2.4) + x.x * 40.0);
  float disk = exp(-r * 5.5) * mix(1.0, 0.35 + 0.9 * arms * arms, x.z);
  float core = exp(-r * r * 90.0) * 1.4;
  float edge = smoothstep(1.0, 0.6, r);
  return vec4(col * (disk + core) * edge, 0.0);
}`;

function farGalaxies(seed: number, count: number): SpriteData {
  const r = rng(seed);
  const d = allocSprites(count);
  const R = 5000;
  for (let i = 0; i < count; i++) {
    const dir = r.onSphere();
    d.position.set([dir[0] * R, dir[1] * R, dir[2] * R], i * 3);
    // Most are specks; a few are near enough to show a shape.
    const size = 0.0012 + 0.012 * Math.pow(r.next(), 5);
    const warm = r.next();
    const bri = r.range(0.12, 0.4) * (0.004 / (size + 0.003));
    d.color.set([bri, bri * (0.78 + 0.2 * (1 - warm)), bri * (0.5 + 0.5 * (1 - warm))], i * 3);
    d.size[i] = size * R;
    d.extra!.set([r.next(), r.range(0.22, 1), r.next() < 0.6 ? 1 : 0, 0], i * 4);
  }
  return d;
}

/** A telescope's signature: the brightest stars carry a faint cross of diffraction spikes. */
const SPIKE_SHADE = `
vec4 shade(vec2 q, vec3 col, vec4 x) {
  q = rot2(0.3) * q;
  vec2 a = abs(q);
  float core = exp(-4.5 * dot(q, q));
  float halo = 0.03 / (1.0 + 3.0 * dot(q, q));
  float spikes = exp(-1.0 * a.x - 70.0 * a.y * a.y) + exp(-1.0 * a.y - 70.0 * a.x * a.x);
  float edge = smoothstep(3.0, 1.8, max(a.x, a.y));
  return vec4(col * (core + (halo + 0.2 * spikes) * edge), 0.0);
}`;

/** Bright sky stars for the spikes, kept out of the caption's corner for as long as it is up. */
function spikeStars(seed: number, count: number): SpriteData {
  const r = rng(seed);
  const d = allocSprites(count);
  const cam = new Camera({ near: 0.01, far: 1e5 });
  const R = 5000;
  for (let i = 0, tries = 0; i < count && tries < 20000; tries++) {
    const p = v3.scale(r.onSphere(), R);
    let clear = true;
    for (const t of [71.5, 73, 74.5, 76, 77.5, 79]) {
      cam.set(galaxyView(t));
      const pr = cam.project(v3.add(cam.pos, p));
      if (pr.visible && pr.x > 0.48 && pr.x < 0.98 && pr.y > 0.6 && pr.y < 0.92) clear = false;
    }
    if (!clear) continue;
    const c = blackbody(r.range(3800, 12000));
    const bri = r.range(0.8, 3.2);
    d.position.set(p, i * 3);
    d.color.set([c[0] * bri, c[1] * bri, c[2] * bri], i * 3);
    d.size[i] = R * r.range(0.0022, 0.0042);
    i++;
  }
  return d;
}

function milkyWay(): Shot<{ galaxy: Galaxy; sky: Sprites; faint: Sprites; far: Sprites; spikes: Sprites; cam: Camera }> {
  return {
    ...span('milkyway', { dIn: 1.4, dOut: 1.2 }),
    motionBlur: RUSH,
    setup(e) {
      return {
        galaxy: galaxyOf(e),
        sky: new Sprites(e, starSphere(rng(71), { count: 7500, brightness: 0.4 })),
        // A second, far more numerous population of faint stars gives the black its depth.
        faint: new Sprites(e, starSphere(rng(72), { count: 45000, brightness: 0.16, angularSize: 0.00025 }), { minPixels: 0.55 }),
        far: new Sprites(e, farGalaxies(73, 420), { shade: FAR_SHADE, minPixels: 0.8 }),
        spikes: new Sprites(e, spikeStars(74, 70), { shade: SPIKE_SHADE, minPixels: 2.5 }),
        // The sky is a sphere of radius 5000: the far plane must lie beyond it.
        cam: new Camera({ near: 0.01, far: 1e5 }),
      };
    },
    render(c, s) {
      s.cam.set(galaxyView(c.time));
      s.faint.draw(s.cam, c.time, {}, { sky: true });
      s.far.draw(s.cam, c.time, {}, { sky: true });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      s.galaxy.draw(c, s.cam, { spin: galaxySpin(c.time), dust: 1.2, steps: galaxySteps(c.time) });
      s.spikes.draw(s.cam, c.time, {}, { sky: true });
    },
  };
}

export function dawnShots(): Shot[] {
  return [webShot(), milkyWay()];
}

/**
 * Look overrides for this file's beats (bloom, streak, exposure, grade...), merged last in
 * project.ts. Return {} outside them so other shots keep the film's look.
 */
export function dawnLook(time: number): Partial<Look> {
  if (time < B_MW.start - 0.7 || time > B_MW.end + 0.6) return {};
  // The galaxy glows a little more than the film's default bloom gives, and the picture
  // swells as the music arrives.
  const w = prog(time, B_MW.start - 0.7, B_MW.start + 0.3, 'inOutSine') * (1 - prog(time, B_MW.end - 0.6, B_MW.end + 0.6, 'inOutSine'));
  const swell = time > B_MW.start ? 0.22 * Math.exp(-(time - B_MW.start) * 0.9) : 0;
  return { bloom: 0.075 + 0.045 * w, exposure: swell * w, saturation: 1 + 0.1 * w };
}
