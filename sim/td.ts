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
 *
 * The player's High Priest fights in the battle: sent about by the player, he strikes the horde
 * about him with lightning, blesses the guns near him (they hit harder), and where he stands his
 * ground he holds up the walkers that come up to him, as many as he can, while they beat at him;
 * beaten down, he lies a while, then stands again where he fell. He has two acts of his own, the
 * Rally (the guns about him hit far harder for a while) and the Storm Hammer (a blow on the horde
 * about a spot in his reach). His skills are bought with the campaign's stars (src/td-hud.js).
 */
import { H, TPS, Terrain, W, type Building, type Facing, type Priest, type Transport } from '../state.js';
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
  /** What a walker deals a second to the Priest who holds it up. */
  readonly strike?: number;
  /** Storm Power it carries off from the Temple as well. */
  readonly steals?: number;
  readonly air?: boolean;
  readonly note: string;
}

export const TD_FOES: Readonly<Record<string, TdFoe>> = {
  sunwalker: { hp: 90, speed: 1.3, bounty: 10, lives: 1, strike: 8, note: 'A lumbering Golem of sandstone: slow, and never alone' },
  firewalker: { hp: 45, speed: 2.2, bounty: 6, lives: 1, strike: 6, note: 'Fire Ants come quick, in swarms' },
  rainwalker: { hp: 240, speed: 1.8, bounty: 26, lives: 1, strike: 14, steals: 40, note: 'A Crystal Crab that reaches the Temple steals Storm Power as well' },
  windwalker: { hp: 150, speed: 2.8, bounty: 20, lives: 1, strike: 9, note: 'Sail Skaters are the fastest on the bridges' },
  bulf: { hp: 1100, speed: 1.0, bounty: 90, lives: 3, strike: 32, note: 'A shaggy Bulf takes long to bring down, and three lives' },
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

/** The High Priest's skills, each from 0 to 3, bought with the campaign's stars. */
export interface TdSkills {
  /** Lightning Hand: his bolts at the horde about him. */
  bolt: number;
  /** Blessing: the guns about him hit harder. */
  bless: number;
  /** Rally: for a while the guns about him hit far harder. */
  rally: number;
  /** Storm Hammer: a blow on the horde about a spot in his reach. */
  hammer: number;
  /** Stand: his hit points, how many walkers he holds up, how fast he mends and rises again. */
  stand: number;
  /** Temple Guard: who comes at his call, and how long they stay. */
  call: number;
  /** Swift Summons: how soon the Temple Guard may be called again. */
  muster: number;
}
export const TD_NO_SKILLS: TdSkills = { bolt: 0, bless: 0, rally: 0, hammer: 0, stand: 0, call: 0, muster: 0 };

/** What each level of a skill gives, levels 0 to 3. */
export const TD_HERO = {
  bolt: { damage: [16, 24, 34, 46], every: [1.4, 1.3, 1.2, 1.1], reach: [5, 5.5, 6, 6.5] },
  bless: { reach: [5, 6, 7, 8], hit: [1.12, 1.2, 1.28, 1.36] },
  rally: { seconds: [6, 7, 8, 9], hit: [1.5, 1.6, 1.75, 1.9], reach: 7, cooldown: [30, 27, 24, 20] },
  hammer: { damage: [150, 210, 280, 360], reach: [1.6, 1.8, 2.0, 2.3], range: 8, cooldown: [22, 20, 17, 14] },
  stand: { hp: [320, 400, 490, 600], holds: [1, 2, 2, 3], regen: [5, 6, 8, 10], down: [15, 13, 11, 9] },
} as const;

/**
 * The Temple Guard the Priest calls to a spot: Golems on the ground nearest it, standing there and
 * hurling stones at the walkers going by; from Temple Guard's second level a Balloon over them too,
 * dropping fire on the horde on the ground and in the air (half of it passing through a Cloud
 * Floater, as half of any shot does: rules/combat.ts). Each throws at one of the horde while it
 * stays in reach, else at the weakest in reach. None of them moves. Called before the horde comes,
 * they wait for it (`idle` seconds at most); from a guard's first throw it fights so long (`stay`,
 * by Temple Guard's level), then is gone. The Guard comes again only once all of it has gone and
 * the wait after (by Swift Summons's level) is over.
 */
export const TD_GUARD = {
  golems: [1, 2, 2, 3],
  balloons: [0, 0, 1, 1],
  stay: [20, 22, 24, 26],
  idle: 90,
  wait: [25, 20, 15, 10],
  /** Ticks a stone or a ball of fire is in the air before it strikes (as the client draws it). */
  flight: 4,
  golem: { type: 'sunwalker', damage: 30, every: 1, reach: 4 },
  balloon: { type: 'sunballoon', damage: 40, every: 0.8, reach: 5 },
} as const;

/** One of the Temple Guard: in the air or not; its ticks left (to fight once it has thrown, before
 * that to wait for the horde); the ticks to its next throw; whom it throws at; and its stone or fire
 * in the air (at whom, and the tick it strikes). */
export interface TdAlly {
  readonly air: boolean;
  left: number;
  fighting: boolean;
  next: number;
  mark: number;
  flying: { readonly to: number; readonly at: number; } | null;
}

/** The High Priest's pace in a battle, cells a second: a hero's, quicker than a Priest's own. */
export const TD_HERO_PACE = 3.2;

/** How long the client draws the Priest at an act (src/models.js, ns-units.js: 1.1 s at most). */
const ACT_TICKS = 12;

/** What the Priest did last and when, and where at (for the client, to draw him at it). */
export interface TdAct {
  readonly kind: 'bolt' | 'rally' | 'hammer' | 'call';
  readonly tick: number;
  readonly x: number;
  readonly y: number;
}

/** The High Priest in a battle: his own hit points (the rules keep his full, else they would lay
 * him down at half), how long he lies beaten down, his next bolt, the Rally, his acts' waits, and
 * the walkers he holds up. */
export interface TdHero {
  readonly id: number;
  readonly skills: TdSkills;
  hp: number;
  readonly hpMax: number;
  down: number;
  strike: number;
  rally: number;
  readonly cooldown: { rally: number; hammer: number; call: number; };
  readonly holding: Set<number>;
  act: TdAct | null;
}

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
  readonly hero: TdHero;
  /** The Temple Guard standing now, by id. */
  readonly allies: Map<number, TdAlly>;
}

