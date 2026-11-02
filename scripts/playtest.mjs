/**
 * Plays the built page in headless Chromium and fails on any error.
 *
 *   npm run build && npm run playtest
 *
 * Nothing is fetched from the network: A-Frame comes from node_modules and netstorm-web's sprites,
 * sounds and music from the submodule, answered in place of the CDN and GitHub. Each scenario drives
 * the game through the same functions the clicks use (window.NS3D); the debug staging of the
 * endgame (cannons, an Altar, a downed Priest) only saves the minutes of a real battle.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PUBLIC = resolve('vendor/netstorm-web/packages/client/public');
const AFRAME = resolve('node_modules/aframe/dist/aframe-v1.8.0.min.js');
const only = process.argv[2];

if (!existsSync('dist/index.html')) {
  console.error('dist/index.html is missing: run `npm run build` first.');
  process.exit(1);
}

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = { '/': 'index.html', '/index.html': 'index.html', '/version.json': 'version.json' }[path];
  if (!file || !existsSync(`dist/${file}`)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': file.endsWith('.json') ? 'application/json' : 'text/html' }).end(readFileSync(`dist/${file}`));
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

// CHROMIUM=/path/to/chrome plays in that browser instead of the one Playwright installed
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

const pages = [];

async function open(viewport = { width: 1000, height: 640 }) {
  const page = await browser.newPage({ viewport });
  pages.push(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && m.text().includes('[netstorm-3d]')) errors.push(m.text()); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes('cdn.jsdelivr.net/npm/aframe@')) return route.fulfill({ path: AFRAME, contentType: 'application/javascript' });
    if (u.includes('raw.githubusercontent.com/')) {
      const rel = u.split('/packages/client/public/')[1] ?? '';
      const file = resolve(PUBLIC, rel);
      if (!rel || !file.startsWith(PUBLIC) || !existsSync(file)) return route.fulfill({ status: 404 });
      return route.fulfill({ path: file, contentType: rel.endsWith('.mp3') ? 'audio/mpeg' : 'image/png', headers: { 'access-control-allow-origin': '*' } });
    }
    if (u.startsWith(url) || u.startsWith('blob:') || u.startsWith('data:')) return route.continue();
    return route.abort();
  });
  await page.goto(url);
  await page.waitForFunction(() => window.NS3D?.G.world && document.querySelector('#modal button.main'), null, { timeout: 60000 });
  return { page, errors };
}

/** From the main menu into the mission, past its briefing. */
async function startMission(page) {
  await page.click('[data-start="mission"]');
  await page.waitForFunction(() => document.querySelector('#modal h2')?.textContent === 'The War Begins!');
  await page.click('#modal button.main');
}

/** Run n ticks at once, the computer's moves worked out in place. */
const fastForward = (page, n) => page.evaluate((ticks) => {
  const { G, stepWorld, flushPendingAi } = window.NS3D;
  G.worker?.terminate();
  G.worker = null;
  for (let i = 0; i < ticks; i++) if (!stepWorld()) { flushPendingAi(); stepWorld(); }
  return G.world.tick;
}, n);

/** Wait until the camera has stopped gliding, so that a point aimed at stays where it was (the
 * rig knows: comparing its position between polls fails where no frame was drawn in between). */
const cameraStill = (page) => page.waitForFunction(() => !document.getElementById('camera').components['orbit-rig'].moving(),
  null, { polling: 200, timeout: 30000 });

