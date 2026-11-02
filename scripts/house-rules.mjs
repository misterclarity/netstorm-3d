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
 * (netstorm-3d) While the enemy Priest is shot at (up, below his full health) and stands within six
 * cells of ground the AI's carriers walk to, the level's number of carriers wait at the nearest
 * cell of that ground out of enemy fire, so that one is by him the moment he falls. Those already
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

  if (want > 0 && reached && foe && foe.hp < foe.hpMax) {
    let best = Infinity;

    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
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
