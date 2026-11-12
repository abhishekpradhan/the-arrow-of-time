// Act I: prologue, Big Bang, inflation, first elements, first light.
import { Camera, Sprites, allocSprites, keys, rng, prog, smoothstep, type Engine, type RenderTarget, type Shot, type ShotContext, type Texture, type Vec3 } from '@engine';
import { noiseVolume } from '@engine/components/noise-volume';
import { Streaks } from '@engine/components/streaks';
import type { Look } from '@engine';
import T from '../timeline.json';
import { beat, bt, cues, scratch, span } from '../lib';

// ------------------------------------------------------------------ prologue
// A dark full of dust too faint to see, and a clock. Each tick sends a shell of light out from
// one place in the middle of it, and the dust glitters as the shell passes: for a moment the
// dark has depth. Through the riser the ticks quicken and the whole field falls in on that
// place (a uniform cloud collapses all at once: every mote arrives together), until everything
// there is, is in the point.

/** The silent gap before the bang (GAP in film/score.py): the clock and the music stop here. */
const GAP = 0.35;
const HUSH = cues.bang - GAP;

/** The clock's ticks before the bang, placed as film/score.py places them (tick_schedule). */
const TICKS: number[] = (() => {
  const out: number[] = [];
  for (let t = cues.firstTick; t < cues.riserStart - 1e-9; t += 1) out.push(t);
  // Across the riser the rate climbs from 1 to 5 Hz by a constant ratio per second: pulse n
  // falls where the integral of the rate reaches n.
  const T = HUSH - cues.riserStart, k = Math.log(5);
  for (let n = 0; ; n++) {
    const t = cues.riserStart + (T / k) * Math.log(1 + (n * k) / T);
    if (t >= HUSH - 0.06) break;
    out.push(t);
  }
  return out;
})();

/** The prologue's three piano notes fall on ticks (film/score.py): those shells ring brighter. */
const PIANO = [4, 8, 11].map((dt) => beat('prologue').start + dt);

const SHELLS = 14;
/** World units per second: a shell crosses the frame in about three seconds. */
const SHELL_SPEED = 0.95;

/** Radius and strength of the light shells in flight at `time` (the most recent SHELLS ticks). */
function shellsAt(time: number): { r: number[]; a: number[] } {
  const r = new Array<number>(SHELLS).fill(0), a = new Array<number>(SHELLS).fill(0);
  let n = 0;
  for (let i = TICKS.length - 1; i >= 0 && n < SHELLS; i--) {
    const age = time - TICKS[i];
    if (age < 0) continue;
    // Each shell lives about as long as three ticks last at the moment it was struck, and the
    // ticks strike harder through the riser (as their velocity does in the score).
    const gap = i + 1 < TICKS.length ? TICKS[i + 1] - TICKS[i] : 0.2;
    const life = Math.max(0.5, Math.min(2.6, 2.6 * gap));
    // The first tick is the film's first image, and the piano's notes fall on three others.
    const hard = (1 + 0.035 * i + 1.6 * prog(TICKS[i], cues.riserStart, HUSH, 'inQuad')) * (i === 0 ? 1.35 : PIANO.some((p) => Math.abs(p - TICKS[i]) < 0.05) ? 1.6 : 1);
    r[n] = SHELL_SPEED * age;
    a[n] = hard * Math.exp(-age / life) * smoothstep(0, 0.06, age);
    n++;
  }
  return { r, a };
}

/**
 * Scale of the dust field through the riser: the free fall of a uniform, pressureless cloud
 * (a cycloid), which starts imperceptibly and ends infinitely fast, every part arriving at
 * the centre at the same instant.
 */
function collapseAt(time: number): number {
  const u = (time - cues.riserStart) / (HUSH - cues.riserStart);
  if (u <= 0) return 1;
  if (u >= 1) return 0;
  let lo = 0, hi = Math.PI;
  for (let i = 0; i < 40; i++) {
    const eta = (lo + hi) / 2;
    if (eta + Math.sin(eta) < Math.PI * u) lo = eta;
    else hi = eta;
  }
  return (1 + Math.cos((lo + hi) / 2)) / 2;
}

