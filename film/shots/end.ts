// Act VI, continued: the end of time (the galaxies merge, the last stars, black holes, heat death) and the epilogue.
import {
  Camera,
  Sprites,
  allocSprites,
  blackbody,
  keys,
  prog,
  rng,
  smoothstep,
  spline,
  starSphere,
  v3,
  type RenderTarget,
  type Shot,
  type SpriteData,
  type Vec3,
} from '@engine';
import type { Look } from '@engine';
import { beat, cues, scratch, span, timeline } from '../lib';

const COPY_ADD = `
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uSrc;
void main() { fragColor = vec4(texture(uSrc, vUv).rgb, 1.0); }`;

// ------------------------------------------------------------------ Milky Way + Andromeda
// A restricted N-body encounter (after Toomre & Toomre, 1972): the stars and dust of two
// disks are test particles in the field of two softened cores, which fall together on a
// decaying orbit (dynamical friction is a drag that grows as they close). Both disks spin the
// way the cores orbit, which is what throws long tidal tails. The simulation is stored as
// key frames, so any film frame can be drawn on its own.
const MERGER = {
  /** Masses of the two cores (the Milky Way, Andromeda). */
  M: [1.0, 1.3],
  /** Disk radii. */
  R: [1.0, 1.25],
  /** Disk tilts about x and z (radians). */
  tilt: [[0.3, 0.12], [0.85, -0.35]],
  /** First separation, closing speed, sideways speed of the cores. */
  sep: 5.6, vr: 0.4, vt: 0.38,
  /** Dynamical friction: strength and range. */
  drag: 0.4, dragRange: 0.7,
  /** Softening of the cores for the particles (wide, so inner orbits stay slow enough to key frame). */
  soft: 0.3,
  frames: 96, sub: 5, dt: 0.05,
  stars: 60000, dust: 14000, bulge: 5200,
  /** Simulation times: the shot's first frame, the first pass, the collision proper (the
   *  second pericentre, when the gas of both disks is squeezed into new stars), the last frame. */
  t0: 2.0, tPass: 7.9, tHit: 16.4, t1: 23.5,
  /** When the spiral arms are at their drawn pitch (they are material arms, so they wind up). */
  tArms: 5.5,
  /** Positions are stored as int16 (world units * Q). */
  Q: 1500,
};

interface MergerSim {
  frames: Int16Array[];
  /** Core positions per frame: x0, y0, z0, x1, y1, z1. */
  cores: Float32Array[];
}

interface MergerData {
  stars: SpriteData;
  dust: SpriteData;
  bulge: SpriteData;
  pos: Float32Array;
  vel: Float32Array;
}

/** Rotate a disk-frame vector into the world by a disk's tilt. */
function tilted(k: number, x: number, y: number, z: number): Vec3 {
  const [tx, tz] = MERGER.tilt[k];
  const cx = Math.cos(tx), sx = Math.sin(tx), cz = Math.cos(tz), sz = Math.sin(tz);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  return [x, y, z];
}

function mergerStart() {
  const { M, sep, vr, vt } = MERGER;
  const f0 = M[1] / (M[0] + M[1]), f1 = M[0] / (M[0] + M[1]);
  return {
    cp: [[-sep * f0, 0, 0], [sep * f1, 0, 0]],
    cv: [[vr * f0, 0, vt * f0], [-vr * f1, 0, -vt * f1]],
  };
}

