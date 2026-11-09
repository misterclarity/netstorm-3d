/**
 * An esbuild plugin with netstorm-3d's own changes to netstorm-web's rules, made as the sim's
 * source is bundled: the submodule itself is not changed. Each change names the exact text it
 * replaces; if netstorm-web's code there has changed, the build fails here instead of quietly
 * playing by other rules.
 *
 * A downed enemy Priest can be picked up without an Altar. The original's help says only "Once
 * immobilized, you can send a Transport to pick up the Priest" and lists High Priests among the
 * cargo a Transport picks up; netstorm-web refuses the order ('no altar') until one stands. Here
 * the Transport takes him and, with no Altar (or no way to one), holds him where it stands, as it
 * does when a sacrifice is refused as too early: the captive cannot get up and walk home, and
 * the carrier is sent on to the Altar later ("Carry to the Altar" on its card).
 *
 * A Transport can be sent to a place, not only for something: the command `moveTransport` (below).
 * And the computer captures by the same rule as the player, and a Priest whose geyser is spent
 * waits for orders instead of walking off to another (below).
 */
import { readFile } from 'node:fs/promises';

const CHANGES = [
  {
    file: 'rules/capture.ts',
    why: 'a downed enemy Priest is picked up without an Altar',
    was: `  } else if (p.state !== 'down') {
    return 'target not incapacitated';
  } else if (!ownAltar(world, c.player)) {
    return 'no altar';
  }`,
    now: `  } else if (p.state !== 'down') {
    return 'target not incapacitated';
  }`,
  },
  {
    file: 'rules/capture.ts',
    why: 'with no Altar to go to, the carrier holds its captive',
    was: `    || Math.abs(p.x - t.x) + Math.abs(p.y - t.y) > 1
    || !altar
  ) {
    stop(t);
    return;
  }

  const path = world.wayOf(t, (cell) => world.adjacentTo(cell[0], cell[1], altar));

  if (!path) {
    stop(t);
    return;
  }

  // Picking up is instant here; how long it takes in the original is unknown.
  p.state = 'carried';
  p.carriedBy = t.id;
  p.path = [];
  t.carrying = p.id;
  t.path = path;
  t.goal = 'altar';
  t.target = altar.id;
  world.emit({ what: 'captured', who: t.owner, data: { priest: p.id } });`,
    now: `    || Math.abs(p.x - t.x) + Math.abs(p.y - t.y) > 1
    || (friend && !altar)
  ) {
    stop(t);
    return;
  }

  const path = altar ? world.wayOf(t, (cell) => world.adjacentTo(cell[0], cell[1], altar)) : null;

  if (!path && friend) {
    stop(t);
    return;
  }

  // Picking up is instant here; how long it takes in the original is unknown.
  p.state = 'carried';
  p.carriedBy = t.id;
  p.path = [];
  t.carrying = p.id;
  if (altar && path) {
    t.path = path;
    t.goal = 'altar';
    t.target = altar.id;
  } else {
    // (netstorm-3d) no Altar yet, or no way to it: the carrier holds the captive where it stands
    t.path = [];
    stop(t);
  }
  world.emit({ what: 'captured', who: t.owner, data: { priest: p.id } });`,
  },
];

// A Transport sent to a place: "Left-click on a Transport ... Left-click someplace legal, and the
// Transport will move there" (the original's help). netstorm-web sends one only for something
// (a geyser, a crystal, a Priest, an Obelisk). A legal place here is ground a Transport may stand
// on: not the sky, not inside a building. An Aerial Transport flies there and lands; one on foot
// walks there if it can. What it carries it keeps.
CHANGES.push({
  file: 'world.ts',
  why: 'a Transport is moved to a place (moveTransport)',
  was: `      case 'dropCargo':
        return unload(this, c);`,
  now: `      case 'dropCargo':
        return unload(this, c);
      case 'moveTransport':
        return moveTransportTo(this, c);`,
}, {
  file: 'world.ts',
  why: 'a Transport is moved to a place (moveTransport)',
  was: `/** Whether (x, y) lies inside the rim of a building's footprint: not on its outermost cells. */
function withinRim(`,
  now: `/** (netstorm-3d) A Transport sent to a place: see scripts/house-rules.mjs. */
function moveTransportTo(
  world: World,
  c: { player: number; transport: number; x: number; y: number; },
): CommandError | null {
  const t = world.entities.get(c.transport);

  if (!t || t.kind !== 'transport' || t.owner !== c.player || t.casting > 0) {
    return 'bad target';
  }

  if (!world.walkable(c.player, c.x, c.y)) {
    return 'no path';
  }

  const path = world.wayOf(t, (cell) => cell[0] === c.x && cell[1] === c.y);

  if (!path) {
    return 'no path';
  }

  t.path = path;
  t.goal = 'idle';
  t.target = null;
  return null;
}

/** Whether (x, y) lies inside the rim of a building's footprint: not on its outermost cells. */
function withinRim(`,
});

// The computer plays by the same rule: it sends its carriers for a downed Priest whether or not
// it has an Altar yet (it builds one when an enemy Priest is down), and a carrier holding a
// captive is sent on to the Altar once one stands, not asked to every move and refused.
CHANGES.push({
  file: 'ai.ts',
  why: 'the computer captures before it has an Altar',
  was: `function capture(world: WorldView, move: Move, transports: View<Transport>[]): void {
  // A captive held by a transport that stands (a Crab took him, or it was too early for the
  // Sacrifice) goes on to the Altar.
  for (const t of transports) {
    const held = t.carrying === null ? undefined : world.entities.get(t.carrying);

    if (t.goal === 'idle' && held?.kind === 'priest' && world.hostile(held.owner, move.me)) {`,
  now: `function capture(world: WorldView, move: Move, transports: View<Transport>[]): void {
  // (netstorm-3d) an Altar is no longer needed to capture, only to go on to it
  const altar = world.buildingsOf(move.me).some((b) => b.type === ALTAR && b.rising === 0);

  // A captive held by a transport that stands (a Crab took him, it was too early for the
  // Sacrifice, or there was no Altar yet) goes on to the Altar once there is one.
  for (const t of transports) {
    const held = t.carrying === null ? undefined : world.entities.get(t.carrying);

    if (altar && t.goal === 'idle' && held?.kind === 'priest' && world.hostile(held.owner, move.me)) {`,
}, {
  file: 'ai.ts',
  why: 'the computer captures before it has an Altar',
  was: `  const home = world.templeOf(move.me);
  // Without an Altar that stands, the world refuses the capture: the Altar comes first.
  const altar = world.buildingsOf(move.me).some((b) => b.type === ALTAR && b.rising === 0);

  // He has to be within a step of ground the transports can walk to: a bridge that merely lies
  // beside his island does not lead onto it.
  if (!home || !altar) {`,
  now: `  const home = world.templeOf(move.me);

  // He has to be within a step of ground the transports can walk to: a bridge that merely lies
  // beside his island does not lead onto it.
  if (!home) {`,
});

// A Priest collects only from the geyser he was sent to: once it is spent (or gone) he stops and
// waits for orders. netstorm-web sends any carrier on to the geyser nearest its Temple, which can
// walk the most precious unit to the front; Transports still move on.
CHANGES.push({
  file: 'rules/movement.ts',
  why: 'a Priest does not seek another geyser',
  was: `function seekGeyser(world: World, t: Carrier): void {
  const home = world.templeOf(t.owner);`,
  now: `function seekGeyser(world: World, t: Carrier): void {
  // (netstorm-3d) a Priest waits for orders instead
  if (t.kind === 'priest') {
    stop(t);
    return;
  }

  const home = world.templeOf(t.owner);`,
});