const DUST_PATH = `
uniform float uFall0, uFall1, uAmbient, uFocus, uAperture, uHeat, uLamp;
uniform int uShells;
uniform float uShellR[${SHELLS}], uShellA[${SHELLS}];
void path(vec3 p, vec4 x, inout vec3 col, inout float size, out vec3 a, out vec3 b) {
  // The dust hangs almost still, until it falls: each mote is drawn as the path it travels
  // while the shutter is open.
  vec3 d = vec3(sin(uTime * (0.11 + 0.2 * x.x) + x.y * 40.0), sin(uTime * (0.13 + 0.2 * x.y) + x.z * 50.0), sin(uTime * (0.09 + 0.2 * x.z) + x.x * 30.0));
  vec3 q = p + d * 0.05;
  a = q * uFall0;
  b = q * uFall1;
  vec3 wp = 0.5 * (a + b);
  float r = length(wp);
  // Light shells: a sharp leading edge, and a faint afterglow behind it that the dust gives back.
  float lit = 0.0;
  for (int i = 0; i < ${SHELLS}; i++) {
    if (i >= uShells) break;
    float R = uShellR[i];
    float w = 0.02 + 0.03 * R;
    float s = (r - R) / w;
    float front = exp(-s * s);
    float tail = s < 0.0 ? 0.05 * exp(s * w / (0.2 + 0.25 * R)) : 0.0;
    lit += uShellA[i] * max(front, tail);
  }
  // A shell reads as a ring: it glints most where the line of sight grazes it.
  vec3 toCam = normalize(uCamPos - wp);
  float graze = 1.0 - pow(dot(toCam, wp / max(r, 1e-4)), 2.0);
  lit *= 0.3 + 0.7 * graze;
  // The point, once it is there, lights the dust around it as a lamp would.
  float lamp = uLamp / (r * r + 0.03);
  float tw = 0.65 + 0.35 * sin(uTime * (0.8 + 2.4 * x.w) + x.x * 60.0);
  vec3 cold = vec3(0.5, 0.6, 1.0), glint = mix(vec3(0.8, 0.88, 1.0), vec3(0.95, 0.9, 0.86), uHeat);
  col = col.r * (cold * uAmbient * tw + glint * lit + mix(vec3(0.9, 0.93, 1.0), vec3(1.0, 0.66, 0.3), uHeat) * lamp);
  // Depth of field: the lens is focused on the centre, and the blur circle grows away from it.
  float z = -(uView * vec4(wp, 1.0)).z;
  float coc = uAperture * abs(1.0 - z / uFocus);
  float s0 = size;
  size = sqrt(size * size + coc * coc);
  col *= (s0 * s0) / (size * size) * smoothstep(0.3, 0.9, z);
}`;

const PROLOGUE = `
#include <noise>
#include <color>
#include <camera>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime;
uniform float uPoint, uHaze, uHeat, uFall, uGlow;
uniform float uShellR[${SHELLS}], uShellA[${SHELLS}];
void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 col = vec3(0.0);
  // The thinnest haze among the dust, lit by the same shells: each one a soft ring, brightest
  // at its limb where the line of sight runs along it.
  float tc = max(dot(-uCamPos, rd), 0.0);
  vec3 near = uCamPos + rd * tc;
  float b = length(near);
  float wisp = 0.55 + 0.9 * fbm(near * 1.1 + vec3(0.0, uGTime * 0.01, 3.0), 4);
  float ring = 0.0;
  for (int i = 0; i < ${SHELLS}; i++) {
    float R = uShellR[i];
    float w = 0.02 + 0.03 * R;
    float inside = smoothstep(R + w, R - w, b);
    float chord = inversesqrt(max(1.0 - b * b / max(R * R, 1e-4), 0.0) + 2.0 * w / max(R, 1e-3));
    float q = (b - R) / (0.004 + 0.012 * R);
    ring += uShellA[i] * (0.3 * inside * w * chord + 0.08 * exp(-q * q));
  }
  vec3 tint = mix(vec3(0.3, 0.42, 0.95), vec3(1.0, 0.62, 0.3), uHeat);
  col += tint * ring * wisp * uHaze;
  // The collapsing field glows as it tightens.
  float gr = 0.02 + 1.6 * uFall;
  col += mix(vec3(0.5, 0.62, 1.0), vec3(1.0, 0.74, 0.45), uHeat) * uGlow * exp(-b * b / (gr * gr));
  // The point: a sub-pixel core and a tight halo.
  float px = 1.0 / uRes.y;
  float r = length(p - vec2(dot(-uCamPos, uCamRight), dot(-uCamPos, uCamUp)) / max(dot(-uCamPos, uCamFwd), 1e-3) / (2.0 * uTanHalfFov));
  float sig = 1.1 * px;
  col += vec3(1.0, 0.96, 0.9) * uPoint * (exp(-r * r / (2.0 * sig * sig)) + 0.012 * exp(-r / 0.012));
  fragColor = vec4(col, 1.0);
}`;

