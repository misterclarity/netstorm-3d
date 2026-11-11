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

// Day and night (netstorm-3d; the player sets it). A day of DAY_SECONDS from the start of the
// battle, then a night of NIGHT_SECONDS, and so on; at night every gun reaches `nightShare` less
// (a quarter by default, rounded, never under a cell), and a Sacrifice waits for the sun: a Priest
// calls out to it, so his runes stop at nightfall and go on at dawn, the captive still chained.
// With `nights` off there is only day, as in the original.
CHANGES.push({
  file: 'world.ts',
  why: 'day and night',
  was: `import {
  W,
  H,
  PIECE_INTERVAL,`,
  now: `import {
  TPS,
  W,
  H,
  PIECE_INTERVAL,`,
}, {
  file: 'world.ts',
  why: 'day and night',
  was: `/** (netstorm-3d) The height of a level above the one below, in cells, on tiered islands. */`,
  now: `/** (netstorm-3d) The length of a day and of a night, in seconds of the battle. */
export const DAY_SECONDS = 240;
export const NIGHT_SECONDS = 120;

/** (netstorm-3d) The height of a level above the one below, in cells, on tiered islands. */`,
}, {
  file: 'world.ts',
  why: 'day and night',
  was: `  /** (netstorm-3d) Whether the islands stand on levels: a skirmish setting. */
  tiered = false;`,
  now: `  /** (netstorm-3d) Whether the islands stand on levels: a skirmish setting. */
  tiered = false;
  /** (netstorm-3d) Whether days and nights follow each other; a setting. */
  nights = false;
  /** (netstorm-3d) How much shorter a gun's reach is at night, 0 to 1; a setting. */
  nightShare = 0.25;`,
}, {
  file: 'world.ts',
  why: 'day and night',
  was: `  /** (netstorm-3d) The height of the ground or bridge of a cell, in cells; 0 on a level map. */`,
  now: `  /** (netstorm-3d) Whether it is night: after DAY_SECONDS of day, NIGHT_SECONDS of night, and so on. */
  isNight(): boolean {
    return this.nights && (this.tick / TPS) % (DAY_SECONDS + NIGHT_SECONDS) >= DAY_SECONDS;
  }

  /** (netstorm-3d) The height of the ground or bridge of a cell, in cells; 0 on a level map. */`,
}, {
  file: 'rules/combat.ts',
  why: 'day and night: guns reach less at night',
  was: `/** (netstorm-3d) The damage a walker riding a lift between levels takes, as a share of the hit. */`,
  now: `/** (netstorm-3d) A gun's reach now: at night \`nightShare\` less, rounded, never under a cell. */
function reachNow(world: World, range: number): number {
  return world.isNight() ? Math.max(1, Math.round(range * (1 - world.nightShare))) : range;
}

/** (netstorm-3d) The damage a walker riding a lift between levels takes, as a share of the hit. */`,
}, {
  file: 'rules/combat.ts',
  why: 'day and night: guns reach less at night',
  was: `  const range = airborne(world, target) ? def.airRange || def.range : def.range;`,
  now: `  const range = reachNow(world, airborne(world, target) ? def.airRange || def.range : def.range);`,
}, {
  file: 'rules/combat.ts',
  why: 'day and night: guns reach less at night',
  was: `  for (let r = 0; r < def.range && world.inside(x, y); r++, x += dx, y += dy) {`,
  now: `  for (let r = 0; r < reachNow(world, def.range) && world.inside(x, y); r++, x += dx, y += dy) {`,
}, {
  file: 'rules/combat.ts',
  why: 'day and night: guns reach less at night',
  was: `  for (let r = 1; r <= def.range; r++) {`,
  now: `  for (let r = 1; r <= reachNow(world, def.range); r++) {`,
}, {
  file: 'rules/combat.ts',
  why: 'day and night: guns reach less at night',
  was: `      if (across * across + up * up > world.def(b.type).range ** 2) {`,
  now: `      if (across * across + up * up > reachNow(world, world.def(b.type).range) ** 2) {`,
}, {
  file: 'rules/capture.ts',
  why: 'day and night: a Sacrifice waits for the sun',
  was: `  // The Sacrifice commences whenever the owner's priest is at the altar; away from it, it pauses.`,
  now: `  // (netstorm-3d) a Priest calls out to the sun: by night the Sacrifice waits for the dawn
  if (world.isNight()) {
    return;
  }

  // The Sacrifice commences whenever the owner's priest is at the altar; away from it, it pauses.`,
});

