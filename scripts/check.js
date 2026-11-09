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

// A Priest sent to a geyser collects from it alone: when it is spent he stops and waits, where a
// Golem moves on to another (scripts/house-rules.mjs). Three geysers are moved onto the home
// island beside the Temple: one crystal each for the Priest and a Golem, and a full one.
{
  const w3 = NS.createMatchWorld(defs, DATA.maps, DATA.missions, options, { known: [], altarLevel: 1 });
  const v3 = w3.view(), p = w3.priestOf(NS.ME), t = w3.templeOf(NS.ME);
  const free = [];
  for (let r = 2; r < 12 && free.length < 4; r++) {
    for (let dx = -r; dx <= r && free.length < 4; dx += 3) {
      const x = t.x + dx, y = t.y + t.fy + r, i = w3.at(x, y);
      const clear = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => w3.terrain[w3.at(x + a, y + b)] === 1 && !w3.occupant[w3.at(x + a, y + b)]);
      if (clear && !w3.priestAt(x, y) && free.every(([fx, fy]) => Math.abs(fx - x) + Math.abs(fy - y) > 3)) free.push([x, y, i]);
    }
  }
  const geysers = [...v3.entities.values()].filter((g) => g.kind === 'geyser').slice(0, 3);
  if (free.length < 4 || geysers.length < 3) fail('no room to set up the geysers');
  geysers.forEach((g, k) => {
    w3.occupant[w3.at(g.x, g.y)] = 0;
    [g.x, g.y] = free[k];
    w3.occupant[free[k][2]] = g.id;
  });
  const [forPriest, forGolem, full] = geysers;
  forPriest.stock = 200;
  forGolem.stock = 200;
  full.stock = 2000;
  const carrier = w3.spawnTransport('sunwalker', NS.ME, free[3][0], free[3][1]);
  w3.step([{ t: 'collect', player: NS.ME, transport: p.id, geyser: forPriest.id }, { t: 'collect', player: NS.ME, transport: carrier.id, geyser: forGolem.id }]);
  if (p.goal !== 'collect' || carrier.goal !== 'collect') fail(`the test's orders were refused: Priest ${p.goal}, Golem ${carrier.goal}`);
  let golemOn = false, priestDone = false;
  for (let i = 0; i < 3000 && !(golemOn && priestDone); i++) {
    w3.step([]);
    w3.drainEvents();
    priestDone ||= !v3.entities.has(forPriest.id) && p.carrying === null && p.goal === 'idle' && !p.path.length;
    golemOn ||= carrier.goal === 'collect' && carrier.target === full.id;
    if (p.target === full.id) fail('the Priest walked on to another geyser when his was spent');
  }
  if (!priestDone) fail(`the Priest did not stop when his geyser was spent: goal ${p.goal}, target ${p.target}`);
  if (!golemOn) fail(`the Golem did not move on when its geyser was spent: goal ${carrier.goal}, target ${carrier.target}`);
  console.log('geysers: a Priest waits when his geyser is spent, a Golem moves on');
}

// Carriers in wait (scripts/house-rules.mjs): the player's Priest wounded but up, beside the
// computer's Temple, three of its Golems on its island. At Hard its next move sends one to wait by
// him (two always keep mining); at Easy (none in wait) it does not.
for (const [level, want] of [['hard', true], ['easy', false]]) {
  const w4 = NS.createMatchWorld(defs, DATA.maps, DATA.missions, options, { known: [], altarLevel: 1 });
  const v4 = w4.view(), foe = w4.templeOf(2), mine = w4.priestOf(NS.ME);
  const open = [];
  for (let y = foe.y - 3; y < foe.y + foe.fy + 3; y++) {
    for (let x = foe.x - 3; x < foe.x + foe.fx + 3; x++) {
      const i = w4.at(x, y);
      if (w4.terrain[i] === 1 && !w4.occupant[i] && !w4.priestAt(x, y)) open.push([x, y]);
    }
  }
  Object.assign(mine, { x: open[0][0], y: open[0][1], path: [], goal: 'idle', state: 'normal', hp: Math.floor(mine.hpMax * 0.7) });
  const far = open.filter(([x, y]) => Math.abs(x - mine.x) + Math.abs(y - mine.y) >= 6);
  for (const [x, y] of far.slice(-3)) w4.spawnTransport('sunwalker', 2, x, y);
  const orders = NS.aiMove(v4, { ...mission.sides[2]?.ai, player: 2, difficulty: level }, NS.createAiMemory(9), () => {});
  const waits = orders.filter((c) => c.t === 'moveTransport').length;
  if ((waits > 0) !== want) fail(`at ${level}, ${waits} carriers sent to wait by a wounded enemy Priest`);
}
console.log('waiting: at Hard carriers wait by a wounded enemy Priest, at Easy none');

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

