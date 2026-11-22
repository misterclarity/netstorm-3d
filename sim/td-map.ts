/**
 * The Bridges of Nimbus (netstorm-3d): the six battles of the tower defense campaign, laid out.
 * Laid into netstorm-web's simulation as td-map.ts by scripts/house-rules.mjs; the rules of a
 * battle are rules/td.ts (sim/td.ts), and the client tells and draws them (src/td-hud.js,
 * src/components/ns-td.js). The battles, their names and their maps are made up here.
 *
 * A battle's map is its routes: each from a storm gate, where the horde appears, by way of turning
 * islands joined by straight bridges (a walker's), or straight through the air between its points
 * (an airship's), to the door of the player's Temple. Beside the bridges float the stone platforms
 * a gun may be raised on: beside a bridge for an archer, or on a turning island in line with a
 * bridge, for a cannon to fire down its length; and at an Arc gate, a pair across a bridge.
 */
import { World } from './world.js';
import { Terrain, W, H } from './state.js';
import type { DefTable, Theme } from './defs.js';
import { TD_FOE, TD_HERO, TD_ME, TD_NO_SKILLS, TD_TOWERS, type Td, type TdGroup, type TdRoute, type TdSkills, type TdSpot } from './rules/td.js';

/** How the client draws the ground of a cell of a battle (0: as its island is). */
export const TD_PAINT = { road: 1, platform: 2, gate: 3 } as const;

export type TdLevelId = 'mossbridge' | 'ferries' | 'cloudwatch' | 'skaters' | 'bulfback' | 'hollowgate';

type Point = readonly [number, number];

/** Where a platform is: beside a bridge (route, segment, how far along it 0 to 1, which side), or
 * in line with a bridge at a turn (route, the turn's point, 'in' to fire back along the bridge
 * that comes to it, 'out' along the one that leaves it), or at a cell (its 3×3 anchor). */
type SpotSpec =
  | readonly ['beside', number, number, number, -1 | 1]
  | readonly ['end', number, number, 'in' | 'out']
  | readonly ['at', number, number];

interface LevelSpec {
  readonly storm: number;
  /** The horde's hit points in this battle, times (1 if not given). */
  readonly hp?: number;
  readonly lives: number;
  readonly foe: Theme;
  readonly towers: readonly string[];
  readonly spells: readonly string[];
  /** Each route's points: its storm gate, its turns, the Temple's door; an airship's flies straight
   * between them. */
  readonly routes: readonly { readonly via: readonly Point[]; readonly air?: boolean; }[];
  /** The Temple's anchor (8×6). */
  readonly temple: Point;
  readonly spots: readonly SpotSpec[];
  /** Arc gates: route, segment, how far along it. */
  readonly gates: readonly (readonly [number, number, number])[];
  /** Islands of the scenery, with nothing on them: their middle and half sizes. */
  readonly isles: readonly (readonly [number, number, number, number])[];
  readonly waves: readonly (readonly TdGroup[])[];
  /** Seconds between the last of a wave and the next. */
  readonly gap: number;
}

/** `n` walkers or airships of a kind, `every` seconds apart from `at` seconds into the wave, along
 * route `route`, their hit points times `hp`. */
function g(foe: string, n: number, every: number, at = 0, route = 0, hp = 1, flagship = false): TdGroup {
  return flagship ? { foe, n, every, at, route, hp, flagship } : { foe, n, every, at, route, hp };
}

const GOLEM = 'sunwalker', ANT = 'firewalker', CRAB = 'rainwalker', SKATER = 'windwalker', BULF = 'bulf';
const BALLOON = 'sunballoon', FLOATER = 'rainballoon', AIRSHIP = 'windballoon';