// The assault first (a level's choice, `assaultFirst`). netstorm-web's opponent spends on a defence
// as soon as enemy ground comes within 12 cells, fired on or not, and holds a reserve for one: two
// sides whose islands face each other then pour everything into guns at home, and the guns it wants
// at the enemy's Priest or Temple are never paid for (measured in npm run ai:arena: Hard knocked
// Easy's Priest out by the tenth minute in every match and won none). A level that puts the
// assault first, while its guns are wanted at the enemy and nothing of its own is fired on or lost,
// keeps neither: Storm Power goes to the assault. A real attack still calls the defence at once.
CHANGES.push({
  file: 'ai/params.ts',
  why: 'a level may put the assault first',
  was: `  siegeSeconds: number;
}`,
  now: `  siegeSeconds: number;
  /** (netstorm-3d) While its guns are wanted at the enemy and it is not fired on, no defence for
   * ground that merely comes near, and no reserve held for one. */
  assaultFirst: boolean;
}`,
}, {
  file: 'ai/params.ts',
  why: 'a level may put the assault first',
  was: `    siegeSeconds: Infinity,
  },`,
  now: `    siegeSeconds: Infinity,
    assaultFirst: false,
  },`,
}, {
  file: 'ai/params.ts',
  why: 'a level may put the assault first',
  was: `    siegeSeconds: 240,
  },`,
  now: `    siegeSeconds: 240,
    assaultFirst: false,
  },`,
}, {
  file: 'ai/params.ts',
  why: 'a level may put the assault first',
  was: `    siegeSeconds: 120,
  },`,
  now: `    siegeSeconds: 120,
    assaultFirst: true,
  },`,
}, {
  file: 'ai.ts',
  why: 'a level may put the assault first',
  was: `  const params: Readonly<AiParams> = {
    ...DIFFICULTY[options.difficulty ?? 'normal'],`,
  now: `  const params: Readonly<AiParams> = {
    ...DIFFICULTY[options.difficulty ?? 'normal'],
    // (netstorm-3d) a level's knobs turned for a trial by scripts/ai-arena.mjs (TUNE); never in play
    ...((globalThis as { __nsAiTune?: Record<string, Partial<AiParams>>; }).__nsAiTune?.[options.difficulty ?? 'normal'] ?? {}),`,
}, {
  file: 'ai.ts',
  why: 'a level may put the assault first',
  was: `  const seen = noticed(world, memory, params.reactionMoves * params.moveSeconds);`,
  now: `  const seen = noticed(world, memory, params.reactionMoves * params.moveSeconds);
  // (netstorm-3d) whether the last move wanted guns at the enemy; this move finds out anew
  const assaultWanted = (memory as { assaultWanted?: boolean; } | undefined)?.assaultWanted ?? false;
  if (memory) (memory as { assaultWanted?: boolean; }).assaultWanted = false;`,
}, {
  file: 'ai.ts',
  why: 'a level may put the assault first',
  was: `  const defend = defendScore(pressure);`,
  now: `  // (netstorm-3d) the assault first: no defence for ground that merely comes near, nor a reserve
  const assaultFirst = params.assaultFirst && assaultWanted && !pressure.fired && pressure.losses === 0;
  const defend = assaultFirst ? 0 : defendScore(pressure);`,
}, {
  file: 'ai.ts',
  why: 'a level may put the assault first',
  was: `  let reserve = defend === 0 ? Math.min(move.budget, params.reserveShooters * cheapest) : 0;`,
  now: `  let reserve = defend === 0 && !assaultFirst ? Math.min(move.budget, params.reserveShooters * cheapest) : 0;`,
}, {
  file: 'ai.ts',
  why: 'a level may put the assault first',
  was: '    const at = `the head at ${head.x},${head.y} toward ${describeTarget(target)}`;',
  now: '    const at = `the head at ${head.x},${head.y} toward ${describeTarget(target)}`;\n'
    + '    if (memory && atPriest && (covering < params.concentrate || siege)) (memory as { assaultWanted?: boolean; }).assaultWanted = true;',
});

// Carriers in wait (a level's `stageCarriers`). A Priest knocked out gets up again within
// seconds; netstorm-web's opponent sends its carriers for him only once he is down, from wherever
// they work, and they rarely come in time (traced in the arena: an enemy Priest down seven times
// over ten minutes before one was carried off). Its notes say why it could do no better: no
// command sent a transport to a place. This game has one (above). While the enemy Priest is
// being shot at and stands within six cells of ground its carriers walk to, the level's number of
// them wait at the nearest such cell out of enemy fire, and are not sent collecting meanwhile.
CHANGES.push({
  file: 'ai/params.ts',
  why: 'carriers wait near an enemy Priest under fire',
  was: `  assaultFirst: boolean;
}`,
  now: `  assaultFirst: boolean;
  /** (netstorm-3d) Carriers that wait near the enemy Priest while he is shot at, to carry him off
   * the moment he falls. */
  stageCarriers: number;
}`,
}, ...[['    siegeSeconds: Infinity,\n    assaultFirst: false,', 0], ['    siegeSeconds: 240,\n    assaultFirst: false,', 1], ['    siegeSeconds: 120,\n    assaultFirst: true,', 2]]
  .map(([was, n]) => ({ file: 'ai/params.ts', why: 'carriers wait near an enemy Priest under fire', was, now: `${was}\n    stageCarriers: ${n},` })),
{
  file: 'ai.ts',
  why: 'carriers wait near an enemy Priest under fire',
  was: `    collect(world, move, transports, geysers, options.avoidDanger !== false);`,
  now: `    // (netstorm-3d) the carriers waiting by an enemy Priest under fire are not sent collecting
    const waiting = stage(world, move, memory, transports, reached);
    // (netstorm-3d) and those a level sends to cast a Spell where it strikes the most (strikeRun)
    for (const id of move.params.spellUse >= 2 ? strikeRun(world, move, transports, reached) : []) waiting.add(id);
    collect(world, move, transports.filter((t) => !waiting.has(t.id)), geysers, options.avoidDanger !== false);`,
}, {
  file: 'ai.ts',
  why: 'carriers wait near an enemy Priest under fire',
  was: `/** Send one transport for a downed enemy priest, unless one is already on its way to him. */`,
  now: `/**
 * (netstorm-3d) While the enemy Priest is shot at (up, below his full health), or his Temple is,
 * whose fall knocks him out, and he stands within eight cells of ground the AI's carriers walk to,
 * the level's number of carriers wait at the nearest cell of that ground out of enemy fire, so
 * that one is by him the moment he falls. Those already waiting stay; the others are the nearest
 * without cargo. Two carriers are always left to carry crystals, and once one that waited is lost
 * (traced in the arena: Hard lost all four of its Sail Skaters so, and its income with them), none
 * waits for two minutes. Returns the carriers kept waiting.
 */
function stage(
  world: WorldView,
  move: Move,
  memory: AiMemory | undefined,
  transports: View<Transport>[],
  reached: Uint8Array | null,
): Set<number> {
  const kept = new Set<number>();
  const mem = memory as { staged?: number[]; stageLost?: number; } | undefined;

  // One that waited and is gone was shot where it stood: none waits for a while after.
  if (mem?.staged?.some((id) => !world.entities.has(id))) {
    mem.stageLost = world.tick;
  }

  const cooling = mem?.stageLost !== undefined && world.tick - mem.stageLost < STAGE_COOLDOWN * TPS;
  // and never so many that fewer than two are left to carry crystals
  const want = cooling ? 0 : Math.min(move.params.stageCarriers ?? 0, transports.length - STAGE_KEEP);
  const foe = enemyPriest(world, move.me, 'normal');
  let spot: [number, number] | null = null;

  const foeTemple = foe ? world.templeOf(foe.owner) : undefined;
  const shot = foe && (foe.hp < foe.hpMax || (foeTemple !== undefined && foeTemple.hp < foeTemple.hpMax));

  if (want > 0 && reached && foe && shot) {
    let best = Infinity;

    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        const x = foe.x + dx;
        const y = foe.y + dy;
        const i = world.inside(x, y) ? world.at(x, y) : -1;

        if (i >= 0 && reached[i] === 1 && move.threat[i]! <= 0 && !world.takenBy(x, y) && Math.abs(dx) + Math.abs(dy) < best) {
          best = Math.abs(dx) + Math.abs(dy);
          spot = [x, y];
        }
      }
    }
  }

  if (!spot) {
    if (mem) mem.staged = [];
    return kept;
  }

  const [sx, sy] = spot;
  const before = new Set(mem?.staged ?? []);
  const free = transports.filter((t) => t.carrying === null && t.goal !== 'capture' && t.goal !== 'altar')
    .sort((a, b) => Number(before.has(b.id)) - Number(before.has(a.id))
      || Math.abs(a.x - sx) + Math.abs(a.y - sy) - (Math.abs(b.x - sx) + Math.abs(b.y - sy)));

  for (const t of free.slice(0, want)) {
    kept.add(t.id);
    const end = t.path.length ? t.path[t.path.length - 1]! : [t.x, t.y];

    if (Math.abs(end[0] - sx) + Math.abs(end[1] - sy) > 2) {
      move.commands.push({ t: 'moveTransport', player: move.me, transport: t.id, x: sx, y: sy } as unknown as Command);
    }
  }

  if (mem) mem.staged = [...kept];
  return kept;
}

/** Seconds no carrier waits by the enemy Priest after one that waited was lost, and carriers kept
 * carrying crystals (invented). */
const STAGE_COOLDOWN = 120;
const STAGE_KEEP = 2;

/** Send one transport for a downed enemy priest, unless one is already on its way to him. */`,
});

