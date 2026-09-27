// __TITLE__: starter project. Run `npm run dev` and pick "__ID__" in the preview.
import '@fontsource/cinzel/500.css';
import '@fontsource/jost/400.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import { defineProject, keys, stack, type TextItem, type TextStyle } from '@engine';
import T from './timeline.json';
import { nebulaShot, starsShot } from './shots/example';

const era: TextStyle = { family: 'Jost', size: 22, tracking: 0.42, uppercase: true, color: '#eadfcd' };
const title: TextStyle = {
  family: 'Cinzel',
  weight: 500,
  size: 64,
  tracking: 0.16,
  uppercase: true,
  glow: { color: 'rgba(255,214,170,0.2)', blur: 26 },
};
const line: TextStyle = { family: 'Cormorant Garamond', italic: true, size: 36, color: '#f3ece1' };

// Captions come straight from timeline.json, so retiming a beat moves its text too.
const text: TextItem[] = T.beats
  .filter((b) => b.card === 'chapter' || b.card === 'title')
  .map((b) => {
    const beat = b as typeof b & { era?: string; line?: string };
    return stack({
      start: beat.start + 0.6,
      end: beat.end - 0.3,
      y: beat.card === 'title' ? 0.5 : 0.78,
      lines: [
        ...(beat.era ? [{ text: beat.era, style: era }] : []),
        { text: beat.title ?? '', style: title, delay: 0.3, gap: beat.era ? 66 : 0, mode: 'letters' as const },
        ...(beat.line ? [{ text: beat.line, style: line, delay: 1.0, gap: 58 }] : []),
      ],
    });
  });

export default defineProject({
  id: '__ID__',
  title: '__TITLE__',
  width: 1920,
  height: 1080,
  fps: T.fps,
  duration: T.duration,
  audio: '/out/__ID__/audio/score.wav',
  fonts: ['500 64px Cinzel', '400 22px Jost', 'italic 400 36px "Cormorant Garamond"'],
  shots: [nebulaShot(), starsShot()],
  text,
  markers: Object.entries(T.cues).map(([label, t]) => ({ t, label })),
  look: (t) => ({
    // Cinematic 2.39:1 bars that open to full frame on the hit.
    letterbox: keys(t, [[0, 1], [T.cues.hit - 0.3, 1], [T.cues.hit + 0.5, 0, 'inOutCubic']]),
    flash: t >= T.cues.hit ? 0.8 * Math.exp(-(t - T.cues.hit) * 3) : 0,
    fade: keys(t, [[0, 0], [1.5, 1], [T.duration - 2, 1], [T.duration, 0]]),
    bloom: 0.08,
    grain: 0.035,
    vignette: 0.3,
    streak: 0.12,
    streakThreshold: 2.5,
  }),
});
