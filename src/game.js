/**
 * The match: set-up, the computer's moves and the player's commands. This mirrors netstorm-web's
 * match.ts, without its drawing: one tick of the world is one `stepWorld()`.
 */
import { NS, DATA, G, MISSION, TPS, ME, WORLD, defs, origin } from './state.js';

/** Start the mission afresh. */
export function newGame() {
  const options = {
    ...NS.DEFAULT_OPTIONS, mode: 'mission', mission: MISSION.id, storm: MISSION.storm, lang: 'en', difficulty: 'normal',
  };
  G.options = options;
  G.world = NS.createMatchWorld(defs, DATA.maps, DATA.missions, options, { known: [], altarLevel: 1 });
  G.view = G.world.view();
  G.schedule = new NS.AiSchedule(TPS);
  G.pending.clear();
  G.memories.clear();
  G.commands.length = 0;
  G.raised = new Set();
  G.clock.reset();
  Object.assign(G, {
    paused: true, started: false, ended: false, tool: { kind: 'select' }, rot: 0, facing: 1, selected: null,
    terrainRevision: -1, lastStorm: G.world.players.get(ME).storm,
  });
  G.worker?.terminate();
  G.worker = startWorker();
  // the middle of the map's ground becomes the middle of the scene
  let x0 = WORLD, y0 = WORLD, x1 = 0, y1 = 0;
  for (let y = 0; y < WORLD; y++) {
    for (let x = 0; x < WORLD; x++) {
      if (G.view.terrain[y * WORLD + x]) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
  }
  origin.x = Math.round((x0 + x1 + 1) / 2);
  origin.z = Math.round((y0 + y1 + 1) / 2);
}

/** The AI worker: built from the inlined source in the single-file build, else from ai-worker.js. */
function startWorker() {
  try {
    const inline = document.getElementById('ns-ai');
    const url = inline
      ? URL.createObjectURL(new Blob([inline.textContent], { type: 'text/javascript' }))
      : new URL('ai-worker.js', document.baseURI);
    const worker = new Worker(url);
    worker.onmessage = ({ data }) => {
      if (worker !== G.worker) return;
      G.pending.delete(`${data.due}:${data.player}`);
      G.schedule.deliver(data.due, data.player, data.commands);
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      if (worker === G.worker) { G.worker = null; flushPendingAi(); }
    };
    return worker;
  } catch {
    return null; // the moves are then worked out on the main thread
  }
}

function aiOptions(player) {
  return { ...(MISSION.sides[player]?.ai ?? {}), player, difficulty: G.options.difficulty };
}

function moveNow(player) {
  let memory = G.memories.get(player);
  if (!memory) {
    memory = NS.createAiMemory(G.options.seed + player);
    G.memories.set(player, memory);
  }
  return NS.aiMove(G.world.view(), aiOptions(player), memory, () => {});
}

/** Work out here every move still owed by the worker. */
export function flushPendingAi() {
  for (const [key, req] of G.pending) {
    G.schedule.deliver(req.due, req.player, moveNow(req.player));
    G.pending.delete(key);
  }
}

/** Ask for the moves of the computer's sides whose turn it is on this tick (as match.ts does). */
function requestAi() {
  const w = G.world;
  for (const [player, p] of w.players) {
    if (player === ME || !p.ai || !p.alive) continue;
    const delay = MISSION.sides[player]?.delay ?? MISSION.aiDelay ?? 6;
    if ((w.tick - player) % Math.max(1, Math.round(delay * TPS)) !== 0) continue;
    const due = G.schedule.request(w.tick, player);
    if (G.worker) {
      G.pending.set(`${due}:${player}`, { due, player, at: performance.now() });
      G.worker.postMessage({ due, world: w.handoff(), options: aiOptions(player), seed: G.options.seed });
    } else {
      G.schedule.deliver(due, player, moveNow(player));
    }
  }
}

/** One tick, or false while a computer move owed on it has not come yet. */
export function stepWorld() {
  const owed = G.schedule.take(G.world.tick);
  if (!owed) {
    // a move that is very late is worked out here instead
    for (const req of G.pending.values()) {
      if (performance.now() - req.at > 4000) { G.worker = null; flushPendingAi(); break; }
    }
    return false;
  }
  requestAi();
  G.world.step([...G.commands.splice(0), ...owed]);
  return true;
}

/** Queue one of the player's commands for the next tick. */
export function submit(cmd) {
  if (G.ended) return;
  G.commands.push({ player: ME, ...cmd });
}
