/**
 * The sky cities (netstorm-3d): two maps to stroll through, with no battle in them. Laid into
 * netstorm-web's simulation as city-map.ts by scripts/house-rules.mjs; the client starts one with
 * createCity and draws what a city has of its own (src/components/ns-city.js).
 *
 * Concord, the trading city of the four Furies: the Sun's, the Rain's, the Wind's and the
 * Thunder's quarters, each with its own Temple, market square and landmark, about the Temple of
 * Concord on the island in the middle, joined to it by four bridges. Altamar, a city of white
 * houses, blue domes, terraces and hanging gardens on islands at three heights: the domed hall
 * above, the town of lanes and windmills in the middle, the harbour below, two gardens at the
 * sides, joined by bridges and their lifts. Both are the game's own: their names, shapes and
 * buildings are made up here.
 *
 * What a city has of its own is laid out here as `props` (houses, stalls, trees, fountains,
 * towers, lamps...), each over cells of its island, and `paint`, how the ground of each cell is
 * laid. The rules keep walkers off the cells a solid prop stands on (`blocked`), grow no trees of
 * their own in a city and refuse there all but walking; the clock starts in the late afternoon,
 * under a full moon by night.
 */
import { DAY_SECONDS, RESIDENCE_FOOT, World } from './world.js';
import { Terrain, W, H } from './state.js';
import type { DefTable } from './defs.js';

export type CityName = 'concord' | 'altamar';

/** How the ground of a cell is laid (0: as its island is). */
export const PAVE = {
  /** cobbles: tinted by the quarter's Fury in Concord, whitewashed in Altamar */
  street: 1,
  /** great slabs */
  plaza: 2,
  /** grass and flowers */
  garden: 3,
  /** terracotta tiles */
  terrace: 4,
  /** the harbour's stone */
  quay: 5,
  /** the compass rose about the Temple of Concord: its quarter by the bearing from the middle */
  rose: 6,
} as const;

/**
 * A thing of a city's own over cells (x, y, w, h) of its island, drawn by the client: its kind `k`,
 * the way its front faces `r` (0 north, 1 east, 2 south, 3 west), its style `s` (a Fury's, or
 * 'med' for Altamar's), a number `v` (0 to 1) for its variations; walkers keep off a `solid` one.
 */
export interface CityProp {
  k: string;
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  s: string;
  v: number;
  solid: boolean;
}

/** A sight of the city's tour: a stroller who comes within `r` cells of (x, y) has seen it. */
export interface Sight {
  name: string;
  x: number;
  y: number;
  r: number;
}

export interface City {
  name: CityName;
  title: string;
  /** 1 where a solid prop stands: no walker steps there. */
  blocked: Uint8Array;
  /** How each cell's ground is laid (PAVE). */
  paint: Uint8Array;
  props: CityProp[];
  sights: Sight[];
  /** Seconds of the day at the start (the clock's, as if the battle began in a morning). */
  clock0: number;
  /** The moon's phase by night, as MOON_PHASES numbers them. */
  moon: number;
}

/** The sides: the player (a visitor), and the Furies of Concord's other quarters, all allies. */
export const CITY_ME = 1;
const FULL_MOON = 2;
/** Late in the afternoon: a minute and a half to dusk. */
const AFTERNOON = DAY_SECONDS - 90;
const EAST_WEST = 10;
const NORTH_SOUTH = 5;

