// Instanced, camera-facing Gaussian sprites: stars, galaxies, dust, embers, debris.
// Sprites keep their flux when they shrink below a pixel, so distant points fade
// physically instead of flickering.

import type { Engine } from '../core/engine';
import type { Camera } from '../core/camera';
import { setBlend, type BlendMode, type GL, type Program, type UniformValue } from '../gl/gl';
import { blackbody } from '../core/color';
import { TAU, type Rng, type Vec3 } from '../core/math';

export interface SpriteData {
  count: number;
  /** xyz per sprite */
  position: Float32Array;
  /** linear RGB per sprite (HDR allowed) */
  color: Float32Array;
  /** world-space radius (1 sigma of the Gaussian) per sprite */
  size: Float32Array;
  /** free per-sprite data (vec4) for custom animation/shading */
  extra?: Float32Array;
}

export interface SpriteOptions {
  /**
   * GLSL defining `vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size)`
   * plus any uniforms it uses. Runs per sprite in the vertex shader.
   */
  animate?: string;
  /** GLSL defining `vec4 shade(vec2 q, vec3 col, vec4 x)`; q = quad coords in sigmas. Returns premultiplied rgb + alpha. */
  shade?: string;
  /** Minimum on-screen sigma in pixels (anti-aliasing). */
  minPixels?: number;
  /** Maximum on-screen sigma in pixels (keeps huge sprites affordable). */
  maxPixels?: number;
  /** Quad half-extent in sigmas. */
  extent?: number;
}

const DEFAULT_ANIMATE = `vec3 animate(vec3 p, vec4 x, inout vec3 col, inout float size) { return p; }`;
const DEFAULT_SHADE = `vec4 shade(vec2 q, vec3 col, vec4 x) { float g = exp(-0.5 * dot(q, q)); return vec4(col * g, g); }`;

const VS = (animate: string) => `
#include <common>
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 iPos;
layout(location = 2) in vec3 iColor;
layout(location = 3) in float iSize;
layout(location = 4) in vec4 iExtra;
uniform mat4 uView;
uniform mat4 uProj;
uniform vec3 uCamPos;
uniform vec2 uRes;
uniform float uTime, uMinPx, uMaxPx, uSizeScale, uBrightness, uExtent, uNear, uSkyFollow;
out vec2 vQ;
out vec3 vColor;
out vec4 vExtra;
${animate}
void main() {
  vec3 col = iColor;
  float size = iSize * uSizeScale;
  vec3 wp = animate(iPos, iExtra, col, size) + uCamPos * uSkyFollow;
  vec4 vp = uView * vec4(wp, 1.0);
  float z = -vp.z;
  if (z < uNear || size <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float pxR = size / z * uProj[1][1] * uRes.y * 0.5;
  float r = clamp(pxR, uMinPx, uMaxPx);
  float energy = min((pxR * pxR) / (r * r), 1.0);
  vec4 cp = uProj * vp;
  vec2 off = aCorner * uExtent * r / (uRes * 0.5);
  gl_Position = cp + vec4(off * cp.w, 0.0, 0.0);
  vQ = aCorner * uExtent;
  vColor = col * energy * uBrightness;
  vExtra = iExtra;
}`;

const FS = (shade: string) => `
#include <common>
in vec2 vQ;
in vec3 vColor;
in vec4 vExtra;
out vec4 fragColor;
uniform float uTime;
${shade}
void main() { fragColor = shade(vQ, vColor, vExtra); }`;

export class Sprites {
  gl: GL;
  count: number;
  prog: Program;
  vao: WebGLVertexArrayObject;
  private bufs: Record<'position' | 'color' | 'size' | 'extra', WebGLBuffer>;

