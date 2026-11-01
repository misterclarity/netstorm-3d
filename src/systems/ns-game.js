/**
 * The game system: runs the match each frame, turns the player's clicks and keys into the game's
 * commands, and passes the simulation's events on to the HUD and the effects. The scene's
 * components draw what it holds in `G`.
 */
import { NS, THREE, G, ME, defs, origin, wx, wz, errorText, keysOff } from '../state.js';
import { newGame, stepWorld, submit, flushPendingAi } from '../game.js';
import { Hud } from '../hud.js';
import { watchForUpdates } from '../version.js';
import { Minimap } from '../minimap.js';
import { groundCell, unit, localRay } from '../space.js';
import { energyAt, missingAdvice } from '../energy.js';
import * as models from '../models.js';

const AIR_BOX = new THREE.Box3(), AIR_HIT = new THREE.Vector3(), PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

AFRAME.registerSystem('ns-game', {
  init() {
    this.destroyed = new Set();
    this.raycaster = new THREE.Raycaster();
    // handles for tests and the console
    window.NS3D = { G, NS, origin, wx, wz, game: this, stepWorld, flushPendingAi, submit, models };
    this.el.addEventListener('loaded', () => {
      this.hud = new Hud(this);
      this.minimap = new Minimap(this);
      document.getElementById('camera').addEventListener('orbit-pan', () => { G.follow = null; });
      watchForUpdates((version) => this.hud.newVersion(version));
      this.el.systems.shadow?.setShadowMapEnabled(true);
      this.el.addEventListener('ns-tap', (e) => this.onTap(e.detail));
      this.el.addEventListener('ns-hover', (e) => this.onHover(e.detail));
      window.addEventListener('keydown', (e) => this.onKey(e));
      this.start(G.setup, { menu: true });
      if (this.el.renderStarted) this.pace();
      else this.el.addEventListener('renderstart', () => this.pace(), { once: true });
      setTimeout(() => document.getElementById('loading')?.classList.add('gone'), 300);
    });
  },

  /**
   * The frame loop, in place of A-Frame's: a frame at most 60 times a second (a high-refresh
   * screen would draw twice as many for no gain), and 15 while nothing calls for more: the battle
   * paused or not started, or a dialog open, with the camera still. A headset gets every frame.
   * The sun's shadow map is drawn every other frame (it does not change with the camera, only with
   * what moves on the islands), which halves the cost of the shadow pass.
   */
  pace() {
    const scene = this.el, renderer = scene.renderer, render = scene.render;
    let next = -Infinity, n = 0;
    renderer.shadowMap.autoUpdate = false;
    renderer.setAnimationLoop((time, frame) => {
      if (!renderer.xr.isPresenting) {
        // each frame is due one interval after the last was due, so the rate holds on average
        // whatever the screen's own rate; after a long gap the count starts over
        const interval = 1000 / (this.lively() ? 60 : 15);
        if (time < next - 1) return;
        next = time - next > interval ? time + interval : next + interval;
      }
      renderer.shadowMap.needsUpdate = n++ % 2 === 0 || this.shadowsNow;
      this.shadowsNow = false;
      render(time, frame);
    });
    this.paced = true;
  },

  /** Whether the scene has to move smoothly now. */
  lively() {
    if (G.started && !G.paused && !G.ended && !this.hud.modalOpen()) return true;
    return !!document.getElementById('camera')?.components['orbit-rig']?.moving();
  },

  /**
   * A new match, the mission or a skirmish: the components rebuild from it on `ns-new-game`. With
   * `menu`, the main menu comes up over it instead of the briefing.
   */
  start(setup = G.setup, { menu = false } = {}) {
    newGame(setup);
    this.sound().newGame();
    this.destroyed.clear();
    this.rising = new Set();
    this.el.emit('ns-new-game');
    this.shadowsNow = true;
    this.frameView();
    this.hud.reset();
    if (menu) this.hud.menu();
    else this.hud.briefing();
  },

  /**
   * The camera's starting view: the mission's whole battlefield, or a skirmish's home island. On a
   * table the tabletop view sets it instead.
   */
  frameView() {
    const rig = document.getElementById('camera')?.components['orbit-rig'];
    if (!rig || this.xr().mode) return;
    const temple = G.world.templeOf(ME);
    if (G.mission || !temple) rig.setHome(new THREE.Vector3(-7, 0, 7), 82);
    else rig.setHome(new THREE.Vector3(wx(temple.x + temple.fx / 2), 0, wz(temple.y + temple.fy / 2) + 6), 70);
  },

  tick(t, dt) {
    if (!G.world || !this.hud) return;
    dt = Math.min(dt, 250);
    // a hidden page holds the battle; but a headset may hide the page it shows the battle for
    if (!G.paused && !G.ended && (!document.hidden || this.el.xrSession)) G.clock.advance(dt * G.speed, stepWorld);
    this.handleEvents();
    if (G.view.terrainRevision !== G.terrainRevision) {
      G.terrainRevision = G.view.terrainRevision;
      this.el.emit('ns-terrain');
    }
    this.watchBuildings();
    this.minimap.follow();
    this.miniAcc = (this.miniAcc ?? 0) + dt;
    if (this.miniAcc > 200) { this.miniAcc = 0; this.minimap.draw(); }
    this.hud.frame(dt);
  },

  /** Note in the log when one of the player's buildings is up. */
  watchBuildings() {
    for (const e of G.view.entities.values()) {
      if (e.kind !== 'building' || e.owner !== ME) continue;
      if (e.rising > 0) this.rising.add(e.id);
      else if (this.rising.delete(e.id)) this.hud.log(`${defs.get(e.type)?.name ?? e.type} is ready`, 'good');
    }
  },

  effects() { return this.el.querySelector('[ns-effects]')?.components['ns-effects']; },
  units() { return this.el.querySelector('[ns-units]')?.components['ns-units']; },
  sound() { return this.el.systems['ns-sound']; },
  xr() { return this.el.systems['ns-xr']; },
  placement() { return this.el.querySelector('[ns-placement]')?.components['ns-placement']; },

  handleEvents() {
    const hud = this.hud, fx = this.effects(), sound = this.sound();
    const positionOf = (id) => this.units()?.byId.get(id)?.object3D.position.clone();
    for (const ev of G.world.drainEvents()) {
      const mine = ev.who === ME;
      sound.hear(ev, positionOf);
      switch (ev.what) {
        case 'rejected': if (mine) hud.toast(errorText(ev.data.err), 'bad'); break;
        case 'destroyed': {
          this.destroyed.add(ev.data.id);
          const lost = this.units()?.byId.get(ev.data.id)?.components['ns-unit']?.rep;
          const name = ev.data.type === 'priest' ? 'Priest' : defs.get(ev.data.type)?.name ?? ev.data.type;
          if (lost?.owner === ME) hud.log(`Your ${name} was destroyed`, 'bad');
          else if (lost?.owner && G.world.hostile(ME, lost.owner)) hud.log(`Enemy ${name} destroyed`, 'good');
          break;
        }
        case 'geyser': hud.log('A new geyser has risen'); break;
        case 'delivered': {
          const next = mine && G.afterDelivery.get(ev.data.transport);
          if (next) {
            G.afterDelivery.delete(ev.data.transport);
            submit(next);
          }
          break;
        }
        case 'upgrade': if (mine) hud.log(`Workshop upgraded to level ${ev.data.level + 1}`, 'good'); break;
        case 'salvaged': {
          const el = this.units()?.byId.get(ev.data.id);
          if (el) fx?.puff(el.object3D.position.clone().setY(1), '#cfe8ff', 2, 0.6);
          if (mine) hud.toast(`Salvaged: +${ev.data.refund} Storm Power`, 'good');
          break;
        }
        case 'bridge fell': fx?.fall(ev.data.x, ev.data.y, 1, 1, true); break;
        case 'islet fell': fx?.fall(ev.data.x, ev.data.y, ev.data.w, ev.data.h, false); break;
        case 'build': if (mine && ev.data.type === 'sunwalker') hud.toast('A Golem is ready. Select it, then click a geyser.', 'good'); break;
        case 'captured': {
          if (!mine) { hud.toast('Your Priest has been captured!', 'bad'); break; }
          const p = G.world.entities.get(ev.data.priest), t = p && G.world.entities.get(p.carriedBy);
          const name = defs.get(t?.type)?.name ?? 'carrier';
          hud.toast(t?.goal === 'altar' ? `Your ${name} has the enemy Priest! It carries him to your Altar.`
            : `Your ${name} holds the enemy Priest. Build an Altar, then send it there with “Carry to the Altar”.`, 'good');
          break;
        }
        case 'chained': hud.toast(mine ? 'The enemy Priest is chained to your Altar. Send your Priest there to begin the sacrifice.' : 'Your Priest is chained to an enemy Altar!', mine ? 'good' : 'bad'); break;
        case 'rune': hud.toast(`Rune ${ev.data.runes} of 5 is warded`, mine ? 'good' : 'bad'); break;
        case 'released': hud.toast('A captive Priest is free again'); break;
        case 'priest down': hud.toast(mine ? 'Your Priest is down!' : 'The enemy Priest is down! Send a Golem to capture him.', mine ? 'bad' : 'good'); break;
        case 'sacrifice': {
          hud.toast(mine ? 'The sacrifice is complete!' : 'Your Priest was sacrificed', mine ? 'good' : 'bad');
          // the end of the battle waits until the Priest has fallen through the Altar, as heard
          const from = performance.now();
          G.holdEnd = from + 8000;
          sound.sacrificeLength(ev.data.gift === NS.GIFT_UPGRADE).then((s) => {
            if (G.holdEnd > from) G.holdEnd = from + Math.max(1500, s * 1000 + 600);
          });
          break;
        }
        case 'too early': if (mine) hud.toast('Too early for a sacrifice: wait, then press “Carry to the Altar” again', 'bad'); break;
        default: break;
      }
    }
    if (G.ended || performance.now() < G.holdEnd) return;
    // a skirmish ends on the simulation's verdict; a mission on its script's pages
    if (!G.mission) {
      const result = NS.outcome(G.world, ME);
      if (result) hud.result(result === 'won');
      return;
    }
    const event = NS.nextEvent(G.view, ME, G.raised);
    const page = event ? G.mission.pages[event] : null;
    if (page) hud.page(event, page);
    else if (G.view.winner != null) {
      const won = G.view.winner === ME;
      hud.page(won ? 'succeeded' : 'failed', G.mission.pages[won ? 'succeeded' : 'failed']);
    }
  },

  /* ---------------------------------------- input ---------------------------------------- */
  /** The scene ray under screen point (px, py). */
  rayAt(px, py) {
    const cam = this.el.camera;
    if (!cam) return null;
    const r = this.el.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, cam);
    return this.raycaster.ray.clone();
  },
  /** The map cell under screen point (px, py), on the screen's battlefield or a table's. */
  cellAt(px, py) {
    const ray = this.rayAt(px, py);
    return ray && groundCell(ray);
  },
  onHover(d) {
    const ray = d && this.rayAt(d.x, d.y);
    // over the tabletop's own panel there is no cell to point at
    if (ray && this.xr().panelHover(ray)) { G.mouse = null; G.hover = null; G.hoverPick = null; return; }
    G.mouse = d;
    G.hover = ray ? groundCell(ray) : null;
    G.hoverPick = this.pickAt(ray);
  },
  onTap(d) {
    const ray = this.rayAt(d.x, d.y);
    if (d.button !== 2 && ray && this.xr().panelPress(ray)) return;
    if (!G.started || this.hud.modalOpen()) return;
    if (d.button === 2) { this.cancel(); return; }
    const cell = ray && groundCell(ray);
    if (!cell) return;
    if (d.touch && G.tool.kind !== 'select') {
      // on a touch screen the first tap shows where it goes, the second lays it
      const same = G.hover && G.hover.x === cell.x && G.hover.y === cell.y;
      G.hover = cell;
      G.mouse = d;
      if (!same) return;
    }
    this.primary(cell.x, cell.y, d.shift, this.pickAt(ray));
  },

  /**
   * The Aerial Transport whose body a scene ray passes through, nearest first, or null. They float
   * high above their cell, so the cell under the cursor is behind them; their bodies are what is
   * clicked.
   */
  airAt(ray) {
    if (!ray || G.tool.kind !== 'select') return null;
    const units = this.units();
    let best = null, near = Infinity;
    for (const e of G.view.entities.values()) {
      if (e.kind !== 'transport' || !NS.flies(defs.get(e.type))) continue;
      const el = units?.byId.get(e.id);
      if (!el) continue;
      AIR_BOX.setFromObject(el.object3D).expandByScalar(0.25 * unit());
      const hit = ray.intersectBox(AIR_BOX, AIR_HIT);
      const d = hit ? hit.distanceTo(ray.origin) : Infinity;
      if (d < near) { near = d; best = e; }
    }
    return best;
  },

  /**
   * With a carrier (a Transport or the player's Priest) selected, the geyser or loose crystal the
   * ray points at, before anything else under the cursor: by its body (the geyser's steam column,
   * the crystal) or by the ground within a cell and a half of it, the nearest to the camera. A
   * small geyser beside a Workshop or a Golem is what a carrier is sent for.
   */
  gatherAt(ray) {
    const sel = G.selected === null ? null : G.view.entities.get(G.selected);
    if (!ray || G.tool.kind !== 'select' || sel?.owner !== ME || (sel.kind !== 'transport' && sel.kind !== 'priest')) return null;
    const units = this.units(), local = localRay(ray), ground = local.intersectPlane(PLANE, new THREE.Vector3());
    let best = null, near = Infinity;
    for (const e of G.view.entities.values()) {
      const geyser = e.kind === 'geyser' && e.stock > 0, crystal = e.kind === 'crystal' && e.carriedBy === null;
      if (!geyser && !crystal) continue;
      const el = units?.byId.get(e.id);
      if (!el) continue;
      const p = el.object3D.position, r = geyser ? 1.1 : 0.75, h = geyser ? Math.max(3.5, el.components['ns-unit']?.rep?.height ?? 0) : 1.4;
      AIR_BOX.min.set(p.x - r, 0, p.z - r);
      AIR_BOX.max.set(p.x + r, h, p.z + r);
      const hit = local.intersectBox(AIR_BOX, AIR_HIT);
      let d = hit ? hit.distanceTo(local.origin) : Infinity;
      if (d === Infinity && ground && Math.abs(ground.x - p.x) <= 1.5 && Math.abs(ground.z - p.z) <= 1.5) d = ground.distanceTo(local.origin) + 1;
      if (d < near) { near = d; best = e; }
    }
    return best;
  },

  /** What a ray picks above the ground before the cell under it: for a selected carrier a geyser
   * or crystal, else an Aerial Transport by its body. */
  pickAt(ray) {
    return this.gatherAt(ray) ?? this.airAt(ray);
  },

  /** A click on map cell (x, y), as netstorm-web's controls.ts reads it; `picked` is a unit hit
   * above the ground (an Aerial Transport), which counts before what stands on the cell. */
  primary(x, y, shift = false, picked = null) {
    const tool = G.tool;
    if (tool.kind === 'piece') {
      if (!G.world.players.get(ME).hand[tool.hand]) return;
      const err = G.view.canDropPiece({ player: ME, hand: tool.hand, x, y, rot: G.rot });
      if (err) this.hud.toast(errorText(err), 'bad');
      else submit({ t: 'dropPiece', hand: tool.hand, x, y, rot: G.rot });
      return;
    }
    if (tool.kind === 'build') {
      const def = defs.get(tool.type), a = NS.anchorFor(def, x, y);
      const cmd = { t: 'build', type: def.id, ...a, ...(NS.hasFacing(def) ? { facing: G.facing } : {}) };
      const err = G.view.canBuild({ player: ME, ...cmd });
      if (err) { this.hud.toast(err === 'no energy' ? missingAdvice(def, energyAt(def, a.x, a.y)) : errorText(err), 'bad'); return; }
      submit(cmd);
      if (!shift) this.setTool({ kind: 'select' });
      return;
    }
    const target = picked ?? NS.entityAt(G.view, x, y);
    if (this.order(x, y, target)) {
      // the unit answers its order: a carrier sent for something with its pickup sound
      this.sound().voice(G.view.entities.get(G.selected), target && target.owner !== ME ? 'pickup' : 'move');
      return;
    }
    G.selected = target?.id ?? null;
    this.sound().voice(target, 'move');
    this.hud.dirty = true;
  },

  /** An order for the selected unit; false when the click is a selection instead. */
  order(x, y, target) {
    const sel = G.selected === null ? undefined : G.view.entities.get(G.selected);
    const own = (e) => !!e && e.owner === ME;
    if (!sel || !own(sel)) return false;
    // your Priest sent to your Altar (or to the captive chained on it) performs the sacrifice
    const altar = target?.kind === 'building' && target.owner === ME && defs.get(target.type)?.cls === 'Altar' ? target
      : target?.kind === 'priest' && target.state === 'chained' ? G.view.entities.get(target.chainedAt) : null;
    if (sel.kind === 'priest' && altar?.owner === ME) { G.afterDelivery.delete(sel.id); this.priestToAltar(altar); return true; }
    if (own(target)) return false;
    G.afterDelivery.delete(sel.id); // a new order replaces one that waited
    if ((sel.kind === 'transport' || sel.kind === 'priest') && target) {
      if (target.kind === 'geyser' || target.kind === 'crystal') {
        const cmd = target.kind === 'geyser' ? { t: 'collect', transport: sel.id, geyser: target.id }
          : { t: 'pickupCrystal', transport: sel.id, crystal: target.id };
        if (this.carrierFree(sel)) {
          submit(cmd);
          this.hud.toast(target.kind === 'geyser' ? 'Off to the geyser' : 'Off to fetch the crystal', 'good');
        } else this.afterCargo(sel, cmd);
        return true;
      }
      if (sel.kind === 'transport' && target.kind === 'priest') {
        if (target.state !== 'down') this.hud.toast(errorText('target not incapacitated'), 'bad');
        else if (G.view.entities.get(sel.carrying)?.kind === 'priest') this.hud.toast(`The ${defs.get(sel.type)?.name ?? 'carrier'} already holds a captive`, 'bad');
        else {
          // a carrier cannot hold a crystal and a Priest: the crystal is set down where it stands,
          // for the Priest gets up again if he is left too long
          const crystal = sel.carrying !== null && sel.carrying !== undefined;
          if (crystal) submit({ t: 'dropCargo', transport: sel.id });
          submit({ t: 'capturePriest', transport: sel.id, target: target.id });
          this.hud.toast(crystal ? 'Crystal set down: off to capture the enemy Priest!' : 'Capturing the enemy Priest!', 'good');
        }
        return true;
      }
    }
    if (sel.kind === 'priest' && target?.kind !== 'building') { submit({ t: 'movePriest', x, y }); return true; }
    // a carrier sent to ground goes there (an Aerial Transport flies and lands); the sky deselects
    if (sel.kind === 'transport' && !target && G.view.walkable(ME, x, y)) {
      submit({ t: 'moveTransport', transport: sel.id, x, y });
      return true;
    }
    return false;
  },

  /**
   * Whether a carrier can take an errand now: one that holds something (a Bulf, one crystal of
   * two) or a Priest who is down or carried off cannot, and the simulation would answer "Wrong
   * target" (rules/movement.ts, ownCarrier).
   */
  carrierFree(t) {
    if (t.kind === 'priest' && t.state !== 'normal') return false;
    if (t.carrying === null || t.carrying === undefined) return true;
    const held = G.view.entities.get(t.carrying);
    return t.kind === 'transport' && t.type === 'bulf' && held?.kind === 'crystal' && held.value <= (NS.CRYSTAL_VALUE ?? 200);
  },

  /**
   * An errand for a carrier still holding a crystal: it banks the crystal at the Temple first,
   * then sets off (the order waits for its 'delivered' event). A Priest is walked there; a carrier
   * already on its way home just goes on.
   */
  afterCargo(t, cmd) {
    const name = t.kind === 'priest' ? 'Your Priest' : `The ${defs.get(t.type)?.name ?? 'carrier'}`;
    if (t.kind === 'priest' && t.state !== 'normal') { this.hud.toast(errorText('priest unavailable'), 'bad'); return; }
    const held = G.view.entities.get(t.carrying);
    if (held?.kind !== 'crystal') { this.hud.toast(`${name} is carrying a captive`, 'bad'); return; }
    const next = cmd.t === 'collect' ? 'goes to the geyser' : 'fetches the crystal';
    if (t.goal === 'home' && t.path?.length) {
      G.afterDelivery.set(t.id, cmd);
      this.hud.toast(`${name} banks the crystal it carries at the Temple, then ${next}`, 'good');
    } else if (t.kind === 'priest' && this.bankCargo(t, false)) {
      G.afterDelivery.set(t.id, cmd);
      this.hud.toast(`${name} first takes the crystal he carries to the Temple, then ${next}`, 'good');
    } else {
      this.hud.toast(`${name} still holds a crystal and can't reach the Temple: drop it first`, 'bad');
    }
  },

  /** Walk the player's Priest beside his Temple (or an Outpost), where the crystal he holds is banked. */
  bankCargo(p, tell = true) {
    const depots = G.view.depotsOf(ME);
    const path = depots.length && G.view.findPath(ME, p.x, p.y, ([x, y]) => depots.some((d) => G.view.adjacentTo(x, y, d)), true);
    if (!path?.length) {
      if (tell) this.hud.toast(errorText('no path'), 'bad');
      return false;
    }
    const [x, y] = path[path.length - 1];
    submit({ t: 'movePriest', x, y });
    if (tell) {
      G.afterDelivery.delete(p.id);
      this.hud.toast('Your Priest takes his crystal to the Temple', 'good');
    }
    return true;
  },

  /** Walk the player's Priest to a free cell beside the Altar, where he performs the sacrifice. */
  priestToAltar(altar) {
    const p = G.view.priestOf(ME);
    if (!p || p.state !== 'normal') { this.hud.toast(errorText('priest unavailable'), 'bad'); return; }
    const beside = ([cx, cy]) => cx >= altar.x - 1 && cx <= altar.x + altar.fx && cy >= altar.y - 1 && cy <= altar.y + altar.fy
      && (cx < altar.x || cx >= altar.x + altar.fx || cy < altar.y || cy >= altar.y + altar.fy);
    if (beside([p.x, p.y])) { this.hud.toast('Your Priest is at the Altar', 'good'); return; }
    const path = G.view.findPath(ME, p.x, p.y, beside, true);
    if (!path?.length) { this.hud.toast(errorText('no path'), 'bad'); return; }
    const [x, y] = path[path.length - 1];
    submit({ t: 'movePriest', x, y });
    this.hud.toast('Your Priest walks to the Altar', 'good');
  },

  setTool(tool) {
    G.tool = tool;
    this.hud.dirty = true;
  },
  cancel() {
    if (G.tool.kind !== 'select') this.setTool({ kind: 'select' });
    else if (G.selected !== null) { G.selected = null; this.hud.dirty = true; }
  },
  /** Turn the bridge piece in hand, or the cannon about to be built. */
  rotate() {
    if (G.tool.kind === 'build') G.facing = (G.facing + 1) % 4;
    else G.rot = (G.rot + 1) % 4;
    this.sound().play('rotatepiece');
    this.hud.dirty = true;
  },
  /** Every key of the game, but the camera's (held W A S D Q E and arrows, in orbit-rig). */
  onKey(e) {
    if (keysOff(e)) return;
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '6') {
      const i = Number(k) - 1;
      if (G.world.players.get(ME).hand[i]) this.setTool({ kind: 'piece', hand: i });
      return;
    }
    const act = {
      escape: () => this.cancel(),
      r: () => this.rotate(),
      ' ': () => this.hud.togglePause(),
      '+': () => this.hud.setSpeed(1),
      '=': () => this.hud.setSpeed(1),
      '-': () => this.hud.setSpeed(-1),
      delete: () => { if (G.selected !== null) this.hud.salvage(); },
      l: () => this.hud.toggleLog(),
      g: () => this.placement().toggleEnemyReach(),
      h: () => this.minimap.toTemple(),
      p: () => this.minimap.toPriest(),
      f: () => this.minimap.toggleFollow(),
      t: () => this.xr().toggle(),
    }[k];
    if (!act) return;
    e.preventDefault();
    act();
  },
});
