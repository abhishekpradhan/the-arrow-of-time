// Act III: collapsing nebula, the Sun and its disk, molten Earth, the Moon-forming impact, oceans.
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
  type Vec3,
} from '@engine';
import { beat, cues, scratch, span } from '../lib';
import { Planet, loadEarth } from '@engine';

// ------------------------------------------------------------------ collapsing nebula
const NEBULA = `
#include <noise>
#include <color>
#include <stars>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uT, uShock, uZoom;
uniform vec2 uSnPos;
void main() {
  vec2 p = centered(vUv, uAspect) / uZoom;
  // Background: a glowing emission nebula (H-alpha crimson with teal OIII pockets) behind the dark cloud.
  vec2 q;
  float em = warpedFbm(p * 1.3 + vec2(3.0, 1.0), uGTime * 0.3, 6, q);
  // Wispy filaments: ridged detail modulating the smooth glow, with dark gaps between.
  float fil = 1.0 - abs(fbm(p * 3.5 + q * 2.0, 5) * 2.0 - 1.0);
  fil = pow(fil, 3.0);
  float lum = pow(em, 2.6) * (0.35 + 1.4 * fil) * smoothstep(0.25, 0.6, em);
  vec3 ha = vec3(0.9, 0.2, 0.25), o3 = vec3(0.15, 0.55, 0.65), glow = vec3(1.0, 0.7, 0.45);
  vec3 emission = mix(ha, o3, smoothstep(0.55, 0.9, q.y) * 0.75);
  emission = mix(emission, glow, smoothstep(0.65, 0.9, em) * 0.45) * lum * 1.6;
  emission += starField(p, 1.0 / (uRes.y * uZoom), uGTime, 11.0, 0.7);
  // Dark dust: columns rising from the bottom, ragged tops.
  float d = fbm(vec2(p.x * 2.2, p.y * 1.4) + vec2(0.0, -0.4) + q * 0.6, 6);
  float columns = smoothstep(0.1, -0.45, p.y - 0.35 * sin(p.x * 3.1 + 1.0) - 0.25 * (d - 0.5) * 2.0);
  float dust = saturate(smoothstep(0.38, 0.72, d) * 0.85 + columns * 0.95);
  // The supernova shock front sweeping through (a thin, turbulent, glowing shell).
  vec2 sp = p - uSnPos;
  float rr = length(sp);
  float ang = atan(sp.y, sp.x);
  float wob = 0.04 * (fbm(vec2(ang * 4.0, uT * 0.5), 4) - 0.5);
  float front = uShock + wob;
  float fade = exp(-max(uT, 0.0) * 0.25);
  float shell = exp(-pow((rr - front) / 0.006, 2.0)) * step(0.0, uShock) * (0.2 + 0.8 * fbm(vec2(ang * 12.0, rr * 20.0), 3)) * smoothstep(0.02, 0.12, uShock);
  float behind = smoothstep(front + 0.01, front - 0.3, rr) * step(0.0, uShock);
  // Dust edges light up as the shock passes (rim lighting); the shell itself is faint and blue.
  float edgeDust = smoothstep(0.2, 0.6, dust) * (1.0 - smoothstep(0.7, 1.0, dust));
  float rim = shell * (0.25 + edgeDust * 3.0) + behind * edgeDust * 0.35;
  vec3 col = emission * (1.0 - dust * 0.96);
  col += vec3(0.3, 0.18, 0.1) * dust * 0.03;
  col += mix(vec3(0.45, 0.65, 1.0), vec3(1.0, 0.7, 0.45), edgeDust) * rim * 1.4 * fade;
  // The dying star itself: a brief blinding point.
  float flash = step(0.0, uT) * exp(-uT * 1.4) * 30.0 + step(0.0, uT) * 0.4;
  col += vec3(0.8, 0.9, 1.0) * flash * exp(-rr * rr / 0.00008);
  fragColor = vec4(col, 1.0);
}`;

