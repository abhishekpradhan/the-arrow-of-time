// The Moon-forming impact, played back from a smoothed-particle-hydrodynamics simulation: a
// Mars-sized Theia strikes the proto-Earth at 45 degrees and the mutual escape speed (SWIFT with
// WoMa initial conditions and ANEOS equations of state; tools/assets/giant_impact/README.md).
// Every sprite is a simulated parcel of rock or iron at its simulated temperature: it glows as a
// blackbody and absorbs what lies behind it, so hot vapour is a translucent veil and the planets
// stay solid. Theia grazes the Earth and swings out on a tidal bridge; its remnant falls back and
// hits again (cue theiaReturn), flinging out a long arm that breaks into clumps and a disk. Years
// later (cue moonBorn) the disk has become the Moon.
import { Camera, Planet, Sprites, allocSprites, blackbody, keys, prog, rng, spline, starSphere, v3, type Shot, type ShotContext, type SpriteData, type Vec3 } from '@engine';
import META from '../../../assets/giant-impact/impact.json';
import { beat, cues, span } from '../lib';

interface Impact {
  n: number;
  frames: number;
  /** Hours after first contact, per frame. */
  times: number[];
  pos: Int16Array;
  temp: Uint8Array;
  h: Uint8Array;
  kind: Uint8Array;
  grow: Uint8Array;
}

/** h code of a particle that has left the simulation box. */
const GONE = 255;

/** Decode assets/giant-impact (format: tools/assets/build_giant_impact.py). */
async function loadImpact(): Promise<Impact> {
  let buf = await (await fetch('/assets/giant-impact/impact.bin.gz')).arrayBuffer();
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  const b = new Uint8Array(buf);
  const { n, frames: f, times: T } = META;
  const N3 = n * 3;
  // Positions: zigzag varint residuals of a linear prediction from the two previous frames.
  // Int16Array stores wrap modulo 2^16, exactly like the encoder's wrap16.
  const pos = new Int16Array(f * N3);
  let o = 0;
  for (let k = 0; k < f; k++) {
    const rho = k >= 2 ? (T[k] - T[k - 1]) / (T[k - 1] - T[k - 2]) : 0;
    for (let i = k * N3, e = i + N3; i < e; i++) {
      let z = b[o++];
      if (z & 0x80) {
        const z1 = b[o++];
        z = (z & 0x7f) | ((z1 & 0x7f) << 7);
        if (z1 & 0x80) z |= b[o++] << 14;
      }
      const r = z & 1 ? -((z + 1) >> 1) : z >> 1;
      if (k === 0) pos[i] = r;
      else if (k === 1) pos[i] = pos[i - N3] + r;
      else {
        const q1 = pos[i - N3], q0 = pos[i - 2 * N3];
        pos[i] = q1 + Math.floor((q1 - q0) * rho + 0.5) + r;
      }
    }
  }
  if (o !== META.posBytes) throw new Error(`giant-impact: decoded ${o} position bytes, expected ${META.posBytes}`);
  // Temperature and smoothing-length codes: frame-to-frame differences (Uint8Array wraps mod 256).
  const plane = () => {
    const a = b.slice(o, o + f * n);
    o += f * n;
    for (let i = n; i < f * n; i++) a[i] = a[i] + a[i - n];
    return a;
  };
  const temp = plane();
  const h = plane();
  const kind = b.slice(o, o + n);
  const grow = b.slice(o + n, o + 2 * n);
  return { n, frames: f, times: T, pos, temp, h, kind, grow };
}

const decode = (code: number, lo: number, hi: number) => lo * Math.pow(hi / lo, code / 254);
/** Temperature code of 2600 K: above it, rock glows more than it reflects. */
const COOL_CODE = (254 * Math.log(2600 / META.tempMin)) / Math.log(META.tempMax / META.tempMin);

