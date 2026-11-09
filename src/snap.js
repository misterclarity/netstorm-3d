/**
 * Where a bridge piece goes, helped: it snaps one of its open ends onto the open end of the
 * player's bridge (or the rim of his ground) nearest the pointer. "Nearest" is measured where the
 * pointer's ray passes at that end's own height, so that on tiered islands an end on another
 * level is picked where it is seen, not where the ray meets the level the piece goes on. Of the
 * ways the piece fits there, the one turned as the player turned it (R) is taken first, then the
 * one whose middle lies nearest the pointer on the piece's level; with no end near, the piece
 * goes where the pointer is, as before. The same answer is shown (ns-placement) and laid
 * (ns-game), and kept while the pointer stays put.
 */
import { NS, G, ME, WORLD, origin } from './state.js';
import { HEIGHTS, TIER } from './heights.js';
import { localRay } from './space.js';

/** How near, in cells, the pointer's ray must pass an open end for the piece to snap to it. */
const REACH = 3.5;
/** How much farther, in cells, an end on the rim of the ground counts than the end of a bridge. */
const RIM = 1.25;
const isLand = (t) => t === 1 || t === 5;
const isBridge = (t) => t >= 2 && t <= 4;

let ends = { revision: -1, world: null, list: [] };
let memo = { key: '', result: null };

/**
 * The player's open ends: every side of his connected bridge that is open onto the sky (a bridge
 * end), and every side of his connected ground that meets it (its rim). Each: { e, s (the cell
 * joined from and the sky cell a piece must cover), dir (from s to e), x, y (the middle of the
 * side between them), h (its height), bridge }.
 */
export function openEnds() {
  const v = G.view;
  if (!v || !G.world) return [];
  if (ends.revision === v.terrainRevision && ends.world === G.world) return ends.list;
  const connected = NS.connectedToTemple(v, ME), list = [];
  if (connected) {
    for (let i = 0; i < WORLD * WORLD; i++) {
      const t = v.terrain[i];
      if (!connected[i] || !(isBridge(t) || isLand(t))) continue;
      const x = i % WORLD, y = (i / WORLD) | 0;
      NS.DIRS.forEach(([dx, dy], dir) => {
        const sx = x + dx, sy = y + dy;
        if (sx < 0 || sy < 0 || sx >= WORLD || sy >= WORLD || v.terrain[sy * WORLD + sx] !== 0) return;
        if (isBridge(t) && !((v.links[i] || 15) & (1 << dir))) return;
        list.push({
          e: [x, y], s: [sx, sy], dir: (dir + 2) % 4, x: x + 0.5 + dx * 0.5, y: y + 0.5 + dy * 0.5,
          h: HEIGHTS.on ? G.world.level[i] * TIER : 0, bridge: isBridge(t),
        });
      });
    }
  }
  ends = { revision: v.terrainRevision, world: G.world, list };
  return list;
}

/**
 * Where the piece in hand goes for a scene ray: { x, y, rot, joint } (its top-left cell, its turn
 * and the open end it joins), or null when no open end is near enough.
 */
export function snapPiece(ray) {
  const tool = G.tool;
  if (tool.kind !== 'piece' || !ray || !G.world) return null;
  const hand = G.world.players.get(ME)?.hand[tool.hand];
  if (!hand) return null;
  const local = localRay(ray), o = local.origin, d = local.direction;
  if (d.y > -1e-4) return null;
  /** Where the ray passes at height h, in world cells. */
  const at = (h) => {
    const k = (h - o.y) / d.y;
    return k < 0 ? null : [o.x + d.x * k + origin.x, o.z + d.z * k + origin.z];
  };
  const heights = HEIGHTS.on ? [-TIER, 0, TIER] : [0], points = heights.map(at);
  const key = `${G.view.terrainRevision}|${tool.hand}|${hand.piece}|${G.rot}|${HEIGHTS.active}|${points.map((p) => (p ? `${Math.round(p[0] * 4)},${Math.round(p[1] * 4)}` : '-')).join('|')}`;
  if (memo.key === key) return memo.result;
  const near = [];
  for (const j of openEnds()) {
    const p = points[heights.indexOf(j.h)] ?? at(j.h);
    if (!p) continue;
    const far = Math.hypot(p[0] - j.x, p[1] - j.y);
    if (far <= REACH) near.push({ j, far: far + (j.bridge ? 0 : RIM) });
  }
  near.sort((a, b) => a.far - b.far);
  const aim = at(HEIGHTS.on ? HEIGHTS.active * TIER : 0) ?? [0, 0];
  let result = null;
  for (const { j } of near.slice(0, 10)) {
    for (const rot of [G.rot, ...[0, 1, 2, 3].filter((r) => r !== G.rot)]) {
      const cells = NS.rotatePiece(NS.PIECES[hand.piece], rot);
      const mx = cells.reduce((s, c) => s + c[0], 0) / cells.length + 0.5, my = cells.reduce((s, c) => s + c[1], 0) / cells.length + 0.5;
      for (const [cx, cy, dir] of NS.pieceEnds(hand.piece, rot)) {
        if (dir !== j.dir) continue;
        const x = j.s[0] - cx, y = j.s[1] - cy;
        // all its cells over open sky first, which is cheap to ask; then the rules
        if (cells.some(([px, py]) => { const cx2 = x + px, cy2 = y + py; return cx2 < 0 || cy2 < 0 || cx2 >= WORLD || cy2 >= WORLD || G.view.terrain[cy2 * WORLD + cx2] !== 0; })) continue;
        if (G.view.canDropPiece({ player: ME, hand: tool.hand, x, y, rot }) !== null) continue;
        const score = (rot === G.rot ? 0 : 100) + Math.hypot(x + mx - aim[0], y + my - aim[1]);
        if (!result || score < result.score) result = { x, y, rot, joint: j, score };
      }
    }
    if (result) break;
  }
  memo = { key, result };
  return result;
}
