/**
 * An esbuild plugin for the computer opponent's worker: netstorm-web's `connectedToTemple`
 * (rules/bridges.ts) answered once per world and side instead of on every call.
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
 */
import { readFile } from 'node:fs/promises';

const MARKER = 'export function connectedToTemple(world: WorldView, player: number): Uint8Array | null {';

export function aiMemo({ gated = false } = {}) {
  return {
    name: 'ai-memo',
    setup(build) {
      build.onLoad({ filter: /packages[\\/]sim[\\/]src[\\/]rules[\\/]bridges\.ts$/ }, async (args) => {
        const src = await readFile(args.path, 'utf8');
        if (!src.includes(MARKER)) {
          throw new Error('scripts/ai-memo.mjs: netstorm-web\'s connectedToTemple has changed; check the cache still holds, then update MARKER');
        }
        const contents = `${src.replace(MARKER, MARKER.replace('export function connectedToTemple', 'function connectedToTempleEachTime'))}
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
        return { contents, loader: 'ts' };
      });
    },
  };
}