/**
 * Emission per temperature code, from knots of (parcel temperature K, colour temperature K,
 * brightness). An optically thick hot body glows at the temperature of its cooler photosphere,
 * so colour and brightness climb far more slowly than the parcel temperature: 2000 K rock barely
 * glows, the molten Earth after the impacts is orange, and only the shock front runs white.
 */
const RAMP: [number, number, number][] = [
  [1800, 1300, 0], [2000, 1600, 0.02], [2600, 2000, 0.16], [3500, 2350, 0.26], [5000, 2600, 0.33],
  [8000, 3000, 0.45], [15000, 4000, 0.9], [30000, 5500, 1.8], [60000, 7000, 2.6],
];
const GLOW = (() => {
  const out = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const T = decode(i, META.tempMin, META.tempMax);
    let j = 0;
    while (j < RAMP.length - 2 && RAMP[j + 1][0] < T) j++;
    const [t0, c0, l0] = RAMP[j], [t1, c1, l1] = RAMP[j + 1];
    const f = Math.min(1, Math.max(0, Math.log(T / t0) / Math.log(t1 / t0)));
    const c = blackbody(c0 + (c1 - c0) * f);
    const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] || 1;
    const L = l0 + (l1 - l0) * f;
    out.set([(c[0] / y) * L, (c[1] / y) * L, (c[2] / y) * L], i * 3);
  }
  return out;
})();

/** Film time -> hours after first contact: slow through each impact, faster as the disk settles. */
function simHours(time: number): number {
  const { theia, theiaReturn: ret, moonBorn: born } = cues;
  return spline(time, [
    [theia - 2.3, -0.75],
    [theia, 0],
    [theia + 1.7, 1.1],
    [theia + 3.1, 3.2],
    [ret - 0.6, 5.5],
    [ret, 6.1],
    [ret + 1.5, 9.0],
    [born - 0.6, 13.0],
    [born + 0.7, 19.0],
  ]);
}

/**
 * One camera for the simulation and the years-later shot, so the dissolve between them lines up.
 * It looks down on the orbital plane from above the Earth's night side, towards where the debris
 * goes, with Theia coming in from the lower right; it pulls back as the arms unwind, then comes
 * down to the Earth and the young Moon. The lower left stays clear for the caption.
 */
function frame(cam: Camera, time: number) {
  const { theia, theiaReturn: ret, moonBorn: born } = cues;
  const az = spline(time, [[theia - 2.5, 1.12], [ret, 1.3], [born + 2, 1.55]]);
  const el = spline(time, [[theia - 2.5, 0.5], [theia + 1, 0.6], [ret + 1.5, 0.85], [born, 0.9], [born + 1.8, 0.42]]);
  const dist = spline(time, [[theia - 2.5, 12], [theia + 0.2, 9.5], [theia + 3, 13], [ret, 15.5], [ret + 1.8, 24], [born - 1.2, 24], [born + 1.4, 10]]);
  const panX = spline(time, [[theia - 2.5, -0.13], [born, -0.13], [born + 1.8, -0.2]]);
  const panY = spline(time, [[theia - 2.5, 0.02], [ret, 0.08], [ret + 1.8, 0.16], [born, 0.16], [born + 1.8, 0.03]]);
  cam.set({ pos: [Math.sin(az) * dist * Math.cos(el), dist * Math.sin(el), Math.cos(az) * dist * Math.cos(el)], target: [0, 0, 0], fov: 36 });
  cam.pan(panX * dist, panY * dist);
  // Then down to the young Earth, arriving at the oceans shot's view as that shot dissolves in.
  const k = prog(time, born - 1.0, beat('oceans').start - 0.2, 'inOutSine');
  if (k > 0) {
    const v = youngEarthView(time);
    cam.set({ pos: v3.lerp(cam.pos, v.pos, k), target: v3.lerp(cam.target, v.target, k), fov: 36 + (v.fov - 36) * k });
  }
}