const SCENARIOS = {
  /** The opening: a Workshop (with the cursor resting on its new site), a Golem sent to a geyser,
   * the Sun Cannon in a production slot, a bridge piece. */
  async opening() {
    const { page, errors } = await open();
    await startMission(page);
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const { G, game, NS } = window.NS3D, v = G.view, t = G.world.templeOf(1);
      const spot = (type) => {
        for (let y = t.y - 14; y < t.y + 18; y++) for (let x = t.x - 14; x < t.x + 22; x++) {
          const a = NS.anchorFor(G.world.def(type), x, y);
          if (!v.canBuild({ player: 1, type, ...a })) return [x, y];
        }
        throw new Error(`no place for ${type}`);
      };
      const shop = spot('sunfactory');
      game.setTool({ kind: 'build', type: 'sunfactory' });
      game.primary(...shop);
      G.hover = { x: shop[0], y: shop[1] }; // the cursor rests on the new site
      G.mouse = { x: 400, y: 300 };
      game.setTool({ kind: 'build', type: 'sunwalker' });
      game.primary(...spot('sunwalker'));
    });
    await page.waitForTimeout(1500);
    await fastForward(page, 150);
    await page.waitForTimeout(800);
    const laid = await page.evaluate(() => {
      const { G, game, submit } = window.NS3D;
      const mine = (f) => [...G.view.entities.values()].find((e) => e.owner === 1 && f(e));
      const shop = mine((e) => e.type === 'sunfactory'), golem = mine((e) => e.kind === 'transport');
      if (!shop || shop.rising > 0 || !golem) throw new Error('no finished Workshop or no Golem');
      submit({ t: 'produce', workshop: shop.id, type: 'suncannon' });
      const geyser = [...G.view.entities.values()].filter((e) => e.kind === 'geyser')
        .sort((a, b) => Math.hypot(a.x - golem.x, a.y - golem.y) - Math.hypot(b.x - golem.x, b.y - golem.y))[0];
      G.selected = golem.id;
      game.primary(geyser.x, geyser.y);
      for (let y = 90; y < 140; y++) for (let x = 60; x < 130; x++) for (let rot = 0; rot < 4; rot++) {
        if (!G.view.canDropPiece({ player: 1, hand: 0, x, y, rot })) {
          G.rot = rot;
          game.setTool({ kind: 'piece', hand: 0 });
          game.primary(x, y);
          return true;
        }
      }
      return false;
    });
    if (!laid) throw new Error('no bridge piece could be laid');
    await fastForward(page, 300);
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => {
      const { G } = window.NS3D, all = [...G.view.entities.values()];
      return {
        golem: all.find((e) => e.kind === 'transport' && e.owner === 1)?.goal,
        slots: all.find((e) => e.type === 'sunfactory')?.slots ?? [],
        units: document.querySelectorAll('[ns-unit]').length,
      };
    });
    if (state.golem !== 'collect' && state.golem !== 'home') throw new Error(`the Golem is ${state.golem}, not collecting`);
    if (!state.slots.includes('suncannon')) throw new Error('the Sun Cannon is not in production');
    if (state.units < 30) throw new Error(`only ${state.units} units in the scene`);
    return errors;
  },

  /** The endgame, staged: the enemy Priest down beside an Altar, a Golem captures him, your Priest
   * performs the sacrifice, the mission is won. */
  async endgame() {
    const { page, errors } = await open({ width: 800, height: 500 });
    await startMission(page);
    await fastForward(page, 30);
    await page.evaluate(() => {
      const { G } = window.NS3D, w = G.world, foe = w.priestOf(2), t = w.templeOf(1);
      const free = (x0, y0, fw, fh) => {
        for (let y = y0; y < y0 + fh; y++) for (let x = x0; x < x0 + fw; x++) {
          const i = w.at(x, y);
          if (w.terrain[i] !== 1 || w.occupant[i] || w.priestAt(x, y)) return false;
        }
        return true;
      };
      const near = (cx, cy, fw, fh) => {
        for (let r = 1; r < 40; r++) for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (free(x, y, fw, fh)) return [x, y];
        throw new Error('no free ground');
      };
      const a = near(t.x + 4, t.y - 10, 7, 7);
      w.spawnBuilding('altar', 1, a[0], a[1], 0).rising = 0;
      const p = near(a[0] + 14, a[1] + 3, 1, 1);
      Object.assign(foe, { x: p[0], y: p[1], path: [], goal: 'idle', hp: Math.floor(foe.hpMax * 0.4), state: 'down' });
      const g = near(p[0], p[1] + 1, 1, 1);
      const golem = w.spawnTransport('sunwalker', 1, g[0], g[1]);
      G.selected = golem.id;
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => { const { G, game } = window.NS3D, f = G.world.priestOf(2); game.primary(f.x, f.y); });
    let sent = false, early = null;
    for (let i = 0; i < 40; i++) {
      await fastForward(page, 60);
      const s = await page.evaluate(() => {
        const { G, game } = window.NS3D;
        game.handleEvents();
        return { state: G.world.priestOf(2)?.state, ended: G.ended, holding: performance.now() < G.holdEnd };
      });
      // the moment the Sacrifice is complete the battle is not over yet on screen: it is heard out
      if (sent && s.state !== 'chained' && early === null) early = { ended: s.ended, holding: s.holding };
      if (s.state === 'chained' && !sent) {
        sent = true;
        await page.evaluate(() => {
          const { G, game } = window.NS3D;
          G.selected = G.world.priestOf(1).id;
          const altar = [...G.view.entities.values()].find((e) => e.type === 'altar' && e.owner === 1);
          game.primary(altar.x + 3, altar.y + 3);
        });
      }
      if (s.ended || early) break;
    }
    if (!early) throw new Error('the Sacrifice was not completed');
    if (early.ended || !early.holding) throw new Error(`the battle ended without waiting for the Sacrifice to be heard out: ${JSON.stringify(early)}`);
    await page.waitForFunction(() => window.NS3D.G.ended, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(500);
    const title = await page.evaluate(() => document.querySelector('#modal h2')?.textContent);
    if (title !== 'Victory!') throw new Error(`the mission ended with "${title}", not Victory`);
    return errors;
  },
};

/**
 * A downed enemy Priest taken by a Golem before any Altar stands: the Golem picks him up and
 * holds him, he stays a captive, and once an Altar is built "Carry to the Altar" chains him there.
 */
SCENARIOS.captive = async () => {
  const { page, errors } = await open({ width: 1000, height: 640 });
  await startMission(page);
  const golem = await page.evaluate(() => {
    const { G, game } = window.NS3D, w = G.world, foe = w.priestOf(2), t = w.templeOf(1);
    const toasts = [], show = game.hud.toast.bind(game.hud);
    window.toasts = toasts;
    game.hud.toast = (text, kind) => { toasts.push(text); show(text, kind); };
    if ([...w.entities.values()].some((e) => e.type === 'altar' && e.owner === 1)) throw new Error('the player has an Altar at the start');
    const free = (x, y) => w.terrain[w.at(x, y)] === 1 && !w.occupant[w.at(x, y)] && !w.priestAt(x, y);
    const near = (cx, cy) => {
      for (let r = 1; r < 40; r++) for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (free(x, y)) return [x, y];
      throw new Error('no free ground');
    };
    const p = near(t.x + 12, t.y + 2);
    Object.assign(foe, { x: p[0], y: p[1], path: [], goal: 'idle', hp: Math.floor(foe.hpMax * 0.2), state: 'down' });
    const g = near(p[0] - 3, p[1]);
    const carrier = w.spawnTransport('sunwalker', 1, g[0], g[1]);
    G.selected = carrier.id;
    game.primary(foe.x, foe.y);
    return carrier.id;
  });
  let held = null;
  for (let i = 0; i < 20 && !held; i++) {
    await fastForward(page, 30);
    held = await page.evaluate((id) => {
      const { G } = window.NS3D, foe = G.world.priestOf(2), t = G.world.entities.get(id);
      return foe.state === 'carried' ? { by: foe.carriedBy, goal: t.goal, carrying: t.carrying === foe.id } : null;
    }, golem);
  }
  if (!held) throw new Error(`the Golem did not pick up the downed Priest without an Altar: ${await page.evaluate(() => window.toasts.join(' / '))}`);
  if (held.by !== golem || !held.carrying || held.goal !== 'idle') throw new Error(`the Golem does not hold the captive: ${JSON.stringify(held)}`);
  await fastForward(page, 900);
  const still = await page.evaluate(() => window.NS3D.G.world.priestOf(2).state);
  if (still !== 'carried') throw new Error(`the captive did not stay held: ${still}`);
  await page.evaluate(() => {
    const { G } = window.NS3D, w = G.world, t = w.templeOf(1);
    const free = (x0, y0) => {
      for (let y = y0; y < y0 + 7; y++) for (let x = x0; x < x0 + 7; x++) if (w.terrain[w.at(x, y)] !== 1 || w.occupant[w.at(x, y)] || w.priestAt(x, y)) return false;
      return true;
    };
    let a = null;
    for (let r = 1; r < 40 && !a; r++) for (let y = t.y - 10 - r; y <= t.y - 10 + r && !a; y++) for (let x = t.x + 4 - r; x <= t.x + 4 + r && !a; x++) if (free(x, y)) a = [x, y];
    w.spawnBuilding('altar', 1, a[0], a[1], 0).rising = 0;
  });
  await page.waitForSelector('[data-sel="toAltar"]:not([disabled])', { timeout: 10000 });
  await page.click('[data-sel="toAltar"]');
  let chained = false;
  for (let i = 0; i < 30 && !chained; i++) {
    await fastForward(page, 60);
    chained = await page.evaluate(() => window.NS3D.G.world.priestOf(2).state === 'chained');
  }
  if (!chained) throw new Error(`"Carry to the Altar" did not chain the captive: ${await page.evaluate(() => window.toasts.join(' / '))}`);
  return errors;
};

/**
 * An Air Ship clicked by its body, high above its cell, is selected; a click on ground of the
 * player's island then sends it there, where it lands.
 */
SCENARIOS.airship = async () => {
  const { page, errors } = await open({ width: 1000, height: 640 });
  await page.selectOption('#skTheme', 'wind');
  await page.fill('#skSeed', '3');
  await page.click('[data-start="skirmish"]');
  await page.waitForFunction(() => document.querySelector('#modal h2')?.textContent === 'Skirmish', null, { timeout: 20000 });
  await page.click('#modal button.main');
  const ship = await page.evaluate(() => {
    const { G } = window.NS3D, w = G.world, t = w.templeOf(1);
    const free = (x, y) => w.walkable(1, x, y) && w.terrain[w.at(x, y)] === 1 && !w.occupant[w.at(x, y)] && !w.priestAt(x, y);
    const near = (cx, cy) => {
      for (let r = 1; r < 30; r++) for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (free(x, y)) return [x, y];
      throw new Error('no free ground');
    };
    const at = near(t.x + t.fx + 3, t.y + t.fy + 2);
    const s = w.spawnTransport('windballoon', 1, at[0], at[1]);
    // somewhere else on the island, a few cells off
    let to = null;
    for (let r = 5; r < 14 && !to; r++) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) if (!to && free(at[0] + dx, at[1] + dy)) to = [at[0] + dx, at[1] + dy];
    G.paused = true; // the battle waits while the clicks are aimed
    return { id: s.id, at, to };
  });
  if (!ship.to) throw new Error('no ground to send the Air Ship to');
  // its entity is made on a coming frame, and drawn on the one after; the camera glides to its
  // first view, and the clicks are aimed once it stands still
  await page.waitForFunction((id) => !!window.NS3D.game.units()?.byId.get(id)?.components['ns-unit']?.rep, ship.id, { timeout: 15000 });
  await cameraStill(page);
  const screen = (aim) => page.evaluate(({ what, unit }) => {
    const { wx, wz } = window.NS3D, T = AFRAME.THREE, scene = document.querySelector('a-scene');
    const r = scene.canvas.getBoundingClientRect();
    let p;
    if (what === 'body') {
      // the middle of the ship's body: the top quarter of the unit, far above its cell
      const box = new T.Box3().setFromObject(window.NS3D.game.units().byId.get(unit.id).object3D);
      p = new T.Vector3((box.min.x + box.max.x) / 2, box.max.y - (box.max.y - box.min.y) * 0.3, (box.min.z + box.max.z) / 2);
    } else p = document.getElementById('world').object3D.localToWorld(new T.Vector3(wx(unit.to[0] + 0.5), 0, wz(unit.to[1] + 0.5)));
    const v = p.clone().project(scene.camera);
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }, { what: aim, unit: ship });
  const body = await screen('body');
  await page.mouse.click(body.x, body.y);
  const selected = await page.evaluate(() => window.NS3D.G.selected);
  if (selected !== ship.id) throw new Error(`a click on the Air Ship's body did not select it (selected ${selected})`);
  const ground = await screen('ground');
  await page.mouse.click(ground.x, ground.y);
  await page.evaluate(() => { window.NS3D.G.paused = false; });
  let landed = null;
  for (let i = 0; i < 20 && !landed; i++) {
    await fastForward(page, 30);
    landed = await page.evaluate(({ id, to }) => {
      const s = window.NS3D.G.world.entities.get(id);
      return s && s.x === to[0] && s.y === to[1] && !s.path.length && !s.aloft && !s.climbing ? { x: s.x, y: s.y } : null;
    }, ship);
  }
  if (!landed) {
    const s = await page.evaluate((id) => { const e = window.NS3D.G.world.entities.get(id); return e && { x: e.x, y: e.y, goal: e.goal, path: e.path.length, selected: window.NS3D.G.selected }; }, ship.id);
    throw new Error(`the Air Ship was not sent to ${ship.to}: ${JSON.stringify(s)}`);
  }
  return errors;
};

