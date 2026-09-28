// Shared helpers for the Node-side tools.
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface Args {
  _: string[];
  [k: string]: string | boolean | string[] | undefined;
}

/** Minimal argv parser: positionals, `--key value`, `--key=value`, `--flag`; repeated keys become arrays. */
export function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] };
  const put = (k: string, v: string | boolean) => {
    const cur = out[k];
    if (cur === undefined) out[k] = v;
    else if (Array.isArray(cur)) cur.push(String(v));
    else out[k] = [String(cur), String(v)];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) put(a.slice(2, eq), a.slice(eq + 1));
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) put(a.slice(2), argv[++i]);
      else put(a.slice(2), true);
    } else out._.push(a);
  }
  return out;
}

export const num = (v: unknown, d: number) => (v === undefined || v === true ? d : Number(Array.isArray(v) ? v[v.length - 1] : v));
export const str = (v: unknown, d: string) => (v === undefined || v === true ? d : String(Array.isArray(v) ? v[v.length - 1] : v));
export const list = (v: unknown): string[] => (v === undefined || v === true ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);

export function ensureDir(p: string) {
  mkdirSync(p, { recursive: true });
  return p;
}

/** The film's source: timeline, shots, shaders, captions and score. */
export const FILM = join(ROOT, 'film');
/** The stem of every rendered and released file name. */
export const SLUG = 'the-arrow-of-time';

/** A folder under out/ (git-ignored), created on demand. */
export function outDir(...sub: string[]) {
  return ensureDir(join(ROOT, 'out', ...sub));
}

export function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function fmtTime(sec: number) {
  if (!isFinite(sec)) return '--:--';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m${String(s).padStart(2, '0')}s`;
}
