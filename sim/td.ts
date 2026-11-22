/**
 * The Bridges of Nimbus (netstorm-3d): a tower defense campaign in NetStorm's world of islands in
 * the sky. Laid into netstorm-web's simulation as rules/td.ts by scripts/house-rules.mjs; its six
 * battles are laid out by td-map.ts (sim/td-map.ts), and the client tells and draws them
 * (src/td-hud.js, src/components/ns-td.js).
 *
 * The Hollow Priest's horde marches to the player's Temple, wave after wave: the game's own walkers
 * along the bridges of the battle's routes, its airships over them. The player holds them off with
 * the game's own guns, raised on the stone platforms beside the bridges with the Storm Power paid
 * for each walker and airship brought down, and each raised to three ranks. A gun fights as the
 * rules have it: an archer at whatever comes within its reach (the Crossbow within its arc), a
 * cannon down the line it faces (the Sun Cannon turning to the best of its four), the Vander Tower
 * at the air only, a pair of Arc Spires through the band between them across a bridge, a
 * Whirlibase by the Whirligigs it launches. Here a rank makes a gun hit harder and reach further,
 * an Ice Cannon's shell chills a walker, slowing it, and the horde's walkers and airships have hit
 * points and paces of their own. What reaches the Temple costs it lives (a Crystal Crab steals
 * Storm Power as well); with none left the battle is lost, and with every wave held off, won.
 */
import { TPS, type Building, type Facing, type Transport } from '../state.js';
import type { World } from '../world.js';
import type { Command, CommandError } from '../commands.js';
import { removeBuilding } from './combat.js';
import { removeTransport } from './movement.js';

/** The player, and the Hollow Priest's horde. */
export const TD_ME = 1;
export const TD_FOE = 2;

/** A gun the player may raise: what it costs here, what raising it a rank costs, what it hits. */
export interface TdTower {
  readonly cost: number;
  /** Its hits here, times its own: what makes each gun worth its price against a moving horde. */
  readonly power: number;
  /** Storm Power to raise it to rank II, and to rank III. */
  readonly ranks: readonly [number, number];
  /** What it hits: walkers, airships or both. */
  readonly hits: 'ground' | 'air' | 'both';
  /** Its fire goes the way it faces (a cannon's line, the Crossbow's arc): the player may turn it. */
  readonly turns?: boolean;
  /** Raised as a pair of posts across a bridge, at an Arc gate. */
  readonly gate?: boolean;
  readonly note: string;
}

export const TD_TOWERS: Readonly<Record<string, TdTower>> = {
  sunarcher: { cost: 90, power: 1.5, ranks: [70, 110], hits: 'both', note: 'Throws sun discs at whatever comes near it; hits airships hardest' },
  windarcher: { cost: 160, power: 1.15, ranks: [110, 170], hits: 'both', turns: true, note: 'Shoots far along the way it faces, at walkers and airships' },
  raincannon: { cost: 190, power: 1.2, ranks: [130, 190], hits: 'ground', turns: true, note: 'Bursts of ice shells down its line: a chilled walker slows down' },
  thunderarcher: { cost: 150, power: 1.4, ranks: [100, 150], hits: 'air', note: 'Lightning at airships, and nothing else' },
  suncannon: { cost: 200, power: 3.2, ranks: [140, 200], hits: 'ground', note: 'Turns to the best of its four lines: slow, heavy shots' },
  thunderfence: { cost: 220, power: 1, ranks: [150, 220], hits: 'ground', gate: true, note: 'Two spires across the bridge: their band shocks every walker crossing' },
  thundercannon: { cost: 300, power: 2.2, ranks: [210, 300], hits: 'ground', turns: true, note: 'The longest line and the hardest hits' },
  rainaviary: { cost: 180, power: 2.6, ranks: [130, 180], hits: 'ground', note: 'Raises a Man o’ War that hunts the walkers about it, and lives longer on what it kills' },
};

