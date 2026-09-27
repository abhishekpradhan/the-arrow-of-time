// The Moon, 1969: an astronaut steps off the lander onto the Sea of Tranquility (cue moonStep)
// and the camera cranes back to the lander, the flag and the Earth in the black sky
// (shaders/apollo.glsl; the Earth is the Planet component with the real maps).
import { Camera, Planet, keys, loadEarth, v3, type Shot, type Vec3 } from '@engine';
import { cues, span } from '../lib';
import './ages';

/** The Sun, low behind the camera's left shoulder: long shadows run away from us. */
const SUN: Vec3 = v3.norm([-0.5, 0.22, 0.84]);
/**
 * Where the Earth hangs: above and right of the lander as the final camera sees it. (From the
 * real landing sites it stands higher in the sky; the film brings it into the frame.)
 */
const EARTH_DIR: Vec3 = [-0.0515, 0.1822, -0.9819];

export function moonLanding(): Shot<{ planet: Planet; cam: Camera }> {
  return {
    ...span('moonlanding', { dIn: 1.0, dOut: 1.0 }),
    motionBlur: 3,
    async setup(e) {
      return { planet: new Planet(e, await loadEarth(e)), cam: new Camera({ fov: 38, near: 0.02, far: 30000 }) };
    },
    render(c, s) {
      const t = c.time - cues.moonStep;
      // Low by the footpad for the step, then up and back to reveal the whole scene.
      const pos = keys(t, [[-1.2, [3.9, 1.05, 8.2]], [0.2, [3.7, 1.0, 8.0]], [4.8, [4.6, 2.3, 14.8], 'inOutSine']]) as Vec3;
      const target = keys(t, [[-1.2, [0.35, 1.15, 5.0]], [0.2, [0.35, 1.05, 5.1]], [4.8, [-0.2, 2.2, 1.0], 'inOutSine']]) as Vec3;
      s.cam.set({ pos, target, fov: keys(t, [[0.2, 36], [4.8, 42, 'inOutSine']]) });
      const end: Vec3 = [4.6, 2.3, 14.8];
      s.planet.draw(c, s.cam, {
        center: v3.add(end, v3.scale(EARTH_DIR, 9000)), radius: 9000 * Math.tan((1.0 * Math.PI) / 180), yaw: -0.5, spin: 0, tilt: 0.3,
        sunDir: SUN, earth: 1, clouds: 0.5, cloudT: 0.8, atmo: 1.0, atmoColor: [0.3, 0.55, 1.0], glint: 0.8,
      });
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE_MINUS_SRC_ALPHA);
      c.fullscreen(c.e.program('#include <arrow-of-time/apollo>', 'apollo'), { ...s.cam.uniforms(), uStep: t, uSun: SUN, uT: c.time });
      c.gl.disable(c.gl.BLEND);
    },
  };
}
