// Scaffold a new film from templates/starter.
//
//   npm run new -- <id> [--title "My Film"]
//
// Creates projects/<id>/ with a timeline, captions, two example shots and a score stub.
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, parseArgs, str } from './lib/util';

const args = parseArgs(process.argv.slice(2));
const id = args._[0];
if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
  console.error('usage: npm run new -- <id> [--title "My Film"]   (id: lowercase letters, digits, dashes)');
  process.exit(1);
}
const title = str(args.title, id.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()));
const dest = join(ROOT, 'projects', id);
if (existsSync(dest)) {
  console.error(`projects/${id} already exists`);
  process.exit(1);
}
cpSync(join(ROOT, 'templates', 'starter'), dest, { recursive: true });
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
for (const file of walk(dest)) {
  const src = readFileSync(file, 'utf8');
  writeFileSync(file, src.replaceAll('__ID__', id).replaceAll('__TITLE__', title));
}
console.log(`Created ${relative(ROOT, dest)}/`);
console.log(`  npm run dev                      # preview in the browser (choose "${id}")`);
console.log(`  npm run audio -- ${id}            # synthesize the score`);
console.log(`  npm run still -- ${id} --t 5       # render a still`);
console.log(`  npm run render -- ${id}            # render the film`);