/** A number 0 to 1 for cell (x, y) and salt k, the same each time. */
export function cityHash(x: number, y: number, k: number): number {
  let h = Math.imul((x | 0) + 7919 * (y | 0) + 104729 * (k | 0), 0x27d4eb2d) ^ 0x165667b1;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The four ways, as DIRS has them: north, east, south, west. */
const WAYS: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
/** The ground a door opens onto. */
const STREETS = new Set<number>([PAVE.street, PAVE.plaza, PAVE.quay, PAVE.rose, PAVE.terrace]);

/** The city as it is laid out: the world and what is the city's own. */
class Plan {
  readonly w: World;
  readonly city: City;
  /** Cells kept free of houses: streets, squares, bridge heads, what is placed by hand. */
  readonly kept = new Uint8Array(W * H);

  constructor(w: World, name: CityName, title: string) {
    this.w = w;
    this.city = { name, title, blocked: new Uint8Array(W * H), paint: new Uint8Array(W * H), props: [], sights: [], clock0: AFTERNOON, moon: FULL_MOON };
  }

  at(x: number, y: number): number {
    return y * W + x;
  }

  land(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < W && y < H && this.w.terrain[this.at(x, y)] === Terrain.Island;
  }

  /** Island ground on `level`, owned by `owner`, wherever `inside` holds in the box. */
  island(x0: number, y0: number, x1: number, y1: number, owner: number, level: number, inside: (x: number, y: number) => boolean): void {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || !inside(x, y)) {
          continue;
        }

        const i = this.at(x, y);
        this.w.terrain[i] = Terrain.Island;
        this.w.owner[i] = owner;
        this.w.level[i] = level;
      }
    }
  }

  /**
   * A bridge `wide` cells across along a row (vertical false) or a column, over the sky between
   * (x0, y0) and (x1, y1), on `level`; its ends are kept free.
   */
  bridge(x0: number, y0: number, x1: number, y1: number, wide: number, level: number): void {
    const vertical = x0 === x1;
    const from = vertical ? Math.min(y0, y1) : Math.min(x0, x1);
    const to = vertical ? Math.max(y0, y1) : Math.max(x0, x1);

    for (let s = from; s <= to; s++) {
      for (let k = 0; k < wide; k++) {
        const x = vertical ? x0 + k - (wide >> 1) : s;
        const y = vertical ? s : y0 + k - (wide >> 1);
        const i = this.at(x, y);

        if (this.w.terrain[i] === Terrain.Sky) {
          this.w.terrain[i] = Terrain.HardBridge;
          this.w.links[i] = vertical ? NORTH_SOUTH : EAST_WEST;
          this.w.owner[i] = 0;
          this.w.level[i] = level;
        } else {
          this.keep(x, y, PAVE.street);
        }
      }
    }
  }

  /** Keep a cell free of houses, its ground laid as `paint` (if it is island ground). */
  keep(x: number, y: number, paint: number = PAVE.street): void {
    if (!this.land(x, y)) {
      return;
    }

    const i = this.at(x, y);
    this.kept[i] = 1;

    if (paint) {
      this.city.paint[i] = paint;
    }
  }

  /** Keep a rectangle free. */
  keepRect(x: number, y: number, w: number, h: number, paint: number = PAVE.street): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        this.keep(xx, yy, paint);
      }
    }
  }

  /** Whether a prop could stand on the rectangle: island ground, none of it kept or taken. */
  free(x: number, y: number, w: number, h: number, kept = true): boolean {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (!this.land(xx, yy) || this.city.blocked[this.at(xx, yy)] || (kept && this.kept[this.at(xx, yy)])) {
          return false;
        }
      }
    }

    return true;
  }

  /** A prop; a solid one blocks its cells. */
  put(k: string, x: number, y: number, w: number, h: number, r: number, s: string, solid = true, v = cityHash(x, y, 7)): CityProp {
    const p: CityProp = { k, x, y, w, h, r, s, v, solid };
    this.city.props.push(p);

    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (solid) {
          this.city.blocked[this.at(xx, yy)] = 1;
        }

        this.kept[this.at(xx, yy)] = 1;
      }
    }

    return p;
  }

  /** The way from the rectangle to the street beside it most (0 N, 1 E, 2 S, 3 W), or -1. */
  door(x: number, y: number, w: number, h: number): number {
    const street = (cx: number, cy: number) => (this.land(cx, cy) && !this.city.blocked[this.at(cx, cy)] && STREETS.has(this.city.paint[this.at(cx, cy)] ?? 0) ? 1 : 0);
    let north = 0, east = 0, south = 0, west = 0;

    for (let xx = x; xx < x + w; xx++) {
      north += street(xx, y - 1);
      south += street(xx, y + h);
    }

    for (let yy = y; yy < y + h; yy++) {
      west += street(x - 1, yy);
      east += street(x + w, yy);
    }

    const sides = [north, east, south, west];
    let best = -1, most = 0;

    sides.forEach((n, d) => {
      if (n > most) {
        best = d;
        most = n;
      }
    });

    return best;
  }

  /**
   * Houses over the island ground in the box that is not kept: from the north-west on, at each free
   * cell the first of `sizes` (in an order of the cell's own) that fits and has a street beside it,
   * its door that way; a cell where none fits is a garden, some with a tree (`tree`, solid).
   */
  settle(x0: number, y0: number, x1: number, y1: number, style: string, sizes: readonly [number, number][], tree: string, trees: number): void {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!this.free(x, y, 1, 1)) {
          continue;
        }

        const order = [...sizes].sort((a, b) => cityHash(x + a[0], y + a[1], 11) - cityHash(x + b[0], y + b[1], 11));
        let done = false;

        for (const [w, h] of order) {
          if (this.free(x, y, w, h)) {
            const r = this.door(x, y, w, h);

            if (r >= 0) {
              this.put('house', x, y, w, h, r, style);
              done = true;
              break;
            }
          }
        }

        if (!done) {
          this.city.paint[this.at(x, y)] = PAVE.garden;

          if (cityHash(x, y, 12) < trees) {
            this.put(tree, x, y, 1, 1, 0, style);
          } else {
            this.kept[this.at(x, y)] = 1;
          }
        }
      }
    }
  }

  sight(name: string, x: number, y: number, r: number): void {
    this.city.sights.push({ name, x, y, r });
  }
}

