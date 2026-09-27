// The march of civilization, 10,000 BCE to 1957, as one continuous shot through a single day:
// dawn over the first fields, morning in Uruk, noon at Giza, the afternoon sun on the Aegean,
// sunset over Mainz, dusk at the mills, the last light at Kitty Hawk, night in the desert at
// Trinity and at the launch pad. Each age is a painted tableau (shaders/civ-<id>.glsl) with its
// own parallax layers, in the manner of the film's life scenes. The camera drifts right through
// each one, a little faster each time as the clock accelerates, and sweeps on to the next behind
// something passing close to the lens (shaders/civ-wipe.glsl) just before its card. The atom
// arrives as a flash.
import '@fontsource/unifrakturmaguntia/400.css';
import { keys, registerChunks, textureFromSource, type Engine, type Look, type Shot, type UniformValue, type Vec2, type Vec3 } from '@engine';
import { beat, cues } from '../lib';

registerChunks(import.meta.glob('../shaders/*.glsl', { query: '?raw', import: 'default', eager: true }) as Record<string, string>, 'arrow-of-time/');

type Card = { t: number; year: number; era: string; title: string };
const CARDS = (beat('civilization') as ReturnType<typeof beat> & { montage: Card[] }).montage;

/** Wipe objects (civ-wipe.glsl uKind). */
const WIPE = { palm: 0, wall: 1, blocks: 2, column: 3, pier: 4, chimney: 5, pole: 6, mast: 7 } as const;

interface Tableau {
  /** Shader chunk shaders/civ-<id>.glsl. */
  id: string;
  /** The sun in the picture and its elevation in degrees, t seconds after the card. */
  sun: (t: number) => { pos: Vec2; elev: number };
  /** Mid-ground drift, picture heights per second. */
  drift: number;
  /** What sweeps past the lens to bring this tableau in ('flash' for a cut on a flash). */
  wipe?: number | 'flash';
  /** Light shafts from the sun: amount and threshold (luminance). */
  rays?: [number, number];
  uniforms?: (t: number) => Record<string, UniformValue>;
  setup?: (e: Engine) => Promise<Record<string, UniformValue>>;
  /** Vertical camera (mid-ground units), t seconds after the card: a tilt up. */
  camY?: (t: number) => number;
}

/**
 * A page of a Bible fresh off the press, in Gutenberg's layout: two columns of blackletter (the
 * Vulgate's opening verses), a red initial and a red rubric. Black ink has low red, red ink high
 * red and low green, paper is white.
 */
async function bibleLeaf(e: Engine) {
  const font = '"UnifrakturMaguntia"';
  await document.fonts.load(`40px ${font}`);
  const W = 512, H = 724;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  const text =
    'n principio creavit deus celum et terram. Terra autem erat inanis et vacua: et tenebre erant super faciem abyssi: et spiritus domini ferebatur super aquas. Dixitque deus. Fiat lux. Et facta est lux. Et vidit deus lucem quod esset bona: et divisit lucem a tenebris. appellavitque lucem diem: et tenebras noctem. Factumque est vespere et mane dies unus. Dixit quoque deus. Fiat firmamentum in medio aquarum: et dividat aquas ab aquis.';
  const words = text.split(' ');
  const lines = 30, lineH = (H - 110) / lines, colW = (W - 130) / 2;
  g.font = `${lineH * 0.82}px ${font}`;
  let wi = 0;
  for (let col = 0; col < 2; col++) {
    const x0 = 55 + col * (colW + 20);
    for (let l = 0; l < lines; l++) {
      const indent = col === 0 && l < 6 ? 60 : 0;
      let line = '';
      while (g.measureText(line + words[wi % words.length] + ' ').width < colW - indent) line += words[wi++ % words.length] + ' ';
      g.fillStyle = col === 0 && l === 0 ? '#f00' : '#000';
      g.fillText(line.trim(), x0 + indent, 60 + (l + 0.8) * lineH);
    }
  }
  g.fillStyle = '#f00';
  g.font = `${lineH * 6.2}px ${font}`;
  g.fillText('I', 60, 60 + 5.6 * lineH);
  return { uPage: textureFromSource(e.gl, c, { filter: 'mipmap' }) };
}

/** How far the rocket has risen (mid-ground picture units): liftoff 1.3 s after ignition. */
export const liftOf = (time: number) => {
  const s = time - cues.launch - 1.3;
  return s > 0 ? 0.2 * s * s + 0.04 * s : 0;
};

