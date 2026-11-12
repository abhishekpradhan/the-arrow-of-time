// Act III: collapsing nebula, the Sun and its disk, molten Earth, the Moon-forming impact, oceans.
import {
  Camera,
  Planet,
  Sprites,
  allocSprites,
  blackbody,
  keys,
  prog,
  rng,
  smoothstep,
  starSphere,
  RenderTarget,
  volumeTexture,
  type GL,
  type Shot,
  type Texture,
  type Vec3,
} from '@engine';
import type { Look } from '@engine';
import { beat, cues, span } from '../lib';
import { giantImpact, moonAt, youngEarthView, youngMoon } from './moon';

// ------------------------------------------------------------------ noise volume
// A tiling 3D noise texture for the volumes marched below (rgba8: r and g are large shapes of
// three octaves each, b is finer detail and a is ridged, for filaments). One fetch gives four
// decorrelated fields, so a march can afford shadows. Built on first use, once per GL context.
const NOISE_N = 96;
const noiseCache = new WeakMap<GL, Texture>();

function noiseVolume(gl: GL): Texture {
  const hit = noiseCache.get(gl);
  if (hit) return hit;
  const n = NOISE_N, r = rng(4600);
  const fbm = (lattices: number[], weights: number[]) => {
    const out = new Float32Array(n * n * n);
    lattices.forEach((L, o) => {
      const g = new Float32Array(L * L * L);
      for (let i = 0; i < g.length; i++) g[i] = r.next();
      const i0 = new Int32Array(n), i1 = new Int32Array(n), w = new Float32Array(n);
      for (let x = 0; x < n; x++) {
        const f = ((x + 0.5) / n) * L, i = Math.floor(f), u = f - i;
        i0[x] = i % L;
        i1[x] = (i + 1) % L;
        w[x] = u * u * u * (u * (u * 6 - 15) + 10);
      }
      const a = weights[o];
      let idx = 0;
      for (let z = 0; z < n; z++) {
        const z0 = i0[z] * L * L, z1 = i1[z] * L * L, wz = w[z];
        for (let y = 0; y < n; y++) {
          const y0 = i0[y] * L, y1 = i1[y] * L, wy = w[y];
          const a00 = z0 + y0, a01 = z0 + y1, a10 = z1 + y0, a11 = z1 + y1;
          for (let x = 0; x < n; x++) {
            const x0 = i0[x], x1 = i1[x], wx = w[x];
            const c00 = g[a00 + x0] + (g[a00 + x1] - g[a00 + x0]) * wx;
            const c01 = g[a01 + x0] + (g[a01 + x1] - g[a01 + x0]) * wx;
            const c10 = g[a10 + x0] + (g[a10 + x1] - g[a10 + x0]) * wx;
            const c11 = g[a11 + x0] + (g[a11 + x1] - g[a11 + x0]) * wx;
            const c0 = c00 + (c01 - c00) * wy, c1 = c10 + (c11 - c10) * wy;
            out[idx++] += a * (c0 + (c1 - c0) * wz);
          }
        }
      }
    });
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < out.length; i++) {
      if (out[i] < lo) lo = out[i];
      if (out[i] > hi) hi = out[i];
    }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo);
    return out;
  };
  const chans = [
    fbm([4, 8, 16], [0.55, 0.3, 0.15]),
    fbm([4, 8, 16], [0.55, 0.3, 0.15]),
    fbm([8, 16, 32], [0.5, 0.32, 0.18]),
    fbm([6, 12, 24], [0.5, 0.32, 0.18]),
  ];
  // Ridged: bright along the lines where the field crosses its middle.
  const ridged = chans[3];
  for (let i = 0; i < ridged.length; i++) ridged[i] = Math.pow(Math.max(0, 1 - Math.abs(2 * ridged[i] - 1) * 1.6), 1.5);
  const data = new Uint8Array(n * n * n * 4);
  for (let i = 0; i < n * n * n; i++)
    for (let k = 0; k < 4; k++) data[i * 4 + k] = Math.round(255 * chans[k][i]);
  const tex = volumeTexture(gl, [n, n, n], data, { format: 'rgba8', wrap: 'repeat', filter: 'linear' });
  noiseCache.set(gl, tex);
  return tex;
}

