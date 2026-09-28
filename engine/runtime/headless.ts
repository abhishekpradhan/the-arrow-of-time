// Headless render page (render.html). Driven by tools/render.ts and tools/still.ts
// through window.__movie. Frames are POSTed as raw RGBA to the Vite dev server,
// which hands them to ffmpeg or the PNG writer.

import { Engine } from '../core/engine';
import { timecode } from '../text/captions';
import { loadFilm } from './film';

declare global {
  interface Window {
    __movie: HeadlessApi;
  }
}

interface HeadlessApi {
  status: 'loading' | 'ready' | 'error';
  error?: string;
  info(): {
    id: string;
    title: string;
    width: number;
    height: number;
    fps: number;
    duration: number;
    frames: number;
    audio?: string;
    shots: { id: string; start: number; end: number }[];
  };
  /** Render frames [from, to) and POST each to /__frame. Resolves with the average ms/frame. */
  renderRange(from: number, to: number, worker: string, frames?: number[]): Promise<number>;
  /** Render each frame twice (warm-up + timed) and return per-frame milliseconds, without transfer. */
  bench(frames: number[]): number[];
}

const q = new URLSearchParams(location.search);

async function main() {
  const api: Partial<HeadlessApi> = { status: 'loading' };
  window.__movie = api as HeadlessApi;
  try {
    let project = await loadFilm();
    if (q.get('textonly') === '1') {
      // Typography checks: captions over black, with nothing that moves pixels by itself.
      const look = project.look;
      project = {
        ...project,
        shots: [],
        look: (t) => ({ ...look?.(t), grain: 0, vignette: 0, bloom: 0, streak: 0, aberration: 0, scrim: 0, flash: 0, shake: [0, 0] }),
      };
    }
    const width = Number(q.get('w') ?? project.width);
    const height = Number(q.get('h') ?? project.height);
    const describe = () => ({
      id: project.id,
      title: project.title,
      width,
      height,
      fps: project.fps,
      duration: project.duration,
      frames: Math.round(project.duration * project.fps),
      audio: project.audio,
      shots: project.shots.map((s) => ({ id: s.id, start: s.start, end: s.end })),
    });
    if (q.get('info') === '1') {
      // Metadata only: no GPU work, no shot setup.
      api.info = describe;
      api.status = 'ready';
      return;
    }
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const engine = new Engine(canvas, project, { width, height, noMotionBlur: q.get('mb') === '0' });
    if (q.get('debug') === '1') engine.text.items = [...engine.text.items, timecode(project.fps)];
    await engine.load((m) => console.log(`[load] ${m}`));
    const buf = new Uint8Array(width * height * 4);

    api.info = describe;

    api.renderRange = async (from, to, worker, list) => {
      const frames = list ?? Array.from({ length: to - from }, (_, i) => from + i);
      let total = 0;
      for (const f of frames) {
        const t0 = performance.now();
        engine.renderFrame(f, true);
        engine.readPixels(buf);
        total += performance.now() - t0;
        const res = await fetch(`/__frame?i=${f}&w=${encodeURIComponent(worker)}`, { method: 'POST', body: buf });
        if (!res.ok) throw new Error(`frame sink rejected frame ${f}: ${res.status}`);
      }
      return total / Math.max(1, frames.length);
    };
    api.bench = (frames) =>
      frames.map((f) => {
        engine.renderFrame(f, true);
        engine.readPixels(buf);
        const t0 = performance.now();
        engine.renderFrame(f, true);
        engine.readPixels(buf);
        return performance.now() - t0;
      });
    api.status = 'ready';
  } catch (err) {
    console.error(err);
    api.status = 'error';
    api.error = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
  }
}

main();
