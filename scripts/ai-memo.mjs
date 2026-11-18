/**
 * The computer opponent's cache: netstorm-web's `connectedToTemple` (rules/bridges.ts) answered once
 * per world and side instead of on every call.
 *
 * To weigh a bridge site the AI asks which of its cells are joined to its Temple, and the answer
 * is a flood fill over its whole territory into a fresh 64 KB grid, made again for each of the
 * hundreds of sites a move weighs: most of a move's time, and moves of several seconds late in a
 * battle. In the worker the world is a copy made for the move (World.fromSnapshot) and never
 * changed after, so the answer cannot change either: kept per world object, it is worked out once.
 * The moves are the same (scripts/ai-check.mjs plays a battle both ways and compares them).
 *
 * Only the worker's bundle gets this: the page's own world changes every tick. `gated` (for the
 * check, where both share a bundle) keeps the answers only while globalThis.__nsAiMove is set.
 * The submodule is not changed; if netstorm-web's function changes shape, the build fails here.
 *
 * This is a change to the source's text, laid in by the house rules' plugin after its own changes
 * (houseRules({ memo })), and not a plugin of its own: esbuild gives a file to the first plugin
 * that loads it, so a second plugin for rules/bridges.ts is never asked, and says nothing.
 */

/** The file the cache is laid into, as scripts/house-rules.mjs names files. */
export const MEMO_FILE = 'rules/bridges.ts';

const MARKER = 'export function connectedToTemple(world: WorldView, player: number): Uint8Array | null {';

/** The source of rules/bridges.ts with the cache laid in. */
export function keepConnected(src, gated = false) {
  if (src.split(MARKER).length !== 2) {
    throw new Error('scripts/ai-memo.mjs: netstorm-web\'s connectedToTemple has changed; check the cache still holds, then update MARKER');
  }

  return `${src.replace(MARKER, MARKER.replace('export function connectedToTemple', 'function connectedToTempleEachTime'))}
/** (netstorm-3d's AI worker) connectedToTemple, kept per world and side: see scripts/ai-memo.mjs. */
const connectedKept = new WeakMap<object, Map<number, Uint8Array | null>>();
export function connectedToTemple(world: WorldView, player: number): Uint8Array | null {
  ${gated ? 'if (!(globalThis as { __nsAiMove?: boolean }).__nsAiMove) return connectedToTempleEachTime(world, player);' : ''}
  let sides = connectedKept.get(world);
  if (!sides) {
    sides = new Map();
    connectedKept.set(world, sides);
  }
  if (!sides.has(player)) sides.set(player, connectedToTempleEachTime(world, player));
  return sides.get(player)!;
}
`;
}
