// Space, 1957: in orbit (shaders/orbit.glsl), from the dissolve out of the ascent to the crossing
// to the Moon, in two shots. Over the night side of the Earth the core stage's fairing splits and
// falls away; at cue sputnik the satellite is pushed off and its antennas spring out, and the
// camera eases round behind it as it drifts into the dawn, until the Sun breaks over the limb
// beside it (cue orbitalDawn). Through the glare the film dissolves to the other side: Sputnik
// blazing in the sunlight with the Moon beyond, and the camera turns to the Moon and closes in.
// Every move is slow and eased into the next (no whip pans: a fast turn draws the background
// twice with the motion-blur samples a frame can afford).
//
// Axes: x along the track (the way the stage is flying), y up, z across; the camera sits at the
// origin of the shader's frame, the hardware is placed relative to it in metres and the Earth
// through uCamP (the camera relative to the Earth's centre, km). Where on Earth: over Kamchatka,
// heading east-north-east into the dawn (the first orbit crossed into sunlight over the North
// Pacific and the Arctic; the film brings the sunrise forward).
import { Atmosphere, Camera, Sprites, keys, loadEarth, rng, spline, starSphere, v3, type EarthMaps, type Engine, type Look, type Shot, type ShotContext, type Vec3 } from '@engine';
import { beat, cues } from '../lib';
import './civilization';

const R = 6371;
const ALT = 228;
const DEG = Math.PI / 180;

const rows = (a: Vec3, b: Vec3, c: Vec3) => [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];
const cols = (a: Vec3, b: Vec3, c: Vec3) => [...a, ...b, ...c];

function rotateAbout(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  const kv = v3.cross(k, v), kd = v3.dot(k, v);
  return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
}

/** An orthonormal frame with its y axis along `y` (rows: x, y, z). */
function frameAlong(y: Vec3, hint: Vec3 = [0, 1, 0]): [Vec3, Vec3, Vec3] {
  const yy = v3.norm(y);
  let x = v3.cross(hint, yy);
  if (v3.len(x) < 1e-6) x = v3.cross([0, 0, 1], yy);
  x = v3.norm(x);
  const z = v3.cross(x, yy);
  return [x, yy, z];
}

/** Orbit axes -> the Earth maps' axes over Kamchatka (58 N, 162 E), heading 60 degrees. */
const TO_MAP = (() => {
  const lat = 58 * DEG, lon = 162 * DEG, psi = 60 * DEG;
  const q0: Vec3 = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
  const east: Vec3 = [Math.cos(lon), 0, -Math.sin(lon)];
  const north: Vec3 = [-Math.sin(lat) * Math.sin(lon), Math.cos(lat), -Math.sin(lat) * Math.cos(lon)];
  const along = v3.add(v3.scale(north, Math.cos(psi)), v3.scale(east, Math.sin(psi)));
  return cols(along, q0, v3.cross(along, q0));
})();

const T_FAIR = cues.sputnik - 0.75;

/** The Sun: ahead along the track, rising to the limb (15.1 degrees down from 228 km) at cue orbitalDawn. */
function sunAt(time: number): Vec3 {
  const el = keys(time, [[cues.sputnik - 1.7, -27], [cues.sputnik + 0.9, -19.5], [cues.orbitalDawn, -15.37, 'outSine'], [cues.orbitalDawn + 0.7, -14.0], [beat('moonlanding').start + 0.4, -12.2]]) * DEG;
  const az = 14 * DEG;
  return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
}
/** The gibbous Moon, 130 degrees from the Sun: behind and high. */
const MOON: Vec3 = v3.norm([-0.52, 0.62, -0.58]);

const STAGE_AXIS: Vec3 = v3.norm([1, -0.1, 0.06]);

