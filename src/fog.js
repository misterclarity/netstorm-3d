/**
 * The fog of war: what of the map the player has explored. A cell is explored once something of
 * the player's (or of an ally's) has come within sight of it, and stays explored for the rest of
 * the battle. Unexplored island ground is drawn under a dark haze (ns-fog.js), and what stands or moves
 * on unexplored cells (enemy and neutral buildings, carriers, flyers, geysers, crystals, bridges,
 * Residences, trees) is not drawn, picked or listed; one's own and allies' things always are.
 *
 * What sees, and how far (SIGHT, in cells): a Priest, a carrier on the ground or in the air, a
 * flyer, a building (beyond its edge), every cell of a bridge one has laid; one's own ground is
 * explored whole, and the islets just off its shore (the home island from the start). A gun that
 * fires on what is one's own is seen (its footprint and a cell about it), and where one's own shot
 * lands is seen about the cell. The fog is the player's view only: the rules, and the computer
 * opponent, see everything as before.
 *
 * Pure: it reads the world and keeps its own grid, so that scripts/check.js can try it headless.
 */
import * as NS from './engine.js';

const W = NS.W;

/** How far each kind of thing sees, in cells. */
export const SIGHT = {
  priest: 9, // a Priest on his feet (down, carried or chained: CLOSE)
  close: 3,
  ground: 7, // a carrier on the ground: a Golem
  air: 10, // an Aerial Transport, high above
  flyer: 8, // an air base's flyer
  building: 5, // beyond a building's edge
  bridge: 3, // about each cell of a bridge laid
  shore: 3, // off the shore of one's own ground
  struck: 2, // about where one's own shot lands
  firing: 1, // about a gun that fires on what is one's own
};

export const FOG = {
  /** This battle has the fog (the setting, taken as the battle starts). */
  on: false,
  /** 1 where the cell has been explored. */
  seen: new Uint8Array(W * W),
  /** Goes up each time cells are explored, and at a new battle: what draws the fog redraws. */
  revision: 0,
  /** How many cells are explored. */
  count: 0,
  /** Cells were explored in this step. */
  fresh: false,
  world: null,
  /** The cells of the player's own ground and bridges, gathered again when the terrain changes. */
  own: null,
  ownRevision: -1,
};

/** Whether `owner` is the player or an ally: their things see, and are seen. */
export function friendly(world, owner) {
  return owner === NS.ME || (owner > 0 && !world.hostile(NS.ME, owner));
}

function mark(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= W) return;
  const i = y * W + x;
  if (FOG.seen[i]) return;
  FOG.seen[i] = 1;
  FOG.count++;
  FOG.fresh = true;
}

/** Explore every cell whose middle lies within r of (cx, cy) (cell coordinates, a cell's middle at +0.5). */
export function reveal(cx, cy, r) {
  const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r), y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r), rr = r * r;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= rr) mark(x, y);
    }
  }
}

/** Explore a rectangle of cells, `pad` more on each side. */
function revealArea(x, y, w, h, pad = 0) {
  for (let yy = y - pad; yy < y + h + pad; yy++) for (let xx = x - pad; xx < x + w + pad; xx++) mark(xx, yy);
}

/** Where a thing sees from and how far: [cx, cy, r], or null if it does not. */
export function sightOf(world, e) {
  switch (e.kind) {
    case 'building': return [e.x + e.fx / 2, e.y + e.fy / 2, Math.max(e.fx, e.fy) / 2 + SIGHT.building];
    case 'priest': return [e.x + 0.5, e.y + 0.5, e.state === 'normal' ? SIGHT.priest : SIGHT.close];
    case 'transport': return [e.x + 0.5, e.y + 0.5, NS.flies(world.def(e.type)) ? SIGHT.air : SIGHT.ground];
    case 'flyer': return [e.px / NS.FLYER_SCALE, e.py / NS.FLYER_SCALE, SIGHT.flyer];
    default: return null;
  }
}

/**
 * A new battle: nothing explored but the player's own ground and what its things see, and the
 * places in `known` ([cx, cy, r] each: what the battle's story says the player knows). With the fog
 * off, everything is explored.
 */
