/**
 * The Combahee River Raid (netstorm-3d): the map, and the setting out of its two battles. See
 * rules/raid.ts for the rules. Laid into netstorm-web's simulation as raid-map.ts by
 * scripts/house-rules.mjs; the client starts a battle with createRaid.
 *
 * The map is the lower Combahee as a river of sky: from its mouth in the east, by Field's Point and
 * Tar Bluff, up past the Nichols, Middleton, Lowndes and Heyward plantations to Combahee Ferry in
 * the west, where a pontoon bridge crosses it. The plantations are islands on its banks, joined
 * along each bank by causeways (the dikes of the rice fields). The names are those of the raid's
 * accounts; the shapes, distances and numbers are the game's.
 */
import { DAY_SECONDS, NIGHT_SECONDS, RESIDENCE_FOOT, World } from './world.js';
import { Terrain, TPS, W, H } from './state.js';
import type { DefTable } from './defs.js';
import {
  DEEP,
  RIVER,
  type Boat,
  type Landing,
  type Quarters,
  type Raid,
  type RaidMission,
  type Torpedo,
} from './rules/raid.js';

export type RaidLevel = 'easy' | 'normal' | 'hard';

/** The raid's sides: the player's, and the Confederates'. */
export const RAID_ME = 1;
export const RAID_ENEMY = 2;

/** The river, from its mouth to the ferry: the cells within HALF of this line are sky, those within
 * DEEP_HALF deep enough for a boat. */
const RIVER_LINE: readonly [number, number][] = [
  [200, 151], [182, 147], [163, 141], [145, 136], [127, 130], [109, 123], [93, 118], [77, 114], [58, 111],
];
const HALF = 4.5;
const DEEP_HALF = 2.6;

/** An island of a bank: from x0 to x1 along the river, reaching `depth` cells inland from its bank
 * (south of the river, side 1; north of it, -1); `grain` turns its rim. */
interface IslandSpec { name: string; side: 1 | -1; x0: number; x1: number; depth: number; owner: number; grain: number; }

/** The islands, east to west: the south bank's, then the north bank's. */
export const ISLANDS: readonly IslandSpec[] = [
  { name: "Field's Point", side: 1, x0: 177, x1: 203, depth: 13, owner: RAID_ME, grain: 1 },
  { name: 'Nichols', side: 1, x0: 150, x1: 174, depth: 16, owner: RAID_ENEMY, grain: 2 },
  { name: 'Middleton', side: 1, x0: 122, x1: 147, depth: 16, owner: RAID_ENEMY, grain: 3 },
  { name: 'Newport', side: 1, x0: 101, x1: 119, depth: 11, owner: RAID_ENEMY, grain: 4 },
  { name: 'Combahee Ferry, south', side: 1, x0: 63, x1: 98, depth: 13, owner: RAID_ENEMY, grain: 5 },
  { name: 'The cove', side: -1, x0: 193, x1: 205, depth: 8, owner: RAID_ME, grain: 6 },
  { name: 'Tar Bluff', side: -1, x0: 170, x1: 190, depth: 12, owner: RAID_ENEMY, grain: 7 },
  { name: 'Lowndes', side: -1, x0: 140, x1: 167, depth: 16, owner: RAID_ENEMY, grain: 8 },
  { name: 'Heyward', side: -1, x0: 110, x1: 137, depth: 16, owner: RAID_ENEMY, grain: 9 },
  { name: 'The causeway', side: -1, x0: 92, x1: 107, depth: 9, owner: RAID_ENEMY, grain: 10 },
  { name: 'Combahee Ferry, north', side: -1, x0: 62, x1: 89, depth: 13, owner: RAID_ENEMY, grain: 11 },
];

/** The causeways along each bank, between the islands of ISLANDS that follow each other. */
const DIKES: readonly [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10]];

/** The river's middle at x (the line runs east to west). */
export function riverY(x: number): number {
  for (let k = 0; k + 1 < RIVER_LINE.length; k++) {
    const [ax, ay] = RIVER_LINE[k]!;
    const [bx, by] = RIVER_LINE[k + 1]!;

    if (x <= ax && x >= bx) {
      return ay + ((x - ax) / (bx - ax)) * (by - ay);
    }
  }

  return x > RIVER_LINE[0]![0] ? RIVER_LINE[0]![1] : RIVER_LINE[RIVER_LINE.length - 1]![1];
}