/** A blob of island: a superellipse about (cx, cy) of half-widths (rx, ry), its rim waving by `seed`. */
function blob(cx: number, cy: number, rx: number, ry: number, seed: number, p = 3): (x: number, y: number) => boolean {
  const a = [cityHash(seed, 1, 3) * 6.3, cityHash(seed, 2, 3) * 6.3, cityHash(seed, 3, 3) * 6.3];
  return (x, y) => {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
    const t = Math.atan2(dy, dx);
    const wave = 0.07 * Math.sin(3 * t + a[0]!) + 0.05 * Math.sin(5 * t + a[1]!) + 0.035 * Math.sin(8 * t + a[2]!);
    return Math.abs(dx) ** p + Math.abs(dy) ** p <= 1 + wave;
  };
}

/* ------------------------------------------ Concord ------------------------------------------ */

/** Concord's quarters: each a Fury's, out from the middle island the way `d` points (0 N .. 3 W). */
const QUARTERS = [
  { name: 'Sun', fury: 'sun', temple: 'firevortex', owner: 2, d: 1, landmark: 'sundial', ship: 'sunballoon' },
  { name: 'Rain', fury: 'rain', temple: 'rainvortex', owner: 3, d: 2, landmark: 'fountain', ship: 'rainballoon' },
  { name: 'Wind', fury: 'wind', temple: 'windvortex', owner: CITY_ME, d: 3, landmark: 'windtower', ship: 'windballoon' },
  { name: 'Thunder', fury: 'thunder', temple: 'thundervortex', owner: 4, d: 0, landmark: 'coil', ship: '' },
] as const;

/** Concord's middle, and how far out each quarter begins and how long and wide it is. */
const MID = 128;
const MID_R = 12.5;
const QUARTER_AT = 24;
const QUARTER_LONG = 37;
const QUARTER_HALF = 15;

