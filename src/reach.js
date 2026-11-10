/**
 * Where a unit reaches, measured as the simulation measures it (after netstorm-web's
 * controls.ts drawReach): a Generator's or Temple's Energy and an air base's hunting ground as
 * circles round its middle; for a shooter a square of its range round its centre cell, the
 * Crossbow's 30° arc, or a cannon's straight line from the muzzle: shorter at night, by the moon
 * and the gun's Fury, unless an Energy ring lights it (the house rules' nightCut), and on tiered
 * islands longer at the levels below it. All in world cells.
 */
import { NS, G, WORLD, ME } from './state.js';
import { HEIGHTS, TIER } from './heights.js';

const ARC_TAN = Math.tan(Math.PI / 6);

/** Where a cannon's line starts along one axis (controls.ts lineStart). */
function lineStart(d, origin, foot, centre, range) {
  if (d > 0) return origin + foot;
  return d < 0 ? origin - range : centre;
}

/**
 * The shapes a unit of type `def` reaches if laid at (x, y) (its top-left cell) facing `facing`:
 * { circle: [cx, cy, r], kind } or { poly: [[x, y], …], kind }, kind 'energy', 'hunt' or 'fire'.
 */
export function reachOf(def, x, y, facing = 0, owner = ME) {
  const shapes = [];
  const mx = x + def.footX / 2, my = y + def.footY / 2, at = [x + 0.5, y + 0.5];
  const t = G.view.terrain[y * WORLD + x], own = t >= 1 && t <= 5 ? G.world.level[y * WORLD + x] : HEIGHTS.active;
  if (def.cls === 'Energy' || def.group === 'battery') shapes.push({ circle: [mx, my, G.view.energyRange], kind: 'energy' });
  const hunt = NS.huntRadius(def.id, (type) => G.world.def(type));
  if (hunt !== null) {
    shapes.push({ circle: [mx, my, hunt], kind: 'hunt' });
    // on tiered islands flyers hunt in a sphere: on the levels above and below, the circle where it
    // cuts them (house rules)
    if (HEIGHTS.on) {
      for (const level of [-1, 0, 1]) {
        const up = Math.abs(level - own) * TIER;
        if (level !== own && hunt > up) shapes.push({ circle: [mx, my, Math.sqrt(hunt * hunt - up * up)], kind: 'hunt', h: level * TIER });
      }
    }
  }
  if (!def.dps || !def.range) return shapes;
  // how far it reaches now, as the house rules measure it: at night less by the moon and its Fury,
  // unless it stands in a lit Energy ring; HIGH_REACH farther for each level down
  const gun = { kind: 'building', type: def.id, owner, x, y, fx: def.footX, fy: def.footY };
  const cut = G.world?.isNight?.() ? NS.nightCut(G.world, gun) : 0;
  const reach = (down) => (cut || down ? Math.max(1, Math.round(def.range * (1 - cut) * (1 + NS.HIGH_REACH * down))) : def.range);
  const cx = x + (def.footX >> 1), cy = y + (def.footY >> 1);
  const fire = (r, h) => {
    if (def.id === 'windarcher') {
      const [ax, ay] = NS.DIRS[facing], spread = r * ARC_TAN;
      const corner = (side) => [cx + 0.5 + ax * r - ay * spread * side, cy + 0.5 + ay * r + ax * spread * side];
      return { poly: [[cx + 0.5, cy + 0.5], corner(-1), corner(1)], kind: 'fire', h };
    }
    if (def.group !== 'cannon') return { poly: rect(cx - r, cy - r, r * 2 + 1, r * 2 + 1), kind: 'fire', h };
    const [dx, dy] = NS.DIRS[facing];
    const sx = lineStart(dx, x, def.footX, cx, r), sy = lineStart(dy, y, def.footY, cy, r);
    return { poly: rect(sx, sy, dx ? r : 1, dy ? r : 1), kind: 'fire', h };
  };
  shapes.push(fire(reach(0)));
  // on tiered islands, at each level below it, the farther reach there (not the Disc Thrower, which
  // throws level or up, nor the Vander Tower, which shoots at flyers only)
  if (HEIGHTS.on && def.id !== 'sunarcher' && def.id !== 'thunderarcher') {
    for (let level = own - 1; level >= -1; level--) shapes.push(fire(reach(own - level), level * TIER));
  }
  // each from the ground it is laid on (with tiered islands, the shapes are drawn at its height)
  for (const s of shapes) s.at = at;
  return shapes;
}

/** The reach of a building in the world. */
export function reachOfBuilding(b) {
  return reachOf(G.world.def(b.type), b.x, b.y, b.facing ?? 0, b.owner);
}

/** Whether a building fires on anything (guns, anti-air, air bases). */
export function isGun(def) {
  return !!(def && ((def.dps && def.range) || NS.huntRadius(def.id, (type) => G.world.def(type)) !== null));
}

function rect(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}
