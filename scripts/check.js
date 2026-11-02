/**
 * A quick check without a browser: the mission is set up from the build's data and played for a
 * few minutes of game time, the computer moving as in the game and the player laying the first
 * steps (a Workshop, a Golem sent to a geyser, a bridge piece). It fails on any exception or if
 * nothing happens.
 */
import * as NS from '../src/engine.js';
import DATA from '../build/game-data.json';

const fail = (why) => { console.error(`check failed: ${why}`); process.exit(1); };
const defs = NS.loadDefs(DATA.units);
const mission = DATA.missions[0];
const options = { ...NS.DEFAULT_OPTIONS, mode: 'mission', mission: mission.id, storm: mission.storm, lang: 'en' };
const world = NS.createMatchWorld(defs, DATA.maps, DATA.missions, options, { known: [], altarLevel: 1 });
const view = world.view();
const me = world.players.get(NS.ME);
const memory = NS.createAiMemory(options.seed + 2);
const rejected = [];

function run(ticks, commands = []) {
  for (let i = 0; i < ticks; i++) {
    const ai = (world.tick - 2) % 60 === 0 ? NS.aiMove(view, { ...mission.sides[2]?.ai, player: 2, difficulty: 'normal' }, memory, () => {}) : [];
    world.step([...(i === 0 ? commands : []), ...ai]);
    for (const e of world.drainEvents()) if (e.what === 'rejected' && e.who === NS.ME) rejected.push(e.data.err);
  }
}

function place(type) {
  const t = world.templeOf(NS.ME);
  for (let y = t.y - 14; y < t.y + 18; y++) {
    for (let x = t.x - 14; x < t.x + 22; x++) {
      const a = NS.anchorFor(world.def(type), x, y);
      if (!view.canBuild({ player: NS.ME, type, ...a })) return a;
    }
  }
  return fail(`no place for ${type}`);
}

run(20);
run(150, [{ t: 'build', player: NS.ME, type: 'sunfactory', ...place('sunfactory') }]);
run(20, [{ t: 'build', player: NS.ME, type: 'sunwalker', ...place('sunwalker') }]);
const golem = [...view.entities.values()].find((e) => e.kind === 'transport' && e.owner === NS.ME);
if (!golem) fail('no Golem was built');
const geyser = [...view.entities.values()].filter((e) => e.kind === 'geyser')
  .sort((a, b) => Math.hypot(a.x - golem.x, a.y - golem.y) - Math.hypot(b.x - golem.x, b.y - golem.y))[0];
let drop = null;
for (let y = 90; y < 140 && !drop; y++) {
  for (let x = 60; x < 130 && !drop; x++) {
    for (let rot = 0; rot < 4 && !drop; rot++) if (!view.canDropPiece({ player: NS.ME, hand: 0, x, y, rot })) drop = { x, y, rot };
  }
}
if (!drop) fail('no bridge piece could be laid');
const before = view.terrainRevision;
run(1200, [
  { t: 'collect', player: NS.ME, transport: golem.id, geyser: geyser.id },
  { t: 'dropPiece', player: NS.ME, hand: 0, ...drop },
]);
if (view.terrainRevision === before) fail('the bridge piece changed nothing');
if (rejected.length) fail(`commands rejected: ${rejected.join(', ')}`);
const shop = [...view.entities.values()].find((e) => e.type === 'sunfactory' && e.owner === NS.ME);
if (!shop || shop.rising > 0) fail('the Workshop was not finished');
const played = `${world.tick} ticks, Storm Power ${Math.round(me.storm)}, ${view.entities.size} entities`;

