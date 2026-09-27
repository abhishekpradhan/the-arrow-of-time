// Typography layer: items draw with Canvas2D at output resolution each frame (glyphs come
// from a sub-pixel sprite cache, see GlyphCache), then the canvas is uploaded once and
// composited (after tonemapping) by Post.
//
// All sizes are authored in "design pixels" for a 1080-pixel-tall frame and
// scaled automatically, so previews at lower resolution keep the same layout.

import { dataTexture, type GL, type Texture } from '../gl/gl';
import { clamp, saturate } from '../core/math';
import { ease, type EaseName } from '../core/anim';

export interface Layout {
  /** Output size in pixels. */
  w: number;
  h: number;
  /** Design-pixel scale (h / 1080). */
  s: number;
  /** Visible picture band after letterboxing, in output pixels. */
  top: number;
  bottom: number;
  time: number;
}

export interface TextItem {
  start: number;
  end: number;
  draw(ctx: CanvasRenderingContext2D, t: number, L: Layout): void;
}

export class TextLayer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: Texture | null = null;
  items: TextItem[] = [];

  constructor(private gl: GL, public width: number, public height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    // CPU raster: on software-GL renderers, GPU canvas blur filters cost seconds per frame.
    this.ctx = this.canvas.getContext('2d', { alpha: true, willReadFrequently: true })!;
  }

  /** Draw all active items. Returns the uploaded texture, or null if nothing is on screen. */
  render(time: number, band: { top: number; bottom: number }): Texture | null {
    const active = this.items.filter((it) => time >= it.start && time < it.end);
    if (!active.length) return null;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const L: Layout = { w: this.width, h: this.height, s: this.height / 1080, top: band.top, bottom: band.bottom, time };
    for (const it of active) {
      ctx.save();
      it.draw(ctx, time, L);
      ctx.restore();
    }
    const gl = this.gl;
    if (!this.texture) this.texture = dataTexture(gl, this.width, this.height, null, { format: 'rgba8', filter: 'linear' });
    // Premultiplied upload, flipped so row 0 is the bottom (matches vUv).
    gl.bindTexture(gl.TEXTURE_2D, this.texture.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    return this.texture;
  }
}

// --------------------------------------------------------------- typesetting

export interface TextStyle {
  family: string;
  weight?: number | string;
  italic?: boolean;
  /** Size in design pixels (1080p). */
  size: number;
  /** Letter spacing in em. */
  tracking?: number;
  color?: string;
  glow?: { color: string; blur: number; strength?: number };
  shadow?: { color: string; blur: number };
  uppercase?: boolean;
}

export function fontString(st: TextStyle, s: number) {
  return `${st.italic ? 'italic ' : ''}${st.weight ?? 400} ${Math.max(1, st.size * s).toFixed(2)}px "${st.family}"`;
}

export type Align = 'left' | 'center' | 'right';

// --------------------------------------------------------------- sub-pixel glyphs

/** Sub-pixel phases per pixel (and the supersampling factor used to rasterize each phase). */
const PHASES = 4;

interface GlyphSprite {
  canvas: HTMLCanvasElement;
  /** Offset from the pen's whole-pixel position to the sprite's top-left, in pixels. */
  ox: number;
  oy: number;
}

interface Coverage {
  /** Antialiased coverage 0..1, w x h, row-major. */
  a: Float32Array;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

/**
 * Canvas2D snaps every fillText origin (and every shadow offset) to whole pixels, measured in
 * headless Chromium, so text that drifts or eases by fractions of a pixel per frame moves in
 * one-pixel steps, letter by letter: jitter. Instead, each glyph is rasterized at PHASES x
 * size, where every quarter-pixel offset is a whole pixel, and box-filtered down to a coverage
 * mask. Blurred passes (shadows, glows, blur-in reveals) blur that mask in JS (three box blurs
 * approximate a Gaussian), because drawImage with shadowBlur is ~60x slower than fillText.
 * Sprites are cached per glyph, font, phase, colour and blur, and drawn at whole pixels, so
 * motion is smooth to 1/4 px and sharpness never changes as text moves.
 */
class GlyphCache {
  private coverage = new Map<string, Coverage>();
  private sprites = new Map<string, GlyphSprite>();
  private big = document.createElement('canvas');
  private bctx = this.big.getContext('2d', { willReadFrequently: true })!;

