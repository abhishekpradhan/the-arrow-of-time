// The Moon, 1969 (beat moonlanding), ray-marched in shaders/moonlanding.glsl: Apollo 11's lunar
// module Eagle comes down on the Sea of Tranquility, its exhaust blasting a sheet of dust across
// the plain, and settles at cue eagleLands; the engine stops and the dust is gone. Then the first
// step (cue moonStep): the astronaut comes down the ladder onto the footpad and steps off into the
// powder, and the camera rises to find him by the lander, the Earth in the black sky.
//
// The Sun stands 10 degrees up in the east, as it did that morning. The lander faces south here
// (it faced west, with its ladder in its own shadow); the film turns it so the first step is side
// lit. The Earth, which stood high overhead at Tranquility Base, is brought down into the frame.
// World axes: metres, x east, y up, z south, the landing site at the origin.
import { Camera, Planet, RenderTarget, keys, loadEarth, v3, type Shot, type Vec3 } from '@engine';
import { beat, cues } from '../lib';
import './civilization';

const DEG = Math.PI / 180;
const SUN: Vec3 = v3.norm([Math.cos(10 * DEG) * Math.cos(20 * DEG), Math.sin(10 * DEG), Math.cos(10 * DEG) * Math.sin(20 * DEG)]);
const BAKE_SIZE = 1600;
const BAKE_RES = 2048;
const BAKE_FAR = 24000;
const ML = beat('moonlanding');
/** The cut from the descent to the first step, on a frame boundary. */
const T_STEP_CUT = Math.round((cues.eagleLands + 1.05) * 24) / 24;

const rows = (a: Vec3, b: Vec3, c: Vec3) => [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];

/** The baked ground, made once for both shots: fine round the site, coarse out to the horizon. */
let baked: { near: RenderTarget; far: RenderTarget } | null = null;
function terrain(c: Parameters<Shot['render']>[0]) {
  if (baked) return baked;
  const gl = c.gl;
  const blend = gl.isEnabled(gl.BLEND);
  gl.disable(gl.BLEND);
  const prog = c.e.program('#define TERRAIN_BAKE\n#include <arrow-of-time/lunar>', 'lunar-bake');
  const bake = (res: number, size: number, layers: number) => {
    const rt = new RenderTarget(gl, res, res, { format: 'rgba16f', filter: 'linear', wrap: 'clamp' });
    rt.bind();
    c.fullscreen(prog, { uBakeSize: size, uSunDir: SUN, uBakeLayers: layers });
    return rt;
  };
  baked = { near: bake(BAKE_RES, BAKE_SIZE, 4), far: bake(1024, BAKE_FAR, 2) };
  c.target.bind();
  if (blend) gl.enable(gl.BLEND);
  return baked;
}

// ------------------------------------------------------------------ the descent
/** The lander's height (its footpads above the ground): fast from high up, slow at the end; the
 * engine stops half a metre up and it drops onto its pads. */
function lmHeight(time: number): number {
  const L = cues.eagleLands;
  if (time >= L) return Math.max(0, 0.5 - 0.5 * 1.62 * Math.pow((time - L) * 2.2, 2));
  return keys(time, [[ML.start - 0.4, 440], [ML.start + 1.0, 200, 'outSine'], [ML.start + 2.2, 85], [ML.start + 3.2, 32], [L - 1.2, 10], [L - 0.5, 2.6], [L, 0.5, 'outSine']]);
}

/** The lander's frame: drifting in from the north-east, pitched back to brake, upright at the end. */
function lmPose(time: number) {
  const h = lmHeight(time);
  const u = Math.min(1, Math.max(0, (cues.eagleLands - time) / (cues.eagleLands - ML.start + 0.4)));
  const pos: Vec3 = [70 * Math.pow(u, 1.6), h, -45 * Math.pow(u, 1.6)];
  const pitch = 13 * DEG * Math.min(1, u * 1.6);
  const yaw = 25 * DEG * u;
  // The lander leans back against its drift (its +z front turned up).
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x: Vec3 = [c, 0, -s];
  const z0: Vec3 = [s, 0, c];
  const y: Vec3 = v3.add(v3.scale([0, 1, 0], cp), v3.scale(z0, -sp));
  const z: Vec3 = v3.add(v3.scale(z0, cp), v3.scale([0, 1, 0], sp));
  return { pos, rot: rows(x, y, z) };
}

