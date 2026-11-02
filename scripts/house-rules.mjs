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
