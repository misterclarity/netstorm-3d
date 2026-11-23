/**
 * A quick check without a browser: the mission is set up from the build's data and played for a
 * few minutes of game time, the computer moving as in the game and the player laying the first
 * steps (a Workshop, a Golem sent to a geyser, a bridge piece). It fails on any exception or if
 * nothing happens.
 */
import { readdirSync, readFileSync } from 'node:fs';
import * as NS from '../src/engine.js';
import DATA from '../build/game-data.json';
import { FOG, SIGHT, startFog, stepFog, seenCell, seenEntity, seenAt, raidKnown } from '../src/fog.js';

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
// up rides a lift, LIFT_SECONDS longer than the same step on one level; the lift takes the hits on
// it, the Golem none, and spent (LIFT_HP) it bursts: the bridge falls with the Golem in its car, and
// a Priest in it is thrown onto the island, knocked out. A piece the player lays goes on the level
// asked for; one laid without (as the computer lays them) on the level of what it joins.
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
    const hurt = hp - rider.hp, lift = w.lifts.get(NS.liftKey(sky - 1, sky)) ?? null;
    let ticks = 1;
    while (rider.x !== x + 1 && ticks < 2000) { w.step([]); ticks++; }
    return { riding, hurt, lift, ticks };
  };
  const flat = lifted(0), up = lifted(1);
  if (flat.hurt !== 10 || flat.lift !== null || up.hurt !== 0 || up.lift !== NS.LIFT_HP - 10) fail(`a hit on a lift's rider: on the ground ${JSON.stringify(flat)}, on the lift ${JSON.stringify(up)}`);
  // a lift spent: it bursts, its bridge falls with the Golem riding it; a Priest in it is thrown onto the island, knocked out
  const burst = (who) => {
    const w = NS.createMatchWorld(defs, DATA.maps, DATA.missions, options, { known: [], altarLevel: 1 });
    w.tiered = true;
    const t = w.templeOf(NS.ME);
    let x = t.x;
    while (w.terrain[t.y * NS.W + x + 1] !== 0) x++;
    const sky = t.y * NS.W + x + 1;
    w.terrain[sky] = 2;
    w.owner[sky] = NS.ME;
    w.links[sky] = 0;
    w.level[sky] = 1;
    w.invalidateTerrain();
    let rider;
    if (who === 'golem') {
      rider = w.spawnTransport('sunwalker', NS.ME, x, t.y);
      w.step([{ t: 'moveTransport', player: NS.ME, transport: rider.id, x: x + 1, y: t.y }]);
    } else {
      rider = w.priestOf(NS.ME);
      Object.assign(rider, { x, y: t.y, path: [], goal: 'idle' });
      w.step([{ t: 'movePriest', player: NS.ME, x: x + 1, y: t.y }]);
    }
    for (let i = 0; i < 3 && !w.liftLevels(rider); i++) w.step([]);
    if (!w.liftLevels(rider)) fail(`the ${who} did not ride the lift`);
    w.drainEvents();
    NS.damage(w, 2, rider, NS.LIFT_HP / 2);
    const held = rider.hp;
    NS.damage(w, 2, rider, NS.LIFT_HP / 2);
    const events = w.drainEvents().map((e) => e.what);
    for (let i = 0; i < 3; i++) w.step([]);
    return { held, hp: rider.hp, gone: !w.entities.has(rider.id), fell: w.terrain[sky] === 0, events, at: [rider.x - x, rider.y - t.y], state: rider.state };
  };
  const golemBurst = burst('golem'), priestBurst = burst('priest');
  if (!golemBurst.fell || !golemBurst.gone || !golemBurst.events.includes('lift destroyed')) fail(`a lift spent with a Golem in it: ${JSON.stringify(golemBurst)}`);
  if (!priestBurst.fell || priestBurst.held !== 100 || priestBurst.state !== 'down' || priestBurst.at.join() !== '0,0') fail(`a lift spent with a Priest in it: ${JSON.stringify(priestBurst)}`);
  const longer = (up.ticks - flat.ticks) / NS.TPS;
  if (flat.riding !== 0 || up.riding !== 1) fail(`lift levels: flat ${flat.riding}, up ${up.riding}`);
  if (Math.abs(longer - NS.LIFT_SECONDS) > 0.3) fail(`a lift ride took ${longer} s longer than a step, not ${NS.LIFT_SECONDS}`);

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
  console.log(`lifts: a ride takes ${longer.toFixed(1)} s more; the lift takes the hits, not its rider, and spent it bursts (the bridge falls, the Golem with it, the Priest thrown down knocked out); pieces go on the level asked for`);
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

// Day and night (scripts/house-rules.mjs): at night a Disc Thrower reaches 40% less (the Sun under a new moon), so a
// Golem 7 cells off is safe from it; by day it is hit. A Sacrifice waits for the dawn.
{
  const fresh = () => {
    const w = NS.createMatchWorld(defs, DATA.maps, DATA.missions, options, { known: [], altarLevel: 1 });
    w.nights = true;
    w.nightShare = 0.25;
    for (let y = 4; y < 60; y++) for (let x = 4; x < 60; x++) { w.terrain[y * NS.W + x] = 1; w.owner[y * NS.W + x] = 0; }
    w.invalidateTerrain();
    return w;
  };
  const night = NS.DAY_SECONDS * NS.TPS;
  const thrown = (at) => {
    const w = fresh();
    w.tick = at;
    const disc = w.spawnBuilding('sunarcher', NS.ME, 10, 10, 0);
    disc.rising = 0;
    const mark = w.spawnTransport('sunwalker', 2, 18, 11);
    const hp = mark.hp;
    for (let i = 0; i < 8 * NS.TPS; i++) w.step([]);
    return { night: w.isNight(), hurt: hp - mark.hp };
  };
  const byDay = thrown(0), byNight = thrown(night + NS.TPS);
  if (byDay.night || !(byDay.hurt > 0)) fail(`by day a Disc Thrower did not hit a Golem 7 cells off: ${JSON.stringify(byDay)}`);
  if (!byNight.night || byNight.hurt !== 0) fail(`at night a Disc Thrower hit a Golem 7 cells off: ${JSON.stringify(byNight)}`);
  const ritual = (at) => {
    const w = fresh();
    w.tick = at;
    const altar = w.spawnBuilding('altar', NS.ME, 20, 20, 0);
    altar.rising = 0;
    const mine = w.priestOf(NS.ME), theirs = w.priestOf(2);
    Object.assign(mine, { x: 19, y: 22, path: [], goal: null });
    Object.assign(theirs, { state: 'chained', chainedAt: altar.id, carriedBy: null, x: 23, y: 23, runes: 0, runeTimer: 0 });
    for (let i = 0; i < 30 * NS.TPS && w.isNight() === (at >= night); i++) w.step([]);
    return { night: w.isNight(), runes: theirs.runes };
  };
  const dayRunes = ritual(0), nightRunes = ritual(night + NS.TPS);
  if (!(dayRunes.runes > 0)) fail(`by day a Sacrifice did not go on: ${JSON.stringify(dayRunes)}`);
  if (nightRunes.runes !== 0) fail(`at night a Sacrifice went on: ${JSON.stringify(nightRunes)}`);
  console.log(`day and night: at night a Disc Thrower, a Sun gun under a new moon, reaches 40% less; a Sacrifice waits for the dawn (${dayRunes.runes} runes by day, none by night)`);
}

// The moon, the Furies and the weight of a hit (scripts/house-rules.mjs): the moon's phases night
// by night, Rain by the moon and the Sun by day, reach by the moon, by light and by height, siege
// and light guns, the Priest's ward, Whirligigs grounded at night, a Sun Generator dark at night,
// a Priest's healing and praying, Thunder's Spells and crystals at night.
{
  const fresh = (nights = true) => {
    const w = NS.createMatchWorld(defs, DATA.maps, DATA.missions, options, { known: [], altarLevel: 1 });
    w.nights = nights;
    w.nightShare = 0.25;
    for (let y = 4; y < 60; y++) for (let x = 4; x < 60; x++) { w.terrain[y * NS.W + x] = 1; w.owner[y * NS.W + x] = 0; }
    w.invalidateTerrain();
    return w;
  };
  const night = (n) => Math.round((n * (NS.DAY_SECONDS + NS.NIGHT_SECONDS) + NS.DAY_SECONDS + 1) * NS.TPS);
  const raise = (w, type, x, y, owner = NS.ME, facing = 0) => { const b = w.spawnBuilding(type, owner, x, y, facing); b.rising = 0; return b; };
  const near = (a, b) => Math.abs(a - b) < 1e-9;

  const w = fresh();
  const phases = [0, 1, 2, 3, 4].map((n) => { w.tick = night(n); return NS.MOON_PHASES[w.moonPhase()]; });
  if (phases.join() !== 'new moon,first quarter,full moon,third quarter,new moon') fail(`the moon's phases: ${phases}`);
  const rain = [0, 1, 2, 3].map((n) => { w.tick = night(n); return w.furyStrength('rain'); });
  if (rain.join() !== '0.9,1.1,1.25,1.1') fail(`Rain by the moon: ${rain}`);
  w.tick = 0;
  if (w.furyStrength('sun') !== 1.15 || w.furyStrength('rain') !== 1 || w.furyStrength('wind') !== 1) fail('the Sun by day');
  w.tick = night(2);
  if (w.furyStrength('sun') !== 1) fail('the Sun at night');
  const off = fresh(false);
  off.tick = night(2);
  if (off.furyStrength('rain') !== 1 || off.furyStrength('sun') !== 1) fail('the Furies with nights off');

  // reach by the moon and by light
  const cut = (n, type, extra) => {
    const ww = fresh();
    ww.tick = night(n);
    const b = raise(ww, type, 10, 10);
    if (extra) raise(ww, extra, 14, 10);
    return NS.nightCut(ww, b);
  };
  const cuts = {
    crossbowNew: cut(0, 'windarcher'), crossbowQuarter: cut(1, 'windarcher'), crossbowFull: cut(2, 'windarcher'),
    discNew: cut(0, 'sunarcher'), thunder: cut(0, 'thundercannon'), lit: cut(0, 'windarcher', 'windbattery'),
    sunLit: cut(0, 'windarcher', 'sunbattery'),
  };
  if (!near(cuts.crossbowNew, 0.25) || !near(cuts.crossbowQuarter, 0.1875) || !near(cuts.crossbowFull, 0.125)) fail(`reach by the moon: ${JSON.stringify(cuts)}`);
  if (!near(cuts.discNew, 0.4) || cuts.thunder !== 0) fail(`reach by Fury: ${JSON.stringify(cuts)}`);
  if (cuts.lit !== 0 || !near(cuts.sunLit, 0.25)) fail(`reach by an Energy ring's light: ${JSON.stringify(cuts)}`);
  {
    const ww = fresh();
    ww.tick = night(0);
    const crossbow = raise(ww, 'windarcher', 10, 10), base = raise(ww, 'rainaviary', 50, 50, 2);
    raise(ww, 'thunderarcher', 30, 10);
    const lighted = ww.spawnFlyer('rainflyer', 2, base), dark = ww.spawnFlyer('rainflyer', 2, base);
    Object.assign(lighted, { x: 33, y: 12 });
    Object.assign(dark, { x: 12, y: 40 });
    const seen = NS.nightCut(ww, crossbow, lighted), unseen = NS.nightCut(ww, crossbow, dark);
    if (seen !== 0 || !near(unseen, 0.25)) fail(`a Vander Tower's beam: ${seen} ${unseen}`);
  }

  // siege and light guns, and the Priest's ward
  {
    const ww = fresh(false);
    const cannon = raise(ww, 'suncannon', 10, 10), walker = ww.spawnTransport('sunwalker', 2, 30, 11);
    const wall = raise(ww, 'windbattery', 30, 30, 2), crossbow = raise(ww, 'windarcher', 20, 20);
    const parts = (gun, target) => NS.hitParts(ww, gun, target).against;
    const against = [parts(cannon, walker), parts(cannon, wall), parts(crossbow, walker), parts(crossbow, wall)];
    if (against.join() !== '0.5,1.5,1,0.75') fail(`siege and light guns: ${against}`);
    const priest = ww.priestOf(2), hp = priest.hp;
    NS.damage(ww, NS.ME, priest, 145, cannon);
    if (hp - priest.hp !== NS.PRIEST_WARD) fail(`a Priest's ward: ${hp} to ${priest.hp}`);
  }
  // a Sun Cannon's first shot at a Golem in its line: 80 at full weight, 40 on a unit
  const shot = (() => {
    const ww = fresh(false);
    const cannon = raise(ww, 'suncannon', 10, 10, NS.ME, 1);
    const walker = ww.spawnTransport('sunwalker', 2, cannon.x + cannon.fx + 4, cannon.y + (cannon.fy >> 1));
    const hp = walker.hp;
    for (let i = 0; i < 12 * NS.TPS && walker.hp === hp; i++) ww.step([]);
    return hp - walker.hp;
  })();
  if (!(shot > 0 && shot <= 45)) fail(`a Sun Cannon's shot at a Golem took ${shot}`);

  // by height on tiered islands
  {
    const ww = fresh(false);
    ww.tiered = true;
    const ice = raise(ww, 'raincannon', 10, 10), disc = raise(ww, 'sunarcher', 10, 20);
    for (const b of [ice, disc]) for (let y = b.y; y < b.y + b.fy; y++) for (let x = b.x; x < b.x + b.fx; x++) ww.level[y * NS.W + x] = 1;
    const low = ww.spawnTransport('sunwalker', 2, 30, 11), high = ww.spawnTransport('sunwalker', 2, 30, 14);
    ww.level[11 * NS.W + 30] = -1;
    ww.level[14 * NS.W + 30] = 1;
    const heights = [NS.hitParts(ww, ice, low).height, NS.hitParts(ww, ice, high).height, NS.hitParts(ww, disc, low).height];
    if (!near(heights[0], 1.4) || heights[1] !== 1 || heights[2] !== 1) fail(`hits by height: ${heights}`);
    ww.level[14 * NS.W + 30] = 2;
    if (!near(NS.hitParts(ww, ice, high).height, 0.8)) fail(`a hit upward: ${NS.hitParts(ww, ice, high).height}`);
    const reach = NS.gunReach(ww, ice, 32, low);
    if (reach !== 38) fail(`reach two levels down: ${reach}`);
  }

  // Whirligigs at night, a Sun Generator at night
  const launched = (at) => {
    const ww = fresh();
    ww.tick = at;
    const base = raise(ww, 'sunaviary', 20, 20);
    for (let i = 0; i < 8 * NS.TPS; i++) ww.step([]);
    return [...ww.entities.values()].some((e) => e.kind === 'flyer' && e.home === base.id);
  };
  if (!launched(0) || launched(night(0))) fail('Whirligigs take off by day only');
  {
    const ww = fresh();
    raise(ww, 'sunbattery', 20, 20);
    const day = ww.energy(NS.ME).own;
    ww.tick = night(0);
    const dark = ww.energy(NS.ME).own;
    if (day - dark !== 1) fail(`a Sun Generator at night: ${day} by day, ${dark} at night`);
  }

  // a Priest's healing and prayer, Thunder's Spells
  const priestly = (at, set, ticks) => {
    const ww = fresh();
    ww.tick = at;
    const p = ww.priestOf(NS.ME);
    Object.assign(p, { path: [], goal: null }, set);
    const hp = p.hp;
    let cast = -1;
    for (let i = 0; i < ticks; i++) {
      ww.step([]);
      if (cast < 0 && set.casting && p.casting === 0) cast = i + 1;
    }
    return { healed: p.hp - hp, praying: p.praying, cast };
  };
  const healDay = priestly(0, { hp: 2 }, 30 * NS.TPS).healed, healNight = priestly(night(0), { hp: 2 }, 30 * NS.TPS).healed;
  if (!(healDay > healNight * 1.3)) fail(`a Priest heals faster by day: ${healDay} by day, ${healNight} at night`);
  const prayDay = priestly(0, { prayer: 'bombexplodesmall', praying: 80 }, 80).praying;
  const prayNight = priestly(night(0), { prayer: 'bombexplodesmall', praying: 80 }, 80).praying;
  if (prayDay !== 0 || !(prayNight >= 15 && prayNight <= 25)) fail(`prayers at night: ${prayDay} left by day, ${prayNight} at night`);
  const castDay = priestly(0, { casting: 60, spell: 'bomblightingzap' }, 80).cast;
  const castNight = priestly(night(0), { casting: 60, spell: 'bomblightingzap' }, 80).cast;
  if (castDay !== 60 || !(castNight >= 43 && castNight <= 47)) fail(`Thunder's Spells at night: ${castDay} ticks by day, ${castNight} at night`);

  // a crystal brought home at night
  const banked = (at) => {
    const ww = fresh();
    ww.tick = at;
    const t = ww.templeOf(NS.ME);
    const walker = ww.spawnTransport('sunwalker', NS.ME, t.x - 1, t.y);
    const crystal = ww.spawnCrystal(walker, 20);
    Object.assign(walker, { goal: 'home', path: [], carrying: crystal.id });
    const storm = ww.players.get(NS.ME).storm;
    for (let i = 0; i < 2 * NS.TPS && walker.carrying !== null; i++) ww.step([]);
    return ww.players.get(NS.ME).storm - storm;
  };
  const crystalDay = banked(0), crystalNight = banked(night(0));
  if (crystalDay !== 20 || crystalNight !== 25) fail(`a crystal brought home: ${crystalDay} by day, ${crystalNight} at night`);

  // the computer's copy of the world (made from the hand-off, as in its worker) keeps the levels and the night
  {
    const ww = fresh();
    ww.tiered = true;
    ww.level[5 * NS.W + 5] = 1;
    ww.tick = night(2);
    const raw = structuredClone(ww.handoff());
    for (const g of ['terrain', 'owner', 'links', 'wear', 'occupant']) raw[g] = Array.from(raw[g]);
    const copy = NS.World.fromSnapshot(raw);
    const kept = { nights: copy.nights, share: copy.nightShare, tiered: copy.tiered, level: copy.level[5 * NS.W + 5], night: copy.isNight(), moon: copy.moonPhase() };
    if (!kept.nights || kept.share !== 0.25 || !kept.tiered || kept.level !== 1 || !kept.night || kept.moon !== 2) fail(`the computer's copy of the world: ${JSON.stringify(kept)}`);
  }

  console.log(`the moon and the Furies: ${phases.slice(0, 4).join(', ')}; Rain ${rain.join('/')}; a Sun Cannon's shot at a Golem ${shot}; a Priest heals ${healDay} by day, ${healNight} at night; a crystal ${crystalDay} by day, ${crystalNight} at night`);
}

