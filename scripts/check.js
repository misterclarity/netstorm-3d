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
console.log(`check passed: ${world.tick} ticks, Storm Power ${Math.round(me.storm)}, ${view.entities.size} entities`);
