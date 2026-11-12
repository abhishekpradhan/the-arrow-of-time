// A barred spiral galaxy (the Milky Way in The Arrow of Time) rendered as a volume, the way a
// photograph sees one: smooth starlight, dust lanes that darken what lies behind them, pink
// star-forming knots, and a grain of resolved stars on top.
//
// The face-on structure (old stars, young stars, dust, H-II regions) is baked once into a
// texture by <galaxy-map>; every frame <galaxy> marches a thin slab through it and adds an
// analytic bulge. Sprite stars are drawn from the same map, so they follow the arms, and are
// dimmed by the dust in front of them.
//
//   const galaxy = new Galaxy(e, { seed: 70 });
//   galaxy.draw(c, cam, { spin: 0.01 * t });   // after the sky, into c.target
//
// The galaxy sits at the origin of the camera's world, in the xz plane, with a radius of
// about 1. To place it in a larger scene, draw it with a camera of its own in that frame.

import type { Camera } from '../core/camera';
import { blackbody } from '../core/color';
import type { Engine } from '../core/engine';
import { rng, type Vec3 } from '../core/math';
import type { ShotContext } from '../core/types';
import { RenderTarget, setBlend, type Program } from '../gl/gl';
import { Sprites, allocSprites, type SpriteData } from './sprites';

/** Half-width of the baked map in disk radii (the disk fades out before 1.45). */
const EXTENT = 1.5;

const BAKE = `
#include <galaxy-map>
in vec2 vUv; out vec4 fragColor;
uniform float uGalExtent;
void main() { fragColor = galaxyMap((vUv - 0.5) * 2.0 * uGalExtent); }`;

const TRACE = `
#include <camera>
#include <galaxy>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uGalBright, uGalFade;
void main() {
  vec3 rd = camRay(centered(vUv, uAspect));
  // The step jitter changes every frame, so what is left of it reads as grain.
  float jitter = hash12(gl_FragCoord.xy + 61.7 * fract(uGTime * 7.31));
  vec4 g = galaxyTrace(uCamPos, rd, jitter, pixelAngle(uRes.y));
  fragColor = vec4(g.rgb * uGalBright, g.a) * uGalFade;
}`;

/** Sprite hook: stars turn with the pattern and are dimmed by the dust between them and the camera. */
const STAR_ANIMATE = `
uniform sampler2D uGalMap;
uniform float uGalSpin, uGalExtent, uGalDust;
vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) {
  float tau = textureLod(uGalMap, p.xz / (2.0 * uGalExtent) + 0.5, 1.0).b;
  float cs = cos(uGalSpin), sn = sin(uGalSpin);
  vec3 wp = vec3(cs * p.x - sn * p.z, p.y, sn * p.x + cs * p.z);
  vec3 dir = normalize(uCamPos - wp);
  float hd = 0.0042 * (1.0 + 0.6 * length(p.xz));
  float s = dir.y >= 0.0 ? p.y : -p.y; // height on the camera's side of the dust layer
  float above = s > 0.0 ? 0.5 * exp(-s / hd) : 1.0 - 0.5 * exp(s / hd);
  col *= exp(-tau * above / max(abs(dir.y), 0.12) * uGalDust * vec3(0.68, 1.0, 1.42));
  return wp;
}`;

export interface GalaxyOptions {
  seed?: number;
  /** Pitch angle of the spiral arms in degrees (default 19; smaller winds them tighter). */
  pitch?: number;
  /** Bar orientation in the galaxy's plane (radians) and half-length (disk radii). */
  barAngle?: number;
  barLength?: number;
  /** Side of the baked structure map in texels (default 4096 at 1080p, less for smaller output). */
  mapSize?: number;
  /** Number of resolved star sprites (default 150k). */
  stars?: number;
}

export interface GalaxyDraw {
  /** Rotation of the whole pattern, radians. */
  spin?: number;
  brightness?: number;
  /** Fades the galaxy in or out as a whole (its light and its dust), 0..1. */
  fade?: number;
  /** Dust strength (1 = as baked). */
  dust?: number;
  /** Brightness of the old stars, the young stars, the H-II regions and the bulge. */
  gain?: [number, number, number, number];
  /** Brightness of the resolved stars relative to the diffuse light (0 skips them: from far away they are lost in it). */
  stars?: number;
  /**
   * Steps through the disk per ray (default 40). The jitter differs in every motion-blur
   * sample, so a shot that takes several can afford fewer steps in each.
   */
  steps?: number;
}

/**
 * Resolved stars drawn from the baked map: density follows the light, blue-white where the
 * map is young and warm where it is old, with a steep luminosity function.
 */