// Tiered islands (scripts/house-rules.mjs): a Golem walking off its island onto a bridge a level
// up rides a lift, LIFT_SECONDS longer than the same step on one level, and takes LIFT_EXPOSURE
// times the damage on the way. A piece the player lays goes on the level asked for; one laid
// without (as the computer lays them) on the level of what it joins.
{
  const lifted = (rise) => {
    const w = NS.createMatchWorld(defs, DATA.maps, DATA.missions, options, { known: [], altarLevel: 1 });
    w.tiered = true;
    const t = w.templeOf(NS.ME);
    let x = t.x;
    while (w.terrain[t.y * NS.W + x + 1] !== 0) x++; // the island's rim, east of the Temple
    const sky = t.y * NS.W + x + 1;
    w.terrain[sky] = 2;
    w.owner[sky] = NS.ME;
    w.links[sky] = 0;
    w.level[sky] = rise;
    w.invalidateTerrain();
    const rider = w.spawnTransport('sunwalker', NS.ME, x, t.y);
    w.step([{ t: 'moveTransport', player: NS.ME, transport: rider.id, x: x + 1, y: t.y }]);
    if (!rider.path.length) fail('a Golem would not walk onto the bridge');
    const riding = w.liftLevels(rider), hp = rider.hp;
    NS.damage(w, 2, rider, 10);
    const hurt = hp - rider.hp;
    let ticks = 1;
    while (rider.x !== x + 1 && ticks < 2000) { w.step([]); ticks++; }
    return { riding, hurt, ticks };
  };
  const flat = lifted(0), up = lifted(1);
  const longer = (up.ticks - flat.ticks) / NS.TPS;
  if (flat.riding !== 0 || up.riding !== 1) fail(`lift levels: flat ${flat.riding}, up ${up.riding}`);
  if (Math.abs(longer - NS.LIFT_SECONDS) > 0.3) fail(`a lift ride took ${longer} s longer than a step, not ${NS.LIFT_SECONDS}`);
  if (Math.abs(up.hurt - flat.hurt * NS.LIFT_EXPOSURE) > 0.01) fail(`on a lift a Golem lost ${up.hurt} of a hit that took ${flat.hurt} off one on the ground`);

  const w = NS.createMatchWorld(defs, DATA.maps, DATA.missions, options, { known: [], altarLevel: 1 });
  w.tiered = true;
  const t = w.templeOf(NS.ME);
  const layOn = (level) => {
    const hand = w.players.get(NS.ME).hand;
    for (let k = 0; k < 4000 && !hand.length; k++) w.step([]);
    for (let i = 0; i < hand.length; i++) {
      for (let r = 0; r < 4; r++) {
        for (let y = t.y - 24; y < t.y + 28; y++) {
          for (let x = t.x - 24; x < t.x + 32; x++) {
            if (w.canDropPiece({ player: NS.ME, hand: i, x, y, rot: r }) !== null) continue;
            w.step([{ t: 'dropPiece', player: NS.ME, hand: i, x, y, rot: r, ...(level === undefined ? {} : { level }) }]);
            return w.level[y * NS.W + x];
          }
        }
      }
    }
    return fail('no bridge piece could be laid');
  };
  const asked = layOn(1), joined = layOn(undefined);
  if (asked !== 1) fail(`a piece asked for on level 1 went on ${asked}`);
  if (joined !== 0 && joined !== 1) fail(`a piece laid without a level went on ${joined}`);
  console.log(`lifts: a ride takes ${longer.toFixed(1)} s more and a hit ${NS.LIFT_EXPOSURE} times as much; pieces go on the level asked for`);
}

// Reach on tiered islands (scripts/house-rules.mjs): a Sun Disc Thrower does not throw down at a
// Golem on the level below, and does on its own level; a Whirligig hunts in a sphere, so a building
// two levels up is out of the reach it has across.
{
  const fresh = () => {
    const w = NS.createMatchWorld(defs, DATA.maps, DATA.missions, options, { known: [], altarLevel: 1 });
    w.tiered = true;
    // open ground in a corner of the map, away from the battle
    for (let y = 4; y < 60; y++) for (let x = 4; x < 60; x++) { w.terrain[y * NS.W + x] = 1; w.owner[y * NS.W + x] = 0; }
    w.invalidateTerrain();
    return w;
  };
  const thrown = (below) => {
    const w = fresh();
    const disc = w.spawnBuilding('sunarcher', NS.ME, 10, 10, 0);
    disc.rising = 0;
    for (let y = 10; y < 13; y++) for (let x = 10; x < 13; x++) w.level[y * NS.W + x] = 1;
    w.level[11 * NS.W + 16] = below ? 0 : 1;
    const mark = w.spawnTransport('sunwalker', 2, 16, 11);
    const hp = mark.hp;
    for (let i = 0; i < 8 * NS.TPS; i++) w.step([]);
    return hp - mark.hp;
  };
  if (thrown(true) !== 0) fail('a Disc Thrower threw down at a Golem on the level below');
  if (!(thrown(false) > 0)) fail('a Disc Thrower did not throw at a Golem on its own level');
  const hunted = (rise) => {
    const w = fresh();
    const base = w.spawnBuilding('sunaviary', NS.ME, 8, 30, 0);
    base.rising = 0;
    for (let y = 30; y < 33; y++) for (let x = 8; x < 11; x++) w.level[y * NS.W + x] = -1;
    const reach = NS.huntRadius('sunaviary', (type) => w.def(type));
    const prey = w.spawnBuilding('suncannon', 2, 8 + Math.floor(reach) - 3, 30, 0);
    prey.rising = 0;
    for (let y = 30; y < 33; y++) for (let x = prey.x; x < prey.x + 3; x++) w.level[y * NS.W + x] = -1 + rise;
    const f = w.spawnFlyer('sunflyer', NS.ME, base);
    f.home = base.id;
    w.step([]);
    return f.target === prey.id;
  };
  if (!hunted(0)) fail('a Whirligig did not hunt a building on its own level within its reach');
  if (hunted(2)) fail('a Whirligig hunted a building two levels up beyond its sphere');
  console.log('reach: a Disc Thrower throws level, not down; a Whirligig hunts in a sphere');
}

console.log(`check passed: ${played}`);