/** The two galaxies before they meet: stars, dust and (rigid) bulges. */
function mergerData(): MergerData {
  const r = rng(254);
  const { M, R, soft } = MERGER;
  const nS = MERGER.stars, nD = MERGER.dust, n = nS + nD;
  const stars = allocSprites(nS), dust = allocSprites(nD), bulge = allocSprites(MERGER.bulge);
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
  const { cp, cv } = mergerStart();
  const pitch = Math.tan((27 * Math.PI) / 180);
  const omega = (k: number, rr: number) => Math.sqrt(M[k] / Math.pow(rr * rr + soft * soft, 1.5));
  // The arms are drawn as they should look at tArms and turned back to the start (the disk
  // turns towards decreasing angle).
  const armAngle = (k: number, arm: number, rr: number) =>
    (k === 0 ? 0.6 : 2.1) + arm * Math.PI + Math.log(rr / 0.2) / pitch + omega(k, rr) * MERGER.tArms;
  const anyAngle = (k: number, rr: number) => r.next() * Math.PI * 2;
  const place = (idx: number, k: number, rr: number, a: number, h: number) => {
    const v = Math.sqrt((M[k] * rr * rr) / Math.pow(rr * rr + soft * soft, 1.5));
    const p = tilted(k, rr * Math.cos(a), h, rr * Math.sin(a));
    // Spin about +y, the sense of the cores' orbit (a prograde encounter), arms trailing.
    const w = tilted(k, Math.sin(a) * v, 0, -Math.cos(a) * v);
    pos.set([p[0] + cp[k][0], p[1] + cp[k][1], p[2] + cp[k][2]], idx * 3);
    vel.set([w[0] + cv[k][0], w[1] + cv[k][1], w[2] + cv[k][2]], idx * 3);
  };
  const radius = (k: number, lo: number) => {
    let rr = 0;
    do rr = -Math.log(1 - r.next()) * R[k] * 0.34 + lo; while (rr > R[k] * 1.15);
    return rr;
  };
  for (let i = 0; i < nS; i++) {
    const k = r.next() < 0.46 ? 0 : 1;
    const rr = radius(k, 0.16);
    const kind = r.next();
    // No arms in the inner disk: wound tight, they would read as rings.
    const inArm = smoothstep(0.18, 0.42, rr / R[k]);
    let a: number, T: number, b: number, size: number, young = 0;
    // Old and yellow towards the centre, young and blue in the outer arms.
    const old = 0.94 - 0.56 * smoothstep(0.12, 0.6, rr / R[k]);
    if (kind < old) {
      // The old disk: yellow, everywhere, a little denser in the arms.
      a = r.next() < 0.4 * inArm ? armAngle(k, r.int(0, 1), rr) + (r.gauss() * 0.3) / Math.sqrt(rr) : anyAngle(k, rr);
      T = r.range(3700, 5600);
      b = r.range(0.008, 0.026) * (0.5 + Math.pow(r.next(), 6) * 3.5);
      size = r.range(0.0035, 0.006);
    } else if (kind < old + (1 - old) * 0.975) {
      // Young blue stars along the arms.
      a = r.next() < inArm ? armAngle(k, r.int(0, 1), rr) + (r.gauss() * (r.next() < 0.6 ? 0.13 : 0.32)) / Math.sqrt(rr) : anyAngle(k, rr);
      T = r.range(8000, 24000);
      b = r.range(0.016, 0.055) * (0.5 + Math.pow(r.next(), 7) * 7);
      size = r.range(0.0035, 0.0065);
      young = 1;
    } else {
      // Star-forming knots, glowing pink.
      a = armAngle(k, r.int(0, 1), rr) + (r.gauss() * 0.07) / Math.sqrt(rr) + 0.03 / rr;
      T = 0;
      b = r.range(0.05, 0.16);
      size = r.range(0.006, 0.011);
      young = 1;
    }
    place(i, k, rr, a, r.gauss() * 0.018 * R[k]);
    let c: Vec3 = T ? blackbody(T) : [1.0, 0.28, 0.42];
    // Push the young stars towards blue: summed over an arm they should not wash out to white.
    if (T > 7000) c = [c[0] * 0.72, c[1] * 0.9, c[2] * 1.25];
    // Dimmer where the disk is dense, so the inner arms do not burn out to white.
    b *= 0.25 + 0.75 * Math.min(1, rr / (0.7 * R[k]));
    stars.color.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    stars.size[i] = size;
    stars.extra!.set([k, young, r.next(), rr / R[k]], i * 4);
  }
  for (let i = 0; i < nD; i++) {
    const k = r.next() < 0.46 ? 0 : 1;
    const rr = radius(k, 0.22);
    const arm = r.int(0, 1);
    // Lanes on the inner edge of each arm, broken into patches.
    const patch = 0.5 + 0.5 * Math.sin(rr * 19 + arm * 2.3 + k) * Math.sin(rr * 7.3 + k * 1.7);
    const a = armAngle(k, arm, rr) + 0.08 / rr + (r.gauss() * 0.04) / Math.sqrt(rr);
    place(nS + i, k, rr, a, r.gauss() * 0.006);
    dust.color.set([r.range(0.008, 0.024) * (0.75 + 0.25 * patch) * smoothstep(1.0, 0.7, rr / R[k]) * smoothstep(0.25, 0.6, rr / R[k]), 0, 0], i * 3);
    dust.size[i] = r.range(0.02, 0.04) * R[k];
    dust.extra!.set([k, 0, r.next(), rr / R[k]], i * 4);
  }
  // Bulges: old, warm stars that ride with their core (too tightly bound for the tides to move).
  for (let i = 0; i < bulge.count; i++) {
    const k = i % 2;
    const point = r.next() < 0.3;
    const rr = Math.abs(r.gauss()) * (point ? 0.12 : 0.085) * R[k];
    const d = r.onSphere();
    const p = tilted(k, d[0] * rr, d[1] * rr * 0.55, d[2] * rr);
    bulge.position.set(p, i * 3);
    const c = blackbody(r.range(3300, 4500));
    const b = point ? r.range(0.02, 0.08) * (0.3 + Math.pow(r.next(), 4) * 1.5) : 0.004;
    bulge.color.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    bulge.size[i] = point ? r.range(0.0045, 0.007) : r.range(0.02, 0.05) * R[k];
    bulge.extra!.set([k, point ? 1 : 0, r.next(), 0], i * 4);
  }
  return { stars, dust, bulge, pos, vel };
}

