/**
 * Tiered islands, a skirmish setting: the islands stand on three levels, the middle one and one
 * below and one above it, TIER cells apart. Bridges are laid flat on a level (the player picks
 * which with Q and E); where a bridge joins ground or bridge on another level, a lift carries the
 * walkers between them, slowly and in the open (the rules are in scripts/house-rules.mjs: the
 * world's `level` of each cell, the ride's time and the extra damage taken on it).
 *
 * At the start of a match each island is given its level here, from where it lies; the world
 * keeps it from then on, and gives a new islet its own (one laid off a bridge's end the bridge's).
 * This module turns the levels into heights for drawing and clicking: in cells (battlefield
 * units), the middle level at 0; over the sky, what flies keeps to the height of the land round
 * about.
 */
import { G, ME, WORLD, hash } from './state.js';

/** How far apart the levels are, in cells: far enough that a bridge across a gap of the usual
 * eight to fourteen cells would climb at 30 to 45 degrees, so the levels read as apart. */
export const TIER = 8;
export const LEVEL_NAMES = { '-1': 'Lower', 0: 'Middle', 1: 'Upper' };
const N = WORLD * WORLD;
const isLand = (t) => t === 1 || t === 5; // island ground, or an Edge Farm on its rim
const isBridge = (t) => t >= 2 && t <= 4;
/** The four sides of a cell: [dx, dy, its bit in the world's bridge links] (N, E, S, W). */
const SIDES = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];
/** How far round, in cells, the sky takes its height from the land. */
const AIR_REACH = 5;

export const HEIGHTS = {
  on: false,
  /** The level bridges are laid on and the sky is clicked at: -1, 0 or 1. */
  active: 0,
  /** Over the sky: the height of the land round about, blurred. */
  air: new Float32Array(N),
  /** The lowest and highest ground. */
  low: 0,
  high: 0,
  /**
   * The lifts: where a bridge joins ground or bridge of another level. Each: { key, a, b (the two
   * cells), x, y (the middle of the side between them, in world cells), dx, dy (from a to b),
   * low, high (heights) }.
   */
  lifts: [],
  /** Lift key → { y, at }: the height of the walker riding it, drawn at scene time `at`. */
  riding: new Map(),
  /** Called with (key, y) as a rider is drawn, to put the lift's car under it (ns-terrain). */
  onRide: null,
};

/** A cell's level, -1 to 1. */
const levelOf = (i) => G.world?.level?.[i] ?? 0;

/** A new match: tiered or not; if it is, each island takes its level now. */
export function resetHeights(on, seed = 0) {
  const H = HEIGHTS, w = G.world;
  H.on = !!on && !!w?.level;
  H.riding.clear();
  H.lifts = [];
  H.air.fill(0);
  H.low = H.high = 0;
  if (!H.on) return;
  w.tiered = true;
  const t = w.terrain, seen = new Uint8Array(N), pieces = [];
  for (let i = 0; i < N; i++) {
    if (!isLand(t[i]) || seen[i]) continue;
    const cells = [i];
    seen[i] = 1;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k], x = c % WORLD, y = (c / WORLD) | 0;
      for (const [dx, dy] of SIDES) {
        const nx = x + dx, ny = y + dy, j = ny * WORLD + nx;
        if (nx >= 0 && ny >= 0 && nx < WORLD && ny < WORLD && isLand(t[j]) && !seen[j]) { seen[j] = 1; cells.push(j); }
      }
    }
    pieces.push({ cells, level: Math.floor(hash(i % WORLD, (i / WORLD) | 0, 90 + (seed | 0)) * 3) - 1 });
  }
  // a whole map on one level would show none: then they take turns
  if (pieces.length > 1 && pieces.every((p) => p.level === pieces[0].level)) pieces.forEach((p, k) => { p.level = (k % 3) - 1; });
  for (const p of pieces) for (const i of p.cells) w.level[i] = p.level;
  // the player starts on the level of his Temple
  const temple = w.templeOf(ME);
  H.active = temple ? w.level[temple.y * WORLD + temple.x] : 0;
  updateHeights();
}

/** Bridges, lifts and the sky's heights anew, after the terrain has changed. */
export function updateHeights(view = G.view) {
  const H = HEIGHTS;
  if (!H.on || !view) return;
  const t = view.terrain, links = view.links;
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < N; i++) {
    if (!isLand(t[i]) && !isBridge(t[i])) continue;
    const h = levelOf(i) * TIER;
    low = Math.min(low, h);
    high = Math.max(high, h);
  }
  H.low = Number.isFinite(low) ? low : 0;
  H.high = Number.isFinite(high) ? high : 0;
  blurAir(t);
  // a lift wherever a bridge joins, on a side it is open on, ground or bridge of another level
  const lifts = [];
  for (let i = 0; i < N; i++) {
    if (!isBridge(t[i])) continue;
    const x = i % WORLD, y = (i / WORLD) | 0;
    for (const [dx, dy, bit] of SIDES) {
      const nx = x + dx, ny = y + dy, j = ny * WORLD + nx;
      if (!((links[i] || 15) & bit) || nx < 0 || ny < 0 || nx >= WORLD || ny >= WORLD) continue;
      if (!isLand(t[j]) && !(isBridge(t[j]) && j > i)) continue;
      const a = levelOf(i), b = levelOf(j);
      if (a === b) continue;
      lifts.push({ key: liftKey(i, j), a: i, b: j, x: x + 0.5 + dx * 0.5, y: y + 0.5 + dy * 0.5, dx, dy, low: Math.min(a, b) * TIER, high: Math.max(a, b) * TIER });
    }
  }
  H.lifts = lifts;
}

