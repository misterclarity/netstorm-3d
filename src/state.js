/** Shared state and constants of the 3D client. */
import * as NS from './engine.js';
import DATA from '../build/game-data.json';
import ART from '../build/art.json';

export { NS, DATA, ART };
export const THREE = AFRAME.THREE;
export const TPS = NS.TPS;
export const ME = NS.ME;
export const WORLD = NS.W; // the map is WORLD × WORLD cells

export const defs = NS.loadDefs(DATA.units);
export const MISSION = DATA.missions.find((m) => m.id === 'thewarbegins') ?? DATA.missions[0];

/** The match in progress and what the player is doing with it. */
export const G = {
  /** What was chosen in the menu: { mode: 'mission', difficulty } or { mode: 'skirmish', theme, enemyTheme, … }. */
  setup: { mode: 'mission', difficulty: 'normal' },
  /** The mission being played, or null in a skirmish. */
  mission: MISSION,
  world: null,
  view: null,
  options: null,
  schedule: null,
  worker: null,
  pending: new Map(),
  memories: new Map(),
  commands: [],
  raised: new Set(),
  clock: new NS.FixedStepClock(TPS),
  speed: 1,
  paused: true,
  started: false,
  ended: false,
  /** { kind: 'select' } | { kind: 'piece', hand } | { kind: 'build', type } */
  tool: { kind: 'select' },
  rot: 0,
  facing: 1,
  selected: null,
  /** The unit the camera keeps to, or null. */
  follow: null,
  hover: null,
  /** The pointer's ray in the scene (a bridge piece snaps by it: snap.js), or null. */
  ray: null,
  mouse: null,
  lastStorm: 0,
  terrainRevision: -1,
  /** How far the map's ground reaches, in cells. */
  span: 100,
  /** Orders that wait for a carrier to bank the crystal it holds: carrier id → command. */
  afterDelivery: new Map(),
  group: [], // the selected carriers when more than one is (G.selected is the first of them)
  hoverPick: null, // an Aerial Transport under the cursor, picked by its body above the ground
  holdEnd: 0, // performance.now() before which the battle's end is not shown (a Sacrifice being heard out)
};

/**
 * World cell (x, y) lies at battlefield point (x - origin.x, 0, y - origin.z): the map's middle at
 * 0, 0, 0. The battlefield is the #world entity: the scene itself on the screen, a table in the
 * tabletop modes (space.js).
 */
export const origin = { x: 128, z: 128 };
export const wx = (x) => x - origin.x;
export const wz = (y) => y - origin.z;

export const OWNER_COLOR = ['#d9d2bf', '#3f86e8', '#e3603f', '#a070e0', '#e0c040', '#40c0a0', '#c04080', '#80c040', '#c08040'];
export const FURY_COLOR = { sun: '#e8b04a', rain: '#59b3e6', wind: '#8cc05a', thunder: '#a184ea' };
/** Grass tiles of the original by Fury, as netstorm-web's texture-selection.ts picks them. */
export const FURY_TILES = { sun: 'rgrass', rain: 'ragrass', wind: 'wigrass', thunder: 'thgrass' };
export const GROUND_PAINT = { sun: [150, 146, 104], rain: [86, 136, 66], wind: [121, 146, 62], thunder: [104, 120, 92] };
export const BUILDABLE = new Set(['Shooter', 'Defense', 'Anti-Air', 'Source of Energy', 'Air Attack Base',
  'Production', 'Energy', 'Altar', 'Residence', 'Ground Transport', 'Aerial Transport']);
export const PRIEST_BUILT = new Set(['Energy', 'Production', 'Altar']);
export const HARDEN = 60; // ticks a bridge piece takes to harden in the hand
export const PX = 16; // sprite pixels per cell
export const SPEEDS = [1, 2, 3];
export const FACING_NAMES = ['north', 'east', 'south', 'west'];

/** The player's choices about play, kept between visits (sound and music are ns-sound's). */
const PLAY_KEY = 'netstorm-3d:play';
export const PLAY = { autoCollect: true };
try { Object.assign(PLAY, JSON.parse(localStorage.getItem(PLAY_KEY) ?? '{}')); } catch { /* no storage */ }
export function setPlay(key, value) {
  PLAY[key] = value;
  try { localStorage.setItem(PLAY_KEY, JSON.stringify(PLAY)); } catch { /* no storage */ }
}
/** How the way a unit was laid reads: the Wind Tower's facing is the side its shield guards. */
export const facingText = (def, f) => def.id === 'windblocker' ? `shielded on the ${FACING_NAMES[f]}` : `faces ${FACING_NAMES[f]}`;
/** Turns a part pointing +Z (south) to face N, E, S, W. */
export const FACING_YAW = [Math.PI, Math.PI / 2, 0, -Math.PI / 2];

export function playerTheme(id) {
  return G.world?.players.get(id)?.theme ?? 'sun';
}

/** A small stable hash, so that the same cell always gets the same jitter. */
export function hash(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A command error of the simulation, in words. */
export function errorText(err) {
  const f = NS.m[`rejected_${String(err).replace(/ /g, '_')}`];
  const text = f ? f() : String(err);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A key press that is not for the game: typing in a field, with Ctrl, Alt or ⌘ held, or under a dialog. */
export function keysOff(e) {
  return !!e.target?.closest?.('input,textarea,select') || e.ctrlKey || e.metaKey || e.altKey
    || document.getElementById('modal')?.style.display === 'grid';
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