function simulateMerger(d: MergerData): MergerSim {
  const { M, soft, sub, dt, Q } = MERGER;
  const { pos, vel } = d;
  const n = pos.length / 3;
  const { cp, cv } = mergerStart();
  const frames: Int16Array[] = [], cores: Float32Array[] = [];
  const s2 = soft * soft;
  // The loop below is a leapfrog whose velocities live half a step before its positions: start
  // them there. (Started in step, every star would begin a small radial oscillation at the same
  // moment, and the disks would fill with concentric ripples as those drift out of phase.)
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    for (let k = 0; k < 2; k++) {
      const rx = cp[k][0] - pos[o], ry = cp[k][1] - pos[o + 1], rz = cp[k][2] - pos[o + 2];
      const rr2 = rx * rx + ry * ry + rz * rz + s2;
      const g = (M[k] / (rr2 * Math.sqrt(rr2))) * 0.5 * dt;
      vel[o] -= rx * g;
      vel[o + 1] -= ry * g;
      vel[o + 2] -= rz * g;
    }
  }
  for (let f = 0; f < MERGER.frames; f++) {
    const q = new Int16Array(n * 3);
    for (let i = 0; i < q.length; i++) q[i] = Math.max(-32767, Math.min(32767, Math.round(pos[i] * Q)));
    frames.push(q);
    cores.push(new Float32Array([...cp[0], ...cp[1]]));
    for (let s = 0; s < sub; s++) {
      // The cores attract each other; dynamical friction makes them spiral in and merge.
      const dx = cp[1][0] - cp[0][0], dy = cp[1][1] - cp[0][1], dz = cp[1][2] - cp[0][2];
      const dist = Math.hypot(dx, dy, dz);
      const inv = 1 / Math.pow(dist * dist + 0.2, 1.5);
      const drag = MERGER.drag * Math.exp(-dist / MERGER.dragRange);
      const dd = [dx, dy, dz];
      const cm = [0, 1, 2].map((j) => (cv[0][j] * M[0] + cv[1][j] * M[1]) / (M[0] + M[1]));
      for (let k = 0; k < 2; k++) {
        const sgn = k === 0 ? 1 : -1;
        for (let j = 0; j < 3; j++) cv[k][j] += (sgn * dd[j] * M[1 - k] * inv - drag * (cv[k][j] - cm[j])) * dt;
      }
      for (let k = 0; k < 2; k++) for (let j = 0; j < 3; j++) cp[k][j] += cv[k][j] * dt;
      const ax0 = cp[0][0], ay0 = cp[0][1], az0 = cp[0][2], ax1 = cp[1][0], ay1 = cp[1][1], az1 = cp[1][2];
      const m0 = M[0], m1 = M[1];
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        const px = pos[o], py = pos[o + 1], pz = pos[o + 2];
        let rx = ax0 - px, ry = ay0 - py, rz = az0 - pz;
        let rr2 = rx * rx + ry * ry + rz * rz + s2;
        let g = m0 / (rr2 * Math.sqrt(rr2));
        let ax = rx * g, ay = ry * g, az = rz * g;
        rx = ax1 - px; ry = ay1 - py; rz = az1 - pz;
        rr2 = rx * rx + ry * ry + rz * rz + s2;
        g = m1 / (rr2 * Math.sqrt(rr2));
        ax += rx * g; ay += ry * g; az += rz * g;
        vel[o] += ax * dt;
        vel[o + 1] += ay * dt;
        vel[o + 2] += az * dt;
        pos[o] = px + vel[o] * dt;
        pos[o + 1] = py + vel[o + 1] * dt;
        pos[o + 2] = pz + vel[o + 2] * dt;
      }
    }
  }
  return { frames, cores };
}

/** Bulge stars ride with their core. Uniforms: uCoreA, uCoreB, uBulge (brightness of each). */
const BULGE_ANIMATE = `
uniform vec3 uCoreA, uCoreB;
uniform float uGlowPass;
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  // Soft sprites belong to the glow pass, points to the star pass.
  if (abs(x.y - (1.0 - uGlowPass)) > 0.5) size = 0.0;
  return p + (x.x < 0.5 ? uCoreA : uCoreB);
}`;

/** Young stars and star-forming knots flare where the disks collide. Uniforms: uMid, uBurst. */
const STAR_ANIMATE = `
uniform vec3 uMid;
uniform float uBurst, uGlowPass;
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  // In the glow passes every star weighs the same (its hue only), or the few bright ones
  // would show as soft discs.
  // Fainter towards the centre, where the disk is dense and the bulge takes over.
  if (uGlowPass > 0.5) col = col / max(max(col.r, max(col.g, col.b)), 1e-4) * (x.y > 0.5 ? 0.04 : 0.028) * (0.22 + 0.78 * smoothstep(0.05, 0.75, x.w));
  float near = exp(-dot(p - uMid, p - uMid) / 0.5);
  col *= 1.0 + x.y * uBurst * near * (0.6 + 2.4 * x.z * x.z);
  return p;
}`;

/** Absorbers: opacity = col.r * Gaussian. Draw with blend 'premul'. */
const DUST_SHADE = `
vec4 shade(vec2 q, vec3 col, vec4 x) {
  return vec4(0.0, 0.0, 0.0, exp(-0.5 * dot(q, q)) * col.r);
}`;

/** New clusters lit by the collision around each core: x.x = when (0..1 through the burst), x.y = how long, x.w = which core. */
const BURST_ANIMATE = `
uniform vec3 uCoreA, uCoreB;
uniform float uBurstT;
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  float age = (uBurstT - x.x) / x.y;
  float e = age < 0.0 ? 0.0 : smoothstep(0.0, 0.12, age) * exp(-age * 1.6);
  col *= e;
  if (e <= 0.0) size = 0.0;
  float a = uBurstT * x.z;
  float c = cos(a), s = sin(a);
  return (x.w < 0.5 ? uCoreA : uCoreB) + vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z) * (1.0 - 0.35 * saturate(age));
}`;

/** Far galaxies: little tilted ellipses. x.x = orientation, x.y = axis ratio. */
const FAR_SHADE = `
vec4 shade(vec2 q, vec3 col, vec4 x) {
  float c = cos(x.x), s = sin(x.x);
  vec2 r = vec2(c * q.x + s * q.y, (-s * q.x + c * q.y) / x.y);
  float g = exp(-0.5 * dot(r, r)) + 0.6 * exp(-4.0 * dot(r, r));
  return vec4(col * g, g);
}`;