/** Distance from (x, y) to the river's line. */
function toRiver(x: number, y: number): number {
  let best = Infinity;

  for (let k = 0; k + 1 < RIVER_LINE.length; k++) {
    const [ax, ay] = RIVER_LINE[k]!;
    const [bx, by] = RIVER_LINE[k + 1]!;
    const vx = bx - ax;
    const vy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
    const dx = x - (ax + t * vx);
    const dy = y - (ay + t * vy);
    best = Math.min(best, Math.sqrt(dx * dx + dy * dy));
  }

  return best;
}

/** An island: from the river inland, its far rim wavering, its ends rounded; `island` marks it. */
function lay(w: World, island: Int16Array, n: number, s: IslandSpec): void {
  const mid = (s.x0 + s.x1) / 2;
  const half = (s.x1 - s.x0) / 2;
  const reach = (x: number) => {
    const u = (x - mid) / half;
    const end = Math.sqrt(Math.max(0, 1 - u ** 6));
    const rim = 1 + 0.12 * Math.sin(x * 0.31 + s.grain) + 0.07 * Math.sin(x * 0.73 + s.grain * 2.3);
    return s.depth * end * rim;
  };

  for (let x = s.x0; x <= s.x1; x++) {
    const depth = Math.max(2, Math.round((reach(x - 1) + 2 * reach(x) + reach(x + 1)) / 4));
    const bank = riverY(x + 0.5) + s.side * (HALF - 1.5);

    for (let d = 0; d < depth; d++) {
      const y = Math.round(bank + s.side * d);

      if (w.inside(x, y)) {
        w.terrain[w.at(x, y)] = Terrain.Island;
        w.owner[w.at(x, y)] = s.owner;
        island[w.at(x, y)] = n;
      }
    }
  }
}

/** A causeway of bridge between two islands of a bank, two cells wide, where they come nearest. */
function dike(w: World, island: Int16Array, a: number, b: number): void {
  const A = ISLANDS[a]!;
  let best: { y: number; from: number; to: number; } | null = null;

  // A lies east of B: on each row both have ground, the gap between A's west rim and B's east rim,
  // two rows or more in from the river
  for (let y = 80; y < 180; y++) {
    let west = -1;
    let east = -1;

    for (let x = A.x0 - 12; x <= A.x0 + 2; x++) {
      if (island[w.at(x, y)] === a && island[w.at(x, y + 1)] === a && west < 0) {
        west = x;
      }

      if (island[w.at(x, y)] === b && island[w.at(x, y + 1)] === b) {
        east = x;
      }
    }

    const inland = Math.min(toRiver(east, y), toRiver(west, y));

    if (west > east && east >= 0 && inland >= HALF + 2 && (!best || west - east < best.to - best.from)) {
      best = { y, from: east, to: west };
    }
  }

  if (!best || best.to - best.from <= 1) {
    return;
  }

  for (let x = best.from + 1; x < best.to; x++) {
    for (const y of [best.y, best.y + 1]) {
      const i = w.at(x, y);

      if (w.terrain[i] === Terrain.Sky) {
        w.terrain[i] = Terrain.HardBridge;
        w.links[i] = EAST_WEST;
        w.owner[i] = 0;
      }
    }
  }
}

/** The islands' rims made even: a cell of ground with one neighbour of its island or none goes, a
 * cell of sky with three or more of one island's around it is filled. */
function tidy(w: World, island: Int16Array): void {
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 82; y < 178; y++) {
      for (let x = 42; x < 218; x++) {
        const i = w.at(x, y);
        const around = [w.at(x + 1, y), w.at(x - 1, y), w.at(x, y + 1), w.at(x, y - 1)].map((j) => island[j]!);

        if (island[i]! >= 0 && around.filter((n) => n === island[i]).length <= 1) {
          w.terrain[i] = Terrain.Sky;
          w.owner[i] = 0;
          island[i] = -1;
        } else if (island[i] === -1) {
          const n = around.find((k) => k >= 0 && around.filter((m) => m === k).length >= 3);

          if (n !== undefined) {
            w.terrain[i] = Terrain.Island;
            w.owner[i] = ISLANDS[n]!.owner;
            island[i] = n;
          }
        }
      }
    }
  }
}

