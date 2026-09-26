// Act VI: the future, all the way to the end of time, and the epilogue.
import {
  Camera,
  Sprites,
  allocSprites,
  blackbody,
  keys,
  prog,
  rng,
  starSphere,
  type RenderTarget,
  type Shot,
  type SpriteData,
  type Vec3,
} from '@engine';
import { beat, cues, scratch, span, timeline } from '../lib';
import { Planet, loadEarth } from '../planet';

const COPY_ADD = `
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uSrc;
void main() { fragColor = vec4(texture(uSrc, vUv).rgb, 1.0); }`;

// ------------------------------------------------------------------ the clock keeps ticking
const DIAL = `
#include <common>
#include <stars>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uHand, uVis;
void main() {
  vec2 p = centered(vUv, uAspect);
  float px = 1.0 / uRes.y;
  vec3 col = starField(p, px, uGTime, 21.0, 0.35);
  float r = length(p);
  float a = atan(p.x, p.y);               // 0 at 12 o'clock, clockwise
  float R = 0.3;
  float ring = exp(-pow((r - R) / (px * 1.2), 2.0)) * 0.35;
  float tickA = mod(a + PI / 60.0, TAU / 60.0) - PI / 60.0;
  float ticks = exp(-pow(tickA * R / (px * 1.0), 2.0)) * band(r, R - 0.018, R - 0.008, px * 1.5);
  float big = step(abs(mod(a + PI / 12.0, TAU / 12.0) - PI / 12.0), 0.01);
  ticks *= 0.25 + 0.75 * big;
  // Second hand.
  vec2 hd = vec2(sin(uHand), cos(uHand));
  float along = dot(p, hd);
  float perp = abs(dot(p, vec2(hd.y, -hd.x)));
  float hand = exp(-pow(perp / (px * 1.0), 2.0)) * step(-0.04, along) * step(along, R - 0.03);
  col += vec3(0.85, 0.8, 0.72) * (ring + ticks * 0.6 + hand * 0.9) * uVis;
  col += vec3(1.0, 0.9, 0.75) * exp(-r / (px * 2.5)) * 0.6 * uVis;
  fragColor = vec4(col, 1.0);
}`;

