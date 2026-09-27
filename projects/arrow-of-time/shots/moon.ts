// The molten Earth and the Moon-forming impact, as one continuous shot. The impact is played back
// from a smoothed-particle-hydrodynamics simulation: a Mars-sized Theia strikes the proto-Earth
// at 45 degrees and the mutual escape speed (SWIFT with WoMa initial conditions and ANEOS
// equations of state; tools/assets/giant_impact/README.md).
//
// The Earth stays the same rendered planet from the 'earth' beat to the young Moon, so nothing
// jumps: the camera pulls back from the battered magma world as Theia, another molten planet,
// falls in on the orbit the simulation starts from. At first contact Theia hands over to its
// simulated parcels. Every sprite is a parcel of rock or iron at its simulated temperature: it
// glows as a blackbody and absorbs what lies behind it, so hot vapour is a translucent veil and
// clumps stay solid. The Earth's own parcels show only where they rise out of the planet (the
// hot envelope, the spray, the arms). Theia grazes the Earth and swings out on a tidal bridge;
// its remnant falls back and hits again (cue theiaReturn), flinging out a long arm that breaks
// into clumps and a disk. Years later (cue moonBorn) the disk has become the Moon.
import { Camera, Planet, Sprites, allocSprites, blackbody, hash1, keys, planetLocal, prog, rng, spline, starSphere, v3, type PlanetParams, type Shot, type ShotContext, type SpriteData, type Vec3 } from '@engine';
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
const tempCode = (T: number) => (254 * Math.log(T / META.tempMin)) / Math.log(META.tempMax / META.tempMin);
/** Temperature code of 2600 K: above it, rock glows more than it reflects. */
const COOL_CODE = tempCode(2600);
/** The crust survives up to about 2300 K and is gone by 3200 K. */
const CRUST_LO = tempCode(2300), CRUST_HI = tempCode(3200);

/**
 * A lava-crust pattern painted on the parcels where they start, like the planets' look: plates
 * of cooled crust (0) between glowing cracks (1), a quarter of a body's radius across. It is
 * carried with the material, so the crust stretches and tears with it; shock heating melts it
 * (drawSim).
 */
function crustPattern(d: Impact): Float32Array {
  const q = META.posScale, c0 = META.theiaCentre[0];
  const out = new Float32Array(d.n);
  for (let i = 0; i < d.n; i++) {
    const theia = (d.kind[i] & 1) === 1;
    const k = 4 / (theia ? 0.566 : 1);
    const x = (d.pos[i * 3] * q - (theia ? c0[0] : 0)) * k;
    const y = (d.pos[i * 3 + 1] * q - (theia ? c0[1] : 0)) * k;
    const z = (d.pos[i * 3 + 2] * q - (theia ? c0[2] : 0)) * k;
    // Worley F2 - F1: small along the borders between cells.
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let f1 = 9, f2 = 9;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (let c = -1; c <= 1; c++) {
          const h = ((ix + a) * 73856093) ^ ((iy + b) * 19349663) ^ ((iz + c) * 83492791);
          const f = Math.hypot(ix + a + hash1(h) - x, iy + b + hash1(h + 1) - y, iz + c + hash1(h + 2) - z);
          if (f < f1) [f1, f2] = [f, f1];
          else if (f < f2) f2 = f;
        }
      }
    }
    out[i] = 1 - prog(f2 - f1, 0.04, 0.16);
  }
  return out;
}

/**
 * Emission per temperature code, from knots of (parcel temperature K, colour temperature K,
 * brightness). An optically thick hot body glows at the temperature of its cooler photosphere,
 * so colour and brightness climb far more slowly than the parcel temperature: 2000 K melt glows
 * a deep orange like the magma between the Earth's crust plates, hotter debris is orange, and
 * only the shock front runs white.
 */
