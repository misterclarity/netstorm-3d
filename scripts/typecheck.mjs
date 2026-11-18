/**
 * netstorm-web's simulation with the house rules applied, read by TypeScript.
 *
 *   npm run typecheck
 *
 * The build takes the types off without reading them (esbuild), so a slip in a house rule (a
 * misspelt member, a command or an event the declarations do not know, a value that may be
 * undefined) would show only when it runs, if then. This writes the simulation's sources out as
 * the build reads them (every change of scripts/house-rules.mjs made, the worker's cache laid in)
 * and has TypeScript check them as netstorm-web checks its own: strict, every indexed access
 * taken as possibly undefined. An error names a line of the file as written out, under
 * build/typecheck/src.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { changedFiles, withHouseRules } from './house-rules.mjs';

const SRC = resolve('vendor/netstorm-web/packages/sim/src');
const OUT = resolve('build/typecheck');
const MEMO = 'kept';

if (!existsSync(join(SRC, 'index.ts'))) {
  console.error('vendor/netstorm-web is empty: run `git submodule update --init` first.');
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
const changed = new Set(changedFiles(MEMO)), written = new Set();
let files = 0;

async function copy(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const from = join(dir, entry.name);
    if (entry.isDirectory()) { await copy(from); continue; }
    if (!entry.name.endsWith('.ts')) continue;
    const name = relative(SRC, from).split(sep).join('/'), to = join(OUT, 'src', name);
    await mkdir(dirname(to), { recursive: true });
    const text = await readFile(from, 'utf8');
    await writeFile(to, changed.has(name) ? withHouseRules(name, text, { memo: MEMO }) : text);
    if (changed.has(name)) written.add(name);
    files++;
  }
}
await copy(SRC);

const lost = [...changed].filter((name) => !written.has(name));
if (lost.length) {
  console.error(`typecheck: the house rules change ${lost.join(', ')}, which netstorm-web no longer has`);
  process.exit(1);
}

// netstorm-web's own settings (its tsconfig.base.json), for its sources alone
await writeFile(join(OUT, 'tsconfig.json'), JSON.stringify({
  compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'], types: [],
    strict: true, noUncheckedIndexedAccess: true, esModuleInterop: true, skipLibCheck: true, resolveJsonModule: true, noEmit: true,
  },
  include: ['src'],
}, null, 2));

const tsc = resolve('node_modules/typescript/bin/tsc');
const started = Date.now();
const run = spawnSync(process.execPath, [tsc, '-p', OUT, '--pretty', 'false'], { stdio: 'inherit' });
if (run.status !== 0) {
  console.error(`typecheck failed: the lines are those of ${relative('.', join(OUT, 'src'))}, the simulation as the house rules have it`);
  process.exit(run.status ?? 1);
}
console.log(`typecheck: ${files} files of the simulation with ${changed.size} changed by the house rules, no errors (${((Date.now() - started) / 1000).toFixed(1)} s)`);
