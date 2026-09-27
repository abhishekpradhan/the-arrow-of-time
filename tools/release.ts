// Make the distribution encodes of a finished render, ready to attach to a GitHub Release.
//
//   npm run release -- <project> [--input master.mp4] [--variants 1080p,720p,poster] [--poster 75.0]
//                               [--mbps 8] [--mbps-2160 40] [--preview-mb 28] [--out-dir dir]
//
// The CRF master from `npm run render` is archival-sized (film grain is expensive), so this makes
// the files people actually download. Everything goes to out/<id>/release/ (git-ignored):
//   <id>-2160p.mp4   two-pass x264 at --mbps-2160 (default 40, YouTube's 2160p24 SDR guidance);
//                    only from a 4K master (render with --scale 2)
//   <id>-1080p.mp4   two-pass x264 at --mbps (default 8, YouTube's 1080p guidance)
//   <id>-720p.mp4    preview sized to fit --preview-mb (default 28 MB, fits chat uploads)
//   poster.jpg       frame at --poster seconds (default: the timeline's "poster", else 10)
//   info.json, SHA256SUMS
// Publish them with the "Render on Modal" workflow or `gh release create` (see docs/releasing.md).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { probe } from './lib/ffmpeg';
import { ROOT, ensureDir, num, parseArgs, projectDir, str } from './lib/util';

const args = parseArgs(process.argv.slice(2));
const id = args._[0];
if (!id) {
  console.error('usage: npm run release -- <project> [--input file.mp4] [--variants 1080p,720p,poster] [--poster s] [--out-dir dir]');
  process.exit(1);
}
const pdir = projectDir(id);
const input = resolve(str(args.input, join(ROOT, 'out', id, 'renders', `${id}-final-latest.mp4`)));
if (!existsSync(input)) {
  console.error(`No render at ${relative(ROOT, input)}. Run \`npm run render -- ${id}\` first.`);
  process.exit(1);
}
const dir = ensureDir(resolve(str(args['out-dir'], join(ROOT, 'out', id, 'release'))));
const tmp = ensureDir(join(ROOT, 'out', id, 'tmp'));
const variants = new Set(str(args.variants, '1080p,720p,poster').split(',').map((v) => v.trim()).filter(Boolean));
for (const v of variants) if (!['2160p', '1080p', '720p', 'poster'].includes(v)) throw new Error(`unknown variant ${v}`);

const run = (a: string[]) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${a.join(' ')}`);
};
const info0 = probe(input);
const duration = Number(info0?.format.duration ?? 0);
const height = Number(info0?.streams?.find((s: { height?: number }) => s.height)?.height ?? 0);
if (!duration || !height) throw new Error('could not read the master');

const COLOR = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

/** Two-pass x264 encode at a fixed video bitrate (kbit/s). aq-mode 3 spends bits on dark gradients. */
function twoPass(out: string, vkbps: number, akbps: number, vf: string, preset = 'slow') {
  const log = join(tmp, `x264-2pass-${basename(out, '.mp4')}`);
  const common = ['-i', input, '-vf', vf, '-c:v', 'libx264', '-preset', preset, '-tune', 'film', '-x264-params', 'aq-mode=3',
    '-b:v', `${vkbps}k`, '-maxrate', `${Math.round(vkbps * 2)}k`, '-bufsize', `${Math.round(vkbps * 4)}k`, '-pix_fmt', 'yuv420p',
    ...COLOR, '-passlogfile', log];
  run([...common, '-pass', '1', '-an', '-f', 'null', '-']);
  run([...common, '-pass', '2', '-c:a', 'aac', '-b:a', `${akbps}k`, '-ar', '48000', '-movflags', '+faststart', out]);
  for (const f of [`${log}-0.log`, `${log}-0.log.mbtree`]) rmSync(f, { force: true });
}

const files: string[] = [];
if (variants.has('2160p')) {
  if (height < 2160) console.warn(`[release] skipping 2160p: the master is ${height}p (render with --scale 2 for 4K)`);
  else {
    const out = join(dir, `${id}-2160p.mp4`);
    console.log(`[release] 2160p two-pass at ${num(args['mbps-2160'], 40)} Mbps …`);
    twoPass(out, Math.round(num(args['mbps-2160'], 40) * 1000), 320, height > 2160 ? 'scale=-2:2160:flags=lanczos' : 'null');
    files.push(out);
  }
}
if (variants.has('1080p')) {
  const out = join(dir, `${id}-1080p.mp4`);
  console.log(`[release] 1080p two-pass at ${num(args.mbps, 8)} Mbps …`);
  twoPass(out, Math.round(num(args.mbps, 8) * 1000), 256, height > 1080 ? 'scale=-2:1080:flags=lanczos' : 'null');
  files.push(out);
}
if (variants.has('720p')) {
  const out = join(dir, `${id}-720p.mp4`);
  const budgetBits = num(args['preview-mb'], 28) * 1e6 * 8 * 0.96; // leave room for container overhead
  const akbps = 128;
  const vkbps = Math.max(200, Math.floor(budgetBits / duration / 1000 - akbps));
  console.log(`[release] 720p preview at ${vkbps} kbps video to fit ${num(args['preview-mb'], 28)} MB …`);
  // Light temporal denoise: grain is noise to an encoder at this bitrate.
  twoPass(out, vkbps, akbps, 'scale=-2:720:flags=lanczos,hqdn3d=2:1.5:4:3', 'veryslow');
  files.push(out);
}
if (variants.has('poster')) {
  const timeline = JSON.parse(readFileSync(join(pdir, 'timeline.json'), 'utf8')) as { poster?: number };
  const out = join(dir, 'poster.jpg');
  run(['-ss', String(num(args.poster, timeline.poster ?? 10)), '-i', input, '-frames:v', '1', '-q:v', '2', out]);
  files.push(out);
}

// info.json and SHA256SUMS describe every file in the folder, including earlier variants
// (the Modal pipeline encodes variants in parallel into one folder).
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
const all = ['2160p', '1080p', '720p'].map((v) => join(dir, `${id}-${v}.mp4`)).concat(join(dir, 'poster.jpg')).filter((f) => existsSync(f));
const info = {
  project: id,
  created: new Date().toISOString(),
  duration,
  files: all.map((f) => ({ file: basename(f), bytes: statSync(f).size, sha256: sha(f) })),
};
writeFileSync(join(dir, 'info.json'), JSON.stringify(info, null, 2) + '\n');
writeFileSync(join(dir, 'SHA256SUMS'), info.files.map((f) => `${f.sha256}  ${f.file}`).join('\n') + '\n');
for (const f of files) console.log(`${relative(ROOT, f)}  ${(statSync(f).size / 1e6).toFixed(1)} MB`);
