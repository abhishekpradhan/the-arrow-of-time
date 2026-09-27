// Sputnik 1 in orbit, 1957 (from cue sputnik): the polished sphere tumbles slowly over the day
// side of the Earth, the Sun high ahead of it. The Earth
// is the Planet component with the real maps and city lights, drawn in kilometres; the satellite
// is ray-marched in metres over it (shaders/sputnik.glsl) with premultiplied alpha, like the
// Moon landing. The shot dissolves into the Moon landing: from the Earth to the Moon.
import { Camera, Planet, Sprites, loadEarth, m4, prog, rng, starSphere, v3, type Mat4, type Shot, type Vec3 } from '@engine';
import { beat, cues } from '../lib';
import './civilization';

const R_EARTH = 6371;   // km
const ALT = 900;        // km: near Sputnik's apogee (939 km)
const EARTH_C: Vec3 = [0, -(R_EARTH + ALT), 0];
/** How far below the horizontal the Earth's limb lies from this altitude (radians). */
const LIMB = Math.asin(R_EARTH / (R_EARTH + ALT)) - Math.PI / 2;

/** Direction to the Sun: `up` radians above the limb, off to the right of the way we look. */
function sunAt(up: number): Vec3 {
  const el = LIMB + up, az = 0.24;
  return v3.norm([Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]);
}

export function sputnik(): Shot<{ earth: Planet; cam: Camera; sky: Sprites }> {
  const start = cues.sputnik;
  return {
    id: 'sputnik',
    start,
    end: beat('civilization').end + 0.5,
    fadeIn: 0,
    fadeOut: 1.0,
    motionBlur: 2,
    async setup(e) {
      return {
        earth: new Planet(e, await loadEarth(e)),
        cam: new Camera({ fov: 40, near: 0.0005, far: 300000 }),
        sky: new Sprites(e, starSphere(rng(212), { count: 6000, brightness: 0.25 })),
      };
    },
    render(c, s) {
      const t = c.time - start;
      // A slow drift round the satellite, looking down past it at the limb.
      const az = 0.12 - 0.05 * t;
      const dist = 0.0042 - 0.0002 * t;
      s.cam.set({ pos: [Math.sin(az) * dist, 0.0017, Math.cos(az) * dist], target: [0, -0.0002, 0] });
      s.cam.pan(0.0002, 0);
      // Late morning over the day side: the Sun high ahead, just above the frame.
      const sun = sunAt(0.78 + prog(t, 0, 2.6, 'inOutSine') * 0.03);
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      s.earth.draw(c, s.cam, {
        center: EARTH_C, radius: R_EARTH, yaw: 1.2, spin: c.time * 0.001, tilt: 0.3, sunDir: sun, earth: 1, city: 0.6,
        clouds: 0.45, cloudT: 0.4, atmo: 1.0, atmoColor: [0.3, 0.55, 1.0],
      });
      const spin: Mat4 = m4.mul(m4.rotateY(0.3 + 0.32 * t), m4.rotateX(0.35 + 0.1 * t));
      const spin3 = [spin[0], spin[1], spin[2], spin[4], spin[5], spin[6], spin[8], spin[9], spin[10]];
      c.gl.enable(c.gl.BLEND);
      c.gl.blendFunc(c.gl.ONE, c.gl.ONE_MINUS_SRC_ALPHA);
      c.fullscreen(c.e.program('#include <arrow-of-time/sputnik>', 'sputnik'), {
        ...s.cam.uniforms(), uSpin: spin3, uSun: sun, uEarthC: EARTH_C, uEarthR: R_EARTH, uT: t,
      });
      c.gl.disable(c.gl.BLEND);
    },
  };
}
