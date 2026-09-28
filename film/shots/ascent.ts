// Space, 1957: the ascent (cue clouds to the dissolve into orbit), ray-marched in
// shaders/ascent.glsl. The painted launch pad (shots/civilization.ts) ends with the camera
// following the R-7 up into the clouds; this shot picks it up inside them and flies alongside as
// it climbs into the moonlit night, pitches over towards the east and leaves the air behind. At
// cue staging the boosters peel away (slow motion) and the core stage flies on.
//
// Frames: "site" axes are those of the launch pad (x east, y up, z south), in kilometres, with
// the Earth's centre at (0, -R, 0). The camera always sits at the origin of the shader's frame;
// the shader gets the camera relative to the Earth's centre (uCamP) and the rocket relative to the
// camera (uRk), both computed here in double precision.
import { Atmosphere, Camera, Sprites, keys, loadEarth, rng, spline, starSphere, v3, type EarthMaps, type Key, type Shot, type Vec3 } from '@engine';
import { cues } from '../lib';
import './civilization';

const R = 6371;
const DEG = Math.PI / 180;

/** Cuts, on frame boundaries: to the long lens on the Moon, and to the chase camera. */
const onFrame = (t: number) => Math.round(t * 24) / 24;
const T_LENS = onFrame(cues.clouds + 1.05);
const T_CUT = onFrame(cues.staging - 1.6);
/** When the rocket crosses the face of the Moon. */
const T_MOON = T_CUT - 0.45;

/**
 * Flight time (s after liftoff) at film time: fast forward, nearly real time across the Moon,
 * slow motion through staging. Each camera setup has its own curve: time jumps at the cuts.
 */
export function flightTime(time: number): number {
  if (time < T_LENS) return spline(time, [[cues.clouds - 0.6, 26], [cues.clouds, 30.5], [T_LENS, 44]]);
  if (time < T_CUT) return spline(time, [[T_LENS, 49.4], [T_MOON - 0.45, 51.3], [T_MOON, 52], [T_CUT, 52.6]]);
  return spline(time, [
    [T_CUT, 92], [cues.staging - 0.3, 111], [cues.staging, 116], [cues.staging + 1.1, 119.5],
    [cues.staging + 1.7, 135], [cues.staging + 2.6, 210],
  ]);
}
const STAGE_TAU = 116;
const altOf = (tau: number) => (0.0033 * tau * tau) / (1 + 0.001 * tau);
/** Downrange distance (km) at altitude h: nearly vertical at first, pitching over by staging. */
const rangeOf = (h: number) => (0.02 * h * h) / (1 + h / 120);

/** The flight heads east; the camera flies on its south side, looking north at it. */
const F: Vec3 = [1, 0, 0];
const UP: Vec3 = [0, 1, 0];
const SIDE: Vec3 = [0, 0, 1];

/** The rocket's base in site axes (km) at flight time tau. */
function rocketAt(tau: number): Vec3 {
  const h = altOf(tau), x = rangeOf(h);
  const a = x / R;
  return v3.add(v3.scale(F, (R + h) * Math.sin(a)), v3.scale(UP, (R + h) * Math.cos(a) - R));
}

/** Rows of a matrix, as the column-major array GLSL expects. */
const rows = (a: Vec3, b: Vec3, c: Vec3) => [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];
const cols = (a: Vec3, b: Vec3, c: Vec3) => [...a, ...b, ...c];

function rotateAbout(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  const kv = v3.cross(k, v), kd = v3.dot(k, v);
  return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
}

/** The four boosters, in the rocket's frame: matrices into each booster's frame and base offsets. */
function boosters(sepS: number) {
  const mats: number[] = [];
  const offs: number[] = [];
  const tilt = 2.6 * DEG;
  for (let i = 0; i < 4; i++) {
    const phi = (i * Math.PI) / 2;
    const u: Vec3 = [Math.cos(phi), 0, Math.sin(phi)];
    let yb = v3.norm(v3.add(v3.scale(u, -Math.sin(tilt)), [0, Math.cos(tilt), 0]));
    let xb = v3.norm(v3.add(v3.scale(u, Math.cos(tilt)), [0, Math.sin(tilt), 0]));
    let off = v3.scale(u, 2.45);
    if (sepS > 0) {
      // Released at the top, each booster swings out about its lower joint, then tumbles away
      // behind the core, which keeps accelerating.
      const w: Vec3 = [Math.sin(phi), 0, -Math.cos(phi)];
      const pivot = v3.add(v3.scale(u, 1.1), [0, 0.4, 0]);
      const k = 1 + 0.12 * Math.sin(i * 2.3);
      const ang = k * (18 * DEG * (1 - Math.exp(-sepS * 1.6)) + 14 * DEG * sepS);
      off = v3.add(pivot, rotateAbout(v3.sub(off, pivot), w, ang));
      yb = rotateAbout(yb, w, ang);
      xb = rotateAbout(xb, w, ang);
      const back = 0.5 * 16 * sepS * sepS;
      off = v3.add(off, v3.add(v3.scale(u, 2.2 * k * sepS), [0, -back, 0]));
    }
    const zb = v3.cross(xb, yb);
    mats.push(...rows(xb, yb, zb));
    offs.push(...off);
  }
  return { mats, offs };
}