/** The camera of the oceans shot (which continues from here): the Earth large, right of centre. */
export function youngEarthView(time: number): { pos: Vec3; target: Vec3; fov: number } {
  const t = time - beat('oceans').start;
  return { pos: [0.3, 0.35, keys(t, [[-1, 5.2], [9, 4.3, 'inOutSine']])], target: [-0.5, 0, 0], fov: 34 };
}

/**
 * Where the Moon hangs in the last shots: on one line of sight from the oceans camera, close (a
 * few Earth radii, just outside the Roche limit) when it has just formed, farther by the time
 * the oceans form. Across the dissolve it seems to recede.
 */
export function moonAt(recede: number): Vec3 {
  const eye: Vec3 = [0.3, 0.35, 5.2];
  const dir = v3.norm([-0.5, 0.1, -1]);
  return v3.add(eye, v3.scale(dir, 8.5 + 7.5 * recede));
}

/** Direction to the Sun (world). */
const SUN: Vec3 = v3.norm([-0.7, 0.3, 0.6]);

/** Premultiplied emission and absorption: opacity 1 - exp(-tau), tau Gaussian over the sprite. */
const SHADE = `
vec4 shade(vec2 q, vec3 col, vec4 x) {
  float a = 1.0 - exp(-x.x * exp(-0.5 * dot(q, q)));
  return vec4(col * a, a);
}`;

/**
 * The two impacts, where the shocked vapour flares (world directions of the hottest parcels in
 * the simulation just after each contact) and how strongly.
 */
const IMPACTS: { cue: 'theia' | 'theiaReturn'; dir: Vec3; amp: number }[] = [
  { cue: 'theia', dir: [0.77, 0, -0.64], amp: 1 },
  { cue: 'theiaReturn', dir: [0.91, 0, -0.41], amp: 0.55 },
];

interface SimState {
  data: Impact;
  sph: Sprites;
  flash: Sprites;
  flashData: SpriteData;
  cam: Camera;
  sky: Sprites;
  world: Float32Array;
  depth: Float32Array;
  index: Uint32Array;
  out: { position: Float32Array; color: Float32Array; size: Float32Array; extra: Float32Array };
}

export function giantImpact(): Shot<SimState> {
  return {
    ...span('moon', { dIn: 0.6 }),
    end: cues.moonBorn + 0.6,
    fadeOut: 1.4,
    async setup(e) {
      const data = await loadImpact();
      const n = data.n;
      const buf = allocSprites(n);
      const flashData = allocSprites(IMPACTS.length * 2);
      return {
        data,
        sph: new Sprites(e, buf, { shade: SHADE, minPixels: 0.7, extent: 3 }),
        flash: new Sprites(e, flashData, { minPixels: 1, maxPixels: 700 }),
        flashData,
        cam: new Camera({ fov: 36, far: 500 }),
        sky: new Sprites(e, starSphere(rng(100), { count: 8000, brightness: 0.35 })),
        world: new Float32Array(n * 3),
        depth: new Float32Array(n),
        index: new Uint32Array(n),
        out: { position: buf.position, color: buf.color, size: buf.size, extra: buf.extra! },
      };
    },
    render(c, s) {
      frame(s.cam, c.time);
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      drawSim(c, s, simHours(c.time));
      // Each contact flares: a white-hot core that fades fast inside a wider orange glow.
      const F = s.flashData;
      IMPACTS.forEach(({ cue, dir, amp }, j) => {
        const age = c.time - cues[cue];
        const on = age < 0 ? 0 : amp;
        const p = v3.scale(v3.norm(dir), 1.02);
        F.position.set(p, j * 6);
        F.position.set(p, j * 6 + 3);
        const hot = on * Math.exp(-age * 4.5), warm = on * Math.exp(-age * 1.8);
        F.color.set([7 * hot, 5.6 * hot, 3.8 * hot], j * 6);
        F.color.set([0.7 * warm, 0.32 * warm, 0.1 * warm], j * 6 + 3);
        F.size[j * 2] = 0.1 + 0.15 * Math.min(age, 1);
        F.size[j * 2 + 1] = 0.35 + 0.35 * Math.min(age, 1.5);
      });
      s.flash.update(F);
      s.flash.draw(s.cam, c.time, {}, { blend: 'add' });
    },
  };
}