const LEVELS: Readonly<Record<TdLevelId, LevelSpec>> = {
  // a single way, back and forth between six islands: Golems and Fire Ants
  mossbridge: {
    storm: 420,
    hp: 1.3,
    lives: 20,
    foe: 'sun',
    towers: ['sunarcher', 'windarcher'],
    spells: ['bomblightingzap'],
    routes: [{ via: [[82, 108], [102, 108], [102, 130], [124, 130], [124, 110], [146, 110], [146, 132], [167, 132]] }],
    temple: [168, 129],
    spots: [
      ['beside', 0, 0, 0.5, -1], ['beside', 0, 0, 0.55, 1],
      ['end', 0, 1, 'in'],
      ['beside', 0, 1, 0.5, 1], ['beside', 0, 1, 0.45, -1],
      ['beside', 0, 2, 0.5, -1], ['beside', 0, 2, 0.5, 1],
      ['beside', 0, 3, 0.5, -1], ['beside', 0, 3, 0.55, 1],
      ['beside', 0, 4, 0.5, 1], ['beside', 0, 4, 0.45, -1],
      ['beside', 0, 5, 0.5, -1], ['beside', 0, 5, 0.5, 1],
      ['beside', 0, 6, 0.5, -1],
    ],
    gates: [],
    isles: [[92, 140, 6, 4], [136, 146, 5, 3], [160, 98, 5, 4], [112, 94, 4, 3], [178, 150, 4, 3]],
    gap: 22,
    waves: [
      [g(GOLEM, 6, 2.6)],
      [g(GOLEM, 9, 2.0)],
      [g(ANT, 12, 1.0)],
      [g(GOLEM, 8, 2.0), g(ANT, 10, 0.9, 9)],
      [g(GOLEM, 14, 1.5, 0, 0, 1.3)],
      [g(ANT, 16, 0.7, 0, 0, 1.3), g(GOLEM, 10, 1.6, 6, 0, 1.6)],
    ],
  },
  // two ferries from the west meet at an island, and go on as one: Crystal Crabs
  ferries: {
    storm: 560,
    hp: 1.3,
    lives: 20,
    foe: 'rain',
    towers: ['sunarcher', 'windarcher', 'raincannon'],
    spells: ['bomblightingzap', 'bombparalyze'],
    routes: [
      { via: [[82, 100], [104, 100], [104, 124], [128, 124], [128, 104], [152, 104], [152, 126], [171, 126]] },
      { via: [[82, 150], [104, 150], [104, 124], [128, 124], [128, 104], [152, 104], [152, 126], [171, 126]] },
    ],
    temple: [172, 123],
    spots: [
      ['beside', 0, 0, 0.5, 1], ['beside', 1, 0, 0.5, -1],
      ['beside', 0, 1, 0.55, -1], ['beside', 1, 1, 0.55, -1],
      ['beside', 0, 1, 0.5, 1], ['beside', 1, 1, 0.5, 1],
      ['end', 0, 2, 'out'],
      ['beside', 0, 2, 0.5, 1], ['beside', 0, 2, 0.55, -1],
      ['end', 0, 3, 'in'],
      ['beside', 0, 4, 0.5, -1], ['beside', 0, 4, 0.5, 1],
      ['beside', 0, 5, 0.5, -1], ['beside', 0, 5, 0.5, 1],
      ['end', 0, 6, 'in'],
    ],
    gates: [],
    isles: [[84, 125, 5, 4], [140, 146, 6, 4], [118, 88, 5, 3], [168, 102, 4, 3], [160, 148, 4, 3]],
    gap: 22,
    waves: [
      [g(GOLEM, 8, 1.8), g(GOLEM, 8, 1.8, 0, 1)],
      [g(ANT, 10, 0.9), g(ANT, 10, 0.9, 4, 1)],
      [g(CRAB, 4, 3.0), g(GOLEM, 8, 1.6, 2, 1)],
      [g(GOLEM, 10, 1.4, 0, 0, 1.3), g(CRAB, 5, 2.5, 6, 1)],
      [g(ANT, 14, 0.7, 0, 1, 1.3), g(CRAB, 6, 2.2, 4, 0)],
      [g(CRAB, 8, 2.0, 0, 0, 1.2), g(CRAB, 8, 2.0, 1, 1, 1.2)],
      [g(GOLEM, 14, 1.0, 0, 0, 1.6), g(ANT, 16, 0.6, 2, 1, 1.5), g(CRAB, 6, 2.0, 10, 0, 1.3)],
      [g(CRAB, 12, 1.4, 0, 0, 1.5), g(CRAB, 12, 1.4, 0.7, 1, 1.5), g(GOLEM, 12, 1.0, 8, 0, 1.8)],
    ],
  },
  // a winding way below, and the air above it from the north: Balloons and Cloud Floaters
  cloudwatch: {
    storm: 650,
    hp: 1.0,
    lives: 20,
    foe: 'wind',
    towers: ['sunarcher', 'windarcher', 'raincannon', 'thunderarcher'],
    spells: ['bomblightingzap', 'bombparalyze'],
    routes: [
      { via: [[82, 126], [102, 126], [102, 104], [126, 104], [126, 148], [150, 148], [150, 126], [169, 126]] },
      { via: [[92, 88], [114, 116], [140, 116], [158, 126], [169, 126]], air: true },
    ],
    temple: [170, 123],
    spots: [
      ['beside', 0, 0, 0.5, 1], ['beside', 0, 0, 0.5, -1],
      ['beside', 0, 1, 0.5, 1], ['end', 0, 2, 'in'],
      ['beside', 0, 2, 0.5, 1], ['beside', 0, 2, 0.5, -1],
      ['beside', 0, 3, 0.3, -1], ['beside', 0, 3, 0.3, 1], ['beside', 0, 3, 0.75, 1], ['beside', 0, 3, 0.75, -1],
      ['end', 0, 4, 'in'],
      ['beside', 0, 4, 0.5, -1], ['beside', 0, 5, 0.5, 1], ['beside', 0, 5, 0.45, -1],
      ['beside', 0, 6, 0.5, 1],
    ],
    gates: [],
    isles: [[88, 146, 6, 4], [146, 94, 6, 4], [112, 132, 4, 3], [174, 146, 5, 3], [176, 104, 4, 3]],
    gap: 22,
    waves: [
      [g(GOLEM, 10, 1.6)],
      [g(BALLOON, 4, 3.0, 0, 1), g(GOLEM, 8, 1.6, 4)],
      [g(ANT, 14, 0.8, 0, 0, 1.2), g(BALLOON, 5, 2.5, 6, 1)],
      [g(CRAB, 6, 2.2), g(BALLOON, 6, 2.0, 4, 1, 1.2)],
      [g(FLOATER, 4, 3.0, 0, 1), g(GOLEM, 12, 1.2, 2, 0, 1.4)],
      [g(CRAB, 8, 1.8, 0, 0, 1.3), g(FLOATER, 5, 2.6, 8, 1, 1.2)],
      [g(BALLOON, 10, 1.4, 0, 1, 1.4), g(ANT, 18, 0.5, 3, 0, 1.6)],
      [g(FLOATER, 8, 2.0, 0, 1, 1.3), g(CRAB, 10, 1.5, 2, 0, 1.5)],
      [g(GOLEM, 16, 0.9, 0, 0, 2.0), g(FLOATER, 8, 1.8, 6, 1, 1.5), g(BALLOON, 10, 1.0, 12, 1, 1.6)],
    ],
  },
  // two long straight bridges, the Sail Skaters' road: cannons down their lines, and Arc gates
  skaters: {
    storm: 800,
    hp: 0.71,
    lives: 20,
    foe: 'wind',
    towers: ['sunarcher', 'windarcher', 'raincannon', 'thunderarcher', 'suncannon', 'thunderfence'],
    spells: ['bomblightingzap', 'bombparalyze'],
    routes: [
      { via: [[80, 104], [148, 104], [148, 128], [169, 128]] },
      { via: [[80, 152], [122, 152], [122, 128], [148, 128], [169, 128]] },
      { via: [[100, 86], [132, 112], [158, 124], [169, 128]], air: true },
    ],
    temple: [170, 125],
    spots: [
      ['end', 0, 1, 'in'], ['end', 1, 1, 'in'],
      ['beside', 0, 0, 0.25, 1], ['beside', 0, 0, 0.45, -1], ['beside', 0, 0, 0.65, 1], ['beside', 0, 0, 0.85, -1],
      ['beside', 1, 0, 0.3, -1], ['beside', 1, 0, 0.6, 1], ['beside', 1, 0, 0.8, -1],
      ['beside', 1, 1, 0.5, -1], ['end', 1, 2, 'in'],
      ['beside', 0, 1, 0.5, -1], ['beside', 0, 2, 0.5, 1], ['beside', 0, 2, 0.5, -1],
    ],
    gates: [[0, 0, 0.12], [1, 0, 0.15], [0, 1, 0.75]],
    isles: [[104, 128, 7, 5], [90, 128, 3, 3], [172, 106, 5, 3], [176, 150, 5, 4], [140, 160, 4, 3]],
    gap: 20,
    waves: [
      [g(SKATER, 6, 2.0)],
      [g(GOLEM, 12, 1.2, 0, 1, 1.4), g(SKATER, 6, 1.8, 6, 0)],
      [g(SKATER, 10, 1.2, 0, 1), g(BALLOON, 6, 2.0, 4, 2, 1.3)],
      [g(CRAB, 8, 1.8, 0, 0, 1.4), g(SKATER, 8, 1.4, 3, 1, 1.2)],
      [g(SKATER, 12, 1.0, 0, 0, 1.3), g(FLOATER, 5, 2.4, 4, 2, 1.3)],
      [g(ANT, 20, 0.5, 0, 1, 1.8), g(SKATER, 10, 1.0, 5, 0, 1.4)],
      [g(CRAB, 10, 1.4, 0, 1, 1.6), g(BALLOON, 12, 1.0, 2, 2, 1.6)],
      [g(SKATER, 16, 0.8, 0, 0, 1.6), g(SKATER, 16, 0.8, 0.4, 1, 1.6)],
      [g(FLOATER, 10, 1.6, 0, 2, 1.6), g(CRAB, 12, 1.2, 2, 0, 1.8), g(GOLEM, 14, 0.9, 4, 1, 2.4)],
      [g(SKATER, 20, 0.6, 0, 0, 2.0), g(SKATER, 20, 0.6, 0.3, 1, 2.0), g(BALLOON, 12, 0.9, 6, 2, 2.0)],
    ],
  },
  // the Bulfs' pass: a long way through the islands, Air Ships over it
  bulfback: {
    storm: 900,
    hp: 0.75,
    lives: 20,
    foe: 'thunder',
    towers: ['sunarcher', 'windarcher', 'raincannon', 'thunderarcher', 'suncannon', 'thunderfence', 'thundercannon', 'rainaviary'],
    spells: ['bomblightingzap', 'bombparalyze'],
    routes: [
      { via: [[80, 112], [104, 112], [104, 140], [128, 140], [128, 112], [152, 112], [152, 136], [171, 136]] },
      { via: [[90, 160], [120, 152], [150, 152], [171, 136]], air: true },
    ],
    temple: [172, 133],
    spots: [
      ['beside', 0, 0, 0.5, -1], ['beside', 0, 0, 0.5, 1], ['end', 0, 1, 'in'],
      ['beside', 0, 1, 0.5, -1], ['beside', 0, 1, 0.5, 1], ['end', 0, 2, 'in'],
      ['beside', 0, 2, 0.5, -1], ['end', 0, 3, 'in'], ['beside', 0, 3, 0.5, 1],
      ['beside', 0, 4, 0.5, 1], ['beside', 0, 4, 0.5, -1], ['end', 0, 5, 'in'],
      ['beside', 0, 5, 0.5, -1], ['beside', 0, 5, 0.5, 1], ['beside', 0, 6, 0.5, -1],
    ],
    gates: [[0, 1, 0.3], [0, 3, 0.3], [0, 5, 0.7]],
    isles: [[92, 94, 6, 4], [140, 96, 5, 3], [116, 160, 4, 3], [176, 154, 5, 4], [88, 134, 4, 3]],
    gap: 22,
    waves: [
      [g(GOLEM, 12, 1.2, 0, 0, 1.6), g(ANT, 10, 0.8, 8, 0, 1.6)],
      [g(BULF, 2, 6.0), g(GOLEM, 10, 1.2, 3, 0, 1.6)],
      [g(SKATER, 10, 1.0, 0, 0, 1.4), g(BALLOON, 8, 1.6, 4, 1, 1.5)],
      [g(BULF, 3, 4.0, 0, 0, 1.2), g(CRAB, 8, 1.6, 2, 0, 1.5)],
      [g(AIRSHIP, 2, 6.0, 0, 1), g(ANT, 20, 0.5, 2, 0, 2.0)],
      [g(BULF, 4, 3.5, 0, 0, 1.4), g(FLOATER, 6, 2.0, 4, 1, 1.5)],
      [g(SKATER, 14, 0.8, 0, 0, 1.8), g(CRAB, 10, 1.2, 5, 0, 1.8)],
      [g(AIRSHIP, 3, 4.0, 0, 1, 1.3), g(BULF, 4, 3.0, 2, 0, 1.6)],
      [g(GOLEM, 20, 0.7, 0, 0, 2.6), g(BALLOON, 14, 0.9, 4, 1, 2.0)],
      [g(BULF, 6, 2.5, 0, 0, 1.8), g(SKATER, 14, 0.7, 6, 0, 2.0), g(FLOATER, 8, 1.6, 3, 1, 1.8)],
      // Old Thunderhide, the greatest of the Bulfs
      [g(CRAB, 12, 1.0, 0, 0, 2.0), g(BULF, 1, 1, 10, 0, 7.0), g(AIRSHIP, 4, 3.0, 4, 1, 1.6)],
    ],
  },
  // the Hollow Priest's own gate: two ways and the air, and his flagship at the last
  hollowgate: {
    storm: 1150,
    hp: 0.63,
    lives: 20,
    foe: 'thunder',
    towers: ['sunarcher', 'windarcher', 'raincannon', 'thunderarcher', 'suncannon', 'thunderfence', 'thundercannon', 'rainaviary'],
    spells: ['bomblightingzap', 'bombparalyze'],
    routes: [
      { via: [[80, 100], [102, 100], [102, 122], [128, 122], [128, 102], [150, 102], [150, 128], [171, 128]] },
      { via: [[80, 156], [102, 156], [102, 136], [128, 136], [128, 154], [150, 154], [150, 128], [171, 128]] },
      { via: [[84, 128], [100, 116], [120, 129], [140, 116], [160, 129], [171, 128]], air: true },
    ],
    temple: [172, 125],
    spots: [
      ['beside', 0, 0, 0.5, 1], ['beside', 1, 0, 0.5, -1],
      ['end', 0, 1, 'in'], ['end', 1, 1, 'in'],
      ['beside', 0, 1, 0.5, 1], ['beside', 1, 1, 0.5, 1],
      ['beside', 0, 2, 0.5, 1], ['beside', 1, 2, 0.5, -1],
      ['beside', 0, 3, 0.5, -1], ['beside', 1, 3, 0.5, 1],
      ['end', 0, 3, 'in'], ['end', 1, 3, 'in'],
      ['beside', 0, 4, 0.5, -1], ['beside', 1, 4, 0.5, 1],
      ['beside', 0, 5, 0.5, -1], ['beside', 1, 5, 0.5, -1],
      ['beside', 0, 6, 0.5, -1],
    ],
    gates: [[0, 0, 0.3], [1, 0, 0.3], [0, 4, 0.2], [1, 4, 0.2]],
    isles: [[114, 112, 4, 3], [114, 146, 4, 3], [140, 128, 4, 3], [176, 108, 5, 3], [176, 150, 5, 3]],
    gap: 22,
    waves: [
      [g(GOLEM, 12, 1.1, 0, 0, 1.8), g(GOLEM, 12, 1.1, 0.5, 1, 1.8)],
      [g(SKATER, 10, 1.0, 0, 0, 1.6), g(BALLOON, 8, 1.5, 3, 2, 1.8)],
      [g(CRAB, 10, 1.3, 0, 1, 1.8), g(ANT, 20, 0.5, 2, 0, 2.2)],
      [g(BULF, 3, 3.5, 0, 0, 1.6), g(BULF, 3, 3.5, 1.7, 1, 1.6)],
      [g(FLOATER, 8, 1.8, 0, 2, 1.8), g(SKATER, 14, 0.8, 2, 1, 2.0)],
      [g(AIRSHIP, 3, 4.0, 0, 2, 1.5), g(CRAB, 12, 1.1, 1, 0, 2.2)],
      [g(GOLEM, 24, 0.6, 0, 0, 3.0), g(GOLEM, 24, 0.6, 0.3, 1, 3.0)],
      [g(BULF, 5, 2.6, 0, 1, 2.0), g(BALLOON, 16, 0.8, 2, 2, 2.4)],
      [g(SKATER, 18, 0.6, 0, 0, 2.4), g(SKATER, 18, 0.6, 0.3, 1, 2.4), g(FLOATER, 8, 1.6, 6, 2, 2.2)],
      [g(AIRSHIP, 5, 3.0, 0, 2, 1.8), g(BULF, 6, 2.2, 2, 0, 2.2), g(CRAB, 14, 0.9, 4, 1, 2.4)],
      [g(ANT, 30, 0.35, 0, 0, 3.0), g(ANT, 30, 0.35, 0.2, 1, 3.0), g(BULF, 4, 3.0, 8, 0, 2.6)],
      // the Hollow Priest's flagship, and his last walkers about it
      [g(AIRSHIP, 1, 1, 0, 2, 11, true), g(BULF, 4, 4.0, 2, 0, 2.6), g(BULF, 4, 4.0, 4, 1, 2.6), g(SKATER, 16, 0.8, 8, 0, 2.6)],
    ],
  },
};