interface MergerState {
  data: MergerData;
  sim: MergerSim | null;
  stars: Sprites;
  dust: Sprites;
  bulge: Sprites;
  burst: Sprites;
  sky: Sprites;
  far: Sprites;
  cam: Camera;
  half: RenderTarget;
  buf: Float32Array;
  /** Which galaxy each simulated particle began in. */
  host: Uint8Array;
}

function merger(): Shot<MergerState> {
  const b = beat('merger');
  const sp = span('merger', { dIn: 1.0, dOut: 1.0 });
  /** Simulation time at a film time: quick to the first pass, slow while the tails unfurl. */
  const simT = (time: number) => spline(time, [[sp.start, MERGER.t0], [b.start + 1.5, MERGER.tPass], [b.start + 5.7, MERGER.tHit], [sp.end, MERGER.t1]]);
  return {
    ...sp,
    // The stars cross tens of pixels a frame at the close passes: without blur they would strobe.
    motionBlur: 5,
    setup(e) {
      const data = mergerData();
      const host = new Uint8Array(MERGER.stars + MERGER.dust);
      for (let i = 0; i < MERGER.stars; i++) host[i] = data.stars.extra![i * 4];
      for (let i = 0; i < MERGER.dust; i++) host[MERGER.stars + i] = data.dust.extra![i * 4];
      const r = rng(255);
      // New clusters for the starburst: a ragged disk around the merging cores.
      const nB = 1300;
      const burst = allocSprites(nB);
      for (let i = 0; i < nB; i++) {
        const rr = Math.pow(r.next(), 0.8) * 0.3;
        const a = r.next() * Math.PI * 2 + rr * 5.0;
        burst.position.set([rr * Math.cos(a), r.gauss() * 0.025, rr * Math.sin(a)], i * 3);
        const pink = r.next() < 0.25;
        const c: Vec3 = pink ? [1.0, 0.3, 0.45] : blackbody(r.range(9000, 26000));
        const br = r.range(0.1, 0.4) * (0.4 + Math.pow(r.next(), 5) * 3);
        burst.color.set([c[0] * br, c[1] * br, c[2] * br], i * 3);
        burst.size[i] = pink ? r.range(0.006, 0.012) : r.range(0.0035, 0.006);
        burst.extra!.set([Math.pow(r.next(), 1.3), r.range(0.25, 0.6), r.range(-1.5, 2.5), i % 2], i * 4);
      }
      // A deep field behind: a few hundred far galaxies.
      const nF = 420;
      const far = allocSprites(nF);
      for (let i = 0; i < nF; i++) {
        const d = r.onSphere();
        far.position.set([d[0] * 4000, d[1] * 4000, d[2] * 4000], i * 3);
        const c = blackbody(r.range(3800, 9000));
        const br = 0.012 + 0.07 * Math.pow(r.next(), 3);
        far.color.set([c[0] * br, c[1] * br, c[2] * br], i * 3);
        far.size[i] = 4000 * r.range(0.0012, 0.0045) * (0.5 + Math.pow(r.next(), 3));
        far.extra!.set([r.next() * Math.PI, r.range(0.25, 1.0), 0, 0], i * 4);
      }
      return {
        data,
        sim: null,
        stars: new Sprites(e, data.stars, { animate: STAR_ANIMATE, minPixels: 0.7 }),
        dust: new Sprites(e, data.dust, { shade: DUST_SHADE, minPixels: 1.0 }),
        bulge: new Sprites(e, data.bulge, { animate: BULGE_ANIMATE, minPixels: 0.7 }),
        burst: new Sprites(e, burst, { animate: BURST_ANIMATE, minPixels: 0.7 }),
        sky: new Sprites(e, starSphere(rng(256), { count: 9000, brightness: 0.22 })),
        far: new Sprites(e, far, { shade: FAR_SHADE, minPixels: 1.2 }),
        cam: new Camera({ fov: 34, far: 10000 }),
        half: scratch(e, 0.5),
        buf: new Float32Array((MERGER.stars + MERGER.dust) * 3),
        host,
      };
    },
    render(c, s) {
      // The simulation runs the first time the shot is drawn (about a second).
      s.sim ??= simulateMerger(s.data);
      const sim = s.sim;
      const st = simT(c.time);
      const f = Math.min(sim.frames.length - 1.001, Math.max(0, st / (MERGER.sub * MERGER.dt)));
      const i0 = Math.floor(f), w = f - i0;
      const A = sim.frames[i0], B = sim.frames[i0 + 1];
      const ca = sim.cores[i0], cb = sim.cores[i0 + 1];
      const core = (o: number): Vec3 => [ca[o] + (cb[o] - ca[o]) * w, ca[o + 1] + (cb[o + 1] - ca[o + 1]) * w, ca[o + 2] + (cb[o + 2] - ca[o + 2]) * w];
      const cA = core(0), cB = core(3);
      const mid = v3.lerp(cA, cB, MERGER.M[1] / (MERGER.M[0] + MERGER.M[1]));
      // Between key frames a star moves on an arc around its galaxy's core, not along the chord
      // (near the centre it turns a good part of an orbit per key frame, and the chord would make
      // the inner disk breathe): interpolate its direction and its distance from the core. Once
      // the cores have merged, the centre is their centre of mass.
      const merged = smoothstep(0.9, 0.4, v3.len(v3.sub(cB, cA)));
      const Q = 1 / MERGER.Q;
      const buf = s.buf;
      const host = s.host;
      const n = buf.length / 3;
      const [m0, m1, m2] = mid;
      for (let i = 0; i < n; i++) {
        const o = i * 3, k = host[i] * 3;
        // Centre at each key frame (the centre of mass does not move).
        const ax0 = ca[k] + (m0 - ca[k]) * merged, ay0 = ca[k + 1] + (m1 - ca[k + 1]) * merged, az0 = ca[k + 2] + (m2 - ca[k + 2]) * merged;
        const bx0 = cb[k] + (m0 - cb[k]) * merged, by0 = cb[k + 1] + (m1 - cb[k + 1]) * merged, bz0 = cb[k + 2] + (m2 - cb[k + 2]) * merged;
        const ax = A[o] * Q - ax0, ay = A[o + 1] * Q - ay0, az = A[o + 2] * Q - az0;
        const bx = B[o] * Q - bx0, by = B[o + 1] * Q - by0, bz = B[o + 2] * Q - bz0;
        const la = Math.sqrt(ax * ax + ay * ay + az * az), lb = Math.sqrt(bx * bx + by * by + bz * bz);
        const cosT = (ax * bx + ay * by + az * bz) / (la * lb + 1e-12);
        let wa = 1 - w, wb = w;
        if (cosT < 0.9995 && cosT > -0.99) {
          const th = Math.acos(cosT), sn = Math.sin(th);
          const len = la + (lb - la) * w;
          wa = (Math.sin((1 - w) * th) / sn) * (len / (la + 1e-12));
          wb = (Math.sin(w * th) / sn) * (len / (lb + 1e-12));
        }
        buf[o] = ax0 + (bx0 - ax0) * w + ax * wa + bx * wb;
        buf[o + 1] = ay0 + (by0 - ay0) * w + ay * wa + by * wb;
        buf[o + 2] = az0 + (bz0 - az0) * w + az * wa + bz * wb;
      }
      const nS3 = MERGER.stars * 3;
      s.stars.update({ position: buf.subarray(0, nS3) });
      s.dust.update({ position: buf.subarray(nS3) });
      // Starbursts: a first flush as the disks graze, the great one when they collide.
      const hit = MERGER.tHit;
      const burst = 0.3 * Math.exp(-Math.pow((st - MERGER.tPass - 1.0) / 1.6, 2)) + smoothstep(hit - 1.2, hit + 1.6, st) * (1 - 0.5 * smoothstep(hit + 3, MERGER.t1, st));
      const burstT = (st - (hit - 1.0)) / (MERGER.t1 - hit);

      const t = c.time - b.start;
      const az = 0.45 + t * 0.05;
      const el = keys(t, [[-1, 0.66], [9, 0.8, 'inOutSine']]);
      const dist = keys(t, [[-1, 8.2], [3.5, 6.9, 'inOutSine'], [9, 6.2, 'inOutSine']]);
      s.cam.set({
        pos: [Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist],
        target: [0, 0, 0],
      }).pan(-0.05 * dist, 0.008 * dist);

      const u = { uMid: mid, uBurst: burst, uCoreA: cA, uCoreB: cB, uBurstT: burstT };
      // Glow: the stars drawn wide and faint at half resolution (twice, at two widths), with
      // the bulges, so the arms, the bridge between the disks and the tails read as light, not dots.
      s.half.clear(0, 0, 0, 1);
      s.stars.draw(s.cam, c.time, { ...u, uGlowPass: 1 }, { blend: 'add', sizeScale: 9.0, brightness: 0.34, count: 16000 });
      s.stars.draw(s.cam, c.time, { ...u, uGlowPass: 1 }, { blend: 'add', sizeScale: 1.8, brightness: 0.6, count: 40000 });
      s.bulge.draw(s.cam, c.time, { ...u, uGlowPass: 1 }, { blend: 'add', brightness: 1.0 + 0.8 * burst });
      c.target.bind();
      s.far.draw(s.cam, c.time, {}, { sky: true });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE);
      c.fullscreen(c.e.program(COPY_ADD, 'copyadd'), { uSrc: s.half });
      c.gl.disable(c.gl.BLEND);
      s.dust.draw(s.cam, c.time, {}, { blend: 'premul' });
      s.stars.draw(s.cam, c.time, { ...u, uGlowPass: 0 }, { blend: 'add' });
      s.bulge.draw(s.cam, c.time, { ...u, uGlowPass: 0 }, { blend: 'add' });
      if (burstT > 0) s.burst.draw(s.cam, c.time, u, { blend: 'add' });
    },
  };
}

