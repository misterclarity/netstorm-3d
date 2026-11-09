/**
 * Tiered islands, a skirmish setting: every island floats at one of three heights, the bridges
 * between them climb as ramps, and all that stands on them stands at their height. For now this is
 * the look alone: the world underneath is as flat as ever, and what height will mean for play
 * (reach from high ground, slow climbs) is still to come.
 *
 * Heights are in cells (battlefield units), the middle tier at 0. They are worked out here from
 * the map: an island takes its tier when it first appears, from where it lies; ground that grows
 * onto it later takes its height, and an islet laid off a bridge's end (a unit that makes its own)
 * the height of the bridge there, so nothing once seen ever moves. A bridge's height runs from the
 * ground at one end to the ground at the other in proportion to the way along it; over the sky,
 * what flies keeps to the height of the land round about.
 */
import { G, WORLD, hash } from './state.js';

/** How far apart the tiers are, in cells. */
export const TIER = 4;
const N = WORLD * WORLD;
const NONE = 9;
const isLand = (t) => t === 1 || t === 5; // island ground, or an Edge Farm on its rim
const isBridge = (t) => t >= 2 && t <= 4;
/** The four sides of a cell: [dx, dy, its bit in the world's bridge links] (N, E, S, W). */
const SIDES = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];
/** How far round, in cells, the sky takes its height from the land. */
const AIR_REACH = 5;

export const HEIGHTS = {
  on: false,
  seed: 0,
  /** Each land cell's tier, -1, 0 or 1 (NONE before it has one; 0 too for an islet off a bridge). */
  tier: new Int8Array(N).fill(NONE),
  /** Each land cell's height. */
  land: new Float32Array(N),
  /** Each bridge cell's height at its middle, and how much it climbs per cell eastward and southward. */
  bridge: new Float32Array(N),
  gx: new Float32Array(N),
  gz: new Float32Array(N),
  /** Over the sky: the height of the land round about, blurred. */
  air: new Float32Array(N),
  /** The lowest and highest ground. */
  low: 0,
  high: 0,
};

/** A new match: tiered or not, its islands' heights all to be chosen afresh. */
export function resetHeights(on, seed = 0) {
  const H = HEIGHTS;
  H.on = !!on;
  H.seed = seed | 0;
  H.tier.fill(NONE);
  for (const a of [H.land, H.bridge, H.gx, H.gz, H.air]) a.fill(0);
  H.low = H.high = 0;
  updateHeights();
}

/** After the terrain has changed: tiers for new ground, and the bridges' ramps and the sky's heights anew. */
export function updateHeights(view = G.view) {
  const H = HEIGHTS;
  if (!H.on || !view) return;
  const t = view.terrain;
  // ground that has gone (an islet fallen) is forgotten, so that ground laid there again is new
  for (let i = 0; i < N; i++) if (H.tier[i] !== NONE && !isLand(t[i])) H.tier[i] = NONE;
  // each piece of land without a height: ground grown onto an island takes that island's, an
  // islet laid off a bridge the bridge's there (as last worked out), and a new island a tier
  // chosen by where it lies
  const seen = new Uint8Array(N), pieces = [];
  for (let i = 0; i < N; i++) {
    if (!isLand(t[i]) || H.tier[i] !== NONE || seen[i]) continue;
    const cells = [i];
    let touch = null, bridge = null;
    seen[i] = 1;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k], x = c % WORLD, y = (c / WORLD) | 0;
      for (const [dx, dy] of SIDES) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= WORLD || ny >= WORLD) continue;
        const j = ny * WORLD + nx;
        if (isBridge(t[j])) { bridge ??= H.bridge[j] - (H.gx[j] * dx + H.gz[j] * dy) * 0.5; continue; }
        if (!isLand(t[j])) continue;
        if (H.tier[j] !== NONE) touch ??= j; else if (!seen[j]) { seen[j] = 1; cells.push(j); }
      }
    }
    pieces.push({ cells, touch, bridge, first: i });
  }
  const fresh = pieces.filter((p) => p.touch === null && p.bridge === null);
  for (const p of fresh) p.tier = Math.floor(hash(p.first % WORLD, (p.first / WORLD) | 0, 90 + H.seed) * 3) - 1;
  // a whole map of islands at one height would show no tiers: then they take turns
  if (fresh.length > 1 && fresh.length === pieces.length && fresh.every((p) => p.tier === fresh[0].tier)) {
    fresh.forEach((p, k) => { p.tier = (k % 3) - 1; });
  }
  for (const p of pieces) {
    const height = p.touch !== null ? H.land[p.touch] : p.bridge ?? p.tier * TIER;
    const tier = p.touch !== null ? H.tier[p.touch] : p.bridge !== null ? Math.max(-1, Math.min(1, Math.round(p.bridge / TIER))) : p.tier;
    for (const i of p.cells) { H.tier[i] = tier; H.land[i] = height; }
  }
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < N; i++) {
    if (!isLand(t[i])) continue;
    low = Math.min(low, H.land[i]);
    high = Math.max(high, H.land[i]);
  }
  H.low = Number.isFinite(low) ? low : 0;
  H.high = Number.isFinite(high) ? high : 0;
  blurAir(t);
  rampBridges(view);
}