/**
 * With a Golem selected, a click high on a geyser's steam (the cell under the cursor lies behind
 * the geyser) sends the Golem to the geyser; and the cards show the Energy their units need.
 */
SCENARIOS.gather = async () => {
  const { page, errors } = await open({ width: 1000, height: 640 });
  await startMission(page);
  const setup = await page.evaluate(() => {
    const { G } = window.NS3D, w = G.world, p = G.view.priestOf(1);
    const geyser = [...G.view.entities.values()].filter((e) => e.kind === 'geyser' && e.stock > 0 && G.view.owner[G.view.at(e.x, e.y)] === 1)
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    let at = null;
    for (let r = 2; r < 20 && !at; r++) for (let dx = -r; dx <= r && !at; dx++) {
      const x = geyser.x + dx, y = geyser.y + r;
      if (w.terrain[w.at(x, y)] === 1 && !w.occupant[w.at(x, y)] && !w.priestAt(x, y)) at = [x, y];
    }
    const golem = w.spawnTransport('sunwalker', 1, at[0], at[1]);
    G.selected = golem.id;
    G.paused = true;
    return { geyser: geyser.id, golem: golem.id, dots: document.querySelectorAll('#unitCards .needs .mana, #priestBuilds .needs .mana').length };
  });
  if (!setup.dots) throw new Error('no build card shows the Energy its unit needs');
  await page.waitForFunction((id) => !!window.NS3D.game.units()?.byId.get(id)?.components['ns-unit']?.rep, setup.golem, { timeout: 15000 });
  await page.evaluate((id) => {
    const { G } = window.NS3D, g = G.view.entities.get(id);
    document.getElementById('camera').components['orbit-rig'].focus(window.NS3D.wx(g.x + 0.5), window.NS3D.wz(g.y + 0.5), 30);
  }, setup.geyser);
  // the camera glides there: aim once it stands still
  await cameraStill(page);
  const aim = await page.evaluate((id) => {
    const T = AFRAME.THREE, scene = document.querySelector('a-scene'), el = window.NS3D.game.units().byId.get(id);
    const top = el.object3D.localToWorld(new T.Vector3(0, 2.8, 0)), v = top.clone().project(scene.camera), r = scene.canvas.getBoundingClientRect();
    const x = r.left + (v.x + 1) / 2 * r.width, y = r.top + (1 - v.y) / 2 * r.height;
    const cell = window.NS3D.game.cellAt(x, y), g = window.NS3D.G.view.entities.get(id);
    return { x, y, behind: cell.x !== g.x || cell.y !== g.y };
  }, setup.geyser);
  if (!aim.behind) throw new Error('the aim is on the geyser\'s own cell: no test of picking by its body');
  await page.mouse.click(aim.x, aim.y);
  await page.evaluate(() => { window.NS3D.G.paused = false; });
  await fastForward(page, 5);
  const golem = await page.evaluate((id) => { const t = window.NS3D.G.world.entities.get(id); return { goal: t.goal, target: t.target, selected: window.NS3D.G.selected }; }, setup.golem);
  if (golem.goal !== 'collect' || golem.target !== setup.geyser) throw new Error(`a click on the geyser's steam did not send the Golem there: ${JSON.stringify(golem)}`);
  return errors;
};