function prologue(): Shot<{ dust: Streaks; cam: Camera }> {
  return {
    ...span('prologue', { dIn: 0, dOut: 0 }),
    setup(e) {
      const r = rng(1);
      const n = 170000;
      const d = allocSprites(n);
      for (let i = 0; i < n; i++) {
        // A dense heart with a thinner cloud around and behind the camera.
        let p: [number, number, number];
        if (r.next() < 0.8) p = [r.gauss() * 2.05, r.gauss() * 2.05, r.gauss() * 2.05];
        else {
          const dir = r.onSphere(), rr = 7.5 * Math.cbrt(r.next());
          p = [dir[0] * rr, dir[1] * rr, dir[2] * rr];
        }
        d.position.set(p, i * 3);
        // A few bright motes, many faint ones.
        const b = 1.3 * (0.25 + 0.75 * r.next() + 6 * Math.pow(r.next(), 9));
        d.color.set([b, b, b], i * 3);
        d.size[i] = r.range(0.0012, 0.0024);
        d.extra!.set([r.next(), r.next(), r.next(), r.next()], i * 4);
      }
      return { dust: new Streaks(e, d, { path: DUST_PATH, minPixels: 0.7, maxPixels: 56 }), cam: new Camera({ fov: 40, near: 0.05 }) };
    },
    render(c, s) {
      const t = c.time;
      const held = t >= HUSH;
      const fall = collapseAt(t);
      // Half the time the shutter is open: the collapse is drawn as streaks, not sampled.
      const half = (0.5 * (c.e.project.shutter ?? 0.5)) / c.fps;
      const riser = prog(t, cues.riserStart, HUSH, 'linear');
      const { r, a } = shellsAt(t);
      // A slow push in, all the way through.
      const dist = keys(t, [[0, 6.2], [cues.riserStart, 5.3], [HUSH, 3.9, 'inQuad']]);
      s.cam.set({ pos: [0.5 * Math.sin(0.045 * t + 0.4), 0.16 * Math.cos(0.037 * t), dist], target: [0, 0, 0] });
      const heat = prog(t, cues.riserStart + 1.5, HUSH, 'inQuad');
      // The point shows itself as the last line leaves, then gathers everything.
      const appear = prog(t, 16.2, 17.6, 'inOutSine');
      const point = held ? 16 : appear * (0.9 + 5 * prog(t, 17, HUSH, 'inCubic'));
      c.fullscreen(c.e.program(PROLOGUE, 'prologue'), {
        ...s.cam.uniforms(),
        uPoint: point,
        uHaze: held ? 0 : 0.16,
        uHeat: heat,
        uFall: fall,
        uGlow: held ? 0 : 0.05 * riser * riser / (0.05 + fall),
        uShellR: r,
        uShellA: held ? a.map(() => 0) : a,
      });
      if (held) return;
      s.dust.draw(
        s.cam,
        t,
        {
          uFall0: collapseAt(t - half),
          uFall1: collapseAt(t + half),
          uShells: a.filter((v) => v > 0.002).length,
          uAmbient: 0.0032 * prog(t, 0, 1.5, 'inOutSine') * (1 + 0.5 * prog(t, 8, 12, 'inOutSine') + 0.5 * riser),
          uLamp: 0.02 * point,
          uFocus: dist,
          uAperture: 0.028,
          uHeat: heat,
          uShellR: r,
          uShellA: a,
        },
        // The field brightens as it tightens, but far less than its density climbs.
        { blend: 'add', brightness: 1.65 * Math.min(1, Math.pow(fall / 0.4, 1.15)) },
      );
    },
  };
}

// ------------------------------------------------------------------ the plasma: bang to first light
// One medium carries the four beats after the point lets go (film/shaders/universe-plasma.glsl):
// a flight through a volume of fire that starts impossibly fast and slows as the expansion does
// (the Big Bang, and the title), runs away again (inflation), drifts through the cooling fog
// while the first nuclei form in front of the lens (the first elements), and ends when the fog
// turns transparent and draws back to become the sky (first light). The four shots draw the same
// thing, so the dissolves between them cannot be seen.

const BANG = cues.bang;
const INFL = beat('inflation'), ELEM = beat('elements'), CMB = beat('cmb');
const CLEAR = cues.cmbClear;
const TITLE = T.titleCards[0];
/** The part of the sky first light breaks from (world direction; the flight is along +z). */
const FIRST_LIGHT: Vec3 = (() => {
  const d = [0.1, 0.1, 1], l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l] as Vec3;
})();