/** What a rank adds: its hit, times; its reach, cells. */
export const TD_RANK_HIT = [1, 1.5, 2.2] as const;
export const TD_RANK_REACH = [0, 1, 2] as const;
/** Of what was spent on a gun, the share paid back when it is sold. */
export const TD_REFUND = 0.6;
/** Ticks a gun takes to rise: its first shot comes after. */
export const TD_RISE = Math.round(1.5 * TPS);

/** A walker or airship of the horde: its hit points and pace here, what bringing one down pays,
 * what one costs the Temple. */
export interface TdFoe {
  readonly hp: number;
  /** Cells a second. */
  readonly speed: number;
  readonly bounty: number;
  readonly lives: number;
  /** Storm Power it carries off from the Temple as well. */
  readonly steals?: number;
  readonly air?: boolean;
  readonly note: string;
}

export const TD_FOES: Readonly<Record<string, TdFoe>> = {
  sunwalker: { hp: 90, speed: 1.3, bounty: 10, lives: 1, note: 'A lumbering Golem of sandstone: slow, and never alone' },
  firewalker: { hp: 45, speed: 2.2, bounty: 6, lives: 1, note: 'Fire Ants come quick, in swarms' },
  rainwalker: { hp: 240, speed: 1.8, bounty: 26, lives: 1, steals: 40, note: 'A Crystal Crab that reaches the Temple steals Storm Power as well' },
  windwalker: { hp: 150, speed: 2.8, bounty: 20, lives: 1, note: 'Sail Skaters are the fastest on the bridges' },
  bulf: { hp: 1100, speed: 1.0, bounty: 90, lives: 3, note: 'A shaggy Bulf takes long to bring down, and three lives' },
  sunballoon: { hp: 140, speed: 1.6, bounty: 22, lives: 1, air: true, note: 'A Balloon flies over the bridges: only guns that shoot at the air can hit it' },
  rainballoon: { hp: 220, speed: 1.7, bounty: 36, lives: 2, air: true, note: 'Half the shots at a Cloud Floater pass through it' },
  windballoon: { hp: 1000, speed: 1.1, bounty: 110, lives: 3, air: true, note: 'The Air Ship, the heaviest of the air' },
};

/** The Spells the player casts: Thunder Strike hurts all the horde within its reach, Paralysis
 * holds them where they are. */
export const TD_SPELLS: Readonly<Record<string, { readonly reach: number; readonly cooldown: number; readonly note: string; }>> = {
  bomblightingzap: { reach: 2.5, cooldown: 30, note: 'Lightning on the horde about a spot' },
  bombparalyze: { reach: 3, cooldown: 40, note: 'Holds the horde about a spot where it is' },
};
/** Thunder Strike's hit, and how long Paralysis holds. */
export const TD_STRIKE = 220;
export const TD_HOLD_SECONDS = 5;

/** How long a chilled walker is slowed, and to what share of its pace. */
export const TD_CHILL_SECONDS = 2;
export const TD_CHILL_PACE = 0.55;
/** The flagship's Paralysis: every so many seconds, the player's guns within its reach, so long. */
export const TD_AURA = { every: 10, reach: 7, seconds: 4 } as const;
/** Storm Power a second of the countdown left pays, when the next wave is called early. */
export const TD_CALL_BONUS = 2;

/** A way the horde comes: its cells from where it appears to the Temple's door. */
export interface TdRoute {
  readonly cells: readonly (readonly [number, number])[];
  readonly air: boolean;
}

/** A stone platform a gun may be raised on (its 3×3 anchor); an Arc gate has a second one across
 * the bridge, for the other post. */
export interface TdSpot {
  readonly x: number;
  readonly y: number;
  readonly pair: readonly [number, number] | null;
  tower: number | null;
}

/** Walkers or airships of one kind in a wave: `n` of them, `every` seconds apart from `at` seconds
 * into it, along route `route`, their hit points times `hp`; the flagship is the battle's last. */
export interface TdGroup {
  readonly foe: string;
  readonly n: number;
  readonly every: number;
  readonly at: number;
  readonly route: number;
  readonly hp: number;
  readonly flagship?: boolean;
}