/**
 * An order the rules would refuse is refused at once: a Golem sent to a geyser no bridge leads to
 * says nothing and goes nowhere, and a toast says why; one it can reach it answers and goes to.
 */
SCENARIOS.refuse = async () => {
  const { page, errors } = await open({ width: 1000, height: 640 });
  await startMission(page);
  const r = await page.evaluate(() => {
    const { G, game, stepWorld, flushPendingAi } = window.NS3D, w = G.world, t = w.templeOf(1), sound = game.sound();
    const toasts = [], show = game.hud.toast.bind(game.hud);
    game.hud.toast = (text, kind) => { toasts.push(text); show(text, kind); };
    let at = null;
    for (let d = 2; d < 12 && !at; d++) for (let dx = -d; dx <= d && !at; dx++) { const x = t.x + dx, y = t.y + t.fy + d; if (w.terrain[w.at(x, y)] === 1 && !w.occupant[w.at(x, y)] && !w.priestAt(x, y)) at = [x, y]; }
    const golem = w.spawnTransport('sunwalker', 1, at[0], at[1]);
    const next = (g) => (c) => Math.abs(c[0] - g.x) + Math.abs(c[1] - g.y) === 1;
    const geysers = [...w.entities.values()].filter((e) => e.kind === 'geyser' && e.stock > 0);
    const far = geysers.find((g) => !w.wayOf(golem, next(g))), close = geysers.find((g) => w.wayOf(golem, next(g)));
    if (!far || !close) return { fail: `geysers: ${geysers.length}, unreachable ${!!far}, reachable ${!!close}` };
    const click = (g) => {
      G.selected = golem.id;
      const before = sound.playedCount ?? 0;
      game.primary(g.x, g.y, false, g);
      for (let i = 0; i < 2; i++) if (!stepWorld()) { flushPendingAi(); stepWorld(); }
      game.handleEvents();
      return { answered: (sound.playedCount ?? 0) > before, goal: golem.goal, target: golem.target };
    };
    const refused = click(far), taken = click(close);
    return { refused, taken, far: far.id, close: close.id, toasts };
  });
  if (r.fail) throw new Error(r.fail);
  if (r.refused.answered || r.refused.goal === 'collect') throw new Error(`an order the rules refuse was answered or taken: ${JSON.stringify(r.refused)}`);
  if (!r.toasts.some((t) => /can't get to that geyser/.test(t))) throw new Error(`no toast said why: ${r.toasts.join(' / ')}`);
  if (!r.taken.answered || r.taken.goal !== 'collect' || r.taken.target !== r.close) throw new Error(`a reachable geyser was not answered and taken: ${JSON.stringify(r.taken)}`);
  if (r.toasts.some((t) => /wrong target|no path/i.test(t))) throw new Error(`the rules refused an order after all: ${r.toasts.join(' / ')}`);
  return errors;
};

/**
 * "Auto-collect": a Golem built with it on goes to a geyser it can reach by itself; with it off,
 * one waits for orders. The setting is a button in the top bar and is kept.
 */
SCENARIOS.autocollect = async () => {
  const { page, errors } = await open({ width: 1280, height: 720 });
  await startMission(page);
  const build = () => page.evaluate(() => {
    const { G, NS, game, submit, stepWorld, flushPendingAi } = window.NS3D, w = G.world, t = w.templeOf(1);
    G.worker?.terminate(); G.worker = null;
    w.players.get(1).storm += 1000;
    // the same unit is built again only after a while
    for (let i = 0; i < 900 && w.players.get(1).refresh.some((r) => r.type === 'sunwalker'); i++) if (!stepWorld()) { flushPendingAi(); stepWorld(); }
    game.handleEvents();
    let at = null;
    for (let y = t.y - 10; y < t.y + 14 && !at; y++) for (let x = t.x - 10; x < t.x + 14 && !at; x++) {
      const a = NS.anchorFor(w.def('sunwalker'), x, y);
      if (G.view.canBuild({ player: 1, type: 'sunwalker', ...a }) === null) at = a;
    }
    const before = new Set([...w.entities.keys()]);
    submit({ t: 'build', type: 'sunwalker', ...at });
    for (let i = 0; i < 3; i++) { if (!stepWorld()) { flushPendingAi(); stepWorld(); } game.handleEvents(); }
    for (let i = 0; i < 3; i++) { if (!stepWorld()) { flushPendingAi(); stepWorld(); } }
    const golem = [...w.entities.values()].find((e) => !before.has(e.id) && e.kind === 'transport');
    return golem ? { goal: golem.goal, target: golem.target, geyser: w.entities.get(golem.target)?.kind ?? null } : null;
  });
  const on = await build();
  if (!on || on.goal !== 'collect' || on.geyser !== 'geyser') throw new Error(`with Auto-collect on, a new Golem did not go to a geyser: ${JSON.stringify(on)}`);
  await page.click('#autoCollect');
  const off = await build();
  if (!off || off.goal !== 'idle') throw new Error(`with Auto-collect off, a new Golem did not wait for orders: ${JSON.stringify(off)}`);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('netstorm-3d:play') ?? '{}').autoCollect);
  if (kept !== false) throw new Error(`the setting was not kept: ${kept}`);
  await page.click('#autoCollect'); // as it was, for the pages after
  return errors;
};

/**
 * Several carriers at once, with the mouse and keys as a player does it: a Ctrl-drag box selects
 * three Golems, a click on a geyser sends all three, Shift-click takes one out, Esc clears, "I"
 * picks an idle one, and a double click selects every Golem on the screen.
 */
