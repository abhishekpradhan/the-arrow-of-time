// ffmpeg helpers: raw-RGBA video encoder with backpressure, concat, mux.
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';

export interface EncodeOptions {
  width: number;
  height: number;
  fps: number;
  crf?: number;
  preset?: string;
  tune?: string;
}

export function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version']).status === 0;
}

/** Colour-correct Rec.709 conversion; full-range RGB in, limited-range 4:2:0 out. */
const TO_709 = 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int+bitexact,format=yuv420p';

export class Encoder {
  proc: ChildProcessWithoutNullStreams;
  private stderr = '';
  private exited: Promise<number>;

  constructor(public file: string, o: EncodeOptions) {
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${o.width}x${o.height}`, '-r', String(o.fps), '-i', 'pipe:0',
      '-vf', TO_709,
      '-c:v', 'libx264', '-preset', o.preset ?? 'slow', '-crf', String(o.crf ?? 17),
      ...(o.tune ? ['-tune', o.tune] : []),
      '-x264-params', 'aq-mode=3',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-movflags', '+faststart',
      file,
    ];
    this.proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stderr.on('data', (d) => (this.stderr += d.toString()));
    this.exited = new Promise((res) => this.proc.on('close', (code) => res(code ?? 1)));
  }

  async write(buf: Buffer) {
    if (!this.proc.stdin.write(buf)) await once(this.proc.stdin, 'drain');
  }

  async close() {
    this.proc.stdin.end();
    const code = await this.exited;
    if (code !== 0) throw new Error(`ffmpeg failed (${code}) for ${this.file}:\n${this.stderr}`);
  }
}

function run(args: string[]) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${r.stderr}`);
}

export function concatVideos(parts: string[], out: string, listFile: string) {
  writeFileSync(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  run(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', out]);
}

/** Mux a soundtrack onto a video. `offset` skips into the audio (for partial renders). */
export function muxAudio(video: string, audio: string, out: string, offset = 0, duration?: number) {
  run([
    '-i', video,
    ...(offset > 0 ? ['-ss', offset.toFixed(3)] : []),
    '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000',
    ...(duration ? ['-t', duration.toFixed(3)] : ['-shortest']),
    '-movflags', '+faststart',
    out,
  ]);
}

export function probe(file: string) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size,bit_rate:stream=codec_name,width,height,r_frame_rate', '-of', 'json', file], {
    encoding: 'utf8',
  });
  return r.status === 0 ? JSON.parse(r.stdout) : null;
}