export interface TdEnemy {
  readonly type: string;
  readonly bounty: number;
  readonly lives: number;
  readonly flagship: boolean;
  chill: number;
  aura: number;
}

export interface Td {
  readonly level: string;
  lives: number;
  readonly livesMax: number;
  /** Waves begun so far. */
  wave: number;
  readonly waves: readonly (readonly TdGroup[])[];
  /** Ticks until the next wave begins by itself; -1 while it waits to be called. */
  next: number;
  /** Ticks between the last of a wave and the next wave. */
  readonly gap: number;
  /** Who of the waves begun is still to come, by the tick each appears. */
  readonly due: { at: number; group: TdGroup; }[];
  readonly enemies: Map<number, TdEnemy>;
  readonly routes: readonly TdRoute[];
  readonly spots: TdSpot[];
  /** A gun's rank (1 to 3), what was spent on it, and an Arc Spire's other post. */
  readonly ranks: Map<number, number>;
  readonly spent: Map<number, number>;
  readonly posts: Map<number, number>;
  /** The guns and Spells of this battle. */
  readonly towers: readonly string[];
  readonly spells: readonly string[];
  /** Ticks until a Spell may be cast again. */
  readonly cooldown: Map<string, number>;
  over: 'won' | 'lost' | null;
  killed: number;
  leaked: number;
  /** The ground of each cell as the client draws it (td-map.ts): the road, a platform. */
  readonly paint: Uint8Array;
}

/** A step north, east, south and west. */
const STEPS: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** The middle of a gun's 3×3 platform, and the cells its fire reaches from there, facing so. */
export function tdReach(world: World, type: string, x: number, y: number, facing: Facing, rank = 1): { ground: Set<number>; air: Set<number>; } {
  const def = world.def(type), W = 256, extra = TD_RANK_REACH[rank - 1] ?? 0;
  const ground = new Set<number>(), air = new Set<number>();
  const cx = x + 1, cy = y + 1, tower = TD_TOWERS[type];
  const square = (to: Set<number>, r: number, arc: boolean) => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (arc) {
          const [ax, ay] = STEPS[facing]!;
          const along = dx * ax + dy * ay, across = dx * ay - dy * ax;

          if (!(along > 0 && 3 * across * across <= along * along)) {
            continue;
          }
        }

        to.add((cy + dy) * W + cx + dx);
      }
    }
  };
  const line = (f: number) => {
    const [dx, dy] = STEPS[f]!;
    let lx = f === 1 ? x + 3 : f === 3 ? x - 1 : cx;
    let ly = f === 0 ? y - 1 : f === 2 ? y + 3 : cy;

    for (let r = 0; r < def.range + extra; r++, lx += dx, ly += dy) {
      ground.add(ly * W + lx);
    }
  };

  if (!tower) {
    return { ground, air };
  }

  if (type === 'suncannon') {
    for (let f = 0; f < 4; f++) {
      line(f);
    }
  } else if (def.group === 'cannon') {
    line(facing);
  } else if (type === 'rainaviary') {
    square(ground, def.range + 1, false);
  } else if (!tower.gate) {
    if (tower.hits !== 'air') {
      square(ground, def.range + extra, type === 'windarcher');
    }

    if (tower.hits !== 'ground') {
      square(air, (def.airRange || def.range) + extra, type === 'windarcher');
    }
  }

  return { ground, air };
}

/** How much of the battle's routes a gun raised there would cover, facing so: what it is turned to
 * when the player does not choose. */
export function tdCover(world: World, type: string, x: number, y: number, facing: Facing): number {
  const td = world.td!, { ground, air } = tdReach(world, type, x, y, facing);
  let n = 0;

  for (const route of td.routes) {
    const reach = route.air ? air : ground;

    for (const [cx, cy] of route.cells) {
      if (reach.has(cy * 256 + cx)) {
        n++;
      }
    }
  }

  return n;
}