/** Bridge link masks, bits as in DIRS (north, east, south, west). */
const EAST_WEST = 10;
const NORTH_SOUTH = 5;

/** The ground of the river and its banks, as both battles have it; the pontoon bridge's cells. */
function layLand(w: World): { island: Int16Array; pontoon: [number, number][]; } {
  const island = new Int16Array(W * H).fill(-1);
  ISLANDS.forEach((s, n) => lay(w, island, n, s));
  tidy(w, island);

  // the river cuts through whatever ground lies on it
  for (let y = 80; y < 180; y++) {
    for (let x = 40; x < 220; x++) {
      if (toRiver(x + 0.5, y + 0.5) <= HALF) {
        w.terrain[w.at(x, y)] = Terrain.Sky;
        w.owner[w.at(x, y)] = 0;
        island[w.at(x, y)] = -1;
      }
    }
  }

  for (const [a, b] of DIKES) {
    dike(w, island, a, b);
  }

  // the pontoon bridge: two cells wide across the river, from the ferry's north bank to its south
  const pontoon: [number, number][] = [];
  const north = ISLANDS.findIndex((s) => s.name === 'Combahee Ferry, north');
  const south = ISLANDS.findIndex((s) => s.name === 'Combahee Ferry, south');

  for (const x of [PONTOON_X, PONTOON_X + 1]) {
    let top = -1;
    let bottom = -1;

    for (let y = 80; y < 180; y++) {
      if (island[w.at(x, y)] === north) {
        top = y;
      }

      if (island[w.at(x, y)] === south && bottom < 0) {
        bottom = y;
      }
    }

    for (let y = top + 1; y < bottom; y++) {
      const i = w.at(x, y);
      w.terrain[i] = Terrain.HardBridge;
      w.links[i] = NORTH_SOUTH;
      w.owner[i] = RAID_ENEMY;
      pontoon.push([x, y]);
    }
  }

  return { island, pontoon };
}

/** The pontoon bridge's west column. */
const PONTOON_X = 72;

/** An ASCII picture of the map's middle (for working on it): river ~, deep river =, ground #, the
 * player's ground o, bridge +. */
export function raidPicture(w: World): string {
  const rows: string[] = [];

  for (let y = 86; y < 172; y++) {
    let row = '';

    for (let x = 54; x < 214; x++) {
      const i = w.at(x, y);
      const t = w.terrain[i];
      const deep = w.raid?.river[i] === DEEP;
      const occupied = w.occupant[i] !== 0;
      row += occupied ? 'B' : t === Terrain.Sky ? (deep ? '=' : w.raid?.river[i] === RIVER ? '~' : ' ')
        : t === Terrain.Island ? (w.owner[i] === RAID_ME ? 'o' : '#') : '+';
    }

    rows.push(`${String(y).padStart(3)} ${row}`);
  }

  return rows.join('\n');
}

/** The y of the cell `d` rows inland from the bank at column x, on a side of the river. */
function inland(x: number, side: 1 | -1, d: number): number {
  return Math.round(riverY(x + 0.5) + side * (HALF + 0.5 + d));
}

/** The plantations' quarters: on which bank, at which column, and how many live there. The numbers
 * add up to the count of the people the raid freed that the historian Edda L. Fields-Black gives
 * (756); how they were spread over the plantations is the game's. */
const QUARTERS: readonly { name: string; side: 1 | -1; x: number; people: number; landing: number; }[] = [
  { name: 'Nichols', side: 1, x: 160, people: 180, landing: 1 },
  { name: 'Middleton', side: 1, x: 133, people: 210, landing: 2 },
  { name: 'Lowndes', side: -1, x: 153, people: 214, landing: 3 },
  { name: 'Heyward', side: -1, x: 122, people: 152, landing: 4 },
];

/** The landings of the raid: on which bank, at which column, whether a creek parts them from their
 * plantation (a bridge has to be laid for the people to reach it). */
