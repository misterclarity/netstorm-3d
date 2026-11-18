/**
 * The Combahee River Raid (netstorm-3d): the rules of a campaign of two battles on one map, a
 * river of sky with rice plantations on its banks, after Thea Anderson's essay "Harriet Tubman as
 * a Magical, Mercurial Figure: An Astrological Analysis of the Combahee River Raid" (The Mountain
 * Astrologer, 2021). The campaign's words are in src/campaign.js; the map and the battles' setting
 * out in raid-map.ts.
 *
 * In the first battle ('scout', spring 1863) the Priest, Harriet Tubman, goes alone along both
 * banks by night. The people in the quarters of four plantations tell her where torpedoes lie in
 * the river; she slips past the pickets, warned by the birds and in disguise, and meets her
 * scouts' boat before dawn. In the second ('raid', the night of June 1 to 2, 1863) the gunboats
 * steam up the river by the torpedoes she found. At a landing a boat's whistle calls the people of
 * the quarters, who come down to the river on their own feet, family by family; her singing at a
 * landing calms the crowd at the boats; the pontoon bridge at the ferry is burned before the
 * Confederate battery can cross it after dawn; and the boats steam home.
 *
 * The battle's own way of winning and losing is not played: no side has a Temple, an Altar or a
 * carrier on foot, so nothing is captured and nothing sacrificed. The people of the quarters are no
 * units: no gun aims at them, nothing carries them, and only the boats count them. A battle is won
 * or lost by its `verdict`, which sets the world's winner.
 *
 * Laid into netstorm-web's simulation as rules/raid.ts by scripts/house-rules.mjs, which also hooks
 * it in: the clock (World.clockSeconds), each step (tickRaid), the commands (raidCommand), the
 * boats' ways (steerBoat), what can hit a boat and how hard (onRiver, boatFloor), and the ground a
 * bridge may be laid from (docksOf).
 */
import { DIRS, TPS, W, H, type Building, type Priest, type Transport } from '../state.js';
import type { World } from '../world.js';
import type { Command, CommandError } from '../commands.js';
import { collapse } from './bridges.js';
import { damage, gunReach } from './combat.js';

export type RaidMission = 'scout' | 'raid';

/** The quarters of a plantation: the Residence the people live in. */
export interface Quarters {
  id: number;
  name: string;
  /** The Residence's footprint, RESIDENCE_FOOT square from x, y; the door they come out of. */
  x: number;
  y: number;
  door: [number, number];
  /** The people living there, and how many are still there. */
  people: number;
  left: number;
  /** Called by a boat's whistle (the raid); visited by her (the scouting). */
  called: boolean;
  visited: boolean;
  /** The landing whose boat's whistle reaches them. */
  landing: number;
  /** The tick the next family sets out. */
  next: number;
}

/** A landing: an islet of the player's on the river, where a boat ties up. */
export interface Landing {
  id: number;
  name: string;
  /** The islet: cells x..x+w-1, y..y+h-1. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The cell of the river where a boat ties up. */
  dock: [number, number];
  /** People on the landing, waiting for a boat; and the share of one person taken aboard so far. */
  crowd: number;
  boarding: number;
  /** The landing by the pontoon bridge, from which it can be burned. */
  ferry: boolean;
  /** The landing at the river's mouth: where the boats set out from and come home to. */
  mouth: boolean;
}

/** A family on its way from the quarters to a landing. */
export interface Family {
  id: number;
  /** The cell it is on, the one it came from (it is drawn between them), how far along (of STEP). */
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  along: number;
  size: number;
  children: number;
  quarters: number;
  landing: number;
  /** No ground or bridge joins its island to the landing: it waits for one. */
  waiting: boolean;
}

/** A torpedo, a mine anchored in the river; one of the quarters knows where. */
export interface Torpedo {
  id: number;
  x: number;
  y: number;
  known: boolean;
  spent: boolean;
  quarters: number;
}