// Walking by hand and cover (scripts/house-rules.mjs): a Priest steered walks his pace the way he
// is steered, to the hair the view foresees, diagonally as well, stops where he is the moment he
// is told, slides along the rim instead of stepping off it, does not walk into a tree, breaks a
// prayer off, and an order from above walks him by the grid again. A shot at a Golem behind an
// enemy Generator hits the Generator; behind a tree it is stopped; from a level above it gets
// through; and a gun does not aim at a unit in cover.
{
  const fresh = () => {
    const w = NS.createMatchWorld(defs, DATA.maps, DATA.missions, options, { known: [], altarLevel: 1 });
    for (let y = 4; y < 60; y++) for (let x = 4; x < 60; x++) { w.terrain[y * NS.W + x] = 1; w.owner[y * NS.W + x] = 0; }
    for (const e of [...w.entities.values()]) if (e.kind === 'building' && e.x < 64 && e.y < 64) w.entities.delete(e.id);
    w.invalidateTerrain();
    return w;
  };
  const S = NS.WALK_SUB, step = (1.8 * S) / NS.TPS;
  const steer = (w, vx, vy, lead = 0) => w.step([{ t: 'steerPriest', player: NS.ME, vx, vy, lead }]);
  // an open stretch of ground with no tree on it, n cells east of (x, y)
  const open = (w, n) => {
    for (let y = 10; y < 50; y++) for (let x = 10; x < 50 - n; x++) {
      let ok = true;
      for (let k = -1; k <= n; k++) for (let j = -1; j <= 1; j++) if (w.treeAt(x + k, y + j) || w.takenBy(x + k, y + j)) ok = false;
      if (ok) return [x, y];
    }
    return fail('no open ground');
  };
  const w = fresh(), p = w.priestOf(NS.ME);
  const [ox, oy] = open(w, 6);
  Object.assign(p, { x: ox, y: oy, path: [], goal: 'idle' });
  steer(w, 100, 0);
  const s = w.walking.get(p.id), x0 = ox * S + S / 2;
  for (let i = 0; i < 8; i++) w.step([]);
  const ahead = NS.walkStep(w, p, s.x, s.y, s.vx, s.vy, 1);
  w.step([]);
  const walked = (s.x - x0) / S;
  if (Math.abs(s.x - x0 - 10 * step) > 10 || s.y !== oy * S + S / 2 || p.x !== Math.floor(s.x / S)) fail(`a Priest steered east: ${JSON.stringify({ walked, s, p: [p.x, p.y] })}`);
  if (Math.round(ahead.x) !== s.x || Math.round(ahead.y) !== s.y) fail(`the view's foresight of his step: ${JSON.stringify({ ahead, s })}`);
  // let go half way into a tick: he walks that half and no more
  const was = s.x;
  steer(w, 0, 0, 50);
  const stopped = s.x;
  for (let i = 0; i < 5; i++) w.step([]);
  if (Math.abs(stopped - was - step / 2) > 2 || s.x !== stopped) fail(`a Priest let go of: ${JSON.stringify({ was, stopped, now: s.x })}`);
  // diagonally, at his pace
  const d0 = [s.x, s.y];
  steer(w, 71, -71);
  for (let i = 0; i < 4; i++) w.step([]);
  const diag = Math.hypot(s.x - d0[0], s.y - d0[1]) / (5 * step);
  if (!(s.x > d0[0] && s.y < d0[1]) || Math.abs(diag - 1) > 0.02) fail(`a Priest steered north-east: ${JSON.stringify({ d0, s, diag })}`);
  // to the rim of the island: he stops short of the sky
  steer(w, 0, -100);
  for (let i = 0; i < 400; i++) w.step([]);
  if (w.terrain[(p.y - 1) * NS.W + p.x] !== 0 || s.y < p.y * S || s.y > p.y * S + S / 2) fail(`a Priest steered at the rim: ${JSON.stringify({ s, p: [p.x, p.y] })}`);
  // walking breaks a prayer off; an order from above walks him by the grid again
  steer(w, 0, 0);
  Object.assign(p, { prayer: 'bombexplodesmall', praying: 50 });
  steer(w, 0, 100);
  if (p.praying !== 0) fail(`a Priest steered kept on praying: ${p.praying}`);
  w.step([{ t: 'movePriest', player: NS.ME, x: p.x, y: p.y + 3 }]);
  w.step([]);
  if (w.walking.has(p.id) || !p.path.length) fail(`an order from above did not walk him by the grid: ${JSON.stringify({ walking: w.walking.get(p.id), path: p.path })}`);
  // a tree stands in his way
  let tree = null;
  for (let y = 12; y < 50 && !tree; y++) for (let x = 12; x < 50 && !tree; x++) if (w.treeAt(x, y) && !w.takenBy(x - 1, y) && !w.treeAt(x - 1, y) && !w.treeAt(x - 2, y)) tree = [x, y];
  if (!tree) fail('no tree on the island');
  Object.assign(p, { x: tree[0] - 2, y: tree[1], path: [], goal: 'idle' });
  w.walking.delete(p.id);
  steer(w, 100, 0);
  for (let i = 0; i < 30; i++) w.step([]);
  if (p.x !== tree[0] - 1 || w.walking.get(p.id).x > tree[0] * S) fail(`a Priest walked into a tree: ${JSON.stringify({ tree, p: [p.x, p.y], s: w.walking.get(p.id) })}`);

  // cover
  const shotAt = (setup, type = 'sunarcher') => {
    const ww = fresh();
    const [gx, gy] = open(ww, 9);
    const gun = ww.spawnBuilding(type, NS.ME, gx, gy - 1, 1);
    gun.rising = 0;
    const walker = ww.spawnTransport('sunwalker', 2, gx + 7, gy);
    const cover = setup(ww, gun, walker);
    const hp = walker.hp, coverHp = cover?.hp;
    for (let i = 0; i < 12 * NS.TPS; i++) ww.step([]);
    return { hurt: hp - walker.hp, coverHurt: cover ? coverHp - cover.hp : null, inCover: !!NS.coverFor(ww, gun, walker) };
  };
  const bare = shotAt(() => null);
  const behindGenerator = shotAt((ww, gun, walker) => { const g = ww.spawnBuilding('windbattery', 2, walker.x - 2, walker.y, 0); g.rising = 0; return g; });
  const behindTree = shotAt((ww, gun, walker) => {
    let t = null;
    for (let y = 12; y < 50 && !t; y++) for (let x = 20; x < 50 && !t; x++) if (ww.treeAt(x, y) && !ww.takenBy(x + 1, y) && !ww.treeAt(x + 1, y)) t = [x, y];
    walker.x = t[0] + 1; walker.y = t[1];
    ww.moveTransportIndex?.(walker, gun.x + 7, gun.y + 1);
    gun.x = t[0] - 6; gun.y = t[1] - 1;
    return null;
  });
  if (!(bare.hurt > 0) || bare.inCover) fail(`a Golem in the open: ${JSON.stringify(bare)}`);
  if (behindGenerator.hurt !== 0 || !behindGenerator.inCover) fail(`a Golem behind an enemy Generator: ${JSON.stringify(behindGenerator)}`);
  if (behindTree.hurt !== 0 || !behindTree.inCover) fail(`a Golem behind a tree: ${JSON.stringify(behindTree)}`);
  const fromAbove = shotAt((ww, gun, walker) => {
    ww.tiered = true;
    for (let y = gun.y; y < gun.y + gun.fy; y++) for (let x = gun.x; x < gun.x + gun.fx; x++) ww.level[y * NS.W + x] = 1;
    const g = ww.spawnBuilding('windbattery', NS.ME, walker.x - 2, walker.y, 0);
    g.rising = 0;
    return g;
  }, 'windarcher');
  if (!(fromAbove.hurt > 0) || fromAbove.inCover) fail(`a Golem in cover from a gun a level up: ${JSON.stringify(fromAbove)}`);
  console.log(`walking by hand: ${walked.toFixed(2)} cells in a second, stopped on the hair, ${diag.toFixed(2)} of his pace diagonally, short of the rim and of a tree; cover: a Golem in the open lost ${bare.hurt}, behind a Generator nothing (the Generator ${behindGenerator.coverHurt}), behind a tree nothing, from a level up ${fromAbove.hurt}`);
}

