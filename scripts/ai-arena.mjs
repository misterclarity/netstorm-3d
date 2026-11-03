/**
 * Matches of the computer opponent against itself (or against a side that does nothing), set up as
 * this game's skirmish menu sets them up (its house rules, its Residences, the player's side
 * knowing its Fury), played without a browser: the yardstick for the levels of the opponent.
 *
 *   npm run ai:arena                                  # each pairing below on seeds 1-4, 30 minutes
 *   PAIRS=hard:idle,hard:easy SEEDS=1,2,3,4,5,6 npm run ai:arena
 *   MINUTES=20 JOBS=2 npm run ai:arena
 *   TUNE='{"hard":{"assaultFirst":false}}' npm run ai:arena   # a level's knobs turned for a trial
 *   PAIRS=hard:easy SEEDS=2 TRACE=1 npm run ai:arena        # one match, a line a minute
 *   … TRACE=1 EXPLAIN=12 EXPLAIN_FOR=0.5                  # and side 1's reasons from minute 12
 *   … TRACE=1 DIAG=16                                      # why no gun of side 1 stands by the Temple
 *   … TRACE=1 ECON=1                                       # each side's income every five minutes
 *
 * A side is a level (easy, normal, hard, and any added to the table) or idle. Side 1 plays Wind,
 * side 2 Rain, on four islands with 2000 Storm Power, as the menu's defaults. Each move is worked
 * out on a copy of the world with the worker's cache, as in the game.
 */
import * as esbuild from 'esbuild';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { aiMemo } from './ai-memo.mjs';
import { houseRules } from './house-rules.mjs';

const VENDOR = resolve('vendor/netstorm-web');
const OUT = resolve('build/ai-arena-match.mjs');