/** The key of the lift between cells i and j. */
export const liftKey = (i, j) => (i < j ? `${i}:${j}` : `${j}:${i}`);

/** The sky's heights: the land's within AIR_REACH, averaged (two passes of a box sum); 0 far out. */
function blurAir(t) {
  const H = HEIGHTS, R = AIR_REACH;
  const sum = new Float32Array(N), count = new Float32Array(N), sum2 = new Float32Array(N), count2 = new Float32Array(N);
  for (let y = 0; y < WORLD; y++) {
    let s = 0, c = 0;
    const row = y * WORLD;
    for (let x = -R; x < WORLD; x++) {
      const add = x + R, drop = x - R - 1;
      if (add < WORLD && isLand(t[row + add])) { s += levelOf(row + add) * TIER; c++; }
      if (drop >= 0 && isLand(t[row + drop])) { s -= levelOf(row + drop) * TIER; c--; }
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

/** The sky's height at a point, smoothly between cells. */
function airAt(x, y) {
  const H = HEIGHTS, fx = x - 0.5, fy = y - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), kx = fx - x0, ky = fy - y0;
  const at = (cx, cy) => (cx < 0 || cy < 0 || cx >= WORLD || cy >= WORLD ? 0 : H.air[cy * WORLD + cx]);
  return (at(x0, y0) * (1 - kx) + at(x0 + 1, y0) * kx) * (1 - ky) + (at(x0, y0 + 1) * (1 - kx) + at(x0 + 1, y0 + 1) * kx) * ky;
}

/** The cell's terrain at world cell (x, y), or -1 off the map. */
function terrainAt(x, y) {
  const cx = Math.floor(x), cy = Math.floor(y);
  return cx < 0 || cy < 0 || cx >= WORLD || cy >= WORLD || !G.view ? -1 : G.view.terrain[cy * WORLD + cx];
}

/**
 * The ground's height at a point in world cells (x, y): its island's or bridge's level, or over
 * the sky the height of the land round about. 0 on a level map.
 */
export function groundAt(x, y) {
  if (!HEIGHTS.on) return 0;
  const t = terrainAt(x, y);
  if (isLand(t) || isBridge(t)) return levelOf(Math.floor(y) * WORLD + Math.floor(x)) * TIER;
  return airAt(x, y);
}

/** Where something is laid at a point: on the ground there, or over the sky on the level chosen. */
export function placeAt(x, y) {
  if (!HEIGHTS.on) return 0;
  const t = terrainAt(x, y);
  return isLand(t) || isBridge(t) ? groundAt(x, y) : HEIGHTS.active * TIER;
}

/**
 * What a click meets at a point: the ground's height; over the sky either the level chosen
 * (`sky`) or nothing (-Infinity), the ray going on through.
 */
export function surfaceAt(x, y, sky) {
  const t = terrainAt(x, y);
  if (isLand(t) || isBridge(t)) return levelOf(Math.floor(y) * WORLD + Math.floor(x)) * TIER;
  return sky ? HEIGHTS.active * TIER : -Infinity;
}

/** The height of a cell's ground as the world has it, even if it has just fallen out of the sky. */
export function heightOfCell(x, y) {
  if (!HEIGHTS.on || x < 0 || y < 0 || x >= WORLD || y >= WORLD) return 0;
  return levelOf(y * WORLD + x) * TIER;
}

/** The height that what flies keeps to over a point: the land's round about, never below the ground under it. */
export function flyAt(x, y) {
  if (!HEIGHTS.on) return 0;
  return Math.max(airAt(x, y), groundAt(x, y));
}

/** Move the level bridges are laid on by `step` (-1 down, 1 up); false if there is none that way. */
export function shiftLevel(step) {
  const next = Math.max(-1, Math.min(1, HEIGHTS.active + step));
  if (!HEIGHTS.on || next === HEIGHTS.active) return false;
  HEIGHTS.active = next;
  return true;
}

/**
 * A walker's ride on a lift, if its next step is one: { key, from, to (heights), share (0 to 1 of
 * the step) }; else null.
 */
export function rideOf(e, share) {
  const next = e.path?.[0];
  if (!HEIGHTS.on || !next || !G.world) return null;
  const i = e.y * WORLD + e.x, j = next[1] * WORLD + next[0], a = levelOf(i), b = levelOf(j);
  if (a === b) return null;
  return { key: liftKey(i, j), from: a * TIER, to: b * TIER, share };
}