/** The way a gun raised there would best face. */
export function tdFacing(world: World, type: string, x: number, y: number): Facing {
  let best: Facing = 0, most = -1;

  for (const f of [0, 1, 2, 3] as const) {
    const n = tdCover(world, type, x, y, f);

    if (n > most) {
      most = n;
      best = f;
    }
  }

  return best;
}

/** A gun's hit, times: its power here and its rank (a gun as the rules pass it about: a building,
 * the copy of one a shot carries, or the id of a flyer's base). */
export function tdHit(world: World, b: { id: number; type?: string; }): number {
  if (!world.td) {
    return 1;
  }

  const home = world.entities.get(b.id);
  const type = b.type ?? (home?.kind === 'building' ? home.type : '');
  return (TD_TOWERS[type]?.power ?? 1) * (TD_RANK_HIT[(world.td.ranks.get(b.id) ?? 1) - 1] ?? 1);
}

/** Cells a gun reaches further at its rank (a gun as the rules pass it about: a building, or the
 * copy of one a shot carries). */
export function tdFurther(world: World, b: unknown): number {
  const id = (b as { id?: number; } | undefined)?.id;
  return world.td && id !== undefined ? TD_RANK_REACH[(world.td.ranks.get(id) ?? 1) - 1] ?? 0 : 0;
}

/** A walker's or airship's pace now, cells a second: its own here, slower while chilled. */
export function tdSpeed(world: World, t: Transport): number {
  const foe = TD_FOES[t.type], enemy = world.td?.enemies.get(t.id);
  const speed = foe?.speed ?? world.def(t.type).speed;
  return enemy && enemy.chill > 0 ? speed * TD_CHILL_PACE : speed;
}

/** An Ice Cannon's shell chills the walker it strikes. */
export function tdChill(world: World, id: number): void {
  const enemy = world.td?.enemies.get(id);

  if (enemy) {
    enemy.chill = TD_CHILL_SECONDS * TPS;
  }
}

/** Begin the next wave: its walkers and airships due, each at its time. */
function beginWave(world: World): void {
  const td = world.td!;
  const groups = td.waves[td.wave] ?? [];
  td.wave++;
  td.next = -1;

  for (const group of groups) {
    for (let i = 0; i < group.n; i++) {
      td.due.push({ at: world.tick + Math.round((group.at + i * group.every) * TPS), group });
    }
  }

  td.due.sort((a, b) => a.at - b.at);
  world.emit({ what: 'td', who: TD_ME, data: { kind: 'wave', n: td.wave } });
}

function appear(world: World, group: TdGroup): void {
  const td = world.td!, foe = TD_FOES[group.foe]!, route = td.routes[group.route]!;
  const [x, y] = route.cells[0]!;
  const t = world.spawnTransport(group.foe, TD_FOE, x, y);
  t.hpMax = t.hp = Math.round(foe.hp * group.hp);
  t.path = route.cells.slice(1).map(([cx, cy]) => [cx, cy]);
  t.aloft = route.air;
  td.enemies.set(t.id, {
    type: group.foe,
    bounty: group.flagship ? 0 : foe.bounty,
    lives: group.flagship ? td.livesMax : foe.lives,
    flagship: !!group.flagship,
    chill: 0,
    aura: TD_AURA.every * TPS,
  });
  world.emit({ what: 'td', who: TD_ME, data: { kind: 'appear', id: t.id, type: group.foe, flagship: !!group.flagship } });
}