function starData(px: Float32Array, n: number, count: number, seed: number): SpriteData {
  const r = rng(seed);
  const cdf = new Float64Array(n * n);
  let total = 0;
  for (let i = 0; i < n * n; i++) {
    total += 0.3 * px[i * 4] + 1.0 * px[i * 4 + 1];
    cdf[i] = total;
  }
  const nBulge = Math.round(count * 0.1);
  const d = allocSprites(count);
  const laplace = (h: number) => (r.next() < 0.5 ? -1 : 1) * -h * Math.log(1 - r.next() * 0.999);
  for (let k = 0; k < count; k++) {
    let p: Vec3, T: number, bri: number;
    if (k < nBulge) {
      // Bulge and nucleus: a flattened Plummer sphere of old, warm stars.
      const a = 0.075;
      const rad = Math.min(a / Math.sqrt(Math.pow(Math.max(r.next(), 1e-6), -2 / 3) - 1), 0.45);
      const u = r.onSphere();
      p = [u[0] * rad * 1.15, u[1] * rad * 0.7, u[2] * rad];
      T = r.range(3300, 4800);
      bri = r.range(0.12, 0.4);
    } else {
      const want = r.next() * total;
      let lo = 0, hi = n * n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cdf[mid] < want) lo = mid + 1;
        else hi = mid;
      }
      const ix = lo % n, iz = Math.floor(lo / n);
      const x = ((ix + r.next()) / n - 0.5) * 2 * EXTENT, z = ((iz + r.next()) / n - 0.5) * 2 * EXTENT;
      const old = 0.3 * px[lo * 4], young = 1.0 * px[lo * 4 + 1];
      const isYoung = r.next() * (old + young) < young;
      const rr = Math.hypot(x, z), flare = 1 + 0.6 * rr;
      p = [x, laplace((isYoung ? 0.0065 : 0.014 + 0.03 * Math.exp(-rr / 0.13)) * flare), z];
      T = isYoung ? r.range(8000, 22000) : r.range(3600, 6800);
      bri = isYoung ? r.range(0.4, 1.3) : r.range(0.15, 0.5);
    }
    // A few giants, many dwarfs.
    bri *= 0.07 * (0.25 + 14 * Math.pow(r.next(), 12) + 1.5 * Math.pow(r.next(), 4));
    const c = blackbody(T);
    d.position.set(p, k * 3);
    d.color.set([c[0] * bri, c[1] * bri, c[2] * bri], k * 3);
    d.size[k] = 0.0011;
  }
  return d;
}

export class Galaxy {
  private map?: RenderTarget;
  private stars?: Sprites;
  private trace: Program;
  private shape: [number, number, number, number];

  constructor(private e: Engine, private o: GalaxyOptions = {}) {
    const pitch = ((o.pitch ?? 19) * Math.PI) / 180;
    this.shape = [1 / Math.tan(pitch), o.barAngle ?? 0.45, o.barLength ?? 0.27, o.seed ?? 70];
    this.trace = e.program(TRACE, 'galaxy');
  }

  /** Bake the structure map and place the stars: once, on the first draw. */
  private bake(c: ShotContext) {
    const gl = c.gl;
    // A texel of the map is about a pixel at 1080p from a disk radius away: scale it with the
    // output, so half-resolution drafts bake a quarter of the texels.
    const size = this.o.mapSize ?? Math.min(4096, Math.max(1024, 2 ** Math.ceil(Math.log2(4096 * this.e.scale))));
    const prog = this.e.program(BAKE, 'galaxy.bake');
    const u = { uGalShape: this.shape, uGalExtent: EXTENT };
    setBlend(gl, 'none');
    this.map = new RenderTarget(gl, size, size, { format: 'rgba16f', filter: 'mipmap' });
    this.map.bind();
    c.fullscreen(prog, { ...u, uGalTexel: (2 * EXTENT) / size });
    gl.bindTexture(gl.TEXTURE_2D, this.map.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
    // A small copy read back to the CPU, to draw the stars from.
    const n = 512;
    const small = new RenderTarget(gl, n, n, { format: 'rgba32f', filter: 'nearest' });
    small.bind();
    c.fullscreen(prog, { ...u, uGalTexel: (2 * EXTENT) / n });
    const px = new Float32Array(n * n * 4);
    gl.readPixels(0, 0, n, n, gl.RGBA, gl.FLOAT, px);
    small.dispose();
    this.stars = new Sprites(this.e, starData(px, n, this.o.stars ?? 150000, this.shape[3] + 1), { animate: STAR_ANIMATE, minPixels: 0.6, maxPixels: 1.5 });
    c.target.bind();
  }

  /** Draws the galaxy over whatever is in `c.target` (draw the sky first: the dust dims it). */
  draw(c: ShotContext, cam: Camera, o: GalaxyDraw = {}) {
    const gl = c.gl;
    const fade = o.fade ?? 1;
    if (fade <= 0) return;
    if (!this.map) this.bake(c);
    cam.aspect = c.aspect;
    const u = {
      uGalMap: this.map!,
      uGalExtent: EXTENT,
      uGalTexel: (2 * EXTENT) / this.map!.width,
      uGalSpin: o.spin ?? 0,
      uGalBar: this.shape[1],
      uGalDust: o.dust ?? 1,
      uGalSteps: Math.round(o.steps ?? 40),
    };
    setBlend(gl, 'premul');
    c.fullscreen(this.trace, { ...cam.uniforms(), ...u, uGalGain: o.gain ?? [1, 1, 1, 1], uGalBright: o.brightness ?? 1, uGalFade: fade });
    setBlend(gl, 'none');
    const stars = (o.brightness ?? 1) * (o.stars ?? 1) * fade;
    if (stars > 0) this.stars!.draw(cam, c.time, u, { blend: 'add', brightness: stars });
  }
}
