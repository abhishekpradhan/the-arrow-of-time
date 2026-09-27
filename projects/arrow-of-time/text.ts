// Typography for The Arrow of Time: every caption is generated from timeline.json.
import { drawText, ease, lifeOf, type TextItem, type TextStyle } from '@engine';
import T from './timeline.json';

export const STYLE = {
  era: {
    family: 'Jost',
    weight: 400,
    size: 22,
    tracking: 0.42,
    uppercase: true,
    color: '#eadfcd',
    shadow: { color: 'rgba(0,0,0,0.72)', blur: 14 },
  },
  title: {
    family: 'Cinzel',
    weight: 500,
    size: 58,
    tracking: 0.16,
    uppercase: true,
    color: '#ffffff',
    shadow: { color: 'rgba(0,0,0,0.49)', blur: 24 },
    glow: { color: 'rgba(255,214,170,0.2)', blur: 26, strength: 0.8 },
  },
  line: {
    family: 'Cormorant Garamond',
    weight: 500,
    italic: true,
    size: 35,
    tracking: 0.02,
    color: '#f3ece1',
    shadow: { color: 'rgba(0,0,0,0.81)', blur: 16 },
  },
  whisper: {
    family: 'Cormorant Garamond',
    weight: 400,
    italic: true,
    size: 44,
    tracking: 0.03,
    color: '#efe7da',
    glow: { color: 'rgba(255,230,200,0.06)', blur: 18 },
  },
  main: {
    family: 'Cinzel',
    weight: 500,
    size: 92,
    tracking: 0.2,
    uppercase: true,
    color: '#ffffff',
    shadow: { color: 'rgba(40,10,0,0.3)', blur: 40 },
    glow: { color: 'rgba(255,200,140,0.3)', blur: 36 },
  },
} satisfies Record<string, TextStyle>;

/** Where a chapter card sits: a preset name, or a preset with its anchor moved. */
export type LayoutSpec = Anchor | { at?: Anchor; x?: number; y?: number };
export type Anchor = 'lower' | 'lower-left' | 'lower-right' | 'left' | 'right' | 'upper-left' | 'upper-right' | 'upper' | 'center';

type Beat = (typeof T.beats)[number] & {
  era?: string;
  title?: string;
  line?: string;
  layout?: LayoutSpec;
  /** Seconds to hold the card back (let an event play before the text arrives). */
  captionDelay?: number;
  /** Fast cards; each may override the beat's `layout` to sit clear of its scene. */
  montage?: { t: number; year?: number; era: string; title: string; layout?: LayoutSpec }[];
};

export interface Place {
  /** Anchor in caption space: x 0..1 across the frame, y 0..1 down the visible picture. */
  x: number;
  y: number;
  align: 'left' | 'center' | 'right';
  /** Which part of the text block sits on the anchor. */
  v: 'top' | 'middle' | 'bottom';
}

/** Side margins sit on a 1/12 grid, just inside title-safe. */
const PLACES: Record<Anchor, Place> = {
  lower: { x: 0.5, y: 0.86, align: 'center', v: 'bottom' },
  'lower-left': { x: 0.083, y: 0.84, align: 'left', v: 'bottom' },
  'lower-right': { x: 0.917, y: 0.84, align: 'right', v: 'bottom' },
  left: { x: 0.083, y: 0.5, align: 'left', v: 'middle' },
  right: { x: 0.917, y: 0.5, align: 'right', v: 'middle' },
  'upper-left': { x: 0.083, y: 0.16, align: 'left', v: 'top' },
  'upper-right': { x: 0.917, y: 0.16, align: 'right', v: 'top' },
  upper: { x: 0.5, y: 0.16, align: 'center', v: 'top' },
  center: { x: 0.5, y: 0.5, align: 'center', v: 'middle' },
};

export function placeOf(spec: LayoutSpec | undefined): Place {
  if (!spec) return PLACES.lower;
  if (typeof spec === 'string') return PLACES[spec];
  const base = PLACES[spec.at ?? 'lower'];
  return { ...base, x: spec.x ?? base.x, y: spec.y ?? base.y };
}