// Dungeons (scripts/house-rules.mjs): one is dug under a skirmish's starting island, the same from
// the same seed: rooms of their kinds, chests reachable from the stairs, one holding a Spell; no
// building on its portal. A Priest beside the portal goes down, is out of every gun's reach below,
// walks the dungeon by hand (not through its walls), opens the chest beside him and holds its
// Spell, cannot cast it below, climbs out beside the stairs and not elsewhere, may not go down
// again at once, and the deep air brings him up after DEEP_SECONDS.
{
  const skirmish = (seed) => {
    const opts = { ...NS.DEFAULT_OPTIONS, lang: 'en', mode: 'skirmish', opponent: 'ai', theme: 'wind', enemyTheme: 'rain', islands: 4, difficulty: 'normal', storm: 2000, seed, spells: 'none' };
    return NS.createMatchWorld(defs, DATA.maps, DATA.missions, opts, { known: [], altarLevel: 1 });
  };
  const map = (d) => {
    const ch = { 0: '#', 1: '.', 2: 'S', 3: 'o', 4: '~', 5: 'C' };
    const rows = [];
    for (let y = 0; y < d.h; y++) rows.push(d.tiles.slice(y * d.w, (y + 1) * d.w).map((t) => ch[t]).join(''));
    return rows.join('\n');
  };
  const kinds = new Set();
  let seeds = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const w = skirmish(seed), d = NS.digDungeon(w, NS.ME, seed);
    if (!d) fail(`no dungeon dug on seed ${seed}`);
    const again = NS.digDungeon(skirmish(seed), NS.ME, seed);
    if (JSON.stringify(again.tiles) !== JSON.stringify(d.tiles) || again.x !== d.x || again.y !== d.y) fail(`seed ${seed} dug two dungeons`);
    if (process.env.DUNGEON_MAP === String(seed)) console.log(map(d), JSON.stringify(d.rooms), d.arrive);
    if (d.rooms.length < 6 || d.chests.length < 2 || d.chests.filter((c) => c.role === 'spell').length !== 1 || !d.things.some((t) => t.kind === 'tunnel')) fail(`seed ${seed}: ${d.rooms.length} rooms, chests ${JSON.stringify(d.chests)}`);
    for (const r of d.rooms) kinds.add(r.kind);
    // every chest has a floor tile beside it the stairs reach
    const N = d.w, seen = new Uint8Array(N * N), q = [d.arrive[1] * N + d.arrive[0]];
    seen[q[0]] = 1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % N, y = (i / N) | 0;
      for (const [dx, dy] of NS.DIRS) { const j = (y + dy) * N + x + dx; if (!seen[j] && (d.tiles[j] === NS.TILE.floor || d.tiles[j] === NS.TILE.pit)) { seen[j] = 1; q.push(j); } }
    }
    for (const c of [...d.chests, ...d.things]) if (!NS.DIRS.some(([dx, dy]) => seen[(c.y + dy) * N + c.x + dx])) fail(`seed ${seed}: ${c.kind ?? 'chest'} ${c.id} out of reach`);
    for (const r of d.rooms) if (!seen[(r.y + (r.h >> 1)) * N + r.x + (r.w >> 1)] && d.tiles[(r.y + (r.h >> 1)) * N + r.x + (r.w >> 1)] === NS.TILE.floor) fail(`seed ${seed}: a ${r.kind} room out of reach`);
    if (w.view().canBuild({ player: NS.ME, type: 'windbattery', ...NS.anchorFor(w.def('windbattery'), d.x, d.y) }) === null) fail(`seed ${seed}: a Generator could be built on the portal`);
    seeds++;
  }
  if (kinds.size < 6) fail(`the dungeons' rooms are of only ${[...kinds]}`);

  const w = skirmish(3), d = NS.digDungeon(w, NS.ME, 3), p = w.priestOf(NS.ME);
  const go = (cmd) => { w.step([{ player: NS.ME, ...cmd }]); return w.drainEvents().filter((e) => e.what === 'rejected').map((e) => e.data.err); };
  Object.assign(p, { x: d.x - 6, y: d.y, path: [], goal: 'idle' });
  if (!go({ t: 'enterDungeon' }).length || w.below.has(p.id)) fail('a Priest went down far from the portal');
  Object.assign(p, { x: d.x - 1, y: d.y });
  if (go({ t: 'enterDungeon' }).length || !w.below.has(p.id)) fail('a Priest beside the portal did not go down');
  const b = w.below.get(p.id);
  // out of reach of everything above
  const hp = p.hp;
  NS.damage(w, 2, p, 40, w.templeOf(2));
  if (p.hp !== hp) fail('a Priest below was hurt');
  // walking: east from where he arrives until a wall stops him, short of it
  go({ t: 'steerPriest', vx: 100, vy: 0, lead: 0 });
  for (let i = 0; i < 200; i++) w.step([]);
  const tx = Math.floor(b.x / NS.WALK_SUB), ty = Math.floor(b.y / NS.WALK_SUB);
  if (d.tiles[ty * d.w + tx] !== NS.TILE.floor || d.tiles[ty * d.w + tx + 1] === NS.TILE.floor || b.x === d.arrive[0] * NS.WALK_SUB + NS.WALK_SUB / 2) fail(`a Priest below walked ${JSON.stringify({ tx, ty, b })}`);
  go({ t: 'steerPriest', vx: 0, vy: 0, lead: 0 });
  // the chest with a Spell: too far to open, then beside it
  const chest = d.chests.find((c) => c.role === 'spell');
  if (!go({ t: 'openChest', chest: chest.id }).length) fail('a chest far off was opened');
  const beside = NS.DIRS.map(([dx, dy]) => [chest.x + dx, chest.y + dy]).find(([x, y]) => d.tiles[y * d.w + x] === NS.TILE.floor);
  Object.assign(b, { x: beside[0] * NS.WALK_SUB + NS.WALK_SUB / 2, y: beside[1] * NS.WALK_SUB + NS.WALK_SUB / 2 });
  if (go({ t: 'openChest', chest: chest.id }).length || p.spell !== chest.holds[0] || !chest.opened) fail(`the chest beside him: ${JSON.stringify({ chest, spell: p.spell })}`);
  if (!go({ t: 'castSpell', transport: p.id }).length) fail('a Spell was cast below');
  // out: not from where he stands, then beside the stairs; not down again at once
  if (!go({ t: 'leaveDungeon' }).length) fail('a Priest climbed out far from the stairs');
  Object.assign(b, { x: d.arrive[0] * NS.WALK_SUB + NS.WALK_SUB / 2, y: d.arrive[1] * NS.WALK_SUB + NS.WALK_SUB / 2 });
  if (go({ t: 'leaveDungeon' }).length || w.below.has(p.id) || p.x !== d.x - 1) fail('a Priest beside the stairs did not climb out');
  if (!go({ t: 'enterDungeon' }).includes('not ready')) fail('a Priest went down again at once');
  for (let i = 0; i < NS.REENTER_SECONDS * NS.TPS; i++) w.step([]);
  if (go({ t: 'enterDungeon' }).length) fail('a Priest could not go down again after a while');
  for (let i = 0; i < NS.DEEP_SECONDS * NS.TPS; i++) w.step([]);
  if (w.below.has(p.id)) fail('the deep air did not bring the Priest up');
  // the Hover: prayed for standing still (a step breaks it off), then 1.8 times his pace while it lasts
  {
    const hw = skirmish(3), priest = hw.priestOf(NS.ME);
    const cmd = (c) => { hw.step([{ player: NS.ME, ...c }]); return hw.drainEvents().filter((e) => e.what === 'rejected').length; };
    if (!cmd({ t: 'hover', on: true })) fail('a Priest hovered without the Hover');
    cmd({ t: 'prayHover' });
    cmd({ t: 'steerPriest', vx: 100, vy: 0, lead: 0 });
    cmd({ t: 'steerPriest', vx: 0, vy: 0, lead: 0 });
    if (hw.hover.get(priest.id).pray !== 0 || hw.hover.get(priest.id).charge !== 0) fail('a step did not break the prayer for the Hover off');
    cmd({ t: 'prayHover' });
    for (let i = 0; i < NS.HOVER_PRAY_SECONDS * NS.TPS; i++) hw.step([]);
    const h = hw.hover.get(priest.id);
    if (h.charge !== NS.HOVER_SECONDS * NS.TPS) fail(`the Hover prayed for: ${JSON.stringify(h)}`);
    const dug = NS.digDungeon(hw, NS.ME, 3);
    Object.assign(priest, { x: dug.x - 1, y: dug.y, path: [] });
    hw.walking.delete(priest.id);
    cmd({ t: 'enterDungeon' });
    const hb = hw.below.get(priest.id), dash = (on) => {
      Object.assign(hb, { x: (dug.arrive[0] + 0.5) * NS.WALK_SUB, y: (dug.arrive[1] + 0.5) * NS.WALK_SUB, vx: 0, vy: 0 });
      cmd({ t: 'hover', on });
      const sx = dug.stairs[0] - dug.arrive[0], sy = dug.stairs[1] - dug.arrive[1], x0 = hb.x, y0 = hb.y;
      cmd({ t: 'steerPriest', vx: -sx * 100, vy: -sy * 100, lead: 0 });
      hw.step([]);
      cmd({ t: 'steerPriest', vx: 0, vy: 0, lead: 0 });
      return Math.hypot(hb.x - x0, hb.y - y0);
    };
    const walk = dash(false), left = h.charge, fly = dash(true);
    if (Math.abs(fly / walk - NS.HOVER_PACE) > 0.05 || h.charge >= left || !(h.charge > left - 5)) fail(`hovering: ${JSON.stringify({ walk, fly, left, h })}`);
    h.charge = 1;
    cmd({ t: 'steerPriest', vx: 0, vy: 100, lead: 0 });
    hw.step([]);
    if (h.on || h.charge !== 0 || NS.hoverNow(hw, priest) !== 1) fail(`the Hover spent: ${JSON.stringify(h)}`);
  }
  // what the dungeons give and take: the vault and its key, a tunnel to the enemy's dungeon, the
  // roots of his Generators, a pit only the Hover crosses, a lurker's bite, and a charge under the Altar
  {
    const dw = skirmish(4), mine = NS.digDungeon(dw, NS.ME, 4), his = NS.digDungeon(dw, 2, 5), pr = dw.priestOf(NS.ME);
    const cmd = (c) => { dw.step([{ player: NS.ME, ...c }]); return dw.drainEvents().filter((e) => e.what === 'rejected').length; };
    for (const u of [mine, his]) u.lurkers.length = 0;
    Object.assign(pr, { x: mine.x - 1, y: mine.y, path: [] });
    cmd({ t: 'enterDungeon' });
    const bb = dw.below.get(pr.id), by = (u, c) => { const [x, y] = NS.DIRS.map(([dx, dy]) => [c.x + dx, c.y + dy]).find(([ux, uy]) => u.tiles[uy * u.w + ux] === NS.TILE.floor); Object.assign(bb, { x: (x + 0.5) * NS.WALK_SUB, y: (y + 0.5) * NS.WALK_SUB }); };
    const vault = mine.chests.find((c) => c.role === 'vault'), key = mine.chests.find((c) => c.role === 'key'), storm = () => dw.players.get(NS.ME).storm;
    if (vault && key) {
      by(mine, vault);
      if (!cmd({ t: 'openChest', chest: vault.id })) fail('the vault opened without its key');
      by(mine, key);
      cmd({ t: 'openChest', chest: key.id });
      by(mine, vault);
      const had = storm();
      if (cmd({ t: 'openChest', chest: vault.id }) || storm() - had !== 400 || !dw.relics.get(NS.ME)) fail(`the vault with its key: ${storm() - had}, ${JSON.stringify(dw.relics.get(NS.ME))}`);
    }
    by(mine, mine.things.find((t) => t.kind === 'tunnel'));
    if (cmd({ t: 'useThing', thing: mine.things.find((t) => t.kind === 'tunnel').id }) || bb.dungeon !== 1) fail('the tunnel did not lead to the enemy dungeon');
    const roots = his.things.find((t) => t.kind === 'roots');
    if (roots) {
      by(his, roots);
      if (cmd({ t: 'useThing', thing: roots.id }) || !(dw.blackout.get(2) > dw.tick)) fail('a charge at the roots did not put the Generators out');
    }
    // a pit: not walked onto, flown over
    const pit = his.tiles.indexOf(NS.TILE.pit);
    if (pit >= 0) {
      const px = pit % his.w, py = (pit / his.w) | 0, [dx, dy] = NS.DIRS.find(([ax, ay]) => his.tiles[(py + ay) * his.w + px + ax] === NS.TILE.floor);
      const from = [(px + dx + 0.5) * NS.WALK_SUB, (py + dy + 0.5) * NS.WALK_SUB];
      let walk = { x: from[0], y: from[1] }, fly = { x: from[0], y: from[1] };
      for (let i = 0; i < 12; i++) { walk = NS.caveStep(his, walk.x, walk.y, -dx * 100, -dy * 100, 1, false); fly = NS.caveStep(his, fly.x, fly.y, -dx * 100, -dy * 100, 1, true); }
      const on = (q) => his.tiles[Math.floor(q.y / NS.WALK_SUB) * his.w + Math.floor(q.x / NS.WALK_SUB)];
      if (on(walk) === NS.TILE.pit || (on(fly) === NS.TILE.floor && Math.hypot(fly.x - from[0], fly.y - from[1]) < NS.WALK_SUB)) fail(`a pit: ${JSON.stringify({ walk, fly })}`);
    }
    // a lurker by him bites
    his.lurkers.push({ x: bb.x + 300, y: bb.y, hx: his.arrive[0], hy: his.arrive[1], sleep: 0 });
    const whole = pr.hp;
    dw.step([]);
    if (whole - pr.hp !== 18) fail(`a lurker's bite took ${whole - pr.hp}`);
    his.lurkers.length = 0;
    // out by the enemy's stairs: on his island, by his portal
    Object.assign(bb, { x: (his.arrive[0] + 0.5) * NS.WALK_SUB, y: (his.arrive[1] + 0.5) * NS.WALK_SUB });
    if (cmd({ t: 'leaveDungeon' }) || Math.abs(pr.x - his.x) > 4 || Math.abs(pr.y - his.y) > 4) fail(`out by the enemy's stairs: ${[pr.x, pr.y]} by ${[his.x, his.y]}`);
    // chained to the enemy's Altar; a Golem of his side stands by the enemy's portal: the charge frees him, knocked out
    const t2 = dw.templeOf(2);
    let altar = null;
    for (let y = t2.y - 12; y < t2.y + 12 && !altar; y++) for (let x = t2.x - 12; x < t2.x + 12 && !altar; x++) if (dw.view().canBuild({ player: 2, type: 'altar', x, y }) === null) altar = dw.spawnBuilding('altar', 2, x, y, 0);
    altar.rising = 0;
    Object.assign(pr, { state: 'chained', chainedAt: altar.id, runes: 2, runeTimer: 0, x: altar.x, y: altar.y });
    const spot = [[his.x - 1, his.y], [his.x + 2, his.y], [his.x, his.y - 1], [his.x, his.y + 2]].find(([x, y]) => !dw.takenBy(x, y));
    const sapper = dw.spawnTransport('sunwalker', NS.ME, spot[0], spot[1]);
    dw.drainEvents();
    for (let i = 0; i < NS.SAP_SECONDS * NS.TPS - 5; i++) dw.step([]);
    if (pr.state !== 'chained') fail('the charge went off early');
    for (let i = 0; i < 10; i++) dw.step([]);
    const blast = dw.drainEvents().some((e) => e.what === 'sap' && e.data.blast);
    if (!blast || pr.state !== 'down' || pr.chainedAt !== null || !(altar.hp <= altar.hpMax / 2) || !dw.entities.has(sapper.id)) fail(`the charge under the Altar: ${JSON.stringify({ blast, state: pr.state, altar: altar.hp })}`);
  }
  console.log(`dungeons: ${seeds} dug, rooms of ${kinds.size} kinds, every chest in reach and one holding a Spell; down, out of reach, walked, the chest opened (${p.spell}), no cast below, out by the stairs, up again after ${NS.DEEP_SECONDS} s; the Hover prayed for, 1.8 times his pace, spent; a vault and its key, a tunnel, the roots, a pit, a lurker, a charge under the Altar`);

  // What a check of the code found in the dungeons' rules, and set right. Every dungeon has each of
  // its things (a valve or a shrine was left out where its own kind of room had no nook for it).
  for (let seed = 1; seed <= 12; seed++) {
    const sw = skirmish(seed);
    for (const id of [NS.ME, 2]) {
      const dug = NS.digDungeon(sw, id, seed + id - NS.ME);
      const lacks = ['tunnel', 'shrine', 'crystal', 'valve', 'roots', 'air'].filter((k) => !dug?.things.some((t) => t.kind === k));
      if (!dug || lacks.length) fail(`seed ${seed}, side ${id}: the dungeon lacks ${dug ? lacks.join(', ') : 'everything'}`);
    }
  }
  // A Priest below is out of the war above. His Sacrifice waits (an Altar beside his own portal
  // would else let him ward the runes from where nothing reaches him), and goes on when he is up
  // again; he takes no order for the islands, and nothing is laid that he would have to build.
  {
    const bw = skirmish(3), bd = NS.digDungeon(bw, NS.ME, 3), own = bw.priestOf(NS.ME), foe = bw.priestOf(2), foot = bw.def('altar');
    const cmd = (c) => { bw.step([{ player: NS.ME, ...c }]); return bw.drainEvents().filter((e) => e.what === 'rejected').map((e) => e.data.err); };
    const ring = [];
    for (let y = bd.y - 1; y <= bd.y + NS.PORTAL_FOOT; y++) for (let x = bd.x - 1; x <= bd.x + NS.PORTAL_FOOT; x++) if (!bw.dungeonAt(x, y) && bw.walkable(NS.ME, x, y) && !bw.takenBy(x, y)) ring.push([x, y]);
    let altar = null, stand = null;
    for (let y = bd.y - 6; y <= bd.y + 6 && !altar; y++) {
      for (let x = bd.x - 6; x <= bd.x + 6 && !altar; x++) {
        if (bw.view().canBuild({ player: NS.ME, type: 'altar', x, y }) !== null) continue;
        stand = ring.find(([cx, cy]) => bw.adjacentTo(cx, cy, { x, y, fx: foot.footX, fy: foot.footY }));
        if (stand) altar = bw.spawnBuilding('altar', NS.ME, x, y, 0);
      }
    }
    if (!altar) fail('no place for an Altar beside the portal');
    altar.rising = 0;
    Object.assign(own, { x: stand[0], y: stand[1], path: [], goal: 'idle' });
    Object.assign(foe, { state: 'chained', chainedAt: altar.id, runes: 0, runeTimer: 0, x: altar.x, y: altar.y });
    for (let i = 0; i < 5; i++) bw.step([]);
    if (!(foe.runeTimer > 0)) fail('the Sacrifice did not begin with the Priest at his Altar');
    // something he alone builds, laid where it can be while he is up
    let site = null;
    for (const def of defs.values()) {
      if (site || !['Production', 'Altar'].includes(def.cls)) continue;
      for (let y = bd.y - 12; y <= bd.y + 12 && !site; y++) for (let x = bd.x - 12; x <= bd.x + 12 && !site; x++) if (bw.inside(x, y) && bw.view().canBuild({ player: NS.ME, type: def.id, x, y }) === null) site = { type: def.id, x, y };
    }
    if (!site) fail('nowhere for the Priest to build');
    if (cmd({ t: 'enterDungeon' }).length || !bw.below.has(own.id)) fail('the Priest at his Altar, beside the portal, did not go down');
    const held = foe.runeTimer;
    for (let i = 0; i < 20; i++) bw.step([]);
    if (foe.runeTimer !== held || foe.runes !== 0) fail(`the Sacrifice went on from below: ${held} to ${foe.runeTimer}`);
    if (!cmd({ t: 'movePriest', x: own.x + 1, y: own.y }).includes('priest unavailable') || own.path.length) fail('a Priest below took an order to walk on the islands');
    if (bw.view().canBuild({ player: NS.ME, ...site }) !== 'priest unavailable') fail(`what the Priest builds (${site.type}) could be laid while he is below: ${bw.view().canBuild({ player: NS.ME, ...site })}`);
    if (cmd({ t: 'leaveDungeon' }).length || bw.below.has(own.id) || !bw.adjacentTo(own.x, own.y, altar)) fail('the Priest did not come up by the stairs to where he went down');
    for (let i = 0; i < 5; i++) bw.step([]);
    if (!(foe.runeTimer > held)) fail('the Sacrifice did not go on when the Priest was up again');

    // A charge under the Altar: an air ship sets none (it does not go down a stair), a Golem does;
    // and it is given up when the captive goes free another way (it used to stay, and went off at
    // once the next time).
    const air = [...defs.values()].find((u) => u.cls === 'Aerial Transport'), walker = [...defs.values()].find((u) => u.cls === 'Ground Transport');
    const spots = ring.filter(([x, y]) => x !== own.x || y !== own.y);
    const ship = bw.spawnTransport(air.id, 2, ...spots[0]);
    for (let i = 0; i < 30; i++) bw.step([]);
    if (bw.saps.size) fail(`an air ship (${air.name}) set a charge under the Altar`);
    bw.entities.delete(ship.id);
    bw.spawnTransport(walker.id, 2, ...spots[1]);
    for (let i = 0; i < 3; i++) bw.step([]);
    if (!bw.saps.has(altar.id)) fail(`a carrier on foot (${walker.name}) by the portal set no charge under the Altar`);
    Object.assign(own, { state: 'down', hp: 1 }); // the rite is broken: the captive escapes
    bw.step([]);
    if (foe.state !== 'normal' || foe.chainedAt !== null || bw.saps.size) fail(`the captive freed, the charge was still being set: ${JSON.stringify({ state: foe.state, saps: [...bw.saps] })}`);
  }
  // The ground he went down from falls away: he is not held below for good (he used to hang there,
  // never coming up); he walks on, and comes up onto ground he can stand on.
  {
    const gw = skirmish(3), gd = NS.digDungeon(gw, NS.ME, 3), gp = gw.priestOf(NS.ME);
    const cmd = (c) => { gw.step([{ player: NS.ME, ...c }]); return gw.drainEvents().filter((e) => e.what === 'rejected').length; };
    Object.assign(gp, { x: gd.x - 1, y: gd.y, path: [], goal: 'idle' });
    cmd({ t: 'enterDungeon' });
    const from = [gp.x, gp.y], gb = gw.below.get(gp.id), at = [gb.x, gb.y];
    gw.terrain[gw.at(gp.x, gp.y)] = NS.Terrain.Sky;
    cmd({ t: 'steerPriest', vx: (gd.arrive[0] - gd.stairs[0]) * 100, vy: (gd.arrive[1] - gd.stairs[1]) * 100, lead: 0 });
    for (let i = 0; i < 5; i++) gw.step([]);
    if (gb.x === at[0] && gb.y === at[1]) fail('a Priest below stood frozen when the ground he went down from fell');
    cmd({ t: 'steerPriest', vx: 0, vy: 0, lead: 0 });
    for (let i = 0; i < NS.DEEP_SECONDS * NS.TPS && gw.below.has(gp.id); i++) gw.step([]);
    if (gw.below.has(gp.id) || (gp.x === from[0] && gp.y === from[1]) || !gw.walkable(NS.ME, gp.x, gp.y) || gw.treeAt(gp.x, gp.y)) fail(`up from below with his ground gone: ${JSON.stringify({ below: gw.below.has(gp.id), at: [gp.x, gp.y], from })}`);
  }
  // At a new moon the chests are filled again, each as its kind has it: the key in its chest again
  // (it used to hold Storm Power, the vault locked for good), a Spell that there is in the Spell's.
  // And a fall into a pit that leaves him more dead than alive is told as a fall, not as a bite.
  {
    const cw = skirmish(4), cd = NS.digDungeon(cw, NS.ME, 4), cp = cw.priestOf(NS.ME);
    cw.nights = true;
    cd.lurkers.length = 0;
    for (const c of cd.chests) c.opened = true;
    cw.tick = 4 * (NS.DAY_SECONDS + NS.NIGHT_SECONDS) * NS.TPS;
    Object.assign(cp, { x: cd.x - 1, y: cd.y, path: [], goal: 'idle' });
    cw.step([{ player: NS.ME, t: 'enterDungeon' }]);
    const of = (role) => cd.chests.find((c) => c.role === role);
    if (!cw.below.has(cp.id) || cd.chests.some((c) => c.opened) || of('key').holds[0] !== 'key' || of('vault').holds.some((h) => h.startsWith('relic')) || !defs.has(of('spell').holds[0])) {
      fail(`the chests at a new moon: ${JSON.stringify(cd.chests.map((c) => [c.role, c.opened, c.holds]))}`);
    }
    const pit = cd.tiles.indexOf(NS.TILE.pit), cb = cw.below.get(cp.id);
    Object.assign(cb, { x: ((pit % cd.w) + 0.5) * NS.WALK_SUB, y: (((pit / cd.w) | 0) + 0.5) * NS.WALK_SUB });
    cp.hp = Math.floor(cp.hpMax / 2) + 5;
    cw.drainEvents();
    cw.step([]);
    const out = cw.drainEvents().find((e) => e.what === 'dungeon' && !e.data.down);
    if (cw.below.has(cp.id) || out?.data.why !== 'pit') fail(`a fall into a pit, more dead than alive: ${JSON.stringify(out)}`);
  }
  // The prayer for the Hover: asked for again, it goes on and does not start over; a prayer for a
  // Spell breaks it off (one prayer at a time).
  {
    const hw = skirmish(3), pray = hw.priestOf(NS.ME), spell = [...defs.values()].find((u) => u.id.startsWith('bomb'))?.id;
    hw.step([{ player: NS.ME, t: 'prayHover' }]);
    for (let i = 0; i < 20; i++) hw.step([]);
    const left = hw.hover.get(pray.id).pray;
    hw.step([{ player: NS.ME, t: 'prayHover' }]);
    if (!(left > 0) || hw.hover.get(pray.id).pray !== left - 1) fail(`the prayer for the Hover, asked for again: ${left} to ${hw.hover.get(pray.id).pray}`);
    Object.assign(pray, { prayer: spell, praying: 50 });
    hw.step([]);
    if (hw.hover.get(pray.id).pray !== 0 || hw.hover.get(pray.id).charge !== 0) fail('a prayer for a Spell did not break the prayer for the Hover off');
  }
  console.log('dungeons, checked over: every thing in every dungeon; a Sacrifice waits while its Priest is below, who takes no order for the islands; no charge by air ship, none left over; up from below though his ground fell; the chests filled again by their kinds; a fall told as a fall; one prayer at a time');
}