/** The battles, in the campaign's order. */
export const TD_LEVELS: readonly TdLevelId[] = ['mossbridge', 'ferries', 'cloudwatch', 'skaters', 'bulfback', 'hollowgate'];

/** What a battle has: its guns, Spells and waves, the horde's kinds, its lives and Storm Power. */
export function tdLevel(id: TdLevelId): { towers: readonly string[]; spells: readonly string[]; waves: number; foes: string[]; lives: number; storm: number; foe: Theme; } {
  const L = LEVELS[id];
  const foes = [...new Set(L.waves.flatMap((wave) => wave.map((group) => group.foe)))];
  return { towers: L.towers, spells: L.spells, waves: L.waves.length, foes, lives: L.lives, storm: L.storm, foe: L.foe };
}

/** A number from 0 to 1 for a cell and a key: the same for the same. */
function hash(x: number, y: number, k: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + k * 2246822519, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** The cells of a straight walk from a to b: a walker's along a row or a column, an airship's in
 * steps of one cell either way. */
function walk(a: Point, b: Point): [number, number][] {
  const cells: [number, number][] = [];
  const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));

  for (let i = 1; i <= n; i++) {
    cells.push([Math.round(a[0] + ((b[0] - a[0]) * i) / n), Math.round(a[1] + ((b[1] - a[1]) * i) / n)]);
  }

  return cells;
}