// Capture runs it would survive (a level's `safeCapture`). Traced in the arena: carriers sent for a
// downed Priest, or to wait by him, walked through his guns and died on the way, six in six minutes
// (some 2400 Storm Power) with no capture. netstorm-web's opponent already weighs a way to a geyser
// so (the fire along it, at the carrier's pace, against its hit points); with this, a level weighs
// the way to a downed Priest, and to the cell where carriers wait, the same, and sends none on a
// way it would not survive.
CHANGES.push({
  file: 'ai/params.ts',
  why: 'capture runs a carrier would survive',
  was: `  stageCarriers: number;
}`,
  now: `  stageCarriers: number;
  /** (netstorm-3d) Sends no carrier for a downed Priest, or to wait by him, on a way through more
   * fire than it would survive. */
  safeCapture: boolean;
}`,
}, ...[['    stageCarriers: 0,', false], ['    stageCarriers: 1,', true], ['    stageCarriers: 2,', true]]
  .map(([was, on]) => ({ file: 'ai/params.ts', why: 'capture runs a carrier would survive', was, now: `${was}\n    safeCapture: ${on},` })),
{
  file: 'ai.ts',
  why: 'capture runs a carrier would survive',
  was: `import { facesWhenLaid } from './rules/combat.js';`,
  now: `import { facesWhenLaid, shotInterval } from './rules/combat.js';`,
}, {
  file: 'ai.ts',
  why: 'capture runs a carrier would survive',
  was: `  const runners = transports
    .filter((t) => t.carrying === null && t.goal !== 'capture')
    .map((t) => ({
      t,
      way: world.findPath(move.me, t.x, t.y, ([x, y]) => distance(x, y, captive.x, captive.y) <= 1)
        ?.length ?? Infinity,
    }))`,
  now: `  const runners = transports
    .filter((t) => t.carrying === null && t.goal !== 'capture')
    .map((t) => {
      const path = world.findPath(move.me, t.x, t.y, ([x, y]) => distance(x, y, captive.x, captive.y) <= 1);
      // (netstorm-3d) a run the carrier would not survive is no run
      return { t, way: path && (!move.params.safeCapture || survives(world, move, t, path)) ? path.length : Infinity };
    })`,
}, {
  file: 'ai.ts',
  why: 'capture runs a carrier would survive',
  was: `  for (const t of free.slice(0, want)) {
    kept.add(t.id);`,
  now: `  for (const t of free) {
    if (kept.size >= want) break;
    // a carrier that would not live to get there stays where it is
    const way = before.has(t.id) ? null : world.findPath(move.me, t.x, t.y, ([x, y]) => x === sx && y === sy);
    if (!before.has(t.id) && (!way || (move.params.safeCapture && !survives(world, move, t, way)))) continue;
    kept.add(t.id);`,
}, {
  file: 'ai.ts',
  why: 'capture runs a carrier would survive',
  was: `/** Send one transport for a downed enemy priest, unless one is already on its way to him. */`,
  now: `/** (netstorm-3d) Whether a carrier lives through the enemy's fire along a way: the damage per
 * second on each cell, at its pace, against its hit points (as netstorm-web weighs a way to a
 * geyser). Only the way there: weighing the way back with the captive as well (and a gun's first
 * hit) sent fewer carriers, and in the arena won fewer battles than the risk does. */
function survives(world: WorldView, move: Move, t: View<Transport>, path: readonly (readonly [number, number])[]): boolean {
  return wayFire(world, move, world.def(t.type), path, 1, false) < t.hp;
}

/** (netstorm-3d) The damage a carrier of a kind takes along a way, walked \`trips\` times: the
 * enemy's damage per second on each cell at its pace, and, since a gun's first hit carries a whole
 * interval of its damage (rules/combat.ts), the heaviest such hit where it walks into fire. */
function wayFire(world: WorldView, move: Move, def: Readonly<UnitDef>, path: readonly (readonly [number, number])[], trips = 1, withHits = true): number {
  const hits = withHits ? shotMap(world, move) : null;
  let dps = 0;
  let hit = 0;

  for (const [x, y] of path) {
    const i = world.at(x, y);
    dps += move.threat[i]!;
    hit = hits ? Math.max(hit, hits[i]!) : 0;
  }

  return trips * (dps / def.speed + hit);
}

const shotMaps = new WeakMap<Move, Float32Array>();

/** (netstorm-3d) On each cell, the damage of one hit of each enemy gun that reaches it, a cannon
 * along its line (all four for the Sun Cannon), any other over the square of its range; made once
 * a move. */
function shotMap(world: WorldView, move: Move): Float32Array {
  let grid = shotMaps.get(move);

  if (grid) {
    return grid;
  }

  grid = new Float32Array(W * H);

  for (const e of world.entities.values()) {
    if (e.kind !== 'building' || !world.hostile(e.owner, move.me) || e.invisible > 0 || e.hp <= 0) {
      continue;
    }

    const def = world.def(e.type);

    if (def.dps <= 0 || def.range <= 0 || def.group === 'fence' || e.type === 'thunderarcher') {
      continue;
    }

    const hit = (def.dps * shotInterval(def)) / TPS;

    if (def.group === 'cannon') {
      for (const f of e.type === 'suncannon' ? [0, 1, 2, 3] : [e.facing]) {
        const [dx, dy] = DIRS[f]!;
        let x = f === 1 ? e.x + e.fx : f === 3 ? e.x - 1 : e.x + (e.fx >> 1);
        let y = f === 0 ? e.y - 1 : f === 2 ? e.y + e.fy : e.y + (e.fy >> 1);

        for (let r = 0; r < def.range && world.inside(x, y); r++, x += dx, y += dy) {
          grid[world.at(x, y)]! += hit;
        }
      }
    } else {
      const cx = e.x + (e.fx >> 1);
      const cy = e.y + (e.fy >> 1);

      for (let y = cy - def.range; y <= cy + def.range; y++) {
        for (let x = cx - def.range; x <= cx + def.range; x++) {
          if (world.inside(x, y)) {
            grid[world.at(x, y)]! += hit;
          }
        }
      }
    }
  }

  shotMaps.set(move, grid);
  return grid;
}

/** Send one transport for a downed enemy priest, unless one is already on its way to him. */`,
});

// The alarm (a level's `alarm`). A level without it defends only what is fired on or lost, not
// ground that merely comes near: Easy, for a beginner, reacts instead of building a wall of guns
// at home before anyone attacks (in the arena it built as many guns as Hard).
CHANGES.push({
  file: 'ai/params.ts',
  why: 'a level may defend only when fired on',
  was: `  safeCapture: boolean;
}`,
  now: `  safeCapture: boolean;
  /** (netstorm-3d) Whether enemy ground coming near calls a defence, not only fire or a loss. */
  alarm: boolean;
}`,
}, ...[['    safeCapture: false,', false], ['    stageCarriers: 1,\n    safeCapture: true,', true], ['    stageCarriers: 2,\n    safeCapture: true,', true]]
  .map(([was, on]) => ({ file: 'ai/params.ts', why: 'a level may defend only when fired on', was, now: `${was}\n    alarm: ${on},` })),
{
  file: 'ai.ts',
  why: 'a level may defend only when fired on',
  was: `  const defend = assaultFirst ? 0 : defendScore(pressure);`,
  now: `  const calm = !pressure.fired && pressure.losses === 0;
  const defend = assaultFirst || (!params.alarm && calm) ? 0 : defendScore(pressure);`,
});

// The Priest kept safe (a level's `priestSafety`). Traced in the arena: Hard's Priest was knocked out
// seven times in six minutes, standing idle 130 cells from his Temple among the enemy's cannons. The
// opponent raises an Outpost on the first unowned island cell in the map's order, wherever that is,
// and its Priest walks there; nothing brings him back. A level that keeps its Priest safe raises it
// on the unowned ground nearest its Temple out of fire (none farther than 40 cells), and walks its
// Priest home when he stands idle far from his Temple and nothing else is asked of him.
CHANGES.push({
  file: 'ai/params.ts',
  why: 'the Priest kept safe',
  was: `  alarm: boolean;
}`,
  now: `  alarm: boolean;
  /** (netstorm-3d) Outposts near home, and the Priest walked home when idle far from it. */
  priestSafety: boolean;
}`,
}, ...[['    safeCapture: false,\n    alarm: false,', false], ['    stageCarriers: 1,\n    safeCapture: true,\n    alarm: true,', true], ['    stageCarriers: 2,\n    safeCapture: true,\n    alarm: true,', true]]
  .map(([was, on]) => ({ file: 'ai/params.ts', why: 'the Priest kept safe', was, now: `${was}\n    priestSafety: ${on},` })),
{
  file: 'ai.ts',
  why: 'the Priest kept safe',
  was: `  const free = reached.findIndex((walked, i) =>
    walked === 1 && world.terrain[i] === Terrain.Island && world.owner[i] === 0
  );`,
  now: `  // (netstorm-3d) a level that keeps its Priest safe: the unowned ground nearest the Temple out
  // of fire, not the first in the map's order, and none beyond the Priest's safe walk
  let free = -1;
  const home = world.templeOf(move.me);

  if (move.params.priestSafety && home) {
    let best = 40;
    reached.forEach((walked, i) => {
      if (walked !== 1 || world.terrain[i] !== Terrain.Island || world.owner[i] !== 0 || move.threat[i]! > 0) return;
      const d = Math.abs((i % W) - home.x) + Math.abs(Math.floor(i / W) - home.y);
      if (d < best) { best = d; free = i; }
    });
  } else {
    free = reached.findIndex((walked, i) =>
      walked === 1 && world.terrain[i] === Terrain.Island && world.owner[i] === 0
    );
  }`,
}, {
  file: 'ai.ts',
  why: 'the Priest kept safe',
  was: `  if (explain && !move.commands.length) {`,
  now: `  homeward(world, move);
  because('the Priest stands idle far from his Temple: he walks home');

  if (explain && !move.commands.length) {`,
}, {
  file: 'ai.ts',
  why: 'the Priest kept safe',
  was: `/** Send one transport for a downed enemy priest, unless one is already on its way to him. */`,
  now: `/** (netstorm-3d) A level that keeps its Priest safe walks him home, to ground beside his Temple out
 * of fire, when he stands idle more than 18 cells from it and this move asks nothing else of him. */
function homeward(world: WorldView, move: Move): void {
  const p = world.priestOf(move.me);
  const home = world.templeOf(move.me);

  if (
    !move.params.priestSafety || move.fleeing || move.ritual || !p || !home || p.state !== 'normal'
    || p.goal !== 'idle' || p.path.length > 0 || p.carrying !== null
  ) {
    return;
  }

  const asked = move.commands.some((c) => c.t === 'movePriest'
    || ((c.t === 'collect' || c.t === 'pickupCrystal') && c.transport === p.id)
    || (c.t === 'build' && PRIEST_BUILT.has(world.defs.get(c.type)?.cls ?? '')));
  const cx = home.x + home.fx / 2;
  const cy = home.y + home.fy / 2;

  if (asked || Math.hypot(p.x - cx, p.y - cy) <= 18) {
    return;
  }

  const way = world.findPath(move.me, p.x, p.y, ([x, y]) => Math.hypot(x - cx, y - cy) <= 8
    && move.threat[world.at(x, y)] === 0 && !world.occupant[world.at(x, y)] && !world.priestAt(x, y), true);
  const end = way?.at(-1);

  if (end) {
    move.commands.push({ t: 'movePriest', player: move.me, x: end[0], y: end[1] });
  }
}

/** Send one transport for a downed enemy priest, unless one is already on its way to him. */`,
});