const RAMP: [number, number, number][] = [
  [1500, 1300, 0], [2000, 1750, 0.1], [2600, 2050, 0.22], [3500, 2350, 0.3], [5000, 2600, 0.38],
  [8000, 3000, 0.5], [15000, 4000, 0.9], [30000, 5500, 1.8], [60000, 7000, 2.6],
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

/**
 * Simulation -> film axes. The orbit lies in the simulation's xy plane with its angular momentum
 * along +z, which becomes the film's up (+y), so the Earth still turns the way it does today.
 * Theia arrives from -x and strikes the face turned to the camera.
 */
function toWorld(sx: number, sy: number, sz: number): Vec3 {
  return [-sx, sz, sy];
}

/** G (M_Earth + M_Theia) in Earth radii cubed per hour squared: 4.06e14 m^3/s^2. */
const GM = 20.34;
const APPROACH_STEP = 0.01;

/**
 * Theia's centre before the simulation's first frame (0.8 h before contact): its orbit traced
 * back from the first three frames (simulation axes, one point per APPROACH_STEP hours).
 */
const APPROACH = (() => {
  const C = META.theiaCentre, dt = META.times[1] - META.times[0];
  const s = [C[0][0], C[0][1], (-3 * C[0][0] + 4 * C[1][0] - C[2][0]) / (2 * dt), (-3 * C[0][1] + 4 * C[1][1] - C[2][1]) / (2 * dt)];
  const f = (v: number[]) => {
    const r3 = Math.hypot(v[0], v[1]) ** 3;
    return [v[2], v[3], (-GM * v[0]) / r3, (-GM * v[1]) / r3];
  };
  const out: [number, number][] = [[s[0], s[1]]];
  const h = -APPROACH_STEP;
  for (let k = 0; k < 300; k++) {
    // Classic Runge-Kutta, backwards in time.
    const k1 = f(s);
    const k2 = f(s.map((v, j) => v + 0.5 * h * k1[j]));
    const k3 = f(s.map((v, j) => v + 0.5 * h * k2[j]));
    const k4 = f(s.map((v, j) => v + h * k3[j]));
    for (let j = 0; j < 4; j++) s[j] += (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
    out.push([s[0], s[1]]);
  }
  return out;
})();

/** Theia's centre (world) at a time in hours after first contact, while it is still a planet. */
function theiaAt(hours: number): Vec3 {
  const T = META.times, C = META.theiaCentre;
  if (hours <= T[0]) {
    const f = Math.min((T[0] - hours) / APPROACH_STEP, APPROACH.length - 1.001);
    const k = Math.floor(f), u = f - k, a = APPROACH[k], b = APPROACH[k + 1];
    return toWorld(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, 0);
  }
  let k = 0;
  while (k < T.length - 2 && T[k + 1] <= hours) k++;
  // Catmull-Rom through the frames on either side, like the parcels.
  const k0 = Math.max(0, k - 1), k2 = k + 1, k3 = Math.min(T.length - 1, k + 2);
  const dt = T[k2] - T[k], u = Math.min(1, (hours - T[k]) / dt);
  const u2 = u * u, u3 = u2 * u;
  const m0 = dt / (T[k2] - T[k0] || 1), m1 = dt / (T[k3] - T[k] || 1);
  const p = [0, 1, 2].map((j) => (2 * u3 - 3 * u2 + 1) * C[k][j] + (u3 - 2 * u2 + u) * (C[k2][j] - C[k0][j]) * m0 + (3 * u2 - 2 * u3) * C[k2][j] + (u3 - u2) * (C[k3][j] - C[k][j]) * m1);
  return toWorld(p[0], p[1], p[2]);
}

/**
 * Film time -> hours after first contact: Theia falls in on its orbit, time slows through each
 * impact and runs faster as the disk settles.
 */
function simHours(time: number): number {
  const { theia, theiaReturn: ret, moonBorn: born } = cues;
  return spline(time, [
    [theia - 3.6, -1.6],
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
 * One camera from the molten Earth to the young Moon (the years-later shot uses it too, so the
 * dissolve between them lines up). It opens close on the Earth, which sits right of centre with
 * the caption on the left. As Theia falls in from the left it pulls back and rises, so the
 * impact is seen from the front and a little above; it keeps rising and pulling back as the arms
 * unwind, then comes down to the Earth and the young Moon.
 */
function frame(cam: Camera, time: number) {
  const { theia, theiaReturn: ret, moonBorn: born } = cues;
  const t0 = beat('earth').start - 1, hold = theia - 3.2;
  const az = spline(time, [[t0, 0.144], [hold, 0.144], [theia, 0.02], [ret, 0.25], [born + 2, 0.5]]);
  const el = spline(time, [[t0, 0.052], [hold, 0.056], [theia, 0.3], [theia + 2, 0.5], [ret + 1.5, 0.85], [born, 0.9], [born + 1.8, 0.42]]);
  const dist = spline(time, [[t0, 4.37], [hold, 3.88], [theia - 1.4, 5.6], [theia, 8.5], [theia + 3, 13], [ret, 15], [ret + 1.8, 19], [born - 1.2, 19.5], [born + 1.4, 10]]);
  const panX = spline(time, [[t0, -0.145], [hold, -0.145], [theia, -0.06], [ret, -0.15], [born, -0.2], [born + 1.8, -0.2]]);
  const panY = spline(time, [[t0, 0.014], [hold, 0.014], [theia, 0.02], [ret, 0.06], [ret + 1.8, 0.1], [born, 0.1], [born + 1.8, 0.03]]);
  const fov = spline(time, [[t0, 32], [hold, 32], [theia, 36]]);
  cam.set({ pos: [Math.sin(az) * dist * Math.cos(el), dist * Math.sin(el), Math.cos(az) * dist * Math.cos(el)], target: [0, 0, 0], fov });
  cam.pan(panX * dist, panY * dist);
  // Then down to the young Earth, arriving at the oceans shot's view as that shot dissolves in.
  const k = prog(time, born - 1.0, beat('oceans').start - 0.2, 'inOutSine');
  if (k > 0) {
    const v = youngEarthView(time);
    cam.set({ pos: v3.lerp(cam.pos, v.pos, k), target: v3.lerp(cam.target, v.target, k), fov: fov + (v.fov - fov) * k });
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

/**
 * Premultiplied emission and absorption: opacity 1 - exp(-tau), tau (x.x) Gaussian over the
 * sprite; x.y fades the whole sprite (parcels half hidden by the Earth, Theia's hand-over).
 */
const SHADE = `
vec4 shade(vec2 q, vec3 col, vec4 x) {
  float a = 1.0 - exp(-x.x * exp(-0.5 * dot(q, q)));
  return vec4(col * a, a) * x.y;
}`;

/**
 * The two impacts, where the shocked vapour flares (world directions of the hottest parcels in
 * the simulation just after each contact) and how strongly.
 */
const IMPACTS: { cue: 'theia' | 'theiaReturn'; dir: Vec3; amp: number }[] = [
  { cue: 'theia', dir: [-0.77, 0, 0.64], amp: 1 },
  { cue: 'theiaReturn', dir: [-0.91, 0, 0.41], amp: 0.55 },
];

/** Small impacts battering the magma ocean before Theia: [local direction, age] (Planet.impacts). */
function bombardment(time: number): [number, number, number, number][] {
  const r = rng(11);
  const list: [number, number, number, number][] = [];
  for (let k = 0; k < 40; k++) {
    const t0 = 93 + k / 1.6 + r.range(-0.3, 0.3);
    const dir = r.onSphere();
    // Prefer the visible hemisphere (+z faces the camera in local coordinates at yaw 0).
    const d: Vec3 = [dir[0], dir[1] * 0.8, Math.abs(dir[2]) * 0.8 + 0.3];
    const age = time - t0;
    if (age >= 0 && age < 5 && t0 < cues.theia - 1) list.push([d[0], d[1], d[2], age]);
  }
  return list.slice(-6);
}

/**
 * The Earth through the whole sequence: a magma ocean with a thin, broken crust, re-melted by
 * the impact. `scars` adds the glowing shock-heated regions of the two impacts.
 */
function earthParams(time: number, scars: boolean): PlanetParams {
  const { theia, moonBorn: born } = cues;
  const oceans = beat('oceans').start;
  const spin = time * 0.05, tilt = 0.3;
  const impacts = bombardment(time);
  if (scars) {
    for (const { cue, dir, amp } of IMPACTS) {
      const age = time - cues[cue];
      // Fixed to the surface where it struck, so it turns with the planet.
      const q = planetLocal({ spin: cues[cue] * 0.05, tilt }, dir);
      if (age >= 0) impacts.push([...v3.scale(q, 6 * amp), age] as [number, number, number, number]);
    }
  }
  const warm = prog(time, theia - 1, born);
  return {
    center: [0, 0, 0], radius: 1, spin, tilt, sunDir: SUN, seed: 3, lava: 1,
    sunColor: [1.3 + 0.3 * warm, 1.2 + 0.35 * warm, 1.05 + 0.4 * warm],
    crust: spline(time, [[beat('earth').start - 1, 0.25], [theia - 1, 0.55], [theia + 1.5, 0.12], [born, 0.25], [oceans, 0.6]]),
    atmo: spline(time, [[theia, 0.45], [theia + 1, 0.8], [born, 0.6]]),
    atmoColor: [0.9, 0.45, 0.2],
    haze: 0.05,
    hazeColor: [0.6, 0.3, 0.15],
    nightGlow: spline(time, [[theia, 1], [theia + 1, 1.6], [born, 1.3]]),
    impacts,
    depthTest: true,
  };
}

interface SimState {
  data: Impact;
  crack: Float32Array;
  earth: Planet;
  theia: Planet;
  sph: Sprites;
  flash: Sprites;
  flashData: SpriteData;
  cam: Camera;
  sky: Sprites;
  world: Float32Array;
  depth: Float32Array;
  vis: Float32Array;
  index: Uint32Array;
  out: { position: Float32Array; color: Float32Array; size: Float32Array; extra: Float32Array };
}

/** The molten Earth ('earth' beat), Theia's approach and the impact, up to the young Moon. */
export function giantImpact(): Shot<SimState> {
  return {
    ...span('earth', { dIn: 1.0 }),
    end: cues.moonBorn + 0.6,
    fadeOut: 1.4,
    async setup(e) {
      const data = await loadImpact();
      const n = data.n;
      const buf = allocSprites(n);
      const flashData = allocSprites(IMPACTS.length * 2);
      return {
        data,
        crack: crustPattern(data),
        earth: new Planet(e),
        theia: new Planet(e),
        sph: new Sprites(e, buf, { shade: SHADE, minPixels: 0.7, extent: 3 }),
        flash: new Sprites(e, flashData, { minPixels: 1, maxPixels: 700 }),
        flashData,
        cam: new Camera({ fov: 36, far: 500 }),
        sky: new Sprites(e, starSphere(rng(100), { count: 8000, brightness: 0.35 })),
        world: new Float32Array(n * 3),
        depth: new Float32Array(n),
        vis: new Float32Array(n),
        index: new Uint32Array(n),
        out: { position: buf.position, color: buf.color, size: buf.size, extra: buf.extra! },
      };
    },
    render(c, s) {
      frame(s.cam, c.time);
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      const hours = simHours(c.time);
      s.earth.draw(c, s.cam, earthParams(c.time, true));
      // Theia is a planet until first contact, then hands over to its simulated parcels under
      // the flash.
      const solid = 1 - prog(hours, -0.01, 0.05);
      if (solid > 0) {
        s.theia.draw(c, s.cam, {
          center: theiaAt(hours), radius: 0.6, spin: c.time * 0.1, tilt: 0.5, sunDir: SUN, seed: 7, lava: 1, crust: 0.7,
          atmo: 0.35, atmoColor: [0.9, 0.45, 0.2], nightGlow: 1, opacity: solid, depthTest: true,
        });
      }
      if (hours > -0.04) drawSim(c, s, hours);
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
  const cc = cp[0] * cp[0] + cp[1] * cp[1] + cp[2] * cp[2];
  const W = s.world;
  // Theia's centre, for sunlight on it while it is still a planet.
  const tc = theiaAt(hours);
  const theiaLit = 1 - prog(hours, -0.05, 0.6);
  const theiaIn = prog(hours, -0.03, 0.01);
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
      // toWorld(): film x = -sim x, y = sim z, z = sim y.
      if (j === 0) x = -v;
      else if (j === 1) z = v;
      else y = v;
    }
    // The Earth is the planet drawn beneath, radius 1 at the origin: parcels inside it or behind
    // it are hidden, softly over their last 0.06 Earth radii (r in front of the limb, the ray's
    // closest approach to the centre behind it).
    const dx = x - cp[0], dy = y - cp[1], dz = z - cp[2];
    const L = Math.hypot(dx, dy, dz);
    const along = -(cp[0] * dx + cp[1] * dy + cp[2] * dz) / L;
    const clear = L < along ? Math.hypot(x, y, z) : Math.sqrt(Math.max(0, cc - along * along));
    const vis = prog(clear, 1, 1.06) * ((D.kind[i] & 1) === 1 ? theiaIn : 1);
    if (vis < 0.004) continue;
    W[i * 3] = x;
    W[i * 3 + 1] = y;
    W[i * 3 + 2] = z;
    s.vis[i] = vis;
    s.depth[i] = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
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
    // Theia's parcels, while it holds together, are shaded as a planet: sunlit rock, and hot
    // glow that darkens towards the limb. The Earth's parcels are loose above its surface: they
    // just glow.
    const onTheia = (D.kind[i] & 1) === 1 && theiaLit > 0;
    const dx = x - tc[0], dy = y - tc[1], dz = z - tc[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / dl, ny = dy / dl, nz = dz / dl;
    const body = onTheia ? theiaLit * (1 - prog(dl, 0.65, 1.0)) : 0;
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
    const rr = Math.hypot(x, y, z);
    // (Close to the Earth they are its hot vapour envelope: a soft glow rather than sparks.)
    const veil = spark ? 1 - prog(rr, 1.3, 2.3) : 0;
    // Once the first shock has passed, what hangs just above the Earth is that envelope too:
    // thin enough to see the magma ocean through.
    const envelope = (1 - prog(rr, 1.15, 1.7)) * prog(hours, 0.8, 2.5);
    // Theia's cool melt keeps its crust: dark plates between bright cracks.
    const crust = (D.kind[i] & 1) === 1 ? 1 - Math.min(1, Math.max(0, (tcode - CRUST_LO) / (CRUST_HI - CRUST_LO))) : 0;
    const glow = limb * (spark ? 0.6 - 0.25 * veil : 1) * (1 + crust * (4 * s.crack[i] - 0.85));
    O.color[r * 3] = GLOW[ti] * glow + rock * 0.6;
    O.color[r * 3 + 1] = GLOW[ti + 1] * glow + rock * 0.45;
    O.color[r * 3 + 2] = GLOW[ti + 2] * glow + rock * 0.32;
    const sig = spark ? 0.028 + 0.1 * veil : Math.max(0.01, 0.55 * hh * grow);
    O.size[r] = sig;
    O.extra[r * 4] = (spark ? 0.7 - 0.6 * veil : Math.min(2.5, 1.3 * grow ** 3 * (sigRef / sig) ** 2)) * (1 - 0.88 * envelope);
    O.extra[r * 4 + 1] = s.vis[i];
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
      s.earth.draw(c, s.cam, earthParams(c.time, false));
      s.moon.draw(c, s.cam, { center: moonAt(0), radius: 0.27, spin: c.time * 0.03, sunDir: SUN, seed: 41, lava: 0.7, crust: 0.45, moon: 0.3, nightGlow: 1.2, depthTest: true });
    },
  };
}