  get(ch: string, font: string, color: string, fx: number, fy: number, sigma: number): GlyphSprite {
    const key = `${font}|${ch}|${fx}|${fy}|${color}|${sigma}`;
    let sp = this.sprites.get(key);
    if (!sp) {
      if (this.sprites.size > 8000) this.sprites.clear();
      sp = this.sprite(this.cover(ch, font, fx, fy), color, sigma);
      this.sprites.set(key, sp);
    }
    return sp;
  }

  private cover(ch: string, font: string, fx: number, fy: number): Coverage {
    const key = `${font}|${ch}|${fx}|${fy}`;
    let c = this.coverage.get(key);
    if (c) return c;
    if (this.coverage.size > 4000) this.coverage.clear();
    const N = PHASES;
    const bigFont = font.replace(/([0-9.]+)px/, (_, n) => `${(parseFloat(n) * N).toFixed(2)}px`);
    const b = this.bctx;
    b.font = bigFont;
    const m = b.measureText(ch);
    // Mask bounds in output pixels relative to the pen's whole-pixel position (+1 px margin).
    const x0 = Math.floor(-m.actualBoundingBoxLeft / N) - 1;
    const x1 = Math.ceil((m.actualBoundingBoxRight + fx) / N) + 1;
    const y0 = Math.floor(-m.actualBoundingBoxAscent / N) - 1;
    const y1 = Math.ceil((m.actualBoundingBoxDescent + fy) / N) + 1;
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    this.big.width = w * N;
    this.big.height = h * N;
    b.font = bigFont;
    b.fillStyle = '#fff';
    b.textBaseline = 'alphabetic';
    b.textAlign = 'left';
    // Integer pen position in the supersampled grid: nothing for Canvas2D to snap.
    b.fillText(ch, fx - x0 * N, fy - y0 * N);
    const src = b.getImageData(0, 0, w * N, h * N).data;
    const a = new Float32Array(w * h);
    const stride = w * N * 4;
    const inv = 1 / (255 * N * N);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let sy = 0; sy < N; sy++) {
          let i = (y * N + sy) * stride + x * N * 4 + 3;
          for (let sx = 0; sx < N; sx++, i += 4) sum += src[i];
        }
        a[y * w + x] = sum * inv;
      }
    }
    c = { a, w, h, ox: x0, oy: y0 };
    this.coverage.set(key, c);
    return c;
  }

  private sprite(c: Coverage, color: string, sigma: number): GlyphSprite {
    let { a, w, h, ox, oy } = c;
    if (sigma > 0) {
      const pad = Math.ceil(sigma * 3) + 1;
      const W = w + 2 * pad, H = h + 2 * pad;
      const buf = new Float32Array(W * H);
      for (let y = 0; y < h; y++) buf.set(a.subarray(y * w, y * w + w), (y + pad) * W + pad);
      gaussianBlur(buf, W, H, sigma);
      a = buf;
      w = W;
      h = H;
      ox -= pad;
      oy -= pad;
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let i = 0; i < w * h; i++) {
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255;
      d[i * 4 + 3] = a[i] * 255 + 0.5;
    }
    ctx.putImageData(img, 0, 0);
    // Tint with the canvas's own colour parsing (any CSS colour, including its alpha).
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    return { canvas, ox, oy };
  }
}

/** In-place Gaussian blur approximated by three box blurs (Kutskir's box sizes). */
function gaussianBlur(buf: Float32Array, w: number, h: number, sigma: number) {
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const tmp = new Float32Array(buf.length);
  for (let i = 0; i < n; i++) {
    const r = ((i < m ? wl : wl + 2) - 1) / 2;
    boxBlurH(buf, tmp, w, h, r);
    boxBlurV(tmp, buf, w, h, r);
  }
}