function drawSim(c: ShotContext, s: SimState, hours: number) {
  const D = s.data, T = D.times, n = D.n;
  let k = 0;
  while (k < D.frames - 2 && T[k + 1] <= hours) k++;
  const k0 = Math.max(0, k - 1), k2 = Math.min(D.frames - 1, k + 1), k3 = Math.min(D.frames - 1, k + 2);
  const dt = Math.max(1e-6, T[k2] - T[k]);
  const u = Math.min(1, Math.max(0, (hours - T[k]) / dt));
  // Cubic Hermite with Catmull-Rom tangents on the uneven frame times.
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = 3 * u2 - 2 * u3, h11 = u3 - u2;
  const m0 = dt / Math.max(1e-6, T[k2] - T[k0]), m1 = dt / Math.max(1e-6, T[k3] - T[k]);
  const P = D.pos, q = META.posScale, H = D.h;
  const { fwd } = s.cam.basis();
  const cp = s.cam.pos;
  const W = s.world;
  // Theia's centre, for sunlight on it while it is still a planet (simulation axes).
  const ta = META.theiaCentre[k], tb = META.theiaCentre[k2];
  const tc: Vec3 = [ta[0] + (tb[0] - ta[0]) * u, ta[2] + (tb[2] - ta[2]) * u, -(ta[1] + (tb[1] - ta[1]) * u)];
  const theiaLit = 1 - prog(hours, -0.05, 0.6);
  let live = 0;
  for (let i = 0; i < n; i++) {
    if (H[k * n + i] === GONE || H[k2 * n + i] === GONE) continue;
    const a0 = (k0 * n + i) * 3, a1 = (k * n + i) * 3, a2 = (k2 * n + i) * 3, a3 = (k3 * n + i) * 3;
    const lin0 = H[k0 * n + i] === GONE, lin1 = H[k3 * n + i] === GONE;
    let x = 0, y = 0, z = 0;
    for (let j = 0; j < 3; j++) {
      const p1 = P[a1 + j], p2 = P[a2 + j];
      const t0 = lin0 ? p2 - p1 : (p2 - P[a0 + j]) * m0;
      const t1 = lin1 ? p2 - p1 : (P[a3 + j] - p1) * m1;
      const v = (h00 * p1 + h10 * t0 + h01 * p2 + h11 * t1) * q;
      // Simulation: orbital plane xy, spin axis +z. Film: y is up.
      if (j === 0) x = v;
      else if (j === 1) z = -v;
      else y = v;
    }
    W[i * 3] = x;
    W[i * 3 + 1] = y;
    W[i * 3 + 2] = z;
    s.depth[i] = (x - cp[0]) * fwd[0] + (y - cp[1]) * fwd[1] + (z - cp[2]) * fwd[2];
    s.index[live++] = i;
  }
  // Back to front.
  const order = s.index.subarray(0, live);
  const depth = s.depth;
  order.sort((a, b) => depth[b] - depth[a]);

  const O = s.out;
  const sigRef = 0.023; // sprite sigma of a full-resolution parcel inside the planets (Earth radii)
  const vx = -fwd[0], vy = -fwd[1], vz = -fwd[2];
  for (let r = 0; r < live; r++) {
    const i = order[r];
    const x = W[i * 3], y = W[i * 3 + 1], z = W[i * 3 + 2];
    O.position[r * 3] = x;
    O.position[r * 3 + 1] = y;
    O.position[r * 3 + 2] = z;
    const tcode = D.temp[k * n + i] + (D.temp[k2 * n + i] - D.temp[k * n + i]) * u;
    const ti = Math.min(254, Math.round(tcode)) * 3;
    const hh = decode(H[k * n + i] + (H[k2 * n + i] - H[k * n + i]) * u, META.hMin, META.hMax);
    const grow = D.grow[i] / 32;
    // The body a parcel belongs to, for shading: Theia while it holds together, else the Earth.
    const onTheia = (D.kind[i] & 1) === 1 && theiaLit > 0;
    const cx = onTheia ? tc[0] : 0, cy = onTheia ? tc[1] : 0, cz = onTheia ? tc[2] : 0;
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / dl, ny = dy / dl, nz = dz / dl;
    // Parcels on a planet's surface are shaded as the planet: sunlit rock, and hot glow that
    // darkens towards the limb. Loose debris just glows.
    const body = (onTheia ? theiaLit : 1) * (1 - prog(dl, 1.15, 1.6));
    const sun = Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]);
    const mu = Math.abs(nx * vx + ny * vy + nz * vz);
    const limb = 1 - body * (0.6 - 0.6 * mu);
    // Reflected sunlight matters only while the rock is cool; glowing melt outshines it.
    const cool = 1 - Math.min(1, Math.max(0, (tcode - COOL_CODE) / 20));
    const rock = 0.3 * cool * (0.2 + 0.8 * body * sun);
    // Sprite: a Gaussian as wide as the parcel's smoothing length (wider when thinned out), with
    // the parcel's mass spread over it as optical depth, so neighbours merge into a continuous
    // fluid. Parcels at the smoothing-length cap are unresolved, isolated droplets: small, soft
    // sparks.
    const spark = hh > 0.09;
    // (Close to the Earth they are its hot vapour envelope: a soft glow rather than sparks.)
    const veil = spark ? 1 - prog(Math.hypot(x, y, z), 1.3, 2.3) : 0;
    const glow = limb * (spark ? 0.6 - 0.25 * veil : 1);
    O.color[r * 3] = GLOW[ti] * glow + rock * 0.6;
    O.color[r * 3 + 1] = GLOW[ti + 1] * glow + rock * 0.45;
    O.color[r * 3 + 2] = GLOW[ti + 2] * glow + rock * 0.32;
    const sig = spark ? 0.028 + 0.1 * veil : Math.max(0.01, 0.55 * hh * grow);
    O.size[r] = sig;
    O.extra[r * 4] = spark ? 0.7 - 0.6 * veil : Math.min(2.5, 1.3 * grow ** 3 * (sigRef / sig) ** 2);
  }
  s.sph.update(O);
  s.sph.draw(s.cam, c.time, {}, { blend: 'premul', count: live });
}

