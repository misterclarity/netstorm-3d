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
    if (d.rooms.length < 6 || d.chests.length < 2 || d.chests.filter((c) => c.holds.length).length !== 1) fail(`seed ${seed}: ${d.rooms.length} rooms, chests ${JSON.stringify(d.chests)}`);
    for (const r of d.rooms) kinds.add(r.kind);
    // every chest has a floor tile beside it the stairs reach
    const N = d.w, seen = new Uint8Array(N * N), q = [d.arrive[1] * N + d.arrive[0]];
    seen[q[0]] = 1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % N, y = (i / N) | 0;
      for (const [dx, dy] of NS.DIRS) { const j = (y + dy) * N + x + dx; if (!seen[j] && d.tiles[j] === NS.TILE.floor) { seen[j] = 1; q.push(j); } }
    }
    for (const c of d.chests) if (!NS.DIRS.some(([dx, dy]) => seen[(c.y + dy) * N + c.x + dx])) fail(`seed ${seed}: chest ${c.id} out of reach`);
    for (const r of d.rooms) if (!seen[(r.y + (r.h >> 1)) * N + r.x + (r.w >> 1)] && d.tiles[(r.y + (r.h >> 1)) * N + r.x + (r.w >> 1)] === NS.TILE.floor) fail(`seed ${seed}: a ${r.kind} room out of reach`);
    if (!w.view().canBuild({ player: NS.ME, type: 'windbattery', x: d.x, y: d.y }) === null) fail('a Generator could be built on the portal');
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
  const chest = d.chests.find((c) => c.holds.length);
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
  console.log(`dungeons: ${seeds} dug, rooms of ${kinds.size} kinds, every chest in reach and one holding a Spell; down, out of reach, walked, the chest opened (${p.spell}), no cast below, out by the stairs, up again after ${NS.DEEP_SECONDS} s; the Hover prayed for, 1.8 times his pace, spent`);
}

console.log(`check passed: ${played}`);
