/**
 * Residences for a skirmish map. "Nimbians live in submerged houses below the chaos of battle. You
 * cannot move or destroy a residence. And you can't build on top of it." (the original's help).
 * The original's maps carry them, and netstorm-web's mission maps place theirs; its random
 * skirmish maps have none, which leaves the islands bare. Here a few are settled on a new skirmish
 * map, into the world's own list, so the rules treat them as a mission's: nothing is built on
 * them, anyone walks over them, and they take the colours of the Fury whose Temple stands on their
 * island.
 *
 * One goes on each home island, well away from its Temple; one on each unclaimed island of some
 * size, two on a large one. Each keeps clear of geysers, buildings and the island's rim, so that it
 * blocks no Temple, no geyser and no bridge's landing. The choice follows the map's seed.
 */
import { NS } from './state.js';

const ISLAND = 1;
const FOOT = NS.RESIDENCE_FOOT;
const MIN_ISLAND = 40; // cells an island needs for a Residence
const LARGE_ISLAND = 140; // and for two
const FROM_TEMPLE = 10; // cells between a Temple's middle and a Residence's
const APART = 9; // cells between two Residences' middles

/** A small seeded random number generator (mulberry32). */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Settle Residences on world `world`'s islands; returns where they went. */
export function settleResidences(world, seed) {
  const W = NS.W, H = NS.H, terrain = world.terrain, rand = random(seed * 7919 + 17);
  const island = new Int32Array(W * H).fill(-1), islands = [];
  // the islands: cells of island ground joined side by side
  for (let start = 0; start < W * H; start++) {
    if (terrain[start] !== ISLAND || island[start] >= 0) continue;
    const id = islands.length, cells = [start];
    island[start] = id;
    for (let head = 0; head < cells.length; head++) {
      const i = cells[head], x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of NS.DIRS) {
        const nx = x + dx, ny = y + dy, j = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || terrain[j] !== ISLAND || island[j] >= 0) continue;
        island[j] = id;
        cells.push(j);
      }
    }
    islands.push(cells);
  }
  const buildings = [...world.entities.values()].filter((e) => e.kind === 'building');
  const geysers = [...world.entities.values()].filter((e) => e.kind === 'geyser');
  const temples = buildings.filter((b) => world.def(b.type).cls === 'Energy');
  const placed = [];
  const fits = (x0, y0, id) => {
    // the house and a ring of island ground around it: off the rim, where bridges land
    for (let y = y0 - 1; y <= y0 + FOOT; y++) {
      for (let x = x0 - 1; x <= x0 + FOOT; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) return false;
        const i = y * W + x;
        if (island[i] !== id || world.occupant[i] || world.priestAt(x, y)) return false;
      }
    }
    const mx = x0 + FOOT / 2, my = y0 + FOOT / 2;
    if (temples.some((t) => Math.hypot(t.x + t.fx / 2 - mx, t.y + t.fy / 2 - my) < FROM_TEMPLE)) return false;
    if (geysers.some((g) => Math.abs(g.x + 0.5 - mx) < FOOT / 2 + 3 && Math.abs(g.y + 0.5 - my) < FOOT / 2 + 3)) return false;
    if (buildings.some((b) => b.x < x0 + FOOT + 2 && b.x + b.fx > x0 - 2 && b.y < y0 + FOOT + 2 && b.y + b.fy > y0 - 2)) return false;
    return [...world.residences, ...placed].every(([rx, ry]) => Math.hypot(rx - x0, ry - y0) >= APART);
  };
  islands.forEach((cells, id) => {
    if (cells.length < MIN_ISLAND) return;
    const home = cells.some((i) => world.owner[i]);
    const want = home ? 1 : cells.length >= LARGE_ISLAND ? 2 : 1;
    // the island's cells in an order the seed decides
    const order = cells.map((i) => [rand(), i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    let got = 0;
    for (const i of order) {
      if (got >= want) break;
      const x = i % W, y = (i / W) | 0;
      if (!fits(x, y, id)) continue;
      placed.push([x, y]);
      world.residences.push([x, y]);
      got++;
    }
  });
  return placed;
}