/** The sky's heights: the land's within AIR_REACH, averaged (two passes of a box sum); 0 far out. */
function blurAir(t) {
  const H = HEIGHTS, R = AIR_REACH;
  const sum = new Float32Array(N), count = new Float32Array(N), sum2 = new Float32Array(N), count2 = new Float32Array(N);
  for (let y = 0; y < WORLD; y++) {
    let s = 0, c = 0;
    const row = y * WORLD;
    for (let x = -R; x < WORLD; x++) {
      const add = x + R, drop = x - R - 1;
      if (add < WORLD && isLand(t[row + add])) { s += H.land[row + add]; c++; }
      if (drop >= 0 && isLand(t[row + drop])) { s -= H.land[row + drop]; c--; }
      if (x >= 0) { sum[row + x] = s; count[row + x] = c; }
    }
  }
  for (let x = 0; x < WORLD; x++) {
    let s = 0, c = 0;
    for (let y = -R; y < WORLD; y++) {
      const add = y + R, drop = y - R - 1;
      if (add < WORLD) { s += sum[add * WORLD + x]; c += count[add * WORLD + x]; }
      if (drop >= 0) { s -= sum[drop * WORLD + x]; c -= count[drop * WORLD + x]; }
      if (y >= 0) { sum2[y * WORLD + x] = s; count2[y * WORLD + x] = c; }
    }
  }
  for (let i = 0; i < N; i++) H.air[i] = count2[i] > 0.5 ? sum2[i] / count2[i] : 0;
}

/**
 * Each bridge cell's height: from the ground of every height its bridge reaches, the nearer the
 * more (by the inverse of the way along the bridge to it). Between two islands that is a straight
 * ramp from one to the other; a bridge out from one island alone stays at its height.
 */