// ------------------------------------------------------------------ collapsing nebula
// The cloud is marched as a volume (shaders/nebula-cloud.glsl). The camera pushes in on the head
// of the tallest pillar: the blast wave of a supernova crosses the frame, the head falls in on
// itself, and an ember lights inside it where the next shot's protostar will be.
const SN: Vec3 = [-2.35, 1.12, -1.25];
const CORE: Vec3 = [-0.2, 0.3, 0.0];

function nebula(): Shot<{ cam: Camera }> {
  const b = beat('nebula');
  return {
    ...span('nebula', { dIn: 1.2, dOut: 1.2 }),
    // Two samples a frame: they halve the grain of the march and anti-alias the stars.
    motionBlur: 2,
    setup: () => ({ cam: new Camera({ fov: 44, near: 0.05, far: 100 }) }),
    render(c, s) {
      const t = c.time - cues.supernova;
      const u = prog(c.time, b.start - 0.6, b.end + 0.6, 'inOutSine');
      const mix3 = (p: Vec3, q: Vec3): Vec3 => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u];
      s.cam.aspect = c.aspect;
      s.cam.set({ pos: mix3([0.7, -0.05, 3.6], [0.1, 0.2, 1.75]), target: mix3([0.25, 0.12, 0], [CORE[0], CORE[1] - 0.215, CORE[2]]) });
      const sn = s.cam.project(SN);
      c.fullscreen(c.e.program('#include <arrow-of-time/nebula-cloud>', 'nebula'), {
        ...s.cam.uniforms(),
        uNoise: noiseVolume(c.gl),
        uNoiseRes: NOISE_N,
        uSn: SN,
        uSnScreen: [(sn.x - 0.5) * c.aspect, sn.y - 0.5],
        uCore: CORE,
        uSnT: t,
        // The blast wave decelerates as it sweeps up gas.
        uShock: t < 0 ? 0 : 1.45 * Math.pow(t, 0.78),
        uCollapse: prog(c.time, cues.supernova + 2.2, b.end, 'inOutSine'),
        uEmber: prog(c.time, cues.supernova + 2.9, b.end - 0.2, 'inOutSine'),
        uDither: (c.time * 175.44) % 97,
      });
    },
  };
}

// ------------------------------------------------------------------ the Sun and its disk
// The disk is marched as a volume (shaders/sun-disk.glsl): a first pass fills a small table of
// the dust's optical depth from the star, the second paints the picture over the sky. The camera
// starts high over the rings and comes down towards the plane of the disk, where its flare shows.

// What is left of the cloud the Sun formed in, far behind the disk.
const REMNANT = `
#include <common>
#include <camera>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uAmt;
uniform sampler3D uNoise;
void main() {
  vec3 rd = camRay(centered(vUv, uAspect));
  vec4 a = texture(uNoise, rd * 0.42 + 0.21);
  vec4 b = texture(uNoise, rd * 1.5 + a.rgb * 0.3);
  float g = pow(clamp(a.r * 1.25, 0.0, 1.0), 2.6) * (0.3 + 1.0 * b.b) * smoothstep(0.25, 0.65, a.b + 0.25 * b.r);
  vec3 col = mix(vec3(0.6, 0.1, 0.15), vec3(0.1, 0.5, 0.62), smoothstep(0.35, 0.7, a.g));
  fragColor = vec4(col * g * uAmt, 1.0);
}`;

// Orbital speed at r = 1 (radians per second of film); everything in the disk keeps this clock.
const KEPLER = 0.3;
const GAPS = [0.4, 0.62, 0.92, 1.28, 1.7];
const WORLD_PHASE = [1.3, 3.7, 3.5, 2.2, 5.9];
const diskHeight = (r: number) => 0.04 * Math.pow(r, 1.28);

interface DiskState {
  cam: Camera;
  sky: Sprites;
  bits: Sprites;
  shadow: RenderTarget;
}

