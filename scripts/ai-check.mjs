/**
 * The computer opponent with and without the worker's cache (scripts/ai-memo.mjs): a skirmish of
 * some minutes at each level, the computer's moves worked out as the worker does (on a copy of the
 * world made for the move). Fails unless both play exactly the same moves; prints the time a move
 * takes each way.
 *
 *   node scripts/ai-check.mjs [minutes]     (8 by default)
 */
import * as esbuild from 'esbuild';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { aiMemo } from './ai-memo.mjs';

const VENDOR = resolve('vendor/netstorm-web');
const minutes = Number(process.argv[2] ?? 8);
const entry = `
import * as NS from './src/engine.js';
import DATA from './build/game-data.json';
export function play(difficulty, ticks) {
  const defs = NS.loadDefs(DATA.units);
  const options = { ...NS.DEFAULT_OPTIONS, lang: 'en', mode: 'skirmish', opponent: 'ai', theme: 'wind', enemyTheme: 'rain', islands: 4, difficulty, storm: 2000, seed: 42 };
  const known = [...NS.AI_ALIGNMENTS.find((a) => a.name === 'Wind').tech];
  const world = NS.createMatchWorld(defs, DATA.maps, DATA.missions, options, { known, altarLevel: 1 });
  const memory = NS.createAiMemory(options.seed + 2), every = Math.round(NS.DIFFICULTY[difficulty].moveSeconds * NS.TPS);
  let digest = 0, ms = 0, worst = 0, moves = 0;
  for (let i = 0; i < ticks; i++) {
    let commands = [];
    if ((world.tick - 2) % every === 0) {
      const raw = structuredClone(world.handoff());
      for (const g of ['terrain', 'owner', 'links', 'wear', 'occupant']) raw[g] = Array.from(raw[g]);
      const copy = NS.World.fromSnapshot(raw);
      const start = performance.now();
      globalThis.__nsAiMove = true;
      commands = NS.aiMove(copy.view(), { player: 2, difficulty }, memory, () => {});
      globalThis.__nsAiMove = false;
      const took = performance.now() - start;
      ms += took; worst = Math.max(worst, took); moves++;
      for (const c of JSON.stringify(commands)) digest = (Math.imul(digest, 31) + c.charCodeAt(0)) | 0;
    }
    world.step(commands);
    world.drainEvents();
  }
  return { digest, average: ms / moves, worst, moves, entities: world.view().entities.size };
}`;

const common = {
  stdin: { contents: entry, resolveDir: resolve('.'), loader: 'js' },
  bundle: true, platform: 'node', format: 'esm', logLevel: 'warning',
  alias: {
    '@netstorm/sim': `${VENDOR}/packages/sim/src/index.ts`,
    'ns-client': `${VENDOR}/packages/client/src`,
    'ns-messages': `${VENDOR}/packages/client/messages`,
  },
};
const messages = { name: 'messages', setup(b) { b.onResolve({ filter: /paraglide\/messages\.js$/ }, () => ({ path: resolve('src/messages.js') })); } };

mkdirSync('build', { recursive: true });
const load = async (name, plugins) => {
  const out = resolve(`build/ai-check-${name}.mjs`);
  await esbuild.build({ ...common, outfile: out, plugins: [messages, ...plugins] });
  return import(`${pathToFileURL(out).href}?${Date.now()}`);
};
const plain = await load('plain', []);
const kept = await load('kept', [aiMemo({ gated: true })]);

let failed = false;
for (const level of ['normal', 'hard']) {
  const ticks = Math.round(minutes * 60 * 10);
  const a = plain.play(level, ticks), b = kept.play(level, ticks);
  const same = a.digest === b.digest && a.entities === b.entities;
  if (!same) failed = true;
  console.log(`${same ? '✓' : '✗'} ${level}, ${minutes} min, ${a.moves} moves: ${same ? 'the same moves' : 'DIFFERENT moves'}; `
    + `a move ${a.average.toFixed(0)} ms (worst ${a.worst.toFixed(0)}) → ${b.average.toFixed(0)} ms (worst ${b.worst.toFixed(0)}) with the cache`);
}
process.exit(failed ? 1 : 0);
