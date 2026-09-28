// Render the film's score (Python synthesis; see audio/README.md and docs/score.md).
//
//   npm run audio [-- --from 180 --to 212] [--stems dir] [other score.py flags]
//
// Runs film/score.py with the repo's virtualenv Python (falling back to python3 / python)
// and writes out/audio/score.wav (partial renders with --from/--to go to
// score-<from>-<to>.wav so they never replace the full mix).

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error('usage: npm run audio [-- --from s] [--to s] [--stems dir] [--out file.wav]');
  process.exit(1);
}

function findPython(): string {
  const venv = [join(ROOT, '.venv', 'bin', 'python'), join(ROOT, '.venv', 'Scripts', 'python.exe')];
  for (const p of venv) if (existsSync(p)) return p;
  for (const p of ['python3', 'python']) {
    if (spawnSync(p, ['--version'], { stdio: 'ignore' }).status === 0) return p;
  }
  usage('No Python found: create the venv (python3 -m venv .venv && .venv/bin/pip install -r requirements.txt).');
}

/** Value of `--name value` or `--name=value` in args, if present. */
function flag(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}`) return args[i + 1];
    if (args[i].startsWith(`--${name}=`)) return args[i].slice(name.length + 3);
  }
  return undefined;
}

/** Duration, sample rate and channels from a RIFF/WAVE header (no ffprobe needed). */
function wavInfo(file: string): { seconds: number; rate: number; channels: number; bits: number } | null {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(4096);
    readSync(fd, head, 0, head.length, 0);
    if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') return null;
    let pos = 12;
    let rate = 0, channels = 0, bits = 0, align = 0;
    while (pos + 8 <= head.length) {
      const id = head.toString('ascii', pos, pos + 4);
      const size = head.readUInt32LE(pos + 4);
      if (id === 'fmt ') {
        channels = head.readUInt16LE(pos + 10);
        rate = head.readUInt32LE(pos + 12);
        align = head.readUInt16LE(pos + 20);
        bits = head.readUInt16LE(pos + 22);
      } else if (id === 'data') {
        return rate && align ? { seconds: size / (rate * align), rate, channels, bits } : null;
      }
      pos += 8 + size + (size & 1);
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

const args = process.argv.slice(2);
if (args.length && !args[0].startsWith('--')) usage();
const script = join(ROOT, 'film', 'score.py');
if (!existsSync(script)) usage('No score at film/score.py');

let out = flag(args, 'out');
if (!out) {
  const from = flag(args, 'from');
  const to = flag(args, 'to');
  const name = from !== undefined || to !== undefined ? `score-${from ?? 0}-${to ?? 'end'}.wav` : 'score.wav';
  out = join(ROOT, 'out', 'audio', name);
  args.push('--out', out);
}
out = resolve(ROOT, out);
mkdirSync(dirname(out), { recursive: true });

const python = findPython();
console.log(`[audio] ${relative(ROOT, script)} -> ${relative(ROOT, out)} (python: ${relative(ROOT, python) || python})`);
const t0 = Date.now();
const r = spawnSync(python, [script, ...args], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, PYTHONUNBUFFERED: '1' },
});
if (r.error) usage(`failed to run ${python}: ${r.error.message}`);
if (r.status !== 0) {
  console.error(`[audio] score.py failed (exit ${r.status ?? r.signal})`);
  process.exit(r.status ?? 1);
}
if (!existsSync(out)) usage(`[audio] expected output ${relative(ROOT, out)} was not written`);

const info = wavInfo(out);
const mb = (statSync(out).size / 1e6).toFixed(1);
let extra = '';
const report = out.replace(/\.wav$/i, '.json');
if (existsSync(report)) {
  try {
    const j = JSON.parse(readFileSync(report, 'utf8'));
    const s = j.summary ?? {};
    extra = `, ${Number(s.lufs_integrated).toFixed(2)} LUFS, ${Number(s.true_peak_dbtp).toFixed(2)} dBTP`;
  } catch {
    /* report is optional */
  }
}
const desc = info ? `${info.seconds.toFixed(3)} s, ${info.rate} Hz, ${info.channels} ch, ${info.bits}-bit` : 'unreadable header';
console.log(`[audio] done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${relative(ROOT, out)} (${desc}, ${mb} MB${extra})`);