/** The dust: from 40 m up the exhaust starts scouring the ground; at the engine's cut it is gone. */
function dustAt(time: number, lm: Vec3): number[] {
  const h = lmHeight(time);
  const on = time < cues.eagleLands ? Math.min(1, Math.max(0, (40 - h) / 32)) : Math.max(0, 1 - (time - cues.eagleLands) / 0.25);
  return [lm[0], lm[2], on, time - ML.start];
}

/** High over the lander on the Sun's side, closing in and coming down with it (always above it
 * until it is nearly down), to finish low beside it as it lands, its shadow reaching out west. */
function descentCamera(time: number, lm: Vec3): { pos: Vec3; target: Vec3; fov: number } {
  const t0 = ML.start - 0.4, t1 = cues.eagleLands - 0.6;
  const u = Math.min(1, Math.max(0, (time - t0) / (t1 - t0)));
  const e = u * u * (3 - 2 * u);
  // Round from the north-east to the south-east as it comes down.
  const az = (-40 + 88 * e) * DEG;
  const dist = keys(time, [[t0, 150], [ML.start + 2.0, 70, 'inOutSine'], [t1, 31, 'inOutSine']]);
  const above = keys(time, [[t0, 120], [ML.start + 2.0, 45, 'inOutSine'], [ML.start + 3.4, 16, 'inOutSine'], [t1, 4.3, 'inOutSine']]);
  const pos: Vec3 = v3.add(lm, [dist * Math.cos(az), above, dist * Math.sin(az)]);
  const target = v3.add(lm, [0, 2.6, 0]);
  return { pos, target, fov: keys(time, [[t0, 30], [t1, 40, 'inOutSine']]) };
}

// ------------------------------------------------------------------ the first step
/** Bend a two-bone limb from root towards goal (lengths a, b), bending towards pole. */
function ik2(root: Vec3, goal: Vec3, a: number, b: number, pole: Vec3): Vec3 {
  const d = v3.sub(goal, root);
  const len = Math.min(v3.len(d), a + b - 1e-4);
  const dir = v3.norm(d);
  const x = (a * a - b * b + len * len) / (2 * len);
  const hgt = Math.sqrt(Math.max(a * a - x * x, 0));
  const side = v3.norm(v3.sub(pole, v3.scale(dir, v3.dot(pole, dir))));
  return v3.add(root, v3.add(v3.scale(dir, x), v3.scale(side, hgt)));
}

const LADDER_FOOT: Vec3 = [0, 0.26, 4.45];   // top of the front footpad
const STEP_TO: Vec3 = [-0.5, 0.02, 4.72];    // where the left boot comes down