  constructor(
    private e: Engine,
    data: SpriteData,
    public o: SpriteOptions = {},
  ) {
    const gl = (this.gl = e.gl);
    this.count = data.count;
    this.prog = e.programVF(VS(o.animate ?? DEFAULT_ANIMATE), FS(o.shade ?? DEFAULT_SHADE), 'sprites');
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const corner = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, corner);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const mk = (loc: number, n: number, arr: Float32Array) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(loc, 1);
      return b;
    };
    this.bufs = {
      position: mk(1, 3, data.position),
      color: mk(2, 3, data.color),
      size: mk(3, 1, data.size),
      extra: mk(4, 4, data.extra ?? new Float32Array(data.count * 4)),
    };
    gl.bindVertexArray(null);
  }

  /** Replace some attribute arrays (same count). */
  update(data: Partial<SpriteData>) {
    const gl = this.gl;
    for (const k of ['position', 'color', 'size', 'extra'] as const) {
      const arr = data[k];
      if (!arr) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[k]);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
    }
  }

  draw(
    cam: Camera,
    time: number,
    uniforms: Record<string, UniformValue> = {},
    o: { blend?: BlendMode; depthTest?: boolean; brightness?: number; sizeScale?: number; sky?: boolean; count?: number } = {},
  ) {
    const gl = this.gl;
    const e = this.e;
    cam.aspect = e.width / e.height;
    this.prog.use().set(cam.uniforms()).set({
      uRes: [e.width, e.height],
      uTime: time,
      uMinPx: (this.o.minPixels ?? 0.75) * Math.max(0.5, e.scale),
      uMaxPx: this.o.maxPixels ?? 400,
      uSizeScale: o.sizeScale ?? 1,
      uBrightness: o.brightness ?? 1,
      uExtent: this.o.extent ?? 3,
      uSkyFollow: o.sky ? 1 : 0,
    }).set(uniforms);
    setBlend(gl, o.blend ?? 'add');
    if (o.depthTest) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.min(o.count ?? this.count, this.count));
    gl.bindVertexArray(null);
    if (o.depthTest) {
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(true);
    }
    setBlend(gl, 'none');
  }
}

/** Allocate empty sprite arrays. */
export function allocSprites(count: number): SpriteData {
  return {
    count,
    position: new Float32Array(count * 3),
    color: new Float32Array(count * 3),
    size: new Float32Array(count),
    extra: new Float32Array(count * 4),
  };
}

export interface StarSphereOptions {
  count: number;
  radius?: number;
  /** Angular radius of a typical star, in radians (Gaussian sigma). */
  angularSize?: number;
  brightness?: number;
  /** Fraction of stars concentrated in a Milky-Way-like band. */
  band?: number;
  /** Band thickness (radians, Gaussian sigma). */
  bandWidth?: number;
  /** Normal of the band's plane. */
  bandNormal?: Vec3;
}

/** A sky of stars at (effectively) infinite distance. Draw with `{ sky: true }`. */
export function starSphere(r: Rng, o: StarSphereOptions): SpriteData {
  const d = allocSprites(o.count);
  const R = o.radius ?? 5000;
  const ang = o.angularSize ?? 0.00035;
  const bn = o.bandNormal ?? [0.2, 0.9, 0.3];
  const bl = Math.hypot(bn[0], bn[1], bn[2]);
  const n: Vec3 = [bn[0] / bl, bn[1] / bl, bn[2] / bl];
  // Orthonormal basis of the band plane.
  let u: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const dotun = u[0] * n[0] + u[1] * n[1] + u[2] * n[2];
  u = [u[0] - n[0] * dotun, u[1] - n[1] * dotun, u[2] - n[2] * dotun];
  const ul = Math.hypot(u[0], u[1], u[2]);
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  for (let i = 0; i < o.count; i++) {
    let dir: Vec3;
    if (r.next() < (o.band ?? 0)) {
      const a = r.next() * TAU;
      const h = r.gauss() * (o.bandWidth ?? 0.12);
      const c = Math.cos(h), s = Math.sin(h);
      dir = [
        (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * c + n[0] * s,
        (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * c + n[1] * s,
        (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * c + n[2] * s,
      ];
    } else dir = r.onSphere();
    d.position.set([dir[0] * R, dir[1] * R, dir[2] * R], i * 3);
    // Brightness: steep power law (few bright, many faint).
    const m = Math.pow(r.next(), 14) * 60 + Math.pow(r.next(), 3) * 2 + 0.15;
    const T = 2800 + Math.pow(r.next(), 1.8) * 11000;
    const c = blackbody(T);
    const b = m * (o.brightness ?? 1);
    d.color.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    d.size[i] = ang * R;
    d.extra!.set([r.next(), r.next(), m, T], i * 4);
  }
  return d;
}