// The moon, the Furies and the weight of a hit (netstorm-3d). With days and nights (a setting) the
// nights have a moon: the first night a new moon, then a first quarter, a full moon, a third
// quarter, and a new moon again. At night a gun loses `nightShare` of its reach under a new moon,
// three quarters of that under a quarter moon and half under the full moon; the Sun's guns lose
// 0.6 `nightShare` more; Thunder's guns lose nothing, seeing by their own lightning, and nor does a
// gun in the Energy ring of its side's Temple or Generator, which lights it up; a Vander Tower's
// beam lights up an air unit for every gun of its side. A Sun Generator is dark at night and gives
// no Energy then. Rain is the moon's Fury (Cancer, the moon's own sign, is a water sign): its guns
// and flyers hit 1.1 times as hard under a quarter moon, 1.25 under the full moon and 0.9 under
// the new; the Sun's hit 1.15 times as hard by day. Whirligigs do not take off at night; a Priest
// heals half as fast again by day and prays a quarter slower at night, when Thunder's Spells come
// a third faster; a crystal brought home at night is worth a quarter more.
// And every hit weighs its target, days and nights or not: the Sun and Thunder Cannons are siege
// guns, 1.5 times as hard on buildings and half as hard on units; the Crossbow, the Disc Thrower
// and the Ice Cannon are light guns, 0.75 times as hard on buildings; a walker riding a lift counts
// as a building. On tiered islands a gun hits 0.2 harder for each level its target stands below it
// and 0.2 softer for each above (not at air units, nor the Disc Thrower's discs), and reaches 0.1
// farther for each level below. A Priest has a ward: no single hit of a gun or flyer takes more
// than PRIEST_WARD off him, so no shot knocks him out at once.
CHANGES.push({
  file: 'world.ts',
  why: 'the moon and the Furies',
  was: `export const NIGHT_SECONDS = 120;
`,
  now: `export const NIGHT_SECONDS = 120;
/** (netstorm-3d) The moon's phases, a night each from the first night on, then over again. */
export const MOON_PHASES = ['new moon', 'first quarter', 'full moon', 'third quarter'];
/** (netstorm-3d) How hard Rain's guns and flyers hit at night, by the moon's phase: Rain is the
 * moon's Fury, strongest under the full moon and a little weak under the new. */
export const RAIN_MOON = [0.9, 1.1, 1.25, 1.1];
/** (netstorm-3d) How hard the Sun's guns and flyers hit by day, when nights follow days. */
export const SUN_DAY = 1.15;
`,
}, {
  file: 'world.ts',
  why: 'the moon and the Furies',
  was: `  isNight(): boolean {
    return this.nights && (this.tick / TPS) % (DAY_SECONDS + NIGHT_SECONDS) >= DAY_SECONDS;
  }
`,
  now: `  isNight(): boolean {
    return this.nights && (this.tick / TPS) % (DAY_SECONDS + NIGHT_SECONDS) >= DAY_SECONDS;
  }

  /** (netstorm-3d) Tonight's moon, or by day the coming night's, as an index into MOON_PHASES. */
  moonPhase(): number {
    return Math.floor(this.tick / TPS / (DAY_SECONDS + NIGHT_SECONDS)) % MOON_PHASES.length;
  }

  /** (netstorm-3d) How hard the guns and flyers of a Fury hit now: Rain by the moon at night, the
   * Sun by day; 1 for the rest, and for all with nights off. */
  furyStrength(theme: string | null | undefined): number {
    if (!this.nights) {
      return 1;
    }

    if (theme === 'sun') {
      return this.isNight() ? 1 : SUN_DAY;
    }

    return theme === 'rain' && this.isNight() ? RAIN_MOON[this.moonPhase()]! : 1;
  }

  /** (netstorm-3d) How many levels \`a\` stands above \`b\`, negative below; 0 on a level map. */
  levelsAbove(a: Entity, b: Entity): number {
    return (this.heightOf(a) - this.heightOf(b)) / LEVEL_CELLS;
  }
`,
}, {
  file: 'rules/combat.ts',
  why: 'the moon and the Furies: reach by the moon, by light and by height',
  was: `/** (netstorm-3d) A gun's reach now: at night \`nightShare\` less, rounded, never under a cell. */
function reachNow(world: World, range: number): number {
  return world.isNight() ? Math.max(1, Math.round(range * (1 - world.nightShare))) : range;
}
`,
  now: `/* oxlint-disable no-magic-numbers -- netstorm-3d's house rules */
/** (netstorm-3d) How much of \`nightShare\` a gun loses at night by the moon, in the order of
 * MOON_PHASES: all of it under a new moon, three quarters under a quarter, half under the full. */
export const MOON_DARK = [1, 0.75, 0.5, 0.75];
/** (netstorm-3d) The Sun's guns are blinder at night: they lose this much more of \`nightShare\`. */
export const SUN_BLIND = 0.6;
/** (netstorm-3d) No gun loses more of its reach at night than this. */
const DARKEST = 0.9;
/** (netstorm-3d) How much farther a gun reaches for each level its target stands below it. */
export const HIGH_REACH = 0.1;
/** (netstorm-3d) How much harder a gun hits for each level its target stands below it, and how
 * much softer for each level above. */
export const HIGH_HIT = 0.2;
/** (netstorm-3d) The least share of a hit from far below. */
const LOW_HIT = 0.2;
/** (netstorm-3d) Siege guns: hard on buildings, soft on units. */
export const SIEGE_GUNS: ReadonlySet<string> = new Set([SUN_CANNON, THUNDER_CANNON_TYPE]);
export const SIEGE_VS_BUILDINGS = 1.5;
export const SIEGE_VS_UNITS = 0.5;
/** (netstorm-3d) Light guns: soft on buildings. */
export const LIGHT_GUNS: ReadonlySet<string> = new Set([CROSSBOW, DISC_THROWER, ICE_CANNON]);
export const LIGHT_VS_BUILDINGS = 0.75;
/** (netstorm-3d) A Priest's ward: the most a single hit of a gun or flyer takes off him. */
export const PRIEST_WARD = 35;
/* oxlint-enable no-magic-numbers */

/** (netstorm-3d) A gun to the rules of reach and hits: a building, or one about to be laid. */
type Gun = { kind: 'building'; type: string; owner: number; x: number; y: number; fx: number; fy: number; };

/** (netstorm-3d) Lights at night, worked out once a tick: the Energy ring of a Temple or Generator
 * (not a Sun Generator's), and the beam of a Vander Tower, as far as it reaches air units. */
type Light = { owner: number; x: number; y: number; r: number; };
const LIGHTS = new WeakMap<World, { tick: number; rings: Light[]; beams: Light[]; }>();

function lightsOf(world: World): { rings: Light[]; beams: Light[]; } {
  const known = LIGHTS.get(world);

  if (known?.tick === world.tick) {
    return known;
  }

  const lights = { tick: world.tick, rings: [] as Light[], beams: [] as Light[] };

  for (const e of world.entities.values()) {
    if (e.kind !== 'building' || !e.owner || e.rising > 0) {
      continue;
    }

    const def = world.def(e.type);

    if (def.cls === 'Energy' || (def.group === 'battery' && def.theme !== 'sun')) {
      lights.rings.push({ owner: e.owner, x: e.x + e.fx / 2, y: e.y + e.fy / 2, r: world.energyRange });
    }

    if (e.type === VANDER_TOWER) {
      lights.beams.push({
        owner: e.owner,
        x: e.x + (e.fx >> 1),
        y: e.y + (e.fy >> 1),
        r: def.airRange || def.range,
      });
    }
  }

  LIGHTS.set(world, lights);
  return lights;
}

/** (netstorm-3d) Whether a gun stands in a lit Energy ring of its side, as hasEnergy measures it. */
function lit(world: World, b: Gun): boolean {
  const x = b.x + b.fx / 2;
  const y = b.y + b.fy / 2;
  const foot = (b.fx * b.fx) / 2;
  return lightsOf(world).rings.some((l) =>
    !world.hostile(b.owner, l.owner) && (l.x - x) ** 2 + (l.y - y) ** 2 < l.r * l.r + foot
  );
}

/** (netstorm-3d) Whether an air unit is in the beam of a Vander Tower of a side. */
function spotted(world: World, owner: number, target: Entity): boolean {
  return lightsOf(world).beams.some((l) =>
    !world.hostile(owner, l.owner)
    && Math.max(Math.abs(target.x - l.x), Math.abs(target.y - l.y)) <= l.r
  );
}

/** (netstorm-3d) The share of its reach a gun loses now, at a target or (with none) at anything:
 * none by day; at night \`nightShare\` by the moon (MOON_DARK), and more for the Sun's guns; none
 * for Thunder's, nor in a lit Energy ring, nor at an air unit a Vander Tower of its side lights. */
export function nightCut(world: World, b: Gun, target?: Entity): number {
  if (!world.isNight()) {
    return 0;
  }

  const theme = world.def(b.type).theme;

  if (
    theme === 'thunder' || lit(world, b)
    || (target !== undefined && airborne(world, target) && spotted(world, b.owner, target))
  ) {
    return 0;
  }

  const blind = theme === 'sun' ? SUN_BLIND : 0;
  return Math.min(DARKEST, world.nightShare * (MOON_DARK[world.moonPhase()]! + blind));
}

/** (netstorm-3d) How far a gun of reach \`range\` reaches a target now, or (with none) anything on
 * its own level: less at night (nightCut), and on tiered islands HIGH_REACH farther for each
 * level a ground target stands below it. Rounded, never under a cell. */
export function gunReach(world: World, b: Gun, range: number, target?: Entity): number {
  let reach = range * (1 - nightCut(world, b, target));

  if (target !== undefined && world.tiered && !airborne(world, target)) {
    reach *= 1 + HIGH_REACH * Math.max(0, world.levelsAbove(b as Entity, target));
  }

  return reach === range ? range : Math.max(1, Math.round(reach));
}

/** (netstorm-3d) The farthest a gun of reach \`range\` might reach anything: how far it looks. */
function farthest(world: World, range: number): number {
  return world.tiered ? Math.round(range * (1 + HIGH_REACH * 2)) : range;
}

/** (netstorm-3d) What a gun's hit on a target is multiplied by, part by part: \`against\` the kind
 * of target (siege and light guns on buildings or units; a walker riding a lift counts as a
 * building), \`height\` the levels between them, \`fury\` the strength of the gun's Fury now. */
export function hitParts(
  world: World,
  gun: Gun,
  target: Entity,
): { against: number; height: number; fury: number; } {
  const block = target.kind === 'building'
    || ((target.kind === 'transport' || target.kind === 'priest') && world.liftLevels(target) > 0);
  let against = 1;

  if (SIEGE_GUNS.has(gun.type)) {
    against = block ? SIEGE_VS_BUILDINGS : SIEGE_VS_UNITS;
  } else if (LIGHT_GUNS.has(gun.type) && block) {
    against = LIGHT_VS_BUILDINGS;
  }

  const levels = world.tiered && gun.type !== DISC_THROWER && !airborne(world, target);
  const height = levels ? Math.max(LOW_HIT, 1 + HIGH_HIT * world.levelsAbove(gun as Entity, target)) : 1;
  return { against, height, fury: world.furyStrength(world.def(gun.type).theme) };
}

/** (netstorm-3d) What a gun's hit on a target is multiplied by: the product of hitParts. */
export function hitFactor(world: World, gun: Gun, target: Entity): number {
  const { against, height, fury } = hitParts(world, gun, target);
  return against * height * fury;
}
`,
}, {
  file: 'rules/combat.ts',
  why: 'the moon and the Furies: a hit weighs its target',
  was: `  damage(world, by, target, amount, shot.ricochet ? undefined : gun);`,
  now: `  damage(world, by, target, amount * hitFactor(world, gun, target), shot.ricochet ? undefined : gun);`,
}, {
  file: 'rules/combat.ts',
  why: 'the moon and the Furies: a Priest has a ward',
  was: `    amount *= LIFT_EXPOSURE;
  }

  const before = entity.hp;`,
  now: `    amount *= LIFT_EXPOSURE;
  }

  // (netstorm-3d) a Priest's ward: no single hit of a gun or flyer takes more than PRIEST_WARD
  if (entity.kind === 'priest' && (from !== undefined || air)) {
    amount = Math.min(amount, PRIEST_WARD);
  }

  const before = entity.hp;`,
}, {
  file: 'rules/combat.ts',
  why: 'the moon and the Furies: reach by the moon, by light and by height',
  was: `      if (across * across + up * up > reachNow(world, world.def(b.type).range) ** 2) {`,
  now: `      if (across * across + up * up > gunReach(world, b, world.def(b.type).range, target) ** 2) {`,
}, {
  file: 'rules/combat.ts',
  why: 'the moon and the Furies: reach by the moon, by light and by height',
  was: `  const range = reachNow(world, airborne(world, target) ? def.airRange || def.range : def.range);`,
  now: `  const range = gunReach(world, b, airborne(world, target) ? def.airRange || def.range : def.range, target);`,
}, {
  file: 'rules/combat.ts',
  why: 'the moon and the Furies: reach by the moon, by light and by height',
  was: `  for (let r = 0; r < reachNow(world, def.range) && world.inside(x, y); r++, x += dx, y += dy) {
    const hit = enemyAt(b.owner, x, y);

    if (hit) {`,
  now: `  for (let r = 0; r < farthest(world, def.range) && world.inside(x, y); r++, x += dx, y += dy) {
    const hit = enemyAt(b.owner, x, y);

    // (netstorm-3d) each enemy within the gun's reach of it: farther below, less far at night
    if (hit && r < gunReach(world, b, def.range, hit)) {`,
}, {
  file: 'rules/combat.ts',
  why: 'the moon and the Furies: reach by the moon, by light and by height',
  was: `  const seen: EnemyAt = (owner, x, y) => {
    const hit = enemyAt(owner, x, y);
    return hit && aimsAt(world, b, hit) ? hit : null;
  };

  for (let r = 1; r <= reachNow(world, def.range); r++) {`,
  now: `  // (netstorm-3d) each enemy within the gun's reach of it: farther below, less far at night
  let ring = 0;
  const seen: EnemyAt = (owner, x, y) => {
    const hit = enemyAt(owner, x, y);
    return hit && aimsAt(world, b, hit) && ring <= gunReach(world, b, def.range, hit) ? hit : null;
  };

  for (let r = 1; r <= farthest(world, def.range); r++) {
    ring = r;`,
}, {
  file: 'rules/flyers.ts',
  why: 'the moon and the Furies: flyers hit by their Fury',
  was: `  damage(world, f.owner, target, def.dps * seconds, undefined, true);`,
  now: `  damage(world, f.owner, target, def.dps * seconds * world.furyStrength(def.theme), undefined, true);`,
}, {
  file: 'rules/flyers.ts',
  why: 'the moon and the Furies: Whirligigs do not take off at night',
  was: `  if (b.cooldown >= Math.round(LAUNCH_SECONDS[b.type]! * TPS)) {`,
  now: `  // (netstorm-3d) Whirligigs do not take off at night: they go at dawn
  if (b.cooldown >= Math.round(LAUNCH_SECONDS[b.type]! * TPS) && !(b.type === 'sunaviary' && world.isNight())) {`,
}, {
  file: 'rules/building.ts',
  why: 'the moon and the Furies: a Sun Generator is dark at night',
  was: `    if (count && source.theme && dx * dx + dy * dy < reach) {`,
  now: `    // (netstorm-3d) a Sun Generator gives no Energy at night
    const dark = source.group === 'battery' && source.theme === 'sun' && world.isNight?.();

    if (count && source.theme && !dark && dx * dx + dy * dy < reach) {`,
}, {
  file: 'rules/building.ts',
  why: 'the moon and the Furies: a Sun Generator is dark at night',
  was: `    } else if (d.group === 'battery') {`,
  now: `    } else if (d.group === 'battery' && !(d.theme === 'sun' && world.isNight?.())) {`,
}, {
  file: 'rules/priest.ts',
  why: 'the moon and the Furies: a Priest heals faster by day',
  was: `const FULL_HEAL_SECONDS = 50;
`,
  now: `const FULL_HEAL_SECONDS = 50;
/** (netstorm-3d) How much faster a Priest heals by day, when nights follow days. */
const DAY_HEAL = 1.5;
`,
}, {
  file: 'rules/priest.ts',
  why: 'the moon and the Furies: a Priest heals faster by day',
  was: `  const interval = Math.round(((part * FULL_HEAL_SECONDS) / p.hpMax) * TPS);`,
  now: `  const sun = world.nights && !world.isNight() ? DAY_HEAL : 1;
  const interval = Math.round(((part * FULL_HEAL_SECONDS) / p.hpMax / sun) * TPS);`,
}, {
  file: 'rules/spells.ts',
  why: 'the moon and the Furies: prayers at night',
  was: `  p.praying--;

  if (p.praying === 0) {`,
  now: `  // (netstorm-3d) a Priest prays a quarter slower at night: he loses every fourth tick
  if (!world.isNight() || world.tick % NIGHT_PRAYER !== 0) {
    p.praying--;
  }

  if (p.praying === 0) {`,
}, {
  file: 'rules/spells.ts',
  why: 'the moon and the Furies: Thunder\'s Spells at night',
  was: `export function cast(world: World, t: Caster): void {
  t.casting--;`,
  now: `/** (netstorm-3d) At night a Priest loses every NIGHT_PRAYER-th tick of his prayer, and a Thunder
 * Spell gains a tick on every THUNDER_NIGHT-th. */
const NIGHT_PRAYER = 4;
const THUNDER_NIGHT = 3;
const THUNDER_SPELLS: ReadonlySet<string> = new Set(['bomblightingwave', 'bomblightingzap']);

export function cast(world: World, t: Caster): void {
  // (netstorm-3d) Thunder's Spells come a third faster at night
  const storm = world.isNight() && t.casting > 1 && world.tick % THUNDER_NIGHT === 0
    && THUNDER_SPELLS.has(t.spell ?? '');
  t.casting -= storm ? 2 : 1;`,
}, {
  file: 'rules/movement.ts',
  why: 'the moon and the Furies: crystals at night',
  was: `  world.players.get(t.owner)!.storm += crystal.value;`,
  now: `  // (netstorm-3d) a crystal brought home at night is worth a quarter more
  world.players.get(t.owner)!.storm += world.isNight() ? Math.round(crystal.value * 1.25) : crystal.value;`,
}, {
  file: 'index.ts',
  why: 'the moon and the Furies: reach and hits for the client',
  was: `export { blastDamage, facesWhenLaid, shotInterval, damage, LIFT_EXPOSURE } from './rules/combat.js';`,
  now: `export {
  blastDamage,
  facesWhenLaid,
  shotInterval,
  damage,
  LIFT_EXPOSURE,
  gunReach,
  nightCut,
  hitParts,
  hitFactor,
  PRIEST_WARD,
  MOON_DARK,
  SUN_BLIND,
  HIGH_REACH,
  HIGH_HIT,
  SIEGE_GUNS,
  SIEGE_VS_BUILDINGS,
  SIEGE_VS_UNITS,
  LIGHT_GUNS,
  LIGHT_VS_BUILDINGS,
} from './rules/combat.js';`,
});

