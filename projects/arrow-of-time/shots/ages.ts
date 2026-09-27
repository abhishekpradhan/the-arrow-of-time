// The march of civilization: one short scene per age, cut on the music's accents (the montage
// cards in timeline.json), from the first harvest to the launch that leads to the Moon. Each
// scene is a ray-marched set (shaders/age-*.glsl) with its own light and camera move.
import '@fontsource/unifrakturmaguntia/400.css';
import { Camera, keys, registerChunks, textureFromSource, type CameraOptions, type Engine, type Shot, type ShotContext, type UniformValue, type Vec3 } from '@engine';
import { beat, cues } from '../lib';

registerChunks(import.meta.glob('../shaders/*.glsl', { query: '?raw', import: 'default', eager: true }) as Record<string, string>, 'arrow-of-time/');

type Card = { t: number; year: number; era: string; title: string };
const CARDS = (beat('civilization') as ReturnType<typeof beat> & { montage: Card[] }).montage;

/** Scenes cut half a frame before their card, so no motion-blur sample straddles two scenes. */
const cut = (t: number) => t - 0.02;

interface Age {
  /** Shader chunk: shaders/age-<id>.glsl. */
  id: string;
  /** Camera at `t` seconds into the scene, `dur` long. */
  cam: (t: number, dur: number) => CameraOptions;
  uniforms?: (t: number, c: ShotContext) => Record<string, UniformValue>;
  /** Uniforms made once, before the first frame (textures). */
  setup?: (e: Engine) => Promise<Record<string, UniformValue>>;
  /** Motion-blur samples (they also anti-alias). */
  mb?: number;
}

function scene(a: Age, start: number, end: number, fadeIn = 0, fadeOut = 0): Shot<{ cam: Camera; fixed: Record<string, UniformValue> }> {
  return {
    id: `age-${a.id}`,
    start,
    end,
    fadeIn,
    fadeOut,
    motionBlur: a.mb ?? 2,
    setup: async (e) => ({ cam: new Camera({ fov: 35, near: 0.05, far: 20000 }), fixed: (await a.setup?.(e)) ?? {} }),
    render(c, s) {
      const t = c.time - start;
      s.cam.set(a.cam(t, end - start));
      c.fullscreen(c.e.program(`#include <arrow-of-time/age-${a.id}>`, `age-${a.id}`), {
        ...s.cam.uniforms(),
        ...s.fixed,
        uT: t,
        ...(a.uniforms?.(t, c) ?? {}),
      });
    },
  };
}

const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
/** A move from one camera to another over the scene, eased at both ends. */
const move = (p0: Vec3, p1: Vec3, t0: Vec3, t1: Vec3, fov: number) => (t: number, dur: number): CameraOptions => {
  const u = keys(t, [[0, 0], [dur, 1, 'inOutSine']]);
  return { pos: lerp3(p0, p1, u), target: lerp3(t0, t1, u), fov };
};

// ------------------------------------------------------------------ the ages
const GIZA: Age = {
  id: 'giza',
  cam: move([-760, 43, 1690], [-640, 45, 1720], [-330, 62, 380], [-270, 60, 380], 16),
};

const FARMING: Age = {
  id: 'farming',
  cam: move([0, 1.2, 0.6], [0.35, 1.12, -1.9], [1.4, 1.15, -20], [1.9, 1.05, -20], 38),
};

const URUK: Age = {
  id: 'uruk',
  cam: move([14, 34, 0], [8, 24, -48], [0, 13, -150], [0, 16, -150], 38),
};

/** The stylus moves along the line as the scribe writes. */
const pen = (t: number) => -2.6 + 1.05 * t;
const CUNEIFORM: Age = {
  id: 'cuneiform',
  cam: (t) => ({ pos: [pen(t) - 1.6, 7.6, 7.4], target: [pen(t) + 0.6, 1.6, 0.4], fov: 34 }),
  uniforms: (t) => ({ uPen: pen(t) }),
};

const COLONNADE: Age = {
  id: 'colonnade',
  cam: move([-1.2, 3.35, -4.3], [2.3, 3.35, -4.1], [30, 4.4, 2.8], [33, 4.4, 3.4], 44),
};

/**
 * A page of a Bible fresh off the press, in Gutenberg's layout: two columns of blackletter (the
 * Vulgate's opening verses), a red initial and a red rubric. Black ink has low red, red ink high
 * red and low green, paper is white.
 */
