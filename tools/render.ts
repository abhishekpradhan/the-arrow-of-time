// Render a project to video.
//
//   npm run render -- <project> [--preset final|draft] [--scale 1] [--from 0] [--to 30]
//                              [--workers 1] [--crf 17] [--gl auto|egl|vulkan|swiftshader|gpu]
//                              [--no-audio] [--mb 0|1] [--out path.mp4]
//
// Frames are rendered by headless Chromium (WebGL2), streamed as raw RGBA to
// ffmpeg (x264, Rec.709), chunked across workers, then concatenated and muxed
// with the project's soundtrack.

import { existsSync, rmSync, copyFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Encoder, concatVideos, hasFfmpeg, muxAudio, probe } from './lib/ffmpeg';
import { pageInfo, startSession, type GlMode } from './lib/session';
import { ROOT, fmtTime, num, outDir, parseArgs, projectDir, stamp, str } from './lib/util';

const args = parseArgs(process.argv.slice(2));
const id = args._[0];
if (!id) {
  console.error('usage: npm run render -- <project> [--preset final|draft] [--from s] [--to s] [--workers n]');
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
  const f0 = Math.max(0, Math.round(num(args.from, 0) * fps));
  const f1 = Math.min(info.frames, Math.round(num(args.to, info.duration) * fps));
  const total = f1 - f0;
  if (total <= 0) throw new Error('empty frame range');

  const tmp = outDir(id, 'tmp');
  const renders = outDir(id, 'renders');
  const name = str(args.out, join(renders, `${id}-${preset}-${stamp()}.mp4`));
  console.log(`[render] ${info.title}: ${W}x${H} @ ${fps}fps, frames ${f0}-${f1} (${total}), ${workers} worker(s), mb=${motionBlur}`);

  // Split into contiguous chunks, one encoder per worker.
  const chunks = Array.from({ length: workers }, (_, k) => {
    const a = f0 + Math.floor((total * k) / workers);
    const b = f0 + Math.floor((total * (k + 1)) / workers);
    return { k, a, b, file: join(tmp, `chunk-${k}.mp4`) };
  }).filter((c) => c.b > c.a);
  const encoders = new Map(
    chunks.map((c) => [String(c.k), new Encoder(c.file, { width: W, height: H, fps, crf, preset: draft ? 'veryfast' : 'slow', tune: 'film' })]),
  );

  let done = 0;
  const t0 = Date.now();
  let lastLog = 0;
  session.setHandler(async (worker, frame, data) => {
    const enc = encoders.get(worker);
    if (!enc) throw new Error(`unknown worker ${worker}`);
    if (data.length !== W * H * 4) throw new Error(`frame ${frame}: got ${data.length} bytes`);
    await enc.write(data);
    done++;
    const now = Date.now();
    if (now - lastLog > 5000 || done === total) {
      lastLog = now;
      const el = (now - t0) / 1000;
      const rate = done / el;
      console.log(`[render] ${done}/${total} frames  ${(rate).toFixed(2)} fps  elapsed ${fmtTime(el)}  eta ${fmtTime((total - done) / rate)}`);
    }
  });

  const pages = await Promise.all(
    chunks.map(() => session.openRenderPage({ project: id, width: W, height: H, motionBlur })),
  );
  const ms = await Promise.all(
    chunks.map((c, i) => pages[i].evaluate(([a, b, k]) => window.__movie.renderRange(a as number, b as number, String(k)), [c.a, c.b, c.k])),
  );
  for (const enc of encoders.values()) await enc.close();
  console.log(`[render] GPU time per frame: ${ms.map((m) => m.toFixed(0) + 'ms').join(', ')}`);

  const video = join(tmp, `video-${stamp()}.mp4`);
  if (chunks.length === 1) copyFileSync(chunks[0].file, video);
  else concatVideos(chunks.map((c) => c.file), video, join(tmp, 'concat.txt'));

  const audioPath = info.audio ? join(ROOT, info.audio.replace(/^\//, '')) : '';
  if (!args['no-audio'] && audioPath && existsSync(audioPath)) {
    muxAudio(video, audioPath, name, f0 / fps, total / fps);
    rmSync(video);
  } else {
    if (info.audio && !args['no-audio']) console.warn(`[render] soundtrack ${info.audio} not found; run \`npm run audio -- ${id}\` first. Writing silent video.`);
    copyFileSync(video, name);
    rmSync(video);
  }
  for (const c of chunks) rmSync(c.file, { force: true });

  const p = probe(name);
  const mb = p ? (Number(p.format.size) / 1e6).toFixed(1) : '?';
  console.log(`[render] done in ${fmtTime((Date.now() - t0) / 1000)} -> ${relative(ROOT, name)} (${mb} MB)`);
  copyFileSync(name, join(renders, `${id}-${preset}-latest.mp4`));
} finally {
  await session.close();
}