export function startFog(world, on, known = []) {
  FOG.on = !!on;
  FOG.world = world;
  FOG.seen.fill(FOG.on ? 0 : 1);
  FOG.count = FOG.on ? 0 : W * W;
  FOG.own = null;
  FOG.ownRevision = -1;
  FOG.revision++;
  if (!FOG.on) return;
  for (const [cx, cy, r] of known) reveal(cx, cy, r);
  stepFog(world);
  FOG.revision++;
}

/**
 * What the Wayfinder's scouting told of, known as the raid begins (sim/raid.ts): each estate's
 * quarters and its landing, as [cx, cy, r] for startFog.
 */
export function raidKnown(world) {
  const r = world.raid;
  if (!r) return [];
  return [
    ...r.quarters.map((q) => [q.door[0] + 0.5, q.door[1] + 0.5, 7]),
    ...r.landings.map((l) => [l.x + l.w / 2, l.y + l.h / 2, Math.max(l.w, l.h) / 2 + 4]),
  ];
}

/** After each tick of the world: explore what the player's things see now. */
export function stepFog(world) {
  if (!FOG.on || world !== FOG.world) return;
  FOG.fresh = false;
  // the player's ground (explored whole, and SIGHT.shore off its shore) and bridges (each with
  // SIGHT.bridge about it): gathered again when the terrain changes, which it does as bridges are
  // laid and ground changes hands
  if (FOG.ownRevision !== world.terrainRevision || !FOG.own || world.tick % 50 === 0) {
    FOG.ownRevision = world.terrainRevision;
    const own = [];
    for (let i = 0; i < W * W; i++) {
      const t = world.terrain[i];
      if (t && t <= 5 && friendly(world, world.owner[i])) own.push(i);
    }
    FOG.own = own;
    const held = (x, y) => x >= 0 && y >= 0 && x < W && y < W && world.terrain[y * W + x] && friendly(world, world.owner[y * W + x]);
    for (const i of own) {
      const t = world.terrain[i], x = i % W, y = (i / W) | 0;
      if (t >= 2 && t <= 4) reveal(x + 0.5, y + 0.5, SIGHT.bridge);
      else if (held(x + 1, y) && held(x - 1, y) && held(x, y + 1) && held(x, y - 1)) mark(x, y);
      else reveal(x + 0.5, y + 0.5, SIGHT.shore);
    }
  }
  for (const e of world.entities.values()) {
    if (!friendly(world, e.owner)) continue;
    const s = sightOf(world, e);
    if (s) reveal(s[0], s[1], s[2]);
  }
  // shots: where one's own land is seen about; a gun firing on one's own is seen
  for (const shot of world.shots ?? []) {
    const gun = shot.gun;
    if (!gun) continue;
    if (friendly(world, gun.owner)) reveal(shot.x + 0.5, shot.y + 0.5, SIGHT.struck);
    else if (friendly(world, world.entities.get(shot.target)?.owner ?? 0)) revealArea(gun.x, gun.y, gun.fx ?? 1, gun.fy ?? 1, SIGHT.firing);
  }
  if (FOG.fresh) FOG.revision++;
}

/** Whether cell (x, y) is explored (always, without the fog). */
export function seenCell(x, y) {
  if (!FOG.on) return true;
  return x >= 0 && y >= 0 && x < W && y < W && FOG.seen[y * W + x] === 1;
}

/** Whether any cell of the rectangle is explored. */
export function seenArea(x, y, w, h) {
  if (!FOG.on) return true;
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (seenCell(xx, yy)) return true;
  return false;
}

/** Whether the player may see thing `e`: their own and their allies' always; the rest where explored. */
export function seenEntity(world, e) {
  if (!FOG.on || !e) return true;
  if (friendly(world, e.owner)) return true;
  switch (e.kind) {
    case 'building': return seenArea(e.x, e.y, e.fx, e.fy);
    case 'geyser': return seenArea(e.x - 1, e.y - 1, 3, 3);
    case 'flyer': return seenCell(Math.floor(e.px / NS.FLYER_SCALE), Math.floor(e.py / NS.FLYER_SCALE));
    default: return seenCell(e.x, e.y);
  }
}

/** What stands on cell (x, y) as the player may see it: null where the fog hides it. */
export function seenAt(world, x, y) {
  const e = NS.entityAt(world, x, y);
  return e && seenEntity(world, e) ? e : null;
}
