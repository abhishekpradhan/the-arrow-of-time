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
    shadow: { color: 'rgba(0,0,0,0.85)', blur: 14 },
  },
  title: {
    family: 'Cinzel',
    weight: 500,
    size: 58,
    tracking: 0.16,
    uppercase: true,
    color: '#ffffff',
    shadow: { color: 'rgba(0,0,0,0.7)', blur: 24 },
    glow: { color: 'rgba(255,214,170,0.45)', blur: 26, strength: 0.8 },
  },
  line: {
    family: 'Cormorant Garamond',
    weight: 500,
    italic: true,
    size: 35,
    tracking: 0.02,
    color: '#f3ece1',
    shadow: { color: 'rgba(0,0,0,0.9)', blur: 16 },
  },
  whisper: {
    family: 'Cormorant Garamond',
    weight: 400,
    italic: true,
    size: 44,
    tracking: 0.03,
    color: '#efe7da',
    glow: { color: 'rgba(255,230,200,0.25)', blur: 18 },
  },
  main: {
    family: 'Cinzel',
    weight: 500,
    size: 92,
    tracking: 0.2,
    uppercase: true,
    color: '#ffffff',
    shadow: { color: 'rgba(40,10,0,0.55)', blur: 40 },
    glow: { color: 'rgba(255,200,140,0.55)', blur: 36 },
  },
} satisfies Record<string, TextStyle>;

type Beat = (typeof T.beats)[number] & { era?: string; title?: string; line?: string; montage?: { t: number; era: string; title: string }[] };

/** Era label / title / line, staggered in, sharing one exit. Anchored in the lower third. */
function chapter(b: Beat): TextItem {
  const start = b.start + 0.5;
  const end = b.end - 0.25;
  const lines: { text: string; style: TextStyle; delay: number; gap: number; mode: 'blur' | 'letters' | 'fade' }[] = [];
  if (b.era) lines.push({ text: b.era, style: STYLE.era, delay: 0, gap: 0, mode: 'blur' });
  if (b.title) lines.push({ text: b.title, style: STYLE.title, delay: b.era ? 0.35 : 0, gap: b.era ? 66 : 0, mode: 'letters' });
  if (b.line) lines.push({ text: b.line, style: STYLE.line, delay: b.title ? 1.1 : 0.6, gap: b.title ? 58 : b.era ? 54 : 0, mode: 'blur' });
  const total = lines.reduce((a, l) => a + l.gap, 0);
  return {
    start,
    end,
    draw(ctx, t, L) {
      // Keep the block's bottom line at a fixed height regardless of how many lines it has.
      let y = L.top + 0.86 * (L.bottom - L.top) - total * L.s;
      for (const l of lines) {
        y += l.gap * L.s;
        const s0 = start + l.delay;
        if (t < s0) continue;
        const life = lifeOf(t, s0, end, l.mode === 'letters' ? 1.6 : 1.1, 0.9);
        drawText(ctx, l.text, L.w / 2, y, l.style, L.s, 'center', {
          inP: life.inP,
          outP: life.outP,
          lifeP: life.lifeP,
          mode: l.mode,
          blur: l.mode === 'letters' ? 10 : 12,
          trackingDrift: l.style === STYLE.title ? 0.04 : 0.02,
        });
      }
    },
  };
}

/** Fast date/title flashes for the civilization montage. */
function montage(b: Beat): TextItem[] {
  const m = b.montage ?? [];
  return m.map((it, i) => {
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
        const base = L.top + 0.86 * (L.bottom - L.top);
        drawText(ctx, it.era, L.w / 2, base - 66 * L.s, STYLE.era, L.s, 'center', { inP: life.inP, outP: life.outP, mode: 'fade' });
        drawText(ctx, it.title, L.w / 2, base, STYLE.title, L.s, 'center', {
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

export function buildText(): TextItem[] {
  const items: TextItem[] = [];
  for (const b of T.beats as Beat[]) {
    if (b.card === 'chapter') items.push(chapter(b));
    else if (b.card === 'montage') items.push(...montage(b));
    else if (b.card === 'whisper' && b.line) items.push(whisper(b.start + 0.6, b.end - 0.2, b.line));
  }
  for (const l of T.prologueLines) items.push(whisper(l.start, l.end, l.text));
  for (const l of T.epilogueLines) items.push(whisper(l.start, l.end, l.text));
  for (const c of T.titleCards) {
    items.push(mainTitle(c.start, c.end, c.text));
    items.push(arrowLine(c.start + 1.2, c.end));
  }
  return items;
}