/** What `paint` holds where a gun stands (td-map.ts lays them): a platform, an Arc gate's. */
const PLATFORM_PAINT = 2, GATE_PAINT = 3;

/** The airship half of whose shots pass through it (the rules' own, rules/combat.ts). */
const CLOUD_FLOATER = 'rainballoon';

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

/** A gun's hit, times: its power here, its rank, and the Priest's blessing or Rally if he stands
 * near it (a gun as the rules pass it about: a building, the copy of one a shot carries, or the id
 * of a flyer's base). */
export function tdHit(world: World, b: { id: number; type?: string; x?: number; y?: number; fx?: number; fy?: number; }): number {
  if (!world.td) {
    return 1;
  }

  const home = world.entities.get(b.id), gun = home?.kind === 'building' ? home : null;
  const type = b.type ?? gun?.type ?? '';
  const x = b.x ?? gun?.x, y = b.y ?? gun?.y, fx = b.fx ?? gun?.fx ?? 3, fy = b.fy ?? gun?.fy ?? 3;
  const near = x === undefined || y === undefined ? 1 : tdBlessing(world, x + fx / 2, y + fy / 2);
  return (TD_TOWERS[type]?.power ?? 1) * (TD_RANK_HIT[(world.td.ranks.get(b.id) ?? 1) - 1] ?? 1) * near;
}

/** What the Priest adds to the hit of a gun whose middle is at (x, y): his blessing within its
 * reach, the Rally's within its, whichever is more; nothing while he lies beaten down. */
export function tdBlessing(world: World, x: number, y: number): number {
  const hero = world.td?.hero, p = hero ? world.entities.get(hero.id) : undefined;

  if (!hero || hero.down > 0 || p?.kind !== 'priest') {
    return 1;
  }

  const d = Math.hypot(x - p.x - 0.5, y - p.y - 0.5), k = hero.skills;
  let hit = d <= TD_HERO.bless.reach[k.bless]! ? TD_HERO.bless.hit[k.bless]! : 1;

  if (hero.rally > 0 && d <= TD_HERO.rally.reach) {
    hit = Math.max(hit, TD_HERO.rally.hit[k.rally]!);
  }

  return hit;
}

/** Cells a gun reaches further at its rank (a gun as the rules pass it about: a building, or the
 * copy of one a shot carries). */
export function tdFurther(world: World, b: unknown): number {
  const id = (b as { id?: number; } | undefined)?.id;
  return world.td && id !== undefined ? TD_RANK_REACH[(world.td.ranks.get(id) ?? 1) - 1] ?? 0 : 0;
}