/** Speed of the flight through the plasma (units per second). */
function flightSpeed(time: number): number {
  const s = time - BANG;
  if (s < 0) return 0;
  const i0 = INFL.start - 0.8;
  if (time < i0) return 40 * Math.exp(-s / 0.35) + 3 * Math.exp(-s / 1.6) + 0.14;
  // Inflation: space runs away exponentially (a straight line in the logarithm), then eases
  // into the slow drift of the nuclear age.
  return Math.exp(keys(time, [
    [i0, Math.log(0.15)],
    [INFL.start + 0.3, Math.log(1.2), 'inSine'],
    [INFL.start + 2.4, Math.log(30)],
    [INFL.start + 3.3, Math.log(30)],
    [INFL.end - 0.6, Math.log(1.2), 'inOutSine'],
    [INFL.end + 0.6, Math.log(0.3), 'outSine'],
    [CMB.start, Math.log(0.22)],
    [CMB.end + 1, Math.log(0.15)],
  ]));
}

const FLIGHT = (() => {
  const dt = 1 / 480, n = Math.ceil((CMB.end + 1.5 - BANG) / dt) + 2;
  const tab = new Float64Array(n);
  for (let i = 1; i < n; i++) tab[i] = tab[i - 1] + 0.5 * (flightSpeed(BANG + (i - 1) * dt) + flightSpeed(BANG + i * dt)) * dt;
  return { dt, tab };
})();

/** Distance flown through the plasma by `time`. */
function flightTravel(time: number): number {
  const u = Math.max(0, (time - BANG) / FLIGHT.dt);
  const i = Math.min(Math.floor(u), FLIGHT.tab.length - 2);
  return FLIGHT.tab[i] + (FLIGHT.tab[i + 1] - FLIGHT.tab[i]) * (u - i);
}

/** Temperature (on the fire ramp), light and density of the plasma at `time`. */
function plasmaAt(time: number) {
  const s = Math.max(0, time - BANG);
  // The fireball cools on its own; from inflation on the temperature and the light are keyed.
  const i0 = INFL.start - 0.5;
  const coolHeat = (x: number) => 0.5 + 0.2 * Math.exp(-0.22 * x) + 0.4 * Math.exp(-2.6 * x);
  const coolPower = (x: number) => 0.85 + 0.45 * Math.exp(-0.3 * x) + 3 * Math.exp(-3 * x);
  const heat = time < i0 ? coolHeat(s) : keys(time, [
    [i0, coolHeat(i0 - BANG)],
    [INFL.start + 2.4, 0.6, 'inOutSine'],       // energy lifts as space runs away
    [INFL.start + 3.4, 0.59],
    [ELEM.start, 0.47, 'inOutSine'],            // and cools into the nuclear age
    [ELEM.start + 2, 0.43],
    [CMB.start, 0.43],
    [CLEAR - 0.4, 0.45],
    [CLEAR + 0.8, 0.62, 'inOutSine'],           // first light: the glow is suddenly everywhere
    [CLEAR + 2.4, 0.5, 'inOutSine'],
    [CLEAR + 4.2, 0.36],                        // and reddens as space stretches it
    [CMB.end + 0.6, 0.3],
  ]);
  const power = time < i0 ? coolPower(s) : keys(time, [
    [i0, coolPower(i0 - BANG)],
    [INFL.start + 2.4, 1.05, 'inOutSine'],
    [INFL.start + 3.4, 1.0],
    [ELEM.start, 0.62, 'inOutSine'],
    [ELEM.start + 2, 0.52],
    [CMB.start, 0.52],
    [CLEAR - 0.4, 0.62],
    [CLEAR + 0.8, 1.5, 'inOutSine'],
    [CLEAR + 2.4, 0.9, 'inOutSine'],
    [CLEAR + 4.2, 0.32],
    [CMB.end + 0.6, 0.015, 'outQuad'],
  ]);
  const clearing = prog(time, CLEAR - 0.3, CLEAR + 1.5, 'inOutSine');
  // First light comes from one part of the sky and spreads until it is the whole of it.
  const first = time > CMB.start;
  return {
    heat,
    power,
    // Behind the clouds a deeper amber; once they have gone, the sky itself.
    glowHeat: heat - 0.2 * (1 - Math.exp(-0.8 * s)) * (1 - 0.8 * clearing),
    glowDir: (first ? FIRST_LIGHT : [0, 0, 1]) as Vec3,
    ahead: first ? keys(time, [[CLEAR - 1.2, 0], [CLEAR + 0.5, 0.85, 'inOutSine'], [CLEAR + 3.2, 0, 'inOutSine']]) : Math.exp(-0.9 * s),
    aheadW: first ? keys(time, [[CLEAR - 1.2, 0.25], [CLEAR + 0.5, 0.6], [CLEAR + 3.2, 5, 'inQuad']]) : 0.08 + 0.05 * s,
    calm: prog(s, 0.8, 3.2, 'inOutSine') * (1 - prog(time, TITLE.end - 1, TITLE.end + 1, 'inOutSine')),
    // The fog thins to nothing: the universe turns transparent.
    dens: 1 - prog(time, CLEAR - 0.2, CLEAR + 2.6, 'inOutSine'),
    mottle: prog(time, CLEAR + 0.2, CLEAR + 3, 'inOutSine'),
    yaw: 0.24 * prog(time, CMB.start, CMB.end + 0.6, 'inOutSine'),
    roll: 0.25 + 0.012 * s,
  };
}