/** Scrim ellipse (caption space) that sits behind a card placed at `p`. */
export function scrimFor(p: Place): { center: [number, number]; radius: [number, number] } {
  if (p.align === 'center' && p.v === 'bottom') return { center: [0.5, 1.0], radius: [1.1, 0.42] };
  const cx = p.align === 'left' ? p.x + 0.15 : p.align === 'right' ? p.x - 0.15 : p.x;
  const cy = p.v === 'top' ? p.y + 0.1 : p.v === 'bottom' ? p.y - 0.1 : p.y;
  return { center: [cx, cy], radius: p.align === 'center' ? [0.5, 0.34] : [0.36, 0.42] };
}

/**
 * Era label / title / line, staggered in, sharing one exit, placed by the beat's `layout`.
 * Side-aligned cards drift a few pixels toward the centre over their life.
 */
function chapter(b: Beat): TextItem {
  const start = b.start + 0.5 + (b.captionDelay ?? 0);
  const end = b.end - 0.25;
  const place = placeOf(b.layout);
  const lines: { text: string; style: TextStyle; delay: number; gap: number; mode: 'blur' | 'letters' | 'fade' }[] = [];
  if (b.era) lines.push({ text: b.era, style: STYLE.era, delay: 0, gap: 0, mode: 'blur' });
  if (b.title) lines.push({ text: b.title, style: STYLE.title, delay: b.era ? 0.35 : 0, gap: b.era ? 66 : 0, mode: 'letters' });
  if (b.line) lines.push({ text: b.line, style: STYLE.line, delay: b.title ? 1.1 : 0.6, gap: b.title ? 58 : b.era ? 54 : 0, mode: 'blur' });
  // Baselines relative to the first line, and the block's ink extent (design px).
  const baselines: number[] = [];
  lines.reduce((y, l) => (baselines.push(y + l.gap), y + l.gap), 0);
  const top = baselines[0] - lines[0].style.size * 0.74;
  const bottom = baselines[baselines.length - 1] + lines[lines.length - 1].style.size * 0.24;
  const anchorOffset = place.v === 'top' ? top : place.v === 'bottom' ? baselines[baselines.length - 1] : (top + bottom) / 2;
  const side = place.align !== 'center';
  return {
    start,
    end,
    draw(ctx, t, L) {
      const life0 = lifeOf(t, start, end, 1.1, 0.9);
      const drift = side ? (place.align === 'left' ? 1 : -1) * 9 * L.s * ease.inOutSine(life0.lifeP) : 0;
      const x = place.x * L.w + drift;
      const y0 = L.top + place.y * (L.bottom - L.top) - anchorOffset * L.s;
      lines.forEach((l, i) => {
        const s0 = start + l.delay;
        if (t < s0) return;
        const y = y0 + baselines[i] * L.s;
        const life = lifeOf(t, s0, end, l.mode === 'letters' ? 1.6 : 1.1, 0.9);
        drawText(ctx, l.text, x, y, l.style, L.s, place.align, {
          inP: life.inP,
          outP: life.outP,
          lifeP: life.lifeP,
          mode: l.mode,
          blur: l.mode === 'letters' ? 10 : 12,
          trackingDrift: l.style === STYLE.title ? 0.04 : 0.02,
        });
      });
    },
  };
}

/** Fast date/title flashes for the civilization montage. */
function montage(b: Beat): TextItem[] {
  const m = b.montage ?? [];
  return m.map((it, i) => {
    const at = placeOf((it.layout ?? b.layout) as LayoutSpec | undefined);
    const next = i + 1 < m.length ? m[i + 1].t : b.end;
    const start = it.t;
    const end = next - 0.02;
    const inDur = Math.min(0.35, (end - start) * 0.3);
    const outDur = Math.min(0.3, (end - start) * 0.25);
    return {
      start,
      end,
      draw(ctx, t, L) {
        const life = lifeOf(t, start, end, inDur, outDur);
        // The era sits 66 px above the title's baseline; the pair is anchored by the beat's layout.
        const y = L.top + at.y * (L.bottom - L.top);
        const base = at.v === 'top' ? y + 66 * L.s + 44 * L.s : at.v === 'middle' ? y + 33 * L.s : y;
        const x = at.x * L.w;
        drawText(ctx, it.era, x, base - 66 * L.s, STYLE.era, L.s, at.align, { inP: life.inP, outP: life.outP, mode: 'fade' });
        drawText(ctx, it.title, x, base, STYLE.title, L.s, at.align, {
          inP: life.inP,
          outP: life.outP,
          lifeP: life.lifeP,
          mode: 'blur',
          blur: 8,
          trackingDrift: 0.06,
        });
      },
    };
  });
}