/** A walker's or airship's pace now, cells a second: its own here, slower while chilled. */
export function tdSpeed(world: World, t: Transport): number {
  if (world.td?.hero.holding.has(t.id) || world.td?.allies.has(t.id)) {
    return 0;
  }

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

/** The Priest's tick in a battle: lying beaten down, or standing, mending, holding up the walkers
 * that come up to him and taking their blows, and striking the horde about him with his bolts. */
function tickHero(world: World): void {
  const td = world.td!, hero = td.hero, k = hero.skills, p = world.entities.get(hero.id);

  if (p?.kind !== 'priest') {
    return;
  }

  for (const act of ['rally', 'hammer', 'call'] as const) {
    if (hero.cooldown[act] > 0) {
      hero.cooldown[act]--;
    }
  }

  if (hero.rally > 0) {
    hero.rally--;
  }

  // beaten down: he lies where he fell (the rules' way of a Priest down), then stands again
  if (hero.down > 0) {
    p.state = 'down';
    p.hp = 1;
    p.path = [];

    if (--hero.down === 0) {
      hero.hp = Math.round(hero.hpMax * 0.6);
      p.hp = p.hpMax;
      world.emit({ what: 'td', who: TD_ME, data: { kind: 'up', id: p.id } });
    }

    return;
  }

  p.hp = p.hpMax;
  const walking = p.path.length > 0;

  // the walkers he holds up: those still beside him, on the ground, while he stands his ground
  for (const id of hero.holding) {
    const t = world.entities.get(id);

    if (walking || t?.kind !== 'transport' || Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) > 1) {
      hero.holding.delete(id);
    }
  }

  if (!walking) {
    for (const [id, enemy] of td.enemies) {
      if (hero.holding.size >= TD_HERO.stand.holds[k.stand]!) {
        break;
      }

      const t = world.entities.get(id);

      if (t?.kind === 'transport' && !TD_FOES[enemy.type]?.air && !hero.holding.has(id) && Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) <= 1) {
        hero.holding.add(id);
        world.emit({ what: 'td', who: TD_ME, data: { kind: 'hold', id } });
      }
    }
  }

  // their blows, or his mending
  let blows = 0;

  for (const id of hero.holding) {
    const t = world.entities.get(id);
    blows += t?.kind === 'transport' ? (TD_FOES[t.type]?.strike ?? 5) / TPS : 0;
  }

  hero.hp = blows > 0 ? hero.hp - blows : Math.min(hero.hpMax, hero.hp + TD_HERO.stand.regen[k.stand]! / TPS);

  if (hero.hp <= 0) {
    hero.hp = 0;
    hero.down = TD_HERO.stand.down[k.stand]! * TPS;
    hero.holding.clear();
    hero.rally = 0;
    p.state = 'down';
    p.hp = 1;
    p.path = [];
    world.emit({ what: 'td', who: TD_ME, data: { kind: 'down', id: p.id, n: TD_HERO.stand.down[k.stand]! } });
    return;
  }

  // his bolt: at one he holds up, else the nearest of the horde within his reach, on the ground or
  // in the air
  if (hero.strike > 0) {
    hero.strike--;
    return;
  }

  let target: Transport | null = null, nearest = Infinity;

  for (const [id] of td.enemies) {
    const t = world.entities.get(id);

    if (t?.kind !== 'transport' || t.hp <= 0) {
      continue;
    }

    const d = hero.holding.has(id) ? -1 : Math.hypot(t.x - p.x, t.y - p.y);

    if (d <= TD_HERO.bolt.reach[k.bolt]! && d < nearest) {
      nearest = d;
      target = t;
    }
  }

  if (target) {
    target.hp = Math.max(0, +(target.hp - TD_HERO.bolt.damage[k.bolt]!).toFixed(4));
    hero.strike = Math.round(TD_HERO.bolt.every[k.bolt]! * TPS);

    // (a bolt does not cut short the drawing of a greater act just done)
    if (!hero.act || hero.act.kind === 'bolt' || world.tick - hero.act.tick > ACT_TICKS) {
      hero.act = { kind: 'bolt', tick: world.tick, x: target.x, y: target.y };
    }

    world.emit({ what: 'td', who: TD_ME, data: { kind: 'bolt', id: target.id } });
  }
}

/** The Temple Guard's tick: each one's throws (at its mark while that one stays in its reach, else
 * at the weakest of the horde in its reach: a Golem at the walkers only, a Balloon at all), striking
 * where they come down; its time to fight from its first throw, gone when it is up (or when no one
 * came by in time). With the Guard all gone, the wait before it may be called again. */