/** A boat of the raid: a transport of the player's that goes on the river only. */
export interface Boat {
  id: number;
  name: string;
  capacity: number;
  aboard: number;
  /** Aground for good: the Sentinel. */
  aground: boolean;
  /** The tick its guns shell next. */
  shell: number;
}

export interface Raid {
  mission: RaidMission;
  /** The player's side and the Confederates'. */
  me: number;
  enemy: number;
  /** Seconds into the cycle of a day and a night (world.ts's DAY_SECONDS of day, then
   * NIGHT_SECONDS of night) at tick 0, and how many of them pass in a second of play. */
  clock0: number;
  rate: number;
  /** Tonight's moon, as an index into MOON_PHASES. */
  moon: number;
  /** The ticks of dawn and of the end of the morning, when the raid's boats must be home. */
  dawn: number;
  noon: number;
  /** The river: RIVER on its cells of sky, DEEP where a boat can go. */
  river: Uint8Array;
  quarters: Quarters[];
  landings: Landing[];
  families: Family[];
  torpedoes: Torpedo[];
  boats: Map<number, Boat>;
  /** Her id: the player's Priest. */
  tubman: number;
  /** Her disguise: worn until, and ready again at (ticks). */
  disguise: { until: number; ready: number; };
  /** The landing she sings at, or -1. */
  singing: number;
  /** The guns whose sign she has had on this way past them: a flock of birds rose there. */
  signs: Set<number>;
  /** Where her scouts wait with their boat (the scouting): she meets them there. */
  cove: { x: number; y: number; w: number; h: number; };
  /** The pontoon bridge at the ferry: its cells, the tick it falls once fired, whether it fell. */
  pontoon: { cells: [number, number][]; burning: number; burned: boolean; };
  /** The Confederate battery: the tick it comes to the ferry, where it would set up its guns,
   * whether it came or was held back by the burned bridge, and its guns. */
  battery: { due: number; site: [number, number]; came: boolean; held: boolean; guns: number[]; };
  /** How many must be brought aboard to win; how many were, counted at the end. */
  target: number;
  freed: number;
  /** The end: won or lost, and why. */
  verdict: { won: boolean; why: string; } | null;
  /** Steps to each landing from every cell of ground and bridge (-1: no way), worked out anew
   * every second. */
  ways: Int16Array[];
  wayTick: number;
  nextFamily: number;
}

/** What `river` holds on a cell. */
export const RIVER = 1;
export const DEEP = 2;
/** The seconds she stays in disguise, and between one disguise and the next. */
export const DISGUISE_SECONDS = 15;
export const DISGUISE_EVERY = 50;
/** How close she comes to the door of the quarters to be told what they know. */
export const VISIT_REACH = 2;
/** How far outside a gun's reach its birds rise as she comes, and how far she must go for them to
 * rise again. */
export const SIGN_MARGIN = 3;
const SIGN_FORGET = 6;
/** A boat this near a landing's dock, and not under way, is tied up there. */
export const MOOR_REACH = 3;
/** She sings to the crowd from this near a landing. */
export const SONG_REACH = 3;
/** People a boat takes aboard a second at a landing, and how many times that while she sings. */
export const BOARD_PER_SECOND = 2;
export const SONG_BOARDING = 2;
/** Seconds between two families setting out from the quarters, and cells a second they walk. */
export const RELEASE_SECONDS = 1.5;
export const FAMILY_PACE = 1.4;
/** A family's progress between two cells is counted in STEPs. */
export const STEP = 100;
/** What a torpedo takes of a boat; the share of its strength a boat never goes below (it is
 * holed and slow, but it does not sink: there are people aboard). */
export const TORPEDO_HIT = 0.5;
export const BOAT_FLOOR = 0.15;
/** The gunboats' guns: seconds between shells, how far they reach, what a shell does. */
export const SHELL_SECONDS = 2.5;
export const SHELL_REACH = 9;
export const SHELL_HIT = 90;
/** Seconds from the firing of the pontoon bridge to its fall. */
export const BURN_SECONDS = 12;
/** The boats are home when this near the mouth's dock. */
export const HOME_REACH = 6;