const LANDINGS: readonly { name: string; side: 1 | -1; x: number; parted: boolean; ferry?: boolean; mouth?: boolean; }[] = [
  { name: "Field's Point", side: 1, x: 185, parted: false, mouth: true },
  { name: 'Nichols landing', side: 1, x: 157, parted: false },
  { name: 'Middleton landing', side: 1, x: 130, parted: true },
  { name: 'Lowndes landing', side: -1, x: 150, parted: false },
  { name: 'Heyward landing', side: -1, x: 120, parted: true },
  { name: 'Combahee Ferry', side: 1, x: 77, parted: false, ferry: true },
];
const LANDING_W = 4;

/** The torpedoes: at which column of the river, a cell off its middle, and which quarters know. */
const TORPEDOES: readonly [x: number, off: number, quarters: number][] = [
  [182, 1, 0], [168, -1, 0], [152, 1, 1], [139, -1, 2], [120, 1, 2], [100, -1, 3],
];

/** Guns at the scouting: the pickets, on which bank, at which column, how far inland; at which
 * levels. */
const PICKETS: readonly [side: 1 | -1, x: number, d: number, levels: string][] = [
  [1, 151, 4, 'easy normal hard'],
  [1, 126, 10, 'normal hard'],
  [1, 108, 3, 'hard'],
  [-1, 75, 3, 'easy normal hard'],
  [-1, 131, 4, 'normal hard'],
  [-1, 145, 10, 'easy normal hard'],
  [-1, 180, 3, 'easy normal hard'],
];

/** At the raid: the pickets left (the one at the pontoon bridge among them), and the rice mills. */
const RAID_PICKETS: readonly [side: 1 | -1, x: number, d: number][] = [[1, 126, 5], [-1, 75, 3], [-1, 144, 5]];
const MILLS: readonly [side: 1 | -1, x: number, d: number][] = [[1, 166, 4], [-1, 160, 4], [-1, 115, 4]];

/** Of each level: the night of the scouting (minutes of play, and how much shorter the guns reach
 * in it); of the raid, the people to bring aboard, the minutes from dawn to the end, the seconds
 * from dawn to the battery's coming. */
const LEVELS: Record<RaidLevel, { night: number; dark: number; target: number; morning: number; battery: number; }> = {
  easy: { night: 10, dark: 0.5, target: 450, morning: 9, battery: 150 },
  normal: { night: 8.5, dark: 0.4, target: 600, morning: 7.5, battery: 75 },
  hard: { night: 7.5, dark: 0.3, target: 700, morning: 6.5, battery: 30 },
};

/** Minutes of play from the raid's start to dawn. */
const RAID_NIGHT = 4.5;
/** Seconds of the night already gone when each battle begins. */
const SCOUT_LATE = 3;
const RAID_LATE = 60;

/** A building of a side, standing on whatever ground is there (it makes ground where there is none). */
function stand(w: World, type: string, owner: number, x: number, y: number): void {
  const def = w.def(type);

  for (let cy = y; cy < y + def.footY; cy++) {
    for (let cx = x; cx < x + def.footX; cx++) {
      if (w.terrain[w.at(cx, cy)] === Terrain.Sky) {
        w.terrain[w.at(cx, cy)] = Terrain.Island;
        w.owner[w.at(cx, cy)] = owner;
      }
    }
  }

  const b = w.spawnBuilding(type, owner, x, y, 0);
  b.rising = 0;
  b.hp = b.hpMax;
}

/** The deep cell of the river nearest (x, y). */
function deepNear(river: Uint8Array, x: number, y: number): [number, number] {
  let best: [number, number] = [x, y];
  let d = Infinity;

  for (let cy = y - 8; cy <= y + 8; cy++) {
    for (let cx = x - 8; cx <= x + 8; cx++) {
      const e = (cx - x) ** 2 + (cy - y) ** 2;

      if (river[cy * W + cx] === DEEP && e < d) {
        d = e;
        best = [cx, cy];
      }
    }
  }

  return best;
}

/**
 * The world of a battle of the raid. `known`: the torpedoes found at the scouting, by id; at the
 * raid those are marked, the rest are there unmarked.
 */