function tickGuard(world: World): void {
  const td = world.td!, hero = td.hero;
  let gone = false;

  for (const [id, ally] of td.allies) {
    const a = world.entities.get(id);

    if (a?.kind !== 'transport') {
      td.allies.delete(id);
      gone = true;
      continue;
    }

    const arm = ally.air ? TD_GUARD.balloon : TD_GUARD.golem;

    // its stone or fire comes down on its mark, struck harder about the Priest (as with the guns'
    // shots, half of what is thrown at a Cloud Floater passes through it)
    if (ally.flying && world.tick >= ally.flying.at) {
      const t = world.entities.get(ally.flying.to);

      if (t?.kind === 'transport' && t.hp > 0 && (t.type !== CLOUD_FLOATER || world.rng.int(2) !== 0)) {
        t.hp = Math.max(0, +(t.hp - arm.damage * tdBlessing(world, a.x + 0.5, a.y + 0.5)).toFixed(4));
      }

      ally.flying = null;
    }

    if (--ally.left <= 0) {
      td.allies.delete(id);
      gone = true;
      removeTransport(world, a);
      world.emit({ what: 'td', who: TD_ME, data: { kind: 'dismissed', id, x: a.x, y: a.y, air: ally.air } });
      continue;
    }

    if (ally.next > 0) {
      ally.next--;
      continue;
    }

    // its mark while that one stays in its reach; else the weakest in its reach
    const within = (t: Transport): boolean => t.hp > 0 && (ally.air || !TD_FOES[td.enemies.get(t.id)!.type]?.air) && Math.hypot(t.x - a.x, t.y - a.y) <= arm.reach;
    const marked = td.enemies.has(ally.mark) ? world.entities.get(ally.mark) : undefined;
    let target: Transport | null = marked?.kind === 'transport' && within(marked) ? marked : null;

    for (const [eid] of target ? [] : td.enemies) {
      const t = world.entities.get(eid);

      if (t?.kind === 'transport' && within(t) && (!target || t.hp < target.hp)) {
        target = t;
      }
    }

    if (target) {
      // its time to fight runs from its first throw
      if (!ally.fighting) {
        ally.fighting = true;
        ally.left = TD_GUARD.stay[hero.skills.call]! * TPS;
      }

      ally.mark = target.id;
      ally.flying = { to: target.id, at: world.tick + TD_GUARD.flight };
      ally.next = Math.round(arm.every * TPS);
      world.emit({ what: 'td', who: TD_ME, data: { kind: 'shot', id, to: target.id, air: ally.air } });
    }
  }

  if (gone && !td.allies.size) {
    hero.cooldown.call = TD_GUARD.wait[hero.skills.muster]! * TPS;
  }
}

/** The ground about a spot the Temple Guard's Golems may stand on, nearest first: the islands and
 * bridges, not a gun's platform nor under a building. */
function guardGround(world: World, cx: number, cy: number): [number, number, number][] {
  const td = world.td!, taken = new Set<number>(), ground: [number, number, number][] = [];

  for (const e of world.entities.values()) {
    if (e.kind === 'building') {
      for (let y = e.y; y < e.y + e.fy; y++) {
        for (let x = e.x; x < e.x + e.fx; x++) {
          taken.add(world.at(x, y));
        }
      }
    }
  }

  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx, y = cy + dy;

      if (x < 0 || y < 0 || x >= W || y >= H) {
        continue;
      }

      const i = world.at(x, y), t = world.terrain[i];

      if ((t === Terrain.Island || t === Terrain.HardBridge) && td.paint[i] !== PLATFORM_PAINT && td.paint[i] !== GATE_PAINT && !taken.has(i)) {
        ground.push([x, y, Math.hypot(dx, dy)]);
      }
    }
  }

  return ground.sort((a, b) => a[2] - b[2]);
}

/** Where the Temple Guard's Golems would stand, called to a cell: none if it may not be called
 * there (no ground on or beside it). */
export function tdGuardCells(world: World, cx: number, cy: number): [number, number][] {
  const ground = cx >= 0 && cy >= 0 && cx < W && cy < H ? guardGround(world, cx, cy) : [];

  if (!ground.length || ground[0]![2] > 1.5) {
    return [];
  }

  return ground.slice(0, TD_GUARD.golems[world.td!.hero.skills.call]!).map(([x, y]) => [x, y]);
}