const ROUND = TPS; // the ways to the landings are worked out every second

/** The raid's command, as the world takes it. */
export type RaidCommand = Extract<Command, { t: 'disguise' | 'whistle' | 'burnBridge' | 'raidHome'; }>;

const chebyshev = (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/** How far (x, y) is from a rectangle, in cells: 0 inside it. */
function fromRect(x: number, y: number, r: { x: number; y: number; w: number; h: number; }): number {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w - 1));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h - 1));
  return Math.max(dx, dy);
}

/** A small, even hash: the size of a family, its children. */
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  return (h ^ (h >>> 12)) >>> 0;
}

function boatOf(world: World, r: Raid, id: number): Transport | null {
  const t = world.entities.get(id);
  return t?.kind === 'transport' && r.boats.has(t.id) ? t : null;
}

/** The landing a boat is tied up at: not under way, near its dock. */
export function mooredAt(world: World, t: Transport): Landing | null {
  const r = world.raid;

  if (!r || t.path.length > 0 || r.boats.get(t.id)?.aground !== false) {
    return null;
  }

  return r.landings.find((l) => chebyshev(t.x, t.y, l.dock[0], l.dock[1]) <= MOOR_REACH) ?? null;
}

/** Whether a unit is one of the raid's boats: on the river, not in the air, for what can hit it. */
export function onRiver(world: World, id: number): boolean {
  return world.raid?.boats.has(id) ?? false;
}

/** The most a hit may take of a unit: of a boat, never so much that it sinks. */
export function boatFloor(world: World, e: { id: number; hp: number; hpMax: number; }, amount: number): number {
  if (!world.raid?.boats.has(e.id)) {
    return amount;
  }

  return Math.max(0, Math.min(amount, e.hp - Math.ceil(e.hpMax * BOAT_FLOOR)));
}

/** The landings of a side, as the footprints a bridge may be laid from (rules/bridges.ts asks for
 * its Temple's and its Outposts'; the raid's side has neither). */
export function docksOf(world: { readonly raid: Raid | null; }, player: number): { x: number; y: number; fx: number; fy: number; }[] {
  const r = world.raid;

  if (!r || player !== r.me) {
    return [];
  }

  return r.landings.map((l) => ({ x: l.x, y: l.y, fx: l.w, fy: l.h }));
}

/** The cells a boat must keep clear of: by a torpedo she knows of, and the pontoon bridge. */
function shoals(world: World, r: Raid): Uint8Array {
  const keep = new Uint8Array(W * H);

  for (const t of r.torpedoes) {
    if (t.known && !t.spent) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (world.inside(t.x + dx, t.y + dy)) {
            keep[world.at(t.x + dx, t.y + dy)] = 1;
          }
        }
      }
    }
  }

  return keep;
}

/**
 * A boat sent to (x, y): along the river's deep water to the deep cell nearest that place, around
 * the torpedoes known of. (World's moveTransport, for the raid's boats.)
 */
export function steerBoat(world: World, t: Transport, x: number, y: number): CommandError | null {
  const r = world.raid!;
  const b = r.boats.get(t.id)!;

  if (b.aground) {
    return 'aground';
  }

  const keep = shoals(world, r);
  let goal = -1;
  let best = Infinity;

  for (let i = 0; i < W * H; i++) {
    if (r.river[i] === DEEP && !keep[i]) {
      const d = (i % W - x) ** 2 + (Math.floor(i / W) - y) ** 2;

      if (d < best) {
        best = d;
        goal = i;
      }
    }
  }

  const start = world.at(t.x, t.y);

  if (goal < 0) {
    return 'no path';
  }

  if (goal === start) {
    t.path = [];
    return null;
  }

  const from = new Int32Array(W * H).fill(-1);
  from[start] = start;
  const queue = [start];

  for (let head = 0; head < queue.length && from[goal] === -1; head++) {
    const i = queue[head]!;
    const cx = i % W;
    const cy = Math.floor(i / W);

    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;

      if (!world.inside(nx, ny)) {
        continue;
      }

      const n = world.at(nx, ny);

      if (from[n] === -1 && r.river[n] === DEEP && !keep[n]) {
        from[n] = i;
        queue.push(n);
      }
    }
  }

  if (from[goal] === -1) {
    return 'no path';
  }

  const path: [number, number][] = [];

  for (let i = goal; i !== start; i = from[i]!) {
    path.push([i % W, Math.floor(i / W)]);
  }

  t.path = path.reverse();
  t.goal = 'idle';
  t.target = null;
  return null;
}