// ------------------------------------------------------------------ the last stars
// The merged galaxy from inside, a hundred trillion years on: no gas is left to make stars, and
// the long-lived red dwarfs and the cooling white dwarfs go out one by one. Eight of them die
// on the bells the score rings (timeline.starDeaths).

/** x.x = time of death, x.y = 1 for the stars the score marks, x.z = random. */
const EMBER_ANIMATE = `
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  float e = uTime - x.x;
  // A star reddens as it runs down.
  float cool = smoothstep(-5.0, 0.6, e);
  col *= mix(vec3(1.0), vec3(1.25, 0.5, 0.24), cool * 0.85);
  if (x.y > 0.5) {
    // The marked stars swell for a breath as the bell sounds, then gutter out.
    col *= e < 0.0 ? 1.0 + 1.3 * exp(-e * e / 0.05) : 2.3 * exp(-e * 2.3) * (0.82 + 0.18 * sin(e * 23.0 + x.z * 40.0));
    size *= e < 0.0 ? 1.0 + 0.3 * exp(-e * e / 0.05) : 1.3 - 0.5 * smoothstep(0.0, 1.5, e);
  } else {
    col *= 1.0 - smoothstep(-1.4, 0.0, e);
  }
  if (e > 3.0) size = 0.0;
  return p;
}`;