function rampBridges(view) {
  const H = HEIGHTS, t = view.terrain, links = view.links, cells = [];
  for (let i = 0; i < N; i++) if (isBridge(t[i])) cells.push(i);
  if (!cells.length) return;
  const open = (i, side) => ((links[i] || 15) & SIDES[side][2]) !== 0;
  const next = (i, side) => {
    const x = (i % WORLD) + SIDES[side][0], y = ((i / WORLD) | 0) + SIDES[side][1];
    return x < 0 || y < 0 || x >= WORLD || y >= WORLD ? -1 : y * WORLD + x;
  };
  // the ground the bridges come off, by its height: the bridge cells that leave ground of each
  const starts = new Map();
  for (const i of cells) {
    for (let side = 0; side < 4; side++) {
      const j = open(i, side) ? next(i, side) : -1;
      if (j < 0 || !isLand(t[j])) continue;
      const h = H.land[j];
      if (!starts.has(h)) starts.set(h, []);
      starts.get(h).push(i);
    }
  }
  const sum = new Float32Array(N), weight = new Float32Array(N), dist = new Float32Array(N);
  for (const [h, from] of starts) {
    // the way along the bridges from ground of this height, in cells: half a cell to the middle
    // of the cell that leaves it
    for (const i of cells) dist[i] = Infinity;
    const queue = [];
    for (const i of from) if (dist[i] > 0.5) { dist[i] = 0.5; queue.push(i); }
    for (let k = 0; k < queue.length; k++) {
      const i = queue[k];
      for (let side = 0; side < 4; side++) {
        const j = open(i, side) ? next(i, side) : -1;
        if (j >= 0 && isBridge(t[j]) && dist[j] > dist[i] + 1) { dist[j] = dist[i] + 1; queue.push(j); }
      }
    }
    for (const i of cells) {
      if (dist[i] === Infinity) continue;
      sum[i] += h / dist[i];
      weight[i] += 1 / dist[i];
    }
  }
  for (const i of cells) H.bridge[i] = weight[i] ? sum[i] / weight[i] : H.air[i];
  // how each climbs: the mean of the slopes to its neighbours along the way, east-west and
  // north-south (ground it meets half a cell off, at its edge)
  for (const i of cells) {
    for (const [g, ahead, back] of [[H.gx, 1, 3], [H.gz, 2, 0]]) {
      let s = 0, n = 0;
      for (const [side, sign] of [[ahead, 1], [back, -1]]) {
        const j = open(i, side) ? next(i, side) : -1;
        if (j < 0) continue;
        if (isBridge(t[j])) { s += sign * (H.bridge[j] - H.bridge[i]); n++; } else if (isLand(t[j])) { s += (sign * (H.land[j] - H.bridge[i])) / 0.5; n++; }
      }
      g[i] = n ? s / n : 0;
    }
  }
}

/** The sky's height at a point, smoothly between cells. */
function airAt(x, y) {
  const H = HEIGHTS, fx = x - 0.5, fy = y - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), kx = fx - x0, ky = fy - y0;
  const at = (cx, cy) => (cx < 0 || cy < 0 || cx >= WORLD || cy >= WORLD ? 0 : H.air[cy * WORLD + cx]);
  return (at(x0, y0) * (1 - kx) + at(x0 + 1, y0) * kx) * (1 - ky) + (at(x0, y0 + 1) * (1 - kx) + at(x0 + 1, y0 + 1) * kx) * ky;
}

/**
 * The ground's height at a point in world cells (x, y): an island's, a bridge's as it climbs
 * across its cell, or over the sky the height of the land round about. 0 on a level map.
 */
export function groundAt(x, y) {
  const H = HEIGHTS;
  if (!H.on || !G.view) return 0;
  const cx = Math.floor(x), cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= WORLD || cy >= WORLD) return 0;
  const i = cy * WORLD + cx, t = G.view.terrain[i];
  if (isLand(t)) return H.land[i];
  if (isBridge(t)) return H.bridge[i] + H.gx[i] * (x - cx - 0.5) + H.gz[i] * (y - cy - 0.5);
  return airAt(x, y);
}

/** The height of a cell's ground as it was last worked out, even if it has just fallen out of the sky. */
export function heightOfCell(x, y) {
  const H = HEIGHTS;
  if (!H.on || x < 0 || y < 0 || x >= WORLD || y >= WORLD) return 0;
  const i = y * WORLD + x;
  return H.tier[i] !== NONE ? H.land[i] : H.bridge[i] || H.air[i];
}

/** The height that what flies keeps to over a point: the land's round about, never below the ground under it. */
export function flyAt(x, y) {
  if (!HEIGHTS.on) return 0;
  return Math.max(airAt(x, y), groundAt(x, y));
}
