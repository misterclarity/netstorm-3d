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

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

async function open(viewport = { width: 1000, height: 640 }) {
  const page = await browser.newPage({ viewport });
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

/** Run n ticks at once, the computer's moves worked out in place. */
const fastForward = (page, n) => page.evaluate((n) => {
  const { G, stepWorld, flushPendingAi } = window.NS3D;
  G.worker = null;
  for (let i = 0; i < n; i++) if (!stepWorld()) { flushPendingAi(); stepWorld(); }
  return G.world.tick;
}, n);

const SCENARIOS = {
  /** The opening: a Workshop (with the cursor resting on its new site), a Golem sent to a geyser,
   * the Sun Cannon in a production slot, a bridge piece. */
  async opening() {
    const { page, errors } = await open();
    await page.click('#modal button.main');
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
    await page.click('#modal button.main');
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
    let sent = false;
    for (let i = 0; i < 40; i++) {
      await fastForward(page, 60);
      const s = await page.evaluate(() => ({ state: window.NS3D.G.world.priestOf(2)?.state, ended: window.NS3D.G.ended }));
      if (s.state === 'chained' && !sent) {
        sent = true;
        await page.evaluate(() => {
          const { G, game } = window.NS3D;
          G.selected = G.world.priestOf(1).id;
          const altar = [...G.view.entities.values()].find((e) => e.type === 'altar' && e.owner === 1);
          game.primary(altar.x + 3, altar.y + 3);
        });
      }
      if (s.ended) break;
    }
    await page.waitForTimeout(500);
    const title = await page.evaluate(() => document.querySelector('#modal h2')?.textContent);
    if (title !== 'Victory!') throw new Error(`the mission ended with "${title}", not Victory`);
    return errors;
  },
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
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
