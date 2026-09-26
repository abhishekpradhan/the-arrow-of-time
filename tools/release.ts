// Package the latest final render for publishing (releases/ is tracked with Git LFS).
//
//   npm run release -- <project> [--poster 75.0] [--input path.mp4] [--no-preview]
//
// Writes releases/<project>/<project>-1080p.mp4, a 720p preview, poster.jpg and info.json.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { probe } from './lib/ffmpeg';
import { ROOT, ensureDir, num, parseArgs, projectDir, str } from './lib/util';

const args = parseArgs(process.argv.slice(2));
const id = args._[0];
if (!id) {
  console.error('usage: npm run release -- <project> [--poster seconds] [--input file.mp4] [--no-preview]');
  process.exit(1);
}
projectDir(id);
const input = str(args.input, join(ROOT, 'out', id, 'renders', `${id}-final-latest.mp4`));
if (!existsSync(input)) {
  console.error(`No render at ${relative(ROOT, input)}. Run \`npm run render -- ${id}\` first.`);
  process.exit(1);
}
const dir = ensureDir(join(ROOT, 'releases', id));
const run = (a: string[]) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${a.join(' ')}`);
};

const master = join(dir, `${id}-1080p.mp4`);
copyFileSync(input, master);

const posterT = num(args.poster, 10);
const poster = join(dir, 'poster.jpg');
run(['-ss', String(posterT), '-i', master, '-frames:v', '1', '-q:v', '3', poster]);

let preview: string | null = null;
if (!args['no-preview']) {
  preview = join(dir, `${id}-720p.mp4`);
  run([
    '-i', master, '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', preview,
  ]);
}

const p = probe(master);
const info = {
  project: id,
  created: new Date().toISOString(),
  duration: p ? Number(p.format.duration) : null,
  files: [master, preview, poster].filter(Boolean).map((f) => ({ file: relative(dir, f!), bytes: statSync(f!).size })),
};
writeFileSync(join(dir, 'info.json'), JSON.stringify(info, null, 2) + '\n');
for (const f of info.files) console.log(`${relative(ROOT, join(dir, f.file))}  ${(f.bytes / 1e6).toFixed(1)} MB`);
