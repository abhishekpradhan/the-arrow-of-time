// GLSL chunk registry and `#include <name>` resolution.
//
// Engine chunks live in engine/shaders/*.glsl and are registered automatically.
// The film registers its own chunks (film/shaders/*.glsl):
//
//   registerChunks(import.meta.glob('./shaders/*.glsl', { query: '?raw', import: 'default', eager: true }));
//
// Includes are de-duplicated per shader, so chunks may include each other freely.

const chunks = new Map<string, string>();

function nameOf(path: string) {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.glsl$/, '');
}

export function registerChunks(files: Record<string, string>, prefix = '') {
  for (const [path, src] of Object.entries(files)) chunks.set(prefix + nameOf(path), src);
}

export function registerChunk(name: string, src: string) {
  chunks.set(name, src);
}

export function getChunk(name: string) {
  return chunks.get(name);
}

const INCLUDE_RE = /^[ \t]*#include[ \t]+[<"]([\w\-./]+)[>"][ \t]*$/gm;

export function resolveIncludes(src: string, seen = new Set<string>()): string {
  return src.replace(INCLUDE_RE, (_m, name: string) => {
    if (seen.has(name)) return `// (already included: ${name})`;
    const chunk = chunks.get(name);
    if (chunk === undefined) throw new Error(`GLSL #include <${name}> not found. Registered: ${[...chunks.keys()].join(', ')}`);
    seen.add(name);
    return `// ---- begin ${name}\n${resolveIncludes(chunk, seen)}\n// ---- end ${name}`;
  });
}

registerChunks(
  import.meta.glob('../shaders/*.glsl', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
);
