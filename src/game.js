/**
 * The match: set-up, the computer's moves and the player's commands. This mirrors netstorm-web's
 * match.ts, without its drawing: one tick of the world is one `stepWorld()`.
 */
import { NS, DATA, G, MISSION, TPS, ME, WORLD, defs, origin } from './state.js';
import { settleResidences } from './residences.js';
import { resetHeights } from './heights.js';
import { applySettings } from './settings.js';

/** Skirmish settings the menu starts from. */
export const SKIRMISH_DEFAULTS = { mode: 'skirmish', theme: 'wind', enemyTheme: 'rain', islands: 4, difficulty: 'normal', storm: 2000, spells: 'none', tiers: 'level', seed: 42 };

/**
 * What the player knows in a skirmish beyond a multiplayer battle's start (the Sun's Golem, Disc
 * Thrower, Cannon, Stone Tower and Generator): the units of the Fury chosen in the menu, as the
 * original's alignment of that name lists them; the computer is dealt one of these alignments too.
 * netstorm-web adds what the Furies granted in a campaign instead, but this client keeps no
 * campaign record, so without this a Wind player's Wind Workshop would have nothing to make.
 */
export function furyKnowledge(theme) {
  const name = { wind: 'Wind', rain: 'Rain', thunder: 'Thunder', sun: 'Sun' }[theme] ?? 'Sun';
  return [...(NS.AI_ALIGNMENTS.find((a) => a.name === name)?.tech ?? [])];
}

/**
 * Start a match afresh: the mission, or a skirmish on a map generated from its seed, set up as
 * netstorm-web's setup.ts sets them up.
 */
export function newGame(setup = G.setup) {
  G.setup = setup;
  G.mission = setup.mode === 'mission' ? MISSION : null;
  const base = { ...NS.DEFAULT_OPTIONS, lang: 'en', difficulty: 'normal' };
  const options = G.mission
    ? { ...base, mode: 'mission', mission: MISSION.id, storm: MISSION.storm, difficulty: setup.difficulty ?? 'normal' }
    : {
      ...base, mode: 'skirmish', opponent: 'ai', theme: setup.theme, enemyTheme: setup.enemyTheme, islands: setup.islands,
      difficulty: setup.difficulty, storm: setup.storm, seed: setup.seed, spells: setup.spells ?? 'none',
    };
  G.options = options;
  const known = G.mission ? [] : furyKnowledge(setup.theme);
  G.world = NS.createMatchWorld(defs, DATA.maps, DATA.missions, options, { known, altarLevel: 1 });
  // a random map's islands get the Residences a mission's map has (src/residences.js)
  if (!G.mission) settleResidences(G.world, options.seed);
  // and a dungeon under the player's starting island (the house rules' digDungeon)
  if (!G.mission) NS.digDungeon(G.world, ME, options.seed);
  G.view = G.world.view();
  // the player's settings that are rules: day and night (src/settings.js)
  applySettings(G.world);
  // islands on three levels, if the skirmish was set up so (src/heights.js)
  resetHeights(!G.mission && setup.tiers === 'tiered', setup.seed, setup.difficulty);
  G.schedule = new NS.AiSchedule(TPS);
  G.pending.clear();
  G.memories.clear();
  G.commands.length = 0;
  G.afterDelivery.clear();
  G.holdEnd = 0;
  G.hoverPick = null; // what the cursor was over belongs to the last battle
  G.raised = new Set();
  G.clock.reset();
  Object.assign(G, {
    paused: true, started: false, ended: false, tool: { kind: 'select' }, rot: 0, facing: 1, selected: null, group: [], follow: null,
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
  // how far the ground reaches, in cells: what a table has to hold
  G.span = Math.max(x1 - x0, y1 - y0) + 1;
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
      // a worker that cannot run at all: the moves are worked out on the main thread from now on
      e.preventDefault?.();
      if (worker === G.worker) { worker.terminate(); G.worker = null; flushPendingAi(); }
    };
    return worker;
  } catch {
    return null; // the moves are then worked out on the main thread
  }
}

/** A mission gives each computer side its own orders; a skirmish plays at the level chosen. */
function aiOptions(player) {
  return { ...(G.mission?.sides[player]?.ai ?? {}), player, difficulty: G.options.difficulty };
}

/** Seconds between the computer's moves: the level's in a skirmish; in a mission its own, longer at
 * Easy and shorter at Hard in the proportion the levels have in a skirmish. */
function aiDelay(player) {
  const level = NS.DIFFICULTY[G.options.difficulty] ?? NS.DIFFICULTY.normal;
  if (!G.mission) return level.moveSeconds;
  return (G.mission.sides[player]?.delay ?? G.mission.aiDelay ?? 6) * level.moveSeconds / NS.DIFFICULTY.normal.moveSeconds;
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
    if ((w.tick - player) % Math.max(1, Math.round(aiDelay(player) * TPS)) !== 0) continue;
    const due = G.schedule.request(w.tick, player);
    if (G.worker) {
      G.pending.set(`${due}:${player}`, { due, player, at: performance.now() });
      G.worker.postMessage({ due, world: w.handoff(), options: aiOptions(player), seed: G.options.seed });
    } else {
      G.schedule.deliver(due, player, moveNow(player));
    }
  }
}

/** How long a computer move may take in the worker before it is taken for stuck (ms). */
const STUCK_MS = 15000;

/** One tick, or false while a computer move owed on it has not come yet. */
export function stepWorld() {
  const owed = G.schedule.take(G.world.tick);
  if (!owed) {
    // A worker that has not answered for very long is replaced, and the moves it owes are worked
    // out here this once; the moves after go to the new worker again. (Falling back to the main
    // thread for good would freeze the page for each move, which can take a second or more.)
    for (const req of G.pending.values()) {
      if (performance.now() - req.at > STUCK_MS) {
        G.worker?.terminate();
        G.worker = startWorker();
        flushPendingAi();
        break;
      }
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