const PLASMA_RESOLVE = `
#include <color>
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uPlasma;
uniform vec2 uRes; uniform float uAspect, uCore, uCoreW;
void main() {
  vec2 p = centered(vUv, uAspect);
  // Four taps half a texel apart average the grain the march's jitter leaves.
  vec2 px = 0.5 / vec2(textureSize(uPlasma, 0));
  vec4 pl = 0.25 * (texture(uPlasma, vUv + px * vec2(1.0, 0.4)) + texture(uPlasma, vUv + px * vec2(-0.4, 1.0))
                  + texture(uPlasma, vUv + px * vec2(-1.0, -0.4)) + texture(uPlasma, vUv + px * vec2(0.4, -1.0)));
  vec3 col = pl.rgb;
  // The place it all came from, dead ahead: blinding in the first instant, and seen through
  // the gaps between the clouds (alpha is what the plasma lets through).
  col += vec3(1.0, 0.94, 0.82) * uCore * exp(-length(p) / uCoreW) * (0.2 + 0.8 * pl.a);
  fragColor = vec4(col, 1.0);
}`;

// Embers: sparks carried along with the plasma, streaking past the lens when space is fast.
const EMBER_LEN = 44;
const EMBER_PATH = `
uniform float uTravel0, uTravel1, uHeat;
void path(vec3 p, vec4 x, inout vec3 col, inout float size, out vec3 a, out vec3 b) {
  // A tube of embers around the flight path, wrapped so it never runs out.
  float z0 = mod(p.z - uTravel0, ${EMBER_LEN}.0);
  float z1 = z0 - (uTravel1 - uTravel0);
  float tw = 0.6 + 0.4 * sin(uTime * (3.0 + 5.0 * x.x) + x.y * 40.0);
  vec3 hot = mix(vec3(1.0, 0.42, 0.1), vec3(1.0, 0.86, 0.6), saturate(uHeat + 0.5 * x.z - 0.25));
  col = hot * col.r * tw * smoothstep(${EMBER_LEN}.0, ${EMBER_LEN}.0 * 0.55, z0) * smoothstep(0.5, 2.6, z1);
  // Out of the plane of focus they swell and dim.
  float coc = 0.035 * abs(1.0 - z0 / 7.0);
  float s0 = size;
  size = sqrt(size * size + coc * coc);
  col *= (s0 * s0) / (size * size);
  vec2 xy = p.xy + 0.1 * vec2(sin(uTime * 0.3 + x.z * 30.0), cos(uTime * 0.23 + x.w * 30.0));
  a = vec3(xy, z0);
  b = vec3(xy, z1);
}`;

