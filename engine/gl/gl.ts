// Thin, typed WebGL2 layer: programs with reflected uniforms, render targets,
// textures and a GLSL `#include` preprocessor.

import { resolveIncludes } from './shaderlib';

export type GL = WebGL2RenderingContext;

export const GLSL_HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
`;

export const FULLSCREEN_VS = `${GLSL_HEADER}
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// ----------------------------------------------------------------- textures

export type TexFormat = 'rgba8' | 'srgba8' | 'rgba16f' | 'rgba32f' | 'r8' | 'r16f' | 'r32f' | 'rg16f';

const FORMATS: Record<TexFormat, { internal: number; format: number; type: number }> = {
  rgba8: { internal: 0x8058 /* RGBA8 */, format: 0x1908 /* RGBA */, type: 0x1401 /* UNSIGNED_BYTE */ },
  srgba8: { internal: 0x8c43 /* SRGB8_ALPHA8 */, format: 0x1908, type: 0x1401 },
  rgba16f: { internal: 0x881a /* RGBA16F */, format: 0x1908, type: 0x140b /* HALF_FLOAT */ },
  rgba32f: { internal: 0x8814 /* RGBA32F */, format: 0x1908, type: 0x1406 /* FLOAT */ },
  r8: { internal: 0x8229 /* R8 */, format: 0x1903 /* RED */, type: 0x1401 },
  r16f: { internal: 0x822d /* R16F */, format: 0x1903, type: 0x140b },
  r32f: { internal: 0x822e /* R32F */, format: 0x1903, type: 0x1406 },
  rg16f: { internal: 0x822f /* RG16F */, format: 0x8227 /* RG */, type: 0x140b },
};

export interface TexOptions {
  format?: TexFormat;
  filter?: 'linear' | 'nearest' | 'mipmap';
  wrap?: 'clamp' | 'repeat' | 'mirror';
  wrapS?: 'clamp' | 'repeat' | 'mirror';
  wrapT?: 'clamp' | 'repeat' | 'mirror';
  flipY?: boolean;
  anisotropy?: number;
}

const WRAP = { clamp: 0x812f, repeat: 0x2901, mirror: 0x8370 };

export class Texture {
  readonly target: number;
  constructor(
    public gl: GL,
    public tex: WebGLTexture,
    public width: number,
    public height: number,
    target?: number,
  ) {
    this.target = target ?? gl.TEXTURE_2D;
  }
  dispose() {
    this.gl.deleteTexture(this.tex);
  }
}

function applySampling(gl: GL, target: number, o: TexOptions) {
  const filter = o.filter ?? 'linear';
  const minF = filter === 'nearest' ? gl.NEAREST : filter === 'mipmap' ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR;
  const magF = filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, minF);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, magF);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, WRAP[o.wrapS ?? o.wrap ?? 'clamp']);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, WRAP[o.wrapT ?? o.wrap ?? 'clamp']);
  if (o.anisotropy) {
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) gl.texParameterf(target, ext.TEXTURE_MAX_ANISOTROPY_EXT, o.anisotropy);
  }
}

/** Upload an image/canvas/bitmap. Use format 'srgba8' for colour maps so sampling returns linear values. */
export function textureFromSource(gl: GL, src: TexImageSource, o: TexOptions = {}): Texture {
  const f = FORMATS[o.format ?? 'rgba8'];
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, o.flipY ? 1 : 0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, f.format, f.type, src);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  applySampling(gl, gl.TEXTURE_2D, o);
  if (o.filter === 'mipmap') gl.generateMipmap(gl.TEXTURE_2D);
  const w = (src as { width: number }).width, h = (src as { height: number }).height;
  return new Texture(gl, tex, w, h);
}

/** Upload raw typed-array data (Float32Array for float formats, Uint8Array otherwise). */
export function dataTexture(
  gl: GL,
  width: number,
  height: number,
  data: ArrayBufferView | null,
  o: TexOptions = {},
): Texture {
  const f = FORMATS[o.format ?? 'rgba32f'];
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, width, height, 0, f.format, f.type, data);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  applySampling(gl, gl.TEXTURE_2D, { filter: 'nearest', ...o });
  if (o.filter === 'mipmap') gl.generateMipmap(gl.TEXTURE_2D);
  return new Texture(gl, tex, width, height);
}