// Lean Energy (a level's `leanEnergy`). The opponent lays a Generator along a bridge whenever its
// head is 18 cells from Energy, and its bridges grow toward several geysers and the enemy at once:
// in the arena a side had 25 to 37 Generators to 5 to 11 guns by the 24th minute, some 10000 Storm
// Power that never fired. A lean level lays none ahead of the guns while it has three more than
// guns; one a gun wants where it is laid is laid as before.
// Hard only: in the arena it took Hard to an idle enemy's Priest two minutes sooner (12.5 minutes
// against 14.9), but Normal's arm then lacked the Energy its slower guns wanted at the head and it
// came two minutes later (16.1 against 14.4, one map not won in 30).
CHANGES.push({
  file: 'ai/params.ts',
  why: 'no more Generators than guns need',
  was: `  priestSafety: boolean;
}`,
  now: `  priestSafety: boolean;
  /** (netstorm-3d) No Generator along a bridge while there are three more Generators than guns. */
  leanEnergy: boolean;
}`,
}, ...[['    alarm: false,\n    priestSafety: false,', false], ['    stageCarriers: 1,\n    safeCapture: true,\n    alarm: true,\n    priestSafety: true,', false], ['    stageCarriers: 2,\n    safeCapture: true,\n    alarm: true,\n    priestSafety: true,', true]]
  .map(([was, on]) => ({ file: 'ai/params.ts', why: 'no more Generators than guns need', was, now: `${was}\n    leanEnergy: ${on},` })),
{
  file: 'ai.ts',
  why: 'no more Generators than guns need',
  was: `  if (attack && first?.target.enemy && first.head && options.attack !== false) {
    carryEnergy(world, move, first.head, first.target);`,
  now: `  if (attack && first?.target.enemy && first.head && options.attack !== false && !lean(world, move)) {
    carryEnergy(world, move, first.head, first.target);`,
}, {
  file: 'ai.ts',
  why: 'no more Generators than guns need',
  was: `/** Send one transport for a downed enemy priest, unless one is already on its way to him. */`,
  now: `/** (netstorm-3d) A lean level with three more Generators than guns lays none ahead of a gun. */
function lean(world: WorldView, move: Move): boolean {
  if (!move.params.leanEnergy) {
    return false;
  }

  const mine = world.buildingsOf(move.me);
  const generators = mine.filter((b) => world.def(b.type).group === 'battery').length;
  const guns = mine.filter((b) => groundDps(world.def(b.type)) > 0).length;
  return generators >= guns + 3;
}

/** Send one transport for a downed enemy priest, unless one is already on its way to him. */`,
});

// A level's value for a new knob, set in each level's block of the table (easy, normal, hard).
const LEVEL_BLOCKS = ['    siegeSeconds: Infinity,\n    assaultFirst: false,', '    siegeSeconds: 240,\n    assaultFirst: false,', '    siegeSeconds: 120,\n    assaultFirst: true,'];
const perLevel = (why, field, values) => LEVEL_BLOCKS.map((was, i) => ({ file: 'ai/params.ts', why, was, now: `${was}\n    ${field}: ${values[i]},` }));

// The Priest's walks kept short (part of a level's `priestSafety`). Traced in the arena: between
// builds the opponent's Priest carries crystals from the geyser nearest home that no gun reaches,
// however far that is; Hard's walked 100 cells out, was knocked out on the way home and lay there
// for twenty minutes. A level that keeps its Priest safe sends him to no geyser farther than 24
// cells from his Temple; the transports work the far ones.
CHANGES.push({
  file: 'ai.ts',
  why: 'the Priest collects near home',
  was: `  const calm = reachable.filter((g) => move.threat[world.at(g.x, g.y)] === 0);`,
  now: `  // (netstorm-3d) a level that keeps its Priest safe: no geyser farther than 24 cells from home
  const cx = home.x + home.fx / 2;
  const cy = home.y + home.fy / 2;
  const calm = reachable.filter((g) => move.threat[world.at(g.x, g.y)] === 0
    && (!move.params.priestSafety || Math.hypot(g.x - cx, g.y - cy) <= 24));`,
});

// Carried off by air (a level's `airCapture`). Traced in the arena: Hard's guns knocked Normal's
// Priest out fifteen times across the sky, where no bridge of Hard's led to him, and no carrier on
// foot could fetch him. An Aerial Transport flies straight to a downed Priest (rules/capture.ts asks
// wayOf, which flies it), but netstorm-web's opponent only sends carriers that walk. A level that
// carries off by air sends what flies of its carriers too, straight to him, and once his Priest has
// lain where no ground of its own leads, buys one that flies, if its Fury knows one. And (for the
// levels that weigh a capture run) where every carrier it has would die on the way to him, as Hard's
// Golems did on the way to a Priest its guns had pinned down for eighteen minutes, it buys the
// cheapest that would live through the fire, saving up for it and salvaging a spare gun.
CHANGES.push({
  file: 'ai/params.ts',
  why: 'a downed Priest carried off by air',
  was: `  leanEnergy: boolean;
}`,
  now: `  leanEnergy: boolean;
  /** (netstorm-3d) Aerial Transports sent for a downed Priest, and one bought for him when he
   * lies where no ground of the side leads. */
  airCapture: boolean;
}`,
}, ...perLevel('a downed Priest carried off by air', 'airCapture', [false, false, true]), {
  file: 'ai.ts',
  why: 'a downed Priest carried off by air',
  was: `  if (
    !near(captive.x, captive.y)
    && !DIRS.some(([dx, dy]) => near(captive.x + dx, captive.y + dy))
  ) {
    return;
  }`,
  now: `  // (netstorm-3d) where no ground leads to him, a level that carries off by air sends what flies
  const onFoot = near(captive.x, captive.y) || DIRS.some(([dx, dy]) => near(captive.x + dx, captive.y + dy));
  const air = (t: View<Transport>): boolean => move.params.airCapture && flies(world.def(t.type));

  if (!onFoot && !transports.some(air)) {
    return;
  }`,
}, {
  file: 'ai.ts',
  why: 'a downed Priest carried off by air',
  was: `      const path = world.findPath(move.me, t.x, t.y, ([x, y]) => distance(x, y, captive.x, captive.y) <= 1);
      // (netstorm-3d) a run the carrier would not survive is no run`,
  now: `      const path = air(t) ? flight(t.x, t.y, captive.x, captive.y)
        : onFoot ? world.findPath(move.me, t.x, t.y, ([x, y]) => distance(x, y, captive.x, captive.y) <= 1) : null;
      // (netstorm-3d) a run the carrier would not survive is no run`,
}, {
  file: 'ai.ts',
  why: 'a downed Priest carried off by air',
  was: `  if (options.collect !== false && !firstTransport && transports.length < wanted) {
    newTransport(world, move, geysers.length === 0, 0);
    because(\`\${transports.length} transports, \${wanted} wanted for \${mined} geysers\`);
  }`,
  now: `  if (options.collect !== false && !firstTransport && transports.length < wanted) {
    newTransport(world, move, geysers.length === 0, 0);
    because(\`\${transports.length} transports, \${wanted} wanted for \${mined} geysers\`);
  }

  if (memory && options.capture !== false && !firstTransport) {
    const keep = fetcherFor(world, move, memory, transports, reached);
    because('the enemy Priest is down and no carrier of the side could fetch him: one that can is bought');
    move.budget -= keep;
    saving += keep;
  }`,
}, {
  file: 'ai.ts',
  why: 'a downed Priest carried off by air',
  was: `/** Send one transport for a downed enemy priest, unless one is already on its way to him. */`,
  now: `/** (netstorm-3d) The cells of a flight in a straight line, without the first. */
function flight(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const out: [number, number][] = [];

  for (let k = 1; k <= n; k++) {
    out.push([Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n)]);
  }

  return out;
}

/** (netstorm-3d) A carrier that can fetch the downed enemy Priest when none the side has can: one
 * that flies, once he has lain where no ground of the side leads (a level that carries off by air),
 * and the cheapest on foot that would live through the fire on the way where every carrier it has
 * would die (a level that weighs a capture run). One at a time. Short of the Storm Power for the one
 * on foot, a spare gun is salvaged for it and the move keeps what it has: returns what it keeps. */
function fetcherFor(
  world: WorldView,
  move: Move,
  memory: AiMemory,
  transports: View<Transport>[],
  reached: Uint8Array | null,
): number {
  const mem = memory as { wantFlier?: boolean; fetcher?: number; };
  const foe = enemyPriest(world, move.me, 'down');
  const home = world.templeOf(move.me);
  const near = (x: number, y: number): boolean => world.inside(x, y) && reached?.[world.at(x, y)] === 1;

  if (!home || (mem.fetcher !== undefined && world.tick - mem.fetcher < FETCH_WAIT * TPS)) {
    return 0;
  }

  const from = { x: home.x + home.fx, y: home.y + home.fy };
  const kinds = transportKinds(world, move.me)
    .filter((d) => move.budget >= d.cost)
    .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
  const buy = (def: Readonly<UnitDef> | undefined): void => {
    if (def && place(world, move, def, from).placed) {
      mem.fetcher = world.tick;
    }
  };
  const onFoot = foe && reached && (near(foe.x, foe.y) || DIRS.some(([dx, dy]) => near(foe.x + dx, foe.y + dy)));

  if (foe && reached && !onFoot && move.params.airCapture) {
    mem.wantFlier = true;
  }

  // Where no ground leads to him, or while he is up, only one that flies, if it is wanted.
  if (!foe || !onFoot) {
    if (mem.wantFlier && move.params.airCapture && !transports.some((t) => flies(world.def(t.type)))) {
      buy(kinds.find((d) => flies(d)));
    }

    return 0;
  }

  if (!move.params.safeCapture || transports.some((t) => t.goal === 'capture')) {
    return 0;
  }

  // The fire on the way to him: on an own carrier's way, or on the Priest's from home.
  const goal = ([x, y]: [number, number]): boolean => distance(x, y, foe.x, foe.y) <= 1;
  let way: [number, number][] | null = null;

  for (const t of transports) {
    const path = t.carrying === null && !flies(world.def(t.type)) ? world.findPath(move.me, t.x, t.y, goal) : null;

    if (path && survives(world, move, t, path)) {
      return 0; // one of them can go
    }

    way ??= path;
  }

  const own = world.priestOf(move.me);
  way ??= own ? world.findPath(move.me, own.x, own.y, goal) : null;
  const way2 = way;

  const def = way2
    ? transportKinds(world, move.me).filter((d) => !flies(d) && makerError(world, move.me, d) === null && wayFire(world, move, d, way2, 1, false) < d.hp)
      .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))[0]
    : undefined;

  if (!def) {
    return 0;
  }

  if (move.budget >= def.cost) {
    buy(def);
    return 0;
  }

  fundCapture(world, move);
  return Math.max(0, move.budget);
}

/** Seconds a carrier bought to fetch a Priest is given before another is (invented). */
const FETCH_WAIT = 20;

/** Send one transport for a downed enemy priest, unless one is already on its way to him. */`,
});