function sunBorn(): Shot<DiskState> {
  const b = beat('sun');
  return {
    ...span('sun', { dIn: 1.2, dOut: 1.0 }),
    motionBlur: 2,
    setup(e) {
      // Grains and boulders riding the disk's upper surface, catching the light.
      const r = rng(86);
      const n = 2200;
      const d = allocSprites(n);
      for (let i = 0; i < n; i++) {
        let rr = 0;
        do rr = 0.24 + Math.abs(r.gauss()) * 0.85; while (rr > 2.15 || GAPS.some((g) => Math.abs(rr - g) < 0.035));
        const a = r.next() * Math.PI * 2;
        d.position.set([rr * Math.cos(a), diskHeight(rr) * r.range(2.6, 3.6), rr * Math.sin(a)], i * 3);
        const c = blackbody(r.range(2600, 4200));
        const big = Math.pow(r.next(), 5);
        const br = r.range(0.015, 0.06) + 0.3 * big;
        d.color.set([c[0] * br, c[1] * br, c[2] * br], i * 3);
        d.size[i] = r.range(0.0015, 0.003) + 0.002 * big;
        d.extra!.set([rr, a, r.next(), 0], i * 4);
      }
      const bits = new Sprites(e, d, {
        animate: `uniform float uSpin;
        vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
          float a = x.y + uSpin * ${KEPLER.toFixed(2)} / pow(x.x, 1.5);
          col *= 1.0 / (0.25 + x.x * x.x);
          return vec3(x.x * cos(a), p.y, x.x * sin(a));
        }`,
      });
      return {
        cam: new Camera({ fov: 36, near: 0.05, far: 1e5 }),
        sky: new Sprites(e, starSphere(rng(87), { count: 9000, brightness: 0.3 })),
        bits,
        shadow: new RenderTarget(e.gl, 1024, 128, { format: 'rgba16f', filter: 'linear' }),
      };
    },
    render(c, s) {
      const t = c.time - b.start;
      const since = c.time - cues.sunIgnite;
      const ign = prog(c.time, cues.sunIgnite - 0.1, cues.sunIgnite + 0.5, 'outCubic');
      // From high over the rings down towards the plane of the disk, where its flare shows.
      const u = prog(t, -0.6, 8.5, 'inOutSine');
      const az = -0.55 + 0.9 * u, el = 0.6 - 0.26 * u, dist = 6.4 - 1.2 * u;
      s.cam.aspect = c.aspect;
      s.cam.set({ pos: [Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist], target: [0, 0, 0] }).pan(0, -0.098 * dist);
      const gaps = prog(t, -0.6, 7.5, 'inOutSine');
      const spin = c.time - b.start + 20;
      const noise = noiseVolume(c.gl);
      const worlds: number[] = [];
      GAPS.forEach((g, i) => {
        const a = WORLD_PHASE[i] + KEPLER * spin * Math.pow(g, -1.5);
        // The third world ends the shot on the near side, glowing: the next shot is its surface.
        const glow = gaps * gaps * (0.7 + 0.12 * i) * (i === 2 ? 1 + 1.6 * prog(t, 6.2, 8.2, 'inOutSine') : 1);
        worlds.push(g * Math.cos(a), g * Math.sin(a), glow, 0.0055 + 0.0012 * i);
      });
      const disk = {
        uNoise: noise,
        uGaps: gaps,
        uSpin: spin,
      };
      s.shadow.bind();
      c.fullscreen(c.e.program('#define SHADOW_PASS\n#include <arrow-of-time/sun-disk>', 'disk.shadow'), disk);
      c.target.bind();
      c.fullscreen(c.e.program(REMNANT, 'remnant'), { ...s.cam.uniforms(), uNoise: noise, uAmt: 0.26 });
      s.sky.draw(s.cam, c.time, {}, { sky: true, brightness: 1.0 });
      const star = 0.4 + 0.6 * ign + (since > 0 ? 1.8 * Math.exp(-since * 2.2) : 0);
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE_MINUS_SRC_ALPHA);
      c.fullscreen(c.e.program('#include <arrow-of-time/sun-disk>', 'disk'), {
        ...s.cam.uniforms(),
        ...disk,
        uShadow: s.shadow,
        uStar: star,
        uHeat: ign,
        // Ignition: the new light crosses the disk in under a second.
        uFront: since < 0 ? 0 : since * 3.4,
        uJet: 0.3 + 0.7 * ign,
        uWorlds: worlds,
        uDither: (c.time * 175.44) % 97,
      });
      c.gl.disable(c.gl.BLEND);
      s.bits.draw(s.cam, c.time, { uSpin: spin }, { brightness: (0.12 + 0.88 * prog(since, 0.1, 0.9)) * star });
    },
  };
}