/** A small hard core in a wide faint halo (the sprite's sigma is the halo's). */
const EMBER_SHADE = `
vec4 shade(vec2 q, vec3 col, vec4 x) {
  float d2 = dot(q, q);
  float g = exp(-8.0 * d2) + 0.045 * exp(-0.6 * d2);
  return vec4(col * g, g);
}`;

/** The unresolved light of the dying galaxy: a dim red glow towards its centre. */
const EMBER_GLOW = `
#include <noise>
#include <camera>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uAmt;
uniform vec3 uCentre;
void main() {
  vec3 rd = camRay(centered(vUv, uAspect));
  float c = dot(rd, normalize(uCentre));
  float glow = exp(-(1.0 - c) / 0.07) + 0.4 * exp(-(1.0 - c) / 0.35);
  float n = 0.7 + 0.6 * fbm(rd * 3.0, 4);
  fragColor = vec4(vec3(0.5, 0.15, 0.06) * glow * n * 0.09 * uAmt, 1.0);
}`;

function lastStars(): Shot<{ stars: Sprites; cam: Camera }> {
  const b = beat('laststars');
  /** Where the camera looks at a time into the beat (a very slow drift). */
  const aim = (t: number): Vec3 => [Math.sin(t * 0.02) * 0.2, 0.02, -1];
  return {
    ...span('laststars', { dIn: 1.0, dOut: 1.2 }),
    setup(e) {
      const r = rng(262);
      const deaths = timeline.starDeaths;
      const n = 6500;
      const d = allocSprites(n);
      const R = 5000;
      for (let i = deaths.length; i < n; i++) {
        // Denser towards the old galaxy's centre, low and to the left.
        let dir = r.onSphere();
        if (r.next() < 0.45) dir = v3.norm(v3.add(v3.scale(v3.norm([-0.5, -0.22, -1]), 1.0), v3.scale(r.onSphere(), Math.abs(r.gauss()) * 0.45)));
        d.position.set(v3.scale(dir, R), i * 3);
        const white = r.next() < 0.2;
        // Red dwarfs, and white dwarfs cooling towards black.
        const c = blackbody(white ? r.range(5500, 11000) : r.range(2300, 3700));
        const m = (white ? 0.6 : 1.0) * (0.3 + Math.pow(r.next(), 4) * 2.6 + Math.pow(r.next(), 16) * 14);
        d.color.set([c[0] * m, c[1] * m, c[2] * m], i * 3);
        d.size[i] = 0.0028 * R;
        // Most go early: by the last bell the sky is all but empty (a few faint ones outlast
        // the shot, and go out behind the black hole that follows).
        const tDeath = b.start - 0.5 + Math.pow(r.next(), 1.3) * (b.end - b.start + 1.6);
        d.extra!.set([tDeath, 0, r.next(), 0], i * 4);
      }
      // The eight the score marks, set around the caption.
      const at: [number, number][] = [[-0.31, 0.09], [0.25, 0.16], [-0.13, -0.2], [0.37, -0.05], [-0.44, -0.08], [-0.06, 0.2], [0.27, -0.21], [-0.5, 0.19]];
      deaths.forEach((td, k) => {
        const a = aim(td - b.start);
        const p = at[k % at.length];
        const dir = v3.norm([a[0] + p[0], a[1] + p[1], -1]);
        d.position.set(v3.scale(dir, R), k * 3);
        const white = k % 3 === 1;
        const c = blackbody(white ? 8200 : 3000 + 180 * k);
        const m = k === deaths.length - 1 ? 16 : white ? 9 : 12;
        d.color.set([c[0] * m, c[1] * m, c[2] * m], k * 3);
        d.size[k] = 0.0068 * R;
        d.extra!.set([td, 1, r.next(), 0], k * 4);
      });
      return {
        stars: new Sprites(e, d, { animate: EMBER_ANIMATE, shade: EMBER_SHADE, minPixels: 2.6, extent: 3.2 }),
        cam: new Camera({ fov: 45 }),
      };
    },
    render(c, s) {
      const t = c.time - b.start;
      s.cam.set({ pos: [0, 0, 0], target: aim(t), roll: 0.03 * Math.sin(t * 0.11) });
      c.fullscreen(c.e.program(EMBER_GLOW, 'emberglow'), {
        ...s.cam.uniforms(),
        uCentre: [-0.5, -0.22, -1],
        uAmt: keys(c.time, [[b.start - 0.5, 1.0], [b.end - 1.5, 0.0, 'inOutSine']]),
      });
      s.stars.draw(s.cam, c.time, {}, { sky: true, blend: 'add' });
    },
  };
}