// The computer captures a downed Priest before it has an Altar, as the player can
// (scripts/house-rules.mjs): the player's Priest down beside its Temple, one of its Golems near.
{
  const w2 = NS.createMatchWorld(defs, DATA.maps, DATA.missions, options, { known: [], altarLevel: 1 });
  const v2 = w2.view(), foe = w2.templeOf(2), mine = w2.priestOf(NS.ME);
  if ([...v2.entities.values()].some((e) => e.kind === 'building' && e.owner === 2 && e.type === 'altar')) fail('the computer has an Altar at the start');
  const open = [];
  for (let y = foe.y - 2; y < foe.y + foe.fy + 2; y++) {
    for (let x = foe.x - 2; x < foe.x + foe.fx + 2; x++) {
      const i = w2.at(x, y);
      if (w2.terrain[i] === 1 && !w2.occupant[i] && !w2.priestAt(x, y)) open.push([x, y]);
    }
  }
  if (open.length < 2) fail('no ground beside the computer\'s Temple');
  Object.assign(mine, { x: open[0][0], y: open[0][1], path: [], goal: 'idle', state: 'down', hp: 1 });
  const near = open.find(([x, y]) => Math.abs(x - mine.x) + Math.abs(y - mine.y) >= 2) ?? open[1];
  w2.spawnTransport('sunwalker', 2, near[0], near[1]);
  const orders = NS.aiMove(v2, { ...mission.sides[2]?.ai, player: 2, difficulty: 'normal' }, NS.createAiMemory(5), () => {});
  if (!orders.some((c) => c.t === 'capturePriest' && c.target === mine.id)) fail(`the computer did not send for the downed Priest without an Altar: ${orders.map((c) => c.t).join(', ')}`);
  console.log('capture: the computer sends for a downed Priest before it has an Altar');
}

// The HUD's account of Energy (src/energy.js) agrees with the rules everywhere: for every unit
// that needs Energy, at every site where the rules have nothing else against it, `ok` is whether
// the rules build it. Its own module reads A-Frame's THREE as it loads; a stand-in will do here.
globalThis.AFRAME ??= { THREE: {} };
const { energyAt } = await import('../src/energy.js');
// every unit known and in production, Workshops of every Fury, and Generators of every Fury about
// the island, so that units of every Fury and level meet sources of every kind
const home = world.templeOf(NS.ME), taken = new Set();
const freeAt = (x0, y0, w, h) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = world.at(x, y);
    if (!world.inside(x, y) || world.terrain[i] !== 1 || world.occupant[i] || taken.has(i) || world.priestAt(x, y)) return false;
  }
  return true;
};
const lay = (type, near, spread) => {
  const d = world.def(type);
  for (let tries = 0; tries < 400; tries++) {
    const x = near.x + Math.round(Math.sin(tries * 2.4) * (4 + tries / 400 * spread)), y = near.y + Math.round(Math.cos(tries * 2.4) * (4 + tries / 400 * spread));
    if (!freeAt(x, y, d.footX, d.footY)) continue;
    const b = world.spawnBuilding(type, NS.ME, x, y, 0);
    b.rising = 0;
    for (let j = y; j < y + d.footY; j++) for (let i = x; i < x + d.footX; i++) taken.add(world.at(i, j));
    return b;
  }
  return null;
};
for (const d of defs.values()) if (d.cost && NS.energyNeed(d)) me.tech.add(d.id);
for (const fury of ['sun', 'wind', 'rain', 'thunder']) {
  const maker = lay(`${fury}factory`, home, 30);
  if (maker) maker.slots = [...defs.values()].filter((d) => d.theme === fury && NS.takesSlot(d)).map((d) => d.id);
}
for (let i = 0; i < 12; i++) lay(`${['wind', 'rain', 'thunder', 'sun'][i % 4]}battery`, home, 60);
me.storm = 1e6;
let sites = 0, short = 0;
for (const def of defs.values()) {
  if (!NS.energyNeed(def) || !def.cost) continue;
  for (let y = 0; y < NS.H; y += 2) {
    for (let x = 0; x < NS.W; x += 2) {
      const err = view.canBuild({ player: NS.ME, type: def.id, x, y, ...(NS.hasFacing(def) ? { facing: 0 } : {}) });
      if (err !== null && err !== 'no energy') continue;
      const at = energyAt(def, x, y, NS.ME, view);
      if (at.ok !== (err === null)) fail(`Energy for ${def.id} at ${x},${y}: the HUD says ${at.ok ? 'enough' : `missing ${at.missing}`}, the rules ${err ?? 'build it'}`);
      sites++;
      if (!at.ok) short++;
    }
  }
}
if (!sites || !short) fail(`the Energy check saw ${sites} sites, ${short} short of Energy`);
console.log(`energy: ${sites} sites agree with the rules, ${short} of them short of Energy`);

console.log(`check passed: ${played}`);