SCENARIOS.group = async () => {
  const { page, errors } = await open({ width: 1100, height: 700 });
  await startMission(page);
  const setup = await page.evaluate(() => {
    const { G } = window.NS3D, w = G.world, t = w.templeOf(1), p = G.view.priestOf(1);
    G.worker?.terminate(); G.worker = null;
    const free = (x, y) => w.terrain[w.at(x, y)] === 1 && !w.occupant[w.at(x, y)] && !w.priestAt(x, y) && !w.residenceAt(x, y);
    const geyser = [...G.view.entities.values()].filter((e) => e.kind === 'geyser' && e.stock > 0 && G.view.owner[G.view.at(e.x, e.y)] === 1)
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    const ids = [];
    for (let r = 3; r < 14 && ids.length < 3; r++) for (let dx = -r; dx <= r && ids.length < 3; dx += 2) {
      const x = t.x + dx, y = t.y + t.fy + r;
      if (free(x, y) && ids.every((id) => Math.hypot(w.entities.get(id).x - x, w.entities.get(id).y - y) > 1.5)) ids.push(w.spawnTransport('sunwalker', 1, x, y).id);
    }
    G.paused = true;
    const cx = ids.reduce((s, id) => s + w.entities.get(id).x, 0) / ids.length, cy = ids.reduce((s, id) => s + w.entities.get(id).y, 0) / ids.length;
    document.getElementById('camera').components['orbit-rig'].focus(window.NS3D.wx(cx + 0.5), window.NS3D.wz(cy + 0.5), 34);
    return { ids, geyser: geyser.id };
  });
  if (setup.ids.length < 3) throw new Error('no room for three Golems');
  await page.waitForFunction((ids) => ids.every((id) => window.NS3D.game.units()?.byId.get(id)?.components['ns-unit']?.rep), setup.ids, { timeout: 15000 });
  await cameraStill(page);
  const at = (id) => page.evaluate((uid) => window.NS3D.game.onScreen(window.NS3D.G.view.entities.get(uid)), id);
  const spots = await Promise.all(setup.ids.map(at));
  if (spots.some((s) => !s)) throw new Error('a Golem is off the screen');
  const x0 = Math.min(...spots.map((s) => s.x)) - 30, y0 = Math.min(...spots.map((s) => s.y)) - 30;
  const x1 = Math.max(...spots.map((s) => s.x)) + 30, y1 = Math.max(...spots.map((s) => s.y)) + 30;
  // Ctrl-drag a box around them
  await page.evaluate(() => { window.boxes = []; document.querySelector('a-scene').addEventListener('ns-box', (e) => window.boxes.push(e.detail)); });
  await page.keyboard.down('Control');
  await page.mouse.move(x0, y0); await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 }); await page.mouse.move(x1, y1, { steps: 4 });
  await page.mouse.up(); await page.keyboard.up('Control');
  const boxed = await page.evaluate(() => [...window.NS3D.G.group]);
  if (boxed.length !== 3 || !setup.ids.every((id) => boxed.includes(id))) throw new Error(`the box did not select the three Golems: ${JSON.stringify(boxed)}; spots ${JSON.stringify(spots)}; box events ${JSON.stringify(await page.evaluate(() => window.boxes.slice(-2)))}`);
  const card = await page.waitForFunction(() => document.querySelector('#sel h4')?.textContent === '3 selected', null, { timeout: 10000 })
    .then(() => '3 selected', () => page.evaluate(() => document.querySelector('#sel h4')?.textContent));
  if (card !== '3 selected') throw new Error(`the card does not show the group: "${card}"`);
  // a click on the geyser sends all three
  await page.evaluate((g) => { const { G, game } = window.NS3D, e = G.view.entities.get(g); game.primary(e.x, e.y, false, e); }, setup.geyser);
  await page.evaluate(() => { const { stepWorld, flushPendingAi } = window.NS3D; for (let i = 0; i < 2; i++) if (!stepWorld()) { flushPendingAi(); stepWorld(); } });
  const goals = await page.evaluate((ids) => ids.map((id) => { const t = window.NS3D.G.world.entities.get(id); return [t.goal, t.target]; }), setup.ids);
  if (!goals.every(([g, tg]) => g === 'collect' && tg === setup.geyser)) throw new Error(`not all three went to the geyser: ${JSON.stringify(goals)}`);
  // Shift-click takes one out
  const one = await at(setup.ids[1]);
  await page.keyboard.down('Shift'); await page.mouse.click(one.x, one.y); await page.keyboard.up('Shift');
  const left = await page.evaluate(() => [...window.NS3D.G.group]);
  if (left.length !== 2 || left.includes(setup.ids[1])) throw new Error(`Shift-click did not take one out: ${JSON.stringify(left)}`);
  // Esc clears
  await page.keyboard.press('Escape');
  const cleared = await page.evaluate(() => [window.NS3D.G.selected, window.NS3D.G.group.length]);
  if (cleared[0] !== null || cleared[1]) throw new Error(`Esc did not clear the selection: ${JSON.stringify(cleared)}`);
  // "I": an idle Golem (a fourth, waiting)
  const idle = await page.evaluate((ids) => {
    const { G } = window.NS3D, w = G.world, a = w.entities.get(ids[0]);
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [3, 1]]) { const x = a.x + dx, y = a.y + dy; if (w.terrain[w.at(x, y)] === 1 && !w.occupant[w.at(x, y)]) return w.spawnTransport('sunwalker', 1, x, y).id; }
    return null;
  }, setup.ids);
  await page.waitForTimeout(400);
  await page.keyboard.press('i');
  const picked = await page.evaluate(() => window.NS3D.G.selected);
  if (picked !== idle) throw new Error(`"I" did not pick the idle Golem ${idle}: ${picked}`);
  // a double click on a Golem: all Golems on the screen
  await page.waitForFunction((id) => !!window.NS3D.game.units()?.byId.get(id)?.components['ns-unit']?.rep, idle, { timeout: 15000 });
  await cameraStill(page);
  const g0 = await at(setup.ids[0]);
  await page.mouse.click(g0.x, g0.y);
  await page.waitForTimeout(80);
  await page.mouse.click(g0.x, g0.y);
  const all = await page.evaluate(() => [...window.NS3D.G.group]);
  if (all.length < 4) throw new Error(`a double click did not select every Golem on the screen: ${JSON.stringify(all)}`);
  return errors;
};

/**
 * A battle played by the computer on both sides for five minutes of game time, the page drawing
 * between stretches, in both art styles and on the table: no page error or warning, every unit
 * drawn where a unit can be, the units on the screen those of the world, and no "NaN" or
 * "undefined" in the HUD.
 */
