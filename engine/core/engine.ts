// The frame renderer. Given a Project, renders any frame deterministically:
//   shots (HDR, dissolved/blended) -> optional motion-blur accumulation
//   -> Post (bloom, tonemap, grade, grain, letterbox) + text layer -> canvas.

import {
  FULLSCREEN_VS,
  Program,
  RenderTarget,
  TargetPool,
  bindState,
  createFullscreenTriangle,
  dataTexture,
  loadTexture,
  setBlend,
  type GL,
  type TexOptions,
  type Texture,
  type UniformValue,
} from '../gl/gl';
import { Post } from '../post/post';
import { TextLayer } from '../text/text';
import { ease } from './anim';
import { saturate } from './math';
import { DEFAULT_LOOK, type Look, type Project, type Shot, type ShotContext } from './types';

const COPY_FS = `
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uSrc; uniform float uWeight;
void main() { fragColor = vec4(texture(uSrc, vUv).rgb * uWeight, 1.0); }`;

export interface EngineOptions {
  /** Output size; defaults to the project's size. */
  width?: number;
  height?: number;
  /** Disable motion blur (fast previews). */
  noMotionBlur?: boolean;
}

export class Engine {
  gl: GL;
  width: number;
  height: number;
  fps: number;
  pool: TargetPool;
  post!: Post;
  text!: TextLayer;
  blankTexture: Texture;
  sceneRT: RenderTarget;
  accumRT: RenderTarget;
  /** Scale factor relative to the project's authored resolution (for pixel-size-aware shaders). */
  scale: number;
  private tri: WebGLVertexArrayObject;
  private copy: Program;
  private programs = new Map<string, Program>();
  private states = new Map<Shot, unknown>();
  private textures = new Map<string, Promise<Texture>>();
  lastFrameMs = 0;

  constructor(
    public canvas: HTMLCanvasElement,
    public project: Project,
    public opts: EngineOptions = {},
  ) {
    this.width = opts.width ?? project.width;
    this.height = opts.height ?? project.height;
    this.fps = project.fps;
    this.scale = this.height / project.height;
    canvas.width = this.width;
    canvas.height = this.height;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is required');
    gl.getExtension('OES_texture_float_linear');
    gl.getExtension('EXT_float_blend');

    this.tri = createFullscreenTriangle(gl);
    this.pool = new TargetPool(gl);
    this.blankTexture = dataTexture(gl, 1, 1, new Uint8Array([0, 0, 0, 0]), { format: 'rgba8' });
    this.copy = new Program(gl, FULLSCREEN_VS, COPY_FS, 'engine.copy');
    this.sceneRT = new RenderTarget(gl, this.width, this.height, { format: 'rgba16f', depth: true });
    this.accumRT = new RenderTarget(gl, this.width, this.height, { format: 'rgba16f' });
    this.post = new Post(this);
    this.text = new TextLayer(gl, this.width, this.height);
    this.text.items = project.text ?? [];
  }

  get duration() {
    return this.project.duration;
  }
  get frameCount() {
    return Math.round(this.project.duration * this.fps);
  }

  // ------------------------------------------------------------ resources

  /** Compile (once) a full-screen fragment program. `#include <...>` chunks are resolved. */
  program(fragment: string, name = 'shot'): Program {
    const key = 'fs:' + fragment;
    let p = this.programs.get(key);
    if (!p) {
      p = new Program(this.gl, FULLSCREEN_VS, fragment, name);
      this.programs.set(key, p);
    }
    return p;
  }

  /** Compile (once) a program with a custom vertex shader. */
  programVF(vertex: string, fragment: string, name = 'mesh'): Program {
    const key = vertex + '\n//--\n' + fragment;
    let p = this.programs.get(key);
    if (!p) {
      p = new Program(this.gl, vertex, fragment, name);
      this.programs.set(key, p);
    }
    return p;
  }

  texture(url: string, o: TexOptions = {}): Promise<Texture> {
    const key = url + JSON.stringify(o);
    if (!this.textures.has(key)) this.textures.set(key, loadTexture(this.gl, url, o));
    return this.textures.get(key)!;
  }

  target(o: { scale?: number; format?: 'rgba16f' | 'rgba8' | 'rgba32f'; depth?: boolean } = {}) {
    const s = o.scale ?? 1;
    return new RenderTarget(this.gl, Math.max(1, Math.round(this.width * s)), Math.max(1, Math.round(this.height * s)), {
      format: o.format ?? 'rgba16f',
      depth: o.depth,
    });
  }

  drawFullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.tri);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  async load(onProgress?: (msg: string) => void) {
    const fonts = this.project.fonts ?? [];
    if (fonts.length && typeof document !== 'undefined') {
      onProgress?.('fonts');
      await Promise.all(fonts.map((f) => document.fonts.load(f)));
      await document.fonts.ready;
    }
    if (this.project.setup) {
      onProgress?.('project setup');
      await this.project.setup(this);
    }
    for (const shot of this.project.shots) {
      onProgress?.(`setup ${shot.id}`);
      const st = shot.setup ? await shot.setup(this) : undefined;
      this.states.set(shot, st);
    }
  }

  // ------------------------------------------------------------ time model

  look(time: number): Look {
    return { ...DEFAULT_LOOK, ...(this.project.look?.(time) ?? {}) };
  }

  /** Visible picture band (after letterbox) in pixels from the top. */
  band(look: Look) {
    const visible = Math.min(1, this.width / look.letterboxAspect / this.height);
    const bar = ((1 - visible) / 2) * look.letterbox * this.height;
    return { top: bar, bottom: this.height - bar };
  }

  shotWeight(shot: Shot, time: number): number {
    if (time < shot.start || time >= shot.end) return 0;
    let w = 1;
    if (shot.fadeIn && shot.fadeIn > 0) w = Math.min(w, (time - shot.start) / shot.fadeIn);
    if (shot.fadeOut && shot.fadeOut > 0) w = Math.min(w, (shot.end - time) / shot.fadeOut);
    return ease.smooth(saturate(w));
  }

  activeShots(time: number) {
    return this.project.shots
      .map((shot) => ({ shot, w: this.shotWeight(shot, time) }))
      .filter((s) => s.w > 1e-4);
  }

  // ------------------------------------------------------------ rendering

  private makeContext(shot: Shot, time: number, frame: number, target: RenderTarget, band: { top: number; bottom: number }): ShotContext {
    const dur = shot.end - shot.start;
    const t = time - shot.start;
    const gl = this.gl;
    const std = {
      uRes: [this.width, this.height],
      uTime: t,
      uDur: dur,
      uProg: saturate(t / dur),
      uGTime: time,
      uAspect: this.width / this.height,
      uScale: this.scale,
    };
    const scissor = band.top > 1;
    return {
      e: this,
      gl,
      t,
      dur,
      p: saturate(t / dur),
      time,
      frame,
      fps: this.fps,
      width: this.width,
      height: this.height,
      aspect: this.width / this.height,
      target,
      fullscreen: (prog: Program, uniforms: Record<string, UniformValue> = {}) => {
        // uRes always describes the target actually being drawn (half-res passes stay pixel-accurate).
        const bound = bindState.target;
        prog.use().set(std).set({ uRes: bound ? [bound.width, bound.height] : std.uRes }).set(uniforms);
        // Skip pixels hidden behind letterbox bars (keep a margin for bloom).
        const clip = scissor && bindState.target === target;
        if (clip) {
          const m = Math.round(this.height * 0.03);
          const y0 = Math.max(0, Math.floor(band.top) - m);
          gl.enable(gl.SCISSOR_TEST);
          gl.scissor(0, y0, this.width, Math.min(this.height, Math.ceil(band.bottom - band.top) + 2 * m));
        }
        this.drawFullscreen();
        if (clip) gl.disable(gl.SCISSOR_TEST);
      },
    };
  }

  private renderShot(shot: Shot, time: number, frame: number, target: RenderTarget, band: { top: number; bottom: number }) {
    const gl = this.gl;
    target.clear(0, 0, 0, 1);
    setBlend(gl, 'none');
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    shot.render(this.makeContext(shot, time, frame, target, band), this.states.get(shot));
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    setBlend(gl, 'none');
  }

  /** Composite all shots active at `time` into `target` (HDR). */
  renderScene(time: number, frame: number, target: RenderTarget, band: { top: number; bottom: number }) {
    const gl = this.gl;
    const active = this.activeShots(time);
    if (active.length === 1 && active[0].w >= 0.9999) {
      this.renderShot(active[0].shot, time, frame, target, band);
      return;
    }
    const tmp = this.pool.get(this.width, this.height, { format: 'rgba16f', depth: true });
    target.clear(0, 0, 0, 1);
    for (const { shot, w } of active) {
      this.renderShot(shot, time, frame, tmp, band);
      target.bind();
      setBlend(gl, 'add');
      this.copy.use().set({ uSrc: tmp, uWeight: w });
      this.drawFullscreen();
      setBlend(gl, 'none');
    }
    this.pool.release(tmp);
  }

  /**
   * Render frame `frame` to the canvas. With `flipY` the image is stored
   * top-row-first so `readPixels` returns rows in video order.
   */
  renderFrame(frame: number, flipY = false) {
    const t0 = performance.now();
    const time = frame / this.fps;
    const look = this.look(time);
    const band = this.band(look);
    const active = this.activeShots(time);
    let samples = this.opts.noMotionBlur ? 1 : this.project.motionBlur ?? 1;
    for (const a of active) if (a.shot.motionBlur !== undefined && !this.opts.noMotionBlur) samples = Math.max(1, a.shot.motionBlur);
    const shutter = this.project.shutter ?? 0.5;

    let input: RenderTarget;
    if (samples <= 1) {
      this.renderScene(time, frame, this.sceneRT, band);
      input = this.sceneRT;
    } else {
      const gl = this.gl;
      this.accumRT.clear(0, 0, 0, 1);
      for (let k = 0; k < samples; k++) {
        const ts = time + ((k + 0.5) / samples - 0.5) * (shutter / this.fps);
        this.renderScene(ts, frame, this.sceneRT, band);
        this.accumRT.bind();
        setBlend(gl, 'add');
        this.copy.use().set({ uSrc: this.sceneRT, uWeight: 1 / samples });
        this.drawFullscreen();
        setBlend(gl, 'none');
      }
      input = this.accumRT;
    }

    const textTex = this.text.render(time, band);
    this.post.run(input, look, textTex, frame, flipY, null);
    this.lastFrameMs = performance.now() - t0;
  }

  /** Read the canvas back (call right after renderFrame in the same task). */
  readPixels(out?: Uint8Array): Uint8Array {
    const gl = this.gl;
    const buf = out ?? new Uint8Array(this.width * this.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  }
}