function concord(w: World): City {
  const plan = new Plan(w, 'concord', 'Concord, city of the four Furies');
  const { city } = plan;

  // the middle: a round island, the Temple of Concord on a compass rose
  plan.island(MID - 14, MID - 14, MID + 14, MID + 14, 0, 0, blob(MID, MID, MID_R, MID_R, 5, 2));

  for (let y = MID - 14; y <= MID + 14; y++) {
    for (let x = MID - 14; x <= MID + 14; x++) {
      const r = Math.hypot(x + 0.5 - MID, y + 0.5 - MID);
      plan.keep(x, y, r <= 9 ? PAVE.rose : PAVE.plaza);
    }
  }

  plan.put('concord', MID - 3, MID - 3, 7, 7, 2, 'concord');

  // the quarters
  for (const q of QUARTERS) {
    const [ux, uy] = WAYS[q.d]!;
    // across the quarter: the way that is to the right, looking out
    const vx = -uy, vy = ux;
    /** The cell u out from where the quarter begins, v to the right. */
    const cell = (u: number, v: number): [number, number] => [MID + ux * (QUARTER_AT + u) + vx * v, MID + uy * (QUARTER_AT + u) + vy * v];
    /** A rectangle of the quarter's (u0..u1, v0..v1) as cells: x, y, w, h. */
    const rect = (u0: number, v0: number, u1: number, v1: number): [number, number, number, number] => {
      const [ax, ay] = cell(u0, v0), [bx, by] = cell(u1, v1);
      return [Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax) + 1, Math.abs(by - ay) + 1];
    };
    /** The way a front faces, turned from the quarter's (0 out, 1 right, 2 in, 3 left) to the map's. */
    const facing = (f: number) => (q.d + f) % 4;

    const [cx, cy] = cell(Math.floor(QUARTER_LONG / 2), 0);
    const rx = ux ? QUARTER_LONG / 2 + 0.5 : QUARTER_HALF + 0.5, ry = uy ? QUARTER_LONG / 2 + 0.5 : QUARTER_HALF + 0.5;
    plan.island(cx - 22, cy - 22, cx + 22, cy + 22, q.owner, 0, blob(cx + 0.5, cy + 0.5, rx, ry, 20 + q.d, 3.2));

    // the bridge from the middle: three cells wide
    const [ax, ay] = cell(-QUARTER_AT + Math.floor(MID_R) - 1, 0), [bx, by] = cell(1, 0);
    plan.bridge(ax, ay, bx, by, 3, 0);

    // the avenue out through the quarter, two cross streets, the market square, the Temple's plaza
    plan.keepRect(...rect(0, -1, QUARTER_LONG, 1));
    plan.keepRect(...rect(9, -QUARTER_HALF - 1, 10, QUARTER_HALF + 1));
    plan.keepRect(...rect(23, -QUARTER_HALF - 1, 24, QUARTER_HALF + 1));
    plan.keepRect(...rect(11, -5, 22, 5), PAVE.plaza);
    plan.keepRect(...rect(26, -6, 35, 6), PAVE.plaza);

    // the quarter's Temple, at the avenue's end
    const def = w.def(q.temple);
    const [tx, ty] = cell(30.5, 0);
    const temple = w.spawnBuilding(q.temple, q.owner, Math.round(tx - def.footX / 2), Math.round(ty - def.footY / 2), 0);
    temple.rising = 0;
    temple.hp = temple.hpMax;

    for (let yy = temple.y - 1; yy < temple.y + temple.fy + 1; yy++) {
      for (let xx = temple.x - 1; xx < temple.x + temple.fx + 1; xx++) {
        plan.keep(xx, yy, PAVE.plaza);
      }
    }

    // the market square: its landmark in the middle, stalls along its sides, a tree in each corner
    const [lx, ly] = cell(16.5, 0);
    const big = q.landmark === 'fountain' ? 4 : 3;
    plan.put(q.landmark, Math.round(lx - big / 2), Math.round(ly - big / 2), big, big, facing(2), q.fury);

    for (const side of [-1, 1]) {
      for (const u of [13, 16, 19]) {
        const [sx, sy, sw, sh] = rect(u, side * 5, u + 1, side * 5);
        plan.put('stall', sx, sy, sw, sh, facing(side > 0 ? 3 : 1), q.fury);
      }
    }

    for (const [u, v] of [[11, -5], [22, -5], [11, 5], [22, 5]] as const) {
      const [sx, sy] = cell(u, v);
      plan.put('planter', sx, sy, 1, 1, 0, q.fury);
    }

    // lamps down the avenue, either side
    for (let u = 2; u < 9; u += 3) {
      for (const v of [-1, 1]) {
        const [sx, sy] = cell(u, v);
        plan.put('lamp', sx, sy, 1, 1, facing(v > 0 ? 3 : 1), q.fury);
      }
    }

    // two of the Fury's own Residences by the avenue's start
    for (const v0 of [2, -6]) {
      const [rx0, ry0, rw, rh] = rect(2, v0, 5, v0 + 3);

      if (plan.free(rx0, ry0, rw, rh)) {
        w.residences.push([rx0, ry0]);

        for (let yy = ry0; yy < ry0 + RESIDENCE_FOOT; yy++) {
          for (let xx = rx0; xx < rx0 + RESIDENCE_FOOT; xx++) {
            plan.kept[plan.at(xx, yy)] = 1;
            const inner = xx > rx0 && xx < rx0 + RESIDENCE_FOOT - 1 && yy > ry0 && yy < ry0 + RESIDENCE_FOOT - 1;
            city.blocked[plan.at(xx, yy)] = inner ? 1 : 0;
            city.paint[plan.at(xx, yy)] = inner ? 0 : PAVE.garden;
          }
        }
      }
    }

    // a dock at the end of the far cross street, on the right, and the Fury's airship by it
    let edge = QUARTER_HALF;

    while (edge > 0 && !plan.land(...cell(23, edge))) {
      edge--;
    }

    const [dx, dy] = cell(23, edge + 1);
    const [ex, ey] = cell(24, edge + 1);
    plan.put('dock', Math.min(dx, ex), Math.min(dy, ey), Math.abs(ex - dx) + 1, Math.abs(ey - dy) + 1, facing(1), q.fury, false);

    if (q.ship) {
      const [shx, shy] = cell(23.5, edge + 6);
      const t = w.spawnTransport(q.ship, q.owner, Math.round(shx), Math.round(shy));
      t.aloft = true;
    }

    // the houses, in the Fury's style; where none fits, gardens and trees
    plan.settle(cx - 22, cy - 22, cx + 22, cy + 22, q.fury, [[3, 3], [3, 2], [2, 3], [4, 3], [3, 4], [2, 2], [4, 2], [2, 4]], 'tree', 0.22);

    plan.sight(`The ${q.name} quarter's market`, lx, ly, 5.5);
  }

  // stalls of all four Furies on the rose's rim, each facing the Temple, a spire of the Fury's within,
  // and planters and lamps round the island's rim
  for (const [k, q] of QUARTERS.entries()) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const sx = Math.round(MID + Math.cos(a) * 9.5 - 1), sy = Math.round(MID + Math.sin(a) * 9.5 - 1);
    plan.put('stall', sx, sy, 2, 2, (k + 3) % 4, q.fury);
    const [lx, ly] = [Math.round(MID + Math.cos(a) * 6.5), Math.round(MID + Math.sin(a) * 6.5)];
    plan.put('spire', lx, ly, 1, 1, 0, q.fury);
  }

  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2 + 0.13;
    const x = Math.round(MID - 0.5 + Math.cos(a) * 11.5), y = Math.round(MID - 0.5 + Math.sin(a) * 11.5);

    // not across a bridge's head
    if (Math.abs(x - MID) <= 2 || Math.abs(y - MID) <= 2 || !plan.land(x, y) || city.blocked[plan.at(x, y)]) {
      continue;
    }

    plan.put(k % 3 ? 'planter' : 'lamp', x, y, 1, 1, 0, 'concord');
  }

  plan.sight('The Temple of Concord', MID, MID, 6);

  // the visitor's Priest, on the rose south of the Temple
  w.addPriest(CITY_ME, MID, MID + 6);
  return city;
}