// A bridge to a downed Priest (a level's `chaseDowned`). Traced in the arena: Hard knocked Easy's
// Priest out seven cells from its own bridge head, and he lay there a minute; no ground of Hard's
// led to him, the bridge kept on toward his Temple, and the carriers sent once a piece happened to
// reach him died on the long way. A level that chases a downed Priest grows its first bridge of
// the move to the sky beside him while no ground of its leads there.
CHANGES.push({
  file: 'ai/params.ts',
  why: 'a bridge to a downed Priest',
  was: `  airCapture: boolean;
}`,
  now: `  airCapture: boolean;
  /** (netstorm-3d) A bridge to the sky beside a downed enemy Priest no ground of the side leads to. */
  chaseDowned: boolean;
}`,
}, ...perLevel('a bridge to a downed Priest', 'chaseDowned', [false, true, true]), {
  file: 'ai.ts',
  why: 'a bridge to a downed Priest',
  was: `  const wanted = geysers.slice(0, move.params.planningGeysers).map((g) => g.target);
  return attack ? [...nearest, ...wanted] : [...wanted, ...nearest];`,
  now: `  const wanted = geysers.slice(0, move.params.planningGeysers).map((g) => g.target);
  // (netstorm-3d) a downed enemy Priest no ground of the side leads to: the sky beside him first
  const fallen = move.params.chaseDowned ? enemyPriest(world, me, 'down') : undefined;
  const walked = (x: number, y: number): boolean => world.inside(x, y) && reached?.[world.at(x, y)] === 1;
  const chase: Target[] = fallen && reached && !walked(fallen.x, fallen.y)
    && !DIRS.some(([dx, dy]) => walked(fallen.x + dx, fallen.y + dy))
    ? [{ x: fallen.x, y: fallen.y, enemy: false, exact: true }]
    : [];
  return attack ? [...chase, ...nearest, ...wanted] : [...chase, ...wanted, ...nearest];`,
});

// A new geyser in a spent one's place takes over its carriers (a fix). A geyser spent in open sky
// stays as an empty one, and a new geyser may later rise on that spot, replacing it; carriers still
// bound for the empty one kept its id, which no longer named anything. The world's own check then
// refused every copy of the world made for the computer's moves (found in the arena: a match
// stopped at its 12th minute), so the opponent would stand still until the carrier arrived. Now
// they go on to the new geyser, which stands on the same cell.
CHANGES.push({
  file: 'rules/geysers.ts',
  why: 'carriers of a replaced geyser go to the new one',
  was: `    const g = world.addGeyser(at.x, at.y, world.geyserStock, sky);`,
  now: `    const g = world.addGeyser(at.x, at.y, world.geyserStock, sky);

    // (netstorm-3d) carriers bound for the spent geyser it replaces go to the new one in its place
    if (at.old) {
      for (const e of world.entities.values()) {
        if ((e.kind === 'transport' || e.kind === 'priest') && e.target === at.old.id) {
          e.target = g.id;
        }
      }
    }`,
});

// Energy enough for the gun wanted (a fix, for every level). This game's Energy rule counts icons:
// a level-2 gun needs two, a level-3 three, and a Generator gives one. netstorm-web's opponent lays
// a Generator for a gun short of Energy only where no Energy at all is near (18 cells), so a bridge
// head with one Generator by it never feeds the gun it wants there. Traced in the arena: Normal
// stood six cells from an idle enemy's Temple for four minutes with 1500 Storm Power and laid
// nothing. Now a gun short of Energy where some is near gets one more Generator at the head, up to
// three within the Energy's reach of it.
CHANGES.push({
  file: 'ai.ts',
  why: 'Energy enough for the gun wanted',
  was: `  if (short) {
    carryEnergy(world, move, head, target);
  }

  return false;
}`,
  now: `  if (short && !carryEnergy(world, move, head, target) && !move.energized
    && feeding(world, move.me, head) < 3 && generator(world, move, head)) {
    // (netstorm-3d) Energy near, but too little for the gun: one more Generator at the head
    move.energized = true;
    move.actions++;
  }

  return false;
}

/** (netstorm-3d) Own Generators whose Energy reaches a cell. */
function feeding(world: WorldView, me: number, at: { x: number; y: number; }): number {
  return world.buildingsOf(me).filter((b) => world.def(b.type).group === 'battery'
    && Math.hypot(b.x + b.fx / 2 - at.x - 0.5, b.y + b.fy / 2 - at.y - 0.5) <= world.energyRange).length;
}`,
});

// No crystal fetched from under the enemy's guns (a fix, for every level). netstorm-web's opponent
// sends an idle carrier for the first loose crystal it can walk to, wherever it lies. Traced in the
// arena: a carrier killed under the enemy's guns drops its crystal there, the next one walks in for
// it and dies, and so on, a carrier lost every minute and a half on both sides for fifteen minutes.
// A carrier now fetches only a crystal it would live to bring home: the fire on the way there and
// back, at its pace, against its hit points, as the opponent already weighs a way to a geyser,
// and a gun's first hit counted in full (wayFire): it carries seconds of the gun's damage, and
// three Sail Skaters died in a minute and a half for crystals under a row of cannons that the
// damage per second along the way made look safe.
CHANGES.push({
  file: 'ai.ts',
  why: 'no crystal fetched from under the guns',
  was: `    const crystal = loose.find((c) =>
      world.findPath(move.me, t.x, t.y, ([x, y]) => distance(x, y, c.x, c.y) <= 1) !== null
    );`,
  now: `    // (netstorm-3d) only one it would live to bring home: the fire there and back, at its pace
    const crystal = loose.find((c) => {
      const way = world.findPath(move.me, t.x, t.y, ([x, y]) => distance(x, y, c.x, c.y) <= 1);
      return way !== null && (!avoidDanger || flies(world.def(t.type)) || wayFire(world, move, world.def(t.type), way, 2) < t.hp);
    });`,
});

