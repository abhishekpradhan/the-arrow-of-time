// THE ARROW OF TIME: the history and future of everything, from the first instant to the last.
import '@fontsource/cinzel/500.css';
import '@fontsource/jost/400.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import { defineProject, keys, shake, type Look, type Vec3 } from '@engine';
import T from './timeline.json';
import { cues } from './lib';
import { buildText, placeOf, scrimFor, type LayoutSpec } from './text';
import { universeShots } from './shots/universe';
import { dawnShots } from './shots/dawn';
import { sunShots } from './shots/sun';
import { lifeShots } from './shots/life';
import { humanShots } from './shots/human';
import { futureShots } from './shots/future';

const shots = [...universeShots(), ...dawnShots(), ...sunShots(), ...lifeShots(), ...humanShots(), ...futureShots()];

/** Open the 2.39:1 letterbox to full frame for the biggest moments. */
const IMAX: [number, number, number, number][] = [
  // [open start, open end, close start, close end]
  [cues.bang - 0.02, cues.bang + 0.5, 30.0, 32.5],
  [69.2, 71.0, 79.2, 81.2],
  [cues.asteroidImpact - 0.1, cues.asteroidImpact + 0.4, 161.0, 163.0],
  [239.5, 241.5, 247.2, 249.2],
  [269.5, 271.5, 285.6, 287.6],
];

function letterbox(t: number) {
  let open = 0;
  for (const [a, b, c, d] of IMAX) open = Math.max(open, keys(t, [[a, 0], [b, 1, 'inOutCubic'], [c, 1], [d, 0, 'inOutCubic']]));
  return 1 - open;
}

/**
 * Caption scrim: fades in behind chapter cards so text stays legible over busy imagery, and
 * sits wherever the beat's layout puts the card.
 */
function scrimAt(t: number): Pick<Look, 'scrim' | 'scrimCenter' | 'scrimRadius'> {
  let best = { scrim: 0, scrimCenter: [0.5, 1.0] as [number, number], scrimRadius: [1.1, 0.42] as [number, number] };
  for (const b of T.beats as { start: number; end: number; card: string; layout?: LayoutSpec; captionDelay?: number }[]) {
    if (b.card !== 'chapter' && b.card !== 'montage') continue;
    const s0 = b.start + (b.captionDelay ?? 0);
    const s = keys(t, [[s0, 0], [s0 + 1.0, 1, 'inOutSine'], [b.end - 1.0, 1], [b.end, 0, 'inOutSine']]);
    if (s * 0.8 > best.scrim) {
      const sc = scrimFor(placeOf(b.layout));
      best = { scrim: s * 0.8, scrimCenter: sc.center, scrimRadius: sc.radius };
    }
  }
  return best;
}

const pulse = (t: number, t0: number, amp: number, decay: number) => (t >= t0 ? amp * Math.exp(-(t - t0) * decay) : 0);

/** White-out flashes (display space): only the Big Bang truly blinds; other hits use exposure. */
function flashAt(t: number) {
  return pulse(t, cues.bang, 1.1, 3.2) + pulse(t, cues.asteroidImpact, 0.25, 3.0) + pulse(t, cues.lastFlash, 0.2, 2.0);
}

/** Exposure kicks (EV) for impacts and ignitions. */
function exposureAt(t: number) {
  return (
    pulse(t, cues.supernova, 0.6, 2.5) + pulse(t, cues.sunIgnite, 0.7, 2.0) + pulse(t, cues.theia, 0.5, 2.4) +
    pulse(t, cues.asteroidImpact, 1.8, 1.8) + pulse(t, cues.lastFlash, 1.5, 1.2)
  );
}

function shakeAt(t: number): [number, number] {
  const hits: [number, number][] = [
    [cues.bang, 14],
    [cues.theia, 7],
    [cues.asteroidImpact, 12],
  ];
  let x = 0, y = 0;
  for (const [t0, a] of hits) {
    x += shake(t, t0, a, 2.2, 16, 1);
    y += shake(t, t0, a, 2.2, 16, 2);
  }
  return [x, y];
}

/** Per-act colour grade: gentle split-toning, with colour draining from the universe near the end. */
function grade(t: number): Partial<Look> {
  const warm: Vec3 = [1.03, 1.0, 0.95];
  const cool: Vec3 = [0.96, 1.0, 1.05];
  const gain = t < 80 ? cool : t < 216 ? warm : cool;
  const sat = keys(t, [[0, 1.0], [260, 1.0], [296, 0.55], [305, 0.9]]);
  return { gain, lift: [0.0, 0.0005, 0.0015], saturation: sat, contrast: 1.04 };
}

export default defineProject({
  id: 'arrow-of-time',
  title: 'The Arrow of Time',
  width: 1920,
  height: 1080,
  fps: T.fps,
  duration: T.duration,
  audio: '/out/arrow-of-time/audio/score.wav',
  fonts: ['500 58px Cinzel', '400 22px Jost', 'italic 500 35px "Cormorant Garamond"', 'italic 400 44px "Cormorant Garamond"'],
  motionBlur: 1,
  shutter: 0.5,
  shots,
  text: buildText(),
  markers: Object.entries(T.cues).map(([label, t]) => ({ t, label })),
  look: (t) => ({
    ...grade(t),
    letterbox: letterbox(t),
    ...scrimAt(t),
    flash: flashAt(t),
    exposure: exposureAt(t),
    shake: shakeAt(t),
    bloom: 0.075,
    bloomRadius: 1.0,
    streak:
      (t > 101.8 && t < 104.5) || (t > 157.9 && t < 160.5) || (t > 239 && t < 249)
        ? 0
        : keys(t, [[0, 0.35], [19.9, 0.35], [20.0, 0.06], [30, 0.06], [31, 0.09], [68, 0.09], [70, 0.025], [80, 0.025], [82, 0.09]]),
    streakThreshold: (t > 19.9 && t < 31) || (t > 101.8 && t < 104) || (t > 157.9 && t < 160) ? 6 : 2.5,
    vignette: 0.32,
    grain: 0.034,
    aberration: 0.6,
    tonemap: 'aces',
  }),
});