SCENARIOS.soak = async () => {
  const { page, errors } = await open({ width: 1100, height: 700 });
  const warnings = [];
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
  await page.selectOption('#skTheme', 'wind');
  await page.selectOption('#skEnemy', 'thunder');
  await page.fill('#skSeed', '11');
  await page.click('[data-start="skirmish"]');
  await page.waitForFunction(() => document.querySelector('#modal h2')?.textContent === 'Skirmish', null, { timeout: 20000 });
  await page.click('#modal button.main');
  await page.evaluate(() => {
    const { G, NS } = window.NS3D;
    window.seen = {};
    const emit = G.world.emit.bind(G.world);
    G.world.emit = (ev) => { window.seen[ev.what] = (window.seen[ev.what] ?? 0) + 1; emit(ev); };
    window.mine = NS.createAiMemory(21);
  });
  const play = (n) => page.evaluate((ticks) => {
    const { G, NS, stepWorld, flushPendingAi, submit } = window.NS3D;
    G.worker?.terminate(); G.worker = null;
    for (let i = 0; i < ticks && !G.ended && G.view.winner == null; i++) {
      if (G.world.tick % 60 === 7) for (const c of NS.aiMove(G.view, { player: 1, difficulty: 'normal' }, window.mine, () => {})) submit(c);
      if (!stepWorld()) { flushPendingAi(); stepWorld(); }
    }
    return G.ended || G.view.winner != null;
  }, n);
  const art = (mode) => page.evaluate((m) => document.querySelector('a-scene').systems['ns-art'].setMode(m), mode);
  for (let i = 0; i < 10; i++) {
    const over = await play(300);
    await page.waitForTimeout(300);
    if (i === 2) await art('models');
    if (i === 5) await page.keyboard.press('t');
    if (i === 6) await page.keyboard.press('t');
    if (i === 7) await art('sprites');
    if (over) break;
  }
  // the units on the screen follow the world on the next frames (a slow software renderer here);
  // the battle is held, so that no step adds a unit between the frame and the look
  await page.evaluate(() => { window.NS3D.G.paused = true; });
  await page.waitForFunction(() => {
    const { G } = window.NS3D, units = window.NS3D.game.units();
    return [...units.byId.keys()].every((id) => G.view.entities.has(id)) && [...G.view.entities.keys()].every((id) => units.byId.has(id));
  }, null, { polling: 250, timeout: 15000 }).catch(() => {});
  const state = await page.evaluate(() => {
    const { G } = window.NS3D, units = window.NS3D.game.units();
    const bad = [];
    for (const [id, el] of units.byId) {
      const p = el.object3D.position;
      if (![p.x, p.y, p.z].every(Number.isFinite) || Math.abs(p.x) > 300 || Math.abs(p.z) > 300) bad.push(id);
    }
    const shown = [...units.byId.keys()].filter((id) => !G.view.entities.has(id)).length, missing = [...G.view.entities.keys()].filter((id) => !units.byId.has(id)).length;
    const hud = ['top', 'right', 'sel', 'bar', 'toasts'].map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    return { tick: G.world.tick, bad, shown, missing, nan: /\bNaN\b|\bundefined\b/.test(hud), seen: window.seen };
  });
  if (state.bad.length) throw new Error(`units drawn where none can be: ${state.bad.join(', ')}`);
  if (state.shown > 0 || state.missing > 0) throw new Error(`the units on the screen are not the world's: ${state.shown} too many, ${state.missing} missing`);
  if (state.nan) throw new Error('"NaN" or "undefined" in the HUD');
  if ((state.seen.build ?? 0) < 5 || (state.seen.bridge ?? 0) < 5) throw new Error(`too little happened: ${JSON.stringify(state.seen)}`);
  if (warnings.length) throw new Error(`page warnings:\n  ${[...new Set(warnings)].slice(0, 5).join('\n  ')}`);
  return errors;
};

/**
 * A Priest who holds a crystal (sent for a walk while carrying one home) and is sent to a geyser:
 * he banks it at the Temple first and then collects, instead of the order being refused.
 */
SCENARIOS.carrier = async () => {
  const { page, errors } = await open({ width: 800, height: 500 });
  await startMission(page);
  const r = await page.evaluate(() => {
    const { G, game, stepWorld, flushPendingAi } = window.NS3D;
    G.worker?.terminate();
    G.worker = null;
    const step = (n, until) => {
      for (let i = 0; i < n; i++) {
        if (!stepWorld()) { flushPendingAi(); stepWorld(); }
        game.handleEvents();
        if (until?.()) return true;
      }
      return false;
    };
    const toasts = [], show = game.hud.toast.bind(game.hud);
    game.hud.toast = (text, kind) => { toasts.push(text); show(text, kind); };
    const p = () => G.view.priestOf(1), t = G.world.templeOf(1);
    const geyser = [...G.view.entities.values()].filter((e) => e.kind === 'geyser' && e.stock > 0 && G.view.owner[G.view.at(e.x, e.y)] === 1)
      .sort((a, b) => Math.hypot(a.x - p().x, a.y - p().y) - Math.hypot(b.x - p().x, b.y - p().y))[0];
    G.selected = p().id;
    game.primary(geyser.x, geyser.y);
    if (!step(600, () => p().carrying !== null)) return { fail: 'the Priest never picked up a crystal' };
    let spot = null;
    for (let d = 6; d < 14 && !spot; d++) for (let dx = -d; dx <= d && !spot; dx++) {
      const x = t.x + dx, y = t.y + t.fy + d;
      if (G.view.terrain[G.view.at(x, y)] === 1 && !G.view.occupant[G.view.at(x, y)]) spot = [x, y];
    }
    game.primary(...spot);
    if (!step(400, () => !p().path.length && p().goal === 'idle')) return { fail: 'the Priest did not stop' };
    if (p().carrying === null) return { fail: 'the Priest banked his crystal on a walk away from the Temple' };
    toasts.length = 0;
    game.primary(geyser.x, geyser.y);
    const collecting = step(600, () => p().carrying === null && p().goal === 'collect');
    return { collecting, toasts };
  });
  if (r.fail) throw new Error(r.fail);
  if (!r.collecting) throw new Error(`the Priest holding a crystal did not go on to the geyser: ${r.toasts.join(' / ')}`);
  if (r.toasts.some((t) => /wrong target/i.test(t))) throw new Error(`the order was refused: ${r.toasts.join(' / ')}`);
  return errors;
};