function nebula(): Shot<{ half: RenderTarget }> {
  return {
    ...span('nebula', { dIn: 1.2, dOut: 1.2 }),
    setup: (e) => ({ half: scratch(e, 0.5) }),
    render(c, s) {
      const t = c.time - cues.supernova;
      s.half.bind();
      c.fullscreen(c.e.program(NEBULA, 'nebula'), {
        uT: t,
        uShock: t < 0 ? -1 : 0.33 * Math.pow(t, 0.8),
        uSnPos: [-0.62, 0.18],
        uZoom: keys(c.time, [[79, 1.0], [87, 1.35, 'inOutSine']]),
      });
      c.target.bind();
      c.fullscreen(c.e.program(COPY, 'copy'), { uSrc: s.half });
    },
  };
}

const COPY = `
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uSrc;
void main() { fragColor = vec4(texture(uSrc, vUv).rgb, 1.0); }`;

// ------------------------------------------------------------------ the Sun and its disk
const DISK = `
#include <noise>
#include <color>
#include <camera>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uIgnite, uStar, uClump;
// Surface density of the disk with ALMA-like rings and gaps.
float diskDensity(vec2 xz) {
  float r = length(xz);
  float a = atan(xz.y, xz.x);
  float prof = smoothstep(0.08, 0.2, r) * exp(-r * 1.3) * smoothstep(2.6, 1.7, r);
  float gaps = 1.0;
  gaps *= 1.0 - 0.85 * exp(-pow((r - 0.55) / 0.035, 2.0));
  gaps *= 1.0 - 0.7 * exp(-pow((r - 0.86) / 0.03, 2.0));
  gaps *= 1.0 - 0.8 * exp(-pow((r - 1.25) / 0.045, 2.0));
  gaps *= 1.0 - 0.6 * exp(-pow((r - 1.62) / 0.04, 2.0));
  float swirl = fbm(vec2(a * 3.0 + log(r) * 4.0 - uGTime * 0.06, r * 6.0), 4);
  float clumps = pow(fbm(vec2(a * 18.0 - uGTime * 0.3 / max(r, 0.2), r * 40.0), 3), 3.0) * 3.0 * uClump;
  return prof * gaps * (0.6 + 0.6 * swirl + clumps);
}
void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  vec3 col = vec3(0.0);
  // Thin disk in the y=0 plane, sampled at a few heights for a soft, thick look.
  float trans = 1.0;
  for (int i = 0; i < 5; i++) {
    float y = (float(i) - 2.0) * 0.012;
    if (abs(rd.y) < 1e-4) continue;
    float t = (y - ro.y) / rd.y;
    if (t <= 0.0) continue;
    vec3 pos = ro + rd * t;
    float r = length(pos.xz);
    float dens = diskDensity(pos.xz) * exp(-pow(y / (0.02 + 0.015 * r), 2.0));
    // Lit by the young star (1/r^2 falloff, warm), plus faint thermal glow.
    float lightIn = uStar / (0.15 + r * r * 1.4);
    vec3 dcol = mix(vec3(1.0, 0.62, 0.3), vec3(0.75, 0.45, 0.35), smoothstep(0.3, 1.8, r));
    vec3 em = dcol * dens * (lightIn * 0.9 + 0.05) ;
    float a = saturate(dens * 0.9);
    col += em * a * trans;
    trans *= 1.0 - a * 0.55;
  }
  // The protostar: core, corona glow, and polar jets.
  vec2 sc = rayPointDist(ro, rd, vec3(0.0));
  float d = sc.x;
  float px = 2.0 * uTanHalfFov / uRes.y * sc.y;
  float star = uStar * (exp(-d * d / (2.0 * pow(max(0.012, px), 2.0))) * 12.0 + exp(-d / 0.06) * 1.2 + exp(-d / 0.25) * 0.25);
  vec3 scol = mix(vec3(1.0, 0.55, 0.25), vec3(1.0, 0.9, 0.75), uIgnite);
  col = col + scol * star * (0.35 + 0.65 * trans);
  // Jets along the rotation axis.
  vec3 axis = vec3(0.0, 1.0, 0.0);
  vec2 jc = rayPointDist(ro, rd, vec3(0.0));
  float along = 0.0;
  {
    // distance from ray to the axis line
    vec3 w0 = ro;
    float b = dot(rd, axis);
    float dd = dot(rd, w0), e = dot(axis, w0);
    float den = 1.0 - b * b;
    float tr = (b * e - dd) / max(den, 1e-4);
    float ta = (e - b * dd) / max(den, 1e-4);
    vec3 pr = ro + rd * max(tr, 0.0), pa = axis * ta;
    float dj = length(pr - pa);
    along = abs(ta);
    float jet = exp(-dj * dj / (0.0003 + 0.002 * along)) * exp(-along * 3.0) * smoothstep(0.02, 0.15, along);
    col += vec3(0.55, 0.7, 1.0) * jet * 0.45 * uIgnite * trans;
  }
  fragColor = vec4(col, 1.0);
}`;