// Swift carriers (a level's `swiftCarriers`). netstorm-web's opponent buys the fastest carrier it can
// pay for the moment one is short, and keeps whatever it has. Traced in the arena: Hard, playing
// Wind, made do with Golems (1.8 cells a second, 50 hit points) all battle, never the Sail Skater
// (4.2, 180) its Fury knows, and its income fell from 34 crystals in the first five minutes to 4
// to 7 as its geysers came to lie 60 to 110 cells from the Temple. A level with swift carriers waits
// for the Storm Power for its swiftest when that is half as fast again as what it could buy now,
// and once it has its carriers, trades its slowest for a swift one when it can spare the price.
// A Bulf's pace counts double: it carries two crystals.
CHANGES.push({
  file: 'ai/params.ts',
  why: 'swift carriers',
  was: `  chaseDowned: boolean;
}`,
  now: `  chaseDowned: boolean;
  /** (netstorm-3d) The swiftest carrier waited for, and slow ones traded for it. */
  swiftCarriers: boolean;
}`,
}, ...perLevel('swift carriers', 'swiftCarriers', [false, true, true]), {
  file: 'ai.ts',
  why: 'swift carriers',
  was: `import { takesSlot } from './rules/building.js';`,
  now: `import { makerError, takesSlot } from './rules/building.js';`,
}, {
  file: 'ai.ts',
  why: 'swift carriers',
  was: `  if (options.collect !== false && !firstTransport && transports.length < wanted) {
    newTransport(world, move, geysers.length === 0, 0);`,
  now: `  // (netstorm-3d) a level with swift carriers trades its slowest for its swiftest, or saves for it
  const swift = params.swiftCarriers && options.collect !== false && !firstTransport
    ? swiftCarriers(world, move, transports, transports.length < wanted)
    : { keep: 0, done: false };
  move.budget -= swift.keep;
  saving += swift.keep;

  if (options.collect !== false && !firstTransport && transports.length < wanted && !swift.done) {
    newTransport(world, move, geysers.length === 0, 0);`,
}, {
  file: 'ai.ts',
  why: 'swift carriers',
  was: `/** Send one transport for a downed enemy priest, unless one is already on its way to him. */`,
  now: `/** (netstorm-3d) Crystals a carrier brings home a second: its pace, twice a Bulf's. */
function pace(def: Readonly<UnitDef>): number {
  return def.speed * (def.id === 'bulf' ? 2 : 1);
}

/**
 * (netstorm-3d) The swiftest carrier on foot the side knows, for a level with swift carriers. One
 * short (\`short\`), it buys it, or keeps the move's Storm Power for it when it cannot pay yet and it
 * is half as fast again as the best it could buy now. With its carriers all there, it buys one in
 * place of its slowest without cargo, which is salvaged, when that is half as slow and the price
 * leaves SWAP_SAVINGS over. A carrier above level 1 wants Energy by the Temple that the
 * computer's Temple alone does not give: a Generator of its Fury comes first. Returns what the move
 * keeps, and whether it saw to the carrier short.
 */
function swiftCarriers(
  world: WorldView,
  move: Move,
  transports: View<Transport>[],
  short: boolean,
): { keep: number; done: boolean; } {
  const home = world.templeOf(move.me);
  // Only one a Workshop of the side makes now: a Fury's carrier wants its Workshop, with it in a slot.
  const kinds = transportKinds(world, move.me).filter((d) => !flies(d) && makerError(world, move.me, d) === null);
  const swift = [...kinds].sort((a, b) => pace(b) - pace(a) || a.cost - b.cost || a.id.localeCompare(b.id))[0];
  const none = { keep: 0, done: false };

  if (!home || !swift) {
    return none;
  }

  const around = { x: home.x + home.fx, y: home.y + home.fy };
  // Bought, or Energy laid for it: the move keeps the rest for it.
  const buy = (): boolean => {
    const got = place(world, move, swift, around);

    if (!got.placed && got.noEnergy && !move.energized && generatorOf(world, move, swift, around)) {
      move.energized = true;
      move.actions++;
    }

    return got.placed;
  };

  if (short) {
    const now = kinds.filter((d) => d.cost <= move.budget).reduce((most, d) => Math.max(most, pace(d)), 0);

    if (pace(swift) < SWIFT_RATIO * now && move.budget < swift.cost) {
      return none;
    }

    if (move.budget >= swift.cost && buy()) {
      return { keep: 0, done: true };
    }

    return { keep: Math.max(0, move.budget), done: true };
  }

  const slow = transports
    .filter((t) => !flies(world.def(t.type)) && t.carrying === null && t.goal !== 'capture'
      && t.goal !== 'altar' && pace(world.def(t.type)) * SWIFT_RATIO <= pace(swift))
    .sort((a, b) => pace(world.def(a.type)) - pace(world.def(b.type)) || a.id - b.id)[0];

  if (slow && move.budget >= swift.cost + SWAP_SAVINGS && buy()) {
    move.commands.push({ t: 'salvage', player: move.me, target: slow.id });
  }

  return none;
}

/** (netstorm-3d) A Generator for a unit short of Energy at a place: of the unit's Fury first. */
function generatorOf(world: WorldView, move: Move, def: Readonly<UnitDef>, at: { x: number; y: number; }): boolean {
  const own = batteries(world, move.me).sort((a, b) =>
    Number(b.theme === def.theme) - Number(a.theme === def.theme) || a.id.localeCompare(b.id));

  return own.some((battery) => place(world, move, battery, at).placed);
}

/** How much swifter a carrier has to be to be waited for, or traded for (invented). */
const SWIFT_RATIO = 1.5;
/** Storm Power left over after a trade of a slow carrier for a swift one (invented): the slow one
 * salvaged gives some back, and the swift one pays for itself in a few trips. */
const SWAP_SAVINGS = 200;

/** Send one transport for a downed enemy priest, unless one is already on its way to him. */`,
}, {
  file: 'ai.ts',
  why: 'swift carriers',
  was: `      .sort(slotOrder);`,
  now: `      // (netstorm-3d) a level with swift carriers gives the first slot to its swiftest, if half as
      // fast again as a Golem
      .sort((a, b) => Number(swiftSlot(move, b)) - Number(swiftSlot(move, a)) || slotOrder(a, b));`,
}, {
  file: 'ai.ts',
  why: 'swift carriers',
  was: `/** Send one transport for a downed enemy priest, unless one is already on its way to him. */`,
  now: `/** (netstorm-3d) Whether a unit is a carrier on foot worth a level's first slot: half as fast
 * again as a Golem, where the level has swift carriers. */
function swiftSlot(move: Move, def: Readonly<UnitDef>): boolean {
  return move.params.swiftCarriers && def.cls === 'Ground Transport' && pace(def) >= SWIFT_RATIO * GOLEM_PACE;
}

/** A Golem's pace, cells a second (its .type file). */
const GOLEM_PACE = 1.8;

/** Send one transport for a downed enemy priest, unless one is already on its way to him. */`,
});

// A crystal left in a carrier's hands goes home (a fix, for every level). A carrier with a crystal
// that finds no way to the Temple when it sets out for it stops where it is, and netstorm-web's
// opponent only ever gives orders to carriers with empty hands. Traced in the arena: at Hard, all
// three carriers stood idle beside its island with a crystal each from the 24th minute on, eight
// cells from the Temple once the way was open again, and the side earned nothing more. Now such a
// carrier sets its crystal down, and the next move sends a carrier to pick it up, which takes it
// home.
CHANGES.push({
  file: 'ai.ts',
  why: 'a crystal left in a carrier\'s hands goes home',
  was: `  for (const t of transports) {
    if (t.goal !== 'idle' || t.carrying !== null) {
      continue;
    }
`,
  now: `  for (const t of transports) {
    // (netstorm-3d) one standing with a crystal sets it down, to be picked up and taken home
    if (t.goal === 'idle' && t.carrying !== null && world.entities.get(t.carrying)?.kind === 'crystal'
      && !t.aloft && t.climbing === 0) {
      move.commands.push({ t: 'dropCargo', player: move.me, transport: t.id });
      continue;
    }

    if (t.goal !== 'idle' || t.carrying !== null) {
      continue;
    }
`,
});