function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += x >= 0 && x < w ? src[row + x] : 0;
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * inv;
      const add = x + r + 1, sub = x - r;
      if (add < w) acc += src[row + add];
      if (sub >= 0) acc -= src[row + sub];
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += y >= 0 && y < h ? src[y * w + x] : 0;
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * inv;
      const add = y + r + 1, sub = y - r;
      if (add < h) acc += src[add * w + x];
      if (sub >= 0) acc -= src[sub * w + x];
    }
  }
}

let glyphCache: GlyphCache | null = null;

/** Blur sigmas are cached at fine steps where the eye can tell them apart, coarser above. */
function quantizeSigma(sigma: number) {
  if (sigma < 0.25) return 0;
  if (sigma < 2) return Math.round(sigma * 4) / 4;
  if (sigma < 6) return Math.round(sigma * 2) / 2;
  return Math.round(sigma);
}

/**
 * Draw one glyph with its alphabetic-baseline pen at (x, y), positioned to 1/PHASES px,
 * optionally blurred (sigma in pixels, the Canvas2D shadowBlur / 2 convention).
 */
export function drawGlyph(ctx: CanvasRenderingContext2D, ch: string, font: string, color: string, x: number, y: number, sigma = 0) {
  glyphCache ??= new GlyphCache();
  let ix = Math.floor(x), fx = Math.round((x - ix) * PHASES);
  let iy = Math.floor(y), fy = Math.round((y - iy) * PHASES);
  if (fx === PHASES) (ix++, (fx = 0));
  if (fy === PHASES) (iy++, (fy = 0));
  const sp = glyphCache.get(ch, font, color, fx, fy, quantizeSigma(sigma));
  ctx.drawImage(sp.canvas, ix + sp.ox, iy + sp.oy);
}

interface Glyph {
  ch: string;
  x: number;
  dy: number;
  font: string;
}

/** Split "10^−32 seconds" into runs; `^` marks a superscript run of sign + digits (or ^{...}). */
export function parseRich(text: string): { text: string; sup: boolean }[] {
  const runs: { text: string; sup: boolean }[] = [];
  const re = /\^\{([^}]*)\}|\^([\u2212\-+]?[0-9.]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), sup: false });
    runs.push({ text: (m[1] ?? m[2]).replace('-', '\u2212'), sup: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), sup: false });
  return runs;
}

/**
 * Lay out glyphs with kerning preserved (prefix measurement per run), tracking in px,
 * and superscript runs at 62% size raised by 0.42em.
 */
export function layoutGlyphs(ctx: CanvasRenderingContext2D, text: string, st: TextStyle, s: number, trackingPx: number) {
  ctx.letterSpacing = '0px';
  const glyphs: Glyph[] = [];
  let x = 0;
  const size = st.size * s;
  for (const run of parseRich(text)) {
    const str = st.uppercase && !run.sup ? run.text.toUpperCase() : run.text;
    const font = fontString({ ...st, size: run.sup ? st.size * 0.62 : st.size }, s);
    ctx.font = font;
    const dy = run.sup ? -size * 0.42 : 0;
    const tr = run.sup ? trackingPx * 0.5 : trackingPx;
    for (let i = 0; i < str.length; i++) {
      glyphs.push({ ch: str[i], x: x + ctx.measureText(str.slice(0, i)).width + i * tr, dy, font });
    }
    x += ctx.measureText(str).width + str.length * tr;
  }
  const width = Math.max(0, x - trackingPx);
  return { glyphs, width };
}

export interface RevealOptions {
  /** 0..1 progress of the entrance animation. */
  inP: number;
  /** 0..1 progress of the exit animation. */
  outP: number;
  mode?: 'fade' | 'blur' | 'letters' | 'rise' | 'wipe';
  /** Blur radius (design px) at the start of a blur entrance. */
  blur?: number;
  /** Extra tracking (em) added over the full life of the text: slow, cinematic "breathing". */
  trackingDrift?: number;
  /** Life progress 0..1 (for tracking drift). */
  lifeP?: number;
}

