// Package the latest final render for publishing (releases/ is tracked with Git LFS).
//
//   npm run release -- <project> [--poster 75.0] [--mbps 8] [--preview-mb 28] [--input master.mp4] [--no-preview]
//
// The CRF master from `npm run render` is archival-sized (film grain is expensive), so this
// makes distribution encodes from it:
//   releases/<id>/<id>-1080p.mp4   two-pass x264 at --mbps (default 8, YouTube's 1080p guidance)
//   releases/<id>/<id>-720p.mp4    preview sized to fit --preview-mb (default 28 MB, fits chat uploads)
//   releases/<id>/poster.jpg       frame at --poster seconds
//   releases/<id>/info.json
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { probe } from './lib/ffmpeg';
import { ROOT, ensureDir, num, parseArgs, projectDir, str } from './lib/util';

const args = parseArgs(process.argv.slice(2));
const id = args._[0];
if (!id) {
  console.error('usage: npm run release -- <project> [--poster s] [--mbps 8] [--preview-mb 28] [--input file.mp4] [--no-preview]');
  process.exit(1);
}
projectDir(id);
const input = str(args.input, join(ROOT, 'out', id, 'renders', `${id}-final-latest.mp4`));
if (!existsSync(input)) {
  console.error(`No render at ${relative(ROOT, input)}. Run \`npm run render -- ${id}\` first.`);
  process.exit(1);
}
const dir = ensureDir(join(ROOT, 'releases', id));
const tmp = ensureDir(join(ROOT, 'out', id, 'tmp'));
const run = (a: string[]) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${a.join(' ')}`);
};
const duration = Number(probe(input)?.format.duration ?? 0);
if (!duration) throw new Error('could not read the master duration');

const COLOR = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

/** Two-pass x264 encode at a fixed video bitrate (kbit/s). aq-mode 3 spends bits on dark gradients. */
function twoPass(out: string, vkbps: number, akbps: number, vf: string, preset = 'slow') {
  const log = join(tmp, 'x264-2pass');
  const common = ['-i', input, '-vf', vf, '-c:v', 'libx264', '-preset', preset, '-tune', 'film', '-x264-params', 'aq-mode=3',
    '-b:v', `${vkbps}k`, '-maxrate', `${Math.round(vkbps * 2)}k`, '-bufsize', `${Math.round(vkbps * 4)}k`, '-pix_fmt', 'yuv420p',
    ...COLOR, '-passlogfile', log];
  run([...common, '-pass', '1', '-an', '-f', 'null', '-']);
  run([...common, '-pass', '2', '-c:a', 'aac', '-b:a', `${akbps}k`, '-ar', '48000', '-movflags', '+faststart', out]);
  for (const f of [`${log}-0.log`, `${log}-0.log.mbtree`]) rmSync(f, { force: true });
}

const hd = join(dir, `${id}-1080p.mp4`);
console.log(`[release] 1080p two-pass at ${num(args.mbps, 8)} Mbps …`);
twoPass(hd, Math.round(num(args.mbps, 8) * 1000), 256, 'null');

let preview: string | null = null;
if (!args['no-preview']) {
  preview = join(dir, `${id}-720p.mp4`);
  const budgetBits = num(args['preview-mb'], 28) * 1e6 * 8 * 0.96; // leave room for container overhead
  const akbps = 128;
  const vkbps = Math.max(200, Math.floor(budgetBits / duration / 1000 - akbps));
  console.log(`[release] 720p preview at ${vkbps} kbps video to fit ${num(args['preview-mb'], 28)} MB …`);
  // Light temporal denoise: grain is noise to an encoder at this bitrate.
  twoPass(preview, vkbps, akbps, 'scale=1280:720:flags=lanczos,hqdn3d=2:1.5:4:3', 'veryslow');
}

const poster = join(dir, 'poster.jpg');
run(['-ss', String(num(args.poster, 10)), '-i', input, '-frames:v', '1', '-q:v', '3', poster]);

const info = {
  project: id,
  created: new Date().toISOString(),
  duration,
  files: [hd, preview, poster].filter((f): f is string => !!f).map((f) => ({ file: relative(dir, f), bytes: statSync(f).size })),
};
writeFileSync(join(dir, 'info.json'), JSON.stringify(info, null, 2) + '\n');
for (const f of info.files) console.log(`${relative(ROOT, join(dir, f.file))}  ${(f.bytes / 1e6).toFixed(1)} MB`);
