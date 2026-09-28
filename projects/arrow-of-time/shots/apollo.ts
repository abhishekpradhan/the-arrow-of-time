// The Moon, 1969 (beat moonlanding), ray-marched in shaders/moonlanding.glsl: Apollo 11's lunar
// module Eagle comes down on the Sea of Tranquility, its exhaust blasting a sheet of dust across
// the plain, and settles at cue eagleLands; the engine stops and the dust is gone. Then the film
// holds its breath: the lander stands in the silence while Armstrong calls Houston (cue
// tranquilityBase), and from cue reflection the camera drifts round it and tilts up from the
// lander to the Earth in the black sky, still turning as the shot dissolves into the Earth of today
// (beat nightearth).
//
// The Sun stands 10 degrees up in the east, as it did that morning. The lander faces south here
// (it faced west). The Earth, which stood high in the west at Tranquility Base, is brought down to
// 16 degrees above the northern horizon, where the Sun lights two thirds of its disc (62 per cent
// that day); it is drawn twice its real size, the Americas facing the Moon.
// World axes: metres, x east, y up, z south, the landing site at the origin.
import { Camera, Planet, RenderTarget, keys, loadEarth, spline, v3, type Shot, type Vec3 } from '@engine';
import { beat, cues } from '../lib';
import './civilization';

const DEG = Math.PI / 180;
const SUN: Vec3 = v3.norm([Math.cos(10 * DEG) * Math.cos(20 * DEG), Math.sin(10 * DEG), Math.cos(10 * DEG) * Math.sin(20 * DEG)]);
const BAKE_SIZE = 1600;
const BAKE_RES = 2048;
const BAKE_FAR = 24000;
const ML = beat('moonlanding');
/** The dissolve into night Earth (shots/human.ts spans it over nightearth's start). */
const NE = beat('nightearth').start;
const DISSOLVE = 2.4;
/** The lander stands on its pads: the engine stops half a metre up and it drops in lunar gravity. */
const T_SET = cues.eagleLands + Math.sqrt(1 / 1.62) / 2.2;

/** Where the Earth hangs (a unit direction: 4 degrees west of north, 16 up) and its angular radius. */
const EARTH_DIR: Vec3 = [-Math.sin(4 * DEG) * Math.cos(16 * DEG), Math.sin(16 * DEG), -Math.cos(4 * DEG) * Math.cos(16 * DEG)];
const EARTH_ANG = 0.95 * DEG * 2.0;
/** Where the camera ends up looking: just above the Earth, so that it sits where night Earth's
 * globe will be (below the centre of the frame) as one dissolves into the other. */
const EARTH_AIM: Vec3 = v3.norm(v3.add(EARTH_DIR, v3.scale(v3.norm(v3.sub([0, 1, 0], v3.scale(EARTH_DIR, EARTH_DIR[1]))), Math.tan(3.6 * DEG))));

const rows = (a: Vec3, b: Vec3, c: Vec3) => [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];

/** The baked ground, made once: fine round the site, coarse out to the horizon. */
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

// ------------------------------------------------------------------ Tranquility Base
/** Where the descent left it, at rest beside the lander, then edging in through Armstrong's call;
 * from cue reflection it keeps drifting round to the south and tilts up from the lander towards
 * the Earth, until the lander stands low in the frame and the Earth high across it (at T_BOTH, the
 * view midway between them); then on up, closing in, until only the Earth is left in the black
 * sky, just before the dissolve's midpoint. */
const T_BOTH = NE - 2.2;
function landedCamera(time: number): { pos: Vec3; target: Vec3; fov: number } {
  const rf = cues.reflection, end = NE + DISSOLVE / 2;
  // (A repeated first knot starts each curve from rest.)
  const az = spline(time, [[T_SET - 1, 48], [T_SET, 48], [rf, 52], [T_BOTH, 62], [end, 66]]) * DEG;
  const dist = spline(time, [[T_SET - 1, 31], [T_SET, 31], [rf, 28.5], [T_BOTH, 27], [end, 26.5]]);
  const above = spline(time, [[T_SET - 1, 4.3], [T_SET, 4.3], [rf, 3.8], [T_BOTH, 3.4], [end, 3.3]]);
  const pos: Vec3 = [dist * Math.cos(az), above, dist * Math.sin(az)];
  const k = spline(time, [[rf - 1, 0], [rf, 0], [T_BOTH, 0.5], [NE - 0.4, 1.0], [end, 1.06]]);
  const toLm = v3.norm(v3.sub([0, 2.6, 0], pos));
  const fwd = v3.norm(v3.lerp(toLm, EARTH_AIM, k));
  return { pos, target: v3.add(pos, fwd), fov: keys(time, [[T_BOTH, 40], [end, 20, 'inOutSine']]) };
}

export function moonLanding(): Shot<{ planet: Planet; cam: Camera }> {
  return {
    id: 'moonlanding',
    start: ML.start - 0.4,
    end: NE + DISSOLVE / 2,
    fadeIn: 0.8,
    fadeOut: DISSOLVE,
    motionBlur: (time) => (time < T_SET || time > T_BOTH ? 3 : 2),
    async setup(e) {
      return { planet: new Planet(e, await loadEarth(e)), cam: new Camera({ fov: 40, near: 0.05, far: 1e6 }) };
    },
    render(c, s) {
      const time = c.time;
      const tex = terrain(c);
      const landed = time >= T_SET;
      const lm = landed ? { pos: [0, 0, 0] as Vec3, rot: rows([1, 0, 0], [0, 1, 0], [0, 0, 1]) } : lmPose(time);
      const cam = landed ? landedCamera(time) : descentCamera(time, lm.pos);
      s.cam.set({ pos: cam.pos, target: cam.target, up: [0, 1, 0], fov: cam.fov });
      // The Earth, far off in the black sky (drawn first; the Moon goes over it). Out of view
      // until the lander is down.
      if (time > cues.eagleLands) {
        const D = 1e5;
        s.planet.draw(c, s.cam, {
          center: v3.add(cam.pos, v3.scale(EARTH_DIR, D)), radius: D * Math.tan(EARTH_ANG), yaw: 60 * DEG, spin: 0, tilt: 0.3,
          sunDir: SUN, earth: 1, clouds: 0.5, cloudT: 0.8, atmo: 0.5, atmoColor: [0.3, 0.55, 1.0], glint: 0.3,
        });
      }
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
      });
      c.gl.disable(c.gl.BLEND);
    },
  };
}