class Lay {
  readonly w: World;
  readonly paint = new Uint8Array(W * H);
  /** Cells a walker walks: no platform on them. */
  readonly way = new Set<number>();

  constructor(w: World) {
    this.w = w;
  }

  at(x: number, y: number): number {
    return y * W + x;
  }

  land(x: number, y: number): void {
    const i = this.at(x, y);

    if (this.w.terrain[i] === Terrain.Sky) {
      this.w.terrain[i] = Terrain.Island;
      this.w.owner[i] = TD_ME;
    }
  }

  /** An island about (cx, cy), `rx` by `ry` cells either side, its rim waving. */
  island(cx: number, cy: number, rx: number, ry: number, seed: number): void {
    for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++) {
      for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        const wave = 1 + 0.12 * Math.sin(Math.atan2(dy, dx) * 5 + seed) + 0.06 * (hash(x, y, seed) - 0.5);

        if (Math.abs(dx) ** 2.4 + Math.abs(dy) ** 2.4 <= wave) {
          this.land(x, y);
        }
      }
    }
  }

  /** A walker's way along a route's points: bridge over the sky, a road over the islands. */
  road(via: readonly Point[]): [number, number][] {
    const cells: [number, number][] = [[via[0]![0], via[0]![1]]];

    for (let k = 1; k < via.length; k++) {
      const a = via[k - 1]!, b = via[k]!, across = a[0] === b[0];

      for (const [x, y] of walk(a, b)) {
        cells.push([x, y]);
      }

      for (const [x, y] of [[a[0], a[1]] as const, ...walk(a, b)]) {
        const i = this.at(x, y);
        this.way.add(i);

        if (this.w.terrain[i] === Terrain.Sky || this.w.terrain[i] === Terrain.HardBridge) {
          this.w.terrain[i] = Terrain.HardBridge;
          this.w.owner[i] = 0;
          // a crossing of two ways is joined all four ways
          this.w.links[i] = (this.w.links[i] ?? 0) | (across ? 5 : 10);
        } else {
          this.paint[i] = TD_PAINT.road;
        }
      }
    }

    return cells;
  }

  /** A platform of 3×3 at an anchor: stone, an islet of its own if over the sky. */
  platform(x: number, y: number, paint: number = TD_PAINT.platform): void {
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const i = this.at(x + dx, y + dy);

        if (this.way.has(i)) {
          throw new Error(`a platform at ${x},${y} is on the way at ${x + dx},${y + dy}`);
        }

        this.land(x + dx, y + dy);
        this.paint[i] = paint;
      }
    }
  }
}