// ------------------------------------------------------------------ black holes (geodesic ray tracer)
// film/shaders/blackhole-trace.glsl integrates every ray's null geodesic around a Schwarzschild
// hole. Lengths are in Schwarzschild radii (the hole starts with rs = 1 at the origin, its disk
// in the plane y = 0).
function blackHoles(): Shot<{ cam: Camera }> {
  const b0 = beat('blackholes'), b1 = beat('evaporation');
  const lf = cues.lastFlash;
  /** The hole begins to shrink a moment after the caption says so. */
  const T_EVAP = b1.start;
  return {
    id: 'blackholes',
    start: b0.start - 0.6,
    end: b1.end + 0.6,
    fadeIn: 1.2,
    fadeOut: 1.2,
    setup: () => ({ cam: new Camera({ fov: 36 }) }),
    render(c, s) {
      const t = c.time - b0.start;
      // A slow arc that climbs from almost edge-on: the far side of the disk, lifted over the
      // shadow by the hole's gravity, opens as the camera rises, then a push in as the hole shrinks.
      const az = -0.62 + t * 0.034;
      const el = keys(t, [[-1, 0.075], [9, 0.18, 'inOutSine'], [16, 0.21, 'inOutSine']]);
      const dist = keys(t, [[-1, 31], [8, 25.5], [13.5, 15, 'inOutSine'], [16, 13.5]]);
      // Lowered a little so the hole sits above its caption.
      s.cam.set({ pos: [Math.sin(az) * dist * Math.cos(el), dist * Math.sin(el), Math.cos(az) * dist * Math.cos(el)], target: [0, 0, 0] }).pan(0, -0.05 * dist);
      // Evaporation: a hole radiates as 1/M^2, so its mass (and radius) falls as the cube root
      // of the time it has left, slowly for almost all of its life and then all at once, while
      // its temperature (1/M) and brightness run away.
      const left = Math.min(1, Math.max(0, (lf - c.time) / (lf - T_EVAP)));
      const gone = c.time >= lf;
      const hot = 1 / Math.max(left, 0.004);
      const age = c.time - lf;
      c.fullscreen(c.e.program('#include <arrow-of-time/blackhole-trace>', 'blackhole'), {
        ...s.cam.uniforms(),
        uRs: gone ? 0 : Math.max(Math.pow(left, 0.4), 0.02),
        // The disk starves: with nothing left to fall in it drains from the outside, cools and goes out.
        uDisk: keys(c.time, [[b0.start + 5.5, 1.0], [b1.start + 1.8, 0.0, 'inOutSine']]),
        uDiskOut: keys(c.time, [[b0.start + 4.2, 13.5], [b1.start + 1.5, 3.4, 'inOutSine']]),
        uDiskHeat: keys(c.time, [[b0.start + 4.5, 1.0], [b1.start + 1.5, 0.5, 'inOutSine']]),
        uDiskT: 0.5 * (t + 40),
        uDoppler: 0.9,
        uHawking: gone || c.time < T_EVAP ? 0 : 0.085 * Math.pow(hot, 0.85) * prog(c.time, T_EVAP + 0.2, T_EVAP + 1.6, 'inOutSine'),
        uHawkT: Math.min(1500 * Math.pow(hot, 0.55), 20000),
        uHawkFill: 0.7 * prog(left, 0.3, 0.0, 'inQuad'),
        // The very last embers go out behind the hole.
        uSky: keys(c.time, [[b0.start, 1.0], [b0.start + 2, 0.9], [b0.start + 6, 0.0, 'inOutSine']]),
        uFlash: gone ? Math.exp(-age * 1.5) : 0,
        uFlashR: Math.max(age, 0) * 9.0,
      });
    },
  };
}

// ------------------------------------------------------------------ heat death and epilogue
/**
 * The photons of the last flash, flying apart as space stretches: each dims and reddens until
 * there is nothing. x.x = when it is gone (seconds after the flash). Uniform: uT.
 */
const PHOTON_ANIMATE = `
uniform float uT;
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  float s = exp(uT * 0.06);
  float fade = smoothstep(0.6, 2.4, uT) * (1.0 - smoothstep(x.x - 3.0, x.x, uT));
  col *= mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.22, 0.08), saturate((uT - 1.0) / 8.0)) * fade / (s * s);
  if (fade <= 0.0) size = 0.0;
  return vec3(0.0, 0.0, -22.0) + p * s;
}`;

function heatDeath(): Shot<{ photons: Sprites; cam: Camera }> {
  const b = beat('heatdeath');
  return {
    id: 'heatdeath',
    // In under the end of the flash, so its light is seen to thin out into the dark.
    start: b.start - 2.0,
    end: b.end + 0.75,
    fadeIn: 1.6,
    fadeOut: 1.5,
    setup(e) {
      const r = rng(331);
      const n = 1100;
      const d = allocSprites(n);
      for (let i = 0; i < n; i++) {
        const dir = r.onSphere();
        const rad = 2.5 + Math.pow(r.next(), 0.6) * 7.5;
        d.position.set([dir[0] * rad, dir[1] * rad * 0.8, dir[2] * rad], i * 3);
        const m = 0.05 + Math.pow(r.next(), 5) * 0.5;
        d.color.set([m, m, m], i * 3);
        d.size[i] = 0.007;
        d.extra!.set([r.range(3.6, 8.2), 0, r.next(), 0], i * 4);
      }
      return { photons: new Sprites(e, d, { animate: PHOTON_ANIMATE, minPixels: 0.8 }), cam: new Camera({ fov: 40 }) };
    },
    render(c, s) {
      s.cam.set({ pos: [0, 0, 0], target: [0, 0.9, -22] });
      s.photons.draw(s.cam, c.time, { uT: c.time - cues.lastFlash }, { blend: 'add' });
    },
  };
}

/**
 * Voyager 1's last look home (14 February 1990): sunlight scattered in the camera fans across
 * the frame in soft rays, and in one of them, less than a pixel wide, is the Earth.
 */