// Spells by level (a level's `spellUse`). netstorm-web's opponent uses Spells alike at every level:
// its Priest prays for the Devastation when idle, an idle carrier fetches a Spell from an Obelisk,
// and a caster casts where it happens to stand once enough enemies are in reach. Measured in the
// arena (seeds 1-4, each Spells setting), a side had one or two Spells a battle and cast less than
// one, which destroyed nothing. Now Easy (0) neither prays nor fetches Spells: a beginner meets no
// blast; Normal (1) plays as netstorm-web's; Hard (2) also sends a carrier holding a Spell to the
// ground in its reach where the Spell would strike the most of the enemy, on a way and a stand it
// would live through, and casts it there. And with Spells by prayer, where the Devastation is not
// to be had, the Priest of Normal and Hard prays for another blast (it prayed for nothing then).
CHANGES.push({
  file: 'ai/params.ts',
  why: 'spells by level',
  was: `  swiftCarriers: boolean;
}`,
  now: `  swiftCarriers: boolean;
  /** (netstorm-3d) 0: no Spells; 1: prayed for, fetched and cast where the caster stands; 2: and a
   * carrier with a Spell goes where it strikes the most of the enemy. */
  spellUse: number;
}`,
}, ...perLevel('spells by level', 'spellUse', [0, 1, 2]), {
  file: 'ai.ts',
  why: 'spells by level',
  was: `    !p || !prayable(world).includes(DEVASTATION) || p.state !== 'normal' || p.praying > 0`,
  now: `    !p || move.params.spellUse === 0 || !prayerOf(world) || p.state !== 'normal' || p.praying > 0`,
}, {
  file: 'ai.ts',
  why: 'spells by level',
  was: `  move.commands.push({ t: 'pray', player: move.me, spell: DEVASTATION });`,
  now: `  move.commands.push({ t: 'pray', player: move.me, spell: prayerOf(world)! });`,
}, {
  file: 'ai.ts',
  why: 'spells by level',
  was: `  if (!free || transports.some((t) => t.spell !== null || t.goal === 'obelisk')) {`,
  now: `  if (!free || move.params.spellUse === 0 || transports.some((t) => t.spell !== null || t.goal === 'obelisk')) {`,
}, {
  file: 'ai.ts',
  why: 'spells by level',
  was: `  castSpells(world, move, transports);`,
  now: `  castSpells(world, move, transports);
  because('a carrier holds a Spell: it goes where the Spell strikes the most of the enemy');`,
}, {
  file: 'ai.ts',
  why: 'spells by level',
  was: `/** Send one transport for a downed enemy priest, unless one is already on its way to him. */`,
  now: `/**
 * (netstorm-3d) A carrier holding a Spell the AI casts, idle or on its way to a geyser with no
 * cargo (not already on its way to cast), goes to the ground its side walks on where the Spell, cast, would be worth it (SPELL_USE) and
 * strike the most enemies: looked for about each enemy building and carrier within the Spell's
 * reach, on a coarse grid; on a way it would live through, and a stand of the cast time there; and
 * only with the Storm Power to cast it. castSpells casts it once it stands there. Returns the
 * carriers on such a run or standing for the cast, which are not sent collecting meanwhile.
 */
function strikeRun(world: WorldView, move: Move, transports: View<Transport>[], reached: Uint8Array | null): Set<number> {
  const claimed = new Set<number>();
  const storm = world.players.get(move.me)!.storm;

  if (!reached) {
    return claimed;
  }

  for (const t of transports) {
    const def = t.spell === null ? undefined : world.defs.get(t.spell);
    const wanted = t.spell === null ? undefined : SPELL_USE[t.spell];

    if (!def || !wanted || t.casting > 0 || t.carrying !== null || flies(world.def(t.type))) {
      continue;
    }

    // on its way to cast, or standing where it is worth it: it stays for the cast
    if ((t.goal === 'idle' && t.path.length > 0) || (t.goal === 'idle' && wanted(inRange(world, t, def.range)))) {
      claimed.add(t.id);
      continue;
    }

    // a run only with the Storm Power to cast at the end of it
    if ((t.goal !== 'idle' && t.goal !== 'collect') || def.cost > storm) {
      continue;
    }

    const step = def.range > 6 ? 2 : 1;
    const seen = new Set<number>();
    const spots: { x: number; y: number; foes: number; }[] = [];

    for (const e of world.entities.values()) {
      if ((e.kind !== 'building' && e.kind !== 'transport') || !world.hostile(e.owner, move.me)) {
        continue;
      }

      for (let dy = -def.range; dy <= def.range; dy += step) {
        for (let dx = -def.range; dx <= def.range; dx += step) {
          const x = e.x + dx;
          const y = e.y + dy;
          const i = world.inside(x, y) ? world.at(x, y) : -1;

          if (i < 0 || seen.has(i) || reached[i] !== 1 || world.occupant[i] || world.priestAt(x, y)) {
            continue;
          }

          seen.add(i);
          const there = { ...t, x, y } as View<Transport>;
          const reach = inRange(world, there, def.range);

          if (wanted(reach)) {
            spots.push({ x, y, foes: reach.foes + reach.foesAir });
          }
        }
      }
    }

    spots.sort((a, b) => b.foes - a.foes || Math.abs(a.x - t.x) + Math.abs(a.y - t.y) - (Math.abs(b.x - t.x) + Math.abs(b.y - t.y)));

    for (const s of spots.slice(0, STRIKE_TRIES)) {
      const way = world.findPath(move.me, t.x, t.y, ([x, y]) => x === s.x && y === s.y);
      const stand = (move.threat[world.at(s.x, s.y)]! + shotMap(world, move)[world.at(s.x, s.y)]!) * def.castTime;

      if (way && wayFire(world, move, world.def(t.type), way) + stand < t.hp) {
        move.commands.push({ t: 'moveTransport', player: move.me, transport: t.id, x: s.x, y: s.y } as unknown as Command);
        claimed.add(t.id);
        break;
      }
    }
  }

  return claimed;
}

/** The best spots a strike run weighs the way to (invented). */
const STRIKE_TRIES = 4;

/** (netstorm-3d) The Spell the Priest prays for: the Devastation where it is to be had; with Spells
 * by prayer, where it is not, the first of a few blasts the AI casts (netstorm-web's opponent only
 * ever prays for the Devastation, so with that setting it had no Spell at all). */
function prayerOf(world: WorldView): string | undefined {
  const can = prayable(world);
  return [DEVASTATION, 'bombexplodelarge', 'bombmeteor', 'bombexplodemedium'].find((id) => can.includes(id));
}

/** Send one transport for a downed enemy priest, unless one is already on its way to him. */`,
});

// The first carrier paid for (a fix, for every level). Traced in the arena: Normal lost its last
// carrier with 145 Storm Power, less than any carrier costs, and kept it for twelve minutes with
// eighteen guns standing idle at home, its Priest the only one carrying crystals. With no carrier and
// too little Storm Power for one, a side salvages a spare gun for the fare, as it does for a capture.
CHANGES.push({
  file: 'ai.ts',
  why: 'the first carrier paid for',
  was: `      explain?.(\`  no transport yet: \${saving} kept toward the first\`);`,
  now: `      explain?.(\`  no transport yet: \${saving} kept toward the first\`);

      // (netstorm-3d) too little for any: a spare gun salvaged for the fare
      if (fares.length && player.storm < Math.min(...fares)) {
        fundCapture(world, move);
      }`,
});

// Tiered islands (netstorm-3d's skirmish setting; src/heights.js draws them). The islands stand on
// three levels, -1, 0 and 1, kept in the world's `level`: the client gives each island its level
// as a match begins and sets `tiered`; the world gives each later islet its own. A bridge piece is
// laid on the level the player asks for (`level` in dropPiece; the computer asks for none and gets
// the level of what the piece joins). Where a walker steps between cells of different levels it
// rides a lift: the step takes LIFT_SECONDS a level longer, at any walker's pace, and all the while
// it hangs in the open and takes LIFT_EXPOSURE times the damage. On a level map every cell is on
// level 0 and nothing changes.
CHANGES.push({
  file: 'world.ts',
  why: 'tiered islands: each cell has a level',
  was: `  readonly wear = new Uint8Array(W * H);`,
  now: `  readonly wear = new Uint8Array(W * H);
  /** (netstorm-3d) The level of each cell's ground or bridge on tiered islands, -1, 0 or 1. */
  readonly level = new Int8Array(W * H);
  /** (netstorm-3d) Whether the islands stand on levels: a skirmish setting. */
  tiered = false;`,
}, {
  file: 'world.ts',
  why: 'tiered islands: a walker rides a lift between levels',
  was: `  view(): WorldView {
    return this;
  }`,
  now: `  view(): WorldView {
    return this;
  }

  /** (netstorm-3d) How many levels a walker's next step rides a lift by: 0 for none, on a level
   * map, or for what flies. */
  liftLevels(e: { kind: string; type?: string; x: number; y: number; path: readonly (readonly number[])[]; }): number {
    const next = e.path[0];

    if (!this.tiered || !next || (e.kind === 'transport' && flies(this.def(e.type!)))) {
      return 0;
    }

    return Math.abs(this.level[next[1]! * W + next[0]!]! - this.level[e.y * W + e.x]!);
  }`,
}, {
  file: 'rules/movement.ts',
  why: 'tiered islands: a lift ride takes time',
  was: `/** How far a walker has come towards the next cell of its path, 0 to 1; for drawing. */
export function stepShare(e: Walker & { readonly move: number; }): number {
  return Math.min(1, e.move / stepCost(e));
}`,
  now: `/** (netstorm-3d) Seconds a lift takes to carry a walker one level up or down. */
export const LIFT_SECONDS = 2;

/** (netstorm-3d) Progress a lift ride adds to a walker's next step: LIFT_SECONDS a level at its
 * own pace, so that every walker rides as long. */
function liftCost(world: World, e: Transport | Priest, speed: number): number {
  const levels = world.liftLevels(e);
  return levels ? Math.round(levels * LIFT_SECONDS * speed * MOVE_SCALE) : 0;
}

/** A walker's pace, cells a second (the Priest's as in priest.ts). */
function paceOf(world: World, e: Transport | Priest): number {
  return e.kind === 'priest' ? 1.8 : world.def(e.type).speed;
}

/** How far a walker has come towards the next cell of its path, 0 to 1; for drawing. With the
 * world, a lift ride counts. */
export function stepShare(e: Walker & { readonly move: number; }, world?: World): number {
  const lift = world && 'kind' in e ? liftCost(world, e as Transport | Priest, paceOf(world, e as Transport | Priest)) : 0;
  return Math.min(1, e.move / (stepCost(e) + lift));
}`,
}, {
  file: 'rules/movement.ts',
  why: 'tiered islands: a lift ride takes time',
  was: `  while (e.path.length && e.move >= stepCost(e)) {
    e.move -= stepCost(e);`,
  now: `  while (e.path.length && e.move >= stepCost(e) + liftCost(world, e, speed)) {
    e.move -= stepCost(e) + liftCost(world, e, speed);`,
}, {
  file: 'rules/combat.ts',
  why: 'tiered islands: a walker on a lift is exposed',
  was: `const AIR_PROOF: ReadonlySet<string> = new Set(['thunderblocker', 'bulf']);`,
  now: `const AIR_PROOF: ReadonlySet<string> = new Set(['thunderblocker', 'bulf']);

/** (netstorm-3d) The damage a walker riding a lift between levels takes, as a share of the hit. */
export const LIFT_EXPOSURE = 1.5;`,
}, {
  file: 'rules/combat.ts',
  why: 'tiered islands: a walker on a lift is exposed',
  was: `  const before = entity.hp;`,
  now: `  // (netstorm-3d) a walker riding a lift between levels hangs in the open
  if (amount > 0 && (entity.kind === 'transport' || entity.kind === 'priest') && world.liftLevels(entity) > 0) {
    amount *= LIFT_EXPOSURE;
  }

  const before = entity.hp;`,
}, {
  file: 'rules/bridges.ts',
  why: 'tiered islands: a piece is laid on a level',
  was: `export function dropPiece(
  world: World,`,
  now: `/** (netstorm-3d) The level a piece is laid on: the one asked for, on tiered islands, or else that
 * of the ground or bridge one of its open ends joins. */
function pieceLevel(world: World, c: { level?: number; }, cells: [number, number][], links: number[]): number {
  if (world.tiered && (c.level === -1 || c.level === 0 || c.level === 1)) {
    return c.level;
  }

  for (const [index, [x, y]] of cells.entries()) {
    for (const [dir, [dx, dy]] of DIRS.entries()) {
      const nx = x + dx, ny = y + dy;

      if ((links[index]! & (1 << dir)) === 0 || !world.inside(nx, ny) || cells.some(([cx, cy]) => cx === nx && cy === ny)) {
        continue;
      }

      if (world.terrain[world.at(nx, ny)] !== Terrain.Sky) {
        return world.level[world.at(nx, ny)]!;
      }
    }
  }

  return 0;
}

export function dropPiece(
  world: World,`,
}, {
  file: 'rules/bridges.ts',
  why: 'tiered islands: a piece is laid on a level',
  was: `  for (const [index, [x, y]] of cells.entries()) {
    world.terrain[world.at(x, y)] = strength;`,
  now: `  const level = pieceLevel(world, c, cells, links);

  for (const [index, [x, y]] of cells.entries()) {
    world.level[world.at(x, y)] = level;
    world.terrain[world.at(x, y)] = strength;`,
}, {
  file: 'rules/building.ts',
  why: 'tiered islands: an islet off a bridge is on its level',
  was: `  if (islet) {
    for (let y = c.y; y < c.y + def.footY; y++) {
      for (let x = c.x; x < c.x + def.footX; x++) {
        world.terrain[world.at(x, y)] = Terrain.Island;`,
  now: `  if (islet) {
    // (netstorm-3d) on the level of the bridge it is laid off
    let level: number | null = null;

    for (let y = c.y - 1; y <= c.y + def.footY && level === null; y++) {
      for (let x = c.x - 1; x <= c.x + def.footX && level === null; x++) {
        const t = world.inside(x, y) ? world.terrain[world.at(x, y)] : Terrain.Sky;

        if (t === Terrain.Bridge || t === Terrain.CrackedBridge || t === Terrain.HardBridge) {
          level = world.level[world.at(x, y)]!;
        }
      }
    }

    for (let y = c.y; y < c.y + def.footY; y++) {
      for (let x = c.x; x < c.x + def.footX; x++) {
        world.level[world.at(x, y)] = level ?? 0;
        world.terrain[world.at(x, y)] = Terrain.Island;`,
}, {
  file: 'rules/geysers.ts',
  why: 'tiered islands: a new islet floats on a level of its own',
  was: `    // (netstorm-3d) carriers bound for the spent geyser it replaces go to the new one in its place`,
  now: `    // (netstorm-3d) on tiered islands a new islet in the sky floats on a level of its own, by where
    // it is
    if (sky && world.tiered) {
      const level = ((Math.imul(at.x, 73856093) ^ Math.imul(at.y, 19349663)) >>> 0) % 3 - 1;

      for (let y = at.y - 1; y <= at.y + 1; y++) {
        for (let x = at.x - 1; x <= at.x + 1; x++) {
          if (world.inside(x, y)) {
            world.level[world.at(x, y)] = level;
          }
        }
      }
    }

    // (netstorm-3d) carriers bound for the spent geyser it replaces go to the new one in its place`,
}, {
  file: 'index.ts',
  why: 'tiered islands: the lift rules for the client and its check',
  was: `export { stepShare } from './rules/movement.js';`,
  now: `export { stepShare, LIFT_SECONDS } from './rules/movement.js';`,
}, {
  file: 'index.ts',
  why: 'tiered islands: the lift rules for the client and its check',
  was: `export { blastDamage, facesWhenLaid, shotInterval } from './rules/combat.js';`,
  now: `export { blastDamage, facesWhenLaid, shotInterval, damage, LIFT_EXPOSURE } from './rules/combat.js';`,
});

