/**
 * Where a unit reaches, measured as the simulation measures it (after netstorm-web's
 * controls.ts drawReach): a Generator's or Temple's Energy and an air base's hunting ground as
 * circles round its middle; for a shooter a square of its range round its centre cell, the
 * Crossbow's 30° arc, or a cannon's straight line from the muzzle. All in world cells.
 */
import { NS, G } from './state.js';

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
export function reachOf(def, x, y, facing = 0) {
  const shapes = [];
  const mx = x + def.footX / 2, my = y + def.footY / 2, at = [x + 0.5, y + 0.5];
  if (def.cls === 'Energy' || def.group === 'battery') shapes.push({ circle: [mx, my, G.view.energyRange], kind: 'energy' });
  const hunt = NS.huntRadius(def.id, (type) => G.world.def(type));
  if (hunt !== null) shapes.push({ circle: [mx, my, hunt], kind: 'hunt' });
  if (!def.dps || !def.range) return shapes;
  const cx = x + (def.footX >> 1), cy = y + (def.footY >> 1), r = def.range;
  if (def.id === 'windarcher') {
    const [ax, ay] = NS.DIRS[facing], spread = r * ARC_TAN;
    const corner = (side) => [cx + 0.5 + ax * r - ay * spread * side, cy + 0.5 + ay * r + ax * spread * side];
    shapes.push({ poly: [[cx + 0.5, cy + 0.5], corner(-1), corner(1)], kind: 'fire' });
  } else if (def.group !== 'cannon') {
    shapes.push({ poly: rect(cx - r, cy - r, r * 2 + 1, r * 2 + 1), kind: 'fire' });
  } else {
    const [dx, dy] = NS.DIRS[facing];
    const sx = lineStart(dx, x, def.footX, cx, r), sy = lineStart(dy, y, def.footY, cy, r);
    shapes.push({ poly: rect(sx, sy, dx ? r : 1, dy ? r : 1), kind: 'fire' });
  }
  // each from the ground it is laid on (with tiered islands, the shapes are drawn at its height)
  for (const s of shapes) s.at = at;
  return shapes;
}

/** The reach of a building in the world. */
export function reachOfBuilding(b) {
  return reachOf(G.world.def(b.type), b.x, b.y, b.facing ?? 0);
}

/** Whether a building fires on anything (guns, anti-air, air bases). */
export function isGun(def) {
  return !!(def && ((def.dps && def.range) || NS.huntRadius(def.id, (type) => G.world.def(type)) !== null));
}

function rect(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}