SCENARIOS.levels = async () => {
  const { page, errors } = await open();
  // each choice of level has its line, and the mission is played at the level chosen for it
  const notes = await page.evaluate(() => [document.getElementById('msLevelNote').textContent, document.getElementById('skLevelNote').textContent]);
  if (notes.some((t) => t.length < 20)) throw new Error(`a level has no description: ${JSON.stringify(notes)}`);
  await page.selectOption('#msLevel', 'hard');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  const hard = await page.evaluate(() => document.getElementById('msLevelNote').textContent);
  if (hard === notes[0]) throw new Error('the description did not follow the level chosen');
  await startMission(page);
  const got = await page.evaluate(() => {
    const { G, NS } = window.NS3D;
    return { level: G.options.difficulty, setup: G.setup.difficulty, normal: NS.DIFFICULTY.normal.moveSeconds, hard: NS.DIFFICULTY.hard.moveSeconds };
  });
  if (got.level !== 'hard' || got.setup !== 'hard') throw new Error(`the mission is not played at Hard: ${JSON.stringify(got)}`);
  // the choice is remembered for the next visit to the menu
  const kept = await page.evaluate(() => localStorage.getItem('netstorm-3d:mission-level'));
  if (kept !== 'hard') throw new Error(`the mission's level was not kept: ${kept}`);
  return errors;
};

SCENARIOS.skirmish = async () => {
  const { page, errors } = await open();
  // a skirmish from the menu: Thunder against Wind on four islands, a fixed map
  await page.selectOption('#skTheme', 'thunder');
  await page.selectOption('#skEnemy', 'wind');
  await page.selectOption('#skIslands', '4');
  await page.fill('#skSeed', '7');
  await page.click('[data-start="skirmish"]');
  await page.waitForFunction(() => document.querySelector('#modal h2')?.textContent === 'Skirmish', null, { timeout: 20000 }).catch(async (e) => {
    throw new Error(`no skirmish briefing; the page shows "${await page.evaluate(() => document.querySelector('#modal h2')?.textContent)}", ${JSON.stringify(await page.evaluate(() => window.NS3D.G.setup))}; ${errors.join('; ')}`);
  });
  await page.click('#modal button.main');
  const start = await page.evaluate(() => {
    const { G } = window.NS3D;
    return { mission: G.mission, theme: G.world.players.get(1).theme, enemy: G.world.players.get(2).theme, buildings: [...G.view.entities.values()].filter((e) => e.kind === 'building' && e.owner === 2).length };
  });
  if (start.mission !== null || start.theme !== 'thunder' || start.enemy !== 'wind') throw new Error(`not the skirmish asked for: ${JSON.stringify(start)}`);
  // the map has Residences, which the rules keep free of building, and greenery on its islands
  const homes = await page.evaluate(() => {
    const { G } = window.NS3D, [x, y] = G.world.residences[0] ?? [];
    return { count: G.world.residences.length, onOne: x === undefined ? null : G.view.canBuild({ player: 1, type: 'altar', x, y }),
      decor: document.getElementById('decor').object3D.children[0]?.children.length ?? 0 };
  });
  if (!homes.count || homes.onOne !== 'blocked' || !homes.decor) throw new Error(`no Residences, or one can be built on, or no greenery: ${JSON.stringify(homes)}`);
  // the player knows the Thunder units, and a Thunder Workshop has them to make
  const thunder = await page.evaluate(() => {
    const { G, NS } = window.NS3D, w = G.world, t = w.templeOf(1), def = w.def('thunderfactory');
    let at;
    for (let y = t.y - 14; y < t.y + 18 && !at; y++) for (let x = t.x - 14; x < t.x + 22 && !at; x++) {
      const a = NS.anchorFor(def, x, y);
      if (!G.view.canBuild({ player: 1, type: 'thunderfactory', ...a })) at = a;
    }
    const shop = w.spawnBuilding('thunderfactory', 1, at.x, at.y, 0);
    shop.rising = 0;
    const offers = [...w.players.get(1).tech].filter((id) => w.def(id)?.theme === 'thunder' && NS.takesSlot(w.def(id))
      && NS.canProduce(G.view, { player: 1, workshop: shop.id, type: id }) === null);
    window.NS3D.submit({ t: 'salvage', target: shop.id }); // and gone again
    return offers;
  });
  if (thunder.length < 2) throw new Error(`a Thunder Workshop has nothing to make: ${JSON.stringify(thunder)}`);
  // the computer plays its side for five minutes of game time
  await fastForward(page, 3000);
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const { G } = window.NS3D, all = [...G.view.entities.values()];
    return {
      buildings: all.filter((e) => e.kind === 'building' && e.owner === 2).length,
      bridges: Array.from(G.view.terrain).filter((t) => t >= 2 && t <= 4).length,
      units: document.querySelectorAll('[ns-unit]').length,
      goal: document.getElementById('goalText').textContent,
    };
  });
  if (after.buildings <= start.buildings && after.bridges === 0) throw new Error(`the computer did nothing: ${JSON.stringify(after)}`);
  if (!after.goal) throw new Error('no next step shown');
  return errors;
};

/**
 * The tabletop: the preview on the screen played with the mouse (a card on the table's panel, then
 * a cell of the shrunken map), then a headset's controllers, faked: their rays hover a cell, the
 * trigger selects and builds, the sticks turn and zoom the map, A rotates the piece, the grip cancels.
 */