/**
 * Draw a styled single-line string with an entrance/exit animation.
 * (x, y) is the alphabetic baseline anchor in output pixels.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  st: TextStyle,
  s: number,
  align: Align = 'center',
  r: RevealOptions = { inP: 1, outP: 0 },
) {
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const size = st.size * s;
  const tracking = ((st.tracking ?? 0) + (r.trackingDrift ?? 0) * (r.lifeP ?? 0)) * size;
  const { glyphs, width } = layoutGlyphs(ctx, text, st, s, tracking);
  const x0 = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  const mode = r.mode ?? 'blur';
  const outA = 1 - ease.inOutSine(saturate(r.outP));
  const color = st.color ?? '#fff';

  // Every pass draws cached glyph sprites (see GlyphCache): sub-pixel exact, blurred in JS.
  const drawAll = (alpha: number, blurPx: number, dy: number, glyphFn?: (i: number) => { a: number; b: number; dy: number }) => {
    const passes: { color: string; blur: number; alpha: number }[] = [];
    if (st.shadow) passes.push({ color: st.shadow.color, blur: st.shadow.blur * s, alpha: 1 });
    if (st.glow) passes.push({ color: st.glow.color, blur: st.glow.blur * s, alpha: st.glow.strength ?? 1 });
    passes.push({ color: '', blur: 0, alpha: 1 });
    for (const pass of passes) {
      for (let i = 0; i < glyphs.length; i++) {
        const gl = glyphs[i];
        if (gl.ch === ' ') continue;
        const g = glyphFn ? glyphFn(i) : { a: 1, b: 0, dy: 0 };
        const a = alpha * g.a * pass.alpha;
        if (a <= 0.002) continue;
        const b = blurPx + g.b;
        ctx.globalAlpha = clamp(a, 0, 1);
        const gx = x0 + gl.x, gy = y + dy + g.dy + gl.dy;
        const fill = pass.color || color;
        const passBlur = pass.color ? pass.blur : 0;
        const total = Math.hypot(passBlur, b * 2); // shadowBlur ~ 2 sigma; blurs add in quadrature
        drawGlyph(ctx, gl.ch, gl.font, fill, gx, gy, total > 0.5 ? total / 2 : 0);
      }
    }
    ctx.globalAlpha = 1;
  };

  const inP = saturate(r.inP);
  if (mode === 'letters') {
    const n = glyphs.length;
    drawAll(outA, (r.blur ?? 0) * s * saturate(r.outP), 0, (i) => {
      const local = saturate(inP * (1 + n * 0.12) - i * 0.12);
      const e = ease.outCubic(local);
      return { a: e, b: (1 - e) * (r.blur ?? 8) * s, dy: (1 - e) * size * 0.15 };
    });
  } else if (mode === 'rise') {
    const e = ease.outCubic(inP);
    drawAll(e * outA, 0, (1 - e) * size * 0.4);
  } else if (mode === 'fade') {
    drawAll(ease.inOutSine(inP) * outA, 0, 0);
  } else if (mode === 'wipe') {
    ctx.save();
    const e = ease.inOutCubic(inP);
    ctx.beginPath();
    ctx.rect(x0 - size, y - size * 1.5, (width + size * 2) * e, size * 3);
    ctx.clip();
    drawAll(outA, 0, 0);
    ctx.restore();
  } else {
    const e = ease.outCubic(inP);
    const bl = (1 - e) * (r.blur ?? 14) * s + ease.inCubic(saturate(r.outP)) * (r.blur ?? 14) * s;
    drawAll(ease.inOutSine(inP) * outA, bl, 0);
  }
  return { width, x0 };
}

/** Timing helper: entrance / exit progress for an item living in [start, end]. */
export function lifeOf(t: number, start: number, end: number, inDur: number, outDur: number) {
  return {
    inP: saturate((t - start) / Math.max(inDur, 1e-3)),
    outP: saturate((t - (end - outDur)) / Math.max(outDur, 1e-3)),
    lifeP: saturate((t - start) / (end - start)),
    local: t - start,
  };
}

export { ease };
export type { EaseName };