function whisper(start: number, end: number, text: string, y = 0.52): TextItem {
  return {
    start,
    end,
    draw(ctx, t, L) {
      const life = lifeOf(t, start, end, 1.4, 1.2);
      drawText(ctx, text, L.w / 2, L.top + y * (L.bottom - L.top), STYLE.whisper, L.s, 'center', {
        inP: life.inP,
        outP: life.outP,
        lifeP: life.lifeP,
        mode: 'blur',
        blur: 16,
        trackingDrift: 0.03,
      });
    },
  };
}

function mainTitle(start: number, end: number, text: string): TextItem {
  return {
    start,
    end,
    draw(ctx, t, L) {
      const life = lifeOf(t, start, end, 2.6, 1.8);
      drawText(ctx, text, L.w / 2, L.top + 0.54 * (L.bottom - L.top), STYLE.main, L.s, 'center', {
        inP: life.inP,
        outP: life.outP,
        lifeP: life.lifeP,
        mode: 'letters',
        blur: 18,
        trackingDrift: 0.08,
      });
    },
  };
}

/** The film's signature: a hairline arrow that draws itself left to right beneath the title. */
function arrowLine(start: number, end: number, y = 0.63): TextItem {
  return {
    start,
    end,
    draw(ctx, t, L) {
      const life = lifeOf(t, start, end, 2.2, 1.6);
      const grow = ease.inOutCubic(life.inP);
      const alpha = 1 - ease.inOutSine(life.outP);
      if (grow <= 0 || alpha <= 0) return;
      const w = 520 * L.s;
      const x0 = L.w / 2 - w / 2;
      const x1 = x0 + w * grow;
      const yy = L.top + y * (L.bottom - L.top);
      ctx.globalAlpha = alpha;
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, 'rgba(255,230,200,0)');
      g.addColorStop(0.35, 'rgba(255,230,200,0.55)');
      g.addColorStop(1, 'rgba(255,240,220,0.95)');
      ctx.strokeStyle = g;
      ctx.lineWidth = Math.max(1, 1.4 * L.s);
      ctx.beginPath();
      ctx.moveTo(x0, yy);
      ctx.lineTo(x1, yy);
      ctx.stroke();
      // Arrowhead with a soft glow.
      const h = 9 * L.s;
      ctx.shadowColor = 'rgba(255,200,150,0.9)';
      ctx.shadowBlur = 14 * L.s;
      ctx.strokeStyle = 'rgba(255,245,230,1)';
      ctx.beginPath();
      ctx.moveTo(x1 - h, yy - h * 0.6);
      ctx.lineTo(x1, yy);
      ctx.lineTo(x1 - h, yy + h * 0.6);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    },
  };
}

/** The end credit: small tracked capitals under the title's arrow. */
function credit(start: number, end: number, text: string): TextItem {
  return {
    start,
    end,
    draw(ctx, t, L) {
      const life = lifeOf(t, start, end, 1.4, 1.2);
      drawText(ctx, text, L.w / 2, L.top + 0.7 * (L.bottom - L.top), STYLE.era, L.s, 'center', {
        inP: life.inP,
        outP: life.outP,
        lifeP: life.lifeP,
        mode: 'blur',
        blur: 8,
        trackingDrift: 0.03,
      });
    },
  };
}

export function buildText(): TextItem[] {
  const items: TextItem[] = [];
  for (const b of T.beats as Beat[]) {
    if (b.card === 'chapter') items.push(chapter(b));
    else if (b.card === 'montage') items.push(...montage(b));
    else if (b.card === 'whisper' && b.line) items.push(whisper(b.start + 0.6, b.end - 0.2, b.line, b.layout ? placeOf(b.layout).y : undefined));
  }
  for (const l of T.prologueLines) items.push(whisper(l.start, l.end, l.text));
  for (const l of T.epilogueLines) items.push(whisper(l.start, l.end, l.text));
  for (const c of T.titleCards as { start: number; end: number; text: string; credit?: string }[]) {
    items.push(mainTitle(c.start, c.end, c.text));
    items.push(arrowLine(c.start + 1.2, c.end));
    if (c.credit) items.push(credit(c.start + 2.0, c.end, c.credit));
  }
  return items;
}