function turn(): Shot {
  const b = beat('turn');
  // The hand jumps on each tick of the resumed clock.
  const tickTimes = [cues.resumeTick, 218, 219, 220, 221, 222];
  return {
    ...span('turn', { dIn: 0.6, dOut: 1.6 }),
    render(c) {
      let k = 0;
      for (const tt of tickTimes) if (c.time >= tt) k += 1 - Math.exp(-(c.time - tt) * 30);
      c.fullscreen(c.e.program(DIAL, 'dial'), {
        uHand: (k + 44) * ((Math.PI * 2) / 60),
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
uniform float uMag[7], uLines, uGhost;
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = saturate(dot(pa, ba) / dot(ba, ba)); return length(pa - ba * h); }
void main() {
  vec2 p = centered(vUv, uAspect);
  float px = 1.0 / uRes.y;
  vec3 col = vec3(0.0);
  // Constellation figure: current lines, plus a fading ghost of today's shape.
  int A[7] = int[7](0, 1, 2, 3, 4, 5, 3);
  int B[7] = int[7](1, 2, 3, 4, 5, 6, 0);
  float ln = 0.0, gh = 0.0;
  for (int i = 0; i < 7; i++) {
    float d = seg(p, uNow[A[i]], uNow[B[i]]);
    ln += exp(-pow(d / (px * 1.1), 2.0));
    float g = seg(p, uThen[A[i]], uThen[B[i]]);
    gh += exp(-pow(g / (px * 1.1), 2.0));
  }
  col += vec3(0.45, 0.6, 0.9) * min(ln, 1.0) * 0.28 * uLines;
  col += vec3(0.8, 0.7, 0.5) * min(gh, 1.0) * 0.12 * uGhost;
  for (int i = 0; i < 7; i++) {
    float d = length(p - uNow[i]);
    float sig = px * 1.3;
    float b = pow(2.512, -(uMag[i] - 1.5)) * 6.0;
    col += blackbody(i == 0 ? 4700.0 : 9500.0) * (exp(-d * d / (2.0 * sig * sig)) * b + exp(-d / (px * 5.0)) * b * 0.04);
  }
  fragColor = vec4(col, 1.0);
}`;

function drift(): Shot<{ sky: Sprites; cam: Camera }> {
  return {
    ...span('drift', { dIn: 1.0, dOut: 1.0 }),
    setup(e) {
      // Field stars that also wander (random proper motions).
      const r = rng(228);
      const d = starSphere(r, { count: 9000, brightness: 0.4 });
      for (let i = 0; i < d.count; i++) d.extra!.set([r.gauss(), r.gauss(), 0, 0], i * 4);
      return {
        sky: new Sprites(e, d, {
          animate: `
            uniform float uYears;
            vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
              vec3 n = normalize(p);
              vec3 u = normalize(cross(n, vec3(0.0, 1.0, 0.0)));
              vec3 v = cross(u, n);
              return normalize(n + (u * x.x + v * x.y) * uYears * 6e-7) * length(p);
            }`,
        }),
        cam: new Camera({ fov: 40 }),
      };
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
      s.cam.set({ pos: [0.2, 0.3, keys(t, [[-1, 3.7], [7, 3.3]])], target: [0.25, 0.1, 0] });
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
const GIANT = `
#include <noise>
#include <color>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uR;
uniform vec4 uPlanets[3];   // xy position, z radius, w vaporised (0..1 flash)
void main() {
  vec2 p = centered(vUv, uAspect);
  vec2 c = vec2(-0.95, -0.05);
  vec2 d = p - c;
  float r = length(d);
  float px = 1.0 / uRes.y;
  vec3 col = vec3(0.0);
  if (r < uR) {
    float mu = sqrt(max(1.0 - (r * r) / (uR * uR), 0.0));
    vec3 n = vec3(d / uR, mu);
    // A few giant, blotchy convection cells boiling on the surface (like Betelgeuse).
    vec3 q = n * 2.2;
    vec3 warp = vec3(fbm(q * 1.5 + uGTime * 0.03, 4), fbm(q * 1.5 + 5.0 - uGTime * 0.02, 4), fbm(q * 1.5 + 9.0, 4));
    vec2 w = worley(q * 1.6 + warp * 1.3 + uGTime * 0.02);
    float cell = smoothstep(0.0, 0.55, w.y - w.x);
    float mott = fbm(q * 6.0 + warp * 2.0 + uGTime * 0.05, 5);
    float I = 0.3 + 0.95 * cell * (0.55 + 0.9 * mott);
    float limb = pow(mu, 0.8);
    col = blackbody(2400.0 + 900.0 * I) * vec3(1.0, 0.8, 0.62) * I * limb * 0.95;
  }
  // Chromosphere glow and flame-like prominences beyond the limb.
  float out1 = max(r - uR, 0.0);
  float ang = atan(d.y, d.x);
  float flames = fbm(vec2(ang * 9.0, out1 * 20.0 - uGTime * 0.3), 5);
  col += vec3(1.0, 0.3, 0.1) * exp(-out1 / (0.01 + 0.03 * flames)) * 0.8 * step(uR, r);
  col += vec3(1.0, 0.4, 0.15) * exp(-out1 / 0.25) * 0.15;
  // The inner planets in silhouette; they flash as the swelling star engulfs them.
  for (int i = 0; i < 3; i++) {
    vec4 pl = uPlanets[i];
    if (pl.z <= 0.0) continue;
    float dp = length(p - pl.xy) - pl.z;
    float body = 1.0 - smoothstep(-px, px, dp);
    col = mix(col, vec3(0.01, 0.004, 0.002), body * (1.0 - pl.w));
    col += vec3(1.0, 0.8, 0.5) * exp(-max(dp, 0.0) / (0.01 + 0.03 * pl.w)) * pl.w * 4.0 * (1.0 - pl.w * 0.7);
  }
  fragColor = vec4(col, 1.0);
}`;

function redGiant(): Shot<{ half: RenderTarget }> {
  return {
    ...span('redgiant', { dIn: 1.0, dOut: 1.0 }),
    render(c) {
      const t = c.time - beat('redgiant').start;
      const R = keys(t, [[-1, 0.28], [1.0, 0.3], [7.8, 1.52, 'inOutCubic']]);
      const cx = -0.95;
      // Mercury, Venus, Earth sit along a line out from the star; each vaporises when the limb reaches it.
      const pl: [number, number, number][] = [[cx + 0.62, 0.02, 0.009], [cx + 1.05, -0.06, 0.016], [cx + 1.62, 0.04, 0.017]];
      const planets = pl.flatMap(([x, y, r], i) => {
        const dist = Math.hypot(x - cx, y + 0.05);
        const hit = R - dist;
        const vap = hit > 0 ? Math.min(1, hit * 18) : 0;
        const gone = hit > 0.12 && i < 2;
        return [x, y, gone ? 0 : r, i < 2 ? vap : Math.min(vap, 0.5)];
      });
      c.fullscreen(c.e.program(GIANT, 'giant'), { uR: R, uPlanets: planets });
    },
  };
}

// ------------------------------------------------------------------ planetary nebula and white dwarf
const PNEB = `
#include <noise>
#include <color>
#include <camera>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uExpand;
float shellDensity(vec3 p, out float inner) {
  vec3 q = p / uExpand;
  float r = length(q);
  float n = fbm(q * 4.0 + vec3(0.0, uGTime * 0.02, 0.0), 4);
  float fil = pow(1.0 - abs(fbm(q * 8.0 + 3.0, 4) * 2.0 - 1.0), 4.0);
  // Bright equatorial ring (the classic 'ring nebula' torus).
  float rxz = length(q.xz);
  float ring = exp(-pow((rxz - 0.66 * (0.94 + 0.12 * n)) / 0.1, 2.0) - pow(q.y / 0.2, 2.0));
  // Faint bipolar lobes.
  float c = abs(q.y) / max(r, 1e-4);
  float R = 0.72 + 0.6 * c * c;
  float shell = exp(-pow((r - R * (0.92 + 0.16 * n)) / 0.045, 2.0)) * 0.35 * smoothstep(0.3, 0.8, c);
  inner = exp(-pow(r / 0.5, 2.0)) * (0.35 + 0.9 * n);
  return (ring * 1.3 + shell) * (0.45 + 1.3 * fil);
}
void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  vec3 col = vec3(0.0);
  vec2 hit = raySphere(ro, rd, vec3(0.0), 1.3 * uExpand);
  if (hit.y > 0.0) {
    float t0 = max(hit.x, 0.0), t1 = hit.y;
    const int N = 40;
    float dt = (t1 - t0) / float(N);
    float j = hash12(gl_FragCoord.xy);
    for (int i = 0; i < N; i++) {
      vec3 pos = ro + rd * (t0 + (float(i) + j) * dt);
      float inner;
      float d = shellDensity(pos, inner);
      vec3 ha = mix(vec3(1.0, 0.2, 0.18), vec3(1.0, 0.6, 0.3), smoothstep(0.55, 0.75, length(pos) / uExpand));
      vec3 o3 = vec3(0.12, 0.65, 0.72);
      col += (ha * d * 1.4 + o3 * inner * 0.55) * dt;
    }
  }
  // The white dwarf: a tiny, intensely hot ember.
  vec2 sc = rayPointDist(ro, rd, vec3(0.0));
  float px = 2.0 * uTanHalfFov / uRes.y * sc.y;
  col += vec3(0.85, 0.9, 1.0) * (exp(-sc.x * sc.x / (2.0 * px * px)) * 12.0 + exp(-sc.x / 0.03) * 0.5);
  fragColor = vec4(col * 1.4, 1.0);
}`;

function whiteDwarf(): Shot<{ half: RenderTarget; cam: Camera; sky: Sprites }> {
  return {
    ...span('whitedwarf', { dIn: 1.0, dOut: 1.0 }),
    setup: (e) => ({ half: scratch(e, 0.5), cam: new Camera({ fov: 38 }), sky: new Sprites(e, starSphere(rng(248), { count: 8000, brightness: 0.3 })) }),
    render(c, s) {
      const t = c.time - beat('whitedwarf').start;
      const az = 0.6 + t * 0.06;
      s.cam.set({ pos: [Math.sin(az) * 2.2, 2.0, Math.cos(az) * 2.2], target: [0, 0, 0] });
      s.half.bind();
      c.fullscreen(c.e.program(PNEB, 'pnebula'), { ...s.cam.uniforms(), uExpand: 0.9 + 0.04 * t });
      c.target.bind();
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE);
      c.fullscreen(c.e.program(COPY_ADD, 'copyadd'), { uSrc: s.half });
      c.gl.disable(c.gl.BLEND);
    },
  };
}

// ------------------------------------------------------------------ Milky Way + Andromeda
interface MergerSim {
  frames: Float32Array[];
  data: SpriteData;
}

function simulateMerger(): MergerSim {
  const r = rng(254);
  const nA = 16000, nB = 20000, n = nA + nB;
  const data = allocSprites(n);
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
  // Two cores (mass, position, velocity).
  const M = [1.0, 1.3];
  const cp = [[-3.2, 0.4, 0.0], [3.2, -0.4, 0.0]];
  const cv = [[0.18, 0.0, 0.32], [-0.14, 0.0, -0.25]];
  const soft = 0.12;
  const disk = (k: number, count: number, offset: number, radius: number, tiltX: number, tiltZ: number) => {
    const cx = Math.cos(tiltX), sx = Math.sin(tiltX), cz = Math.cos(tiltZ), sz = Math.sin(tiltZ);
    for (let i = 0; i < count; i++) {
      const idx = offset + i;
      let rr = 0;
      do rr = -Math.log(1 - r.next()) * radius * 0.35 + 0.05; while (rr > radius);
      let a = r.next() * Math.PI * 2;
      if (r.next() < 0.65) a = (r.next() < 0.5 ? 0 : Math.PI) + Math.log(rr / 0.15) / Math.tan(0.4) + r.gauss() * 0.3;
      let x = rr * Math.cos(a), y = r.gauss() * 0.02, z = rr * Math.sin(a);
      const v = Math.sqrt((M[k] * rr * rr) / Math.pow(rr * rr + soft * soft, 1.5));
      let vx = -Math.sin(a) * v, vy = 0, vz = Math.cos(a) * v;
      // Tilt the disk.
      [y, z] = [y * cx - z * sx, y * sx + z * cx];
      [vy, vz] = [vy * cx - vz * sx, vy * sx + vz * cx];
      [x, y] = [x * cz - y * sz, x * sz + y * cz];
      [vx, vy] = [vx * cz - vy * sz, vx * sz + vy * cz];
      pos.set([x + cp[k][0], y + cp[k][1], z + cp[k][2]], idx * 3);
      vel.set([vx + cv[k][0], vy + cv[k][1], vz + cv[k][2]], idx * 3);
      const young = r.next() < 0.5;
      const c = blackbody(young ? r.range(7000, 14000) : r.range(3800, 6000));
      const b = (young ? 0.12 : 0.08) * (0.4 + Math.pow(r.next(), 4) * 2);
      data.color.set([c[0] * b, c[1] * b, c[2] * b], idx * 3);
      data.size[idx] = r.range(0.006, 0.012);
      data.extra!.set([r.next(), 0, 0, 0], idx * 4);
    }
  };
  disk(0, nA, 0, 1.0, 0.25, 0.1);
  disk(1, nB, nA, 1.3, 1.1, -0.4);
  const frames: Float32Array[] = [];
  const K = 96, sub = 8, dt = 0.045;
  const corePos = cp.map((v) => [...v]), coreVel = cv.map((v) => [...v]);
  for (let f = 0; f < K; f++) {
    frames.push(pos.slice());
    for (let s = 0; s < sub; s++) {
      // Cores attract each other; dynamical friction makes them spiral in and merge.
      const dx = corePos[1][0] - corePos[0][0], dy = corePos[1][1] - corePos[0][1], dz = corePos[1][2] - corePos[0][2];
      const d2 = dx * dx + dy * dy + dz * dz + 0.2;
      const inv = 1 / Math.pow(d2, 1.5);
      const drag = 0.35 * Math.exp(-Math.sqrt(d2) / 1.5);
      for (let k = 0; k < 2; k++) {
        const sgn = k === 0 ? 1 : -1;
        const other = M[1 - k];
        coreVel[k][0] += (sgn * dx * other * inv - drag * (coreVel[k][0] - (coreVel[0][0] * M[0] + coreVel[1][0] * M[1]) / (M[0] + M[1]))) * dt;
        coreVel[k][1] += (sgn * dy * other * inv - drag * (coreVel[k][1] - (coreVel[0][1] * M[0] + coreVel[1][1] * M[1]) / (M[0] + M[1]))) * dt;
        coreVel[k][2] += (sgn * dz * other * inv - drag * (coreVel[k][2] - (coreVel[0][2] * M[0] + coreVel[1][2] * M[1]) / (M[0] + M[1]))) * dt;
      }
      for (let k = 0; k < 2; k++) for (let j = 0; j < 3; j++) corePos[k][j] += coreVel[k][j] * dt;
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        let ax = 0, ay = 0, az = 0;
        for (let k = 0; k < 2; k++) {
          const rx = corePos[k][0] - pos[o], ry = corePos[k][1] - pos[o + 1], rz = corePos[k][2] - pos[o + 2];
          const rr2 = rx * rx + ry * ry + rz * rz + soft * soft;
          const f = M[k] / (rr2 * Math.sqrt(rr2));
          ax += rx * f;
          ay += ry * f;
          az += rz * f;
        }
        vel[o] += ax * dt;
        vel[o + 1] += ay * dt;
        vel[o + 2] += az * dt;
        pos[o] += vel[o] * dt;
        pos[o + 1] += vel[o + 1] * dt;
        pos[o + 2] += vel[o + 2] * dt;
      }
    }
  }
  data.position.set(frames[0]);
  return { frames, data };
}

function merger(): Shot<{ sim: MergerSim; stars: Sprites; sky: Sprites; cam: Camera; buf: Float32Array }> {
  return {
    ...span('merger', { dIn: 1.0, dOut: 1.0 }),
    setup(e) {
      const sim = simulateMerger();
      return {
        sim,
        stars: new Sprites(e, sim.data, { minPixels: 0.7 }),
        sky: new Sprites(e, starSphere(rng(255), { count: 6000, brightness: 0.25 })),
        cam: new Camera({ fov: 40, far: 1000 }),
        buf: new Float32Array(sim.data.count * 3),
      };
    },
    render(c, s) {
      const b = beat('merger');
      const u = Math.min(0.9999, Math.max(0, (c.time - (b.start - 0.5)) / (b.end - b.start + 1.0)));
      const f = u * (s.sim.frames.length - 1);
      const i0 = Math.floor(f), i1 = Math.min(i0 + 1, s.sim.frames.length - 1), w = f - i0;
      const A = s.sim.frames[i0], B = s.sim.frames[i1];
      for (let i = 0; i < s.buf.length; i++) s.buf[i] = A[i] + (B[i] - A[i]) * w;
      s.stars.update({ position: s.buf });
      const az = 0.3 + u * 0.5;
      s.cam.set({ pos: [Math.sin(az) * 9.5, 4.8, Math.cos(az) * 9.5], target: [0, 0, 0] });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      s.stars.draw(s.cam, c.time, {}, { blend: 'add', brightness: 1.0 });
    },
  };
}

// ------------------------------------------------------------------ the last stars
function lastStars(): Shot<{ stars: Sprites; cam: Camera }> {
  return {
    ...span('laststars', { dIn: 1.0, dOut: 1.2 }),
    setup(e) {
      const r = rng(262);
      const d = starSphere(r, { count: 12000, brightness: 0.55, band: 0.3 });
      const b = beat('laststars');
      for (let i = 0; i < d.count; i++) {
        // Death times spread over the shot, most stars late (red dwarfs linger).
        const tDeath = b.start - 1 + Math.pow(r.next(), 0.6) * (b.end - b.start + 1.5);
        d.extra!.set([tDeath, 0, r.next(), 0], i * 4);
      }
      // The eight synchronized stars: bright, near the centre of view.
      const deaths = timeline.starDeaths;
      deaths.forEach((td, k) => {
        const a = (k / deaths.length) * Math.PI * 2 + 0.4;
        const dir: Vec3 = [Math.sin(a) * 0.32, Math.cos(a) * 0.14 + 0.03, -1];
        const l = Math.hypot(...dir);
        d.position.set([(dir[0] / l) * 5000, (dir[1] / l) * 5000, (dir[2] / l) * 5000], k * 3);
        const c = blackbody(3800 + k * 500);
        d.color.set([c[0] * 14, c[1] * 14, c[2] * 14], k * 3);
        d.extra!.set([td, 1, 0, 0], k * 4);
      });
      return {
        stars: new Sprites(e, d, {
          animate: `
            vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
              float age = uTime - x.x;
              float redden = smoothstep(-6.0, 0.0, age);
              col *= mix(vec3(1.0), vec3(1.3, 0.55, 0.3), redden * 0.8);
              if (age > 0.0) {
                float flare = x.y > 0.5 ? exp(-age * 5.0) * 4.0 : 0.0;
                col *= exp(-age * 2.2) + flare;
                size *= 1.0 + flare * 0.5;
              }
              return p;
            }`,
        }),
        cam: new Camera({ fov: 45 }),
      };
    },
    render(c, s) {
      const t = c.time - beat('laststars').start;
      s.cam.set({ pos: [0, 0, 0], target: [Math.sin(t * 0.02) * 0.2, 0.02, -1] });
      s.stars.draw(s.cam, c.time, {}, { sky: true, brightness: 1.0 });
    },
  };
}

// ------------------------------------------------------------------ black holes (lensing ray tracer)
const BLACKHOLE = `
#include <noise>
#include <color>
#include <camera>
#include <stars>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime;
uniform float uRs, uDisk, uHawking, uFlash, uStars;
vec2 octa(vec3 d) {
  d /= abs(d.x) + abs(d.y) + abs(d.z);
  vec2 o = d.y >= 0.0 ? d.xz : (1.0 - abs(d.zx)) * sign(d.xz);
  return o;
}
void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 pos = uCamPos;
  vec3 vel = rd;
  vec3 col = vec3(0.0);
  float trans = 1.0;
  bool captured = false;
  float rs = max(uRs, 1e-4);
  vec3 h3 = cross(pos, vel);
  float h2 = dot(h3, h3);
  // Integrate the photon path: a'' = -1.5 rs h^2 r / |r|^5 (Schwarzschild null geodesic).
  for (int i = 0; i < 150; i++) {
    float r = length(pos);
    if (r < rs) { captured = true; break; }
    if (r > 40.0 && dot(pos, vel) > 0.0) break;
    float dt = clamp(0.06 * r, 0.02, 1.2);
    vec3 acc = -1.5 * rs * h2 * pos / pow(r, 5.0);
    vec3 np = pos + vel * dt + 0.5 * acc * dt * dt;
    vec3 acc2 = -1.5 * rs * h2 * np / pow(max(length(np), 1e-3), 5.0);
    vel = normalize(vel + 0.5 * (acc + acc2) * dt);
    // Thin accretion disk in the y = 0 plane.
    if (uDisk > 0.0 && pos.y * np.y < 0.0) {
      float f = pos.y / (pos.y - np.y);
      vec3 hp = mix(pos, np, f);
      float rr = length(hp.xz) / rs;
      if (rr > 2.6 && rr < 9.0) {
        float ang = atan(hp.z, hp.x);
        float swirl = fbm(vec2(ang * 3.0 + uGTime * 0.6 / pow(rr, 1.5) * 8.0, rr * 2.2), 4);
        float temp = 9000.0 * pow(2.6 / rr, 0.75);
        float dop = 1.0 + 0.55 * dot(normalize(vec3(-hp.z, 0.0, hp.x)), -rd);
        float e = smoothstep(2.6, 3.4, rr) * smoothstep(9.0, 5.0, rr) * (0.3 + 1.1 * swirl);
        col += blackbody(temp) * e * pow(dop, 3.0) * uDisk * trans * 0.9;
        trans *= 1.0 - saturate(e * 0.7);
      }
    }
    pos = np;
  }
  if (!captured) {
    vec2 o = octa(vel);
    col += starField(o * 2.0, 2.0 / uRes.y, uGTime, 31.0, uStars) * trans;
  } else {
    col *= 0.0;
  }
  // Hawking glow: the horizon itself begins to shine as the hole shrinks and heats up.
  vec2 cp = rayPointDist(uCamPos, rd, vec3(0.0));
  col += mix(vec3(1.0, 0.4, 0.2), vec3(0.7, 0.8, 1.0), uHawking) * uHawking * exp(-cp.x / (rs * 1.6)) * 2.0 * uHawking;
  float Rf = (1.0 - uFlash) * 6.0;
  col += vec3(0.9, 0.93, 1.0) * uFlash * (exp(-cp.x / 0.03) * 25.0 + exp(-pow((cp.x - Rf) / (0.2 + Rf * 0.1), 2.0)) * 0.8);
  fragColor = vec4(col, 1.0);
}`;

function blackHoles(): Shot<{ half: RenderTarget; cam: Camera }> {
  const b0 = beat('blackholes'), b1 = beat('evaporation');
  return {
    id: 'blackholes',
    start: b0.start - 0.6,
    end: b1.end + 0.6,
    fadeIn: 1.2,
    fadeOut: 1.2,
    setup: (e) => ({ half: scratch(e, 0.75), cam: new Camera({ fov: 36 }) }),
    render(c, s) {
      const t = c.time - b0.start;
      const az = -0.35 + t * 0.03;
      const el = keys(t, [[-1, 0.1], [16, 0.22]]);
      const dist = keys(t, [[-1, 34], [8, 28], [13, 18, 'inOutSine'], [16, 16]]);
      s.cam.set({ pos: [Math.sin(az) * dist * Math.cos(el), dist * Math.sin(el), Math.cos(az) * dist * Math.cos(el)], target: [0, 0, 0] });
      const rs = keys(c.time, [[b0.start, 1.0], [b1.start, 1.0], [cues.lastFlash - 0.05, 0.02, 'inQuad']]);
      const gone = c.time > cues.lastFlash;
      s.half.bind();
      c.fullscreen(c.e.program(BLACKHOLE, 'blackhole'), {
        ...s.cam.uniforms(),
        uRs: gone ? 0 : rs,
        uDisk: keys(c.time, [[b0.start - 1, 0.8], [b0.start + 5, 0.45], [b1.start + 1, 0.0]]),
        uHawking: gone ? 0 : prog(c.time, b1.start + 0.5, cues.lastFlash, 'inQuad'),
        uFlash: c.time > cues.lastFlash ? Math.exp(-(c.time - cues.lastFlash) * 1.8) : 0,
        uStars: keys(c.time, [[b0.start, 0.35], [b1.end, 0.0]]),
      });
      c.target.bind();
      c.fullscreen(c.e.program(COPY_ADD, 'copyadd'), { uSrc: s.half });
    },
  };
}

// ------------------------------------------------------------------ heat death and epilogue
const VOID = `
#include <noise>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uAmt;
void main() {
  vec2 p = centered(vUv, uAspect);
  // The last faint photons drifting in an almost perfect, featureless dark.
  float n = fbm(vec3(p * 2.0, uGTime * 0.05), 4);
  vec3 col = vec3(0.35, 0.4, 0.55) * pow(n, 5.0) * 0.02 * uAmt;
  vec2 g = p * 40.0 + vec2(uGTime * 0.05, -uGTime * 0.03);
  vec3 h = hash32(floor(g));
  col += vec3(0.6, 0.7, 1.0) * step(0.985, h.z) * exp(-dot(fract(g) - h.xy, fract(g) - h.xy) / 0.003) * 0.05 * uAmt;
  fragColor = vec4(col, 1.0);
}`;

function heatDeath(): Shot {
  const b = beat('heatdeath');
  return {
    ...span('heatdeath', { dIn: 1.2, dOut: 1.5 }),
    render(c) {
      c.fullscreen(c.e.program(VOID, 'void'), { uAmt: keys(c.time, [[b.start, 1.0], [b.end, 0.0, 'inOutSine']]) });
    },
  };
}

function epilogue(): Shot<{ cam: Camera; sky: Sprites; dot: Sprites }> {
  const b = beat('epilogue');
  return {
    ...span('epilogue', { dIn: 1.5, dOut: 0 }),
    setup(e) {
      const d = allocSprites(1);
      d.position.set([0, 0, -1000]);
      d.color.set([0.35, 0.55, 1.0]);
      d.size[0] = 0.4;
      return { cam: new Camera({ fov: 32 }), sky: new Sprites(e, starSphere(rng(296), { count: 7000, brightness: 0.22 })), dot: new Sprites(e, d, { minPixels: 0.9 }) };
    },
    render(c, s) {
      s.cam.set({ pos: [0, 0, 0], target: [0, 0, -1] });
      const stars = prog(c.time, 300, 309, 'inOutSine') * (1 - prog(c.time, 315.5, 318, 'inOutSine'));
      s.sky.draw(s.cam, c.time, {}, { sky: true, brightness: stars });
      const warm = prog(c.time, cues.picardy, cues.picardy + 3, 'inOutSine');
      const dot = prog(c.time, 302, 306, 'inOutSine') * (1 - prog(c.time, 315, 317.5, 'inOutSine'));
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE);
      c.fullscreen(c.e.program(`
#include <noise>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uAmt, uWarm;
void main() {
  vec2 p = centered(vUv, uAspect);
  vec2 d = normalize(vec2(0.35, 1.0));
  float x = dot(p - vec2(0.02, 0.0), vec2(d.y, -d.x));
  float band = exp(-pow(x / 0.1, 2.0)) * 0.5 + exp(-pow((x + 0.22) / 0.05, 2.0)) * 0.2;
  vec3 c = mix(vec3(0.8, 0.75, 0.7), vec3(1.0, 0.72, 0.45), uWarm);
  fragColor = vec4(c * band * (0.9 + 0.2 * fbm(vec2(dot(p, d) * 3.0, x * 20.0), 3)) * uAmt * 0.1, 1.0);
}`, 'epibeam'), { uAmt: dot, uWarm: warm });
      c.gl.disable(c.gl.BLEND);
      s.dot.draw(s.cam, c.time, {}, { brightness: dot * (1.8 + 1.5 * warm) });
    },
  };
}

export function futureShots(): Shot[] {
  return [turn(), mars(), drift(), hotEarth(), redGiant(), whiteDwarf(), merger(), lastStars(), blackHoles(), heatDeath(), epilogue()];
}