/** Where things are (metres, orbit axes, from the stage's top at the start). */
function layout(time: number) {
  const since = Math.max(0, time - cues.sputnik);
  const axis = rotateAbout(STAGE_AXIS, [0, 0, 1], -0.006 * (time - T_FAIR));
  const top = v3.scale([1, 0, 0], -0.1 * since - 0.12 * since * since);
  // Sputnik: on its adapter under the fairing, then pushed off, tumbling slowly.
  const sat = v3.add(top, v3.add(v3.scale(axis, 0.62 + 0.75 * since), [0, 0.04 * since, 0.03 * since]));
  const tumble = 0.25 * since;
  const [sx0, sy0, sz0] = frameAlong(axis, [0, 0, 1]);
  // Sputnik's frame: its x (front) along the stage's axis, then turning.
  let fx = sy0, fy = sz0, fz = sx0;
  const k = v3.norm([0.3, 1, 0.25]);
  fx = rotateAbout(fx, k, tumble);
  fy = rotateAbout(fy, k, tumble);
  fz = rotateAbout(fz, k, tumble);
  const sweep = (8 + 27 * Math.min(1, Math.max(0, (since - 0.05) / 0.35)) ** 0.5) * DEG;
  // The fairing halves swing open about their hinges, then tumble away.
  const fair: { pos: Vec3; rot: number[] }[] = [];
  const open = Math.max(0, time - T_FAIR);
  const [ax, ay, az] = frameAlong(axis, [0, 1, 0]);
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    // Half i covers the +z (i = 0) or -z side of the stage's frame.
    let hx = v3.scale(ax, side), hy = ay, hz = v3.scale(az, side);
    const hinge = v3.add(top, v3.scale(hz, 1.14));
    const ang = Math.min(open * 1.7, 1.1) + 0.5 * Math.max(0, open - 0.6);
    const hingeAxis = hx;
    let base = v3.add(top, [0, 0, 0]);
    base = v3.add(hinge, rotateAbout(v3.sub(base, hinge), hingeAxis, ang));
    hy = rotateAbout(hy, hingeAxis, ang);
    hz = rotateAbout(hz, hingeAxis, ang);
    const away = v3.add(v3.scale(v3.sub(hinge, top), 2.4 * open + 0.6 * open * open), v3.scale([1, 0, 0], -1.4 * open));
    base = v3.add(base, away);
    // Out of the way once it has tumbled off out of view.
    if (open > 4.0) base = v3.add(base, [0, 1e4, 0]);
    fair.push({ pos: base, rot: rows(hx, hy, hz) });
  }
  return { axis, top, sat, satRot: rows(fx, fy, fz), sweep, fair };
}

/** Rotate a direction about the vertical by `az` and tilt it by `el` (radians). */
function turn(d: Vec3, az: number, el: number): Vec3 {
  const h = Math.hypot(d[0], d[2]);
  const a0 = Math.atan2(d[2], d[0]) + az, e0 = Math.atan2(d[1], h) + el;
  return [Math.cos(e0) * Math.cos(a0), Math.sin(e0), Math.cos(e0) * Math.sin(a0)];
}

/** The dissolve from the sunrise to Sputnik in full sunlight (its midpoint and length). */
const T_AB = cues.orbitalDawn + 1.7;
const D_AB = 1.2;
const ML = beat('moonlanding');

/** Behind Sputnik, looking into the coming dawn with the satellite `az` round from the Sun and a
 * little above it; the aim sits between the two until the Sun is up, then settles on Sputnik. */
function dawnView(t: number): { pos: Vec3; target: Vec3 } {
  const sun = sunAt(t);
  const st = layout(t).sat;
  const az = spline(t, [[cues.sputnik, -46], [cues.orbitalDawn, -18], [T_AB + D_AB, -8]]) * DEG;
  const view = turn(sun, az, 7 * DEG);
  const pos = v3.sub(st, v3.scale(view, 2.5));
  const mid = keys(t, [[cues.orbitalDawn - 0.2, 0.5], [cues.orbitalDawn + 1.6, 1, 'inOutSine']]);
  return { pos, target: v3.add(pos, v3.scale(v3.lerp(v3.norm(v3.add(view, sun)), view, mid), 2.5)) };
}

/**
 * The release and the sunrise (orbit axes, metres): on the stage's shaded side of the track (-z),
 * the hardware moonlit and the limb across the frame, as the fairing splits; then one long move,
 * in close past Sputnik as it is released and on round behind it as it drifts into the dawn (a
 * quadratic Bezier through the three setups, eased once from end to end, so it never stops).
 */