// The Combahee Raid (sim/raid.ts, sim/raid-map.ts): its two battles, played without a
// browser. Each part would fail on the rule it is about.
{
  const step = (w, cmds = [], n = 1) => {
    const ev = [];
    for (let i = 0; i < n; i++) { w.step(i === 0 ? cmds : []); ev.push(...w.drainEvents()); }
    return ev;
  };
  const raided = (ev, kind) => ev.filter((e) => e.what === 'raid' && e.data.kind === kind);
  const refused = (ev) => ev.filter((e) => e.what === 'rejected').map((e) => e.data.err);
  const near = (a, x, y, r) => Math.max(Math.abs(a.x - x), Math.abs(a.y - y)) <= r;

  // The scouting: a night under a new moon; the quarters he comes to tell him of their sky mines;
  // at the cove with all of them told, he has won; dawn finds him out, he has lost.
  {
    const w = NS.createRaid(defs, 'scout', 'normal');
    const r = w.raid, him = w.priestOf(NS.ME);
    if (!w.isNight() || w.moonPhase() !== 0 || r.mines.some((t) => t.known)) fail('the scouting does not begin on a dark night under a new moon, knowing nothing');
    if (w.players.get(NS.ME).hand.length || [...w.entities.values()].some((e) => e.kind === 'building' && e.owner === NS.ME)) fail('the scouting gives his side bridge or buildings');
    // his way round: Windgate, the south chain's quarters, over the bridge at the ferry, the north chain's, the cove
    for (const [x, y] of [...r.quarters.map((q) => q.door), [r.cove.x + 2, r.cove.y + 2]]) {
      if (!w.findPath(NS.ME, him.x, him.y, (c) => c[0] === x && c[1] === y, true)) fail(`no way on foot from ${him.x},${him.y} to ${x},${y}`);
      Object.assign(him, { x, y });
    }
    Object.assign(him, { x: 191, y: r.quarters[0].door[1] + 9 });
    let told = 0;
    for (const q of r.quarters) {
      Object.assign(him, { x: q.door[0], y: q.door[1], path: [] });
      told += raided(step(w, [], 2), 'visit').reduce((n, e) => n + e.data.n, 0);
    }
    if (told !== r.mines.length || r.mines.some((t) => !t.known) || r.verdict) fail(`the quarters told of ${told} mines of ${r.mines.length}, or it ended early`);
    Object.assign(him, { x: r.cove.x + 2, y: r.cove.y + 2, path: [] });
    const end = raided(step(w), 'end')[0];
    if (!end?.data.won || w.winner !== NS.ME) fail(`at the cove with all told: ${JSON.stringify(end)}`);
    const late = NS.createRaid(defs, 'scout', 'normal');
    while (!late.raid.verdict && late.tick < late.raid.dawn + 5) late.step([]);
    if (late.raid.verdict?.why !== 'dawn' || late.winner === NS.ME || late.isNight()) fail(`dawn found him out: ${JSON.stringify(late.raid.verdict)}`);
  }

  // A sentry fires on him as he comes within its reach (less at night), and not while he is in
  // disguise; its birds rise before he is in reach. Knocked out, he has lost; nobody takes him.
  {
    const w = NS.createRaid(defs, 'scout', 'normal');
    const r = w.raid, him = w.priestOf(NS.ME);
    const gun = [...w.entities.values()].find((e) => e.kind === 'building' && e.owner !== NS.ME);
    const cx = gun.x + 1, cy = gun.y + 1, reach = NS.gunReach(w, gun, defs.get(gun.type).range, him);
    if (!(reach < defs.get(gun.type).range)) fail(`a sentry reaches as far by night as by day: ${reach}`);
    // he comes from far off toward the gun, a cell at a time
    const way = [];
    for (let d = reach + 8; d >= 1; d--) way.push([cx + d, cy]);
    let sign = null;
    for (const [x, y] of way) {
      if (!w.walkable(NS.ME, x, y)) continue;
      Object.assign(him, { x, y, path: [] });
      const ev = step(w);
      if (!sign && raided(ev, 'sign').length) sign = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= reach - 1) break;
    }
    if (sign === null || sign <= reach) fail(`no birds before the sentry's reach (${reach}): ${sign}`);
    const was = him.hp;
    step(w, [{ player: NS.ME, t: 'disguise' }], 60);
    if (him.hp !== was || !(him.invisible > 0)) fail(`in disguise, a sentry fired on him: ${was} to ${him.hp}`);
    if (!refused(step(w, [{ player: NS.ME, t: 'disguise' }])).includes('not ready')) fail('a disguise again at once');
    for (let i = 0; i < 300 && !r.verdict; i++) step(w);
    if (r.verdict?.why !== 'down' || him.state === 'carried' || him.state === 'chained') fail(`in a sentry's reach out of disguise: ${JSON.stringify(r.verdict)}, ${him.state}`);
  }

  // The raid: the night of the full moon; the airships ride the wind's strong middle around the
  // mines found; the Sentinel is snagged; a ship tied up at a landing sounds its horn, and the people of
  // its quarters come down on their own feet, family by family, and go aboard, twice as fast while
  // he sings there; no gun fires on them.
  {
    const w = NS.createRaid(defs, 'raid', 'normal', [0, 1, 2, 3, 4, 5]);
    const r = w.raid;
    if (!w.isNight() || w.moonPhase() !== 2) fail('the raid does not begin at night under the full moon');
    const [swallow, rainbird] = [...r.ships.values()].filter((b) => !b.snagged).map((b) => w.entities.get(b.id));
    const sentinel = [...r.ships.values()].find((b) => b.snagged);
    if (!swallow || !rainbird || !sentinel || !refused(step(w, [{ player: NS.ME, t: 'moveTransport', transport: sentinel.id, x: 150, y: 140 }])).includes('snagged')) fail('two airships and the Sentinel snagged');
    const sail = (t, l) => { const ev = step(w, [{ player: NS.ME, t: 'moveTransport', transport: t.id, x: l.dock[0], y: l.dock[1] }]); while (t.path.length) ev.push(...step(w)); return ev; };
    // up the wind past every mine: none goes off, and the ship keeps to the strong middle
    const ev = sail(swallow, r.landings.find((l) => l.ferry));
    if (raided(ev, 'mine').length || NS.mooredAt(w, swallow)?.ferry !== true) fail(`the Swallow to the ferry by the known mines: ${JSON.stringify(raided(ev, 'mine'))}`);
    if (refused(step(w, [{ player: NS.ME, t: 'horn', transport: swallow.id }])).length === 0) fail('a horn at the ferry called somebody');
    const amberfield = r.landings.find((l) => l.name.startsWith('Amberfield')), goldcrest = r.landings.find((l) => l.name.startsWith('Goldcrest'));
    sail(swallow, amberfield);
    sail(rainbird, goldcrest);
    const called = step(w, [{ player: NS.ME, t: 'horn', transport: swallow.id }, { player: NS.ME, t: 'horn', transport: rainbird.id }], 2);
    if (raided(called, 'horn').length !== 2) fail(`two horns: ${JSON.stringify(refused(called))}`);
    const hp = new Map([...w.entities.values()].filter((e) => 'hp' in e).map((e) => [e.id, e.hp]));
    step(w, [], 150);
    if (!r.families.length || r.families.some((f) => f.waiting)) fail('no family on its way from the quarters');
    if (![...r.ships.values()].some((b) => b.aboard > 0)) fail('nobody aboard after 15 s');
    // he sings at the Amberfield landing: twice the pace aboard there
    const swallowShip = r.ships.get(swallow.id), him = w.priestOf(NS.ME);
    amberfield.crowd += 200;
    const a0 = swallowShip.aboard;
    step(w, [], 50);
    const plain = swallowShip.aboard - a0;
    Object.assign(him, { x: amberfield.x + 1, y: amberfield.y, path: [] });
    const sung = raided(step(w), 'song').length;
    const a1 = swallowShip.aboard;
    step(w, [], 50);
    if (!sung || swallowShip.aboard - a1 < 2 * plain - 1) fail(`his singing: ${plain} aboard in 5 s, then ${swallowShip.aboard - a1}`);
    // nobody fired on the families (they are no units), and the airships shelled what was in reach
    if ([...w.entities.values()].some((e) => e.kind === 'priest' && e.hp < hp.get(e.id))) fail('the families\' way: a shot at him');
  }

  // A parted landing: its people wait at the quarters until a bridge joins it to their island; a
  // piece can be laid from a landing (the raid's side has no Temple). The bridge at the ferry burns
  // through and falls; the battery is held then; with it standing the battery comes after dawn.
  // Home with enough aboard, it is won; with too few, lost. A mine not known goes off against a
  // ship, which is torn, never brought down.
  {
    const w = NS.createRaid(defs, 'raid', 'normal', [0, 1, 2, 3, 4, 5]);
    const r = w.raid;
    const [swallow, rainbird] = [...r.ships.values()].filter((b) => !b.snagged).map((b) => w.entities.get(b.id));
    const sail = (t, l) => { step(w, [{ player: NS.ME, t: 'moveTransport', transport: t.id, x: l.dock[0], y: l.dock[1] }]); while (t.path.length) step(w); };
    const highmere = r.landings.find((l) => l.name.startsWith('Highmere'));
    sail(swallow, highmere);
    step(w, [{ player: NS.ME, t: 'horn', transport: swallow.id }], 120);
    if (!r.families.length || r.families.some((f) => !f.waiting) || highmere.crowd) fail('the people of a parted landing\'s plantation did not wait for a bridge');
    // a piece of the hand can be laid from the landing
    let laid = false;
    const pl = w.players.get(NS.ME);
    for (let k = 0; k < 120 && pl.hand.length < 4; k++) step(w);
    for (let hand = 0; hand < pl.hand.length && !laid; hand++) {
      for (let rot = 0; rot < 4 && !laid; rot++) {
        for (let y = highmere.y - 4; y <= highmere.y + highmere.h + 4 && !laid; y++) {
          for (let x = highmere.x - 4; x <= highmere.x + highmere.w + 4 && !laid; x++) {
            laid = refused(step(w, [{ player: NS.ME, t: 'dropPiece', hand, x, y, rot }])).length === 0;
          }
        }
      }
    }
    if (!laid) fail('no bridge piece could be laid from a landing');
    // a bridge across the rift (laid here cell by cell: the pieces dealt are the game's luck)
    for (let x = highmere.x + 1; x <= highmere.x + 2; x++) {
      for (let k = 1; k <= 2; k++) {
        const i = w.at(x, highmere.y + highmere.h - 1 + k);
        if (w.terrain[i] === NS.Terrain.Sky) {
          w.terrain[i] = NS.Terrain.Bridge;
          w.links[i] = 5;
          w.owner[i] = NS.ME;
        }
      }
    }
    step(w, [], 150);
    if (r.families.some((f) => f.waiting) || !(r.ships.get(swallow.id).aboard > 0)) fail(`a bridge across the rift: still ${r.families.filter((f) => f.waiting).length} families waiting`);
    // the bridge at the ferry: fired from the ferry's landing, it falls; the battery is held
    const ferry = r.landings.find((l) => l.ferry);
    sail(rainbird, ferry);
    const burned = step(w, [{ player: NS.ME, t: 'burnBridge', transport: rainbird.id }], NS.BURN_SECONDS * NS.TPS + 2);
    if (!raided(burned, 'burned').length || !r.bridge.cells.every(([x, y]) => w.terrain[w.at(x, y)] === NS.Terrain.Sky)) fail('the bridge at the ferry did not burn through');
    if (refused(step(w, [{ player: NS.ME, t: 'raidHome' }])).length === 0) fail('home with the ships up the wind');
    while (w.tick < r.battery.due + 2) step(w);
    if (!r.battery.held || r.battery.came || w.isNight()) fail(`the battery with the bridge burned: ${JSON.stringify(r.battery)}`);
    const aboard = NS.freed(w);
    const windgate = r.landings.find((l) => l.home);
    sail(swallow, windgate);
    sail(rainbird, windgate);
    step(w, [{ player: NS.ME, t: 'raidHome' }]);
    if (r.verdict?.won !== false || r.verdict.why !== 'few' || r.freed !== aboard) fail(`home with ${r.freed} aboard of ${r.target}: ${JSON.stringify(r.verdict)}`);

    // with the bridge standing, the battery comes at its time; enough aboard, home, it is won
    const v = NS.createRaid(defs, 'raid', 'normal', [0, 1, 2, 3, 4, 5]);
    while (v.tick < v.raid.battery.due + 2) v.step([]);
    if (!v.raid.battery.came || v.raid.battery.guns.length !== 2) fail('the battery did not come over the standing bridge');
    for (const b of v.raid.ships.values()) b.aboard = b.snagged ? 0 : Math.ceil(v.raid.target / 2);
    const [vswallow, vrainbird] = [...v.raid.ships.values()].filter((b) => !b.snagged).map((b) => v.entities.get(b.id));
    if (!near(vswallow, ...v.raid.landings.find((l) => l.home).dock, NS.HOME_REACH) || !near(vrainbird, ...v.raid.landings.find((l) => l.home).dock, NS.HOME_REACH)) fail('the ships do not start at home');
    v.step([{ player: NS.ME, t: 'raidHome' }]);
    if (!v.raid.verdict?.won || v.winner !== NS.ME) fail(`home with enough aboard: ${JSON.stringify(v.raid.verdict)}`);

    // a mine not known: a ship sent over it is torn, and not brought down; no prayer, building or
    // capture in the raid
    const u = NS.createRaid(defs, 'raid', 'normal', []);
    const ut = u.entities.get([...u.raid.ships.values()].find((b) => !b.snagged).id);
    const tp = u.raid.mines[0];
    u.step([{ player: NS.ME, t: 'moveTransport', transport: ut.id, x: tp.x - 6, y: tp.y }]);
    let hit = false;
    for (let i = 0; i < 400 && ut.path.length; i++) { u.step([]); hit ||= u.drainEvents().some((e) => e.what === 'raid' && e.data.kind === 'mine'); }
    if (!hit || ut.hp <= 0 || ut.hp > ut.hpMax * (1 - NS.MINE_HIT) + 1) fail(`over a mine not known: hit ${hit}, hp ${ut.hp}/${ut.hpMax}`);
    // a Sun Cannon north of it, facing south down its column: it hits, and the ship does not fall
    const gun = u.spawnBuilding('suncannon', NS.RAID_ENEMY, ut.x - 1, ut.y - 12, 2);
    gun.rising = 0;
    const hpWas = ut.hp;
    for (let i = 0; i < 600; i++) u.step([]);
    if (!u.entities.has(ut.id) || ut.hp >= hpWas || ut.hp < Math.ceil(ut.hpMax * NS.SHIP_FLOOR)) fail(`a battery's gun on a ship: ${hpWas} to ${u.entities.has(ut.id) ? ut.hp : 'fallen'}/${ut.hpMax}`);
    if (!refused(step(u, [{ player: NS.ME, t: 'pray', spell: 'bombexplodemedium' }])).includes('not here')) fail('a prayer for a Spell in the raid');
    if (!refused(step(u, [{ player: NS.ME, t: 'prayHover' }])).includes('not here')) fail('a prayer for the Hover in the raid');
  }

  // After the raid of 1863 (the article "Raid on Combahee Ferry"): the first estate called is wary a
  // while, the next not; a warden lets the families out half as often until the volunteers the horn
  // sent ashore reach the door, or the Wayfinder comes near it; a crowd too large clings to the
  // skiffs and goes aboard at half pace, and his song calms it; a sentry that sees a ship sends a
  // rider, the first alarm is doubted and the second sends the battery out early; the mills the
  // ships' guns burn are counted; no ship goes past the stakes west of the ferry.
  {
    const w = NS.createRaid(defs, 'raid', 'normal', [0, 1, 2, 3, 4, 5]);
    const r = w.raid, him = w.priestOf(NS.ME);
    const [swallow, rainbird] = [...r.ships.values()].filter((b) => !b.snagged).map((b) => w.entities.get(b.id));
    const landing = (name) => r.landings.find((l) => l.name.startsWith(name));
    const moor = (t, l) => { Object.assign(t, { x: l.dock[0], y: l.dock[1], path: [] }); };
    // wary, then trusted
    const amberfield = landing('Amberfield'), goldcrest = landing('Goldcrest');
    moor(swallow, amberfield);
    const horn1 = step(w, [{ player: NS.ME, t: 'horn', transport: swallow.id }]);
    const qa = r.quarters.find((q) => q.landing === amberfield.id);
    if (!raided(horn1, 'wary').length || qa.next < w.tick + (NS.WARY_SECONDS - 1) * NS.TPS) fail(`the first estate called is not wary: next ${qa.next} at ${w.tick}`);
    moor(rainbird, goldcrest);
    const horn2 = step(w, [{ player: NS.ME, t: 'horn', transport: rainbird.id }]);
    const qg = r.quarters.find((q) => q.landing === goldcrest.id);
    if (raided(horn2, 'wary').length || qg.left === qg.people) fail('the second estate called is wary too');
    // the warden: he flees when the volunteers the horn sent up reach the door
    Object.assign(him, { path: [] });
    const party = [...raided(horn2, 'party'), ...raided(step(w, [], NS.TPS), 'party')].find((e) => e.data.id === qg.id);
    if (!party || qg.party <= 0) fail(`no volunteers sent up to the Goldcrest quarters: ${JSON.stringify(party)} ${qg.party}`);
    if (qg.warden !== 'watching' && w.tick < qg.party) fail('the warden fled before the volunteers came');
    let byParty = false;
    while (w.tick <= qg.party + 1) {
      const fledNow = raided(step(w), 'warden').some((e) => e.data.id === qg.id && e.data.why === 'party');
      byParty ||= fledNow;
    }
    if (qg.warden !== 'fled' || !byParty) fail('the warden did not flee when the volunteers reached the door');
    // while he watches, the families slip out half as often; the Wayfinder near the door, he flees
    // at once and they come as fast as they can (Highmere: behind its rift, the volunteers cannot
    // get up to him)
    const h = NS.createRaid(defs, 'raid', 'normal', [0, 1, 2, 3, 4, 5]);
    const hr = h.raid, hs = h.entities.get([...hr.ships.values()].find((b) => !b.snagged).id), hg = h.priestOf(NS.ME);
    const hl = hr.landings.find((l) => l.name.startsWith('Highmere')), qh = hr.quarters.find((q) => q.landing === hl.id);
    hr.trusted = true;
    Object.assign(hs, { x: hl.dock[0], y: hl.dock[1], path: [] });
    step(h, [{ player: NS.ME, t: 'horn', transport: hs.id }]);
    const families = (ticks) => { const was = hr.nextFamily; step(h, [], ticks); return hr.nextFamily - was; };
    const watched = families(15 * NS.TPS);
    if (qh.warden !== 'watching' || qh.party !== -1) fail(`the Highmere warden, the volunteers held at the rift: ${qh.warden} ${qh.party}`);
    Object.assign(hg, { x: qh.door[0] + 1, y: qh.door[1], path: [] });
    const fled = raided(step(h), 'warden');
    if (!fled.some((e) => e.data.id === qh.id && e.data.why === 'him') || qh.warden !== 'fled') fail(`the Wayfinder at the Highmere door: ${JSON.stringify(fled)}`);
    const unwatched = families(15 * NS.TPS);
    if (watched < 2 || unwatched < watched * 1.6) fail(`families setting out in 15 s: ${watched} past the warden, ${unwatched} without him`);
    // the crowd that clings, and his song: a crowd of CALM_CROWD goes aboard at the plain pace; a
    // larger one with no song clings to the skiffs, slower; his song calms it, twice the plain pace
    const c = NS.createRaid(defs, 'raid', 'normal', [0, 1, 2, 3, 4, 5]);
    const cl = c.raid.landings.find((l) => l.name.startsWith('Amberfield')), cs = c.entities.get([...c.raid.ships.values()].find((b) => !b.snagged).id);
    Object.assign(cs, { x: cl.dock[0], y: cl.dock[1], path: [] });
    const cship = c.raid.ships.get(cs.id);
    cl.crowd = NS.CALM_CROWD - 20;
    step(c, [], 10 * NS.TPS);
    const calmPace = cship.aboard;
    cl.crowd = NS.CALM_CROWD + 80;
    const clung = step(c, [], 10 * NS.TPS);
    const clingPace = cship.aboard - calmPace;
    if (!raided(clung, 'clinging').length || !cl.clinging || clingPace > calmPace * 0.6) fail(`a crowd clinging to the skiffs: ${clingPace} aboard in 10 s, ${calmPace} from a calm one`);
    const cg = c.priestOf(NS.ME);
    Object.assign(cg, { x: cl.x + 1, y: cl.y + 1, path: [] });
    const was = cship.aboard;
    const calm = step(c, [], 10 * NS.TPS);
    if (!raided(calm, 'calmed').length || cl.clinging || cship.aboard - was < calmPace * 1.8) fail(`his song at a clinging landing: ${cship.aboard - was} aboard in 10 s, ${calmPace} from a calm crowd without it`);
    // the alarm: riders from two sentries; the first doubted, the second believed
    const a = NS.createRaid(defs, 'raid', 'normal', [0, 1, 2, 3, 4, 5]);
    const ar = a.raid, at = a.entities.get([...ar.ships.values()].find((b) => !b.snagged).id);
    const sentries = [...a.entities.values()].filter((e) => e.kind === 'building' && e.type === 'sunarcher');
    const dueWas = ar.battery.due;
    const riders = [];
    for (const g of sentries.slice(0, 2)) {
      Object.assign(at, { x: g.x + 1, y: g.y + (g.y < 130 ? 6 : -4), path: [] });
      riders.push(...raided(step(a, [], 2), 'rider'));
    }
    if (riders.length < 2) fail(`riders from the sentries that saw a ship: ${riders.length}`);
    Object.assign(at, { x: 190, y: 150, path: [] });
    const alarms = raided(step(a, [], NS.RIDE_SECONDS * NS.TPS + 4), 'alarm');
    if (alarms.length < 2 || ar.battery.due >= dueWas || ar.battery.due > a.tick + ar.battery.march * NS.TPS) fail(`two alarms heard: ${alarms.map((e) => e.data.n)}, battery due ${ar.battery.due} (was ${dueWas})`);
    // the mills, counted as they burn
    const m0 = ar.mills[0];
    a.entities.get(m0.id).hp = 0;
    const burnedMill = raided(step(a, [], 3), 'mill');
    if (!burnedMill.length || !m0.burned) fail('a mill burned is not counted');
    // the bridge at the ferry burned, the wind runs on where it stood: a ship sent on up it goes past
    // the bridge, and stops short of the stakes
    const p = NS.createRaid(defs, 'raid', 'normal', [0, 1, 2, 3, 4, 5]);
    const pt = p.entities.get([...p.raid.ships.values()].find((b) => !b.snagged).id);
    const pf = p.raid.landings.find((l) => l.ferry);
    Object.assign(pt, { x: pf.dock[0], y: pf.dock[1], path: [] });
    p.step([{ player: NS.ME, t: 'burnBridge', transport: pt.id }]);
    for (let i = 0; i < NS.BURN_SECONDS * NS.TPS + 2; i++) p.step([]);
    p.step([{ player: NS.ME, t: 'moveTransport', transport: pt.id, x: 58, y: 111 }]);
    const west = Math.min(...pt.path.map(([x]) => x));
    if (!p.raid.bridge.burned || !pt.path.length || west >= Math.min(...p.raid.bridge.cells.map(([x]) => x)) || west < p.raid.pilings) fail(`a ship sent up the wind past the burned bridge: as far west as ${west}, the stakes at ${p.raid.pilings}`);
  }
  console.log('the Combahee Raid: the scouting (a new moon, the quarters tell him of the sky mines, the cove, dawn; birds before a sentry, a disguise, knocked out); the raid (the full moon, the wind\'s strong middle past known mines, the Sentinel snagged, horns, families on foot, singing, a parted landing and its bridge, pieces from the landings, the bridge at the ferry burned, the battery held or come, home won or lost, a mine not known, no ship brought down, no prayer; the first estate wary, a warden fleeing from the volunteers and from him, a clinging crowd calmed by his song, two riders and the believed alarm, a mill counted, the stakes)');
}