// The house rules' state in the computer's copy of the world (netstorm-3d). The computer works out
// its moves on a copy made from the world's hand-off (in its worker, and in the arena), which
// netstorm-web's snapshot makes without the levels of tiered islands and without days and nights:
// the copy took every cell to be on level 0 and every hour for day, so at night it would try to lay
// what only a dark Sun Generator could give Energy for, and be refused. Now the hand-off carries
// them, and the copy takes them.
CHANGES.push({
  file: 'world.ts',
  why: 'the house rules in the computer\'s copy of the world',
  was: `      residences: this.residences,
      players: [...this.players.values()].map((player) => ({ ...player, tech: [...player.tech] })),
    };
  }

  private header() {`,
  now: `      residences: this.residences,
      players: [...this.players.values()].map((player) => ({ ...player, tech: [...player.tech] })),
      // (netstorm-3d) the house rules' state
      houseRules: {
        tiered: this.tiered,
        level: this.level.slice(),
        nights: this.nights,
        nightShare: this.nightShare,
      },
    };
  }

  private header() {`,
}, {
  file: 'world.ts',
  why: 'the house rules in the computer\'s copy of the world',
  was: `    world.occupant.set(snapshot.occupant);`,
  now: `    world.occupant.set(snapshot.occupant);
    // (netstorm-3d) the house rules' state, as a hand-off carries it
    const rules = (raw as { houseRules?: { tiered?: unknown; level?: ArrayLike<number>; nights?: unknown; nightShare?: unknown; }; }).houseRules;

    if (rules) {
      world.tiered = rules.tiered === true;
      world.nights = rules.nights === true;
      world.nightShare = Math.min(1, Math.max(0, Number(rules.nightShare) || 0));

      if (rules.level?.length === W * H) {
        world.level.set(Array.from(rules.level, (n) => Math.max(-1, Math.min(1, Math.trunc(n)))));
      }
    }`,
}, {
  file: 'snapshot.ts',
  why: 'the house rules in the computer\'s copy of the world',
  was: `    'players',
  ], 'snapshot');`,
  now: `    'players',
    'houseRules',
  ], 'snapshot');`,
});