export function createRaid(defs: DefTable, mission: RaidMission, level: RaidLevel = 'normal', known: number[] = []): World {
  const w = new World(defs, RAID_SEED);
  const L = LEVELS[level] ?? LEVELS.normal;
  w.addPlayer(RAID_ME, 'Union', 'rain', 0, [], [], 0, 1, false);
  w.addPlayer(RAID_ENEMY, 'Confederate', 'sun', 0, [], [], 0, 1, false);
  const { island, pontoon } = layLand(w);
  const raid = mission === 'raid';

  // the landings: islets of the player's in the river's shallows, by their plantation's bank or
  // parted from it by a creek two cells wide
  const landings: Landing[] = [];

  if (raid) {
    for (const [id, spec] of LANDINGS.entries()) {
      // the rows of the shallows at the landing's middle column, two at the least, for all its columns
      const mx = spec.x + (LANDING_W >> 1);
      const rows: number[] = [];

      for (let y = 80; y < 180; y++) {
        const d = toRiver(mx + 0.5, y + 0.5);

        if (Math.sign(y + 0.5 - riverY(mx + 0.5)) === spec.side && d > DEEP_HALF + 0.4 && d <= HALF + 0.5) {
          rows.push(y);
        }
      }

      if (rows.length < 2) {
        rows.push(spec.side > 0 ? Math.max(...rows) + 1 : Math.min(...rows) - 1);
      }

      for (let x = spec.x; x < spec.x + LANDING_W; x++) {
        for (const y of rows) {
          w.terrain[w.at(x, y)] = Terrain.Island;
          w.owner[w.at(x, y)] = RAID_ME;
          island[w.at(x, y)] = -1;
        }

      }

      // the creek about a parted landing, two cells wide, on all its sides but the river's
      if (spec.parted) {
        const near = spec.side > 0 ? Math.min(...rows) : Math.max(...rows);
        const far = (spec.side > 0 ? Math.max(...rows) : Math.min(...rows)) + spec.side * 2;

        for (let y = Math.min(near, far); y <= Math.max(near, far); y++) {
          for (let x = spec.x - 2; x < spec.x + LANDING_W + 2; x++) {
            const i = w.at(x, y);

            if (!(x >= spec.x && x < spec.x + LANDING_W && rows.includes(y)) && w.terrain[i] === Terrain.Island) {
              w.terrain[i] = Terrain.Sky;
              w.owner[i] = 0;
              island[i] = -1;
            }
          }
        }
      }

      const y0 = Math.min(...rows);
      const y1 = Math.max(...rows);
      landings.push({
        id,
        name: spec.name,
        x: spec.x,
        y: y0,
        w: LANDING_W,
        h: y1 - y0 + 1,
        dock: [0, 0],
        crowd: 0,
        boarding: 0,
        ferry: spec.ferry ?? false,
        mouth: spec.mouth ?? false,
      });
    }
  }

  // the river: its cells of sky, and the deep water in them
  const river = new Uint8Array(W * H);

  for (let y = 80; y < 180; y++) {
    for (let x = 40; x < 220; x++) {
      const d = toRiver(x + 0.5, y + 0.5);

      if (d <= HALF && w.terrain[w.at(x, y)] === Terrain.Sky) {
        river[w.at(x, y)] = d <= DEEP_HALF ? DEEP : RIVER;
      }
    }
  }

  for (const l of landings) {
    l.dock = deepNear(river, l.x + (l.w >> 1), l.y + (l.h >> 1));
  }

  // the quarters
  const quarters: Quarters[] = QUARTERS.map((q, id) => {
    const y0 = q.side > 0 ? inland(q.x, 1, 6) : inland(q.x, -1, 6) - (RESIDENCE_FOOT - 1);
    w.residences.push([q.x, y0]);
    const door: [number, number] = [q.x + (RESIDENCE_FOOT >> 1), q.side > 0 ? y0 - 1 : y0 + RESIDENCE_FOOT];
    return {
      id,
      name: q.name,
      x: q.x,
      y: y0,
      door,
      people: q.people,
      left: q.people,
      called: false,
      visited: false,
      landing: q.landing,
      next: 0,
    };
  });

  // the torpedoes
  const torpedoes: Torpedo[] = TORPEDOES.map(([x, off, q], id) => ({
    id,
    x,
    y: Math.round(riverY(x + 0.5) - 0.5) + off,
    known: raid && known.includes(id),
    spent: false,
    quarters: q,
  }));

  // the Confederates' guns, and at the raid the rice mills
  if (raid) {
    for (const [side, x, d] of RAID_PICKETS) {
      stand(w, 'sunarcher', RAID_ENEMY, x, side > 0 ? inland(x, 1, d) : inland(x, -1, d) - 2);
    }

    for (const [side, x, d] of MILLS) {
      stand(w, 'sunbattery', RAID_ENEMY, x, side > 0 ? inland(x, 1, d) : inland(x, -1, d) - 2);
    }
  } else {
    for (const [side, x, d, levels] of PICKETS) {
      if (levels.split(' ').includes(level)) {
        stand(w, 'sunarcher', RAID_ENEMY, x, side > 0 ? inland(x, 1, d) : inland(x, -1, d) - 2);
      }
    }
  }

  // her, on Field's Point
  const tubman = w.addPriest(RAID_ME, 191, inland(191, 1, 5));

  // the boats: at the raid the gunboats at the mouth, and the Sentinel aground; at the scouting,
  // her scouts' boat in the cove
  const boats = new Map<number, Boat>();
  const boat = (type: string, name: string, x: number, y: number, capacity: number, aground: boolean) => {
    const [bx, by] = deepNear(river, x, y);
    const t = w.spawnTransport(type, RAID_ME, bx, by);
    t.aloft = true;
    boats.set(t.id, { id: t.id, name, capacity, aboard: 0, aground, shell: 0 });
  };

  if (raid) {
    const mouth = landings.find((l) => l.mouth)!;
    boat('windballoon', 'John Adams', mouth.dock[0] - 2, mouth.dock[1], 480, false);
    boat('rainballoon', 'Harriet A. Weed', mouth.dock[0] + 5, mouth.dock[1] + 1, 300, false);
    boat('sunballoon', 'Sentinel', 199, Math.round(riverY(199.5)), 0, true);
  } else {
    boat('sunballoon', "The scouts' boat", 199, Math.round(riverY(199.5)) - 2, 0, true);
  }

  // the cove where her scouts wait: the cove's island
  const coveOf = ISLANDS.findIndex((x) => x.name === 'The cove');
  let cx0 = W;
  let cy0 = H;
  let cx1 = 0;
  let cy1 = 0;

  for (let i = 0; i < W * H; i++) {
    if (island[i] === coveOf) {
      cx0 = Math.min(cx0, i % W);
      cx1 = Math.max(cx1, i % W);
      cy0 = Math.min(cy0, Math.floor(i / W));
      cy1 = Math.max(cy1, Math.floor(i / W));
    }
  }

  // the clock: a night under a new moon at the scouting, the night of the full moon of June 1,
  // 1863 at the raid, its hours passing at a pace of their own
  const minutes = raid ? RAID_NIGHT : L.night;
  const late = raid ? RAID_LATE : SCOUT_LATE;
  const dawn = Math.round(minutes * 60 * TPS);
  w.nights = true;
  w.nightShare = raid ? 0.25 : L.dark;

  w.raid = {
    mission,
    me: RAID_ME,
    enemy: RAID_ENEMY,
    clock0: DAY_SECONDS + late,
    rate: (NIGHT_SECONDS - late) / (minutes * 60),
    moon: raid ? FULL_MOON : NEW_MOON,
    dawn,
    noon: raid ? dawn + Math.round(L.morning * 60 * TPS) : dawn,
    river,
    quarters,
    landings,
    families: [],
    torpedoes,
    boats,
    tubman: tubman.id,
    disguise: { until: 0, ready: 0 },
    singing: -1,
    signs: new Set<number>(),
    cove: { x: cx0, y: cy0, w: cx1 - cx0 + 1, h: cy1 - cy0 + 1 },
    pontoon: { cells: pontoon, burning: 0, burned: false },
    battery: {
      due: dawn + L.battery * TPS,
      site: [BATTERY_X, inland(BATTERY_X + 3, -1, 6) - 2],
      came: false,
      held: false,
      guns: [],
    },
    target: L.target,
    freed: 0,
    verdict: null,
    ways: [],
    wayTick: 0,
    nextFamily: 1,
  } satisfies Raid;

  w.invalidateTerrain();
  return w;
}

/** The moon's phases, as MOON_PHASES numbers them. */
const NEW_MOON = 0;
const FULL_MOON = 2;
/** Where the Confederate battery sets up its guns, on the ferry's north bank. */
const BATTERY_X = 66;

/** The raid's world is always made from the same seed: one map. */
export const RAID_SEED = 1863;