// The Moon, 10.6 days old: high in the north-west for the picture (cinematic licence; that night
// it stood in the south-west), drawn twice its size. Its lit side faces the Sun, far below the
// horizon.
const MOON: Vec3 = v3.norm([-0.386, 0.407, -0.828]);
const MOON_LIT: Vec3 = (() => {
  const down = v3.norm(v3.sub(v3.add(v3.scale(UP, -1), v3.scale(F, 0.6)), v3.scale(MOON, v3.dot(v3.add(v3.scale(UP, -1), v3.scale(F, 0.6)), MOON))));
  return v3.norm(v3.add(v3.scale(MOON, Math.cos(130 * DEG)), v3.scale(down, Math.sin(130 * DEG))));
})();
/** Local midnight: the Sun 48 degrees below the northern horizon. */
const SUN: Vec3 = v3.norm([0, -Math.sin(48.5 * DEG), -Math.cos(48.5 * DEG)]);

/** Site axes -> the Earth maps' axes (Baikonur, 45.92 N 63.34 E). */
const TO_MAP = (() => {
  const lat = 45.92 * DEG, lon = 63.34 * DEG;
  const q0: Vec3 = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
  const east: Vec3 = [Math.cos(lon), 0, -Math.sin(lon)];
  const north: Vec3 = [-Math.sin(lat) * Math.sin(lon), Math.cos(lat), -Math.sin(lat) * Math.cos(lon)];
  return cols(east, q0, v3.scale(north, -1));
})();

interface View { pos: Vec3; target: Vec3; up: Vec3; fov: number; moon: number }
const upAt = (p: Vec3) => v3.norm(v3.add(p, [0, R, 0]));

/**
 * Out of the clouds: above the deck, looking down at the glow where the rocket is about to burst
 * out; the camera only tilts up a little as the rocket tears up through the frame and out of its
 * top (the next shot picks it up entering from below), leaving its trail and the Moon.
 */
function emergence(time: number): View {
  const pos: Vec3 = v3.lerp([0.9, 4.05, 1.9], [0.95, 4.35, 2.0], keys(time, [[cues.clouds - 0.6, 0], [T_LENS, 1, 'inOutSine']]));
  const hole: Vec3 = [rangeOf(2.65), 3.3, 0];
  // Aim: from the glow in the deck to a point above the horizon on the rocket's line.
  const toHole = v3.norm(v3.sub(hole, pos));
  const az = Math.atan2(toHole[0], -toHole[2]);
  const el = keys(time, [[cues.clouds - 0.1, Math.max(Math.asin(toHole[1]), -13 * DEG)], [T_LENS, 5 * DEG, 'inOutSine']]);
  const dir: Vec3 = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
  return { pos, target: v3.add(pos, dir), up: upAt(pos), fov: 50, moon: 2.0 };
}

/** The long lens, locked on the Moon from 10 km away: the rocket rises across its face. */
function longLens(): View {
  const pos = v3.sub(rocketAt(flightTime(T_MOON)), v3.scale(MOON, 10));
  const target = v3.add(pos, v3.add(MOON, [0.004, -0.003, 0]));
  return { pos, target, up: upAt(pos), fov: 5.5, moon: 1.3 };
}

/**
 * The chase: ahead of the rocket, off to its south side and a little above, looking back at it
 * with the curve of the Earth behind. The boosters open like petals and fall away; then the
 * rocket overtakes the camera and pulls away towards the horizon.
 */