// The fog of war (src/fog.js): what the player has explored, and what it hides from the player.
{
  const base = { ...NS.DEFAULT_OPTIONS, lang: 'en', difficulty: 'normal' };
  const w = NS.createMatchWorld(defs, DATA.maps, DATA.missions, { ...base, mode: 'skirmish', opponent: 'ai', theme: 'wind', enemyTheme: 'rain', islands: 4, storm: 2000, seed: 42, spells: 'none' }, { known: [], altarLevel: 1 });
  const W = NS.W, mine = w.templeOf(NS.ME), foe = w.templeOf(2), mp = w.priestOf(NS.ME);
  startFog(w, true);
  // the home island is explored whole from the start; the enemy's Temple is not, and is hidden
  let ground = 0, groundSeen = 0;
  for (let i = 0; i < W * W; i++) if (w.owner[i] === NS.ME && w.terrain[i] === 1) { ground++; groundSeen += FOG.seen[i]; }
  if (!ground || groundSeen !== ground) fail(`fog: ${groundSeen} of the home island's ${ground} cells explored`);
  // and the ground just off its shore (the islets of its geysers)
  let shore = 0, shoreSeen = 0;
  for (let i = W; i < W * W - W; i++) {
    if (w.terrain[i] !== 1 || w.owner[i] === NS.ME) continue;
    if ([i + 1, i - 1, i + W, i - W].some((j) => w.terrain[j] === 1 && w.owner[j] === NS.ME)) { shore++; shoreSeen += FOG.seen[i]; }
  }
  if (!shore || shoreSeen !== shore) fail(`fog: ${shoreSeen} of the ${shore} cells off the home island's shore explored`);
  if (seenEntity(w, foe) || seenAt(w, foe.x, foe.y) || NS.entityAt(w, foe.x, foe.y)?.id !== foe.id) fail('fog: the enemy Temple seen from the start');
  if (!seenEntity(w, mine) || seenAt(w, mine.x, mine.y)?.id !== mine.id) fail('fog: the player\'s own Temple hidden');
  const geysers = [...w.entities.values()].filter((e) => e.kind === 'geyser');
  const homeGeyser = geysers.find((g) => w.owner[g.y * W + g.x] === NS.ME);
  if (!geysers.some((g) => !seenEntity(w, g)) || (homeGeyser && !seenEntity(w, homeGeyser))) fail('fog: geysers hidden and seen wrongly at the start');
  // his sight: the Priest set down by the enemy Temple sees it, as far as SIGHT.priest and no further
  const was = [mp.x, mp.y], counted = FOG.count, rev = FOG.revision;
  Object.assign(mp, { x: foe.x - 6, y: foe.y + 1 });
  stepFog(w);
  if (!seenEntity(w, foe) || seenAt(w, foe.x, foe.y)?.id !== foe.id || FOG.revision === rev || FOG.count <= counted) fail('fog: the Priest beside the enemy Temple did not see it');
  if (!seenCell(mp.x - SIGHT.priest + 1, mp.y) || seenCell(mp.x - SIGHT.priest - 1, mp.y)) fail(`fog: his sight is not ${SIGHT.priest} cells`);
  // what was explored stays explored after he has gone
  Object.assign(mp, { x: was[0], y: was[1] });
  stepFog(w);
  if (!seenEntity(w, foe)) fail('fog: explored ground fogged again');
  // a bridge laid explores SIGHT.bridge about each of its cells: a cell of open sky far from anything seen
  let sky = -1;
  for (let i = 0; i < W * W && sky < 0; i++) {
    const x = i % W, y = (i / W) | 0;
    if (x < 12 || y < 12 || x > W - 12 || y > W - 12 || w.terrain[i]) continue;
    let clear = true;
    for (let dy = -8; dy <= 8 && clear; dy++) for (let dx = -8; dx <= 8 && clear; dx++) clear = !FOG.seen[(y + dy) * W + x + dx] && !w.terrain[(y + dy) * W + x + dx];
    if (clear) sky = i;
  }
  const bx = sky % W, by = (sky / W) | 0;
  w.terrain[sky] = 2;
  w.owner[sky] = NS.ME;
  w.terrainRevision++;
  stepFog(w);
  if (sky < 0 || !seenCell(bx + SIGHT.bridge, by) || !seenCell(bx, by - SIGHT.bridge) || seenCell(bx + SIGHT.bridge + 1, by)) fail(`fog: a bridge cell did not explore ${SIGHT.bridge} cells about it`);
  w.terrain[sky] = 0;
  w.owner[sky] = 0;
  w.terrainRevision++;
  // a gun firing on what is the player's is seen; where the player's own shot lands is seen about
  startFog(w, true);
  w.shots.push({ gun: foe, target: mine.id, x: mine.x, y: mine.y, leave: w.tick, land: w.tick + 5 });
  stepFog(w);
  if (!seenEntity(w, foe) || !seenCell(foe.x - SIGHT.firing, foe.y) || seenCell(foe.x - SIGHT.firing - 2, foe.y + 2)) fail('fog: a gun firing on the player stayed hidden');
  w.shots.pop();
  startFog(w, true);
  w.shots.push({ gun: mine, target: foe.id, x: foe.x + 3, y: foe.y + 2, leave: w.tick, land: w.tick + 5 });
  stepFog(w);
  if (!seenCell(foe.x + 3 + SIGHT.struck, foe.y + 2) || seenCell(foe.x + 3 + SIGHT.struck + 1, foe.y + 2)) fail('fog: where the player\'s shot landed is not seen about');
  w.shots.pop();
  // without the fog everything is seen and picked
  startFog(w, false);
  if (!seenEntity(w, foe) || !seenCell(0, 0) || seenAt(w, foe.x, foe.y)?.id !== foe.id || geysers.some((g) => !seenEntity(w, g))) fail('fog: off, something is still hidden');
  // the raid: the estates' quarters and landings are known from the scouting; the Sun-lords' sentries and mills away from them are not
  const rw = NS.createRaid(defs, 'raid', 'normal', []);
  startFog(rw, true, raidKnown(rw));
  if (!rw.raid.quarters.every((q) => seenCell(q.door[0], q.door[1])) || !rw.raid.landings.every((l) => seenCell(l.dock[0], l.dock[1]) || seenCell(l.x, l.y))) fail('fog: the raid begins with an estate unknown');
  const hid = [...rw.entities.values()].filter((e) => e.kind === 'building' && e.owner !== NS.ME && !seenEntity(rw, e)).length;
  if (!hid) fail('fog: every building of the Sun-lords in sight as the raid begins');
  startFog(rw, false);
  console.log(`fog of war: the home island and its shore explored and the enemy Temple hidden at the start, his sight of ${SIGHT.priest} cells, explored staying explored, a bridge's ${SIGHT.bridge}, a gun firing on the player seen, a shot's landing seen about, off with the setting; the raid: the estates known, ${hid} buildings of the Sun-lords hidden`);
}

