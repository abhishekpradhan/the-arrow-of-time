// Typography layer: items draw with Canvas2D at output resolution each frame,
// then the canvas is uploaded once and composited (after tonemapping) by Post.
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

  // Blur is rendered with Canvas2D's shadow path (glyph drawn off-canvas, only its blurred
  // shadow lands in frame): it is an order of magnitude faster than ctx.filter = 'blur()'.
  const OFF = 20000;
  const drawAll = (alpha: number, blurPx: number, dy: number, glyphFn?: (i: number) => { a: number; b: number; dy: number }) => {
    const passes: { color: string; blur: number; alpha: number }[] = [];
    if (st.shadow) passes.push({ color: st.shadow.color, blur: st.shadow.blur * s, alpha: 1 });
    if (st.glow) passes.push({ color: st.glow.color, blur: st.glow.blur * s, alpha: st.glow.strength ?? 1 });
    passes.push({ color: '', blur: 0, alpha: 1 });
    ctx.filter = 'none';
    for (const pass of passes) {
      for (let i = 0; i < glyphs.length; i++) {
        const gl = glyphs[i];
        if (gl.ch === ' ') continue;
        const g = glyphFn ? glyphFn(i) : { a: 1, b: 0, dy: 0 };
        const a = alpha * g.a * pass.alpha;
        if (a <= 0.002) continue;
        const b = blurPx + g.b;
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.font = gl.font;
        const gx = x0 + gl.x, gy = y + dy + g.dy + gl.dy;
        const fill = pass.color || color;
        const passBlur = pass.color ? pass.blur : 0;
        const total = Math.hypot(passBlur, b * 2); // shadowBlur ~ 2 sigma; blurs add in quadrature
        if (total > 0.5) {
          ctx.shadowColor = fill;
          ctx.shadowBlur = total;
          ctx.shadowOffsetX = OFF;
          ctx.shadowOffsetY = 0;
          ctx.fillStyle = fill;
          ctx.fillText(gl.ch, gx - OFF, gy);
        } else {
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.fillStyle = fill;
          ctx.fillText(gl.ch, gx, gy);
        }
      }
    }
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowColor = 'transparent';
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