/** One tick of the battle, after the world's own: the horde comes, reaches the Temple or falls. */
export function tickTd(world: World): void {
  const td = world.td!;

  if (td.over) {
    return;
  }

  for (const [spell, ticks] of td.cooldown) {
    if (ticks > 0) {
      td.cooldown.set(spell, ticks - 1);
    }
  }

  // the next wave, when its countdown runs out
  if (td.next > 0 && --td.next === 0) {
    beginWave(world);
  }

  while (td.due.length && td.due[0]!.at <= world.tick) {
    appear(world, td.due.shift()!.group);
  }

  const me = world.players.get(TD_ME)!;

  for (const [id, enemy] of td.enemies) {
    const t = world.entities.get(id);

    // brought down: the rules took it off the map
    if (!t || t.kind !== 'transport') {
      td.enemies.delete(id);
      td.killed++;
      me.storm += enemy.bounty;
      world.emit({ what: 'td', who: TD_ME, data: { kind: 'bounty', id, amount: enemy.bounty, type: enemy.type } });
      continue;
    }

    if (enemy.chill > 0) {
      enemy.chill--;
    }

    // the flagship holds the guns about it still
    if (enemy.flagship && --enemy.aura <= 0) {
      enemy.aura = TD_AURA.every * TPS;

      for (const e of world.entities.values()) {
        if (e.kind === 'building' && e.owner === TD_ME && Math.max(Math.abs(e.x + 1 - t.x), Math.abs(e.y + 1 - t.y)) <= TD_AURA.reach) {
          e.paralyzed = TD_AURA.seconds * TPS;
        }
      }

      world.emit({ what: 'td', who: TD_ME, data: { kind: 'aura', id } });
    }

    // at the Temple's door: it costs the Temple
    if (!t.path.length && t.hp > 0) {
      const foe = TD_FOES[t.type];
      const stolen = Math.min(me.storm, foe?.steals ?? 0);
      me.storm -= stolen;
      td.lives = Math.max(0, td.lives - enemy.lives);
      td.leaked++;
      td.enemies.delete(id);
      removeTransport(world, t);
      world.emit({ what: 'td', who: TD_ME, data: { kind: 'leak', id, n: enemy.lives, amount: stolen, type: t.type, x: t.x, y: t.y } });
    }
  }

  // the countdown to the next wave starts once the last of this one has appeared
  if (!td.due.length && td.wave > 0 && td.wave < td.waves.length && td.next < 0) {
    td.next = td.gap;
  }

  if (td.lives <= 0) {
    td.over = 'lost';
    world.emit({ what: 'td', who: TD_ME, data: { kind: 'over', won: false } });
  } else if (td.wave === td.waves.length && !td.due.length && !td.enemies.size) {
    td.over = 'won';
    world.emit({ what: 'td', who: TD_ME, data: { kind: 'over', won: true } });
  }
}

type TdCommand = Extract<Command, { t: 'tdBuild' | 'tdUpgrade' | 'tdSell' | 'tdTurn' | 'tdWave' | 'tdCast'; }>;

/** A gun of the player's in this battle, by its id (either post of an Arc gate). */
function towerOf(world: World, id: number): Building | null {
  const b = world.entities.get(id);
  return b?.kind === 'building' && b.owner === TD_ME && world.td!.ranks.has(b.id) ? b : null;
}