function cameraA(time: number, top: Vec3): { pos: Vec3; target: Vec3; fov: number } {
  const sat = layout(time).sat;
  const k0Pos = v3.add(top, [-1.4 + 0.25 * (time - T_FAIR), 1.25, -6.8]), k0Tgt = v3.add(top, [0.9, 0.15, 0]);
  const k1Pos = v3.add(sat, [-1.2, 0.45, -2.1]), k1Tgt = v3.add(sat, [0.45, -0.12, 0.1]);
  const k2 = dawnView(time);
  const u = keys(time, [[cues.sputnik - 1.1, 0], [cues.orbitalDawn + 1.1, 1, 'inOutSine']]);
  const bez = (a: Vec3, b: Vec3, c: Vec3) => v3.add(v3.add(v3.scale(a, (1 - u) * (1 - u)), v3.scale(b, 2 * u * (1 - u))), v3.scale(c, u * u));
  return {
    pos: bez(k0Pos, k1Pos, k2.pos),
    target: bez(k0Tgt, k1Tgt, k2.target),
    fov: keys(time, [[cues.sputnik - 0.2, 42], [cues.sputnik + 1.8, 36, 'inOutSine']]),
  };
}

/** Where the turn to the Moon ends: just below it, so the Moon sits above the lander it dissolves
 * into. */
const MOON_AIM: Vec3 = v3.norm(v3.sub(MOON, v3.scale(v3.norm(v3.sub([0, 1, 0], v3.scale(MOON, MOON[1]))), Math.tan(1.2 * DEG))));

/**
 * Sputnik in full sunlight: the camera on the Sun's side of it, the Sun straight behind the lens
 * so the polished sphere blazes. It starts where the sunrise shot left Sputnik, centred and as
 * large, so the dissolve turns the same sphere from dark to blazing; then the camera falls back
 * and turns up to the gibbous Moon beyond, which comes in from the corner, and closes in on it as
 * it dissolves into the Sea of Tranquility (the turn and the push overlap).
 */
function cameraB(time: number): { pos: Vec3; target: Vec3; fov: number } {
  const sat = layout(time).sat;
  const toSat = v3.scale(sunAt(time), -1);
  const t0 = T_AB - D_AB / 2, t1 = T_AB + D_AB / 2, t2 = ML.start - 0.9, t3 = ML.start + 0.4;
  const pos = v3.sub(sat, v3.scale(toSat, keys(time, [[t0, 2.9], [t3, 9.0, 'inOutSine']])));
  // (A repeated first knot starts a curve from rest.)
  const k = spline(time, [[t0 - 1, 0], [t0, 0], [t1, 0.2], [t2, 0.86], [t3, 1.0]]);
  const fwd = v3.norm(v3.lerp(toSat, MOON_AIM, k));
  const fov = Math.exp(spline(time, [[t0 - 1, Math.log(38)], [t0, Math.log(38)], [t1, Math.log(38)], [ML.start - 1.4, Math.log(26)], [t3, Math.log(7)]]));
  return { pos, target: v3.add(pos, fwd), fov };
}

/**
 * The post look over the sunrise: light shafts streaming from the Sun as it breaks over the limb
 * (through Sputnik's antennas as they cross it), aimed at the Sun's place in the frame.
 */
const lookCam = new Camera({ fov: 42, aspect: 16 / 9 });
export function sunriseLook(time: number): Partial<Look> {
  const a = cues.orbitalDawn - 0.15, b = T_AB;
  if (time < a || time > b) return {};
  const cam = cameraA(time, layout(time).top);
  lookCam.set({ pos: [0, 0, 0], target: v3.sub(cam.target, cam.pos), up: [0, 1, 0], fov: cam.fov });
  const pr = lookCam.project(v3.scale(sunAt(time), 1000));
  if (!pr.visible) return {};
  const amt = keys(time, [[a + 0.3, 0], [cues.orbitalDawn + 0.7, 0.3, 'outSine'], [b - 0.6, 0.2], [b, 0, 'inOutSine']]);
  return { rays: amt, raysCenter: [pr.x, pr.y], raysThreshold: 5.0, raysDecay: 0.965, raysTint: [1.0, 0.95, 0.88] as Vec3 };
}

type Orbit = { cam: Camera; sky: Sprites; maps: EarthMaps; atmo: Atmosphere };

async function orbitSetup(e: Engine): Promise<Orbit> {
  return {
    cam: new Camera({ fov: 42, near: 0.001, far: 1e5 }),
    sky: new Sprites(e, starSphere(rng(1004), { count: 9000, brightness: 0.4, band: 0.3 })),
    maps: await loadEarth(e),
    atmo: new Atmosphere(),
  };
}