const entry = `
import * as NS from './src/engine.js';
import DATA from './build/game-data.json';
const defs = NS.loadDefs(DATA.units);
export async function match(seed, side1, side2, minutes, trace = false, tune = null) {
  globalThis.AFRAME ??= { THREE: {} };
  if (tune) globalThis.__nsAiTune = tune;
  const { settleResidences } = await import('./src/residences.js');
  const levels = { 1: side1, 2: side2 };
  const options = { ...NS.DEFAULT_OPTIONS, lang: 'en', mode: 'skirmish', opponent: 'ai', theme: 'wind', enemyTheme: 'rain', islands: 4,
    difficulty: side2 === 'idle' ? 'normal' : side2, storm: 2000, seed };
  const known = [...NS.AI_ALIGNMENTS.find((a) => a.name === 'Wind').tech];
  const world = NS.createMatchWorld(defs, DATA.maps, DATA.missions, options, { known, altarLevel: 1 });
  settleResidences(world, seed);
  const memory = { 1: NS.createAiMemory(seed + 1), 2: NS.createAiMemory(seed + 2) };
  const every = (p) => Math.round(NS.DIFFICULTY[levels[p]].moveSeconds * NS.TPS);
  const stat = () => ({ crystals: 0, built: 0, guns: 0, pieces: 0, lost: 0, downs: 0, captures: 0, moveMs: 0, moves: 0, rejected: 0 });
  const stats = { 1: stat(), 2: stat() };
  const ticks = Math.round(minutes * 60 * NS.TPS);
  let firstDown = null;
  const econ = { 1: 0, 2: 0 };
  for (let i = 0; i < ticks && world.winner === null; i++) {
    const commands = [];
    for (const p of [1, 2]) {
      if (levels[p] === 'idle' || (world.tick - p) % every(p) !== 0) continue;
      const raw = structuredClone(world.handoff());
      for (const g of ['terrain', 'owner', 'links', 'wear', 'occupant']) raw[g] = Array.from(raw[g]);
      let copy;
      try { copy = NS.World.fromSnapshot(raw); } catch (e) {
        // the entity the world's own check refuses, and what it points at, to find where it came from
        const id = Number(/for ([0-9]+)/.exec(e.message)?.[1]);
        const bad = raw.entities.find((x) => x.id === id);
        const target = bad?.target == null ? 'none' : raw.entities.find((x) => x.id === bad.target)?.kind ?? 'gone';
        throw new Error(\`\${e.message} at \${(world.tick / NS.TPS / 60).toFixed(2)} min: \${bad?.kind} \${bad?.goal}, its target \${bad?.target} (\${target})\`);
      }
      const t0 = performance.now();
      globalThis.__nsAiMove = true;
      // EXPLAIN=15 prints side 1's reasoning for its moves in the 15th minute
      const minute = world.tick / NS.TPS / 60, at = Number(process.env.EXPLAIN ?? -9);
      const say = p === 1 && minute >= at && minute < at + Number(process.env.EXPLAIN_FOR ?? 0.1) ? (line) => console.log(line) : () => {};
      const got = NS.aiMove(copy.view(), { player: p, difficulty: levels[p] }, memory[p], say);
      if (trace) for (const c of got) if (c.t === 'moveTransport' || c.t === 'capturePriest') console.log(\`   \${(world.tick / NS.TPS / 60).toFixed(1)} min: side \${p} \${c.t} \${c.transport} → \${c.x ?? ''},\${c.y ?? ''}\${c.target ?? ''}\`);
      commands.push(...got);
      globalThis.__nsAiMove = false;
      stats[p].moveMs += performance.now() - t0;
      stats[p].moves++;
    }
    // where each carrier was and what it was doing, for the trace of one that is lost
    const carriers = trace ? new Map([...world.entities.values()].filter((e) => e.kind === 'transport').map((e) => [e.id, { x: e.x, y: e.y, goal: e.goal, cargo: e.carrying !== null }])) : null;
    world.step(commands);
    // DIAG=16: in the 16th minute, why side 1 lays no gun that reaches the enemy Temple
    if (process.env.DIAG && world.tick === Math.round(Number(process.env.DIAG) * 60 * NS.TPS)) {
      const foe = world.templeOf(2), view = world.view(), tally = {};
      for (const id of world.players.get(1).tech) {
        const def = world.defs.get(id);
        if (!def || !(def.dps > 0) || !(def.range > 0) || def.level < 1) continue;
        for (let y = foe.y - def.range - 2; y <= foe.y + foe.fy + def.range + 2; y++) for (let x = foe.x - def.range - 2; x <= foe.x + foe.fx + def.range + 2; x++) {
          if (!world.inside(x, y)) continue;
          const got = view.canBuild({ player: 1, type: id, x, y, facing: 0 });
          const key = id + ' ' + (got ?? 'ok');
          tally[key] = (tally[key] ?? 0) + 1;
        }
      }
      console.log('DIAG', JSON.stringify(tally));
      // and what side 1 may lay beside its Temple, as the opponent lays a carrier
      const home = world.templeOf(1), near = {};
      for (const id of ['sunwalker', 'windwalker', 'windBattery', 'sunBattery']) {
        for (let y = home.y - 3; y <= home.y + home.fy + 3; y++) for (let x = home.x - 3; x <= home.x + home.fx + 3; x++) {
          const key = id + ' ' + (view.canBuild({ player: 1, type: id, x, y }) ?? 'ok');
          near[key] = (near[key] ?? 0) + 1;
        }
      }
      console.log('DIAG home', JSON.stringify(near), 'Storm', world.players.get(1).storm);
      // and side 1's carriers, and the geysers on its ground with the fire on them
      const threat1 = NS.threatMap(view, 1);
      for (const t of [...world.entities.values()].filter((e) => e.kind === 'transport' && e.owner === 1)) {
        const depots = world.depotsOf(1);
        const homeWay = world.wayOf(t, (cell) => depots.some((d) => world.adjacentTo(cell[0], cell[1], d)));
        console.log('DIAG carrier', t.id, t.type, t.x, t.y, t.goal, t.target, 'cargo', t.carrying, 'way home', homeWay?.length ?? 'none', 'depots', depots.map((d) => \`\${d.type}@\${d.x},\${d.y}\`).join(' '));
      }
      for (const g of [...world.entities.values()].filter((e) => e.kind === 'geyser' && e.stock > 0 && world.owner[world.at(e.x, e.y)] === 1)) {
        const way = view.findPath(1, home.x + home.fx, home.y + home.fy, ([x, y]) => Math.abs(x - g.x) + Math.abs(y - g.y) === 1);
        console.log('DIAG geyser', g.id, g.x, g.y, 'stock', g.stock, 'fire', threat1[world.at(g.x, g.y)], 'way', way?.length ?? 'none', 'fire on way', way ? way.reduce((a, [x, y]) => a + threat1[world.at(x, y)], 0) : '-');
      }
      // and, with the enemy Priest down, each of side 1's carriers: its way to him, and the fire on it
      const down = world.priestOf(2);
      if (down?.state === 'down') {
        const threat = NS.threatMap(view, 1);
        for (const t of [...world.entities.values()].filter((e) => e.kind === 'transport' && e.owner === 1)) {
          const path = view.findPath(1, t.x, t.y, ([x, y]) => Math.abs(x - down.x) + Math.abs(y - down.y) <= 1);
          const fire = path ? path.reduce((sum, [x, y]) => sum + threat[world.at(x, y)], 0) : null;
          console.log('DIAG carrier', t.id, t.type, 'at', t.x, t.y, t.goal, 'way', path?.length ?? 'none', 'fire', fire, 'hp', t.hp, 'speed', world.def(t.type).speed, 'Priest at', down.x, down.y);
        }
      }
    }
    // ECON=1: every five minutes each side's income, carriers, depots, and how far its geysers lie
    // from the nearest place a crystal is handed in
    if (process.env.ECON === '1' && world.tick % (300 * NS.TPS) === 0) {
      const line = [];
      for (const p of [1, 2]) {
        const mine = [...world.entities.values()].filter((e) => e.owner === p);
        const kinds = {};
        for (const t of mine.filter((e) => e.kind === 'transport')) kinds[world.def(t.type).name] = (kinds[world.def(t.type).name] ?? 0) + 1;
        const depots = world.depotsOf(p);
        const far = mine.filter((e) => e.kind === 'transport' && e.target !== null && world.entities.get(e.target)?.kind === 'geyser').map((t) => {
          const g = world.entities.get(t.target);
          return Math.min(...depots.map((d) => Math.abs(d.x + d.fx / 2 - g.x) + Math.abs(d.y + d.fy / 2 - g.y)));
        });
        line.push(\`S\${p}: +\${econ[p]} crystals, carriers \${JSON.stringify(kinds)}, depots \${depots.length}, geysers worked \${far.length ? Math.round(far.reduce((a, b) => a + b, 0) / far.length) : '-'} cells from a depot\`);
        econ[p] = 0;
      }
      console.log(\`\${(world.tick / NS.TPS / 60).toFixed(0).padStart(2)} min  \${line.join('  |  ')}\`);
    }
    if (trace && world.tick % (60 * NS.TPS) === 0) {
      const line = [];
      for (const p of [1, 2]) {
        const pl = world.players.get(p), mine = [...world.entities.values()].filter((e) => e.owner === p);
        const foe = world.templeOf(3 - p), temple = world.templeOf(p), priest = world.priestOf(p);
        const guns = mine.filter((e) => e.kind === 'building' && ['Shooter', 'Anti-Air'].includes(world.def(e.type).cls));
        const near = foe ? Math.min(Infinity, ...guns.map((g) => Math.hypot(g.x + g.fx / 2 - foe.x - foe.fx / 2, g.y + g.fy / 2 - foe.y - foe.fy / 2) - (world.def(g.type).range ?? 0))) : NaN;
        line.push(\`S\${p}: ⚡\${Math.round(pl.storm)} carriers \${mine.filter((e) => e.kind === 'transport').length} guns \${guns.length} gens \${mine.filter((e) => e.kind === 'building' && world.def(e.type).group === 'battery').length} \`
          + \`temple \${temple ? Math.round(100 * temple.hp / temple.hpMax) : 0}% priest \${priest ? \`\${Math.round(100 * priest.hp / priest.hpMax)}% \${priest.state} \${priest.goal}@\${temple ? Math.round(Math.hypot(priest.x - temple.x - temple.fx / 2, priest.y - temple.y - temple.fy / 2)) : '-'}\${priest.path.length ? '→' : ''}\` : '-'} gun→foe temple \${Number.isFinite(near) ? Math.round(near) : '-'} hand \${pl.hand.length}\`);
      }
      console.log(\`\${(world.tick / NS.TPS / 60).toFixed(0).padStart(2)} min  \${line.join('  |  ')}\`);
    }
    for (const ev of world.drainEvents()) {
      const s = stats[ev.who];
      if (!s) continue;
      if (ev.what === 'delivered') { s.crystals++; econ[ev.who]++; }
      else if (ev.what === 'build') { s.built++; if (['Shooter', 'Anti-Air'].includes(world.def(ev.data.type).cls)) s.guns++; }
      else if (ev.what === 'bridge') s.pieces++;
      else if (ev.what === 'destroyed') s.lost++;
      else if (ev.what === 'priest down') { s.downs++; firstDown ??= world.tick; }
      if (trace && ev.what === 'rejected' && ev.who === 1) console.log(\`   \${(world.tick / NS.TPS / 60).toFixed(1)} min: side 1 refused \${ev.data.cmd}: \${ev.data.err}\`);
      if (trace && ev.what === 'destroyed' && ['Ground Transport', 'Aerial Transport'].includes(world.defs.get(ev.data.type)?.cls)) {
        const was = carriers.get(ev.data.id), temple = world.templeOf(ev.who);
        const by = was ? [...world.entities.values()].filter((e) => e.kind === 'building' && e.owner && e.owner !== ev.who && (world.def(e.type).range ?? 0) > 0
          && Math.max(Math.abs(e.x + e.fx / 2 - was.x), Math.abs(e.y + e.fy / 2 - was.y)) <= world.def(e.type).range + 1).map((e) => e.type) : [];
        console.log(\`   \${(world.tick / NS.TPS / 60).toFixed(1)} min: side \${ev.who} lost carrier \${ev.data.id} (\${world.defs.get(ev.data.type)?.name ?? ev.data.type}) at \${was?.x},\${was?.y}, \${temple && was ? Math.round(Math.hypot(was.x - temple.x, was.y - temple.y)) : '-'} from home, \${was?.goal}\${was?.cargo ? ' with cargo' : ''}; guns about: \${by.join(' ') || 'none'}\`);
      }
      if (trace && ev.what === 'priest down') {
        const pr = world.priestOf(ev.who), temple = world.templeOf(ev.who);
        const guns = [...world.entities.values()].filter((e) => e.kind === 'building' && e.owner !== ev.who && e.owner && (world.def(e.type).range ?? 0) > 0
          && Math.hypot(e.x + e.fx / 2 - pr.x, e.y + e.fy / 2 - pr.y) <= (world.def(e.type).range ?? 0) + 2);
        const flyers = [...world.entities.values()].filter((e) => e.kind === 'flyer' && e.owner !== ev.who && Math.hypot(e.px / NS.FLYER_SCALE - pr.x, e.py / NS.FLYER_SCALE - pr.y) < 6);
        console.log(\`      the Priest of side \${ev.who} at \${pr.x},\${pr.y} (\${temple ? Math.round(Math.hypot(pr.x - temple.x - 2, pr.y - temple.y - 2)) : '-'} from his Temple), errand \${pr.goal}; guns in reach: \${guns.map((g) => g.type).join(' ') || 'none'}; flyers near: \${flyers.map((f) => f.type).join(' ') || 'none'}\`);
      }
      if (trace && ['priest down', 'captured', 'released', 'chained', 'sacrifice', 'too early', 'rune'].includes(ev.what)) {
        console.log(\`   \${(world.tick / NS.TPS / 60).toFixed(1)} min: \${ev.what} (side \${ev.who})\`);
      }
      else if (ev.what === 'captured') s.captures++;
      else if (ev.what === 'rejected') s.rejected++;
    }
  }
  for (const p of [1, 2]) stats[p].moveMs = stats[p].moves ? Math.round(stats[p].moveMs / stats[p].moves) : 0;
  return { seed, side1, side2, winner: world.winner, minutes: +(world.tick / NS.TPS / 60).toFixed(1),
    firstDown: firstDown === null ? null : +(firstDown / NS.TPS / 60).toFixed(1), stats };
}`;