/** The Temple Guard called to a spot on or beside the ground: its Golems on the ground nearest the
 * spot, its Balloon over it. It comes whether the Priest stands or lies beaten down. */
function callGuard(world: World, tx: number | undefined, ty: number | undefined): CommandError | null {
  const td = world.td!, hero = td.hero, k = hero.skills;

  if (tx === undefined || ty === undefined) {
    return 'bad target';
  }

  const cx = Math.floor(tx), cy = Math.floor(ty);

  if (cx < 0 || cy < 0 || cx >= W || cy >= H) {
    return 'bad coordinates';
  }

  // (not while it is out, nor before the wait after it is over)
  if (hero.cooldown.call > 0 || td.allies.size) {
    return 'not ready';
  }

  const cells = tdGuardCells(world, cx, cy);

  if (!cells.length) {
    return 'bad target';
  }

  const idle = TD_GUARD.idle * TPS, golems = cells.length;

  for (let n = 0; n < golems; n++) {
    const [x, y] = cells[n]!;
    const t = world.spawnTransport(TD_GUARD.golem.type, TD_ME, x, y);
    // their first blows a little apart
    td.allies.set(t.id, { air: false, left: idle, fighting: false, next: n * 3, mark: 0, flying: null });
  }

  for (let n = 0; n < TD_GUARD.balloons[k.call]!; n++) {
    const t = world.spawnTransport(TD_GUARD.balloon.type, TD_ME, cx, cy);
    t.aloft = true;
    td.allies.set(t.id, { air: true, left: idle, fighting: false, next: 0, mark: 0, flying: null });
  }

  const p = world.entities.get(hero.id);

  if (p?.kind === 'priest' && hero.down === 0) {
    hero.act = { kind: 'call', tick: world.tick, x: cx, y: cy };
  }

  world.emit({ what: 'td', who: TD_ME, data: { kind: 'guard', x: cx, y: cy, n: golems + TD_GUARD.balloons[k.call]! } });
  return null;
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

  tickHero(world);
  tickGuard(world);

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
      td.hero.holding.delete(id);
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
      td.hero.holding.delete(id);
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

type TdCommand = Extract<Command, { t: 'tdBuild' | 'tdUpgrade' | 'tdSell' | 'tdTurn' | 'tdWave' | 'tdCast' | 'tdHero'; }>;

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
    case 'tdHero': {
      const hero = td.hero, k = hero.skills, p = world.entities.get(hero.id);

      if (c.act === 'call') {
        return callGuard(world, c.tx, c.ty);
      }

      if (p?.kind !== 'priest' || hero.down > 0) {
        return 'priest unavailable';
      }

      if (c.act === 'rally') {
        if (hero.cooldown.rally > 0) {
          return 'not ready';
        }

        hero.rally = TD_HERO.rally.seconds[k.rally]! * TPS;
        hero.cooldown.rally = TD_HERO.rally.cooldown[k.rally]! * TPS;
        hero.act = { kind: 'rally', tick: world.tick, x: p.x, y: p.y };
        world.emit({ what: 'td', who: TD_ME, data: { kind: 'rally', id: p.id } });
        return null;
      }

      if (c.act !== 'hammer') {
        return 'not here';
      }

      if (hero.cooldown.hammer > 0) {
        return 'not ready';
      }

      if (c.tx === undefined || c.ty === undefined || Math.hypot(c.tx - p.x, c.ty - p.y) > TD_HERO.hammer.range) {
        return 'too far';
      }

      hero.cooldown.hammer = TD_HERO.hammer.cooldown[k.hammer]! * TPS;
      hero.act = { kind: 'hammer', tick: world.tick, x: c.tx, y: c.ty };

      for (const [id] of td.enemies) {
        const t = world.entities.get(id);

        if (t?.kind === 'transport' && Math.hypot(t.x - c.tx, t.y - c.ty) <= TD_HERO.hammer.reach[k.hammer]!) {
          t.hp = Math.max(0, +(t.hp - TD_HERO.hammer.damage[k.hammer]!).toFixed(4));
        }
      }

      world.emit({ what: 'td', who: TD_ME, data: { kind: 'hammer', id: p.id, x: c.tx, y: c.ty } });
      return null;
    }
  }
}

/** The Priest of a battle, standing or beaten down. */
export function tdPriest(world: World): Priest | null {
  const p = world.td ? world.entities.get(world.td.hero.id) : undefined;
  return p?.kind === 'priest' ? p : null;
}