// Walking by hand, cover, and lifts that stand as buildings (netstorm-3d).
//
// Walking by hand: a Priest taken over in first person (src/systems/ns-fp.js) is walked by
// `steerPriest` orders: a way to go, in hundredths of his pace along the map's two axes, from
// `lead` hundredths of the coming tick on (the moment the keys changed, so that the world's step
// and the view's foresight of it agree to the hair). He stands anywhere in his cell, in 1/WALK_SUB
// of a cell (`walking`), walks the way he is steered at his pace, slides along what he cannot step
// onto (as the pathfinder steps: walkable ground, joined bridge, no geyser, Obelisk or other
// Priest; and in first person, no tree and no Residence's house), and stops where he is the moment
// the keys are let go. A step onto another level is a ride on the lift, as ever. An order from
// above walks him by the grid again. Walking breaks his prayer off; he does not walk while he
// casts; a crystal he holds is banked as he passes beside his Temple.
//
// Cover: a shot at a unit on the ground is taken by what stands between it and the gun within
// COVER cells of the unit (a building of anyone, a tree, a Residence's house): a building of the
// gun's enemy takes the hit, anything else stops it. Guns do not aim at a unit in cover. A gun a
// level or more above the unit fires down over it, and flyers and Spells strike from above. The
// trees are the rules' own now: `treeGrows` is where src/components/ns-decor.js draws them, and
// `treeAt` leaves out those it clears around buildings, geysers, Obelisks and Residences.
//
// Lifts: each lift (a join of two levels) has LIFT_HP and takes every hit on those riding it,
// which take none, as the hits on a building's crew would; spent, it bursts, and the bridge it
// hangs from falls: carriers in its car fall with it (a captive set down on the ground it stood by,
// still knocked out), a Priest is thrown onto that ground knocked out. Nobody stays in a lift: a
// ride always ends on a cell, an order to stop sets the rider back where he got on, and fire on
// the riders wears the lift down to its fall, so the car is cover for a crossing under fire and no
// more. A lift's wear goes with the bridge, and a new one hangs whole.
CHANGES.push({
  file: 'world.ts',
  why: 'walking by hand, cover and lifts',
  was: `  /** (netstorm-3d) How much shorter a gun's reach is at night, 0 to 1; a setting. */`,
  now: `  /** (netstorm-3d) Priests walked by hand (first person), by id: where they stand in 1/WALK_SUB of a
   * cell, the way they are steered (hundredths of their pace), an order of this tick, a lift ride. */
  walking = new Map<number, { x: number; y: number; vx: number; vy: number; next: { vx: number; vy: number; lead: number; } | null; ride: boolean; }>();
  /** (netstorm-3d) The hit points left to the lifts that have been hit, by the key of the cells they join. */
  lifts = new Map<string, number>();
  /** (netstorm-3d) How much shorter a gun's reach is at night, 0 to 1; a setting. */`,
}, {
  file: 'world.ts',
  why: 'walking by hand, cover and lifts',
  was: `  /** Whether (x, y) lies under a Residence, where nothing can be built. */`,
  now: `  /** (netstorm-3d) Whether a tree grows on cell (x, y): island ground, the more often near its rim
   * (src/components/ns-decor.js draws them where this says). */
  treeGrows(x: number, y: number): boolean {
    const island = (cx: number, cy: number) => this.inside(cx, cy) && this.terrain[this.at(cx, cy)] === Terrain.Island;

    if (!island(x, y)) {
      return false;
    }

    let rim = 0;

    for (const [dx, dy] of TREE_RIM) {
      if (!island(x + dx!, y + dy!)) {
        rim++;
      }
    }

    return cellHash(x, y, 1) < TREE_ODDS + Math.min(rim, 3) * TREE_RIM_ODDS;
  }

  /** (netstorm-3d) Whether a tree stands on cell (x, y): one that grows there and is not cleared
   * away, as ns-decor.js clears them: a cell round a building, three round a Temple, two round a
   * geyser, one round an Obelisk, a Residence's ground. */
  treeAt(x: number, y: number): boolean {
    if (!this.treeGrows(x, y) || this.residenceAt(x, y)) {
      return false;
    }

    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (!this.inside(x + dx, y + dy)) {
          continue;
        }

        const e = this.entities.get(this.occupant[this.at(x + dx, y + dy)] ?? 0);
        const far = Math.max(Math.abs(dx), Math.abs(dy));

        if (
          (e?.kind === 'building' && far <= (this.def(e.type).cls === 'Energy' ? 3 : 1))
          || (e?.kind === 'geyser' && far <= 2) || (e?.kind === 'obelisk' && far <= 1)
        ) {
          return false;
        }
      }
    }

    return true;
  }

  /** (netstorm-3d) Whether a Residence's house stands on cell (x, y): the middle of its ground. */
  houseAt(x: number, y: number): boolean {
    return this.residences.some(([rx, ry]) => x > rx && x < rx + RESIDENCE_FOOT - 1 && y > ry && y < ry + RESIDENCE_FOOT - 1);
  }

  /** (netstorm-3d) Where an entity stands, in cells: a Priest walked by hand anywhere in his cell,
   * anything else in the middle of its cell or footprint. */
  spotOf(e: Entity): [number, number] {
    const s = this.walking.get(e.id);

    // (where he was walked by hand, while he is still in that cell: he may have been carried off)
    if (s && !s.ride && Math.floor(s.x / WALK_SUB) === e.x && Math.floor(s.y / WALK_SUB) === e.y) {
      return [s.x / WALK_SUB, s.y / WALK_SUB];
    }

    return e.kind === 'building' ? [e.x + e.fx / 2, e.y + e.fy / 2] : [e.x + 0.5, e.y + 0.5];
  }

  /** Whether (x, y) lies under a Residence, where nothing can be built. */`,
}, {
  file: 'world.ts',
  why: 'walking by hand, cover and lifts',
  was: `/** (netstorm-3d) The height of a level above the one below, in cells, on tiered islands. */`,
  now: `/** (netstorm-3d) The trees' odds on a cell of island ground, and how much more for each cell of
 * the rim near it (src/components/ns-decor.js). */
const TREE_ODDS = 0.03;
const TREE_RIM_ODDS = 0.035;
const TREE_RIM: ReadonlyArray<readonly [number, number]> = [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1], [1, -1], [-1, 1]];

/** (netstorm-3d) A number 0 to 1 fixed by a cell and a salt: src/state.js's hash, for the trees. */
export function cellHash(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** (netstorm-3d) The height of a level above the one below, in cells, on tiered islands. */`,
}, {
  file: 'world.ts',
  why: 'walking by hand, cover and lifts',
  was: `import { tickPriest, movePriest } from './rules/priest.js';`,
  now: `import { tickPriest, movePriest, steerPriest, WALK_SUB } from './rules/priest.js';`,
}, {
  file: 'world.ts',
  why: 'walking by hand, cover and lifts',
  was: `      case 'moveTransport':
        return moveTransportTo(this, c);`,
  now: `      case 'moveTransport':
        return moveTransportTo(this, c);
      case 'steerPriest':
        return steerPriest(this, c);`,
}, {
  file: 'rules/priest.ts',
  why: 'walking by hand',
  was: `import { TPS, Terrain, type Priest } from '../state.js';`,
  now: `import { TPS, Terrain, DIRS, type Priest } from '../state.js';`,
}, {
  file: 'rules/priest.ts',
  why: 'walking by hand',
  was: `import { tickPrayer } from './spells.js';`,
  now: `import { tickPrayer, breakPrayer } from './spells.js';`,
}, {
  file: 'rules/priest.ts',
  why: 'walking by hand',
  was: `  if (tickPrayer(world, p)) {
    return;
  }

  advance(world, p, PRIEST_SPEED);`,
  now: `  // (netstorm-3d) walked by hand, in first person
  if (walkByHand(world, p)) {
    return;
  }

  if (tickPrayer(world, p)) {
    return;
  }

  // (netstorm-3d) hovering, he goes faster by the grid too
  advance(world, p, PRIEST_SPEED * (p.path.length ? hoverPace(world, p) : 1));`,
}, {
  file: 'rules/priest.ts',
  why: 'walking by hand',
  was: `export function movePriest(`,
  now: `/** (netstorm-3d) A Priest walked by hand stands to 1/WALK_SUB of a cell. */
export const WALK_SUB = 1024;
/** (netstorm-3d) How far a Priest walked by hand keeps from what he cannot step onto. */
const WALK_RADIUS = Math.round(WALK_SUB * 0.26);
const WALK_STEP = (PRIEST_SPEED * WALK_SUB) / TPS;

/** (netstorm-3d) Steer the player's Priest by hand: see scripts/house-rules.mjs. */
export function steerPriest(
  world: World,
  c: { player: number; vx: number; vy: number; lead?: number; },
): CommandError | null {
  const p = world.priestOf(c.player);

  if (!p || !Number.isFinite(c.vx) || !Number.isFinite(c.vy)) {
    return 'priest unavailable';
  }

  let vx = Math.round(Math.max(-100, Math.min(100, c.vx)));
  let vy = Math.round(Math.max(-100, Math.min(100, c.vy)));
  const len = Math.hypot(vx, vy);

  if (len > 100) {
    vx = Math.round((vx * 100) / len);
    vy = Math.round((vy * 100) / len);
  }

  let s = world.walking.get(p.id);

  if (!s) {
    if (!vx && !vy) {
      return null;
    }

    s = { x: p.x * WALK_SUB + WALK_SUB / 2, y: p.y * WALK_SUB + WALK_SUB / 2, vx: 0, vy: 0, next: null, ride: false };
    world.walking.set(p.id, s);
  }

  // the tick's first order sets when it begins; a later one in the same tick only the way
  const lead = Math.round(Math.max(0, Math.min(100, Number(c.lead) || 0)));
  s.next = { vx, vy, lead: s.next ? s.next.lead : lead };
  return null;
}

/** (netstorm-3d) Whether a Priest walked by hand may step from his cell (x, y) the way \`dir\`: false;
 * true; or 'ride' for a step onto another level, which the lift takes. */
function walkOpen(world: World, p: Priest, x: number, y: number, dir: number): boolean | 'ride' {
  const [dx, dy] = DIRS[dir]!;
  const nx = x + dx, ny = y + dy;

  if (
    !world.walkable(p.owner, nx, ny) || !world.joined(x, y, dir) || world.takenBy(nx, ny)
    || world.treeAt(nx, ny) || world.houseAt(nx, ny)
  ) {
    return false;
  }

  return world.tiered && world.level[world.at(nx, ny)] !== world.level[world.at(x, y)] ? 'ride' : true;
}

/** (netstorm-3d) Where a Priest walked by hand at (x, y) (in 1/WALK_SUB of a cell) is after
 * \`share\` of a tick walking the way (vx, vy): along x, then along y, up to the edge of his cell
 * where the next cannot be stepped onto, sliding along it; \`ride\` is a cell of another level his
 * walk reaches, where he stops for the lift. For the view's foresight too (src/systems/ns-fp.js). */
export function walkStep(
  world: World,
  p: Priest,
  x: number,
  y: number,
  vx: number,
  vy: number,
  share = 1,
): { x: number; y: number; ride: [number, number] | null; } {
  let ride: [number, number] | null = null;

  for (const axis of [0, 1]) {
    const d = ((axis ? vy : vx) / 100) * WALK_STEP * share;

    if (!d || ride) {
      continue;
    }

    const cx = Math.floor(x / WALK_SUB), cy = Math.floor(y / WALK_SUB), c = axis ? cy : cx;
    const dir = axis ? (d > 0 ? 2 : 0) : (d > 0 ? 1 : 3);
    const open = walkOpen(world, p, cx, cy, dir);
    let v = (axis ? y : x) + d;

    if (!open) {
      v = d > 0 ? Math.min(v, Math.max((axis ? y : x), (c + 1) * WALK_SUB - WALK_RADIUS)) : Math.max(v, Math.min((axis ? y : x), c * WALK_SUB + WALK_RADIUS));
    } else if (open === 'ride' && (d > 0 ? v >= (c + 1) * WALK_SUB : v < c * WALK_SUB)) {
      v = d > 0 ? (c + 1) * WALK_SUB - 1 : c * WALK_SUB;
      ride = axis ? [cx, cy + Math.sign(d)] : [cx + Math.sign(d), cy];
    }

    if (axis) {
      y = v;
    } else {
      x = v;
    }
  }

  return { x, y, ride };
}

/** (netstorm-3d) A tick of a Priest walked by hand; true while it keeps him from the rest of his tick. */
function walkByHand(world: World, p: Priest): boolean {
  const s = world.walking.get(p.id);

  if (!s) {
    return false;
  }

  if (s.ride) {
    if (p.path.length) {
      return false; // the lift takes him by the grid's step
    }

    // off the lift: on from the middle of the cell it set him down on
    s.ride = false;
    s.x = p.x * WALK_SUB + WALK_SUB / 2;
    s.y = p.y * WALK_SUB + WALK_SUB / 2;
  } else if (p.path.length && !s.next) {
    world.walking.delete(p.id); // an order from above walks him by the grid again
    return false;
  }

  // carried off, thrown down or set down elsewhere since: on from the middle of the cell he is in
  if (Math.floor(s.x / WALK_SUB) !== p.x || Math.floor(s.y / WALK_SUB) !== p.y) {
    s.x = p.x * WALK_SUB + WALK_SUB / 2;
    s.y = p.y * WALK_SUB + WALK_SUB / 2;
  }

  const next = s.next;
  s.next = null;
  const walks = (vx: number, vy: number) => vx !== 0 || vy !== 0;

  if (!walks(s.vx, s.vy) && !(next && walks(next.vx, next.vy))) {
    if (next) {
      s.vx = next.vx;
      s.vy = next.vy;
    }

    return false;
  }

  // he stands still to cast; walking breaks a prayer off and ends an errand
  if (p.casting > 0) {
    if (next) {
      s.vx = next.vx;
      s.vy = next.vy;
    }

    return false;
  }

  if (p.praying > 0 || p.prayer) {
    breakPrayer(p);
  }

  p.path = [];
  p.move = 0;
  p.goal = p.carrying === null ? 'idle' : 'home';
  p.target = null;
  const lead = next ? next.lead / 100 : 1;
  const pace = hoverPace(world, p);
  let at = walkStep(world, p, s.x, s.y, s.vx, s.vy, lead * pace);

  if (next) {
    s.vx = next.vx;
    s.vy = next.vy;

    if (!at.ride && lead < 1) {
      at = walkStep(world, p, at.x, at.y, s.vx, s.vy, (1 - lead) * pace);
    }
  }

  s.x = Math.round(at.x);
  s.y = Math.round(at.y);
  p.x = Math.floor(s.x / WALK_SUB);
  p.y = Math.floor(s.y / WALK_SUB);

  if (at.ride) {
    p.path = [at.ride];
    s.ride = true;
  }

  // a crystal he holds is banked as he passes beside his Temple (or an Outpost)
  if (p.carrying !== null && !s.ride && world.depotsOf(p.owner).some((d) => world.adjacentTo(p.x, p.y, d))) {
    arrive(world, p);
  }

  return true;
}

export function movePriest(`,
}, {
  file: 'index.ts',
  why: 'walking by hand, cover and lifts',
  was: `export { stepShare, LIFT_SECONDS } from './rules/movement.js';`,
  now: `export { stepShare, LIFT_SECONDS } from './rules/movement.js';
export { walkStep, WALK_SUB } from './rules/priest.js';`,
}, {
  file: 'rules/combat.ts',
  why: 'cover and lifts',
  was: `import { shakeBridges } from './bridges.js';`,
  now: `import { shakeBridges, collapse } from './bridges.js';
import { WALK_SUB } from './priest.js';`,
}, {
  file: 'rules/combat.ts',
  why: 'lifts stand as buildings',
  was: `/** (netstorm-3d) The damage a walker riding a lift between levels takes, as a share of the hit. */
export const LIFT_EXPOSURE = 1.5;`,
  now: `/** (netstorm-3d) A lift's hit points: every hit on those riding it is its own. */
export const LIFT_HP = 400;

/** (netstorm-3d) The key of the lift between cells i and j (src/heights.js's liftKey). */
export function liftKey(i: number, j: number): string {
  return i < j ? \`\${i}:\${j}\` : \`\${j}:\${i}\`;
}

/** (netstorm-3d) A hit on a walker riding a lift: the lift takes it, and bursts when it is spent. */
function hitLift(world: World, by: number, rider: Entity & { path: readonly (readonly number[])[]; }, amount: number): void {
  const [nx, ny] = rider.path[0]!;
  const key = liftKey(world.at(rider.x, rider.y), world.at(nx!, ny!));
  const left = +((world.lifts.get(key) ?? LIFT_HP) - amount).toFixed(HP_DECIMALS);

  if (left > 0) {
    world.lifts.set(key, left);
    return;
  }

  breakLift(world, by, rider.x, rider.y, nx!, ny!);
}

/** (netstorm-3d) The lift between cells (ax, ay) and (bx, by) bursts: the bridge it hangs from falls
 * with the carriers in its car; a Priest in it is thrown onto the ground it joins, knocked out. */
export function breakLift(world: World, by: number, ax: number, ay: number, bx: number, bY: number): void {
  const i = world.at(ax, ay), j = world.at(bx, bY);
  world.lifts.delete(liftKey(i, j));
  // the cell that falls: the bridge of the two (of two bridges, the one on the higher level)
  const bridge = (k: number) => world.terrain[k] !== Terrain.Island;
  const falls = bridge(i) && (!bridge(j) || world.level[i]! >= world.level[j]!) ? i : j;
  const stays = falls === i ? j : i;
  const sx = stays % W, sy = (stays / W) | 0;

  for (const e of world.entities.values()) {
    if ((e.kind !== 'transport' && e.kind !== 'priest') || !e.path.length) {
      continue;
    }

    const ei = world.at(e.x, e.y), ej = world.at(e.path[0]![0]!, e.path[0]![1]!);

    if (!((ei === i && ej === j) || (ei === j && ej === i))) {
      continue;
    }

    if (e.kind === 'transport') {
      if (flies(world.def(e.type))) {
        continue;
      }

      const captive = e.carrying === null ? undefined : world.entities.get(e.carrying);

      if (captive?.kind === 'priest') {
        e.carrying = null;
        captive.carriedBy = null;
        captive.state = 'down';
        captive.path = [];
        captive.move = 0;
        captive.x = sx;
        captive.y = sy;
      }

      e.hp = 0;
    } else if (e.state === 'normal') {
      e.x = sx;
      e.y = sy;
      e.path = [];
      e.move = 0;
      e.hp = Math.min(e.hp, e.hpMax / 2 - 1);
      const s = world.walking.get(e.id);

      if (s) {
        s.ride = false;
        s.x = sx * WALK_SUB + WALK_SUB / 2;
        s.y = sy * WALK_SUB + WALK_SUB / 2;
      }
    }
  }

  world.emit({ what: 'lift destroyed', who: world.owner[falls]!, data: { x: ax, y: ay, nx: bx, ny: bY, by } });
  collapse(world, falls % W, (falls / W) | 0);
}

/** (netstorm-3d) Cover: of a ground unit, how far back toward the gun it is looked for. */
export const COVER = 3;

/** (netstorm-3d) What stands between a gun and a ground unit within COVER cells of the unit and
 * takes its shots: { x, y, building } (a building of anyone), or { x, y } (a tree or a Residence's
 * house); null when the unit stands in the open, or the gun is a level or more above it. */
export function coverFor(
  world: World,
  gun: Gun,
  target: Entity,
): { x: number; y: number; building: Building | null; } | null {
  if (
    (target.kind !== 'transport' && target.kind !== 'priest') || airborne(world, target)
    || world.liftLevels(target) > 0
    || (world.tiered && world.levelsAbove(gun as Entity, target) >= 1)
  ) {
    return null;
  }

  const gx = gun.x + gun.fx / 2, gy = gun.y + gun.fy / 2;
  const [tx, ty] = world.spotOf(target);
  const far = Math.hypot(gx - tx, gy - ty);

  if (far < 1) {
    return null;
  }

  const ux = (gx - tx) / far, uy = (gy - ty) / far;

  for (let d = 0.35; d <= Math.min(COVER, far); d += 0.25) {
    const cx = Math.floor(tx + ux * d), cy = Math.floor(ty + uy * d);

    if ((cx === target.x && cy === target.y) || !world.inside(cx, cy)) {
      continue;
    }

    if (cx >= gun.x && cx < gun.x + gun.fx && cy >= gun.y && cy < gun.y + gun.fy) {
      return null; // the gun itself, at the unit's side
    }

    const occ = world.entities.get(world.occupant[world.at(cx, cy)] ?? 0);

    if (occ?.kind === 'building') {
      return { x: cx, y: cy, building: occ };
    }

    if (world.treeAt(cx, cy) || world.houseAt(cx, cy)) {
      return { x: cx, y: cy, building: null };
    }
  }

  return null;
}`,
}, {
  file: 'rules/combat.ts',
  why: 'lifts stand as buildings',
  was: `  // (netstorm-3d) a walker riding a lift between levels hangs in the open
  if (amount > 0 && (entity.kind === 'transport' || entity.kind === 'priest') && world.liftLevels(entity) > 0) {
    amount *= LIFT_EXPOSURE;
  }`,
  now: `  // (netstorm-3d) a walker riding a lift is in its car: the lift takes the hit, as a building would
  if ((entity.kind === 'transport' || entity.kind === 'priest') && world.liftLevels(entity) > 0) {
    if (amount > 0) {
      hitLift(world, by, entity, amount);
    }

    return;
  }`,
}, {
  file: 'rules/combat.ts',
  why: 'cover',
  was: `  // A ricochet pays only for an enemy, and comes from the side, past the Wind Tower's back.
  const by = shot.ricochet && !world.hostile(gun.owner, target.owner) ? 0 : gun.owner;`,
  now: `  // (netstorm-3d) cover takes the shot: a building of the gun's enemy is hit instead, anything
  // else stops it
  const cover = shot.ricochet ? null : coverFor(world, gun, target);

  if (cover) {
    const b = cover.building;

    if (b && world.hostile(gun.owner, b.owner) && b.hp > 0) {
      damage(world, gun.owner, b, amount * hitFactor(world, gun, b), gun);
    }

    return;
  }

  // A ricochet pays only for an enemy, and comes from the side, past the Wind Tower's back.
  const by = shot.ricochet && !world.hostile(gun.owner, target.owner) ? 0 : gun.owner;`,
}, {
  file: 'rules/combat.ts',
  why: 'cover',
  was: `function aimsAt(world: World, b: Building, target: Entity): boolean {`,
  now: `function aimsAt(world: World, b: Building, target: Entity): boolean {
  // (netstorm-3d) no gun aims at a unit in cover
  if (coverFor(world, b, target)) {
    return false;
  }
`,
}, {
  file: 'rules/combat.ts',
  why: 'cover',
  was: `    if (hit && r < gunReach(world, b, def.range, hit)) {`,
  now: `    if (hit && r < gunReach(world, b, def.range, hit) && !coverFor(world, b, hit)) {`,
}, {
  file: 'rules/bridges.ts',
  why: "lifts stand as buildings: a lift's wear goes with its bridge",
  was: `  world.links[i] = 0;
  world.wear[i] = 0;

  for (const e of world.entities.values()) {`,
  now: `  world.links[i] = 0;
  world.wear[i] = 0;

  // (netstorm-3d) a lift it bore goes with it; one hung there again is whole
  for (const key of [...world.lifts.keys()]) {
    if (key.split(':').includes(String(i))) {
      world.lifts.delete(key);
    }
  }

  for (const e of world.entities.values()) {`,
}, {
  file: 'index.ts',
  why: 'walking by hand, cover and lifts',
  was: `  LIFT_EXPOSURE,
  gunReach,`,
  now: `  LIFT_HP,
  liftKey,
  coverFor,
  COVER,
  gunReach,`,
});