async function bibleLeaf(e: Engine) {
  const font = '"UnifrakturMaguntia"';
  await document.fonts.load(`40px ${font}`);
  const W = 1024, H = 1448;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  const text =
    'n principio creavit deus celum et terram. Terra autem erat inanis et vacua: et tenebre erant super faciem abyssi: et spiritus domini ferebatur super aquas. Dixitque deus. Fiat lux. Et facta est lux. Et vidit deus lucem quod esset bona: et divisit lucem a tenebris. appellavitque lucem diem: et tenebras noctem. Factumque est vespere et mane dies unus. Dixit quoque deus. Fiat firmamentum in medio aquarum: et dividat aquas ab aquis. Et fecit deus firmamentum: divisitque aquas que erant sub firmamento ab hiis que erant super firmamentum: et factum est ita. Vocavitque deus firmamentum celum: et factum est vespere et mane dies secundus. Dixit vero deus. Congregentur aque que sub celo sunt in locum unum et appareat arida. Et factum est ita. Et vocavit deus aridam terram: congregationesque aquarum appellavit maria. Et vidit deus quod esset bonum: et ait. Germinet terra herbam virentem et facientem semen: et lignum pomiferum faciens fructum iuxta genus suum: cuius semen in semetipso sit super terram. Et factum est ita.';
  const words = text.split(' ');
  const lines = 42, lineH = (H - 220) / lines, colW = (W - 260) / 2;
  g.font = `${lineH * 0.82}px ${font}`;
  g.textBaseline = 'alphabetic';
  let wi = 0;
  for (let col = 0; col < 2; col++) {
    const x0 = 110 + col * (colW + 40);
    for (let l = 0; l < lines; l++) {
      // The initial takes the first eight lines of the first column.
      const indent = col === 0 && l < 8 ? 120 : 0;
      let line = '';
      while (g.measureText(line + words[wi % words.length] + ' ').width < colW - indent) line += words[wi++ % words.length] + ' ';
      g.fillStyle = col === 0 && l === 0 ? '#f00' : '#000';
      g.fillText(line.trim(), x0 + indent, 120 + (l + 0.8) * lineH);
    }
  }
  g.fillStyle = '#f00';
  g.font = `${lineH * 8.4}px ${font}`;
  g.fillText('I', 118, 120 + 7.6 * lineH);
  return { uPage: textureFromSource(e.gl, c, { filter: 'mipmap' }) };
}

const PRESS: Age = {
  id: 'press',
  cam: move([1.7, 1.5, 2.3], [1.25, 1.45, 1.55], [-0.75, 1.5, -1.5], [-0.8, 1.45, -1.5], 50),
  setup: bibleLeaf,
};

/** The train runs right to left across the viaduct. */
const trainX = (t: number) => 34 - 13 * t;
const INDUSTRY: Age = {
  id: 'industry',
  cam: (t) => ({ pos: [-4 - 1.5 * t, 7, -12], target: [trainX(t) + 9, 22, -55], fov: 36 }),
  uniforms: (t) => ({ uTrainX: trainX(t) }),
};

/** The Flyer skims the sand, bobbing as Orville fights the elevator. */
const flyerAt = (t: number): Vec3 => [-10 + 7 * t, 4.0 + 0.35 * Math.sin(t * 2.2), 0];
const FLIGHT: Age = {
  id: 'flight',
  // A pass-by: the camera stands by the flight path and pans as the Flyer goes past.
  cam: (t) => {
    const f = flyerAt(t);
    return { pos: [-3 + 1.2 * t, 2.0, 17], target: [f[0] + 1.0, f[1] + 2.4, 0], fov: 42 };
  },
  uniforms: (t) => ({ uFlyer: flyerAt(t), uPitch: 0.05 * Math.sin(t * 2.2 + 0.8) }),
};

/** Trinity: real time runs about five times faster than the film's. */
const TRINITY: Age = {
  id: 'trinity',
  cam: (t) => ({ pos: [0, 4, 9000 - 30 * t], target: [0, 330 + 160 * t, 0], fov: 14 }),
  uniforms: (t) => ({ uAge: (t - 0.04) * 5 }),
};

/** Liftoff 1.6 s after ignition, then an acceleration compressed about threefold. */
const liftOf = (time: number) => {
  const s = time - cues.launch - 1.3;
  return s > 0 ? 38 * s * s : 0;
};
const LAUNCH: Age = {
  id: 'launch',
  cam: (t) => {
    const time = t + LAUNCH_START;
    const lift = liftOf(time);
    return { pos: [-45 + 2 * t, 4, 270 - 5 * t], target: [0, 62 + lift * 0.95, 0], fov: 36 };
  },
  uniforms: (t) => ({ uIgnite: t + LAUNCH_START - cues.launch, uLift: liftOf(t + LAUNCH_START) }),
};
let LAUNCH_START = 0;

export function ages(): Shot[] {
  const list: Age[] = [FARMING, URUK, CUNEIFORM, GIZA, COLONNADE, PRESS, INDUSTRY, FLIGHT, TRINITY, LAUNCH];
  const b = beat('civilization');
  return list.map((a, i) => {
    const start = i === 0 ? b.start - 0.4 : cut(CARDS[i].t);
    if (a === LAUNCH) LAUNCH_START = start;
    const end = i + 1 < list.length ? cut(CARDS[i + 1].t) : b.end + 0.5;
    return scene(a, start, end, i === 0 ? 0.8 : 0, i + 1 < list.length ? 0 : 1.0);
  });
}