function sunBorn(): Shot<{ cam: Camera; sky: Sprites; bits: Sprites; half: RenderTarget }> {
  return {
    ...span('sun', { dIn: 1.2, dOut: 1.0 }),
    setup(e) {
      const r = rng(86);
      const n = 2500;
      const d = allocSprites(n);
      for (let i = 0; i < n; i++) {
        let rr = 0;
        do rr = 0.25 + Math.abs(r.gauss()) * 0.8; while (rr > 2.2);
        const a = r.next() * Math.PI * 2;
        d.position.set([rr * Math.cos(a), r.gauss() * 0.01, rr * Math.sin(a)], i * 3);
        const c = blackbody(r.range(2500, 4000));
        const b = r.range(0.05, 0.3);
        d.color.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
        d.size[i] = r.range(0.002, 0.005);
        d.extra!.set([rr, a, r.next(), 0], i * 4);
      }
      const bits = new Sprites(e, d, {
        animate: `vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
          float a = x.y + uTime * 0.35 / pow(x.x, 1.5);
          return vec3(x.x * cos(a), p.y, x.x * sin(a));
        }`,
      });
      return { cam: new Camera({ fov: 42 }), sky: new Sprites(e, starSphere(rng(87), { count: 7000, brightness: 0.3 })), bits, half: scratch(e, 0.5) };
    },
    render(c, s) {
      const t = c.time - beat('sun').start;
      const az = keys(t, [[-1, -0.35], [9, 0.25, 'inOutSine']]);
      const el = keys(t, [[-1, 0.42], [9, 0.3, 'inOutSine']]);
      const dist = keys(t, [[-1, 3.6], [9, 2.9, 'inOutSine']]);
      s.cam.set({ pos: [Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist], target: [0, -0.05, 0] });
      const ign = prog(c.time, cues.sunIgnite - 0.3, cues.sunIgnite + 0.6, 'outCubic');
      s.half.bind();
      c.fullscreen(c.e.program(DISK, 'disk'), {
        ...s.cam.uniforms(),
        uIgnite: ign,
        uStar: 0.35 + 1.1 * ign + 2.5 * Math.exp(-Math.max(0, c.time - cues.sunIgnite) * 2.0) * (c.time > cues.sunIgnite ? 1 : 0),
        uClump: prog(t, 2, 8),
      });
      c.target.bind();
      s.sky.draw(s.cam, c.time, {}, { sky: true, brightness: 0.8 });
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE);
      c.fullscreen(c.e.program(COPY, 'copy'), { uSrc: s.half });
      c.gl.disable(c.gl.BLEND);
      s.bits.draw(s.cam, c.time, {}, { brightness: 1.0 * prog(t, 1, 5) });
    },
  };
}