// a child: one match, printed as a line of JSON
if (process.env.ARENA_MATCH) {
  const [seed, side1, side2, minutes] = process.env.ARENA_MATCH.split(':');
  const { match } = await import(pathToFileURL(OUT).href);
  console.log(JSON.stringify(await match(Number(seed), side1, side2, Number(minutes), process.env.TRACE === '1',
    process.env.TUNE ? JSON.parse(process.env.TUNE) : null)));
  process.exit(0);
}

mkdirSync('build', { recursive: true });
const messages = { name: 'messages', setup(b) { b.onResolve({ filter: /paraglide\/messages\.js$/ }, () => ({ path: resolve('src/messages.js') })); } };
await esbuild.build({
  stdin: { contents: entry, resolveDir: resolve('.'), loader: 'js' },
  bundle: true, platform: 'node', format: 'esm', logLevel: 'warning', outfile: OUT,
  alias: {
    '@netstorm/sim': `${VENDOR}/packages/sim/src/index.ts`,
    'ns-client': `${VENDOR}/packages/client/src`,
    'ns-messages': `${VENDOR}/packages/client/messages`,
  },
  plugins: [messages, houseRules(), aiMemo({ gated: true })],
});

if (process.env.TRACE === '1') {
  // one match, a line a minute: PAIRS=hard:easy SEEDS=1 TRACE=1 npm run ai:arena
  const [a, b] = (process.env.PAIRS ?? 'hard:easy').split(',')[0].split(':');
  const spec = `${(process.env.SEEDS ?? '1').split(',')[0]}:${a}:${b}:${Number(process.env.MINUTES ?? 30)}`;
  await new Promise((done) => execFile(process.execPath, [new URL(import.meta.url).pathname], { env: { ...process.env, ARENA_MATCH: spec }, maxBuffer: 1 << 24 },
    (error, stdout, stderr) => { process.stdout.write(stdout + stderr); done(); }));
  process.exit(0);
}