/** The astronaut's joints (world) at film time: down the ladder, onto the pad, the step. */
function astronaut(time: number) {
  const s = time - cues.moonStep;
  // Facing the lander (north, -z) on the ladder, turning a little out towards the plain.
  // (He turns out towards the plain on the pad, so the step is seen from the side.)
  const turn = keys(s, [[-0.9, 0], [-0.1, 65 * DEG, 'inOutSine'], [3.6, 125 * DEG, 'inOutSine']]);
  const fwd: Vec3 = [Math.sin(turn) * -1, 0, -Math.cos(turn)];
  const right: Vec3 = v3.cross(fwd, [0, 1, 0]);
  // The feet: down the last rungs (a foot at a time), a slow hop off the bottom rung onto the
  // pad in the Moon's gravity, then the left boot down to the ground.
  const rung = (j: number): Vec3 => [0, 1.04 + 0.195 * j, 3.94 - 0.168 * j];
  const smooth = (u: number) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };
  // Rung heights (counted from the bottom) of each foot over the climb down: [time, right, left].
  const climb: [number, number, number][] = [[-1.95, 3, 4], [-1.72, 3, 2], [-1.49, 1, 2], [-1.26, 1, 0], [-1.12, 0, 0]];
  let jr = climb[0][1], jl = climb[0][2];
  for (let i = 1; i < climb.length; i++) {
    const u = smooth((s - climb[i - 1][0]) / (climb[i][0] - climb[i - 1][0]));
    if (s >= climb[i - 1][0]) {
      jr = climb[i - 1][1] + (climb[i][1] - climb[i - 1][1]) * u;
      jl = climb[i - 1][2] + (climb[i][2] - climb[i - 1][2]) * u;
    }
  }
  const lift = (j: number) => 0.08 * Math.sin((j % 1) * Math.PI);
  const hop = smooth((s + 1.1) / 0.32);
  const padR = LADDER_FOOT, padL = v3.add(LADDER_FOOT, [0.1, 0, 0.12]);
  let footR: Vec3 = v3.lerp(v3.add(rung(jr), [0.1, lift(jr), 0]), padR, hop);
  let footL: Vec3 = v3.lerp(v3.add(rung(jl), [-0.1, lift(jl), 0]), padL, hop);
  const onLadder = 1 - hop;
  // The step: the left boot lifts off the pad, swings out and down.
  const stepU = Math.min(1, Math.max(0, (s + 0.55) / 0.55));
  const swing = Math.sin(stepU * Math.PI) * 0.16;
  if (s > -0.55) footL = v3.add(v3.lerp(padL, STEP_TO, smooth(stepU)), [0, swing - 0.03 * Math.max(0, Math.min(1, s * 4)), 0]);
  // Then the right follows.
  const r2 = Math.min(1, Math.max(0, (s - 1.4) / 0.8));
  if (r2 > 0) footR = v3.add(v3.lerp(padR, [-0.08, 0.02, 5.28], smooth(r2)), [0, Math.sin(r2 * Math.PI) * 0.15, 0]);
  // The pelvis rides over the feet, lower while stepping down.
  const mid = v3.lerp(footL, footR, 0.5);
  const dip = 0.07 * Math.sin(Math.min(1, Math.max(0, (s + 0.9) / 1.6)) * Math.PI);
  const pelvis: Vec3 = v3.add(mid, [0, 0.93 - dip, 0.0]);
  const up: Vec3 = [0, 1, 0];
  const chest = v3.add(pelvis, v3.add(v3.scale(up, 0.4), v3.scale(fwd, 0.04)));
  const neck = v3.add(chest, [0, 0.3, 0]);
  const head = v3.add(neck, v3.add([0, 0.17, 0], v3.scale(fwd, 0.03)));
  const hipL = v3.add(pelvis, v3.scale(right, -0.12)), hipR = v3.add(pelvis, v3.scale(right, 0.12));
  const ankleL = v3.add(footL, [0, 0.1, 0]), ankleR = v3.add(footR, [0, 0.1, 0]);
  const kneeL = ik2(hipL, ankleL, 0.46, 0.44, v3.add(fwd, [0, 0.2, 0]));
  const kneeR = ik2(hipR, ankleR, 0.46, 0.44, v3.add(fwd, [0, 0.2, 0]));
  const shL = v3.add(chest, v3.add(v3.scale(right, -0.3), [0, 0.12, 0])), shR = v3.add(chest, v3.add(v3.scale(right, 0.3), [0, 0.12, 0]));
  // Hands: both on the ladder's rails, then the left lets go, then the right.
  const grip = (j: number, side: number): Vec3 => v3.add(rung(Math.min(j + 3.3, 9)), [0.27 * side, 0, 0.02]);
  const railR: Vec3 = v3.lerp([0.27, 1.62, 3.7], grip(jr, 1), onLadder);
  const railL: Vec3 = v3.lerp([-0.27, 1.66, 3.68], grip(jl, -1), onLadder);
  const freeL = v3.add(shL, v3.add(v3.scale(right, -0.2), [0, -0.45, 0.05]));
  const freeR = v3.add(shR, v3.add(v3.scale(right, 0.18), v3.add([0, -0.5, 0], v3.scale(fwd, 0.1))));
  const handL = v3.lerp(railL, freeL, keys(s, [[-0.4, 0], [0.4, 1, 'inOutSine']]));
  const handR = v3.lerp(railR, freeR, keys(s, [[1.8, 0], [2.6, 1, 'inOutSine']]));
  const elL = ik2(shL, handL, 0.32, 0.3, v3.add(v3.scale(right, -0.5), [0, -0.6, -0.4]));
  const elR = ik2(shR, handR, 0.32, 0.3, v3.add(v3.scale(right, 0.5), [0, -0.6, -0.4]));
  const J = [pelvis, chest, neck, head, shL, elL, handL, shR, elR, handR, hipL, kneeL, ankleL, hipR, kneeR, ankleR];
  const torso = rows(right, up, fwd);
  return { J, torso, base: mid, fwd };
}

/** Low beside the footpad, looking up at the astronaut against the lander with the Sun raking
 * in from the right; then rising and drawing back to the whole scene and the Earth. */
