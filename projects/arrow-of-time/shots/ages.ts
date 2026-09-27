// The march of civilization: one short scene per age, cut on the music's accents (the montage
// cards in timeline.json), from the first harvest to the launch that leads to the Moon. Each
// scene is a ray-marched set (shaders/age-*.glsl) with its own light and camera move.
import { Camera, keys, registerChunks, type CameraOptions, type Shot, type ShotContext, type UniformValue, type Vec3 } from '@engine';
import { beat } from '../lib';

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
  /** Motion-blur samples (they also anti-alias). */
  mb?: number;
}

function scene(a: Age, start: number, end: number, fadeIn = 0, fadeOut = 0): Shot<{ cam: Camera }> {
  return {
    id: `age-${a.id}`,
    start,
    end,
    fadeIn,
    fadeOut,
    motionBlur: a.mb ?? 3,
    setup: () => ({ cam: new Camera({ fov: 35, near: 0.05, far: 20000 }) }),
    render(c, s) {
      const t = c.time - start;
      s.cam.set(a.cam(t, end - start));
      c.fullscreen(c.e.program(`#include <arrow-of-time/age-${a.id}>`, `age-${a.id}`), {
        ...s.cam.uniforms(),
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

const SLATE = (id: string): Age => ({ id: 'slate', cam: () => ({ pos: [0, 1, 0], target: [0, 1, -1], fov: 35 }), uniforms: () => ({ uSlate: id.length }), mb: 1 });

export function ages(): Shot[] {
  const list: Age[] = [FARMING, SLATE('cities'), SLATE('writing'), GIZA, SLATE('philosophy'), SLATE('printing'), SLATE('industry'), SLATE('flight'), SLATE('atom'), SLATE('space')];
  const b = beat('civilization');
  return list.map((a, i) => {
    const start = i === 0 ? b.start - 0.4 : cut(CARDS[i].t);
    const end = i + 1 < list.length ? cut(CARDS[i + 1].t) : b.end + 0.5;
    return scene(a, start, end, i === 0 ? 0.8 : 0, i + 1 < list.length ? 0 : 1.0);
  });
}
