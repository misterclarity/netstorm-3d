/**
 * The game system: runs the match each frame, turns the player's clicks and keys into the game's
 * commands, and passes the simulation's events on to the HUD and the effects. The scene's
 * components draw what it holds in `G`.
 */
import { NS, THREE, G, MISSION, ME, defs, origin, errorText } from '../state.js';
import { newGame, stepWorld, submit, flushPendingAi } from '../game.js';
import { Hud } from '../hud.js';

AFRAME.registerSystem('ns-game', {
  init() {
    this.destroyed = new Set();
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    // handles for tests and the console
    window.NS3D = { G, NS, origin, game: this, stepWorld, flushPendingAi, submit };
    this.el.addEventListener('loaded', () => {
      this.hud = new Hud(this);
      this.el.systems.shadow?.setShadowMapEnabled(true);
      this.el.addEventListener('ns-tap', (e) => this.onTap(e.detail));
      this.el.addEventListener('ns-hover', (e) => this.onHover(e.detail));
      window.addEventListener('keydown', (e) => this.onKey(e));
      this.start();
      setTimeout(() => document.getElementById('loading')?.classList.add('gone'), 300);
    });
  },

  /** A new match: the components rebuild from it on `ns-new-game`. */
  start() {
    newGame();
    this.sound().newGame();
    this.destroyed.clear();
    this.el.emit('ns-new-game');
    this.hud.reset();
    this.hud.briefing();
  },

  tick(t, dt) {
    if (!G.world || !this.hud) return;
    dt = Math.min(dt, 250);
    if (!G.paused && !G.ended && !document.hidden) G.clock.advance(dt * G.speed, stepWorld);
    this.handleEvents();
    if (G.view.terrainRevision !== G.terrainRevision) {
      G.terrainRevision = G.view.terrainRevision;
      this.el.emit('ns-terrain');
    }
    this.hud.frame(dt);
  },

  effects() { return this.el.querySelector('[ns-effects]')?.components['ns-effects']; },
  units() { return this.el.querySelector('[ns-units]')?.components['ns-units']; },
  sound() { return this.el.systems['ns-sound']; },

  handleEvents() {
    const hud = this.hud, fx = this.effects(), sound = this.sound();
    const positionOf = (id) => this.units()?.byId.get(id)?.object3D.position.clone();
    for (const ev of G.world.drainEvents()) {
      const mine = ev.who === ME;
      sound.hear(ev, positionOf);
      switch (ev.what) {
        case 'rejected': if (mine) hud.toast(errorText(ev.data.err), 'bad'); break;
        case 'destroyed': this.destroyed.add(ev.data.id); break;
        case 'salvaged': {
          const el = this.units()?.byId.get(ev.data.id);
          if (el) fx?.puff(el.object3D.position.clone().setY(1), '#cfe8ff', 2, 0.6);
          if (mine) hud.toast(`Salvaged: +${ev.data.refund} Storm Power`, 'good');
          break;
        }
        case 'bridge fell': fx?.fall(ev.data.x, ev.data.y, 1, 1, true); break;
        case 'islet fell': fx?.fall(ev.data.x, ev.data.y, ev.data.w, ev.data.h, false); break;
        case 'build': if (mine && ev.data.type === 'sunwalker') hud.toast('A Golem is ready. Select it, then click a geyser.', 'good'); break;
        case 'captured': hud.toast(mine ? 'Your Golem has the enemy Priest! It carries him to your Altar.' : 'Your Priest has been captured!', mine ? 'good' : 'bad'); break;
        case 'chained': hud.toast(mine ? 'The enemy Priest is chained to your Altar. Send your Priest there to begin the sacrifice.' : 'Your Priest is chained to an enemy Altar!', mine ? 'good' : 'bad'); break;
        case 'rune': hud.toast(`Rune ${ev.data.runes} of 5 is warded`, mine ? 'good' : 'bad'); break;
        case 'released': hud.toast('A captive Priest is free again'); break;
        case 'priest down': hud.toast(mine ? 'Your Priest is down!' : 'The enemy Priest is down! Send a Golem to capture him.', mine ? 'bad' : 'good'); break;
        case 'sacrifice': hud.toast(mine ? 'The sacrifice is complete!' : 'Your Priest was sacrificed', mine ? 'good' : 'bad'); break;
        case 'too early': if (mine) hud.toast('Too early for a sacrifice: wait, then send the Golem again', 'bad'); break;
        default: break;
      }
    }
    // the mission's script: success or failure
    const event = NS.nextEvent(G.view, ME, G.raised);
    const page = event ? MISSION.pages[event] : null;
    if (page) hud.page(event, page);
    else if (!G.ended && G.view.winner != null) {
      const won = G.view.winner === ME;
      hud.page(won ? 'succeeded' : 'failed', MISSION.pages[won ? 'succeeded' : 'failed']);
    }
  },

  /* ---------------------------------------- input ---------------------------------------- */
  cellAt(px, py) {
    const cam = this.el.camera;
    if (!cam) return null;
    const r = this.el.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, cam);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, hit)) return null;
    return { x: Math.floor(hit.x + origin.x), y: Math.floor(hit.z + origin.z) };
  },
  onHover(d) {
    G.mouse = d;
    G.hover = d ? this.cellAt(d.x, d.y) : null;
  },
  onTap(d) {
    if (!G.started) return;
    if (d.button === 2) { this.cancel(); return; }
    const cell = this.cellAt(d.x, d.y);
    if (!cell) return;
    if (d.touch && G.tool.kind !== 'select') {
      // on a touch screen the first tap shows where it goes, the second lays it
      const same = G.hover && G.hover.x === cell.x && G.hover.y === cell.y;
      G.hover = cell;
      G.mouse = d;
      if (!same) return;
    }
    this.primary(cell.x, cell.y, d.shift);
  },

  /** A click on map cell (x, y), as netstorm-web's controls.ts reads it. */
  primary(x, y, shift = false) {
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
      if (err) { this.hud.toast(errorText(err), 'bad'); return; }
      submit(cmd);
      if (!shift) this.setTool({ kind: 'select' });
      return;
    }
    const target = NS.entityAt(G.view, x, y);
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
    if (sel.kind === 'priest' && altar?.owner === ME) { this.priestToAltar(altar); return true; }
    if (own(target)) return false;
    if ((sel.kind === 'transport' || sel.kind === 'priest') && target) {
      if (target.kind === 'geyser') {
        submit({ t: 'collect', transport: sel.id, geyser: target.id });
        this.hud.toast('Off to the geyser', 'good');
        return true;
      }
      if (target.kind === 'crystal') { submit({ t: 'pickupCrystal', transport: sel.id, crystal: target.id }); return true; }
      if (sel.kind === 'transport' && target.kind === 'priest') {
        if (target.state === 'down') {
          submit({ t: 'capturePriest', transport: sel.id, target: target.id });
          this.hud.toast('Capturing the enemy Priest!', 'good');
        } else this.hud.toast(errorText('target not incapacitated'), 'bad');
        return true;
      }
    }
    if (sel.kind === 'priest' && target?.kind !== 'building') { submit({ t: 'movePriest', x, y }); return true; }
    return false;
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
  onKey(e) {
    if (e.target.closest?.('input,textarea') || this.hud.modalOpen()) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') this.cancel();
    else if (k === 'r') {
      if (G.tool.kind === 'build') G.facing = (G.facing + 1) % 4;
      else G.rot = (G.rot + 1) % 4;
      this.sound().play('rotatepiece');
      this.hud.dirty = true;
    } else if (k === ' ') { e.preventDefault(); this.hud.togglePause(); }
    else if (k >= '1' && k <= '6') {
      const i = Number(k) - 1;
      if (G.world.players.get(ME).hand[i]) this.setTool({ kind: 'piece', hand: i });
    } else if (k === '+' || k === '=') this.hud.setSpeed(1);
    else if (k === '-') this.hud.setSpeed(-1);
    else if (k === 'delete' && G.selected !== null) this.hud.salvage();
  },
});