/* ------------------------------------------ Altamar ------------------------------------------ */

function altamar(w: World): City {
  const plan = new Plan(w, 'altamar', 'Altamar, the terraced city');
  const { city } = plan;
  const sizes: readonly [number, number][] = [[2, 2], [3, 2], [2, 3], [3, 3], [2, 2], [4, 2]];

  // the town, on the middle level
  const tx = 128, ty = 128;
  plan.island(tx - 30, ty - 16, tx + 30, ty + 16, CITY_ME, 0, blob(tx, ty, 27, 13.5, 41, 3));
  // its lanes: one along its length, five across, and the square with the fountain
  plan.keepRect(tx - 30, ty - 1, 61, 2);

  for (const x of [tx - 19, tx - 9, tx + 8, tx + 18]) {
    plan.keepRect(x, ty - 16, 2, 33);
  }

  plan.keepRect(tx - 1, ty - 16, 2, 33);
  plan.keepRect(tx - 7, ty - 5, 14, 11, PAVE.plaza);
  plan.put('fountain', tx - 2, ty - 2, 4, 4, 2, 'med');

  for (const [x, y] of [[tx - 7, ty - 5], [tx + 6, ty - 5], [tx - 7, ty + 5], [tx + 6, ty + 5]] as const) {
    plan.put('olive', x, y, 1, 1, 0, 'med');
  }

  for (const [x, y] of [[tx - 4, ty - 5], [tx + 3, ty + 5], [tx - 4, ty + 5], [tx + 3, ty - 5]] as const) {
    plan.put('lamp', x, y, 1, 1, 0, 'med');
  }

  // the windmills on the town's west end, by its rim
  const mills: [number, number][] = [];

  for (const y of [ty - 9, ty - 4, ty + 3]) {
    let x = tx - 30;

    while (x < tx && !plan.free(x, y, 3, 3)) {
      x++;
    }

    if (x < tx - 20) {
      plan.keepRect(x - 1, y - 1, 5, 5, PAVE.terrace);
      plan.put('windmill', x, y, 3, 3, 1, 'med');
      mills.push([x + 1, y + 1]);
    }
  }

  // the domed hall above, on gardens: its bell tower, a court before it, cypresses and olives
  const ax = 128, ay = 96;
  plan.island(ax - 20, ay - 12, ax + 20, ay + 12, CITY_ME, 1, blob(ax, ay, 17, 9.5, 43, 2.6));
  plan.keepRect(ax - 20, ay - 12, 41, 25, PAVE.garden);
  plan.keepRect(ax - 17, ay + 1, 35, 10, PAVE.plaza);
  plan.put('hall', ax - 4, ay - 6, 9, 7, 2, 'med');
  plan.keepRect(ax - 6, ay - 8, 13, 2, PAVE.garden);
  plan.put('belltower', ax + 8, ay - 4, 2, 2, 2, 'med');

  for (let x = ax - 14; x <= ax + 14; x += 2) {
    if (Math.abs(x - ax) > 7 && plan.free(x, ay + 2, 1, 1, false)) {
      plan.put('cypress', x, ay + 2, 1, 1, 0, 'med');
    }
  }

  for (const x of [ax - 10, ax + 10]) {
    plan.put('lamp', x, ay + 6, 1, 1, 0, 'med');
  }

  // the bridge down to the town, on the town's level: a lift at the hall's end
  plan.bridge(ax, ay + 8, ax, ty - 12, 2, 0);
  plan.keepRect(ax - 1, ay + 2, 2, 12, PAVE.plaza);

  // olives about the gardens, away from the hall and the court
  for (let y = ay - 12; y <= ay + 12; y++) {
    for (let x = ax - 20; x <= ax + 20; x++) {
      const i = plan.at(x, y);

      if (plan.land(x, y) && !city.blocked[i] && city.paint[i] === PAVE.garden && cityHash(x, y, 31) < 0.14 && (Math.abs(x - ax) > 6 || y < ay - 9)) {
        plan.put('olive', x, y, 1, 1, 0, 'med');
      }
    }
  }

  // the harbour below, its quay along the south, warehouses, stalls and piers
  const hx = 128, hy = 160;
  plan.island(hx - 28, hy - 10, hx + 28, hy + 10, CITY_ME, -1, blob(hx, hy, 25, 7.5, 47, 3.4));
  plan.keepRect(hx - 28, hy + 1, 57, 10, PAVE.quay);
  plan.keepRect(hx - 28, hy - 2, 57, 3, PAVE.street);
  // the bridge up from the harbour, on the harbour's level: a lift at the town's end
  plan.bridge(hx, hy - 6, hx, ty + 12, 2, -1);
  plan.keepRect(hx - 1, hy - 8, 2, 8, PAVE.street);

  for (let x = hx - 22; x <= hx + 16; x += 8) {
    if (plan.free(x, hy - 7, 6, 4)) {
      plan.put('warehouse', x, hy - 7, 6, 4, 2, 'med');
    }
  }

  for (let x = hx - 20; x <= hx + 18; x += 5) {
    if (Math.abs(x - hx) > 2 && plan.free(x, hy + 2, 2, 1, false)) {
      plan.put('stall', x, hy + 2, 2, 1, 2, 'med');
    }
  }

  for (let x = hx - 23; x <= hx + 22; x += 9) {
    if (Math.abs(x - hx) > 3 && plan.free(x, hy + 4, 1, 1, false)) {
      plan.put('crates', x, hy + 4, 1, 1, 0, 'med');
    }
  }

  const piers: number[] = [hx - 16, hx, hx + 16];

  for (const x of piers) {
    let y = hy + 10;

    while (y > hy && !plan.land(x, y)) {
      y--;
    }

    plan.put('pier', x, y + 1, 2, 5, 2, 'med', false);
  }

  const ship = (type: string, x: number, y: number) => {
    const t = w.spawnTransport(type, CITY_ME, x, y);
    t.aloft = true;
  };
  ship('rainballoon', hx - 13, hy + 14);
  ship('windballoon', hx + 19, hy + 15);

  // two hanging gardens on high islets off the town's ends, on the line of its lane, each with its
  // pergola and flower beds
  const gardens: [number, number, number][] = [[tx - 39, ty, -1], [tx + 39, ty, 1]];

  for (const [gx, gy, side] of gardens) {
    plan.island(gx - 8, gy - 8, gx + 8, gy + 8, CITY_ME, 1, blob(gx, gy, 6.5, 6, 50 + side, 2.4));
    plan.keepRect(gx - 8, gy - 8, 17, 17, PAVE.garden);
    plan.keepRect(gx - 1, gy - 1, 3, 3, PAVE.terrace);
    plan.put('pergola', gx - 2, gy - 2, 5, 5, 0, 'med', false);

    for (const [dx, dy] of [[-4, -3], [3, -4], [-3, 3], [4, 2]] as const) {
      if (plan.free(gx + dx, gy + dy, 1, 1, false)) {
        plan.put(cityHash(gx + dx, gy + dy, 30) < 0.5 ? 'lemon' : 'cypress', gx + dx, gy + dy, 1, 1, 0, 'med');
      }
    }

    // the bridge across to the town's end, where its lane runs out, on the town's level: a lift at
    // the garden's end; the lane kept clear from it
    let x = gx - side * 4;

    while (plan.land(x, gy)) {
      x -= side;
    }

    let end = x;

    while (!plan.land(end, gy) && Math.abs(end - gx) < 30) {
      end -= side;
    }

    plan.bridge(x, gy, end + side, gy, 2, 0);
    plan.keepRect(side < 0 ? end : end - 3, gy - 1, 4, 2, PAVE.street);
  }

  // the houses of the town and the harbour, whitewashed, a garden here and there with a lemon tree
  plan.settle(tx - 30, ty - 16, tx + 30, ty + 16, 'med', sizes, 'lemon', 0.5);
  plan.settle(hx - 28, hy - 10, hx + 28, hy + 10, 'med', sizes, 'olive', 0.4);

  plan.sight('The domed hall', ax, ay - 2, 6);
  plan.sight('The fountain square', tx, ty, 5);
  plan.sight('The windmills', mills[1]?.[0] ?? tx - 25, mills[1]?.[1] ?? ty, 4);
  plan.sight('The harbour', hx, hy + 4, 5);
  plan.sight('The west garden', gardens[0]![0], gardens[0]![1], 4);
  plan.sight('The east garden', gardens[1]![0], gardens[1]![1], 4);

  // the visitor's Priest, on the fountain square
  w.addPriest(CITY_ME, tx, ty + 3);
  return city;
}