/** A raid's command: her disguise, a boat's whistle, the firing of the pontoon bridge, home. */
export function raidCommand(world: World, c: RaidCommand): CommandError | null {
  const r = world.raid;

  if (!r || r.verdict) {
    return 'not here';
  }

  if (c.t === 'disguise') {
    const her = world.entities.get(r.tubman);

    if (her?.kind !== 'priest' || her.owner !== c.player || her.state !== 'normal') {
      return 'priest unavailable';
    }

    if (world.tick < r.disguise.ready) {
      return 'not ready';
    }

    // no gun aims at what is invisible: rules/combat.ts's `targetable`; it wears off by itself
    her.invisible = DISGUISE_SECONDS * TPS;
    r.disguise.until = world.tick + DISGUISE_SECONDS * TPS;
    r.disguise.ready = world.tick + DISGUISE_EVERY * TPS;
    world.emit({ what: 'raid', who: c.player, data: { kind: 'disguise' } });
    return null;
  }

  if (c.t === 'raidHome') {
    if (r.mission !== 'raid') {
      return 'not here';
    }

    const mouth = r.landings.find((l) => l.mouth)!;

    for (const b of r.boats.values()) {
      const t = boatOf(world, r, b.id);

      if (!b.aground && t && chebyshev(t.x, t.y, mouth.dock[0], mouth.dock[1]) > HOME_REACH) {
        return 'too far';
      }
    }

    finish(world, r, 'home');
    return null;
  }

  const t = boatOf(world, r, c.transport);

  if (!t || t.owner !== c.player) {
    return 'bad target';
  }

  const l = mooredAt(world, t);

  if (c.t === 'whistle') {
    if (!l) {
      return 'not moored';
    }

    const called = r.quarters.filter((q) => q.landing === l.id && !q.called && q.left > 0);

    if (!called.length) {
      return 'nobody to call';
    }

    for (const q of called) {
      q.called = true;
      q.next = world.tick;
    }

    world.emit({ what: 'raid', who: c.player, data: { kind: 'whistle', id: l.id, boat: t.id } });
    return null;
  }

  // burnBridge
  if (!l?.ferry) {
    return 'not moored';
  }

  if (r.pontoon.burned || r.pontoon.burning > 0) {
    return 'not ready';
  }

  r.pontoon.burning = world.tick + BURN_SECONDS * TPS;
  world.emit({ what: 'raid', who: c.player, data: { kind: 'burning' } });
  return null;
}

/** A step of the raid's rules, after the world's own. */
export function tickRaid(world: World): void {
  const r = world.raid!;

  if (r.verdict) {
    return;
  }

  const her = world.entities.get(r.tubman);

  // knocked out (a picket's or a battery's shots): the battle is lost; nobody takes her
  if (her?.kind !== 'priest' || her.state !== 'normal') {
    end(world, r, false, 'down');
    return;
  }

  if (world.tick === r.dawn) {
    world.emit({ what: 'raid', who: her.owner, data: { kind: 'dawn' } });
  }

  signs(world, r, her);

  if (r.mission === 'scout') {
    scout(world, r, her);
    return;
  }

  for (const b of r.boats.values()) {
    const t = boatOf(world, r, b.id);

    if (t && b.aground) {
      t.path = [];
    }
  }

  torpedoes(world, r);
  shell(world, r);
  setOut(world, r);
  walk(world, r);
  sing(world, r, her);
  board(world, r);
  fire(world, r);
  battery(world, r);

  if (world.tick >= r.noon) {
    finish(world, r, 'noon');
  }
}