/** A 3D texture (e.g. a precomputed density volume). Data is x-fastest, then y, then z. */
export function volumeTexture(
  gl: GL,
  size: [number, number, number],
  data: ArrayBufferView,
  o: { format?: 'r8' | 'r16f' | 'r32f' | 'rgba8'; wrap?: 'clamp' | 'repeat' | 'mirror'; filter?: 'linear' | 'nearest' } = {},
): Texture {
  const f = FORMATS[o.format ?? 'r8'];
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(gl.TEXTURE_3D, 0, f.internal, size[0], size[1], size[2], 0, f.format, f.type, data);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  const filt = o.filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, filt);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, filt);
  const w = WRAP[o.wrap ?? 'repeat'];
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, w);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, w);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, w);
  gl.bindTexture(gl.TEXTURE_3D, null);
  return new Texture(gl, tex, size[0], size[1], gl.TEXTURE_3D);
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image ${url}`));
    img.src = url;
  });
}

export async function loadTexture(gl: GL, url: string, o: TexOptions = {}): Promise<Texture> {
  const img = await loadImage(url);
  return textureFromSource(gl, img, o);
}

// ------------------------------------------------------------ render targets

/** Tracks the most recently bound render target (lets the engine apply letterbox scissoring safely). */
export const bindState: { target: RenderTarget | null } = { target: null };

export interface RTOptions extends TexOptions {
  depth?: boolean;
}

export class RenderTarget {
  fbo: WebGLFramebuffer;
  texture: Texture;
  depth: WebGLRenderbuffer | null = null;
  format: TexFormat;
  constructor(
    public gl: GL,
    public width: number,
    public height: number,
    public opts: RTOptions = {},
  ) {
    this.format = opts.format ?? 'rgba16f';
    this.texture = dataTexture(gl, width, height, null, { filter: 'linear', ...opts, format: this.format });
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture.tex, 0);
    if (opts.depth) {
      this.depth = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    }
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  get tex() {
    return this.texture.tex;
  }
  bind() {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fbo);
    this.gl.viewport(0, 0, this.width, this.height);
    bindState.target = this;
    return this;
  }
  clear(r = 0, g = 0, b = 0, a = 1) {
    const gl = this.gl;
    this.bind();
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT | (this.depth ? gl.DEPTH_BUFFER_BIT : 0));
    return this;
  }
  dispose() {
    this.gl.deleteFramebuffer(this.fbo);
    this.texture.dispose();
    if (this.depth) this.gl.deleteRenderbuffer(this.depth);
  }
}

/** Recycles render targets by size/format so scenes can grab scratch buffers each frame. */
export class TargetPool {
  private free = new Map<string, RenderTarget[]>();
  constructor(private gl: GL) {}
  private key(w: number, h: number, o: RTOptions) {
    return `${w}x${h}:${o.format ?? 'rgba16f'}:${o.filter ?? 'linear'}:${o.wrap ?? 'clamp'}:${o.depth ? 1 : 0}`;
  }
  get(w: number, h: number, o: RTOptions = {}): RenderTarget {
    const list = this.free.get(this.key(w, h, o));
    if (list && list.length) return list.pop()!;
    return new RenderTarget(this.gl, w, h, o);
  }
  release(rt: RenderTarget) {
    const k = this.key(rt.width, rt.height, rt.opts);
    if (!this.free.has(k)) this.free.set(k, []);
    this.free.get(k)!.push(rt);
  }
}

// ------------------------------------------------------------------ programs

export type UniformValue =
  | number
  | boolean
  | number[]
  | Float32Array
  | Int32Array
  | Texture
  | RenderTarget
  | null
  | undefined;

interface UniformInfo {
  loc: WebGLUniformLocation;
  type: number;
  size: number;
}

function compileShader(gl: GL, type: number, src: string, name: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '';
    const lines = src.split('\n');
    // Show the offending lines with numbers, which makes shader errors actionable.
    const ctx = log
      .split('\n')
      .map((l) => /ERROR: \d+:(\d+)/.exec(l))
      .filter(Boolean)
      .slice(0, 4)
      .map((m) => {
        const n = parseInt(m![1], 10);
        return lines
          .slice(Math.max(0, n - 3), n + 2)
          .map((s, i) => `${String(n - 2 + i).padStart(5)}| ${s}`)
          .join('\n');
      })
      .join('\n  ...\n');
    throw new Error(`[${name}] ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader error:\n${log}\n${ctx}`);
  }
  return sh;
}

export class Program {
  handle: WebGLProgram;
  uniforms = new Map<string, UniformInfo>();
  private unit = 0;
  private warned = new Set<string>();

  constructor(
    public gl: GL,
    vertex: string,
    fragment: string,
    public name = 'program',
  ) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, preprocess(vertex), name);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, preprocess(fragment), name);
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`[${name}] link error: ${gl.getProgramInfoLog(p)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.handle = p;
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i)!;
      const base = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(p, info.name);
      if (loc) this.uniforms.set(base, { loc, type: info.type, size: info.size });
    }
  }

  use() {
    this.gl.useProgram(this.handle);
    this.unit = 0;
    return this;
  }

  has(name: string) {
    return this.uniforms.has(name);
  }

  /** Set uniforms by name; types are taken from shader reflection. Unknown names are ignored. */
  set(values: Record<string, UniformValue>) {
    for (const k in values) this.setOne(k, values[k]);
    return this;
  }

  setOne(name: string, v: UniformValue) {
    const u = this.uniforms.get(name);
    if (!u || v === undefined || v === null) return this;
    const gl = this.gl;
    switch (u.type) {
      case gl.FLOAT:
        if (u.size > 1) gl.uniform1fv(u.loc, v as number[]);
        else gl.uniform1f(u.loc, typeof v === 'boolean' ? (v ? 1 : 0) : (v as number));
        break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v as number[]); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v as number[]); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v as number[]); break;
      case gl.INT:
      case gl.BOOL:
        if (u.size > 1) gl.uniform1iv(u.loc, v as number[]);
        else gl.uniform1i(u.loc, typeof v === 'boolean' ? (v ? 1 : 0) : (v as number));
        break;
      case gl.INT_VEC2: gl.uniform2iv(u.loc, v as number[]); break;
      case gl.INT_VEC3: gl.uniform3iv(u.loc, v as number[]); break;
      case gl.INT_VEC4: gl.uniform4iv(u.loc, v as number[]); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v as Float32Array); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v as Float32Array); break;
      case gl.SAMPLER_2D:
      case gl.SAMPLER_3D:
      case gl.SAMPLER_2D_ARRAY: {
        const t = v instanceof RenderTarget ? v.texture : (v as Texture);
        const unit = this.unit++;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(t.target, t.tex);
        gl.uniform1i(u.loc, unit);
        break;
      }
      default:
        if (!this.warned.has(name)) {
          this.warned.add(name);
          console.warn(`[${this.name}] unsupported uniform type for ${name}`);
        }
    }
    return this;
  }

  dispose() {
    this.gl.deleteProgram(this.handle);
  }
}

export function preprocess(src: string): string {
  let s = src.trimStart();
  if (!s.startsWith('#version')) s = GLSL_HEADER + s;
  return resolveIncludes(s);
}

// ------------------------------------------------------------- geometry

/** A single oversized triangle covering the viewport (cheaper than a quad). */
export function createFullscreenTriangle(gl: GL): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

export type BlendMode = 'none' | 'add' | 'alpha' | 'premul' | 'multiply' | 'screen' | 'max';

export function setBlend(gl: GL, mode: BlendMode) {
  if (mode === 'none') {
    gl.disable(gl.BLEND);
    return;
  }
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  switch (mode) {
    case 'add': gl.blendFunc(gl.ONE, gl.ONE); break;
    case 'alpha': gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); break;
    case 'premul': gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); break;
    case 'multiply': gl.blendFunc(gl.DST_COLOR, gl.ZERO); break;
    case 'screen': gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); break;
    case 'max': gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE); break;
  }
}
