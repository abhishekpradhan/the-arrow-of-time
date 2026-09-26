// Act II: dark ages -> first stars -> galaxies (one continuous flight through the cosmic web),
// then the Milky Way.
import {
  Camera,
  Sprites,
  allocSprites,
  blackbody,
  keys,
  prog,
  rng,
  starSphere,
  volumeTexture,
  type RenderTarget,
  type Shot,
  type Texture,
  type Vec3,
} from '@engine';
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
uniform vec2 uRes; uniform float uAspect;
uniform float uGlow, uMarch, uGas;
uniform vec3 uColA, uColB;
void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  float jitter = hash12(gl_FragCoord.xy);
  const int STEPS = 44;
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
  // A tiny galaxy: inclined 2-arm log spiral or smooth elliptical.
  float ang = x.z * TAU;
  vec2 u = rot2(ang) * q / 3.0;
  float incl = 0.22 + 0.78 * fract(x.z * 7.31);
  u.y /= incl;
  float r = length(u);
  float th = atan(u.y, u.x);
  float spiral = step(0.3, fract(x.z * 3.7));
  float arms = 0.5 + 0.5 * cos(2.0 * (th - log(r + 0.04) * 2.6));
  float disk = exp(-r * 5.0) * mix(1.0, 0.25 + 1.1 * arms * arms, spiral);
  float core = exp(-r * r * 70.0) * 1.6;
  vec3 c = col * (disk * mix(vec3(1.0, 0.85, 0.65), vec3(0.65, 0.8, 1.0), spiral) + core * vec3(1.0, 0.86, 0.62));
  float edge = smoothstep(1.0, 0.7, r);
  return vec4(c * edge, saturate(disk + core) * edge);
}`;

interface WebState {
  vol: Texture;
  half: RenderTarget;
  objs: Sprites;
  sky: Sprites;
  cam: Camera;
  path: (t: number) => { pos: Vec3; target: Vec3 };
}

function webShot(): Shot<WebState> {
  const b0 = beat('darkages');
  const b1 = beat('galaxies');
  const hero: Vec3 = [0.42, 0.33, -1.06];
  // Camera flight: slow drift through the dark, then accelerating towards the hero galaxy.
  const path = (t: number) => {
    const s = keys(t, [[b0.start - 1, 0], [64, 0.42, 'linear'], [70.4, 0.98, 'inQuad']]);
    const start: Vec3 = [0.13, 0.27, 0.05];
    const dir: Vec3 = [hero[0] - start[0], hero[1] - start[1], hero[2] - start[2]];
    const L = Math.hypot(dir[0], dir[1], dir[2]);
    const u: Vec3 = [dir[0] / L, dir[1] / L, dir[2] / L];
    const d = s * L * 0.985;
    const wob = (1 - prog(t, 62, 69, 'inOutSine')) * 0.03;
    const pos: Vec3 = [start[0] + u[0] * d + Math.sin(t * 0.21) * wob, start[1] + u[1] * d + Math.cos(t * 0.17) * wob, start[2] + u[2] * d];
    const look = prog(t, 58, 66, 'inOutSine');
    const target: Vec3 = [
      pos[0] + u[0] + (1 - look) * 0.25,
      pos[1] + u[1] + (1 - look) * 0.08,
      pos[2] + u[2],
    ];
    return { pos, target };
  };
  return {
    id: 'web',
    start: b0.start - 0.6,
    end: b1.end + 0.7,
    fadeIn: 1.2,
    fadeOut: 1.4,
    setup(e) {
      const { data, dens } = buildWeb(5);
      const vol = volumeTexture(e.gl, [N, N, N], data, { format: 'r8', wrap: 'repeat' });
      const r = rng(56);
      const cam = new Camera({ fov: 58, near: 0.001, far: 100 });
      // Stars along filaments near the flight path; the first 12 are synced to the score.
      const nStars = 1400, nGal = 2600;
      const d = allocSprites(nStars + nGal + 1);
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
      // The hero galaxy we fly into (a barred spiral, like ours).
      d.position.set(hero, i * 3);
      d.color.set([1.2, 1.2, 1.2], i * 3);
      d.size[i] = 0.012;
      d.extra!.set([63.5, 0, 0.62, 1], i * 4);
      const objs = new Sprites(e, d, { animate: OBJ_ANIMATE, shade: OBJ_SHADE, minPixels: 0.7, maxPixels: 1200 });
      const sky = new Sprites(e, starSphere(rng(9), { count: 6000, brightness: 0.25 }));
      return { vol, half: scratch(e, 0.5), objs, sky, cam, path };
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
    },
  };
}

// ------------------------------------------------------------ the Milky Way
const MW_ANIMATE = `
uniform float uSpin;
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  float r = length(p.xz);
  // Flat rotation curve with a solid-body core: omega ~ 1/r outside ~0.12.
  float omega = 1.0 / max(r, 0.12);
  float a = -uSpin * omega;
  float c = cos(a), s = sin(a);
  return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
}`;

const DUST_SHADE = `
vec4 shade(vec2 q, vec3 col, vec4 x) {
  float g = exp(-0.5 * dot(q, q));
  float a = g * col.r;
  return vec4(0.0, 0.0, 0.0, a);
}`;

/**
 * A barred spiral built from sprites: sparkle stars, a smooth luminous glow layer following the
 * same arm structure, pink star-forming knots, a warm bulge, and dust lanes (drawn as absorbers).
 */
export function galaxyData(seed: number, o: { stars?: number; glow?: number; scale?: number } = {}) {
  const r = rng(seed);
  const nStars = o.stars ?? 110000, nGlow = o.glow ?? 26000, nHII = 900, nBulge = 9000;
  // Point-like stars render at full resolution; the smooth glow layer at half resolution.
  const stars = allocSprites(nStars + nHII);
  const glow = allocSprites(nGlow + nBulge);
  let i = 0, j = 0;
  const put = (p: Vec3, c: Vec3, b: number, size: number) => {
    stars.position.set(p, i * 3);
    stars.color.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    stars.size[i] = size;
    i++;
  };
  const putGlow = (p: Vec3, c: Vec3, b: number, size: number) => {
    glow.position.set(p, j * 3);
    glow.color.set([c[0] * b, c[1] * b, c[2] * b], j * 3);
    glow.size[j] = size;
    j++;
  };
  const barAngle = 0.45, barLen = 0.2;
  const pitch = (19 * Math.PI) / 180;
  const arms = [
    { phase: barAngle, w: 1.0 },
    { phase: barAngle + Math.PI, w: 1.0 },
    { phase: barAngle + Math.PI / 2, w: 0.55 },
    { phase: barAngle + (3 * Math.PI) / 2, w: 0.55 },
  ];
  const armAngle = (phase: number, rr: number) => phase + Math.log(Math.max(rr, barLen) / barLen) / Math.tan(pitch);
  /** Sample a disk point: in an arm (with physical width) or in the smooth disk / bar. */
  const sample = (armFrac: number, width: number) => {
    let rr = 0;
    do rr = -Math.log(1 - r.next()) * 0.3 + 0.03; while (rr > 1.1);
    let th: number, armW = 0;
    if (r.next() < armFrac && rr > barLen * 0.8) {
      const a = arms[r.next() < 0.7 ? r.int(0, 1) : r.int(2, 3)];
      armW = a.w;
      th = armAngle(a.phase, rr) + (r.gauss() * width) / rr;
    } else if (rr < barLen * 1.1 && r.next() < 0.6) {
      // Bar: an elongated distribution along barAngle.
      const x = r.gauss() * barLen * 0.55, z = r.gauss() * barLen * 0.16;
      const c = Math.cos(barAngle), sn = Math.sin(barAngle);
      return { p: [c * x - sn * z, r.gauss() * 0.015, sn * x + c * z] as Vec3, rr: Math.hypot(x, z), armW: 0, bar: true };
    } else th = r.next() * Math.PI * 2;
    const y = r.gauss() * (0.01 + 0.012 * rr);
    return { p: [rr * Math.cos(th), y, rr * Math.sin(th)] as Vec3, rr, armW, bar: false };
  };
  for (let k = 0; k < nStars; k++) {
    const s0 = sample(0.7, 0.05);
    const young = s0.armW > 0 && r.next() < 0.6 * s0.armW;
    const T = young ? r.range(8000, 18000) : s0.bar || s0.rr < 0.15 ? r.range(3600, 5200) : r.range(4300, 7500);
    const bri = (young ? r.range(0.25, 1.1) : r.range(0.12, 0.5)) * (Math.pow(r.next(), 6) * 3 + 0.6) * 0.085;
    put(s0.p, blackbody(T), bri, young ? 0.0026 : 0.0022);
  }
  for (let k = 0; k < nGlow; k++) {
    const s0 = sample(0.62, 0.055);
    const warm = Math.exp(-s0.rr * 5);
    const arm = s0.armW > 0 ? 1 : 0;
    const cool: Vec3 = arm ? [0.55, 0.72, 1.0] : [0.85, 0.85, 0.9];
    const hot: Vec3 = [1.0, 0.7, 0.38];
    const c: Vec3 = [cool[0] + (hot[0] - cool[0]) * warm, cool[1] + (hot[1] - cool[1]) * warm, cool[2] + (hot[2] - cool[2]) * warm];
    putGlow(s0.p, c, 0.0032 * (0.6 + 0.8 * warm + 0.45 * s0.armW), r.range(0.022, 0.045));
  }
  for (let k = 0; k < nHII; k++) {
    let rr = 0;
    do rr = -Math.log(1 - r.next()) * 0.3 + 0.22; while (rr > 1.0);
    const a = arms[r.int(0, 3)];
    const th = armAngle(a.phase, rr) + (r.gauss() * 0.03) / rr + 0.04;
    put([rr * Math.cos(th), r.gauss() * 0.006, rr * Math.sin(th)], [1.0, 0.3, 0.45], r.range(0.3, 1.0) * 0.45, r.range(0.003, 0.008));
  }
  for (let k = 0; k < nBulge; k++) {
    const rr = Math.abs(r.gauss()) * 0.07;
    const d = r.onSphere();
    putGlow([d[0] * rr, d[1] * rr * 0.6, d[2] * rr], blackbody(r.range(3200, 4200)), 0.011, r.range(0.012, 0.03));
  }
  const nDust = 30000;
  const dust = allocSprites(nDust);
  for (let k = 0; k < nDust; k++) {
    let rr = 0;
    do rr = -Math.log(1 - r.next()) * 0.3 + 0.12; while (rr > 1.0);
    const a = arms[r.next() < 0.75 ? r.int(0, 1) : r.int(2, 3)];
    // Break the lanes into patches: skip dust where a slow noise along the arm is low.
    const patch = 0.5 + 0.5 * Math.sin(rr * 23 + a.phase * 3) * Math.sin(rr * 9.7 + a.phase);
    if (r.next() > 0.25 + 0.75 * patch) {
      dust.size[k] = 0;
      continue;
    }
    const th = armAngle(a.phase, rr) - 0.05 / rr + (r.gauss() * 0.02) / rr + (r.next() < 0.3 ? r.gauss() * 0.05 : 0);
    dust.position.set([rr * Math.cos(th), r.gauss() * 0.005, rr * Math.sin(th)], k * 3);
    dust.color.set([r.range(0.04, 0.16) * a.w, 0, 0], k * 3);
    dust.size[k] = r.range(0.006, 0.016);
  }
  return { stars, glow, dust };
}

function milkyWay(): Shot<{ stars: Sprites; glow: Sprites; dust: Sprites; sky: Sprites; cam: Camera; half: RenderTarget }> {
  return {
    ...span('milkyway', { dIn: 1.4, dOut: 1.2 }),
    setup(e) {
      const { stars, glow, dust } = galaxyData(70);
      return {
        half: scratch(e, 0.5),
        glow: new Sprites(e, glow, { animate: MW_ANIMATE, minPixels: 1.0, extent: 2.6 }),
        stars: new Sprites(e, stars, { animate: MW_ANIMATE, minPixels: 0.6 }),
        dust: new Sprites(e, dust, { animate: MW_ANIMATE, shade: DUST_SHADE, minPixels: 1.0 }),
        sky: new Sprites(e, starSphere(rng(71), { count: 9000, brightness: 0.35 })),
        cam: new Camera({ fov: 45, near: 0.01, far: 100 }),
      };
    },
    render(c, s) {
      const t = c.time - beat('milkyway').start;
      // A sweeping reveal: from low over the disk up to a high, three-quarter view.
      const el = keys(t, [[-1, 0.3], [10.5, 1.05, 'inOutSine']]);
      const az = keys(t, [[-1, 1.75], [10.5, 2.95, 'inOutSine']]);
      const dist = keys(t, [[-1, 1.05], [3.5, 1.85, 'outCubic'], [10.5, 2.25]]);
      s.cam.set({
        pos: [Math.cos(el) * Math.sin(az) * dist, Math.sin(el) * dist, Math.cos(el) * Math.cos(az) * dist],
        target: [0, -0.05, 0],
        roll: keys(t, [[-1, -0.25], [10.5, 0.05, 'inOutSine']]),
      });
      const spin = 0.02 * t;
      s.half.clear(0, 0, 0, 1);
      s.glow.draw(s.cam, c.time, { uSpin: spin }, { blend: 'add', brightness: 1.0 });
      c.target.bind();
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE);
      c.fullscreen(c.e.program(WEB_COMPOSITE, 'web.comp'), { uSrc: s.half });
      c.gl.disable(c.gl.BLEND);
      s.stars.draw(s.cam, c.time, { uSpin: spin }, { blend: 'add', brightness: 1.0 });
      s.dust.draw(s.cam, c.time, { uSpin: spin }, { blend: 'premul' });
    },
  };
}

export function dawnShots(): Shot[] {
  return [webShot(), milkyWay()];
}