// The first nuclei, close to the lens: protons (gold) and neutrons (pale blue), alone, in pairs,
// and, one after another through the beat, four of them falling together into helium with a
// flash. Only a thin slab is in focus; the rest are soft discs.
const NUCLEI_LEN = 30;
const NUCLEI_FOCUS = 4.5;
/** Helium forms between these times, a nucleus at a time. */
const FUSE: [number, number] = [ELEM.start + 0.6, ELEM.end + 0.5];
const HERO_FUSION = ELEM.start + 3.0;
const NUCLEI_ANIMATE = `
uniform float uTravel, uFocus, uAperture, uFade;
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  float z = mod(p.z - uTravel, ${NUCLEI_LEN}.0);
  // Thermal jitter.
  vec3 j = vec3(sin(uTime * (1.3 + x.x * 2.0) + x.y * 40.0), sin(uTime * (1.1 + x.y * 2.0) + x.z * 50.0), sin(uTime * (0.9 + x.z * 2.0) + x.x * 30.0));
  vec3 wp = vec3(p.xy, z) + j * 0.05;
  float coc = uAperture * abs(1.0 - wp.z / uFocus);
  float s0 = size;
  size = sqrt(size * size + coc * coc);
  float fade = smoothstep(${NUCLEI_LEN}.0, ${NUCLEI_LEN}.0 * 0.6, z) * smoothstep(0.4, 1.4, z) * uFade;
  // To the fragment shader: brightness, and how sharp the nucleus is (its own size over its
  // blurred size).
  col = vec3(col.r * fade, s0 / size, 0.0);
  return wp;
}`;

const NUCLEI_SHADE = `
uniform float uFuse0, uFuse1;
const float RHO = 0.62;                       // a nucleon's radius, in units of the sprite's own sigma
const vec3 PROTON = vec3(1.0, 0.6, 0.24), NEUTRON = vec3(0.6, 0.78, 1.0);
// One nucleon at offset o: in focus a glowing ball (brighter towards its centre, a thin bright
// limb, a small highlight, a halo around it); out of focus a Gaussian of the same light.
vec3 nucleon(vec2 q0, vec2 o, float c2, vec3 tint, float aa) {
  vec2 dq = q0 - o;
  float d2 = dot(dq, dq), d = sqrt(d2);
  float z = sqrt(max(1.0 - d2 / (RHO * RHO), 0.0));
  float inside = smoothstep(RHO, RHO - aa, d);
  float ball = inside * (0.3 + 0.75 * z * z + 0.5 * pow(1.0 - z, 3.0));
  vec2 hl = dq - RHO * vec2(-0.32, 0.36);
  float spec = inside * exp(-dot(hl, hl) / (RHO * RHO * 0.035));
  float halo = 0.28 * exp(-max(d - RHO, 0.0) / (RHO * 0.45));
  float s2 = RHO * RHO * 0.3;
  float blur = s2 / (s2 + c2) * 1.25 * exp(-0.5 * d2 / (s2 + c2));
  float k = smoothstep(0.03, 0.6, c2);
  return mix(tint * (ball + halo) + vec3(1.0, 0.97, 0.9) * spec * 0.9, tint * blur, k);
}
vec4 shade(vec2 q, vec3 col, vec4 x) {
  float bright = col.r, sharp = clamp(col.g, 0.02, 1.0);
  vec2 q0 = q / sharp;
  float c2 = 1.0 / (sharp * sharp) - 1.0;
  float kind = x.w;
  float aa = 1.5 * fwidth(q0.x);
  float spin = x.y * 40.0 + uTime * (0.5 + x.z);
  vec2 u = vec2(cos(spin), sin(spin)), v = vec2(-u.y, u.x);
  vec3 c = vec3(0.0);
  float count = kind < 0.6 ? 1.0 : kind < 0.74 ? 2.0 : 4.0;
  vec3 mean = kind < 0.6 ? PROTON : 0.5 * (PROTON + NEUTRON);
  // (Far out of focus only the disc below is drawn: most of the pixels these sprites cover.)
  if (sharp < 0.14) {
  } else if (kind < 0.6) {
    c = nucleon(q0, vec2(0.0), c2, PROTON, aa);
  } else if (kind < 0.74) {
    // Deuterium: a proton and a neutron.
    c = nucleon(q0, u * RHO * 0.9, c2, PROTON, aa) + nucleon(q0, -u * RHO * 0.9, c2, NEUTRON, aa);
  } else {
    // Helium: two of each, falling together at their moment in the beat.
    float tf = mix(uFuse0, uFuse1, x.x);
    float into = smoothstep(tf - 1.5, tf, uTime);
    float a = RHO * mix(2.3 + 0.25 * sin(uTime * 1.3 + x.z * 20.0), 1.02, into * into);
    c = nucleon(q0, u * a, c2, PROTON, aa) + nucleon(q0, -u * a, c2, PROTON, aa)
      + nucleon(q0, v * a, c2, NEUTRON, aa) + nucleon(q0, -v * a, c2, NEUTRON, aa);
    // The flash of binding energy, and its ring.
    float since = uTime - tf;
    if (since > 0.0) {
      float d = length(q0);
      float s2 = 0.5 + c2;
      // (The ring fades before it reaches the edge of the sprite's quad.)
      c += vec3(1.0, 0.95, 0.85) * (9.0 * exp(-since * 4.5) * exp(-0.5 * d * d / s2) * 0.5 / s2
         + 1.2 * exp(-since * 3.0) * exp(-pow((d - (0.8 + 2.6 * since)) / (0.1 + 0.5 * sqrt(c2)), 2.0)) * smoothstep(2.7, 1.9, length(q)));
    }
  }
  // Far out of focus: the tall oval disc of an anamorphic lens, with all of the nucleus's light.
  float d = length(q / vec2(1.6, 2.55));
  float rpx = 1.0 / max(fwidth(q.x), 1e-5);
  float disc = smoothstep(1.0, 1.0 - 2.0 / rpx, d) * (0.85 + 0.25 * smoothstep(0.5, 1.0, d));
  vec3 bokeh = mean * count * disc * 0.4 * (RHO * RHO * 0.3) * sharp * sharp;
  vec3 outc = bright * mix(c, bokeh, smoothstep(0.3, 0.14, sharp));
  return vec4(outc, 0.0);
}`;