const STEP_NEAR = { pos: [-3.3, 0.75, 8.7] as Vec3, target: [0.05, 1.12, 4.55] as Vec3, fov: 36 };
const STEP_FAR = { pos: [-5.6, 2.6, 13.4] as Vec3, target: [-1.3, 2.2, 3.8] as Vec3, fov: 44 };
function stepCamera(time: number): { pos: Vec3; target: Vec3; fov: number } {
  const u = keys(time, [[cues.moonStep + 0.35, 0], [ML.end + 0.4, 1, 'inOutSine']]);
  // Tilting down with him as he comes down the ladder.
  const down = keys(time, [[T_STEP_CUT, 0], [cues.moonStep - 0.7, 1, 'inOutSine']]);
  const near = v3.lerp([0.05, 1.85, 4.2], STEP_NEAR.target, down);
  return {
    pos: v3.lerp(STEP_NEAR.pos, STEP_FAR.pos, u),
    target: v3.lerp(near, STEP_FAR.target, u),
    fov: STEP_NEAR.fov + (STEP_FAR.fov - STEP_NEAR.fov) * u,
  };
}

/** Where the Earth hangs: up and to the left of the final view, in the western sky away from the
 * Sun, so that it shows gibbous as it did on 20 July 1969 (a unit direction); and its angular
 * radius (its real 0.95 degrees, drawn 1.6 times larger). */
const EARTH_DIR: Vec3 = (() => {
  const f = v3.norm(v3.sub(STEP_FAR.target, STEP_FAR.pos));
  const r = v3.norm(v3.cross(f, [0, 1, 0]));
  const u = v3.cross(r, f);
  return v3.norm(v3.add(f, v3.add(v3.scale(u, Math.tan(15 * DEG)), v3.scale(r, -Math.tan(21 * DEG)))));
})();
const EARTH_ANG = 0.95 * DEG * 1.6;

export function moonLanding(): Shot<{ planet: Planet; cam: Camera }> {
  return {
    id: 'moonlanding',
    start: ML.start - 0.4,
    end: ML.end + 0.5,
    fadeIn: 0.8,
    fadeOut: 1.0,
    motionBlur: (time) => (time < T_STEP_CUT ? 3 : 2),
    async setup(e) {
      return { planet: new Planet(e, await loadEarth(e)), cam: new Camera({ fov: 40, near: 0.05, far: 1e6 }) };
    },
    render(c, s) {
      const time = c.time;
      const tex = terrain(c);
      const descent = time < T_STEP_CUT;
      const lm = descent ? lmPose(time) : { pos: [0, 0, 0] as Vec3, rot: rows([1, 0, 0], [0, 1, 0], [0, 0, 1]) };
      const cam = descent ? descentCamera(time, lm.pos) : stepCamera(time);
      s.cam.set({ pos: cam.pos, target: cam.target, up: [0, 1, 0], fov: cam.fov });
      // The Earth, far off in the black sky (drawn first; the Moon goes over it).
      if (!descent) {
        const D = 1e5;
        s.planet.draw(c, s.cam, {
          center: v3.add(cam.pos, v3.scale(EARTH_DIR, D)), radius: D * Math.tan(EARTH_ANG), yaw: 2.6, spin: 0, tilt: 0.35,
          sunDir: SUN, earth: 1, clouds: 0.5, cloudT: 0.8, atmo: 1.0, atmoColor: [0.3, 0.55, 1.0], glint: 0.8,
        });
      }
      const a = astronaut(time);
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE_MINUS_SRC_ALPHA);
      c.fullscreen(c.e.program('#include <arrow-of-time/moonlanding>', 'moonlanding'), {
        ...s.cam.uniforms(),
        uTerrain: tex.near,
        uTerrainFar: tex.far,
        uBakeSize: BAKE_SIZE,
        uBakeFar: BAKE_FAR,
        uSunDir: SUN,
        uSunE: 3.2,
        uLmPos: lm.pos,
        uLmRot: lm.rot,
        uProbes: time < cues.eagleLands - 0.3 ? 1 : 0,
        uDust: dustAt(time, lm.pos),
        uAstroOn: descent ? 0 : 1,
        uJ: a.J.flat(),
        uTorso: a.torso,
        uAstroBase: a.base,
        uFootDirL: v3.add(a.fwd, [0.2, 0, 0]),
        uFootDirR: a.fwd,
        uAstroDust: Math.min(1, Math.max(0, (time - cues.moonStep) / 0.4)),
        uStepT: time - cues.moonStep,
        uStepAt: STEP_TO,
      });
      c.gl.disable(c.gl.BLEND);
    },
  };
}