/* -------------------------------------------- both ------------------------------------------- */

/** A sky city to stroll through. */
export function createCity(defs: DefTable, name: CityName): World {
  const w = new World(defs, name === 'concord' ? 1704 : 1900);

  if (name === 'concord') {
    w.addPlayer(CITY_ME, 'The Wind quarter', 'wind', 0, [], [2, 3, 4], 0, 1, false);
    w.addPlayer(2, 'The Sun quarter', 'sun', 0, [], [CITY_ME, 3, 4], 0, 1, false);
    w.addPlayer(3, 'The Rain quarter', 'rain', 0, [], [CITY_ME, 2, 4], 0, 1, false);
    w.addPlayer(4, 'The Thunder quarter', 'thunder', 0, [], [CITY_ME, 2, 3], 0, 1, false);
  } else {
    w.addPlayer(CITY_ME, 'Altamar', 'rain', 0, [], [], 0, 1, false);
  }

  w.city = name === 'concord' ? concord(w) : altamar(w);
  w.nights = true;
  w.tiered = name === 'altamar';
  w.invalidateTerrain();
  return w;
}

/** An ASCII picture of a city (for working on it): ground #, kept ground ., solid props @, bridge +. */
export function cityPicture(w: World, x0 = 60, y0 = 60, x1 = 196, y1 = 196): string {
  const rows: string[] = [];

  for (let y = y0; y <= y1; y++) {
    let row = '';

    for (let x = x0; x <= x1; x++) {
      const i = y * W + x, t = w.terrain[i];
      row += t === Terrain.Sky ? ' ' : t !== Terrain.Island ? '+' : w.city?.blocked[i] ? '@' : w.city?.paint[i] ? '.' : '#';
    }

    rows.push(row.replace(/\s+$/, ''));
  }

  return rows.join('\n');
}