interface Medium {
  target: RenderTarget;
  noise: Texture;
  embers: Streaks;
  nuclei: Sprites;
  cam: Camera;
}

const MEDIA = new WeakMap<Engine, Medium>();

/** The plasma's resources, shared by the four shots that draw it. */
function medium(e: Engine): Medium {
  let m = MEDIA.get(e);
  if (m) return m;
  const r = rng(20);
  const ne = 2200;
  const embers = allocSprites(ne);
  for (let i = 0; i < ne; i++) {
    const a = r.next() * Math.PI * 2, rr = 0.3 + 7 * Math.sqrt(r.next());
    embers.position.set([rr * Math.cos(a), rr * Math.sin(a), r.next() * EMBER_LEN], i * 3);
    const b = 0.6 + 1.8 * r.next() + 16 * Math.pow(r.next(), 6);
    embers.color.set([b, b, b], i * 3);
    embers.size[i] = r.range(0.004, 0.009);
    embers.extra!.set([r.next(), r.next(), r.next(), r.next()], i * 4);
  }
  const nn = 1350;
  const nuclei = allocSprites(nn);
  for (let i = 0; i < nn; i++) {
    const a = r.next() * Math.PI * 2, rr = 0.4 + 6.5 * Math.sqrt(r.next());
    nuclei.position.set([rr * Math.cos(a), rr * Math.sin(a), r.next() * NUCLEI_LEN], i * 3);
    nuclei.color.set([r.range(0.4, 0.8), 0, 0], i * 3);
    nuclei.size[i] = r.range(0.1, 0.15);
    nuclei.extra!.set([r.next(), r.next(), r.next(), r.next()], i * 4);
  }
  // One helium nucleus forms in the plane of focus, left of centre, in the middle of the beat.
  const [f0, f1] = FUSE;
  nuclei.position.set([1.35, 0.42, (flightTravel(HERO_FUSION) + NUCLEI_FOCUS + 0.1) % NUCLEI_LEN], 0);
  nuclei.color.set([0.85, 0, 0], 0);
  nuclei.size[0] = 0.15;
  nuclei.extra!.set([(HERO_FUSION - f0) / (f1 - f0), 0.3, 0.55, 0.9], 0);
  m = {
    target: scratch(e, 0.75),
    noise: noiseVolume(e.gl, { size: 64, seed: 20 }),
    embers: new Streaks(e, embers, { path: EMBER_PATH, minPixels: 0.8, maxPixels: 48 }),
    nuclei: new Sprites(e, nuclei, { animate: NUCLEI_ANIMATE, shade: NUCLEI_SHADE, minPixels: 0.8, maxPixels: 64 }),
    // The lens of the ray march: rays through (x, y, 1), looking down +z.
    cam: new Camera({ pos: [0, 0, 0], target: [0, 0, 1], fov: (2 * Math.atan(0.5) * 180) / Math.PI, near: 0.05 }),
  };
  MEDIA.set(e, m);
  return m;
}

/** Motion-blur samples the plasma asks for: the first second and inflation are all speed. */
const plasmaBlur = (time: number) =>
  time < BANG + 1.2 ? 8 : time < BANG + 3 ? 4 : time < INFL.start ? 3 : time < INFL.end ? 4 : 2;