/** The scouting: the quarters she comes to tell her where their torpedoes lie; the battle is won
 * when she has been to them all and meets her scouts, lost if dawn finds her still out. */
function scout(world: World, r: Raid, her: Priest): void {
  for (const q of r.quarters) {
    if (!q.visited && chebyshev(her.x, her.y, q.door[0], q.door[1]) <= VISIT_REACH) {
      q.visited = true;
      const told = r.torpedoes.filter((t) => t.quarters === q.id);

      for (const t of told) {
        t.known = true;
      }

      world.emit({ what: 'raid', who: her.owner, data: { kind: 'visit', id: q.id, n: told.length } });
    }
  }

  if (r.quarters.every((q) => q.visited) && fromRect(her.x, her.y, r.cove) === 0) {
    end(world, r, true, 'cove');
  } else if (world.tick >= r.dawn) {
    end(world, r, false, 'dawn');
  }
}

/**
 * Sky messages: as she comes near a picket's reach, a flock of birds rises there before it can see
 * her (once on each way past it). Not while she is in disguise: nothing aims at her then.
 */
function signs(world: World, r: Raid, her: Priest): void {
  for (const e of world.entities.values()) {
    if (e.kind !== 'building' || e.hp <= 0 || e.rising > 0 || !world.hostile(e.owner, her.owner)) {
      continue;
    }

    const range = world.def(e.type).range;

    if (!range) {
      continue;
    }

    const cx = e.x + (e.fx >> 1);
    const cy = e.y + (e.fy >> 1);
    const away = chebyshev(her.x, her.y, cx, cy);
    const reach = gunReach(world, e, range, her);

    if (away > reach + SIGN_FORGET) {
      r.signs.delete(e.id);
    } else if (away <= reach + SIGN_MARGIN && !r.signs.has(e.id) && her.invisible === 0) {
      r.signs.add(e.id);
      world.emit({ what: 'raid', who: her.owner, data: { kind: 'sign', id: e.id, x: cx, y: cy } });
    }
  }
}

/** A boat that comes on a torpedo: it goes off under her, and she is holed (never sunk). */
function torpedoes(world: World, r: Raid): void {
  for (const tp of r.torpedoes) {
    if (tp.spent) {
      continue;
    }

    for (const b of r.boats.values()) {
      const t = boatOf(world, r, b.id);

      // (the cell a boat is at is its keel: a boat's way keeps that a cell clear of every
      // torpedo it knows of, steerBoat)
      if (t && !b.aground && chebyshev(t.x, t.y, tp.x, tp.y) <= 1) {
        tp.spent = true;
        tp.known = true;
        t.hp -= boatFloor(world, t, Math.round(t.hpMax * TORPEDO_HIT));
        world.emit({ what: 'raid', who: t.owner, data: { kind: 'torpedo', id: tp.id, boat: t.id, x: tp.x, y: tp.y } });
        break;
      }
    }
  }
}

/** The gunboats' guns: each shells the nearest enemy building within its reach. */
function shell(world: World, r: Raid): void {
  for (const b of r.boats.values()) {
    const t = boatOf(world, r, b.id);

    if (!t || b.aground || world.tick < b.shell) {
      continue;
    }

    let aim: Building | null = null;
    let best = Infinity;

    for (const e of world.entities.values()) {
      if (e.kind !== 'building' || e.hp <= 0 || e.rising > 0 || !world.hostile(t.owner, e.owner)) {
        continue;
      }

      const away = fromRect(t.x, t.y, { x: e.x, y: e.y, w: e.fx, h: e.fy });

      if (away <= SHELL_REACH && away < best) {
        best = away;
        aim = e;
      }
    }

    if (!aim) {
      b.shell = world.tick + TPS / 2;
      continue;
    }

    b.shell = world.tick + SHELL_SECONDS * TPS;
    world.emit({ what: 'raid', who: t.owner, data: { kind: 'shell', boat: t.id, id: aim.id, x: aim.x + (aim.fx >> 1), y: aim.y + (aim.fy >> 1) } });
    damage(world, t.owner, aim, SHELL_HIT);
  }
}