const TABLEAUX: Tableau[] = [
  // 10,000 BCE: wild wheat at sunrise in the hills of the Fertile Crescent.
  { id: 'farming', drift: 0.035, rays: [0.55, 1.2], sun: (t) => ({ pos: [-0.12, -0.066 + 0.005 * t], elev: 0.3 + 0.5 * t }) },
  // 4000 BCE: Uruk in the morning, the White Temple on its terrace above the city.
  { id: 'uruk', drift: 0.04, wipe: WIPE.palm, rays: [0.3, 1.4], sun: (t) => ({ pos: [-0.62, 0.1 + 0.004 * t], elev: 5 + 0.5 * t }) },
  // 3200 BCE: a scribe writing on a clay tablet, the city behind.
  { id: 'writing', drift: 0.045, wipe: WIPE.wall, sun: () => ({ pos: [-1.25, 0.45], elev: 13 }) },
  // 2500 BCE: Giza at noon, the pyramids in their white casing; a gang hauls a block.
  { id: 'giza', drift: 0.05, wipe: WIPE.blocks, sun: () => ({ pos: [0.62, 0.62], elev: 50 }) },
  // 500 BCE: a temple on the Acropolis above the Aegean in the afternoon sun; philosophers talking.
  { id: 'athens', drift: 0.05, wipe: WIPE.column, rays: [0.25, 1.8], sun: (t) => ({ pos: [0.6, 0.045 - 0.005 * t], elev: 2.6 - 0.3 * t }) },
  // 1450: Mainz at sunset, printed pages streaming from Gutenberg's window over the town.
  {
    id: 'mainz', drift: 0.055, wipe: WIPE.pier, rays: [0.22, 2.0], setup: bibleLeaf,
    sun: (t) => ({ pos: [0.16, -0.045 - 0.006 * t], elev: 0.9 - 0.35 * t }),
  },
  // 1830: dusk over a mill town; a train crosses the viaduct.
  { id: 'mill', drift: 0.06, wipe: WIPE.chimney, sun: () => ({ pos: [0.55, -0.2], elev: -3.5 }) },
  // 1903: the Wright Flyer over the dunes at Kill Devil Hills, in the last of the light.
  { id: 'kittyhawk', drift: 0.07, wipe: WIPE.pole, sun: () => ({ pos: [0.45, -0.3], elev: -5.2 }) },
  // 1945: Trinity, before dawn in the New Mexico desert.
  { id: 'trinity', drift: 0.04, wipe: 'flash', sun: () => ({ pos: [0.0, -1.0], elev: -17 }) },
  // 1957: the R-7 at night at Baikonur, lifting off with Sputnik (cue launch).
  {
    id: 'baikonur', drift: 0.03, wipe: WIPE.mast, sun: () => ({ pos: [1.2, -0.9], elev: -16 }),
    uniforms: (t) => {
      const time = CARDS[9].t + t;
      return { uIgnite: time - cues.launch, uLift: liftOf(time) };
    },
    // The camera tilts up after the rocket as it climbs.
    camY: (t) => 0.75 * liftOf(CARDS[9].t + t),
  },
];

const N = TABLEAUX.length;
/** How far the foreground moves compared with the mid-ground (the wipe objects' layer). */
const K_FG = 5;
/** The whip: the wipe object crosses from beyond the right edge to beyond the left. */
const X0 = 1.35;
const A = (2 * X0) / K_FG;

const smoother = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** The wipe that brings tableau k in (k >= 1): [start, duration] of its crossing. */
function wipeWindow(k: number): [number, number] {
  const w = TABLEAUX[k].wipe === 'flash' ? 0.0001 : keys(k, [[1, 0.8], [9, 0.55]]);
  const seam = CARDS[k].t - (TABLEAUX[k].wipe === 'flash' ? 0.04 : 0.15);
  return [seam - w / 2, w];
}

/** The tableau's camera (mid-ground units) at film time. */
function camX(k: number, time: number): number {
  const T = TABLEAUX[k];
  let x = T.drift * (time - CARDS[k].t);
  if (k > 0 && T.wipe !== 'flash') {
    const [a, w] = wipeWindow(k);
    x -= A * (1 - smoother((time - a) / w));
  }
  if (k + 1 < N && TABLEAUX[k + 1].wipe !== 'flash') {
    const [a, w] = wipeWindow(k + 1);
    x += A * smoother((time - a) / w);
  }
  return x;
}

