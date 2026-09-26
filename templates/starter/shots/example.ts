// Two example shots: a full-screen shader (nebula) and a 3D sprite shot (star field fly-through).
import { Camera, Sprites, allocSprites, blackbody, keys, rng, starSphere, type Shot } from '@engine';
import T from '../timeline.json';

const beat = (id: string) => T.beats.find((b) => b.id === id)!;

// Full-screen fragment shaders get uRes, uTime (shot-local), uDur, uProg, uGTime and uAspect.
// `#include <noise|color|stars|sdf|camera>` pulls in the engine's GLSL library.
const NEBULA = `
#include <noise>
#include <color>
#include <stars>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uTime, uGTime;
void main() {
  vec2 p = centered(vUv, uAspect) * 2.2;
  vec2 q;
  float f = warpedFbm(p + vec2(0.0, uTime * 0.02), uTime, 5, q);
  vec3 col = mix(vec3(0.05, 0.01, 0.1), vec3(0.9, 0.35, 0.15), f * f * 1.6);
  col = mix(col, vec3(0.1, 0.35, 0.9), saturate(length(q) - 0.6)) * f * 1.6;
  col += starField(centered(vUv, uAspect), 1.0 / uRes.y, uGTime, 3.0, 1.0);
  fragColor = vec4(col, 1.0);
}`;

export function nebulaShot(): Shot {
  const b = beat('intro');
  return {
    id: 'nebula',
    start: b.start,
    end: b.end + 0.5, // overlap the next shot by 1s: a dissolve
    fadeOut: 1,
    render(c) {
      c.fullscreen(c.e.program(NEBULA, 'nebula'));
    },
  };
}

export function starsShot(): Shot<{ field: Sprites; sky: Sprites; cam: Camera }> {
  const b = beat('voyage');
  return {
    id: 'stars',
    start: b.start - 0.5,
    end: T.duration,
    fadeIn: 1,
    motionBlur: 3, // sub-frame samples: smooth streaks for the fast flight
    setup: (e) => {
      // A volume of stars along the flight path (they stream past with real parallax)...
      const r = rng(1);
      const n = 20000;
      const d = allocSprites(n);
      for (let i = 0; i < n; i++) {
        d.position.set([r.range(-8, 8), r.range(-5, 5), r.range(-70, 5)], i * 3);
        const c = blackbody(r.range(3000, 12000));
        const k = Math.pow(r.next(), 6) * 3 + 0.2;
        d.color.set([c[0] * k, c[1] * k, c[2] * k], i * 3);
        d.size[i] = 0.008;
      }
      // ...plus a distant sky at infinity (drawn with { sky: true }).
      return {
        field: new Sprites(e, d),
        sky: new Sprites(e, starSphere(rng(2), { count: 8000, brightness: 0.4, band: 0.4 })),
        cam: new Camera({ fov: 55 }),
      };
    },
    render(c, s) {
      const z = keys(c.time, [[b.start, 0], [T.cues.hit + 0.2, 0], [T.duration, -55, 'inOutCubic']]);
      s.cam.set({ pos: [0, 0, z], target: [0, 0, z - 1] });
      s.sky.draw(s.cam, c.time, {}, { sky: true });
      s.field.draw(s.cam, c.time);
    },
  };
}
