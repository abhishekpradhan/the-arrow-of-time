// One-time environment setup for a new machine.
//
//   npm run setup
//
// Creates the Python venv with the audio dependencies, makes sure Playwright's Chromium is
// installed, and checks for ffmpeg.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/util';

const ok = (cmd: string, args: string[], quiet = false) =>
  spawnSync(cmd, args, { cwd: ROOT, stdio: quiet ? 'ignore' : 'inherit', shell: process.platform === 'win32' }).status === 0;

let problems = 0;

if (ok('ffmpeg', ['-version'], true)) console.log('✓ ffmpeg');
else {
  problems++;
  console.log('✗ ffmpeg not found: install it (apt install ffmpeg / brew install ffmpeg / winget install ffmpeg)');
}

const py = process.platform === 'win32' ? 'python' : 'python3';
const venvPy = join(ROOT, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(venvPy)) {
  console.log('… creating .venv');
  if (!ok(py, ['-m', 'venv', '.venv'])) problems++;
}
if (existsSync(venvPy) && ok(venvPy, ['-m', 'pip', 'install', '-q', '-r', 'requirements.txt'])) console.log('✓ Python audio dependencies (.venv)');
else {
  problems++;
  console.log('✗ could not install Python dependencies (needs Python 3.10+)');
}

if (ok('npx', ['playwright', 'install', 'chromium'])) console.log('✓ Chromium for headless rendering');
else {
  problems++;
  console.log('✗ Playwright Chromium install failed');
}

console.log(problems ? `\n${problems} problem(s) above.` : '\nReady. Try `npm run dev`.');
process.exit(problems ? 1 : 0);