const pairs = (process.env.PAIRS ?? 'hard:idle,hard:easy,hard:normal,normal:easy,hard:hard').split(',').map((p) => p.split(':'));
const seeds = (process.env.SEEDS ?? '1,2,3,4').split(',').map(Number);
const minutes = Number(process.env.MINUTES ?? 30);
const jobs = Number(process.env.JOBS ?? 2);
const queue = pairs.flatMap(([a, b]) => seeds.map((seed) => `${seed}:${a}:${b}:${minutes}`));
const results = [];
const run = (spec) => new Promise((done) => {
  execFile(process.execPath, [new URL(import.meta.url).pathname], { env: { ...process.env, ARENA_MATCH: spec }, maxBuffer: 1 << 24 },
    (error, stdout, stderr) => {
      const line = stdout.trim().split('\n').pop();
      try { results.push(JSON.parse(line)); } catch { console.error(`match ${spec} failed: ${stderr || error?.message}`); }
      const r = results.at(-1);
      if (r) console.error(`  ${r.side1} vs ${r.side2}, seed ${r.seed}: ${r.winner === null ? 'no winner' : `side ${r.winner} (${r.winner === 1 ? r.side1 : r.side2})`} at ${r.minutes} min`);
      done();
    });
});
const started = Date.now();
await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) await run(queue.shift()); }));