/** Which tableaux are on screen: [k, clip lo, clip hi], and the wipe object if one is passing. */
function onScreen(time: number): { parts: [number, number, number][]; wipe?: { kind: number; x: number; k: number } } {
  for (let k = 1; k < N; k++) {
    const [a, w] = wipeWindow(k);
    if (time < a) return { parts: [[k - 1, -9, 9]] };
    if (time < a + w) {
      const x = X0 - 2 * X0 * smoother((time - a) / w);
      const kind = TABLEAUX[k].wipe as number;
      return { parts: [[k - 1, -9, x], [k, x, 9]], wipe: { kind, x, k } };
    }
  }
  return { parts: [[N - 1, -9, 9]] };
}

/** True while a wipe is sweeping past (the shot then renders more motion-blur samples). */
function whipping(time: number) {
  for (let k = 1; k < N; k++) {
    if (TABLEAUX[k].wipe === 'flash') continue;
    const [a, w] = wipeWindow(k);
    if (time > a - 0.05 && time < a + w + 0.05) return true;
  }
  return false;
}

const START = beat('civilization').start - 0.4;

/** Picture position (centred units) -> 0..1 frame coordinates. */
const toUv = (p: Vec2): Vec2 => [p[0] / (16 / 9) + 0.5, p[1] + 0.5];

/** The post look the tableaux ask for: light shafts from their sun. */
export function civilizationLook(time: number): Partial<Look> {
  if (time < START || time >= cues.sputnik) return {};
  const { parts, wipe } = onScreen(time);
  // During a wipe, the incoming tableau's shafts fade in as it takes over the frame.
  const [k0] = parts[0];
  const k = parts.length > 1 ? parts[1][0] : k0;
  const f = wipe ? smoother((X0 - wipe.x) / (2 * X0)) : 1;
  const amt = (TABLEAUX[k].rays?.[0] ?? 0) * f + (k !== k0 ? (TABLEAUX[k0].rays?.[0] ?? 0) * (1 - f) : 0);
  if (amt <= 0) return {};
  // The shafts come from whichever sun fills most of the frame.
  const src = f > 0.5 ? k : k0;
  const sun = TABLEAUX[src].sun(time - CARDS[src].t);
  return { rays: amt, raysCenter: toUv(sun.pos), raysThreshold: TABLEAUX[src].rays?.[1] ?? 1.2, raysDecay: 0.975, raysTint: [1.0, 0.85, 0.65] as Vec3 };
}

export function civilization(): Shot<{ fixed: Record<string, UniformValue>[] }> {
  return {
    id: 'civilization',
    start: START,
    end: cues.sputnik,
    fadeIn: 0.8,
    fadeOut: 0,
    motionBlur: (time) => (whipping(time) ? 6 : time > cues.launch + 1.2 ? 3 : 1),
    async setup(e) {
      const fixed: Record<string, UniformValue>[] = [];
      for (const T of TABLEAUX) fixed.push((await T.setup?.(e)) ?? {});
      return { fixed };
    },
    render(c, s) {
      const { parts, wipe } = onScreen(c.time);
      for (const [k, lo, hi] of parts) {
        const T = TABLEAUX[k];
        const t = c.time - CARDS[k].t;
        const sun = T.sun(t);
        c.fullscreen(c.e.program(`#include <arrow-of-time/civ-${T.id}>`, `civ-${T.id}`), {
          ...s.fixed[k],
          uT: t,
          uCam: [camX(k, c.time), T.camY?.(t) ?? 0],
          uSun: sun.pos,
          uElev: sun.elev,
          uClip: [lo, hi],
          ...(T.uniforms?.(t) ?? {}),
        });
      }
      if (wipe) {
        const T = TABLEAUX[wipe.k];
        const sun = T.sun(c.time - CARDS[wipe.k].t);
        c.gl.enable(c.gl.BLEND);
        c.gl.blendFunc(c.gl.ONE, c.gl.ONE_MINUS_SRC_ALPHA);
        c.fullscreen(c.e.program('#include <arrow-of-time/civ-wipe>', 'civ-wipe'), {
          uX: wipe.x, uKind: wipe.kind, uSun: sun.pos, uElev: sun.elev, uBlur: 9,
        });
        c.gl.disable(c.gl.BLEND);
      }
    },
  };
}