// Reach on tiered islands (netstorm-3d). A level is LEVEL_CELLS cells above the one below, as the
// client draws it. Flyers hunt in a sphere, not a circle: about the spot they hunt around, at the
// level of the ground they were launched from, as far up and down as across; so a Whirlibase's
// Whirligigs reach another level as far as their sphere does there. The Sun Disc Thrower throws
// level or upward, never down: what stands below it is out of its reach, what stands above in a
// half sphere of its range (a walker riding a lift up past it, say). Other guns reach as ever.
CHANGES.push({
  file: 'world.ts',
  why: 'tiered islands: heights for reach',
  was: `export class World {`,
  now: `/** (netstorm-3d) The height of a level above the one below, in cells, on tiered islands. */
export const LEVEL_CELLS = 8;

export class World {`,
}, {
  file: 'world.ts',
  why: 'tiered islands: heights for reach',
  was: `import { tickTransport, collect, pickupCrystal, unload } from './rules/movement.js';`,
  now: `import { tickTransport, collect, pickupCrystal, unload, stepShare } from './rules/movement.js';`,
}, {
  file: 'world.ts',
  why: 'tiered islands: heights for reach',
  was: `  /** (netstorm-3d) How many levels a walker's next step rides a lift by: 0 for none, on a level
   * map, or for what flies. */`,
  now: `  /** (netstorm-3d) The height of the ground or bridge of a cell, in cells; 0 on a level map. */
  groundHeight(x: number, y: number): number {
    return this.tiered && this.inside(x, y) ? this.level[y * W + x]! * LEVEL_CELLS : 0;
  }

  /** (netstorm-3d) How high an entity stands, in cells: on its ground, or a walker riding a lift
   * part of the way between the levels. 0 on a level map. */
  heightOf(e: Entity): number {
    if (!this.tiered || e.kind === 'flyer') {
      return 0;
    }

    const here = this.groundHeight(e.x, e.y);

    if ((e.kind === 'transport' || e.kind === 'priest') && this.liftLevels(e) > 0) {
      const next = e.path[0]!;
      return here + (this.groundHeight(next[0]!, next[1]!) - here) * stepShare(e, this);
    }

    return here;
  }

  /** (netstorm-3d) How many levels a walker's next step rides a lift by: 0 for none, on a level
   * map, or for what flies. */`,
}, {
  file: 'rules/flyers.ts',
  why: 'tiered islands: flyers hunt in a sphere',
  was: `  return distance(ground(f), middle(e)) <= reach(world, f);
}`,
  now: `  // (netstorm-3d) on tiered islands, in a sphere about the spot it hunts around, at the level it
  // was launched from
  const across = distance(ground(f), middle(e));

  if (!world.tiered) {
    return across <= reach(world, f);
  }

  const up = (world.heightOf(e) - world.groundHeight(Math.floor(f.hx / FLYER_SCALE), Math.floor(f.hy / FLYER_SCALE))) * FLYER_SCALE;
  return Math.sqrt(across * across + up * up) <= reach(world, f);
}`,
}, {
  file: 'rules/combat.ts',
  why: 'tiered islands: the Disc Thrower throws level or up',
  was: `function aimsAt(world: World, b: Building, target: Entity): boolean {`,
  now: `function aimsAt(world: World, b: Building, target: Entity): boolean {
  // (netstorm-3d) on tiered islands the Sun Disc Thrower throws level or upward, never down: what
  // stands below it is out of reach, what stands above it in a half sphere of its range
  if (b.type === DISC_THROWER && world.tiered && !airborne(world, target)) {
    const up = world.heightOf(target) - world.heightOf(b);

    if (up < -0.01) {
      return false;
    }

    if (up > 0.01) {
      const cx = b.x + (b.fx >> 1), cy = b.y + (b.fy >> 1);
      const across = Math.max(Math.abs(target.x - cx), Math.abs(target.y - cy));

      if (across * across + up * up > world.def(b.type).range ** 2) {
        return false;
      }
    }
  }
`,
}, {
  file: 'index.ts',
  why: 'tiered islands: bridge ends and heights for the client',
  was: `export { BRIDGE_SCAN } from './rules/bridges.js';`,
  now: `export { BRIDGE_SCAN, connectedToTemple } from './rules/bridges.js';`,
});

export function houseRules() {
  return {
    name: 'house-rules',
    setup(build) {
      const files = [...new Set(CHANGES.map((c) => c.file))];
      for (const file of files) {
        const filter = new RegExp(`packages[\\\\/]sim[\\\\/]src[\\\\/]${file.replace('/', '[\\\\/]').replace('.', '\\.')}$`);
        build.onLoad({ filter }, async (args) => {
          let src = await readFile(args.path, 'utf8');
          for (const change of CHANGES.filter((c) => c.file === file)) {
            if (src.split(change.was).length !== 2) {
              throw new Error(`scripts/house-rules.mjs: netstorm-web's code has changed where ${change.why}; check the change still holds, then update it`);
            }
            src = src.replace(change.was, change.now);
          }
          return { contents: src, loader: 'ts' };
        });
      }
    },
  };
}
