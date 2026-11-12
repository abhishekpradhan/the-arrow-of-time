// Instanced streaks: points of light drawn as the line they travel while the shutter is open.
// A sprite that moves many pixels in a frame would need dozens of motion-blur samples to read as
// a streak rather than a row of dots; here each one is a single capsule between its position at
// shutter open and at shutter close, with its light spread along the path (so fast ones dim, as
// on film). At rest a streak is exactly a `Sprites` Gaussian.
//
//   const sparks = new Streaks(e, data, { path: PATH });
//   sparks.draw(cam, time, { uTravel0: a, uTravel1: b });
//
// `path` is GLSL defining
//   void path(vec3 p, vec4 x, inout vec3 col, inout float size, out vec3 a, out vec3 b)
// which sets the world positions at shutter open (a) and close (b), and may change the colour
// (the flux) and the size, as the `animate` hook of `Sprites` does.

import type { Camera } from '../core/camera';
import type { Engine } from '../core/engine';
import { setBlend, type BlendMode, type GL, type Program, type UniformValue } from '../gl/gl';
import type { SpriteData } from './sprites';

export interface StreakOptions {
  path?: string;
  /** Minimum on-screen sigma in pixels (anti-aliasing). */
  minPixels?: number;
  maxPixels?: number;
}

const DEFAULT_PATH = `void path(vec3 p, vec4 x, inout vec3 col, inout float size, out vec3 a, out vec3 b) { a = p; b = p; }`;

const VS = (path: string) => `
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
uniform float uTime, uMinPx, uMaxPx, uBrightness, uNear;
out vec2 vQ;
out float vHalfLen;
out vec3 vColor;
${path}
void main() {
  vec3 col = iColor;
  float size = iSize;
  vec3 a, b;
  path(iPos, iExtra, col, size, a, b);
  vec4 va = uView * vec4(a, 1.0), vb = uView * vec4(b, 1.0);
  if (-va.z < uNear || -vb.z < uNear || size <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 ca = uProj * va, cb = uProj * vb;
  vec2 pa = ca.xy / ca.w * uRes * 0.5, pb = cb.xy / cb.w * uRes * 0.5;
  float pxR = size / (-0.5 * (va.z + vb.z)) * uProj[1][1] * uRes.y * 0.5;
  float r = clamp(pxR, uMinPx, uMaxPx);
  vec2 d = pb - pa;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(0.0, 1.0);
  const float EXT = 3.0;
  vec2 px = 0.5 * (pa + pb) + vec2(-dir.y, dir.x) * aCorner.x * EXT * r + dir * aCorner.y * (0.5 * len + EXT * r);
  gl_Position = vec4(px / (uRes * 0.5), 0.0, 1.0);
  vQ = vec2(aCorner.x * EXT, aCorner.y * (0.5 * len / r + EXT));
  vHalfLen = 0.5 * len / r;
  // The same light, spread over the path: a capsule's integral is 2 pi r^2 (1 + len / (sqrt(2 pi) r)).
  // A streak held at the minimum width covers only part of its footprint, as sprites do.
  float energy = min((pxR * pxR) / (r * r), 1.0) / (1.0 + len / (2.5066 * r));
  vColor = col * uBrightness * energy;
}`;

const FS = `
in vec2 vQ;
in float vHalfLen;
in vec3 vColor;
out vec4 fragColor;
void main() {
  float along = max(abs(vQ.y) - vHalfLen, 0.0);
  float g = exp(-0.5 * (vQ.x * vQ.x + along * along));
  fragColor = vec4(vColor * g, g);
}`;

export class Streaks {
  gl: GL;
  count: number;
  prog: Program;
  vao: WebGLVertexArrayObject;

  constructor(
    private e: Engine,
    data: SpriteData,
    public o: StreakOptions = {},
  ) {
    const gl = (this.gl = e.gl);
    this.count = data.count;
    this.prog = e.programVF(VS(o.path ?? DEFAULT_PATH), FS, 'streaks');
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
    };
    mk(1, 3, data.position);
    mk(2, 3, data.color);
    mk(3, 1, data.size);
    mk(4, 4, data.extra ?? new Float32Array(data.count * 4));
    gl.bindVertexArray(null);
  }

  draw(cam: Camera, time: number, uniforms: Record<string, UniformValue> = {}, o: { blend?: BlendMode; brightness?: number } = {}) {
    const gl = this.gl;
    const e = this.e;
    cam.aspect = e.width / e.height;
    this.prog.use().set(cam.uniforms()).set({
      uRes: [e.width, e.height],
      uTime: time,
      uMinPx: (this.o.minPixels ?? 0.75) * Math.max(0.5, e.scale),
      uMaxPx: this.o.maxPixels ?? 400,
      uBrightness: o.brightness ?? 1,
    }).set(uniforms);
    setBlend(gl, o.blend ?? 'add');
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.bindVertexArray(null);
    setBlend(gl, 'none');
  }
}