export const PALE_BLUE_DOT = `
#include <noise>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uAmt, uWarm, uDot;
uniform vec2 uDotPos;
void main() {
  vec2 p = centered(vUv, uAspect);
  // The Sun is just out of frame, up and to the right; its rays fan out from there.
  vec2 src = vec2(1.32, 1.02);
  vec2 d = p - src;
  float ang = atan(d.y, d.x), dist = length(d);
  float a0 = atan(uDotPos.y - src.y, uDotPos.x - src.x);
  // Fine streaks along the rays, and the slow mottling of a long exposure.
  float fine = 0.72 + 0.56 * fbm(vec2(ang * 190.0, dist * 0.8 + uGTime * 0.004), 4);
  float broad = 0.8 + 0.4 * fbm(vec2(ang * 9.0 + 3.0, dist * 1.4), 3);
  vec3 col = vec3(0.0);
  float x;
  x = (ang - a0) / 0.07;           col += mix(vec3(1.0, 0.9, 0.74), vec3(1.0, 0.82, 0.58), uWarm) * exp(-x * x) * 1.0;
  x = (ang - a0 - 0.2) / 0.045;    col += mix(vec3(0.7, 0.86, 0.78), vec3(0.95, 0.8, 0.55), uWarm) * exp(-x * x) * 0.42;
  x = (ang - a0 + 0.24) / 0.09;    col += mix(vec3(1.0, 0.62, 0.36), vec3(1.0, 0.6, 0.32), uWarm) * exp(-x * x) * 0.5;
  x = (ang - a0 - 0.37) / 0.035;   col += mix(vec3(0.6, 0.7, 1.0), vec3(0.85, 0.75, 0.7), uWarm) * exp(-x * x) * 0.22;
  x = (ang - a0 + 0.47) / 0.06;    col += vec3(1.0, 0.7, 0.45) * exp(-x * x) * 0.2;
  // Brighter towards the Sun.
  col *= fine * broad * (0.35 + 0.65 / (0.25 + dist * dist)) * 0.115 * uAmt;
  // The frame's own grain.
  col *= 0.86 + 0.28 * vnoise(vUv * uRes / 2.2);
  // Earth: a pale blue point, a little over a pixel across, and the faintest halo.
  float r = length(p - uDotPos) * uRes.y;
  float sig = 1.1 * uRes.y / 1080.0;
  float dot = exp(-0.5 * r * r / (sig * sig)) + 0.045 * exp(-r / (4.5 * sig));
  col += mix(vec3(0.42, 0.62, 1.0), vec3(0.55, 0.72, 1.0), uWarm) * dot * uDot;
  fragColor = vec4(col, 1.0);
}`;

function epilogue(): Shot<{ cam: Camera; sky: Sprites }> {
  const e = beat('epilogue');
  return {
    ...span('epilogue', { dIn: 1.5, dOut: 0 }),
    setup(en) {
      return { cam: new Camera({ fov: 32 }), sky: new Sprites(en, starSphere(rng(296), { count: 7000, brightness: 0.1 })) };
    },
    render(c, s) {
      // The slowest of drifts: the stars turn a degree over the whole epilogue.
      const t = c.time - e.start;
      s.cam.set({ pos: [0, 0, 0], target: [Math.sin(0.0009 * t), 0.0004 * t, -1] });
      const out = 1 - prog(c.time, e.end - 3, e.end - 0.5, 'inOutSine');
      const stars = prog(c.time, e.start + 4, e.start + 13, 'inOutSine') * (1 - prog(c.time, e.end - 2.5, e.end, 'inOutSine'));
      s.sky.draw(s.cam, c.time, {}, { sky: true, brightness: stars });
      const warm = prog(c.time, cues.picardy, cues.picardy + 3, 'inOutSine');
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE);
      c.fullscreen(c.e.program(PALE_BLUE_DOT, 'palebluedot'), {
        uAmt: prog(c.time, e.start + 4.5, e.start + 10, 'inOutSine') * out * (1 + 0.25 * warm),
        uWarm: warm,
        uDot: prog(c.time, e.start + 6.5, e.start + 10.5, 'inOutSine') * out * (3.2 + 1.8 * warm),
        // Above the lines and the title, right of centre.
        uDotPos: [0.19, 0.172],
      });
      c.gl.disable(c.gl.BLEND);
    },
  };
}

export function endShots(): Shot[] {
  return [merger(), lastStars(), blackHoles(), heatDeath(), epilogue()];
}

/**
 * Look overrides for this file's beats (bloom, streak, exposure, grade...), merged last in
 * project.ts. Return {} outside them so other shots keep the film's look.
 */
export function endLook(time: number): Partial<Look> {
  const lf = cues.lastFlash;
  const bh = beat('blackholes'), ev = beat('evaporation');
  // The disk: no anamorphic streak (its blue smear would cross the shadow, which must stay
  // black), and a little more bloom, so the gas glows.
  if (time > bh.start - 0.6 && time < ev.start + 1.8) {
    return { streak: 0, bloom: keys(time, [[bh.start - 0.6, 0.075], [bh.start + 1, 0.11], [ev.start, 0.11], [ev.start + 1.8, 0.075]]) };
  }
  // The last flash is light from the scene itself (a point and its bloom), not a veil over
  // the frame: no display-space flash, and a shorter exposure kick than the film's default.
  if (time > lf - 0.5 && time < lf + 6) {
    return { flash: 0, exposure: time >= lf ? 1.1 * Math.exp(-(time - lf) * 3.2) : 0 };
  }
  return {};
}