console.log(`\n${results.length} matches, ${minutes} minutes each at most, ${((Date.now() - started) / 60000).toFixed(1)} min to play\n`);
console.log('pairing          wins (side 1 / side 2 / none)   minutes to win   first Priest down   Priests down 1/2   crystals 1/2   guns 1/2   move ms 1/2');
for (const [a, b] of pairs) {
  const rs = results.filter((r) => r.side1 === a && r.side2 === b);
  const w1 = rs.filter((r) => r.winner === 1), w2 = rs.filter((r) => r.winner === 2), none = rs.length - w1.length - w2.length;
  const avg = (xs) => (xs.length ? (xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(1) : '-');
  const won = [...w1, ...w2].map((r) => r.minutes), downs = rs.filter((r) => r.firstDown !== null).map((r) => r.firstDown);
  console.log(`${`${a} vs ${b}`.padEnd(17)}${`${w1.length} / ${w2.length} / ${none}`.padEnd(32)}${avg(won).padEnd(17)}${`${avg(downs)} (${downs.length}/${rs.length})`.padEnd(20)}`
    + `${`${avg(rs.map((r) => r.stats[1].downs))}/${avg(rs.map((r) => r.stats[2].downs))}`.padEnd(19)}`
    + `${`${avg(rs.map((r) => r.stats[1].crystals))}/${avg(rs.map((r) => r.stats[2].crystals))}`.padEnd(15)}${`${avg(rs.map((r) => r.stats[1].guns))}/${avg(rs.map((r) => r.stats[2].guns))}`.padEnd(11)}`
    + `${avg(rs.map((r) => r.stats[1].moveMs))}/${avg(rs.map((r) => r.stats[2].moveMs))}`);
}