/** Called by a whistle, the people of the quarters set out family by family. */
function setOut(world: World, r: Raid): void {
  for (const q of r.quarters) {
    if (!q.called || q.left <= 0 || world.tick < q.next) {
      continue;
    }

    const id = r.nextFamily++;
    const size = Math.min(q.left, 3 + (hash(id, q.id) % 7));
    const children = size < 3 ? 0 : Math.min(size - 2, hash(q.id, id) % 4);
    q.left -= size;
    q.next = world.tick + RELEASE_SECONDS * TPS;
    r.families.push({
      id,
      x: q.door[0],
      y: q.door[1],
      fromX: q.door[0],
      fromY: q.door[1],
      along: 0,
      size,
      children,
      quarters: q.id,
      landing: q.landing,
      waiting: false,
    });

    if (q.left === 0) {
      world.emit({ what: 'raid', who: r.me, data: { kind: 'emptied', id: q.id } });
    }
  }
}

/** Steps to the landing `l` from every cell of ground and bridge joined to it. */
function wayTo(world: World, l: Landing): Int16Array {
  const way = new Int16Array(W * H).fill(-1);
  const queue: number[] = [];

  for (let y = l.y; y < l.y + l.h; y++) {
    for (let x = l.x; x < l.x + l.w; x++) {
      if (world.walkable(0, x, y)) {
        way[world.at(x, y)] = 0;
        queue.push(world.at(x, y));
      }
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const cx = i % W;
    const cy = Math.floor(i / W);

    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;

      if (world.inside(nx, ny) && way[world.at(nx, ny)] === -1 && world.walkable(0, nx, ny)) {
        way[world.at(nx, ny)] = way[i]! + 1;
        queue.push(world.at(nx, ny));
      }
    }
  }

  return way;
}

/** The families walk to their landing, a cell at a time, by the shortest way there is; with no way,
 * they wait where they are for a bridge. */
function walk(world: World, r: Raid): void {
  if (world.tick >= r.wayTick) {
    r.ways = r.landings.map((l) => wayTo(world, l));
    r.wayTick = world.tick + ROUND;
  }

  const pace = Math.round((FAMILY_PACE * STEP) / TPS);

  for (const f of [...r.families]) {
    const way = r.ways[f.landing]!;
    const here = way[world.at(f.x, f.y)]!;
    f.waiting = here < 0;

    if (here === 0) {
      arrive(world, r, f);
      continue;
    }

    if (f.waiting) {
      f.along = 0;
      f.fromX = f.x;
      f.fromY = f.y;
      continue;
    }

    f.along += pace;

    while (f.along >= STEP) {
      const d = way[world.at(f.x, f.y)]!;

      if (d <= 0) {
        break;
      }

      // the next cell nearer the landing; families take turns in the order they look round
      let next: [number, number] | null = null;

      for (let k = 0; k < DIRS.length && !next; k++) {
        const [dx, dy] = DIRS[(k + f.id) % DIRS.length]!;
        const nx = f.x + dx;
        const ny = f.y + dy;

        if (world.inside(nx, ny) && way[world.at(nx, ny)] === d - 1) {
          next = [nx, ny];
        }
      }

      if (!next) {
        break;
      }

      f.along -= STEP;
      f.fromX = f.x;
      f.fromY = f.y;
      [f.x, f.y] = next;
    }
  }
}

function arrive(world: World, r: Raid, f: Family): void {
  const l = r.landings[f.landing]!;
  l.crowd += f.size;
  r.families.splice(r.families.indexOf(f), 1);
  world.emit({ what: 'raid', who: r.me, data: { kind: 'arrived', id: l.id, n: f.size } });
}

