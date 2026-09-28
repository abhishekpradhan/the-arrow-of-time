// Render still frames or contact sheets for quick visual review.
//
//   npm run still -- --t 12.5 [--t 30 ...]          single frames (PNG)
//   npm run still -- --shot bigbang [--n 6]           frames spread across a shot, as a sheet
//   npm run still -- --sheet [--from 0 --to 60] [--n 12] [--cols 4]
//   npm run still -- --t 10 --t 20 --t 30 --grid     several times as one sheet
//   npm run still -- --t 10 --t 20 --bench --scale 1     per-frame render cost
//   common: [--scale 0.5] [--debug] (burn in timecode) [--clean] (no timecode on sheets) [--out file.png] [--mb 0|1] [--gl ...]
//           [--textonly] (captions over black, no grain/bloom: for typography checks)

import { writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { contactSheet, encodePNG } from './lib/png';
import { pageInfo, startSession, type GlMode } from './lib/session';
import { ROOT, SLUG, list, num, outDir, parseArgs, str } from './lib/util';

const args = parseArgs(process.argv.slice(2));
if (args._.length || (args.t === undefined && args.shot === undefined && !args.sheet)) {
  console.error('usage: npm run still -- --t <sec> | --shot <id> | --sheet');
  process.exit(1);
}

const session = await startSession(str(args.gl, 'auto') as GlMode);
try {
  const first = await session.openRenderPage({ infoOnly: true });
  const info = await pageInfo(first);
  await first.close();

  const sheetMode = !!args.sheet || !!args.shot || !!args.grid;
  const scale = num(args.scale, sheetMode ? 0.25 : 0.5);
  const W = Math.round((info.width * scale) / 2) * 2;
  const H = Math.round((info.height * scale) / 2) * 2;
  const fps = info.fps;

  let times: number[] = list(args.t).map(Number);
  let label = '';
  if (args.shot) {
    const shot = info.shots.find((s) => s.id === str(args.shot, ''));
    if (!shot) throw new Error(`no shot "${args.shot}". Shots: ${info.shots.map((s) => s.id).join(', ')}`);
    const n = num(args.n, 6);
    times = Array.from({ length: n }, (_, i) => shot.start + ((i + 0.5) / n) * (shot.end - shot.start));
    label = `shot-${shot.id}`;
  } else if (args.grid) {
    label = `grid-${times.map((t) => t.toFixed(1)).join('_')}`.slice(0, 80);
  } else if (args.sheet) {
    const a = num(args.from, 0), b = num(args.to, info.duration);
    const n = num(args.n, 12);
    times = Array.from({ length: n }, (_, i) => a + ((i + 0.5) / n) * (b - a));
    label = `sheet-${a}-${b}`;
  }
  if (!times.length) throw new Error('nothing to render: pass --t, --shot or --sheet');

  const frames = times.map((t) => Math.min(info.frames - 1, Math.max(0, Math.round(t * fps))));
  if (args.bench) {
    // Per-frame render cost at this resolution (GPU + readback, no encode), for render planning.
    const page = await session.openRenderPage({ width: W, height: H, motionBlur: str(args.mb, '1') !== '0' });
    const ms = await page.evaluate(([fr]) => window.__movie.bench(fr as number[]), [frames]);
    const rows = frames.map((f, i) => {
      const shot = info.shots.filter((s) => f / fps >= s.start && f / fps < s.end).map((s) => s.id).join('+');
      return `${(f / fps).toFixed(2).padStart(8)}s  ${ms[i].toFixed(0).padStart(6)} ms  ${shot}`;
    });
    console.log(rows.join('\n'));
    console.log(`[bench] ${W}x${H} mean ${(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(0)} ms/frame`);
    process.exit(0);
  }
  const got = new Map<number, Buffer>();
  session.setHandler((_w, f, data) => void got.set(f, data));
  const page = await session.openRenderPage({
    width: W,
    height: H,
    debug: !args.clean && (!!args.debug || sheetMode),
    motionBlur: str(args.mb, '0') !== '0',
    textOnly: !!args.textonly,
  });
  const t0 = Date.now();
  const ms = await page.evaluate(([fr]) => window.__movie.renderRange(0, 0, 'still', fr as number[]), [frames]);
  const dir = outDir('stills');
  if (sheetMode) {
    const cols = num(args.cols, Math.min(frames.length, frames.length <= 4 ? 2 : 3));
    const sheet = contactSheet(frames.map((f) => new Uint8Array(got.get(f)!)), W, H, cols);
    const file = args.out ? resolve(ROOT, str(args.out, '')) : join(dir, `${label}.png`);
    writeFileSync(file, encodePNG(sheet.data, sheet.width, sheet.height));
    console.log(relative(ROOT, file));
  } else {
    for (const f of frames) {
      // (--out names a single frame; several go to out/stills/.)
      const file = args.out && frames.length === 1 ? resolve(ROOT, str(args.out, '')) : join(dir, `${SLUG}-t${(f / fps).toFixed(2)}.png`);
      writeFileSync(file, encodePNG(new Uint8Array(got.get(f)!), W, H));
      console.log(relative(ROOT, file));
    }
  }
  console.log(`[still] ${frames.length} frame(s) at ${W}x${H}, ${ms.toFixed(0)} ms/frame, total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} finally {
  await session.close();
}
