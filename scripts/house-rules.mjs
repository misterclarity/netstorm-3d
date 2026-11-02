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
    collect(world, move, transports.filter((t) => !waiting.has(t.id)), geysers, options.avoidDanger !== false);`,
}, {
  file: 'ai.ts',
  why: 'carriers wait near an enemy Priest under fire',
  was: `/** Send one transport for a downed enemy priest, unless one is already on its way to him. */`,
  now: `/**
 * (netstorm-3d) While the enemy Priest is shot at (up, below his full health), or his Temple is,
 * whose fall knocks him out, and he stands within eight cells of ground the AI's carriers walk to,
 * the level's number of carriers wait at the nearest cell of that ground out of enemy fire, so
 * that one is by him the moment he falls. Those already
 * waiting stay; the others are the nearest without cargo. Returns the carriers kept waiting.
 */
function stage(
  world: WorldView,
  move: Move,
  memory: AiMemory | undefined,
  transports: View<Transport>[],
  reached: Uint8Array | null,
): Set<number> {
  const kept = new Set<number>();
  const mem = memory as { staged?: number[]; } | undefined;
  const want = move.params.stageCarriers ?? 0;
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
 * geyser). */
function survives(world: WorldView, move: Move, t: View<Transport>, path: readonly (readonly [number, number])[]): boolean {
  return path.reduce((sum, [x, y]) => sum + move.threat[world.at(x, y)]!, 0) / world.def(t.type).speed < t.hp;
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
// lain where no ground of its own leads, buys one that flies, if its Fury knows one.
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

  if (params.airCapture && memory && options.capture !== false && !firstTransport) {
    flierFor(world, move, memory, transports, reached);
    because('the enemy Priest lay where no ground leads: a transport that flies is bought for him');
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

/** (netstorm-3d) Once the enemy Priest has lain where no ground of the side leads, the cheapest
 * transport that flies its Fury knows, unless it has one. */
function flierFor(
  world: WorldView,
  move: Move,
  memory: AiMemory,
  transports: View<Transport>[],
  reached: Uint8Array | null,
): void {
  const mem = memory as { wantFlier?: boolean; };
  const foe = enemyPriest(world, move.me, 'down');
  const near = (x: number, y: number): boolean => world.inside(x, y) && reached?.[world.at(x, y)] === 1;

  if (foe && reached && !near(foe.x, foe.y) && !DIRS.some(([dx, dy]) => near(foe.x + dx, foe.y + dy))) {
    mem.wantFlier = true;
  }

  const home = world.templeOf(move.me);
  const def = transportKinds(world, move.me).filter((d) => flies(d))
    .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))[0];

  if (mem.wantFlier && home && def && !transports.some((t) => flies(world.def(t.type)))) {
    place(world, move, def, { x: home.x + home.fx, y: home.y + home.fy });
  }
}

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
