// Civilization: one river valley seen from the air as twelve thousand years race past, from
// the first fields to the first rocket (shader: ../shaders/valley.glsl).
import { Camera, RenderTarget, keys, prog, registerChunks, type Shot, type Vec3 } from '@engine';
import { beat, cues, span } from '../lib';

registerChunks(import.meta.glob('../shaders/*.glsl', { query: '?raw', import: 'default', eager: true }) as Record<string, string>, 'arrow-of-time/');

const VALLEY = '#include <arrow-of-time/valley>';
const BAKE = '#define VALLEY_BAKE\n#include <arrow-of-time/valley>';

type Montage = { t: number; year: number };

/** The same launch trajectory as rocketPos() in the shader. */
const PAD: Vec3 = [34, 0.45, 338];
function rocketAt(launch: number): Vec3 {
  const t = Math.max(launch - 1.2, 0);
  return [PAD[0] + 0.07 * t * t, PAD[1] + 0.2 + 3.0 * t * t + 3.2 * t * t * t, PAD[2]];
}

/**
 * Days elapsed when each card appears. Whole days race past between cards; the fraction sets the
 * light for the card (see sunFraction: 0 sunrise, about 0.33 noon, 0.67 sunset, 0.87 midnight).
 * The space age arrives at dusk and the launch happens at night.
 */
const CARD_DAYS = [0.12, 1.3, 2.62, 3.36, 4.42, 5.86, 7.3, 8.36, 9.62, 9.8];

/**
 * A time-lapse day spends three quarters of its time in daylight, so each era is seen by day and
 * its lights flash on in a short night. Maps a fraction of the elapsed day to the Sun's phase
 * (0 sunrise, 0.5 sunset, 0.75 midnight).
 */
function sunFraction(f: number): number {
  return f < 0.67 ? (f / 0.67) * 0.5 : 0.5 + ((f - 0.67) / 0.33) * 0.5;
}

export function civilization(): Shot<{ cam: Camera; height: RenderTarget; baked: boolean }> {
  const b = beat('civilization') as ReturnType<typeof beat> & { montage: Montage[] };
  const years: [number, number][] = [[b.start, -10500], ...b.montage.map((m): [number, number] => [m.t, m.year]), [b.end, 1962]];
  const yearAt = (time: number) => keys(time, years);
  return {
    ...span('civilization', { dIn: 0.8, dOut: 1.0 }),
    // Terrain height and slope, baked on the first frame (0.31 world units per texel).
    setup: (e) => ({ cam: new Camera({ fov: 42, near: 0.1, far: 2000 }), height: new RenderTarget(e.gl, 2048, 2048, { format: 'rgba16f' }), baked: false }),
    render(c, s) {
      if (!s.baked) {
        s.height.bind();
        c.fullscreen(c.e.program(BAKE, 'valley-bake'));
        c.target.bind();
        s.baked = true;
      }
      const t = c.time - b.start;
      const year = yearAt(c.time);
      const dusk = b.montage[9].t - b.start;
      const launch = c.time - cues.launch;
      // The camera rises and pulls back as the city grows, then follows the rocket up.
      // Close to the first village, then rising and pulling back as the city spreads.
      const pos = keys(t, [[0, [-3, 4.5, 38]], [6, [-7, 8, 10], 'inOutSine'], [14, [-12, 14, -28], 'inOutSine'], [dusk, [-17, 24, -52], 'inOutSine'], [b.end - b.start, [-18, 26, -56], 'outSine']]);
      const look = keys(t, [[0, [6, 0.8, 90]], [6, [5, 1.5, 95], 'inOutSine'], [14, [5, 2.5, 110], 'inOutSine'], [dusk, [9, 3, 140], 'inOutSine']]) as Vec3;
      const rp = rocketAt(launch);
      const follow = prog(launch, 1.0, 4.5, 'inOutSine');
      const target: Vec3 = [look[0] + (rp[0] - look[0]) * follow, look[1] + (rp[1] - look[1]) * follow, look[2] + (rp[2] - look[2]) * follow];
      s.cam.set({ pos: pos as Vec3, target });
      const days = keys(c.time, [
        [b.start, 0.02],
        ...b.montage.map((m, i): [number, number, 'inOutSine'] => [m.t, CARD_DAYS[i], 'inOutSine']),
        [cues.launch, CARD_DAYS[9] + 0.06, 'inOutSine'],
        [b.end, CARD_DAYS[9] + 0.12],
      ]);
      const phase = (Math.floor(days) + sunFraction(days % 1)) * Math.PI * 2;
      c.fullscreen(c.e.program(VALLEY, 'valley'), {
        ...s.cam.uniforms(),
        uHeight: s.height,
        uYear: year,
        uCity: keys(year, [[-10500, 4], [-10000, 5], [-6000, 8], [-4000, 12], [-3200, 15], [-2560, 17], [-500, 24], [1000, 30], [1450, 36], [1760, 44], [1850, 55], [1903, 80], [1945, 115], [1962, 140]]),
        uFields: keys(year, [[-10500, 10], [-10000, 18], [-4000, 40], [-500, 70], [1450, 90], [1760, 110], [1903, 135], [1962, 170]]),
        uPhase: phase,
        uSeason: (t / 5) % 1,
        uNight: Math.floor(phase / (Math.PI * 2)),
        uClouds: t * 1.1,
        uTowers: prog(year, 1885, 1962, 'inOutSine'),
        uSmog: keys(year, [[1760, 0], [1850, 0.7], [1930, 1], [1962, 0.5]]),
        uPyramid: prog(year, -2900, -2560, 'outSine'),
        uTemple: prog(year, -1300, -480, 'outSine'),
        uLaunch: launch,
        uPlane: prog(c.time, b.montage[7].t - 0.2, b.montage[7].t + 2.4),
      });
    },
  };
}