/** Years later: a molten Earth and the newborn Moon, close and huge. */
export function youngMoon(): Shot<{ cam: Camera; sky: Sprites; earth: Planet; moon: Planet }> {
  return {
    ...span('moon', { dOut: 1.2 }),
    start: cues.moonBorn - 0.8,
    fadeIn: 1.4,
    setup: (e) => ({
      cam: new Camera({ fov: 36, far: 500 }),
      sky: new Sprites(e, starSphere(rng(100), { count: 8000, brightness: 0.35 })),
      earth: new Planet(e),
      moon: new Planet(e),
    }),
    render(c, s) {
      frame(s.cam, c.time);
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      // A magma ocean, its crust just forming (the oceans shot carries on from this look).
      const crust = keys(c.time, [[cues.moonBorn, 0.25], [beat('oceans').start, 0.6]]);
      s.earth.draw(c, s.cam, { center: [0, 0, 0], radius: 1, spin: c.time * 0.05, tilt: 0.3, sunDir: SUN, seed: 3, lava: 1, crust, atmo: 0.6, atmoColor: [0.9, 0.45, 0.2], nightGlow: 1.3, depthTest: true });
      s.moon.draw(c, s.cam, { center: moonAt(0), radius: 0.27, spin: c.time * 0.03, sunDir: SUN, seed: 41, lava: 0.7, crust: 0.45, moon: 0.3, nightGlow: 1.2, depthTest: true });
    },
  };
}