// ------------------------------------------------------------------ molten Earth
function impactsAt(time: number, seed: number, from: number, rate: number): [number, number, number, number][] {
  const r = rng(seed);
  const list: [number, number, number, number][] = [];
  for (let k = 0; k < 40; k++) {
    const t0 = from + k / rate + r.range(-0.3, 0.3);
    const dir = r.onSphere();
    // Prefer the visible hemisphere (+z faces the camera in local coordinates at yaw 0).
    const d: Vec3 = [dir[0], dir[1] * 0.8, Math.abs(dir[2]) * 0.8 + 0.3];
    const age = time - t0;
    if (age >= 0 && age < 5) list.push([d[0], d[1], d[2], age]);
  }
  return list.slice(-8);
}

function moltenEarth(): Shot<{ planet: Planet; cam: Camera; sky: Sprites }> {
  return {
    ...span('earth', { dIn: 1.0, dOut: 0.6 }),
    setup: (e) => ({ planet: new Planet(e), cam: new Camera({ fov: 32 }), sky: new Sprites(e, starSphere(rng(94), { count: 8000, brightness: 0.35 })) }),
    render(c, s) {
      const t = c.time - beat('earth').start;
      s.cam.set({ pos: [0.0, 0.25, keys(t, [[-1, 4.2], [7, 3.5, 'inOutSine']])], target: [0.35, 0.05, 0] });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      s.planet.draw(c, s.cam, {
        center: [0, 0, 0],
        radius: 1,
        spin: c.time * 0.05,
        tilt: 0.3,
        sunDir: [-0.8, 0.25, 0.55],
        sunColor: [1.3, 1.2, 1.05],
        seed: 3,
        lava: 1,
        crust: keys(t, [[-1, 0.25], [7, 0.55]]),
        atmo: 0.45,
        atmoColor: [0.9, 0.45, 0.2],
        haze: 0.05,
        hazeColor: [0.6, 0.3, 0.15],
        nightGlow: 1,
        impacts: impactsAt(c.time, 11, 93, 1.6),
      });
    },
  };
}

// ------------------------------------------------------------------ Theia impact and the Moon
const DEBRIS_ANIMATE = `
uniform float uAge;      // seconds since impact (<0 before)
uniform vec3 uImpact;    // impact point (world)
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  if (uAge < 0.0) { size = 0.0; return p; }
  // Phase 1: ejecta flung out from the impact site along x.xyz-ish directions (stored in p).
  vec3 dir = normalize(p);
  float speed = 0.35 + 0.9 * x.x;
  vec3 plume = uImpact + dir * speed * (1.0 - exp(-uAge * 1.2)) * 1.2;
  // Phase 2: settle into a ring around Earth (radius ~2-3), orbiting.
  float rr = 1.9 + 1.2 * x.y;
  float ang = x.z * 6.2831 + uAge * 0.5 / pow(rr, 1.5) * 3.0;
  vec3 ring = vec3(rr * cos(ang), (x.w - 0.5) * 0.08, rr * sin(ang));
  float k = smoothstep(1.2, 5.0, uAge + x.x * 0.8);
  vec3 wp = mix(plume, ring, k);
  float heat = exp(-uAge * 0.45);
  col *= (0.35 + 1.1 * heat) * smoothstep(0.0, 0.35, uAge);
  size *= 1.0 + 1.5 * heat;
  return wp;
}`;