// ------------------------------------------------------------------ the molten Earth and the Moon-forming impact: shots/moon.ts

// ------------------------------------------------------------------ oceans
function oceans(): Shot<{ planet: Planet; moon: Planet; cam: Camera; sky: Sprites }> {
  return {
    ...span('oceans', { dIn: 1.2, dOut: 1.0 }),
    setup: (e) => ({ planet: new Planet(e), moon: new Planet(e), cam: new Camera({ fov: 34 }), sky: new Sprites(e, starSphere(rng(100), { count: 8000, brightness: 0.35 })) }),
    render(c, s) {
      const t = c.time - beat('oceans').start;
      s.cam.set(youngEarthView(c.time));
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      // A hundred million years on, the Moon has receded and its crust has cooled.
      s.moon.draw(c, s.cam, { center: moonAt(1), radius: 0.27, spin: c.time * 0.03, sunDir: [-0.7, 0.3, 0.6], seed: 41, lava: 0.15, crust: 0.6, moon: 0.9, nightGlow: 0.4 });
      const cool = prog(t, -0.5, 3.5, 'inOutSine');
      const flashes: [number, number, number, number][] = [];
      const r = rng(Math.floor(c.time * 3));
      // The last of the bombardment: each strike flares and its ring spreads for a third of a second.
      if (t > 1 && r.next() < 0.5) flashes.push([r.range(-0.6, 0.6), r.range(-0.5, 0.5), 0.8, ((c.time * 3) % 1) * 1.6]);
      s.planet.draw(c, s.cam, {
        center: [0, 0, 0], radius: 1, spin: c.time * 0.05, tilt: 0.3, sunDir: [-0.7, 0.3, 0.6], seed: 3,
        lava: 1 - cool,
        crust: 0.6 + 0.4 * cool,
        ocean: prog(t, 2, 8, 'inOutSine'),
        seaLevel: keys(t, [[2, -0.6], [8, 0.08, 'outCubic']]),
        oceanColor: [0.03, 0.1, 0.16],
        clouds: keys(t, [[-1, 0.2], [2, 0.7], [8, 0.5]]),
        storm: keys(t, [[-1, 0.8], [8, 0.3]]),
        cloudT: c.time * 0.02,
        atmo: 0.6,
        atmoColor: [0.55, 0.45, 0.4],
        haze: 0.12,
        hazeColor: [0.55, 0.42, 0.3],
        nightGlow: 1 - cool,
        impacts: flashes,
      });
    },
  };
}

export function sunShots(): Shot[] {
  return [nebula(), sunBorn(), giantImpact(), youngMoon(), oceans()];
}

/**
 * Look overrides for this file's beats (bloom, streak, exposure, grade...), merged last in
 * project.ts. Return {} outside them so other shots keep the film's look.
 */
export function sunLook(time: number): Partial<Look> {
  const sun = beat('sun');
  if (time < sun.start - 0.6 || time > sun.end + 0.5) return {};
  // The young star is the brightest thing in the film so far: keep its anamorphic streak from
  // cutting the disk in two, except for a moment at ignition.
  const since = time - cues.sunIgnite;
  const edge = keys(time, [[sun.start - 0.6, 0], [sun.start + 0.4, 1], [sun.end - 0.5, 1], [sun.end + 0.5, 0]]);
  const streak = 0.015 + (since > 0 ? 0.02 * Math.exp(-since * 3.0) : 0);
  return { streak: 0.09 + (streak - 0.09) * edge };
}
