// Act III: collapsing nebula, the Sun and its disk, molten Earth, the Moon-forming impact, oceans.
import {
  Camera,
  Planet,
  Sprites,
  allocSprites,
  blackbody,
  keys,
  loadEarth,
  planetLocal,
  prog,
  rng,
  smoothstep,
  starSphere,
  v3,
  type RenderTarget,
  type Shot,
  type Vec3,
} from '@engine';
import { beat, cues, scratch, span } from '../lib';

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
      s.cam.set({ pos: [0.0, 0.25, keys(t, [[-1, 4.4], [7, 3.8, 'inOutSine']])], target: [0.55, 0.05, 0] });
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
// A grazing giant impact in the orbital plane (y = 0, Earth radius 1, prograde = increasing
// angle in the xz plane). Theia plows into Earth at 45 degrees; the ejecta follow Kepler orbits
// around Earth, so slower and faster fragments shear into a spiral arm, which collisions then
// circularize into a disk; the Moon accretes from the disk just outside the Roche limit
// (~2.9 Earth radii). Time is compressed: a circular orbit at r = 3 takes about 8 s.
const GM = 18;
const THEIA_R = 0.53;
const CONTACT = 2.3; // contact direction, radians in the plane
const THEIA_SPEED = 1.35; // Earth radii per second on approach
const MOON_A = 3.0;
const MOON_SIZE = 0.27;
const inPlane = (th: number): Vec3 => [Math.cos(th), 0, Math.sin(th)];
const U_C = inPlane(CONTACT);
const T_C: Vec3 = [-Math.sin(CONTACT), 0, Math.cos(CONTACT)];
/** Theia's velocity: halfway between grazing (prograde) and straight down. */
const V_THEIA = v3.norm(v3.sub(T_C, U_C));
const THEIA_AT_CONTACT = v3.scale(U_C, 1 + THEIA_R);

function theiaCenter(age: number): Vec3 {
  // Before contact: a straight line in. After: it plows on, decelerating, into the Earth.
  const s = age < 0 ? age * THEIA_SPEED : THEIA_SPEED * (age - 0.42 * age * age);
  return v3.add(THEIA_AT_CONTACT, v3.scale(V_THEIA, age < 0 ? s : Math.min(s, THEIA_SPEED * 0.595)));
}

function moonPos(age: number): Vec3 {
  const n = Math.sqrt(GM / MOON_A ** 3);
  return v3.scale(inPlane(CONTACT + 0.3 + n * (age - 3)), MOON_A); // forms left, ends upper right
}

// position = (a, e, argument of periapsis); extra = (launch time, mean anomaly at launch, height, T0)
// colour = (emissive intensity, rock albedo, fade rate).
const KEPLER = `
#include <color>
uniform float uAge;
uniform float uGM;
uniform vec3 uMoon;
uniform float uMoonK;
uniform float uMoonA;
uniform vec3 uContact;
float orbitAngle(float a, float e, float w, float M, out float r) {
  float Mr = mod(M + 3.14159265, 6.28318531) - 3.14159265;
  float E = Mr + e * sin(Mr);
  for (int i = 0; i < 6; i++) E -= (E - e * sin(E) - Mr) / (1.0 - e * cos(E));
  r = a * (1.0 - e * cos(E));
  float nu = 2.0 * atan(sqrt(1.0 + e) * sin(0.5 * E), sqrt(1.0 - e) * cos(0.5 * E));
  return w + nu + (M - Mr);
}
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  float t = uAge - x.x;
  float a = p.x, e = p.y, w = p.z;
  float n = sqrt(uGM / (a * a * a));
  // Fallback ejecta (periapsis inside the Earth) land after a symmetric arc.
  bool falls = a * (1.0 - e) < 1.0;
  if (t < 0.0 || (falls && t > (6.28318531 - 2.0 * x.y) / n)) { size = 0.0; return vec3(0.0); }
  float r;
  float th = orbitAngle(a, e, w, x.y + n * t, r);
  // Collisions circularize the debris: blend toward the circular orbit with the same angular
  // momentum (radius a(1 - e^2)), starting from where the fragment is at uAge = 2.4.
  float rc = a * (1.0 - e * e);
  float k = falls ? 0.0 : smoothstep(2.4, 6.2, uAge);
  if (k > 0.0) {
    float r1;
    float t1 = 2.4 - x.x;
    float th1 = orbitAngle(a, e, w, x.y + n * t1, r1);
    float thc = th1 + sqrt(uGM / (rc * rc * rc)) * (t - t1);
    th = mix(th, thc, k);
    r = mix(r, rc, k);
  }
  // A thin sheet near the Earth that thickens outward, then settles into a flat disk.
  float y = x.z * max(r - 0.97, 0.0) * (0.25 + 0.75 * exp(-uAge * 0.45));
  vec3 pos = vec3(r * cos(th), y, r * sin(th));
  // Every fragment leaves the impact site first, then joins its orbit (in the real event the
  // deformed bodies torque the spray onto these orbits).
  float launch = smoothstep(0.0, 0.55, t);
  pos = mix(uContact * (1.0 + 0.15 * t), pos, launch);
  // The Moon sweeps its feeding zone: fragments nearby are drawn in and vanish into it.
  float zone = smoothstep(1.1, 0.25, abs(rc - uMoonA));
  if (uMoonK > 0.0 && zone > 0.0) {
    float d = distance(pos, uMoon);
    float pull = uMoonK * zone * smoothstep(1.9, 0.2, d);
    pos = mix(pos, uMoon, pull * 0.8);
    float gone = uMoonK * zone * (0.55 + 0.45 * smoothstep(1.5, 0.0, d));
    col *= 1.0 - 0.9 * gone;
    size *= 1.0 - 0.6 * gone;
  }
  // Cooling: white-hot at launch, deep red after a few seconds; cold rock keeps a faint albedo.
  float cool = exp(-t * col.b);
  float T = x.w * (0.3 + 0.7 * cool);
  float glow = pow(T / x.w, 3.0);
  // Dimmer while still inside the dense spray at the impact site (it would saturate).
  col = blackbody(T) * col.r * glow * (0.3 + 0.7 * launch) + vec3(0.55, 0.5, 0.46) * col.g;
  size *= 1.0 + 0.8 * cool;
  return pos;
}`;

