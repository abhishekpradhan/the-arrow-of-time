// Ready-made text items: single captions, stacked title blocks, and a timecode overlay.

import { drawText, lifeOf, type Align, type Layout, type RevealOptions, type TextItem, type TextStyle } from './text';

export interface CaptionOptions {
  start: number;
  end: number;
  text: string;
  style: TextStyle;
  /** Horizontal anchor as a fraction of the frame width. */
  x?: number;
  /** Vertical baseline as a fraction of the visible picture band (0 = top, 1 = bottom). */
  y?: number;
  align?: Align;
  inDur?: number;
  outDur?: number;
  mode?: RevealOptions['mode'];
  blur?: number;
  trackingDrift?: number;
  opacity?: number;
}

export function caption(o: CaptionOptions): TextItem {
  return {
    start: o.start,
    end: o.end,
    draw(ctx, t, L) {
      const life = lifeOf(t, o.start, o.end, o.inDur ?? 1.2, o.outDur ?? 1.0);
      const x = (o.x ?? 0.5) * L.w;
      const y = L.top + (o.y ?? 0.5) * (L.bottom - L.top);
      ctx.globalAlpha = o.opacity ?? 1;
      drawText(ctx, o.text, x, y, o.style, L.s, o.align ?? 'center', {
        inP: life.inP,
        outP: life.outP,
        lifeP: life.lifeP,
        mode: o.mode,
        blur: o.blur,
        trackingDrift: o.trackingDrift,
      });
    },
  };
}

export interface StackLine {
  text: string;
  style: TextStyle;
  /** Seconds after the block's start that this line begins to appear. */
  delay?: number;
  /** Vertical gap before this line in design pixels. */
  gap?: number;
  mode?: RevealOptions['mode'];
  blur?: number;
  trackingDrift?: number;
}

export interface StackOptions {
  start: number;
  end: number;
  lines: StackLine[];
  x?: number;
  /** Baseline of the first line as a fraction of the visible band. */
  y?: number;
  align?: Align;
  inDur?: number;
  outDur?: number;
}

/** A block of lines (e.g. era label / title / subtitle) with staggered entrances and a shared exit. */
export function stack(o: StackOptions): TextItem {
  return {
    start: o.start,
    end: o.end,
    draw(ctx, t, L: Layout) {
      const x = (o.x ?? 0.5) * L.w;
      let y = L.top + (o.y ?? 0.5) * (L.bottom - L.top);
      o.lines.forEach((line, i) => {
        if (i > 0) y += (line.gap ?? line.style.size * 1.4) * L.s;
        const s0 = o.start + (line.delay ?? 0);
        if (t < s0) return;
        const life = lifeOf(t, s0, o.end, o.inDur ?? 1.2, o.outDur ?? 1.0);
        drawText(ctx, line.text, x, y, line.style, L.s, o.align ?? 'center', {
          inP: life.inP,
          outP: life.outP,
          lifeP: life.lifeP,
          mode: line.mode,
          blur: line.blur,
          trackingDrift: line.trackingDrift,
        });
      });
    },
  };
}

/** Small burnt-in timecode (used by stills/contact sheets). */
export function timecode(fps: number): TextItem {
  return {
    start: -1e9,
    end: 1e9,
    draw(ctx, t, L) {
      const s = Math.max(0.5, L.s);
      const mm = Math.floor(t / 60);
      const ss = Math.floor(t % 60);
      const ff = Math.floor((t * fps) % fps + 1e-6);
      const label = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}  ${t.toFixed(2)}s`;
      ctx.font = `600 ${Math.round(22 * s)}px monospace`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const w = ctx.measureText(label).width;
      ctx.fillRect(8 * s, 8 * s, w + 16 * s, 34 * s);
      ctx.fillStyle = '#ffd24a';
      ctx.fillText(label, 16 * s, 14 * s);
    },
  };
}