// The sky cities (sim/city-map.ts): two maps with no battle, to be walked. Each part would fail
// on the rule it is about.
{
  const S = NS.WALK_SUB, at = (x, y) => y * NS.W + x, told = [];
  for (const name of ['concord', 'altamar']) {
    const w = NS.createCity(defs, name), c = w.city, him = w.priestOf(NS.ME);
    // he begins on an open street, by day, under a full moon; night falls a minute and a half on
    if (c.blocked[at(him.x, him.y)] || !w.walkable(NS.ME, him.x, him.y)) fail(`${name}: the Priest begins on a blocked cell`);
    if (w.isNight() || w.moonPhase() !== 2) fail(`${name}: it does not begin by day under a full moon`);
    const morning = w.tick;
    w.tick = morning + 100 * NS.TPS;
    if (!w.isNight()) fail(`${name}: no night a minute and a half on`);
    w.tick = morning;
    // the cells of everything solid are blocked, and nobody walks on a blocked cell
    for (const p of c.props) {
      if (!p.solid) continue;
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (!c.blocked[at(x, y)]) fail(`${name}: the ${p.k} at ${p.x},${p.y} leaves ${x},${y} open`);
    }
    let blocked = 0;
    for (let i = 0; i < NS.W * NS.H; i++) {
      if (!c.blocked[i]) continue;
      blocked++;
      if (w.walkable(NS.ME, i % NS.W, Math.floor(i / NS.W))) fail(`${name}: the blocked cell ${i % NS.W},${Math.floor(i / NS.W)} is walkable`);
    }
    // every sight is reached on foot from where he begins, by the lifts where the levels differ
    for (const sight of c.sights) {
      if (!w.findPath(NS.ME, him.x, him.y, ([x, y]) => Math.hypot(x + 0.5 - sight.x, y + 0.5 - sight.y) <= sight.r, true)) fail(`${name}: no way on foot to ${sight.name}`);
    }
    const levels = new Set(c.sights.map((sight) => w.level[at(Math.floor(sight.x), Math.floor(sight.y))]));
    if (name === 'altamar' ? levels.size !== 3 || !w.tiered : levels.size !== 1 || w.tiered) fail(`${name}: the sights on the levels ${[...levels]}`);
    // nothing is built, laid or prayed for there: only walking
    w.step([{ t: 'build', player: NS.ME, type: 'sunfactory', x: him.x + 2, y: him.y }, { t: 'prayHover', player: NS.ME }]);
    const no = w.drainEvents().filter((e) => e.what === 'rejected').map((e) => e.data.err);
    if (no.length !== 2 || no.some((err) => err !== 'not here')) fail(`${name}: building and praying, answered ${JSON.stringify(no)}`);
    // walked by hand at a house's wall from the street before it, he stops at the wall
    let wall = null;
    for (const p of c.props) {
      if (wall || p.k !== 'house' || !p.solid) continue;
      for (let x = p.x; x < p.x + p.w && !wall; x++) {
        const y = p.y + p.h;
        if (!c.blocked[at(x, y)] && w.walkable(NS.ME, x, y) && !w.treeAt(x, y) && !w.houseAt(x, y) && w.level[at(x, y)] === w.level[at(x, p.y)]) wall = { x, y, p };
      }
    }
    if (!wall) fail(`${name}: no house with an open street before it`);
    Object.assign(him, { x: wall.x, y: wall.y, path: [], goal: 'idle' });
    w.step([{ t: 'steerPriest', player: NS.ME, vx: 0, vy: -100, lead: 0 }]);
    for (let i = 0; i < 40; i++) {
      w.step([]);
      if (c.blocked[at(him.x, him.y)]) fail(`${name}: walked by hand into the ${wall.p.k} at ${wall.p.x},${wall.p.y}`);
    }
    const s = w.walking.get(him.id);
    if (him.y !== wall.y || !s || s.y < wall.y * S) fail(`${name}: walked at a house's wall from ${wall.x},${wall.y}, he is at ${him.x},${him.y}`);
    w.step([{ t: 'steerPriest', player: NS.ME, vx: 0, vy: 0, lead: 0 }]);
    // a long while, night and day, and nobody has won or lost; no tree has grown
    const trees = (() => { let n = 0; for (let y = 0; y < NS.H; y++) for (let x = 0; x < NS.W; x++) if (w.treeAt(x, y)) n++; return n; })();
    for (let i = 0; i < 400 * NS.TPS; i++) w.step([]);
    let grown = 0;
    for (let y = 0; y < NS.H; y++) for (let x = 0; x < NS.W; x++) if (w.treeAt(x, y)) grown++;
    if (w.winner !== null && w.winner !== undefined) fail(`${name}: ${w.winner} has won`);
    if (grown !== trees) fail(`${name}: the trees ${trees} became ${grown}`);
    told.push(`${name} ${c.props.length} props, ${blocked} blocked cells, ${c.sights.length} sights on ${levels.size} level${levels.size > 1 ? 's' : ''}`);
  }
  console.log(`sky cities: ${told.join('; ')}: every sight walked to from the start, the blocked cells not walked on by order or by hand, nothing built, nobody wins, night falls a minute and a half on`);
}

