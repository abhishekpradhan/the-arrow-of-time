// Render a project to video.
//
//   npm run render -- <project> [--preset final|draft] [--scale 1] [--from 0] [--to 30] [--frames a:b]
//                              [--workers 1] [--crf 17] [--segment 20] [--resume]
//                              [--gl auto|egl|vulkan|swiftshader|gpu] [--no-audio] [--mb 0|1] [--out path.mp4]
//
// Frames are rendered by headless Chromium (WebGL2) and streamed as raw RGBA into ffmpeg
// (x264, Rec.709). The timeline is cut into short segments that workers pull from a queue;
// finished segments are kept on disk, so an interrupted render continues with --resume.
// Segments are then concatenated (stream copy) and muxed with the project's soundtrack.

import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Encoder, concatVideos, hasFfmpeg, muxAudio, probe } from './lib/ffmpeg';
import { pageInfo, startSession, type GlMode } from './lib/session';
import { ROOT, fmtTime, num, outDir, parseArgs, projectDir, stamp, str } from './lib/util';

const args = parseArgs(process.argv.slice(2));
const id = args._[0];
if (!id) {
  console.error('usage: npm run render -- <project> [--preset final|draft] [--from s] [--to s] [--workers n] [--resume]');
  process.exit(1);
}
projectDir(id);
if (!hasFfmpeg()) {
  console.error('ffmpeg not found on PATH. Install it (e.g. `apt install ffmpeg` / `brew install ffmpeg`).');
  process.exit(1);
}

const preset = str(args.preset, 'final');
const draft = preset === 'draft';
const scale = num(args.scale, draft ? 0.5 : 1);
const workers = Math.max(1, num(args.workers, 1));
const crf = num(args.crf, draft ? 23 : 17);
const motionBlur = args.mb === undefined ? !draft : str(args.mb, '1') !== '0';

const session = await startSession(str(args.gl, 'auto') as GlMode);
try {
  const first = await session.openRenderPage({ project: id, infoOnly: true });
  const info = await pageInfo(first);
  await first.close();

  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const W = even(num(args.width, info.width * scale));
  const H = even(num(args.height, info.height * scale));
  const fps = info.fps;
  // --frames a:b (end exclusive) is exact, for splitting a film across machines.
  const range = args.frames ? String(args.frames).split(':').map(Number) : null;
  const f0 = Math.max(0, range ? range[0] : Math.round(num(args.from, 0) * fps));
  const f1 = Math.min(info.frames, range ? range[1] : Math.round(num(args.to, info.duration) * fps));
  if (f1 <= f0) throw new Error('empty frame range');

  const renders = outDir(id, 'renders');
  const name = str(args.out, join(renders, `${id}-${preset}-${stamp()}.mp4`));

  // Segments live in a folder keyed by the settings that change the pixels or the encode.
  const segDir = join(ROOT, 'out', id, 'segments', `${preset}-${W}x${H}-crf${crf}${motionBlur ? '-mb' : ''}`);
  if (!args.resume) rmSync(segDir, { recursive: true, force: true });
  mkdirSync(segDir, { recursive: true });
  const segFrames = Math.max(1, Math.round(num(args.segment, 20) * fps));
  const segments: { a: number; b: number; file: string }[] = [];
  for (let a = f0; a < f1; a += segFrames) {
    const b = Math.min(a + segFrames, f1);
    segments.push({ a, b, file: join(segDir, `seg-${String(a).padStart(6, '0')}-${String(b).padStart(6, '0')}.mp4`) });
  }
  const isDone = (s: { file: string }) => existsSync(s.file) && existsSync(`${s.file}.done`);
  const todo = segments.filter((s) => !isDone(s));
  const total = todo.reduce((n, s) => n + (s.b - s.a), 0);
  console.log(
    `[render] ${info.title}: ${W}x${H} @ ${fps}fps, frames ${f0}-${f1}, ${segments.length} segment(s)` +
      `${todo.length < segments.length ? ` (${segments.length - todo.length} already done)` : ''}, ${workers} worker(s), mb=${motionBlur}`,
  );

  const encodeOpts = { width: W, height: H, fps, crf, preset: draft ? 'veryfast' : 'slow', tune: 'film' };
  const current = new Map<string, Encoder>();
  let done = 0;
  const t0 = Date.now();
  let lastLog = 0;
  session.setHandler(async (worker, frame, data) => {
    const enc = current.get(worker);
    if (!enc) throw new Error(`no encoder for worker ${worker}`);
    if (data.length !== W * H * 4) throw new Error(`frame ${frame}: got ${data.length} bytes`);
    await enc.write(data);
    done++;
    const now = Date.now();
    if (now - lastLog > 5000 || done === total) {
      lastLog = now;
      const el = (now - t0) / 1000;
      const rate = done / el;
      console.log(`[render] ${done}/${total} frames  ${rate.toFixed(2)} fps  elapsed ${fmtTime(el)}  eta ${fmtTime((total - done) / rate)}`);
    }
  });

  if (todo.length) {
    const queue = [...todo];
    const nPages = Math.min(workers, todo.length);
    const pages = await Promise.all(
      Array.from({ length: nPages }, () => session.openRenderPage({ project: id, width: W, height: H, motionBlur })),
    );
    const times: number[] = [];
    await Promise.all(
      pages.map(async (page, k) => {
        const wid = String(k);
        for (let seg = queue.shift(); seg; seg = queue.shift()) {
          const enc = new Encoder(seg.file, encodeOpts);
          current.set(wid, enc);
          const s = seg;
          times.push(await page.evaluate(([a, b, w]) => window.__movie.renderRange(a as number, b as number, w as string), [s.a, s.b, wid]));
          await enc.close();
          writeFileSync(`${seg.file}.done`, '');
        }
      }),
    );
    console.log(`[render] mean GPU time per frame: ${(times.reduce((x, y) => x + y, 0) / times.length).toFixed(0)} ms`);
  }

  const tmp = outDir(id, 'tmp');
  const video = join(tmp, `video-${stamp()}.mp4`);
  if (segments.length === 1) copyFileSync(segments[0].file, video);
  else concatVideos(segments.map((s) => s.file), video, join(tmp, 'concat.txt'));

  const audioPath = info.audio ? join(ROOT, info.audio.replace(/^\//, '')) : '';
  if (!args['no-audio'] && audioPath && existsSync(audioPath)) {
    muxAudio(video, audioPath, name, f0 / fps, (f1 - f0) / fps);
  } else {
    if (info.audio && !args['no-audio']) console.warn(`[render] soundtrack ${info.audio} not found; run \`npm run audio -- ${id}\` first. Writing silent video.`);
    copyFileSync(video, name);
  }
  rmSync(video);
  if (!args['keep-segments']) rmSync(segDir, { recursive: true, force: true });

  const p = probe(name);
  const mb = p ? (Number(p.format.size) / 1e6).toFixed(1) : '?';
  console.log(`[render] done in ${fmtTime((Date.now() - t0) / 1000)} -> ${relative(ROOT, name)} (${mb} MB)`);
  // Only complete renders to the default location become the project's "latest".
  if (!args.out && f0 === 0 && f1 === info.frames) copyFileSync(name, join(renders, `${id}-${preset}-latest.mp4`));
} finally {
  await session.close();
}