SCENARIOS.tabletop = async () => {
  const { page, errors } = await open({ width: 1000, height: 720 });
  await startMission(page);
  await page.waitForTimeout(1000);
  await page.keyboard.press('t');
  await page.waitForTimeout(800);
  // the orbiting camera a little back, so that the panel at the table's near edge is in view
  await page.evaluate(() => { const r = document.getElementById('camera').components['orbit-rig']; r.snap({ r: 1.6, ph: 0.75, th: 0, t: r.goal.t.clone().setZ(r.goal.t.z + 0.25) }); });
  await page.waitForTimeout(800);
  const onScreen = (what) => page.evaluate((target) => {
    const scene = document.querySelector('a-scene'), xr = scene.systems['ns-xr'], T = AFRAME.THREE, { origin } = window.NS3D;
    let p;
    if (typeof target === 'string') {
      xr.panel.acc = 1e9;
      xr.panel.update(16);
      const it = xr.panel.items.find((b) => b.label === target);
      if (!it) throw new Error(`no "${target}" on the panel: ${xr.panel.items.map((b) => b.label).join(', ')}`);
      p = xr.panel.mesh.localToWorld(new T.Vector3(((it.x + it.w / 2) / 1280 - 0.5) * 0.5, (0.5 - (it.y + it.h / 2) / 800) * 0.3125, 0));
    } else p = new T.Vector3(target[0] + 0.5 - origin.x, 0, target[1] + 0.5 - origin.z).applyMatrix4(document.getElementById('world').object3D.matrixWorld);
    p.project(scene.camera);
    const r = scene.canvas.getBoundingClientRect();
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
  }, what);
  const click = async (what) => {
    const p = await onScreen(what);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(100);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);
  };
  const site = (type) => page.evaluate((kind) => {
    const { G, NS } = window.NS3D, t = G.world.templeOf(1);
    for (let y = t.y - 14; y < t.y + 18; y++) for (let x = t.x - 14; x < t.x + 22; x++) {
      if (!G.view.canBuild({ player: 1, type: kind, ...NS.anchorFor(G.world.def(kind), x, y) })) return [x, y];
    }
    throw new Error(`no place for ${kind}`);
  }, type);
  await click('Sun Workshop');
  const tool = await page.evaluate(() => window.NS3D.G.tool);
  if (tool.type !== 'sunfactory') throw new Error(`the panel's card did not pick the Sun Workshop: ${JSON.stringify(tool)}`);
  await click(await site('sunfactory'));
  await fastForward(page, 2);
  if (!await page.evaluate(() => [...window.NS3D.G.view.entities.values()].some((e) => e.type === 'sunfactory' && e.owner === 1))) {
    throw new Error('a click on the table did not build the Workshop');
  }

  // a headset with two controllers, as far as the game sees them
  const vr = await page.evaluate(() => {
    const scene = document.querySelector('a-scene'), xr = scene.systems['ns-xr'], T = AFRAME.THREE, { G, NS, origin } = window.NS3D;
    const pad = () => ({ axes: [0, 0, 0, 0], buttons: Array.from({ length: 6 }, () => ({ pressed: false })) });
    const right = { handedness: 'right', targetRayMode: 'tracked-pointer', targetRaySpace: 'R', gamepad: pad() };
    const left = { handedness: 'left', targetRayMode: 'tracked-pointer', targetRaySpace: 'L', gamepad: pad() };
    const hand = { R: new T.Vector3(0.2, 1.15, -0.15), L: new T.Vector3(-0.2, 1.15, -0.15) }, aim = {};
    const pose = (at, to) => {
      const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, -1), to.clone().sub(at).normalize());
      return { transform: { position: at, orientation: { x: q.x, y: q.y, z: q.z, w: q.w } } };
    };
    const frame = { getPose: (space) => aim[space] ?? null, getViewerPose: () => pose(new T.Vector3(0, 1.6, 0), new T.Vector3(0, 0.9, -1)) };
    const session = { inputSources: [right, left], addEventListener() {}, removeEventListener() {} };
    xr.refSpace = () => ({});
    scene.xrSession = session;
    xr.onEnter();
    xr.recenter(frame.getViewerPose().transform);
    xr.needCenter = false;
    scene.object3D.updateMatrixWorld(true);
    const cellAt = ([x, y]) => new T.Vector3(x + 0.5 - origin.x, 0, y + 0.5 - origin.z).applyMatrix4(xr.world.matrixWorld);
    const card = (label) => {
      xr.panel.acc = 1e9;
      xr.panel.update(16);
      const it = xr.panel.items.find((b) => b.label === label);
      return xr.panel.mesh.localToWorld(new T.Vector3(((it.x + it.w / 2) / 1280 - 0.5) * 0.5, (0.5 - (it.y + it.h / 2) / 800) * 0.3125, 0));
    };
    const point = (to) => { aim.R = pose(hand.R, to); xr.pollInputs(16, frame, {}); };
    const pull = () => xr.onSelect({ inputSource: right, frame });
    const out = { mode: xr.mode, rig: document.getElementById('camera').components['orbit-rig'].enabled };
    // hover, then select the Temple
    const t = G.world.templeOf(1), tc = [t.x + 1, t.y + 1];
    point(cellAt(tc));
    out.hover = G.hover && G.hover.x === tc[0] && G.hover.y === tc[1];
    out.beam = [...xr.beams.values()].some((b) => b.visible);
    pull();
    out.selected = G.selected === t.id;
    // a Golem from the panel's card, built where the ray points
    point(card('Golem'));
    pull();
    out.tool = G.tool.type;
    let golem;
    for (let y = t.y - 6; y < t.y + 10 && !golem; y++) for (let x = t.x - 6; x < t.x + 10 && !golem; x++) {
      if (!G.view.canBuild({ player: 1, type: 'sunwalker', ...NS.anchorFor(G.world.def('sunwalker'), x, y) })) golem = [x, y];
    }
    point(cellAt(golem));
    pull();
    out.golemCell = golem;
    // the right stick turns and zooms the map; A rotates the piece; the grip cancels
    right.gamepad.axes = [0, 0, 0.9, -0.9];
    xr.pollInputs(100, frame, {});
    right.gamepad.axes = [0, 0, 0, 0];
    out.turned = xr.yaw !== 0 && xr.zoom > 1;
    const rot = G.rot;
    right.gamepad.buttons[4].pressed = true;
    xr.pollInputs(16, frame, {});
    right.gamepad.buttons[4].pressed = false;
    out.rotated = G.rot !== rot;
    G.tool = { kind: 'piece', hand: 0 };
    xr.onSqueeze();
    out.cancelled = G.tool.kind === 'select';
    return out;
  });
  await fastForward(page, 2);
  const golems = await page.evaluate(() => [...window.NS3D.G.view.entities.values()].filter((e) => e.kind === 'transport' && e.owner === 1).length);
  const bad = Object.entries({ ...vr, golem: golems > 0 }).filter(([k, v]) => v === false && k !== 'rig');
  if (vr.mode !== 'vr' || vr.rig) throw new Error(`not in VR: ${JSON.stringify(vr)}`);
  if (bad.length) throw new Error(`in VR, these failed: ${bad.map(([k]) => k).join(', ')} (${JSON.stringify(vr)})`);
  // and out again: the screen's view back
  const back = await page.evaluate(() => {
    const scene = document.querySelector('a-scene'), xr = scene.systems['ns-xr'];
    xr.onExit();
    scene.xrSession = undefined;
    xr.setMode(null);
    return { mode: xr.mode, scale: xr.world.scale.x, rig: document.getElementById('camera').components['orbit-rig'].enabled };
  });
  if (back.mode !== null || back.scale !== 1 || !back.rig) throw new Error(`not back on the screen: ${JSON.stringify(back)}`);
  return errors;
};

let failed = 0;
for (const [name, run] of Object.entries(SCENARIOS)) {
  if (only && name !== only) continue;
  const started = Date.now();
  try {
    const errors = await run();
    if (errors.length) throw new Error(`page errors:\n  ${[...new Set(errors)].join('\n  ')}`);
    console.log(`✓ ${name} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  } catch (e) {
    failed++;
    console.log(`✗ ${name}: ${e.message}`);
  }
  // one page at a time: software rendering is slow enough as it is
  for (const page of pages.splice(0)) await page.close();
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