// Dungeons (netstorm-3d). A skirmish's starting island has a dungeon under it (`digDungeon`, laid
// out from the map's seed): stairs on the island's surface, a 2×2 stone portal nothing is built
// on, lead down to rooms of rock joined by passages, each room of its own kind (an entry hall, a
// crystal cave, a pillared hall, a pool, a grotto, a shrine, an ember cave) for the view to dress,
// with chests in some: one holds a Spell, the rest are empty for now. Islands of their own with
// harder dungeons, entered from the side or the layer below, will come; `side` says from where.
//
// A Priest beside the portal goes down (`enterDungeon`) and is walked by hand below as on the
// surface (steerPriest), in the dungeon's tiles: he slides along its walls, its pillars, its pools
// and its chests. Beside a chest he opens it (`openChest`) and takes what it holds (a Spell
// displaces the one he held, as an Obelisk's does); beside the stairs he climbs out
// (`leaveDungeon`) onto the cell he went down from. Below, no gun, flyer or Spell reaches him,
// nor can he cast or pray; and so that the deep is no place to hide from the war, its air is
// heavy: after DEEP_SECONDS he climbs out by himself, and he may go down again only after
// REENTER_SECONDS.
CHANGES.push({
  file: 'world.ts',
  why: 'dungeons',
  was: `  /** (netstorm-3d) The hit points left to the lifts that have been hit, by the key of the cells they join. */`,
  now: `  /** (netstorm-3d) The dungeons under the islands (digDungeon). */
  dungeons: Dungeon[] = [];
  /** (netstorm-3d) Priests below, by id: the dungeon (its index), where they stand in 1/WALK_SUB of
   * a tile, the way they are steered, an order of this tick, the tick they went down. */
  below = new Map<number, { dungeon: number; x: number; y: number; vx: number; vy: number; next: { vx: number; vy: number; lead: number; } | null; since: number; }>();
  /** (netstorm-3d) The Priests' Hover, by id: ticks of it left, whether he hovers, ticks of its prayer left. */
  hover = new Map<number, { charge: number; on: boolean; pray: number; }>();
  /** (netstorm-3d) The tick each Priest last climbed out of a dungeon. */
  surfaced = new Map<number, number>();
  /** (netstorm-3d) The hit points left to the lifts that have been hit, by the key of the cells they join. */`,
}, {
  file: 'world.ts',
  why: 'dungeons',
  was: `  /** Whether (x, y) lies under a Residence, where nothing can be built. */
  residenceAt(x: number, y: number): boolean {
    return this.residences.some(([rx, ry]) =>`,
  now: `  /** (netstorm-3d) The dungeon whose portal stands on (x, y), or within \`margin\` cells of it. */
  dungeonAt(x: number, y: number, margin = 0): Dungeon | undefined {
    return this.dungeons.find((d) =>
      x >= d.x - margin && x < d.x + PORTAL_FOOT + margin && y >= d.y - margin && y < d.y + PORTAL_FOOT + margin
    );
  }

  /** Whether (x, y) lies under a Residence, where nothing can be built. */
  residenceAt(x: number, y: number): boolean {
    // (netstorm-3d) nor on a dungeon's portal
    if (this.dungeonAt(x, y)) {
      return true;
    }

    return this.residences.some(([rx, ry]) =>`,
}, {
  file: 'world.ts',
  why: 'dungeons: no tree by a portal',
  was: `    if (!this.treeGrows(x, y) || this.residenceAt(x, y)) {`,
  now: `    if (!this.treeGrows(x, y) || this.residenceAt(x, y) || this.dungeonAt(x, y, 1)) {`,
}, {
  file: 'world.ts',
  why: 'dungeons',
  was: `/** (netstorm-3d) The trees' odds on a cell of island ground, and how much more for each cell of`,
  now: `/** (netstorm-3d) A dungeon under an island: see scripts/house-rules.mjs. \`tiles\` row by row (TILE). */
export interface Dungeon {
  id: number;
  owner: number;
  /** Its portal's top-left cell on the surface, PORTAL_FOOT square; \`side\`: where it is entered from. */
  x: number;
  y: number;
  side: 'top' | 'side' | 'below';
  w: number;
  h: number;
  tiles: number[];
  rooms: { x: number; y: number; w: number; h: number; kind: string; }[];
  /** The stairs' tile, and the tile below them one arrives on. */
  stairs: [number, number];
  arrive: [number, number];
  chests: { id: number; x: number; y: number; holds: string[]; opened: boolean; }[];
  seed: number;
}

/** (netstorm-3d) A dungeon portal's size on the surface, in cells. */
export const PORTAL_FOOT = 2;

/** (netstorm-3d) The trees' odds on a cell of island ground, and how much more for each cell of`,
}, {
  file: 'world.ts',
  why: 'dungeons',
  was: `      case 'steerPriest':
        return steerPriest(this, c);`,
  now: `      case 'steerPriest':
        return steerPriest(this, c);
      case 'enterDungeon':
        return enterDungeon(this, c);
      case 'leaveDungeon':
        return leaveDungeon(this, c);
      case 'openChest':
        return openChest(this, c);
      case 'prayHover':
        return prayHover(this, c);
      case 'hover':
        return setHover(this, c);`,
}, {
  file: 'world.ts',
  why: 'dungeons',
  was: `import { tickPriest, movePriest, steerPriest, WALK_SUB } from './rules/priest.js';`,
  now: `import {
  tickPriest,
  movePriest,
  steerPriest,
  WALK_SUB,
  enterDungeon,
  leaveDungeon,
  openChest,
  prayHover,
  setHover,
} from './rules/priest.js';`,
}, {
  file: 'world.ts',
  why: 'dungeons: in the computer\'s copy, so that it builds nothing on a portal',
  was: `        nights: this.nights,
        nightShare: this.nightShare,
      },`,
  now: `        nights: this.nights,
        nightShare: this.nightShare,
        dungeons: this.dungeons,
      },`,
}, {
  file: 'world.ts',
  why: 'dungeons: in the computer\'s copy, so that it builds nothing on a portal',
  was: `      world.nightShare = Math.min(1, Math.max(0, Number(rules.nightShare) || 0));`,
  now: `      world.nightShare = Math.min(1, Math.max(0, Number(rules.nightShare) || 0));
      world.dungeons = Array.isArray((rules as { dungeons?: unknown; }).dungeons) ? (rules as { dungeons: Dungeon[]; }).dungeons : [];`,
}, {
  file: 'rules/priest.ts',
  why: 'dungeons',
  was: `import { tickPrayer, breakPrayer } from './spells.js';`,
  now: `import { tickPrayer, breakPrayer, loseSpell } from './spells.js';
import { PORTAL_FOOT, type Dungeon } from '../world.js';`,
}, {
  file: 'rules/priest.ts',
  why: 'dungeons',
  was: `  // (netstorm-3d) walked by hand, in first person
  if (walkByHand(world, p)) {
    return;
  }`,
  now: `  // (netstorm-3d) his prayer for the Hover goes on while he stands
  hoverPray(world, p);

  // (netstorm-3d) below, in a dungeon
  if (delve(world, p)) {
    return;
  }

  // (netstorm-3d) walked by hand, in first person
  if (walkByHand(world, p)) {
    return;
  }`,
}, {
  file: 'rules/priest.ts',
  why: 'dungeons',
  was: `  let s = world.walking.get(p.id);

  if (!s) {
    if (!vx && !vy) {
      return null;
    }`,
  now: `  // (netstorm-3d) below, the order walks him in the dungeon
  const b = world.below.get(p.id);

  if (b) {
    b.next = { vx, vy, lead: b.next ? b.next.lead : Math.round(Math.max(0, Math.min(100, Number(c.lead) || 0))) };
    return null;
  }

  let s = world.walking.get(p.id);

  if (!s) {
    if (!vx && !vy) {
      return null;
    }`,
}, {
  file: 'rules/priest.ts',
  why: 'dungeons',
  was: `export function movePriest(`,
  now: `/* oxlint-disable no-magic-numbers -- netstorm-3d's dungeons */
/** (netstorm-3d) What a dungeon's tile is. */
export const TILE = { rock: 0, floor: 1, stairs: 2, pillar: 3, water: 4, chest: 5 } as const;
/** (netstorm-3d) A dungeon's size in tiles; how long a Priest may stay below, and how long he must
 * wait to go down again; how near he must be to a chest or the stairs, in tiles. */
export const DUNGEON_SIZE = 48;
export const DEEP_SECONDS = 180;
export const REENTER_SECONDS = 20;
export const DUNGEON_REACH = 1.7;
/** (netstorm-3d) The kinds of a dungeon's rooms past its entry, and the Spells a chest may hold. */
const ROOM_KINDS = ['crystal', 'hall', 'pool', 'grotto', 'shrine', 'ember'];
const CHEST_SPELLS = ['bomblightingzap', 'bombparalyze', 'bombheal', 'bombexplodemedium', 'bombmeteor'];
/* oxlint-enable no-magic-numbers */

/** (netstorm-3d) A small seeded random number generator (mulberry32), apart from the world's. */
function digRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * (netstorm-3d) Dig a dungeon under the home island of \`owner\`, laid out from \`seed\`: a portal on a
 * free 2×2 of island ground 6 to 13 cells from the Temple, clear of the rim, and below it rooms
 * joined by passages, chests in three of them, the farthest from the stairs holding a Spell.
 * Returns it (also in world.dungeons), or null when the island has no room for a portal.
 */
export function digDungeon(world: World, owner: number, seed: number): Dungeon | null {
  const temple = world.templeOf(owner);

  if (!temple) {
    return null;
  }

  const rand = digRandom(seed * 7919 + 101);
  const tx = temple.x + temple.fx / 2, ty = temple.y + temple.fy / 2;
  const sites: [number, number][] = [];
  const clear = (x: number, y: number) => world.inside(x, y) && world.terrain[world.at(x, y)] === Terrain.Island
    && world.owner[world.at(x, y)] === owner && !world.occupant[world.at(x, y)] && !world.residenceAt(x, y)
    && !world.takenBy(x, y);

  for (let y = Math.floor(ty) - 14; y <= ty + 14; y++) {
    for (let x = Math.floor(tx) - 14; x <= tx + 14; x++) {
      const far = Math.hypot(x + 1 - tx, y + 1 - ty);
      let ok = far >= 6 && far <= 13;

      for (let dy = -1; ok && dy <= PORTAL_FOOT; dy++) {
        for (let dx = -1; ok && dx <= PORTAL_FOOT; dx++) {
          ok = clear(x + dx, y + dy);
        }
      }

      if (ok) {
        sites.push([x, y]);
      }
    }
  }

  if (!sites.length) {
    return null;
  }

  const [px, py] = sites[Math.floor(rand() * sites.length)]!;
  const N = DUNGEON_SIZE;
  const tiles: number[] = new Array(N * N).fill(TILE.rock);
  const rooms: Dungeon['rooms'] = [];

  // rooms, apart from each other; the first is the entry, the stairs in its north wall
  for (let tries = 0; tries < 1500 && rooms.length < 9; tries++) {
    const w = 5 + Math.floor(rand() * 6), h = 5 + Math.floor(rand() * 6);
    const x = 2 + Math.floor(rand() * (N - w - 4)), y = 3 + Math.floor(rand() * (N - h - 5));

    if (rooms.some((r) => x < r.x + r.w + 2 && r.x < x + w + 2 && y < r.y + r.h + 2 && r.y < y + h + 2)) {
      continue;
    }

    rooms.push({ x, y, w, h, kind: '' });
  }

  const kinds = [...ROOM_KINDS];

  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!];
  }

  rooms.forEach((r, i) => { r.kind = i === 0 ? 'entry' : kinds[(i - 1) % kinds.length]!; });

  for (const r of rooms) {
    // caves, not chambers: a room is a ragged blob about its middle, bulging a tile past its
    // bounds here and short of them there (the entry, where the stairs stand, is squarer)
    const within = (x: number, y: number) => {
      const nx = (x + 0.5 - (r.x + r.w / 2)) / (r.w / 2), ny = (y + 0.5 - (r.y + r.h / 2)) / (r.h / 2);
      return nx * nx + ny * ny;
    };

    for (let y = r.y - 1; y <= r.y + r.h; y++) {
      for (let x = r.x - 1; x <= r.x + r.w; x++) {
        const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

        if (r.kind === 'entry' ? inside && within(x, y) < 1.5 + rand() * 0.4 : within(x, y) < 0.75 + rand() * 0.55) {
          tiles[y * N + x] = TILE.floor;
        }
      }
    }

    const cx = r.x + (r.w >> 1), cy = r.y + (r.h >> 1);
    const floorAt = (x: number, y: number) => tiles[y * N + x] === TILE.floor;

    // a hall's columns stand where they will, a shrine's stones about its middle, a pool is a blob
    if (r.kind === 'hall') {
      for (let k = 0; k < Math.floor((r.w * r.h) / 8); k++) {
        const x = r.x + Math.floor(rand() * r.w), y = r.y + Math.floor(rand() * r.h);
        const lone = DIRS.every(([dx, dy]) => tiles[(y + dy!) * N + x + dx!] !== TILE.pillar);

        if (floorAt(x, y) && lone && (x !== cx || y !== cy)) {
          tiles[y * N + x] = TILE.pillar;
        }
      }
    } else if (r.kind === 'shrine') {
      for (const [x, y] of [[r.x + 1, r.y + 1], [r.x + r.w - 2, r.y + 1], [r.x + 1, r.y + r.h - 2], [r.x + r.w - 2, r.y + r.h - 2]]) {
        const jx = x! + (rand() < 0.4 ? Math.sign(cx - x!) : 0), jy = y! + (rand() < 0.4 ? Math.sign(cy - y!) : 0);

        if (floorAt(jx, jy) && (jx !== cx || jy !== cy)) {
          tiles[jy * N + jx] = TILE.pillar;
        }
      }
    } else if (r.kind === 'pool') {
      for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
        for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
          if (floorAt(x, y) && within(x, y) < 0.22 + rand() * 0.2) {
            tiles[y * N + x] = TILE.water;
          }
        }
      }
    }
  }

  // passages: each room to the nearest of those joined already, and two more for loops; a
  // passage cuts through pillars and pools, a causeway across the water
  const centre = (r: Dungeon['rooms'][number]) => [r.x + (r.w >> 1), r.y + (r.h >> 1)] as const;
  const dig = (a: Dungeon['rooms'][number], b: Dungeon['rooms'][number]) => {
    const [ax, ay] = centre(a), [bx, by] = centre(b);
    const across = rand() < 0.5;
    // (a passage widens here and there)
    const cut = (x: number, y: number) => {
      tiles[y * N + x] = TILE.floor;

      if (rand() < 0.22) {
        tiles[rand() < 0.5 ? y * N + x + 1 : (y + 1) * N + x] = TILE.floor;
      }
    };

    if (across) {
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) cut(x, ay);
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) cut(bx, y);
    } else {
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) cut(ax, y);
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) cut(x, by);
    }
  };
  const apart = (a: Dungeon['rooms'][number], b: Dungeon['rooms'][number]) =>
    Math.hypot(centre(a)[0] - centre(b)[0], centre(a)[1] - centre(b)[1]);
  const joined = [rooms[0]!];

  for (const r of rooms.slice(1).sort((a, b) => apart(a, rooms[0]!) - apart(b, rooms[0]!))) {
    let near = joined[0]!;

    for (const j of joined) {
      if (apart(j, r) < apart(near, r)) {
        near = j;
      }
    }

    dig(near, r);
    joined.push(r);
  }

  for (let k = 0; k < 2 && rooms.length > 3; k++) {
    dig(rooms[1 + Math.floor(rand() * (rooms.length - 1))]!, rooms[1 + Math.floor(rand() * (rooms.length - 1))]!);
  }

  // the stairs up, in a wall of the entry no passage goes through, nearest the middle of its north
  // wall; one arrives on the tile before them
  const entry = rooms[0]!;
  const walls: [number, number, number, number][] = [];

  for (let x = entry.x + 1; x < entry.x + entry.w - 1; x++) {
    walls.push([x, entry.y - 1, x, entry.y], [x, entry.y + entry.h, x, entry.y + entry.h - 1]);
  }

  for (let y = entry.y + 1; y < entry.y + entry.h - 1; y++) {
    walls.push([entry.x - 1, y, entry.x, y], [entry.x + entry.w, y, entry.x + entry.w - 1, y]);
  }

  const mid = [entry.x + (entry.w >> 1), entry.y - 1];
  const free = walls.filter(([x, y]) => [[0, 0], ...DIRS].every(([dx, dy]) => {
    const [nx, ny] = [x + dx!, y + dy!];
    return tiles[ny * N + nx] === TILE.rock || (nx >= entry.x && nx < entry.x + entry.w && ny >= entry.y && ny < entry.y + entry.h);
  }));
  const [sx, sy, ax, ay] = free.sort((a, b) => Math.hypot(a[0] - mid[0]!, a[1] - mid[1]!) - Math.hypot(b[0] - mid[0]!, b[1] - mid[1]!))[0]
    ?? [mid[0]!, mid[1]!, mid[0]!, mid[1]! + 1];
  const stairs: [number, number] = [sx, sy];
  tiles[sy * N + sx] = TILE.stairs;
  const arrive: [number, number] = [ax, ay];

  // how far each floor tile is from the stairs, by the ways one walks
  const far = new Array(N * N).fill(-1);
  const walk = [arrive[1] * N + arrive[0]];
  far[walk[0]!] = 0;

  for (let head = 0; head < walk.length; head++) {
    const i = walk[head]!, x = i % N, y = (i / N) | 0;

    for (const [dx, dy] of DIRS) {
      const nx = x + dx!, ny = y + dy!, j = ny * N + nx;

      if (nx >= 0 && ny >= 0 && nx < N && ny < N && far[j] < 0 && tiles[j] === TILE.floor) {
        far[j] = far[i] + 1;
        walk.push(j);
      }
    }
  }

  // chests: against a wall of three rooms past the entry (no passage beside them), the farthest
  // from the stairs holding a Spell, the rest empty for now
  const chests: Dungeon['chests'] = [];
  const spells = CHEST_SPELLS.filter((id) => world.defs.has(id));

  for (const r of rooms.slice(1)) {
    if (chests.length >= 3) {
      break;
    }

    const spots: [number, number, number][] = [];

    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (tiles[y * N + x] !== TILE.floor || far[y * N + x] < 0) {
          continue;
        }

        // against the wall: rock on its outer side (no passage), floor on the rest
        let rock = 0, other = 0;

        for (const [dx, dy] of DIRS) {
          const t = tiles[(y + dy!) * N + x + dx!];
          rock += t === TILE.rock ? 1 : 0;
          other += t !== TILE.rock && t !== TILE.floor ? 1 : 0;
        }

        if (rock >= 1 && rock <= 2 && other === 0) {
          spots.push([x, y, far[y * N + x]]);
        }
      }
    }

    if (!spots.length) {
      continue;
    }

    const [x, y] = spots[Math.floor(rand() * spots.length)]!;
    tiles[y * N + x] = TILE.chest;
    chests.push({ id: chests.length + 1, x, y, holds: [], opened: false });
  }

  // the chests must leave every room reachable: one that cuts a way off is taken out again
  const reach = () => {
    const seen = new Uint8Array(N * N), q = [arrive[1] * N + arrive[0]];
    seen[q[0]!] = 1;

    for (let head = 0; head < q.length; head++) {
      const i = q[head]!, x = i % N, y = (i / N) | 0;

      for (const [dx, dy] of DIRS) {
        const j = (y + dy!) * N + x + dx!;

        if (!seen[j] && tiles[j] === TILE.floor) {
          seen[j] = 1;
          q.push(j);
        }
      }
    }

    return q.length;
  };
  for (const c of [...chests]) {
    tiles[c.y * N + c.x] = TILE.floor;
    const without = reach();
    tiles[c.y * N + c.x] = TILE.chest;

    if (reach() < without - 1) {
      tiles[c.y * N + c.x] = TILE.floor;
      chests.splice(chests.indexOf(c), 1);
    }
  }

  const farthest = chests.reduce<Dungeon['chests'][number] | null>(
    (best, c) => (!best || far[c.y * N + c.x] > far[best.y * N + best.x] ? c : best),
    null,
  );

  if (farthest && spells.length) {
    farthest.holds = [spells[Math.floor(rand() * spells.length)]!];
  }

  const dungeon: Dungeon = {
    id: world.dungeons.length + 1, owner, x: px, y: py, side: 'top', w: N, h: N, tiles, rooms, stairs, arrive, chests, seed,
  };
  world.dungeons.push(dungeon);
  return dungeon;
}

/** (netstorm-3d) Whether a Priest below may step onto tile (x, y) of a dungeon. */
function caveOpen(d: Dungeon, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < d.w && y < d.h && d.tiles[y * d.w + x] === TILE.floor;
}

/** (netstorm-3d) Where a Priest below at (x, y) (in 1/WALK_SUB of a tile) is after \`share\` of a tick
 * walking the way (vx, vy): as walkStep on the surface, in the dungeon's tiles. For the view's
 * foresight too (src/systems/ns-fp.js). */
export function caveStep(
  d: Dungeon,
  x: number,
  y: number,
  vx: number,
  vy: number,
  share = 1,
): { x: number; y: number; } {
  for (const axis of [0, 1]) {
    const dd = ((axis ? vy : vx) / 100) * WALK_STEP * share;

    if (!dd) {
      continue;
    }

    const cx = Math.floor(x / WALK_SUB), cy = Math.floor(y / WALK_SUB), c = axis ? cy : cx;
    const open = axis ? caveOpen(d, cx, cy + Math.sign(dd)) : caveOpen(d, cx + Math.sign(dd), cy);
    let v = (axis ? y : x) + dd;

    if (!open) {
      v = dd > 0 ? Math.min(v, Math.max((axis ? y : x), (c + 1) * WALK_SUB - WALK_RADIUS)) : Math.max(v, Math.min((axis ? y : x), c * WALK_SUB + WALK_RADIUS));
    }

    if (axis) {
      y = v;
    } else {
      x = v;
    }
  }

  return { x, y };
}

/** (netstorm-3d) The dungeon whose portal a Priest stands beside (on it or a cell from it). */
function portalBy(world: World, p: Priest): number {
  return world.dungeons.findIndex((d) =>
    p.x >= d.x - 1 && p.x <= d.x + PORTAL_FOOT && p.y >= d.y - 1 && p.y <= d.y + PORTAL_FOOT
  );
}

/** (netstorm-3d) How far a Priest below stands from the middle of tile (x, y), in tiles. */
function belowFrom(b: { x: number; y: number; }, x: number, y: number): number {
  return Math.hypot(b.x / WALK_SUB - x - 0.5, b.y / WALK_SUB - y - 0.5);
}

/** (netstorm-3d) The player's Priest goes down into the dungeon whose portal he stands beside. */
export function enterDungeon(world: World, c: { player: number; }): CommandError | null {
  const p = world.priestOf(c.player);

  if (!p || p.state !== 'normal' || p.casting > 0 || world.below.has(p.id)) {
    return 'priest unavailable';
  }

  const at = portalBy(world, p);

  if (at < 0) {
    return 'bad target';
  }

  if (world.tick - (world.surfaced.get(p.id) ?? -Infinity) < REENTER_SECONDS * TPS) {
    return 'not ready';
  }

  const d = world.dungeons[at]!;
  breakPrayer(p);
  p.path = [];
  p.move = 0;
  p.goal = 'idle';
  p.target = null;
  world.walking.delete(p.id);
  world.below.set(p.id, {
    dungeon: at, x: d.arrive[0] * WALK_SUB + WALK_SUB / 2, y: d.arrive[1] * WALK_SUB + WALK_SUB / 2, vx: 0, vy: 0, next: null, since: world.tick,
  });
  world.emit({ what: 'dungeon', who: p.owner, data: { priest: p.id, down: true } });
  return null;
}

/** (netstorm-3d) A Priest below climbs out, onto the cell he went down from. */
function climbOut(world: World, p: Priest, why: string): void {
  world.below.delete(p.id);
  world.surfaced.set(p.id, world.tick);
  world.emit({ what: 'dungeon', who: p.owner, data: { priest: p.id, down: false, why } });
}

/** (netstorm-3d) The player's Priest climbs out of the dungeon by its stairs. */
export function leaveDungeon(world: World, c: { player: number; }): CommandError | null {
  const p = world.priestOf(c.player), b = p ? world.below.get(p.id) : undefined;

  if (!p || !b) {
    return 'priest unavailable';
  }

  const d = world.dungeons[b.dungeon]!;

  if (belowFrom(b, d.stairs[0], d.stairs[1]) > DUNGEON_REACH) {
    return 'bad target';
  }

  climbOut(world, p, 'stairs');
  return null;
}

/** (netstorm-3d) The player's Priest below opens a chest beside him and takes what it holds. */
export function openChest(world: World, c: { player: number; chest: number; }): CommandError | null {
  const p = world.priestOf(c.player), b = p ? world.below.get(p.id) : undefined;

  if (!p || !b) {
    return 'priest unavailable';
  }

  const chest = world.dungeons[b.dungeon]!.chests.find((k) => k.id === c.chest);

  if (!chest || chest.opened || belowFrom(b, chest.x, chest.y) > DUNGEON_REACH) {
    return 'bad target';
  }

  chest.opened = true;
  const spell = chest.holds.find((id) => world.defs.has(id)) ?? null;

  if (spell) {
    if (p.spell && p.spell !== spell) {
      loseSpell(world, p.spell);
    }

    p.spell = spell;
    world.emit({ what: 'spell', who: p.owner, data: { transport: p.id, spell } });
  }

  world.emit({ what: 'chest', who: p.owner, data: { priest: p.id, chest: chest.id, holds: [...chest.holds] } });
  return null;
}

/* oxlint-disable no-magic-numbers -- netstorm-3d's Hover */
/** (netstorm-3d) The Hover: a Priest prays for it HOVER_PRAY_SECONDS standing still (a step breaks
 * the prayer off) and has HOVER_SECONDS of it; hovering, he floats a hand above the ground and
 * goes HOVER_PACE times his pace, on the islands and below, and it runs down only while he moves. */
export const HOVER_PRAY_SECONDS = 12;
export const HOVER_SECONDS = 30;
export const HOVER_PACE = 1.8;
/* oxlint-enable no-magic-numbers */

/** (netstorm-3d) The player's Priest prays for the Hover. */
export function prayHover(world: World, c: { player: number; }): CommandError | null {
  const p = world.priestOf(c.player);

  if (!p || p.state !== 'normal' || p.casting > 0 || p.praying > 0) {
    return 'priest unavailable';
  }

  const h = world.hover.get(p.id) ?? { charge: 0, on: false, pray: 0 };
  h.pray = HOVER_PRAY_SECONDS * TPS;
  h.on = false;
  world.hover.set(p.id, h);
  return null;
}

/** (netstorm-3d) The player's Priest hovers, or sets his feet down again. */
export function setHover(world: World, c: { player: number; on?: boolean; }): CommandError | null {
  const p = world.priestOf(c.player), h = p ? world.hover.get(p.id) : undefined;

  if (!p || !h || (c.on !== false && (h.charge <= 0 || h.pray > 0))) {
    return 'not ready';
  }

  h.on = c.on !== false;
  return null;
}

/** (netstorm-3d) A tick of a Priest's prayer for the Hover: it goes on while he stands still. */
function hoverPray(world: World, p: Priest): void {
  const h = world.hover.get(p.id);

  if (!h || h.pray <= 0) {
    return;
  }

  const s = world.below.get(p.id) ?? world.walking.get(p.id);
  const steered = s !== undefined && (s.vx !== 0 || s.vy !== 0 || (s.next !== null && (s.next.vx !== 0 || s.next.vy !== 0)));

  if (p.path.length > 0 || steered || p.casting > 0) {
    h.pray = 0;
    world.emit({ what: 'hover', who: p.owner, data: { priest: p.id, broken: true } });
  } else if (--h.pray === 0) {
    h.charge = HOVER_SECONDS * TPS;
    world.emit({ what: 'hover', who: p.owner, data: { priest: p.id, ready: true } });
  }
}

/** (netstorm-3d) How many times his pace a Priest goes now: HOVER_PACE hovering, else 1. */
export function hoverNow(world: World, p: Priest): number {
  const h = world.hover.get(p.id);
  return h && h.on && h.charge > 0 && h.pray === 0 ? HOVER_PACE : 1;
}

/** (netstorm-3d) The pace of a Priest who moves this tick; hovering, a tick of the Hover is spent. */
function hoverPace(world: World, p: Priest): number {
  const h = world.hover.get(p.id);

  if (!h || hoverNow(world, p) === 1) {
    return 1;
  }

  if (--h.charge === 0) {
    h.on = false;
    world.emit({ what: 'hover', who: p.owner, data: { priest: p.id, spent: true } });
  }

  return HOVER_PACE;
}

/** (netstorm-3d) A tick of a Priest below; true while he is below. */
function delve(world: World, p: Priest): boolean {
  const b = world.below.get(p.id);

  if (!b) {
    return false;
  }

  // the deep air is heavy: after DEEP_SECONDS he climbs out by himself
  if (world.tick - b.since >= DEEP_SECONDS * TPS) {
    climbOut(world, p, 'air');
    return true;
  }

  const d = world.dungeons[b.dungeon]!;
  const next = b.next;
  b.next = null;
  const lead = next ? next.lead / 100 : 1;
  const moves = b.vx !== 0 || b.vy !== 0 || (next !== null && (next.vx !== 0 || next.vy !== 0));
  const pace = moves ? hoverPace(world, p) : 1;
  let at = caveStep(d, b.x, b.y, b.vx, b.vy, lead * pace);

  if (next) {
    b.vx = next.vx;
    b.vy = next.vy;

    if (lead < 1) {
      at = caveStep(d, at.x, at.y, b.vx, b.vy, (1 - lead) * pace);
    }
  }

  b.x = Math.round(at.x);
  b.y = Math.round(at.y);
  return true;
}

export function movePriest(`,
}, {
  file: 'rules/combat.ts',
  why: 'dungeons: nothing reaches a Priest below',
  was: `    case 'priest':
      return world.hostile(b.owner, target.owner) && target.invisible === 0
        && (target.state === 'normal' || target.state === 'down');`,
  now: `    case 'priest':
      // (netstorm-3d) nor one below, in a dungeon
      return world.hostile(b.owner, target.owner) && target.invisible === 0
        && (target.state === 'normal' || target.state === 'down') && !world.below.has(target.id);`,
}, {
  file: 'rules/combat.ts',
  why: 'dungeons: nothing reaches a Priest below',
  was: `  if (!('hp' in entity) || shielded(entity, from)) {`,
  now: `  // (netstorm-3d) a Priest below, in a dungeon, is out of reach of everything above
  if (entity.kind === 'priest' && world.below.has(entity.id)) {
    return;
  }

  if (!('hp' in entity) || shielded(entity, from)) {`,
}, {
  file: 'rules/spells.ts',
  why: 'dungeons: no Spell is cast or prayed for below',
  was: `  const t = ownTransport(world, c.player, c.transport) ?? priest;

  if (!t?.spell) {
    return 'bad target';`,
  now: `  const t = ownTransport(world, c.player, c.transport) ?? priest;

  // (netstorm-3d) below, in a dungeon, a Priest neither casts nor prays
  if (t?.kind === 'priest' && world.below.has(t.id)) {
    return 'not ready';
  }

  if (!t?.spell) {
    return 'bad target';`,
}, {
  file: 'rules/spells.ts',
  why: 'dungeons: no Spell is cast or prayed for below',
  was: `  if (!prayable(world).includes(c.spell)) {
    return 'unknown unit';
  }`,
  now: `  if (!prayable(world).includes(c.spell)) {
    return 'unknown unit';
  }

  if (p && world.below.has(p.id)) {
    return 'not ready';
  }`,
}, {
  file: 'index.ts',
  why: 'dungeons',
  was: `export { walkStep, WALK_SUB } from './rules/priest.js';`,
  now: `export {
  walkStep,
  WALK_SUB,
  digDungeon,
  caveStep,
  TILE,
  DUNGEON_SIZE,
  DEEP_SECONDS,
  REENTER_SECONDS,
  DUNGEON_REACH,
  hoverNow,
  HOVER_PACE,
  HOVER_SECONDS,
  HOVER_PRAY_SECONDS,
} from './rules/priest.js';`,
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