/** She sings to the crowd at the landing she stands at. */
function sing(world: World, r: Raid, her: Priest): void {
  let at = -1;

  for (const l of r.landings) {
    if (fromRect(her.x, her.y, l) <= SONG_REACH) {
      at = l.id;
      break;
    }
  }

  if (at !== r.singing && at >= 0) {
    world.emit({ what: 'raid', who: her.owner, data: { kind: 'song', id: at } });
  }

  r.singing = at;
}

/** The crowd at a landing goes aboard a boat tied up there, as fast again while she sings. */
function board(world: World, r: Raid): void {
  for (const l of r.landings) {
    if (l.crowd <= 0) {
      l.boarding = 0;
      continue;
    }

    let boat: Boat | null = null;

    for (const b of r.boats.values()) {
      const t = boatOf(world, r, b.id);

      if (t && b.aboard < b.capacity && mooredAt(world, t) === l && (!boat || b.capacity - b.aboard > boat.capacity - boat.aboard)) {
        boat = b;
      }
    }

    if (!boat) {
      continue;
    }

    l.boarding += (BOARD_PER_SECOND * (r.singing === l.id ? SONG_BOARDING : 1)) / TPS;
    const n = Math.min(Math.floor(l.boarding), l.crowd, boat.capacity - boat.aboard);

    if (n > 0) {
      l.boarding -= n;
      l.crowd -= n;
      boat.aboard += n;

      if (boat.aboard === boat.capacity) {
        world.emit({ what: 'raid', who: r.me, data: { kind: 'full', boat: boat.id } });
      }
    }
  }
}

/** The pontoon bridge, once fired, burns through and falls into the river. */
function fire(world: World, r: Raid): void {
  const p = r.pontoon;

  if (p.burned || p.burning === 0 || world.tick < p.burning) {
    return;
  }

  for (const [x, y] of p.cells) {
    if (world.terrain[world.at(x, y)] !== 0) {
      collapse(world, x, y);
    }
  }

  p.burned = true;
  world.invalidateTerrain();
  world.emit({ what: 'raid', who: r.me, data: { kind: 'burned' } });
}

/** After dawn the Confederate battery comes to the ferry: over the pontoon bridge, if it stands. */
function battery(world: World, r: Raid): void {
  const b = r.battery;

  if (b.came || b.held || world.tick < b.due) {
    return;
  }

  if (r.pontoon.burned) {
    b.held = true;
    world.emit({ what: 'raid', who: r.me, data: { kind: 'held' } });
    return;
  }

  const [x, y] = b.site;

  // (a Sun Cannon fires along the way it faces: south, over the river at the ferry)
  for (const at of [[x, y], [x + 4, y]] as const) {
    const gun = world.spawnBuilding('suncannon', r.enemy, at[0], at[1], SOUTH);
    gun.rising = 0;
    gun.hp = gun.hpMax;
    b.guns.push(gun.id);
  }

  b.came = true;
  world.emit({ what: 'raid', who: r.me, data: { kind: 'battery', x: x + 3, y: y + 1 } });
}

/** A building's facing, as DIRS orders them: north, east, south, west. */
const SOUTH = 2;

/** The people aboard the boats that are not aground. */
export function freed(world: World): number {
  let n = 0;

  for (const b of world.raid?.boats.values() ?? []) {
    if (!b.aground) {
      n += b.aboard;
    }
  }

  return n;
}

/** The raid's end: home, or at noon wherever the boats are. Won if enough are aboard. */
function finish(world: World, r: Raid, why: string): void {
  const n = freed(world);
  end(world, r, n >= r.target, n >= r.target ? why : 'few');
}

function end(world: World, r: Raid, won: boolean, why: string): void {
  r.freed = freed(world);
  r.verdict = { won, why };
  world.winner = won ? r.me : r.enemy;
  world.emit({ what: 'raid', who: r.me, data: { kind: 'end', won, why, n: r.freed } });
}