const SPLASH = `
#include <color>
uniform float uAge;
uniform vec3 uC;
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  float t = uAge - x.x;
  if (t < 0.0 || t > 2.2) { size = 0.0; return uC; }
  vec3 pos = uC + p * t * (1.0 - 0.28 * t);
  float heat = exp(-t * (1.6 + 1.2 * x.y));
  col = blackbody(2200.0 + 5200.0 * heat) * col.r * heat * heat * (1.0 + 3.0 * exp(-t * 9.0));
  size *= 1.0 + t * (1.5 + 3.0 * x.z);
  return pos;
}`;

/** The contact flash: a white core, an orange fireball and a wide glare, decaying at different rates. */
const FLASH = `
uniform float uAge;
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  if (uAge < 0.0) { size = 0.0; return p; }
  col *= exp(-uAge * x.x) * (1.0 + 2.0 * exp(-uAge * 14.0));
  size *= 1.0 + uAge * x.y;
  return p;
}`;

function moonForms(): Shot<{
  earth: Planet;
  theia: Planet;
  moon: Planet;
  cam: Camera;
  sky: Sprites;
  debris: Sprites;
  vapor: Sprites;
  splash: Sprites;
  flash: Sprites;
  half: RenderTarget;
}> {
  return {
    ...span('moon', { dIn: 0.6, dOut: 1.2 }),
    setup(e) {
      const r = rng(102);
      // Orbiting ejecta and fallback arcs share one Kepler shader.
      const nArm = 42000, nFall = 10000;
      const debris = allocSprites(nArm + nFall);
      const orbit = (i: number, rp: number, ra: number, thL: number, tL: number, fall: boolean) => {
        const a = (rp + ra) / 2, e = (ra - rp) / (ra + rp);
        let M = 0, w = thL;
        if (fall) {
          // Launch from the surface (r = 1.02) on the outbound branch.
          const nu = Math.acos(Math.min(1, Math.max(-1, ((a * (1 - e * e)) / 1.02 - 1) / e)));
          const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
          M = E - e * Math.sin(E);
          w = thL - nu;
        }
        debris.position.set([a, e, w], i * 3);
        debris.extra!.set([tL, M, r.gauss() * 0.07, r.range(2500, 4600)], i * 4);
      };
      for (let i = 0; i < nArm; i++) {
        const tL = 0.03 + 1.5 * r.next() ** 1.4;
        const outer = r.next() < 0.35;
        const rp = outer ? r.range(1.7, 2.9) : 1.03 + 0.62 * r.next() ** 2;
        const ra = outer ? r.range(3.2, 6.2) : Math.max(rp + 0.5, 1.9 + 5.2 * r.next() ** 1.3 - tL * 1.4);
        orbit(i, rp, ra, CONTACT - 0.12 + 0.6 * r.next() ** 0.8, tL, false);
        debris.color.set([r.range(0.25, 0.8), r.range(0.012, 0.03), r.range(0.35, 0.6)], i * 3);
        debris.size[i] = r.range(0.006, 0.017);
      }
      for (let i = nArm; i < nArm + nFall; i++) {
        const tL = 0.02 + 1.3 * r.next() ** 1.4;
        orbit(i, r.range(0.25, 0.92), r.range(1.25, 2.6), CONTACT - 0.25 + 0.8 * r.next(), tL, true);
        debris.color.set([r.range(0.4, 1.2), 0.015, r.range(0.4, 0.7)], i * 3);
        debris.size[i] = r.range(0.006, 0.015);
      }
      // Hot vapour: big soft sprites on the same kind of orbits (drawn at half resolution).
      const nVap = 5000;
      const vapor = allocSprites(nVap);
      for (let i = 0; i < nVap; i++) {
        const tL = 0.03 + 0.9 * r.next() ** 1.5;
        const rp = 1.04 + 0.5 * r.next() ** 2;
        const ra = Math.max(rp + 0.4, 1.8 + 3.8 * r.next() ** 1.4);
        const a = (rp + ra) / 2, e = (ra - rp) / (ra + rp);
        vapor.position.set([a, e, CONTACT - 0.1 + 0.55 * r.next()], i * 3);
        vapor.extra!.set([tL, 0, r.gauss() * 0.12, r.range(3200, 5000)], i * 4);
        vapor.color.set([r.range(0.003, 0.009), 0, r.range(0.8, 1.2)], i * 3);
        vapor.size[i] = r.range(0.04, 0.1);
      }
      // The splash at contact: a fast, short-lived spray, mostly downrange.
      const nSplash = 9000;
      const splash = allocSprites(nSplash);
      for (let i = 0; i < nSplash; i++) {
        const d = r.onSphere();
        const out = v3.add(v3.scale(U_C, Math.abs(v3.dot(d, U_C)) + 0.35), v3.scale(d, 0.8));
        const dir = v3.norm(v3.add(out, v3.scale(T_C, r.range(0.2, 1.3))));
        splash.position.set(v3.scale(dir, r.range(0.5, 3.4) * r.next() ** 0.5), i * 3);
        splash.extra!.set([r.next() ** 2 * 0.35, r.next(), r.next(), 0], i * 4);
        splash.color.set([r.range(0.15, 0.6), 0, 0], i * 3);
        splash.size[i] = r.range(0.006, 0.02);
      }
      const flash = allocSprites(3);
      const layers: [number, Vec3, number, number][] = [
        [0.06, [14, 12.5, 10.5], 7.0, 2.0],
        [0.17, [3.2, 1.45, 0.55], 4.2, 1.6],
        [0.42, [0.22, 0.1, 0.04], 3.0, 1.0],
      ];
      layers.forEach(([size, col, decay, grow], i) => {
        flash.position.set(v3.scale(U_C, 1.02), i * 3);
        flash.color.set(col, i * 3);
        flash.size[i] = size;
        flash.extra!.set([decay, grow, 0, 0], i * 4);
      });
      return {
        earth: new Planet(e),
        theia: new Planet(e),
        moon: new Planet(e),
        cam: new Camera({ fov: 40, far: 200 }),
        sky: new Sprites(e, starSphere(rng(100), { count: 8000, brightness: 0.35 })),
        debris: new Sprites(e, debris, { animate: KEPLER, minPixels: 0.7 }),
        vapor: new Sprites(e, vapor, { animate: KEPLER, minPixels: 1.0, extent: 2.6 }),
        splash: new Sprites(e, splash, { animate: SPLASH, minPixels: 0.7 }),
        flash: new Sprites(e, flash, { animate: FLASH, minPixels: 1.0, maxPixels: 500 }),
        half: scratch(e, 0.5, true),
      };
    },
    render(c, s) {
      const t = c.time - beat('moon').start;
      const age = c.time - cues.theia;
      // Camera: above the orbital plane and uprange, so the contact lands on Earth's left limb and
      // the spray arcs up and over; then it rises and pulls back to reveal the arm winding into a disk.
      const el = keys(t, [[-1, 0.5], [2.1, 0.62, 'inOutSine'], [4.6, 0.95, 'inOutSine'], [8.5, 1.1, 'inOutSine']]);
      const dist = keys(t, [[-1, 5.4], [2.1, 5.0, 'inOutSine'], [4.6, 8.6, 'inOutSine'], [8.5, 11.0, 'inOutSine']]);
      const az = keys(t, [[-1, 0.02], [8.5, 0.32, 'inOutSine']]);
      const side = v3.norm(v3.add(v3.scale(T_C, -Math.cos(az)), v3.scale(U_C, -Math.sin(az))));
      // Theia enters from the left; afterwards the Earth sits right of centre (caption at left).
      const look: Vec3 = v3.scale(U_C, keys(t, [[-1, 0.95], [2.0, 0.65], [4.6, 1.15, 'inOutSine'], [8.5, 1.5, 'inOutSine']]));
      s.cam.set({
        pos: v3.add(look, v3.add(v3.scale(side, dist * Math.cos(el)), [0, dist * Math.sin(el), 0])),
        target: look,
        roll: keys(t, [[-1, -0.06], [4.6, 0.0, 'inOutSine']]),
      });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      const sun: Vec3 = [0.35, 0.3, -0.9];
      const earthRot = { spin: c.time * 0.05, tilt: 0.3 };
      const heat = age > 0 ? smoothstep(0.1, 2.5, age) : 0;
      s.earth.draw(c, s.cam, {
        center: [0, 0, 0], radius: 1, ...earthRot, sunDir: sun, seed: 3,
        lava: 0.78 + 0.22 * heat, crust: 0.5 - 0.25 * heat, atmo: 0.35 + 0.3 * heat, atmoColor: [0.95, 0.45, 0.18], nightGlow: 1 + heat,
        impacts: age >= 0 ? [[...v3.scale(planetLocal(earthRot, U_C), 11), age] as [number, number, number, number]] : [],
        depthTest: true,
      });
      const theiaR = (age: number) => THEIA_R * (1 - 0.6 * smoothstep(0.1, 1.2, age));
      if (age < 1.2) {
        const k = Math.max(0, age);
        const melt = smoothstep(0.0, 0.5, k);
        s.theia.draw(c, s.cam, {
          center: theiaCenter(age), radius: theiaR(k), spin: c.time * 0.15, tilt: 0.5,
          sunDir: sun, seed: 17, lava: 0.3 + 0.7 * melt, crust: 0.85 - 0.6 * melt, moon: 0.45 * (1 - melt), nightGlow: 0.4 + 2 * melt,
          depthTest: true,
        });
      }
      const moonK = smoothstep(3.0, 6.0, age);
      const mp = moonPos(age);
      const moonR = MOON_SIZE * Math.cbrt(moonK);
      if (moonK > 0.01) {
        s.moon.draw(c, s.cam, {
          center: mp, radius: moonR, spin: c.time * 0.2, sunDir: sun, seed: 41,
          lava: 0.9 - 0.3 * moonK, crust: 0.45, moon: 0.35, nightGlow: 1.2, depthTest: true,
        });
      }
      const u = { uAge: age, uGM: GM, uMoon: mp, uMoonK: moonK, uMoonA: MOON_A, uContact: U_C };
      if (age > 0) {
        // Vapour at half resolution, depth-tested against the bodies (drawn there depth-only).
        s.half.clear(0, 0, 0, 0);
        c.gl.colorMask(false, false, false, false);
        s.earth.draw(c, s.cam, { center: [0, 0, 0], radius: 1, sunDir: sun, depthTest: true });
        if (age < 1.2) s.theia.draw(c, s.cam, { center: theiaCenter(age), radius: theiaR(age), sunDir: sun, depthTest: true });
        if (moonK > 0.01) s.moon.draw(c, s.cam, { center: mp, radius: moonR, sunDir: sun, depthTest: true });
        c.gl.colorMask(true, true, true, true);
        s.vapor.draw(s.cam, c.time, u, { blend: 'add', depthTest: true });
        c.target.bind();
        c.gl.enable(c.gl.BLEND);
        c.gl.blendFunc(c.gl.ONE, c.gl.ONE);
        c.fullscreen(c.e.program(COPY, 'copy'), { uSrc: s.half });
        c.gl.disable(c.gl.BLEND);
        s.debris.draw(s.cam, c.time, u, { blend: 'add', depthTest: true });
        s.splash.draw(s.cam, c.time, { uAge: age, uC: U_C }, { blend: 'add', depthTest: true });
        s.flash.draw(s.cam, c.time, { uAge: age }, { blend: 'add' });
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
      s.cam.set({ pos: [0.3, 0.35, keys(t, [[-1, 5.2], [9, 4.3, 'inOutSine']])], target: [-0.5, 0, 0] });
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