/** The orbit scene at film time `time`, seen from `cam` (orbit axes, metres). */
function drawOrbit(c: ShotContext, s: Orbit, cam: { pos: Vec3; target: Vec3; fov: number }) {
  const time = c.time;
  const sun = sunAt(time);
  const L = layout(time);
  s.cam.set({ pos: [0, 0, 0], target: v3.sub(cam.target, cam.pos), up: [0, 1, 0], fov: cam.fov });
  const rel = (p: Vec3) => v3.sub(p, cam.pos);
  const [sx, sy, sz] = frameAlong(L.axis, [0, 1, 0]);
  // (The spent stage falls behind; once the camera turns away from it, it is gone.)
  const stageTail = v3.add(v3.sub(L.top, v3.scale(L.axis, 24.5)), [0, time > cues.orbitalDawn - 0.4 ? 1e4 : 0, 0]);
  const camP: Vec3 = [cam.pos[0] / 1000, R + ALT + cam.pos[1] / 1000, cam.pos[2] / 1000];
  // The stars fade as the Sun comes up (an exposure for sunlit metal cannot hold them) and come
  // back, faintly, once Sputnik has left the frame and only the Moon is in it.
  const stars = keys(time, [[cues.orbitalDawn - 0.2, 1], [cues.orbitalDawn + 0.6, 0.1, 'inOutSine'], [ML.start - 2.0, 0.1], [ML.start - 0.7, 0.35, 'inOutSine']]);
  s.sky.draw(s.cam, time, {}, { sky: true, brightness: stars });
  c.gl.enable(c.gl.BLEND);
  c.gl.blendFunc(c.gl.ONE, c.gl.ONE_MINUS_SRC_ALPHA);
  c.fullscreen(c.e.program('#include <arrow-of-time/orbit>', 'orbit'), {
    ...s.cam.uniforms(),
    ...s.atmo.uniforms(c),
    uCamP: camP,
    uCamAlt: ALT + cam.pos[1] / 1000,
    uToMap: TO_MAP,
    uAlbedo: s.maps.albedo,
    uMasks: s.maps.masks,
    uRelief: s.maps.relief,
    uSunDir: sun,
    uSunE: [3.2, 3.1, 3.0],
    uSunSize: 0.00465 * 1.3,
    uMoonDir: MOON,
    uMoonE: [0.26, 0.33, 0.5],
    uMoonLit: sun,
    uMoonSize: 0.0046 * 2.0,
    uMoonBright: 2.6,
    uLights: 0.2,
    uGlow: 0.007,
    uCloudT: 0.3,
    uStage: rel(stageTail),
    uStageRot: rows(sx, sy, sz),
    uFair: [...rel(L.fair[0].pos), ...rel(L.fair[1].pos)],
    uFairRot: [...L.fair[0].rot, ...L.fair[1].rot],
    uSat: rel(L.sat),
    uSatRot: L.satRot,
    uSweep: L.sweep,
    uSatShadow: time > cues.sputnik + 0.2 ? 1 : 0,
    uR7Boosters: 0,
  });
  c.gl.disable(c.gl.BLEND);
}

/** The release and the sunrise; it dissolves through the glare into sputnikMoon. */
export function sputnik(): Shot<Orbit> {
  return {
    id: 'sputnik',
    start: cues.sputnik - 1.7,
    end: T_AB + D_AB / 2,
    fadeIn: 0.8,
    fadeOut: D_AB,
    // (Six samples while the camera turns, so the stars and the limb streak instead of doubling.)
    motionBlur: (time) => (time > cues.sputnik - 1.1 && time < cues.orbitalDawn + 1.1 ? 6 : 3),
    setup: orbitSetup,
    render(c, s) {
      drawOrbit(c, s, cameraA(c.time, layout(c.time).top));
    },
  };
}

/** Sputnik blazing, and the turn to the Moon; it dissolves into the Moon landing. */
export function sputnikMoon(): Shot<Orbit> {
  return {
    id: 'sputnik-moon',
    start: T_AB - D_AB / 2,
    end: ML.start + 0.4,
    fadeIn: D_AB,
    fadeOut: 0.8,
    motionBlur: 3,
    setup: orbitSetup,
    render(c, s) {
      drawOrbit(c, s, cameraB(c.time));
    },
  };
}