function drawPlasma(c: ShotContext, m: Medium) {
  const time = c.time, s = Math.max(0, time - BANG);
  const P = plasmaAt(time);
  const travel = flightTravel(time), speed = flightSpeed(time);
  m.target.bind();
  c.fullscreen(c.e.program('#include <arrow-of-time/universe-plasma>', 'plasma'), {
    uNoise: m.noise,
    uTravel: travel,
    uSpeed: speed,
    uSeed: (time * 977) % 13,
    uHeat: P.heat,
    uPower: P.power,
    uGlowHeat: P.glowHeat,
    uGlowDir: P.glowDir,
    uAhead: P.ahead,
    uAheadW: P.aheadW,
    uCalm: P.calm,
    uDens: P.dens,
    uMottle: P.mottle,
    uYaw: P.yaw,
    uRoll: P.roll,
  });
  c.target.bind();
  c.fullscreen(c.e.program(PLASMA_RESOLVE, 'plasma.resolve'), { uPlasma: m.target, uCore: 90 * Math.exp(-4.5 * s), uCoreW: 0.014 + 0.03 * s });

  // The camera pans with the ray march.
  m.cam.set({ target: [Math.sin(P.yaw), 0, Math.cos(P.yaw)] });
  // Embers, each drawn as the path it travels while this sample's shutter is open.
  const embers = (0.55 + 2.5 * Math.exp(-1.2 * s) + 0.5 * Math.sqrt(speed) * prog(time, INFL.start - 0.5, INFL.start + 1, 'linear')) * (1 - prog(time, ELEM.start - 0.5, ELEM.start + 1.5, 'inOutSine'));
  if (embers > 0.001) {
    const samples = c.e.opts.noMotionBlur ? 1 : plasmaBlur(time);
    const half = (0.5 * (c.e.project.shutter ?? 0.5)) / c.fps / samples;
    m.embers.draw(m.cam, time, { uTravel0: flightTravel(time - half), uTravel1: flightTravel(time + half), uHeat: 0.35 + 0.65 * Math.exp(-0.5 * s) }, { blend: 'add', brightness: embers });
  }
  // The first nuclei.
  const nuclei = prog(time, ELEM.start - 0.8, ELEM.start + 0.8, 'inOutSine') * (1 - prog(time, CMB.start - 0.3, CLEAR - 0.2, 'inOutSine'));
  if (nuclei > 0.001) {
    m.nuclei.draw(m.cam, time, { uTravel: travel, uFocus: NUCLEI_FOCUS, uAperture: 0.45, uFade: nuclei, uFuse0: FUSE[0], uFuse1: FUSE[1] }, { blend: 'add', brightness: 1 });
  }
}

function bigBang(): Shot<Medium> {
  return { ...span('bigbang', { dIn: 0, dOut: 1.2 }), motionBlur: plasmaBlur, setup: medium, render: drawPlasma };
}

function inflation(): Shot<Medium> {
  return { ...span('inflation', { dIn: 1.2, dOut: 1.0 }), motionBlur: plasmaBlur, setup: medium, render: drawPlasma };
}

function elements(): Shot<Medium> {
  return { ...span('elements', { dIn: 1.0, dOut: 1.0 }), motionBlur: plasmaBlur, setup: medium, render: drawPlasma };
}

function firstLight(): Shot<Medium> {
  return { ...span('cmb', { dIn: 1.0, dOut: 1.2 }), motionBlur: plasmaBlur, setup: medium, render: drawPlasma };
}

export function universeShots(): Shot[] {
  return [prologue(), bigBang(), inflation(), elements(), firstLight()];
}

/**
 * Look overrides for this file's beats (bloom, streak, exposure, grade...), merged last in
 * project.ts. Return {} outside them so other shots keep the film's look.
 */
export function universeLook(time: number): Partial<Look> {
  // The collapsing field is a glowing ball, and a ball streaks into a bar: take the anamorphic
  // streak away while it shrinks, and give it back to the point that is left.
  if (time > HUSH - 1.6 && time < HUSH) return { streak: 0.35 * (1 - prog(time, HUSH - 1.6, HUSH - 0.9, 'inOutSine')) };
  // The main title sits on the fire: a soft scrim under it, as the chapter cards have.
  const title = T.titleCards[0];
  if (time > title.start && time < title.end) {
    const on = prog(time, title.start, title.start + 2.4, 'inOutSine') * (1 - prog(time, title.end - 1.6, title.end, 'inOutSine'));
    return { scrim: 0.55 * on, scrimCenter: [0.5, 0.54], scrimRadius: [0.62, 0.3] };
  }
  return {};
}