/** The anchor of a platform beside a segment of a route: at `t` along it, on `side` (-1 north or
 * west, 1 south or east), a cell of sky between it and the bridge. */
function beside(via: readonly Point[], seg: number, t: number, side: number): Point {
  const a = via[seg]!, b = via[seg + 1]!;
  const px = Math.round(a[0] + (b[0] - a[0]) * t), py = Math.round(a[1] + (b[1] - a[1]) * t);
  return a[0] === b[0] ? [px + side * 3 - 1, py - 1] : [px - 1, py + side * 3 - 1];
}

/** The anchor of a platform at a route's turn `k`, in line with the bridge that comes to it ('in':
 * beyond the turn, facing back along it) or the one that leaves it ('out': behind the turn). */
function inLine(via: readonly Point[], k: number, which: 'in' | 'out'): Point {
  const p = via[k]!, from = which === 'in' ? via[k - 1]! : via[k + 1]!;
  const dx = Math.sign(p[0] - from[0]), dy = Math.sign(p[1] - from[1]);
  return [p[0] + dx * 3 - 1, p[1] + dy * 3 - 1];
}

/** Lay out a battle: its islands, bridges and platforms, the Temple, the player's Priest with the
 * skills bought for him. */
export function createTd(defs: DefTable, id: TdLevelId, skills: TdSkills = TD_NO_SKILLS): World {
  const L = LEVELS[id];
  const w = new World(defs, 7000 + TD_LEVELS.indexOf(id));
  w.addPlayer(TD_ME, 'The free isles', 'wind', L.storm, [], [], 0, 1, false);
  w.addPlayer(TD_FOE, 'The Hollow Priest', L.foe, 0, [], [], 0, 1, false);
  w.geysers.placement = 'none';
  w.nights = false;
  const lay = new Lay(w);

  // the islands: each route's storm gate and turns, the Temple's, the scenery's
  L.routes.forEach((route, r) => {
    if (route.air) {
      return;
    }

    route.via.forEach(([x, y], k) => {
      if (k < route.via.length - 1) {
        lay.island(x + 0.5, y + 0.5, k === 0 ? 4.5 : 6, k === 0 ? 4 : 5.5, r * 11 + k);
      }
    });
  });

  const [tx, ty] = L.temple;
  lay.island(tx + 4, ty + 3, 8.5, 7.5, 99);
  L.isles.forEach(([x, y, rx, ry], k) => lay.island(x + 0.5, y + 0.5, rx, ry, 50 + k));

  // the ways
  const routes: TdRoute[] = L.routes.map((route) => ({
    cells: route.air ? [[route.via[0]![0], route.via[0]![1]], ...route.via.slice(1).flatMap((p, k) => walk(route.via[k]!, p))] : lay.road(route.via),
    air: !!route.air,
  }));

  // the platforms, and the Arc gates' pairs across a bridge
  const spots: TdSpot[] = [];

  for (const spec of L.spots) {
    const via = spec[0] === 'at' ? null : L.routes[spec[1]]!.via;
    const [x, y] = spec[0] === 'at' ? [spec[1], spec[2]] : spec[0] === 'beside' ? beside(via!, spec[2], spec[3], spec[4]) : inLine(via!, spec[2], spec[3]);
    lay.platform(x, y);
    spots.push({ x, y, pair: null, tower: null });
  }

  for (const [r, seg, t] of L.gates) {
    const via = L.routes[r]!.via, [x0, y0] = beside(via, seg, t, -1), [x1, y1] = beside(via, seg, t, 1);
    lay.platform(x0, y0, TD_PAINT.gate);
    lay.platform(x1, y1, TD_PAINT.gate);
    spots.push({ x: x0, y: y0, pair: [x1, y1], tower: null });
  }

  // the Temple at the door, and the player's Priest on the road before it, guarding it
  const temple = w.spawnBuilding('windvortex', TD_ME, tx, ty, 3);
  temple.hp = temple.hpMax;
  const [hx, hy] = routes.find((r) => !r.air)!.cells.at(-5)!;
  const priest = w.addPriest(TD_ME, hx, hy);
  const level = (n: number | undefined) => Math.max(0, Math.min(3, Math.floor(n ?? 0)));
  const own: TdSkills = { bolt: level(skills.bolt), bless: level(skills.bless), rally: level(skills.rally), hammer: level(skills.hammer), stand: level(skills.stand), call: level(skills.call), muster: level(skills.muster) };

  const td: Td = {
    level: id,
    lives: L.lives,
    livesMax: L.lives,
    wave: 0,
    waves: L.waves.map((wave) => wave.map((group) => ({ ...group, hp: group.hp * (L.hp ?? 1) }))),
    next: -1,
    gap: L.gap * 10,
    due: [],
    enemies: new Map(),
    routes,
    spots,
    ranks: new Map(),
    spent: new Map(),
    posts: new Map(),
    towers: L.towers.filter((t) => t in TD_TOWERS),
    spells: L.spells,
    cooldown: new Map(L.spells.map((s) => [s, 0])),
    over: null,
    killed: 0,
    leaked: 0,
    paint: lay.paint,
    hero: {
      id: priest.id,
      skills: own,
      hp: TD_HERO.stand.hp[own.stand]!,
      hpMax: TD_HERO.stand.hp[own.stand]!,
      down: 0,
      strike: 0,
      rally: 0,
      cooldown: { rally: 0, hammer: 0, call: 0 },
      holding: new Set(),
      act: null,
    },
    allies: new Map(),
  };
  w.td = td;
  w.invalidateTerrain();
  return w;
}

/** A battle as text, for looking at: # island, = bridge, o platform, x gate, T Temple, . way. */
export function tdPicture(w: World, x0 = 70, y0 = 80, x1 = 190, y1 = 170): string {
  const td = w.td!, rows: string[] = [], way = new Map<number, string>();

  td.routes.forEach((route) => {
    for (const [x, y] of route.cells) {
      way.set(y * W + x, route.air ? '~' : '.');
    }
  });

  for (let y = y0; y < y1; y++) {
    let row = '';

    for (let x = x0; x < x1; x++) {
      const i = y * W + x, occ = w.entities.get(w.occupant[i] ?? 0);
      const p = td.paint[i];
      row += occ?.kind === 'building' ? 'T'
        : p === TD_PAINT.platform ? 'o' : p === TD_PAINT.gate ? 'x'
          : way.get(i) === '.' ? (w.terrain[i] === Terrain.HardBridge ? '=' : '.') : way.get(i) ?? (w.terrain[i] === Terrain.Sky ? ' ' : '#');
    }

    rows.push(row);
  }

  return rows.join('\n');
}