/** The player's commands in a battle. */
export function tdCommand(world: World, c: TdCommand): CommandError | null {
  const td = world.td!, me = world.players.get(TD_ME)!;

  if (c.player !== TD_ME || td.over) {
    return 'not here';
  }

  switch (c.t) {
    case 'tdBuild': {
      const spot = td.spots[c.spot], tower = TD_TOWERS[c.type];

      if (!spot || !tower || !td.towers.includes(c.type) || !!spot.pair !== !!tower.gate) {
        return 'not here';
      }

      if (spot.tower !== null) {
        return 'blocked';
      }

      if (me.storm < tower.cost) {
        return 'no storm power';
      }

      me.storm -= tower.cost;
      const facing = c.facing ?? tdFacing(world, c.type, spot.x, spot.y);
      const b = world.spawnBuilding(c.type, TD_ME, spot.x, spot.y, facing);
      b.rising = TD_RISE;
      td.ranks.set(b.id, 1);
      td.spent.set(b.id, tower.cost);
      spot.tower = b.id;

      if (spot.pair) {
        const other = world.spawnBuilding(c.type, TD_ME, spot.pair[0], spot.pair[1], facing);
        other.rising = TD_RISE;
        td.ranks.set(other.id, 1);
        td.posts.set(b.id, other.id);
        td.posts.set(other.id, b.id);
      }

      world.emit({ what: 'td', who: TD_ME, data: { kind: 'built', id: b.id, type: c.type } });
      return null;
    }
    case 'tdUpgrade': {
      const b = towerOf(world, c.tower), rank = b ? td.ranks.get(b.id) ?? 1 : 0;
      const cost = b ? TD_TOWERS[b.type]?.ranks[rank - 1] : undefined;

      if (!b) {
        return 'not here';
      }

      if (cost === undefined || rank >= 3) {
        return 'fully upgraded';
      }

      if (me.storm < cost) {
        return 'no storm power';
      }

      me.storm -= cost;
      const post = td.posts.get(b.id), first = post !== undefined && !td.spent.has(b.id) ? post : b.id;

      for (const id of [b.id, post]) {
        const g = id === undefined ? undefined : world.entities.get(id);

        if (g?.kind === 'building') {
          td.ranks.set(g.id, rank + 1);
          g.hp = g.hpMax;
        }
      }

      td.spent.set(first, (td.spent.get(first) ?? 0) + cost);
      world.emit({ what: 'td', who: TD_ME, data: { kind: 'rank', id: b.id, n: rank + 1 } });
      return null;
    }
    case 'tdSell': {
      const b = towerOf(world, c.tower);

      if (!b) {
        return 'not here';
      }

      const post = td.posts.get(b.id), first = post !== undefined && !td.spent.has(b.id) ? post : b.id;
      const refund = Math.floor((td.spent.get(first) ?? 0) * TD_REFUND);
      me.storm += refund;

      for (const id of [b.id, post]) {
        const g = id === undefined ? undefined : world.entities.get(id);

        if (g?.kind === 'building') {
          removeBuilding(world, g);
          td.ranks.delete(g.id);
          td.spent.delete(g.id);
          td.posts.delete(g.id);
        }
      }

      for (const spot of td.spots) {
        if (spot.tower === first) {
          spot.tower = null;
        }
      }

      world.emit({ what: 'td', who: TD_ME, data: { kind: 'sold', id: b.id, amount: refund, x: b.x, y: b.y } });
      return null;
    }
    case 'tdTurn': {
      const b = towerOf(world, c.tower);

      if (!b || !TD_TOWERS[b.type]?.turns) {
        return 'not here';
      }

      b.facing = (c.facing ?? (b.facing + 1) % 4) as Facing;
      b.target = null;
      b.barrel = -1;
      world.emit({ what: 'td', who: TD_ME, data: { kind: 'turned', id: b.id, n: b.facing } });
      return null;
    }
    case 'tdWave': {
      if (td.wave >= td.waves.length || td.due.length) {
        return 'not here';
      }

      const bonus = td.next > 0 ? Math.ceil((td.next / TPS) * TD_CALL_BONUS) : 0;
      me.storm += bonus;

      if (bonus) {
        world.emit({ what: 'td', who: TD_ME, data: { kind: 'called', amount: bonus } });
      }

      beginWave(world);
      return null;
    }
    case 'tdCast': {
      const spell = TD_SPELLS[c.spell];

      if (!spell || !td.spells.includes(c.spell)) {
        return 'not here';
      }

      if ((td.cooldown.get(c.spell) ?? 0) > 0) {
        return 'not ready';
      }

      td.cooldown.set(c.spell, spell.cooldown * TPS);

      for (const [id] of td.enemies) {
        const t = world.entities.get(id);

        if (t?.kind !== 'transport' || Math.hypot(t.x - c.x, t.y - c.y) > spell.reach) {
          continue;
        }

        if (c.spell === 'bomblightingzap') {
          t.hp = Math.max(0, +(t.hp - TD_STRIKE).toFixed(4));
        } else {
          t.paralyzed = TD_HOLD_SECONDS * TPS;
        }
      }

      world.emit({ what: 'td', who: TD_ME, data: { kind: 'cast', type: c.spell, x: c.x, y: c.y } });
      return null;
    }
  }
}