function chase(time: number, rk: Vec3, axis: Vec3): View {
  const up = upAt(rk);
  const east = v3.norm(v3.sub(F, v3.scale(up, v3.dot(F, up))));
  const south = v3.cross(east, up);
  const k: Key<number[]>[] = [
    [T_CUT, [0.045, 0.075, 0.018]],
    [cues.staging, [0.036, 0.07, 0.02], 'inOutSine'],
    [cues.staging + 1.2, [0.034, 0.075, 0.024], 'inOutSine'],
    [cues.staging + 2.5, [-0.45, 0.16, 0.07], 'inQuad'],
  ];
  const [a, b, c] = keys(time, k);
  const pos = v3.add(rk, v3.add(v3.add(v3.scale(east, a), v3.scale(south, b)), v3.scale(up, c)));
  const look = keys(time, [[cues.staging + 1.3, 0], [cues.staging + 2.4, 1, 'inOutSine']]);
  const target = v3.add(rk, v3.scale(axis, 0.012 + look * 0.02));
  return { pos, target, up: upAt(pos), fov: 44, moon: 2.0 };
}

export function ascent(): Shot<{ cam: Camera; sky: Sprites; maps: EarthMaps; atmo: Atmosphere }> {
  return {
    id: 'ascent',
    start: cues.clouds - 0.3,
    end: cues.sputnik - 0.9,
    fadeIn: 0.4,
    fadeOut: 0.8,
    motionBlur: (time) => (time < T_LENS ? 3 : time < T_CUT ? 2 : 3),
    async setup(e) {
      return {
        cam: new Camera({ fov: 40, near: 0.001, far: 1e5 }),
        sky: new Sprites(e, starSphere(rng(1957), { count: 9000, brightness: 0.4, band: 0.3 })),
        maps: await loadEarth(e),
        atmo: new Atmosphere(),
      };
    },
    render(c, s) {
      const time = c.time;
      const tau = flightTime(time);
      const rk = rocketAt(tau);
      const h = altOf(tau);
      const ahead = rocketAt(tau + 0.5), behind = rocketAt(tau - 0.5);
      const axis = v3.norm(v3.sub(ahead, behind));
      // The rocket's frame: boosters on the flight plane's normal and in the plane.
      const xr = SIDE;
      const zr = v3.cross(xr, axis);
      const rkRot = rows(xr, axis, zr);
      const sepS = Math.max(0, tau - STAGE_TAU);
      const b = boosters(sepS);

      const view = time < T_LENS ? emergence(time) : time < T_CUT ? longLens() : chase(time, rk, axis);
      const camW = view.pos;
      s.cam.set({ pos: [0, 0, 0], target: v3.sub(view.target, camW), up: view.up, fov: view.fov });

      const camP = v3.add(camW, [0, R, 0]);
      const camAlt = v3.len(camP) - R;
      const rel = v3.sub(rk, camW);
      const flame = v3.add(rel, v3.scale(axis, -0.012));
      const boost = sepS > 0 ? Math.exp(-sepS / 0.35) : 1;
      const holeX = rangeOf(2.65);
      const holeAge = Math.max(0, tau - 20);

      s.sky.draw(s.cam, time, {}, { sky: true });
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE_MINUS_SRC_ALPHA);
      c.fullscreen(c.e.program('#include <arrow-of-time/ascent>', 'ascent'), {
        ...s.cam.uniforms(),
        ...s.atmo.uniforms(c),
        uCamP: camP,
        uCamAlt: camAlt,
        uToMap: TO_MAP,
        uAlbedo: s.maps.albedo,
        uMasks: s.maps.masks,
        uRelief: s.maps.relief,
        uSunDir: SUN,
        uSunE: [3, 3, 3],
        uMoonDir: MOON,
        uMoonE: [0.17, 0.22, 0.34],
        uMoonLit: MOON_LIT,
        uMoonSize: 0.0046 * view.moon,
        uMoonBright: 2.6,
        uLights: 0.25,
        uGlow: 0.03 * keys(h, [[20, 0], [80, 1]]),
        uRk: rel,
        uRkRot: rkRot,
        uRkBound: 18 + 40 * sepS + 8 * sepS * sepS,
        uCore: 1,
        uBoost: boost,
        uRkAlt: h,
        uTrail: [tau, F[0], F[2], 1],
        uHole: [holeX * F[0], holeX * F[2], 0.06 + 0.012 * Math.sqrt(holeAge)],
        uFlame: flame,
        uFlameI: keys(time, [[cues.clouds, 3.0], [cues.clouds + 0.6, 3.0], [cues.clouds + 1.2, 1.2]]),
        uFrost: keys(tau, [[26, 0.8], [60, 0.0]]),
        uR7Boost: b.mats,
        uR7BoostOff: b.offs,
        uR7Boosters: 1,
      });
      c.gl.disable(c.gl.BLEND);
    },
  };
}