// The tower defense campaign (sim/td.ts, sim/td-map.ts): each battle laid out so that it can be
// played, won by a careful player who uses the High Priest and lost by one who raises nothing; and
// its rules and the Priest's, each part of which would fail on the rule it is about.
{
  const at = (x, y) => y * NS.W + x, told = [];
  // a careful player's order for each battle: platform (letter) and gun, ^ for a rank up; then every
  // gun ranked up, the cheapest first; the first wave called once two guns stand; a Spell on a knot
  const GUN = { disc: 'sunarcher', bow: 'windarcher', ice: 'raincannon', van: 'thunderarcher', sun: 'suncannon', arc: 'thunderfence', thu: 'thundercannon', man: 'rainaviary' };
  const PLANS = {
    mossbridge: 'C bow, D disc, H disc, J bow, F disc, L disc, ^C, ^J, M bow, I disc, N disc, ^D, ^H, E disc, B disc, ^M, ^F, ^L',
    ferries: 'G ice, H disc, J ice, I bow, L disc, O ice, ^G, ^J, M disc, C disc, D disc, ^O, E bow, F bow, ^H, ^I, N disc, K disc',
    cloudwatch: 'D ice, E van, K ice, G disc, I disc, H bow, ^D, ^K, ^E, L disc, F van, M bow, O disc, ^G, ^H, J disc, C van',
    skaters: 'A ice, B ice, D disc, I disc, E van, O arc, P arc, ^A, ^B, K sun, N bow, L van, Q arc, ^E, M bow, ^K',
    bulfback: 'C ice, F ice, D disc, G van, P arc, H thu, ^C, ^F, L thu, Q arc, R arc, O van, E bow, I bow, ^H, ^L, ^G, J man',
    hollowgate: 'C ice, D ice, G van, E disc, F disc, H van, ^C, ^D, K thu, L thu, R arc, S arc, ^G, ^H, O bow, P bow, T arc, U arc, ^K, ^L, Q bow, I man',
  };
  // the Priest's skills as bought with two points a battle before this one, in this order
  const ORDER = ['bless', 'call', 'bolt', 'stand', 'muster', 'hammer', 'rally', 'call', 'bless', 'bolt', 'stand', 'hammer', 'muster', 'rally', 'call', 'bless', 'bolt', 'stand', 'hammer', 'muster', 'rally'];
  const skillsFor = (left) => {
    const k = { ...NS.TD_NO_SKILLS }, cost = [1, 2, 2];
    for (const s of ORDER) if (k[s] < 3 && left >= cost[k[s]]) { left -= cost[k[s]]; k[s]++; }
    return k;
  };
  const play = (id, plan) => {
    const w = NS.createTd(defs, id, plan ? skillsFor(2 * NS.TD_LEVELS.indexOf(id)) : NS.TD_NO_SKILLS), td = w.td, side = w.players.get(NS.TD_ME), steps = plan ? plan.split(', ').map((x) => x.split(' ')) : [];
    let step = 0, guns = 0;
    for (let tick = 0; tick < 40 * 60 * NS.TPS && !td.over; tick++) {
      const cmds = [];
      if (tick % NS.TPS === 0) {
        const [a, b] = steps[step] ?? [];
        if (a?.[0] === '^') {
          const s = td.spots['ABCDEFGHIJKLMNOPQRSTU'.indexOf(a[1])], gun = w.entities.get(s.tower);
          if (side.storm >= NS.TD_TOWERS[gun.type].ranks[td.ranks.get(gun.id) - 1]) { cmds.push({ t: 'tdUpgrade', player: 1, tower: gun.id }); step++; }
        } else if (a) {
          if (side.storm >= NS.TD_TOWERS[GUN[b]].cost) { cmds.push({ t: 'tdBuild', player: 1, spot: 'ABCDEFGHIJKLMNOPQRSTU'.indexOf(a), type: GUN[b] }); step++; guns++; }
        } else if (plan) {
          let up = null;
          for (const [gid, rank] of td.ranks) { const gun = w.entities.get(gid); if (!gun || rank >= 3 || !td.spent.has(gid)) continue; const c = NS.TD_TOWERS[gun.type].ranks[rank - 1]; if (!up || c < up.c) up = { c, gid }; }
          if (up && side.storm >= up.c) cmds.push({ t: 'tdUpgrade', player: 1, tower: up.gid });
        }
        if (td.wave === 0 && (guns >= 2 || !plan)) cmds.push({ t: 'tdWave', player: 1 });
        for (const spell of plan ? td.spells : []) {
          if ((td.cooldown.get(spell) ?? 0) > 0) continue;
          let best = null;
          for (const [eid] of td.enemies) { const e = w.entities.get(eid); if (!e) continue; let n = 0; for (const [j] of td.enemies) { const u = w.entities.get(j); if (u && Math.hypot(u.x - e.x, u.y - e.y) <= 2.5) n++; } if (!best || n > best.n) best = { n, x: e.x, y: e.y }; }
          if (best && best.n >= 4) cmds.push({ t: 'tdCast', player: 1, spell, x: best.x, y: best.y });
        }
        // the Priest, guarding the Temple's door: the Rally on a crowd about him, the Storm Hammer on
        // the thickest knot within his reach
        const priest = NS.tdPriest(w), hero = td.hero;
        if (plan && priest && hero.down === 0) {
          let near = 0, knot = null;
          for (const [eid] of td.enemies) {
            const e = w.entities.get(eid);
            if (!e) continue;
            const d = Math.hypot(e.x - priest.x, e.y - priest.y);
            if (d <= NS.TD_HERO.rally.reach) near++;
            if (d > NS.TD_HERO.hammer.range) continue;
            let n = 0;
            for (const [j] of td.enemies) { const u = w.entities.get(j); if (u && Math.hypot(u.x - e.x, u.y - e.y) <= NS.TD_HERO.hammer.reach[hero.skills.hammer]) n++; }
            if (!knot || n > knot.n) knot = { n, x: e.x, y: e.y };
          }
          if (near >= 4 && hero.cooldown.rally === 0) cmds.push({ t: 'tdHero', player: 1, act: 'rally' });
          if (knot && knot.n >= 2 && hero.cooldown.hammer === 0) cmds.push({ t: 'tdHero', player: 1, act: 'hammer', tx: knot.x, ty: knot.y });
        }
        // the Temple Guard, once a few walkers come, a few cells ahead of the one nearest the Temple
        if (plan && hero.cooldown.call === 0) {
          let lead = null, walkers = 0;
          for (const [eid, en] of td.enemies) {
            const e = w.entities.get(eid);
            if (!e || NS.TD_FOES[en.type]?.air || !e.path.length) continue;
            walkers++;
            if (!lead || e.path.length < lead.path.length) lead = e;
          }
          const ahead = lead?.path[Math.min(lead.path.length - 1, 3)];
          if (ahead && walkers >= 3) cmds.push({ t: 'tdHero', player: 1, act: 'call', tx: ahead[0], ty: ahead[1] });
        }
      }
      w.step(cmds);
      for (const ev of w.drainEvents()) {
        if (ev.what === 'rejected') fail(`${id}: the careful player's ${ev.data.cmd} refused: ${ev.data.err}`);
        if (ev.what === 'destroyed' && ev.who === NS.TD_ME) fail(`${id}: the player's ${ev.data.type} destroyed`);
      }
    }
    return { w, td };
  };
  for (const id of NS.TD_LEVELS) {
    const w = NS.createTd(defs, id), td = w.td, temple = w.templeOf(NS.TD_ME);
    // the platforms on no way and on no other platform; the ways walkable, each to the Temple's door
    const platformAt = new Map();
    td.spots.forEach((s, k) => {
      for (const [x, y] of [[s.x, s.y], ...(s.pair ? [s.pair] : [])]) {
        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
          const i = at(x + dx, y + dy);
          if (platformAt.has(i)) fail(`${id}: platforms ${platformAt.get(i)} and ${k} overlap at ${x + dx},${y + dy}`);
          platformAt.set(i, k);
          if (w.terrain[i] === 0) fail(`${id}: platform ${k} over the sky at ${x + dx},${y + dy}`);
        }
      }
      // a gate's two posts on one row or column, within an Arc Spire's reach of each other
      if (s.pair && ((s.x !== s.pair[0] && s.y !== s.pair[1]) || Math.abs(s.x - s.pair[0]) + Math.abs(s.y - s.pair[1]) > w.def('thunderfence').range)) fail(`${id}: gate ${k}'s posts are not joined`);
      // every platform worth a gun: one of the battle's covers five cells of a way from it
      if (!s.pair && !td.towers.some((t) => !NS.TD_TOWERS[t].gate && NS.tdCover(w, t, s.x, s.y, NS.tdFacing(w, t, s.x, s.y)) >= 5)) fail(`${id}: platform ${k} covers no way`);
    });
    for (const [r, route] of td.routes.entries()) {
      for (const [x, y] of route.cells) {
        if (!route.air && !w.walkable(NS.TD_FOE, x, y)) fail(`${id}: way ${r} not walkable at ${x},${y}`);
        if (!route.air && platformAt.has(at(x, y))) fail(`${id}: way ${r} crosses platform ${platformAt.get(at(x, y))} at ${x},${y}`);
      }
      const [dx, dy] = route.cells.at(-1);
      if (Math.max(temple.x - dx, 0, dx - (temple.x + temple.fx - 1)) + Math.max(temple.y - dy, 0, dy - (temple.y + temple.fy - 1)) !== 1) fail(`${id}: way ${r} ends at ${dx},${dy}, not at the Temple's door`);
    }
    // won by the careful player with the Priest; lost with nothing raised
    const careful = play(id, PLANS[id]), idle = play(id, null);
    if (careful.td.over !== 'won') fail(`${id}: the careful player ${careful.td.over ?? 'did not finish'} (${careful.td.lives} lives, wave ${careful.td.wave})`);
    if (idle.td.over !== 'lost') fail(`${id}: with nothing raised the battle was ${idle.td.over ?? 'not over'}`);
    told.push(`${id} ${careful.td.lives}/${careful.td.livesMax}`);
  }

  // the rules, on the second battle
  const fresh = () => { const w = NS.createTd(defs, 'ferries'); w.players.get(NS.TD_ME).storm = 5000; return [w, w.td, w.players.get(NS.TD_ME)]; };
  const foe = (w, td, type, hp = 1, route = 0) => { td.due.push({ at: w.tick, group: { foe: type, n: 1, every: 1, at: 0, route, hp } }); w.step([]); return [...td.enemies.keys()].at(-1); };
  {
    // a gun raised, the platform taken; what the rules leave alone refused; a rank and its price
    const [w, td, side] = fresh();
    w.step([{ t: 'tdBuild', player: 1, spot: 6, type: 'raincannon' }, { t: 'tdBuild', player: 1, spot: 6, type: 'sunarcher' }, { t: 'build', player: 1, type: 'sunarcher', x: 100, y: 100 }, { t: 'tdBuild', player: 1, spot: 7, type: 'thundercannon' }]);
    const no = w.drainEvents().filter((e) => e.what === 'rejected').map((e) => e.data.err);
    if (JSON.stringify(no) !== JSON.stringify(['blocked', 'not here', 'not here'])) fail(`td: a second gun, a world's own building and a gun not of the battle answered ${JSON.stringify(no)}`);
    const gun = td.spots[6].tower;
    if (side.storm !== 5000 - NS.TD_TOWERS.raincannon.cost || w.entities.get(gun)?.type !== 'raincannon') fail('td: the Ice Cannon not raised for its price');
    w.step([{ t: 'tdUpgrade', player: 1, tower: gun }]);
    if (td.ranks.get(gun) !== 2 || NS.tdHit(w, w.entities.get(gun)) !== NS.TD_TOWERS.raincannon.power * NS.TD_RANK_HIT[1]) fail('td: the rank does not raise the hit');
    // sold for its share of what was spent on it
    const paid = side.storm;
    w.step([{ t: 'tdSell', player: 1, tower: gun }]);
    if (side.storm - paid !== Math.floor((NS.TD_TOWERS.raincannon.cost + NS.TD_TOWERS.raincannon.ranks[0]) * NS.TD_REFUND) || td.spots[6].tower !== null || w.entities.has(gun)) fail('td: the sale did not pay back its share');
  }
  {
    // a walker that reaches the Temple costs its lives, a Crab Storm Power as well; one brought down
    // pays its bounty; the rules pay nothing of their own for it, and no geyser rises
    const [w, td, side] = fresh();
    const crab = foe(w, td, 'rainwalker');
    w.entities.get(crab).path = [];
    side.storm = 100;
    w.step([]);
    if (td.lives !== td.livesMax - 1 || side.storm !== 100 - NS.TD_FOES.rainwalker.steals || td.leaked !== 1) fail(`td: a Crab at the Temple left ${td.lives} lives and ⚡${side.storm}`);
    const walker = foe(w, td, 'sunwalker');
    w.entities.get(walker).hp = 0;
    const storm = side.storm, geysers = [...w.entities.values()].filter((e) => e.kind === 'geyser').length;
    w.step([]);
    w.step([]);
    if (side.storm !== storm + NS.TD_FOES.sunwalker.bounty || td.killed !== 1 || [...w.entities.values()].filter((e) => e.kind === 'geyser').length !== geysers) fail(`td: a Golem brought down paid ⚡${side.storm - storm}`);
  }
  {
    // an Ice Cannon's shell chills the walker it strikes, and its ricochet spares the player's guns
    const [w, td] = fresh();
    w.step([{ t: 'tdBuild', player: 1, spot: 6, type: 'raincannon' }, { t: 'tdBuild', player: 1, spot: 7, type: 'sunarcher' }, { t: 'tdBuild', player: 1, spot: 8, type: 'sunarcher' }]);
    for (let i = 0; i < 20; i++) w.step([]);
    let chilled = false;
    for (let i = 0; i < 8; i++) foe(w, td, 'bulf', 20);
    for (let i = 0; i < 60 * NS.TPS; i++) {
      w.step([]);
      for (const [eid, enemy] of td.enemies) {
        if (enemy.chill > 0) { chilled = true; const t = w.entities.get(eid); if (t && NS.tdSpeed(w, t) >= NS.TD_FOES.bulf.speed) fail('td: a chilled walker is not slowed'); }
      }
    }
    if (!chilled) fail('td: no walker chilled by the Ice Cannon');
    for (const s of [6, 7, 8]) { const g = w.entities.get(td.spots[s].tower); if (!g || g.hp < g.hpMax) fail(`td: the gun on platform ${s} was struck by a ricochet`); }
  }
  {
    // a Spell: Thunder Strike hurts the horde about the spot, then must wait; Paralysis holds it
    const [w, td] = fresh();
    const a = foe(w, td, 'bulf'), e = w.entities.get(a);
    w.step([{ t: 'tdCast', player: 1, spell: 'bomblightingzap', x: e.x, y: e.y }]);
    w.step([{ t: 'tdCast', player: 1, spell: 'bomblightingzap', x: e.x, y: e.y }, { t: 'tdCast', player: 1, spell: 'bombparalyze', x: e.x, y: e.y }]);
    if (e.hp !== e.hpMax - NS.TD_STRIKE || e.paralyzed <= 0) fail(`td: Thunder Strike left ${e.hp} of ${e.hpMax}, Paralysis ${e.paralyzed} ticks`);
    if (!w.drainEvents().some((ev) => ev.what === 'rejected' && ev.data.err === 'not ready')) fail('td: a Spell cast again before it was ready');
  }
  {
    // the flagship holds the guns about it still; at the Temple it takes every life
    const [w, td] = fresh();
    w.step([{ t: 'tdBuild', player: 1, spot: 0, type: 'sunarcher' }]);
    for (let i = 0; i < 20; i++) w.step([]);
    td.due.push({ at: w.tick, group: { foe: 'windballoon', n: 1, every: 1, at: 0, route: 0, hp: 50, flagship: true } });
    let held = false;
    // over the gun first, then on to the Temple's door
    for (let i = 0; i < 12 * NS.TPS; i++) { w.step([]); if (w.entities.get(td.spots[0].tower)?.paralyzed > 0) held = true; }
    const ship = w.entities.get([...td.enemies.keys()][0]);
    if (ship) ship.path = td.routes[0].cells.slice(-8).map(([x, y]) => [x, y]);
    for (let i = 0; i < 40 * NS.TPS && !td.over; i++) { w.step([]); if (w.entities.get(td.spots[0].tower)?.paralyzed > 0) held = true; }
    if (!held) fail('td: the flagship held no gun still');
    if (td.over !== 'lost' || td.lives !== 0) fail(`td: the flagship at the Temple left ${td.lives} lives (${td.over})`);
  }
  {
    // the High Priest: a walker beside him held up, beating at him, struck by his bolts; beaten down
    // he lies, his acts refused and his walk too, and rises again where he fell with part of his
    // hit points; the guns about him blessed, and more in a Rally; the Storm Hammer within his reach
    // only, and not again before it is ready
    const [w, td] = fresh(), hero = td.hero, priest = NS.tdPriest(w);
    const bulf = foe(w, td, 'bulf', 50), b = w.entities.get(bulf);
    b.x = priest.x + 1;
    b.y = priest.y;
    w.step([]);
    if (!hero.holding.has(bulf) || NS.tdSpeed(w, b) !== 0) fail('td: the Priest does not hold up the walker beside him');
    const hp = hero.hp, its = b.hp;
    for (let i = 0; i < 2 * NS.TPS; i++) w.step([]);
    if (hero.hp >= hp || b.hp >= its) fail(`td: held, the Bulf took ${its - b.hp} and dealt ${hp - hero.hp}`);
    for (let i = 0; i < 60 * NS.TPS && hero.down === 0; i++) w.step([]);
    if (hero.down === 0 || priest.state !== 'down' || hero.holding.size) fail('td: beaten to nothing, the Priest is not down');
    w.step([{ t: 'tdHero', player: 1, act: 'rally' }, { t: 'movePriest', player: 1, x: priest.x - 3, y: priest.y }]);
    const no = w.drainEvents().filter((e) => e.what === 'rejected').map((e) => e.data.err);
    if (JSON.stringify(no) !== JSON.stringify(['priest unavailable', 'priest unavailable'])) fail(`td: down, his Rally and his walk answered ${JSON.stringify(no)}`);
    for (let i = 0; i < 30 * NS.TPS && hero.down > 0; i++) w.step([]);
    w.step([]);
    if (hero.down > 0 || priest.state !== 'normal' || hero.hp < hero.hpMax * 0.5) fail(`td: the Priest did not rise again (${priest.state}, ${hero.hp})`);
  }
  {
    const [w, td] = fresh(), priest = NS.tdPriest(w), hero = td.hero;
    // a Disc Thrower on the platform nearest him, another on the farthest
    const order = td.spots.map((s, k) => [k, Math.hypot(s.x + 1.5 - priest.x, s.y + 1.5 - priest.y)]).filter(([k]) => !td.spots[k].pair).sort((a, b) => a[1] - b[1]);
    const [nk] = order[0], [fk] = order.at(-1);
    // he stands just south of the nearer platform
    priest.x = td.spots[nk].x + 1;
    priest.y = td.spots[nk].y + 3;
    w.step([{ t: 'tdBuild', player: 1, spot: nk, type: 'sunarcher' }, { t: 'tdBuild', player: 1, spot: fk, type: 'sunarcher' }]);
    const near = w.entities.get(td.spots[nk].tower), far = w.entities.get(td.spots[fk].tower);
    const same = (a, b) => Math.abs(a - b) < 1e-9, within = Math.hypot(near.x + 1.5 - priest.x - 0.5, near.y + 1.5 - priest.y - 0.5) <= NS.TD_HERO.bless.reach[0];
    const blessed = NS.tdHit(w, near), plain = NS.tdHit(w, far);
    if (!within) fail('td: the platform beside the Priest is not within his blessing');
    if (!same(blessed, plain * NS.TD_HERO.bless.hit[0])) fail(`td: the gun beside the Priest hits ×${blessed / plain}`);
    w.step([{ t: 'tdHero', player: 1, act: 'rally' }]);
    if (!same(NS.tdHit(w, near), plain * NS.TD_HERO.rally.hit[0]) || !same(NS.tdHit(w, far), plain)) fail('td: the Rally did not raise the guns about him');
    if (hero.act?.kind !== 'rally') fail(`td: his Rally not kept as his act (${JSON.stringify(hero.act)})`);
    const a = foe(w, td, 'bulf', 20), e = w.entities.get(a);
    const refused = (err) => w.drainEvents().some((ev) => ev.what === 'rejected' && ev.data.err === err);
    // beyond his reach it is refused and nothing spent; within it, it falls; at once again, it is not ready
    w.drainEvents();
    w.step([{ t: 'tdHero', player: 1, act: 'hammer', tx: priest.x + NS.TD_HERO.hammer.range + 2, ty: priest.y }]);
    if (!refused('too far') || hero.cooldown.hammer !== 0) fail('td: the Storm Hammer fell beyond his reach');
    e.x = priest.x + 3;
    e.y = priest.y;
    const whole = e.hp;
    w.step([{ t: 'tdHero', player: 1, act: 'hammer', tx: e.x, ty: e.y }]);
    if (whole - e.hp < NS.TD_HERO.hammer.damage[0]) fail(`td: the Storm Hammer took only ${whole - e.hp} off what was in reach`);
    if (hero.act?.kind !== 'hammer' || hero.act.x !== e.x) fail(`td: the Storm Hammer not kept as his act (${JSON.stringify(hero.act)})`);
    w.drainEvents();
    w.step([{ t: 'tdHero', player: 1, act: 'hammer', tx: e.x, ty: e.y }]);
    if (!refused('not ready')) fail('td: the Storm Hammer again before it was ready');
    // his skills, bought: what each level gives is his
    const strong = NS.createTd(defs, 'ferries', { bolt: 3, bless: 3, rally: 3, hammer: 3, stand: 3, call: 3, muster: 3 }).td.hero;
    if (strong.hpMax !== NS.TD_HERO.stand.hp[3] || strong.skills.bless !== 3 || strong.skills.call !== 3) fail('td: the Priest\'s skills not his in the battle');
  }
  {
    // the Temple Guard: called beside the way, its Golems on the ground nearest the spot and its
    // Balloon aloft over it (by Temple Guard's level), none of them moving; the Golems' stones at the
    // walkers only, the Balloon's fire at an airship too; all gone when their time is up; not called
    // again before the wait (by Swift Summons's level), and called while the Priest lies beaten
    // down; never over the sky away from the ground
    const w = NS.createTd(defs, 'cloudwatch', { ...NS.TD_NO_SKILLS, call: 2, muster: 3 }), td = w.td, hero = td.hero;
    w.players.get(NS.TD_ME).storm = 5000;
    const refused = (err) => w.drainEvents().some((ev) => ev.what === 'rejected' && ev.data.err === err);
    const way = td.routes.find((r) => !r.air), spot = way.cells[Math.floor(way.cells.length / 2)];
    w.step([{ t: 'tdHero', player: 1, act: 'call', tx: spot[0], ty: spot[1] }]);
    const allies = [...td.allies].map(([id, a]) => ({ id, air: a.air, e: w.entities.get(id) }));
    const golems = allies.filter((a) => !a.air), balloons = allies.filter((a) => a.air);
    if (golems.length !== NS.TD_GUARD.golems[2] || balloons.length !== NS.TD_GUARD.balloons[2] || !balloons.every((b) => b.e?.aloft)) fail(`td: the Temple Guard came as ${golems.length} Golems and ${balloons.length} Balloons`);
    if (golems.some((g) => g.e.owner !== NS.TD_ME || Math.hypot(g.e.x - spot[0], g.e.y - spot[1]) > 1.5)) fail('td: the Guard\'s Golems not on the ground by the spot');
    if (hero.act?.kind !== 'call' || hero.cooldown.call < NS.TD_GUARD.wait[3] * NS.TPS - 1 || hero.cooldown.call > NS.TD_GUARD.wait[3] * NS.TPS) fail(`td: the call not kept (${JSON.stringify(hero.act)}, wait ${hero.cooldown.call})`);
    // a walker beside a Golem and an airship at the Balloon, both held still
    const g0 = golems[0].e, air = td.routes.findIndex((r) => r.air);
    const walker = w.entities.get(foe(w, td, 'bulf', 20)), ship = w.entities.get(foe(w, td, 'sunballoon', 20, air));
    walker.x = g0.x + 1;
    walker.y = g0.y;
    ship.x = balloons[0].e.x;
    ship.y = balloons[0].e.y;
    walker.paralyzed = ship.paralyzed = 10 * NS.TPS;
    w.drainEvents();
    const stood = allies.map((a) => [a.e.x, a.e.y]);
    let byGolem = 0, byBalloon = 0, golemAtShip = 0;
    for (let i = 0; i < 4 * NS.TPS; i++) {
      w.step([]);
      for (const ev of w.drainEvents()) {
        if (ev.what !== 'td' || ev.data.kind !== 'shot') continue;
        if (ev.data.air) byBalloon += ev.data.to === ship.id ? 1 : 0;
        else { byGolem += ev.data.to === walker.id ? 1 : 0; golemAtShip += ev.data.to === ship.id ? 1 : 0; }
      }
    }
    if (byGolem < 4 || golemAtShip || byBalloon < 3) fail(`td: the Guard's blows: Golems ${byGolem} at the walker and ${golemAtShip} at the airship, the Balloon ${byBalloon} at the airship`);
    if (walker.hp >= walker.hpMax || ship.hp >= ship.hpMax) fail('td: the Guard\'s blows took nothing off');
    if (allies.some((a, k) => a.e.x !== stood[k][0] || a.e.y !== stood[k][1]) || NS.tdSpeed(w, g0) !== 0) fail('td: the Temple Guard moved');
    w.step([{ t: 'tdHero', player: 1, act: 'call', tx: spot[0], ty: spot[1] }]);
    if (!refused('not ready')) fail('td: the Temple Guard called again before the wait');
    for (let i = 0; i < NS.TD_GUARD.stay[2] * NS.TPS && td.allies.size; i++) w.step([]);
    if (td.allies.size || allies.some((a) => w.entities.has(a.id))) fail('td: the Temple Guard stayed past its time');
    // over the sky, away from the ground: never; beaten down, the Priest still calls it
    while (hero.cooldown.call > 0) w.step([]);
    const sky = [5, 5];
    w.step([{ t: 'tdHero', player: 1, act: 'call', tx: sky[0], ty: sky[1] }]);
    if (NS.tdGuardCells(w, sky[0], sky[1]).length || !refused('bad target')) fail('td: the Temple Guard called over the sky');
    hero.down = 30 * NS.TPS;
    w.step([{ t: 'tdHero', player: 1, act: 'call', tx: spot[0], ty: spot[1] }]);
    if (!td.allies.size) fail('td: the Temple Guard did not come while the Priest lay beaten down');
    // half the Balloon's fire passes through a Cloud Floater held under it, as half of any shot does
    const over = [...td.allies].find(([, a]) => a.air), floater = w.entities.get(foe(w, td, 'rainballoon', 20, air));
    floater.x = w.entities.get(over[0]).x;
    floater.y = w.entities.get(over[0]).y;
    floater.paralyzed = 20 * NS.TPS;
    w.drainEvents();
    let fired = 0;
    for (let i = 0; i < 10 * NS.TPS; i++) {
      w.step([]);
      fired += w.drainEvents().filter((ev) => ev.what === 'td' && ev.data.kind === 'shot' && ev.data.to === floater.id).length;
    }
    const struck = Math.round((floater.hpMax - floater.hp) / NS.TD_GUARD.balloon.damage);
    if (fired < 8 || struck === 0 || struck === fired) fail(`td: of the Balloon's ${fired} shots at a Cloud Floater ${struck} struck it`);
  }
  console.log(`tower defense: ${NS.TD_LEVELS.length} battles laid out, each won by a careful player with the High Priest (lives left: ${told.join(', ')}) and lost with nothing raised; a gun raised, ranked and sold, a Crab stealing, a bounty paid, an Ice Cannon chilling and sparing the guns, the Spells, the flagship's hold; the Priest holding a walker up and beaten down, rising again, his blessing and Rally, the Storm Hammer in his reach, his skills; the Temple Guard standing where called, its Golems at the walkers and its Balloon at an airship (half its fire through a Cloud Floater), gone in time, its wait`);
}

// Every name of the engine that the client's code uses is one the engine has (one was not: the
// shrine's ward, and its toast said "undefined").
{
  const lost = [];
  const read = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${f.name}`;
      if (f.isDirectory()) read(path);
      else if (f.name.endsWith('.js')) for (const m of readFileSync(path, 'utf8').matchAll(/\bNS\.([A-Za-z_$][\w$]*)/g)) if (!(m[1] in NS)) lost.push(`NS.${m[1]} in ${path}`);
    }
  };
  read('src');
  if (lost.length) fail(`the client uses names the engine does not have: ${[...new Set(lost)].join(', ')}`);
  if (NS.PRIEST_WARD_BOON !== 20 || NS.RELIC_HIT !== 1.25) fail(`the shrine's ward ${NS.PRIEST_WARD_BOON}, a relic's hit ${NS.RELIC_HIT}`);
  console.log(`names: every name of the engine the client uses is there (${Object.keys(NS).length} in all)`);
}

console.log(`check passed: ${played}`);