function moonForms(): Shot<{ planet: Planet; cam: Camera; sky: Sprites; debris: Sprites }> {
  return {
    ...span('moon', { dIn: 0.6, dOut: 1.2 }),
    setup(e) {
      const r = rng(102);
      const n = 9000;
      const d = allocSprites(n);
      for (let i = 0; i < n; i++) {
        // Direction: a cone around the impact normal, flattened toward the orbital plane.
        const dir = r.onSphere();
        const v: Vec3 = [dir[0] * 0.9 - 0.9, dir[1] * 0.35, dir[2] * 0.9 + 0.2];
        d.position.set(v, i * 3);
        const c = blackbody(r.range(1600, 3200));
        const b = r.range(0.2, 1.2);
        d.color.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
        d.size[i] = r.range(0.004, 0.012);
        d.extra!.set([r.next(), r.next(), r.next(), r.next()], i * 4);
      }
      return {
        planet: new Planet(e),
        cam: new Camera({ fov: 40, far: 200 }),
        sky: new Sprites(e, starSphere(rng(100), { count: 8000, brightness: 0.35 })),
        debris: new Sprites(e, d, { animate: DEBRIS_ANIMATE, minPixels: 0.7 }),
      };
    },
    render(c, s) {
      const t = c.time - beat('moon').start;
      const age = c.time - cues.theia;
      const dist = keys(t, [[-1, 6.5], [2, 7.2], [8.5, 9.5, 'inOutSine']]);
      s.cam.set({ pos: [0.8, keys(t, [[-1, 1.2], [8.5, 3.2, 'inOutSine']]), dist], target: [-0.4, 0, 0] });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      const sun: Vec3 = [-0.3, 0.35, 0.9];
      // Theia approaches from the left and grazes into Earth at the cue.
      const impact: Vec3 = [-0.93, 0.05, 0.35];
      const theiaR = 0.53;
      if (age < 0.25) {
        const k = Math.max(0, -age);
        const cen: Vec3 = [-0.93 - theiaR * 0.95 - k * 0.9, 0.05 + k * 0.1, 0.35 + k * 0.35];
        s.planet.draw(c, s.cam, {
          center: cen, radius: theiaR * (age > 0 ? 1 - age * 2 : 1), spin: c.time * 0.1, sunDir: sun, seed: 17,
          lava: 0.25, crust: 0.8, atmo: 0.0,
        });
      }
      s.planet.draw(c, s.cam, {
        center: [0, 0, 0], radius: 1, spin: c.time * 0.05, tilt: 0.3, sunDir: sun, seed: 3,
        lava: 0.8, crust: 0.5, atmo: 0.35, atmoColor: [0.9, 0.45, 0.2], nightGlow: 1,
        impacts: age >= 0 ? [[-0.93, 0.05, 0.35, age * 0.6]] : [],
      });
      s.debris.draw(s.cam, c.time, { uAge: age, uImpact: impact }, { blend: 'add' });
      // The Moon coalesces out of the ring.
      const moonK = prog(c.time, 105.2, 108.2, 'inOutSine');
      if (moonK > 0) {
        const ang = 2.2 + (c.time - 105) * 0.12;
        s.planet.draw(c, s.cam, {
          center: [2.6 * Math.cos(ang), 0.02, 2.6 * Math.sin(ang)], radius: 0.27 * moonK, spin: 0, sunDir: sun, seed: 41,
          lava: 0.6, crust: 0.6, moon: 0.5,
        });
      }
    },
  };
}

// ------------------------------------------------------------------ oceans
function oceans(): Shot<{ planet: Planet; cam: Camera; sky: Sprites }> {
  return {
    ...span('oceans', { dIn: 1.2, dOut: 1.0 }),
    setup: (e) => ({ planet: new Planet(e), cam: new Camera({ fov: 34 }), sky: new Sprites(e, starSphere(rng(108), { count: 8000, brightness: 0.35 })) }),
    render(c, s) {
      const t = c.time - beat('oceans').start;
      s.cam.set({ pos: [0.3, 0.35, keys(t, [[-1, 5.2], [9, 4.3, 'inOutSine']])], target: [-0.1, 0, 0] });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      const cool = prog(t, -0.5, 3.5, 'inOutSine');
      const flashes: [number, number, number, number][] = [];
      const r = rng(Math.floor(c.time * 3));
      if (t > 1 && r.next() < 0.5) flashes.push([r.range(-0.6, 0.6), r.range(-0.5, 0.5), 0.8, 0.8]);
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
  return [nebula(), sunBorn(), moltenEarth(), moonForms(), oceans()];
}
