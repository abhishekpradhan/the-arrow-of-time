// The Moon, 1969: the first step on the Sea of Tranquility (cue moonStep), painted like the
// civilization tableaux (shaders/moonstep.glsl): the lunar module in hard, low sunlight, the
// astronaut coming down the ladder and setting his boot on the regolith, a spray of dust. The
// Earth is the Planet component with the real maps, drawn first in the black sky; the painted
// scene goes over it with premultiplied alpha. (From the real landing site the Earth stood much
// higher in the sky; the film brings it into the frame.)
import { Camera, Planet, keys, loadEarth, v3, type Shot, type Vec3 } from '@engine';
import { cues, span } from '../lib';
import './civilization';

/** Where the Earth hangs in the picture (centred units), and its radius there. */
const EARTH_AT: [number, number] = [0.02, 0.27];
const EARTH_R = 0.036;

export function moonLanding(): Shot<{ planet: Planet; cam: Camera }> {
  return {
    ...span('moonlanding', { dIn: 1.0, dOut: 1.0 }),
    async setup(e) {
      return { planet: new Planet(e, await loadEarth(e)), cam: new Camera({ fov: 40, near: 0.1, far: 1e6 }) };
    },
    render(c, s) {
      const t = c.time - cues.moonStep;
      // A slow push in, drifting a little to the right.
      const zoom = keys(t, [[-1.6, 1.0], [5.6, 1.1, 'inOutSine']]);
      const camX = keys(t, [[-1.6, -0.03], [5.6, 0.05, 'inOutSine']]);
      s.cam.set({ pos: [0, 0, 0], target: [0, 0, -1], fov: 40 });
      const k = 2 * Math.tan((20 * Math.PI) / 180);
      const D = 1000;
      const ex = (EARTH_AT[0] * zoom - camX * 0.0) * k, ey = EARTH_AT[1] * zoom * k;
      const dir = v3.norm([ex, ey, -1]);
      const sunDir: Vec3 = v3.norm([-0.85, 0.3, 0.45]);
      s.planet.draw(c, s.cam, {
        center: v3.scale(dir, D), radius: D * EARTH_R * zoom * k, yaw: -0.5, spin: 0, tilt: 0.3,
        sunDir, earth: 1, clouds: 0.5, cloudT: 0.8, atmo: 1.0, atmoColor: [0.3, 0.55, 1.0], glint: 0.8,
      });
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE_MINUS_SRC_ALPHA);
      c.fullscreen(c.e.program('#include <arrow-of-time/moonstep>', 'moonstep'), { uStep: t, uCam: [camX, 0], uZoom: zoom });
      c.gl.disable(c.gl.BLEND);
    },
  };
}
