/**
 * First person: the player takes over the Priest and sees through his eyes. V (or Eyes by the
 * minimap) goes in and out. W A S D or the arrows walk him, the mouse looks about (the pointer is
 * locked to the view, raw where the browser allows; a click on the view locks it, Esc lets it go),
 * keys and mouse together as in any first-person game, and a crosshair
 * points at what he would act on: a click there acts as a click of the overhead view with him
 * selected (to a geyser to collect, a crystal to fetch, his Altar to perform the Sacrifice, ground
 * to walk to) or lays what is chosen to build, which the mouse wheel or Tab picks among his Priest
 * builds. Q casts the Spell he holds round him, R prays (Shift+R picks the prayer), B banks the
 * crystal he holds at the Temple, X drops it.
 *
 * He is walked by the rules (steerPriest, scripts/house-rules.mjs): the way the keys point from
 * where he looks, at any angle, at his pace, sliding along what he cannot step onto; the order
 * goes in the moment the keys change, with the share of the tick it was given at, and the view
 * draws him a frame at a time where the rules' own step (walkStep) will put him, so he answers the
 * keys at once and stops dead when they are let go. How he is walked and where his eyes are is
 * the `place` below: the islands' now; a dungeon behind a cave mouth will bring its own, and the
 * view, the crosshair and his actions stay as they are.
 */
import { NS, THREE, G, ME, defs, TPS, wx, wz } from '../state.js';
import { submit } from '../game.js';
import { groundCell, toScene } from '../space.js';
import { spellName } from '../spells.js';
import { groundAt } from '../heights.js';

/** His eyes above the ground he stands on, in cells; lying knocked out, near it. */
const EYE = 1.45, EYE_DOWN = 0.35;
const LOOK = 0.0022;
const FOV = 70;
const WALK_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

/** The islands as a place to walk: the rules walk him (steerPriest), and say where he will be. */
const ISLANDS = {
  /** Steer him: (vx, vy) hundredths of his pace on the map's axes, from `lead` hundredths of the coming tick on. */
  steer(vx, vy, lead) {
    submit({ t: 'steerPriest', vx, vy, lead });
    return G.commands[G.commands.length - 1];
  },
  /** Where he stands now in cells, `alpha` of the coming tick on, by the rules' own step and the
   * order waiting for it; null while the rules do not walk him by hand (a ride on a lift, an order
   * from above). */
  at(p, alpha, order) {
    // walked by hand, or about to be: from the middle of his cell, as the rules start him (and
    // start him again when he has been carried or thrown off the cell he was walked in)
    const SUB = NS.WALK_SUB, mid = { x: p.x * SUB + SUB / 2, y: p.y * SUB + SUB / 2, vx: 0, vy: 0, ride: false };
    let s = G.world.walking?.get(p.id) ?? (order ? mid : null);
    if (s && !s.ride && (Math.floor(s.x / SUB) !== p.x || Math.floor(s.y / SUB) !== p.y)) s = { ...mid, vx: s.vx, vy: s.vy };
    if (!s || s.ride || (p.path.length && !order)) return null;
    let x = s.x, y = s.y;
    if (p.state === 'normal' && !(p.casting > 0) && G.view.terrain[p.y * NS.W + p.x] !== 0) {
      const lead = order ? order.lead / 100 : 1;
      const first = NS.walkStep(G.world, p, x, y, s.vx, s.vy, Math.min(alpha, lead));
      ({ x, y } = first);
      if (order && alpha > lead && !first.ride) ({ x, y } = NS.walkStep(G.world, p, x, y, order.vx, order.vy, alpha - lead));
    }
    return [x / NS.WALK_SUB, y / NS.WALK_SUB];
  },
};

AFRAME.registerSystem('ns-fp', {
  init() {
    this.active = false;
    this.place = ISLANDS;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = -0.15;
    this.v = [0, 0];
    this.order = null;
    this.prayer = 0;
    this.raycaster = new THREE.Raycaster();
    this.centre = new THREE.Vector2(0, 0);
    this.eye = new THREE.Vector3();
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (this.active && WALK_KEYS.has(k) && !e.target?.closest?.('input,textarea,select')) { this.keys.add(k); e.preventDefault(); this.steer(); }
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.key.toLowerCase()); if (this.active) this.steer(); });
    window.addEventListener('blur', () => { this.keys.clear(); if (this.active) this.steer(); });
    document.addEventListener('mousemove', (e) => {
      if (!this.active || document.pointerLockElement !== this.el.canvas) return;
      this.yaw -= e.movementX * LOOK;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * LOOK, -1.45, 1.35);
    });
    document.addEventListener('pointerlockchange', () => this.hud());
    this.el.addEventListener('render-target-loaded', () => this.bind());
    if (this.el.canvas) this.bind();
  },

  bind() {
    const canvas = this.el.canvas;
    if (!canvas || this.bound) return;
    this.bound = true;
    canvas.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (document.pointerLockElement !== canvas) { this.lock(); return; }
      if (e.button === 0) this.act();
      if (e.button === 2) this.game().cancel();
    });
    canvas.addEventListener('wheel', (e) => { if (this.active) { e.preventDefault(); this.cycleBuild(e.deltaY > 0 ? 1 : -1); } }, { passive: false });
  },

  game() { return this.el.systems['ns-game']; },
  rig() { return document.getElementById('camera')?.components['orbit-rig']; },
  priest() { return G.world?.priestOf(ME) ?? null; },

  /** In or out of the Priest's eyes. */
  toggle() {
    if (this.active) this.leave();
    else this.enter();
  },

  enter() {
    const game = this.game(), p = this.priest(), rig = this.rig();
    if (!G.started || G.ended || !p || !rig || game.xr().mode) {
      game.hud?.toast(p ? 'First person is for the battle on the screen' : 'Your Priest is not on the field', 'bad');
      return;
    }
    this.active = true;
    G.fp = { active: true, id: p.id };
    this.saved = rig.view();
    rig.enabled = false;
    const cam = document.getElementById('camera');
    this.camera = { ...cam.getAttribute('camera') };
    cam.setAttribute('camera', { fov: FOV, near: 0.05 });
    // looking the way the view above looked
    this.yaw = rig.cur.th;
    this.pitch = -0.15;
    game.select([p.id]);
    game.setTool({ kind: 'select' });
    this.v = [0, 0];
    this.order = null;
    document.body.classList.add('fp');
    this.lock();
    this.hud();
    game.hud.toast('Your Priest’s eyes: W A S D to walk, the mouse to look, click to act; V to look from above again', 'good');
  },

  leave() {
    if (!this.active) return;
    const p = this.priest(), rig = this.rig(), cam = document.getElementById('camera');
    this.keys.clear();
    this.steer(); // he stops where he is
    this.active = false;
    G.fp = null;
    if (document.pointerLockElement) document.exitPointerLock();
    cam.setAttribute('camera', { fov: this.camera?.fov ?? 45, near: this.camera?.near ?? 0.3 });
    if (rig) {
      rig.enabled = true;
      // above where he stands now
      if (this.saved) rig.snap(this.saved);
      if (p) rig.focus(wx(p.x + 0.5), wz(p.y + 0.5), undefined, rig.goal.t.y);
    }
    document.body.classList.remove('fp');
    this.game().setTool({ kind: 'select' });
    this.hud();
  },

  /** The pointer locked to the view, raw (no pointer acceleration) where the browser allows. */
  lock() {
    const canvas = this.el.canvas;
    if (!canvas?.requestPointerLock || document.pointerLockElement === canvas) return;
    const plain = () => { try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* a click on the view asks again */ } };
    try {
      const asked = canvas.requestPointerLock({ unadjustedMovement: true });
      if (asked?.catch) asked.catch(plain);
    } catch { plain(); }
  },

  /** A key in first person; true when it was the Priest's. */
  onKey(e) {
    const k = e.key.toLowerCase(), p = this.priest();
    const act = {
      v: () => this.leave(),
      escape: () => { if (G.tool.kind !== 'select') this.game().cancel(); else this.leave(); },
      e: () => this.act(),
      q: () => this.cast(),
      // R turns a bridge piece in hand, as from above; else he prays
      r: () => (G.tool.kind === 'piece' ? this.game().rotate() : e.shiftKey ? this.nextPrayer() : this.pray()),
      b: () => { if (p) this.game().bankCargo(p); },
      x: () => { if (p?.carrying !== null && p?.carrying !== undefined) submit({ t: 'dropCargo', transport: p.id }); },
      tab: () => this.cycleBuild(e.shiftKey ? -1 : 1),
    }[k];
    if (WALK_KEYS.has(k)) return true;
    if (!act) return false;
    e.preventDefault();
    act();
    this.hud();
    return true;
  },

  /** The ray from his eyes through the crosshair. */
  ray() {
    const cam = this.el.camera;
    if (!cam) return null;
    this.raycaster.setFromCamera(this.centre, cam);
    return this.raycaster.ray.clone();
  },

  /**
   * The cell the crosshair points at; with something to lay chosen, the cell that puts its near
   * edge there, so that what he lays stands before him and not on his feet.
   */
  aimCell(ray) {
    const cell = ray && groundCell(ray);
    if (!cell || G.tool.kind !== 'build') return cell;
    const def = defs.get(G.tool.type), half = Math.max(def.footX, def.footY) / 2;
    return { ...cell, x: Math.round(cell.x - Math.sin(this.yaw) * half), y: Math.round(cell.y - Math.cos(this.yaw) * half) };
  },

  /** A click at the crosshair: what a click of the view above does there with him selected. */
  act() {
    const game = this.game(), p = this.priest(), ray = this.ray();
    if (!p || !ray) return;
    const cell = this.aimCell(ray);
    if (!cell) return;
    if (G.tool.kind !== 'select') { game.primary(cell.x, cell.y, false, game.pickAt(ray), false, ray); this.hud(); return; }
    if (G.selected !== p.id) game.select([p.id]);
    const target = game.pickAt(ray) ?? NS.entityAt(G.view, cell.x, cell.y);
    // his own Temple with a crystal in hand: bank it
    if (target?.kind === 'building' && target.owner === ME && defs.get(target.type)?.cls === 'Energy' && p.carrying !== null && p.carrying !== undefined) {
      game.bankCargo(p);
      return;
    }
    const done = game.order(cell.x, cell.y, target);
    if (done === true) game.sound().voice(p, target && target.owner !== ME ? 'pickup' : 'move');
  },

  cast() {
    const p = this.priest();
    if (!p?.spell) { this.game().hud.toast('Your Priest holds no Spell: R prays for one', 'bad'); return; }
    const def = defs.get(p.spell), storm = G.world.players.get(ME)?.storm ?? 0;
    if (storm < def.cost) { this.game().hud.toast(`The ${def.name} costs ⚡${def.cost} to cast`, 'bad'); return; }
    submit({ t: 'castSpell', transport: p.id });
    this.game().hud.toast(`Casting the ${def.name}: everything within ${def.range} cells, in ${def.castTime} s`, 'good');
  },

  prayers() { return G.view ? NS.prayable(G.view).filter((id) => id !== this.priest()?.spell) : []; },

  pray() {
    const list = this.prayers();
    if (!list.length) { this.game().hud.toast('There is nothing to pray for in this battle', 'bad'); return; }
    const spell = list[this.prayer % list.length];
    submit({ t: 'pray', spell });
    this.game().hud.toast(`Praying for the ${spellName(spell)}: ${defs.get(spell).prayTime} s, standing still`, 'good');
  },

  nextPrayer() { this.prayer++; },

  /** The wheel or Tab: the next (or the last) of his Priest builds to lay, or none. */
  cycleBuild(step) {
    const game = this.game(), list = game.hud.priestCards().map((d) => d.id);
    if (!list.length) return;
    const at = G.tool.kind === 'build' ? list.indexOf(G.tool.type) : -1;
    const next = at < 0 && step < 0 ? list.length - 1 : at + step;
    if (next < 0 || next >= list.length) game.setTool({ kind: 'select' });
    else game.setTool({ kind: 'build', type: list[next] });
    this.hud();
  },

  /**
   * Steer him by the keys held, the way they point from where he looks, at once: one order a tick,
   * the first change in it setting when it begins (its share of the tick), the last the way.
   */
  steer() {
    const p = this.priest(), k = this.keys;
    if (!p) return;
    const fw = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const rt = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    let vx = 0, vy = 0;
    if (fw || rt) {
      // forward is where the camera looks (−Z turned by the yaw): in cells (−sin, −cos)
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw), dx = -s * fw + c * rt, dy = -c * fw - s * rt, len = Math.hypot(dx, dy);
      vx = Math.round((dx / len) * 100);
      vy = Math.round((dy / len) * 100);
    }
    if (vx === this.v[0] && vy === this.v[1]) return;
    this.v = [vx, vy];
    if (this.order && G.commands.includes(this.order)) Object.assign(this.order, { vx, vy });
    else this.order = this.place.steer(vx, vy, Math.round(G.clock.alpha * 100));
  },

  tick(t, dt) {
    if (!this.active) return;
    const p = this.priest();
    // out of his eyes when he is gone, the battle is over or over again, or a table is put up
    if (!p || !G.started || G.ended || this.game().xr().mode) { this.leave(); return; }
    G.fp.id = p.id;
    // turning with a key held turns his way too
    if (this.keys.size) this.steer();
    // his eyes: where the rules will have him this frame (walked by hand), else where his figure is
    // drawn (a ride on a lift, a walk ordered from above)
    const eye = p.state === 'down' ? EYE_DOWN : EYE, cam = document.getElementById('camera').object3D;
    const pending = this.order && G.commands.includes(this.order) ? this.order : null;
    const at = this.place.at(p, G.clock.alpha, pending);
    let target = null;
    if (at) target = toScene(this.eye.set(wx(at[0]), groundAt(at[0], at[1]) + eye, wz(at[1])));
    else {
      const el = this.game().units()?.byId.get(p.id);
      if (el) target = toScene(this.eye.copy(el.object3D.position).setY(el.object3D.position.y + eye));
    }
    if (target) {
      // to the hair while walked by hand; a short glide onto a ride or off it
      if (at || cam.position.distanceTo(target) > 6) cam.position.copy(target);
      else cam.position.lerp(target, 1 - Math.exp(-dt / 50));
    }
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    // the crosshair is the pointer: the hover, the ghost of what is to be laid, the tip by it
    const ray = this.ray();
    if (ray) {
      G.ray = ray;
      G.hover = this.aimCell(ray);
      G.hoverPick = this.game().pickAt(ray);
      const r = this.el.canvas.getBoundingClientRect();
      G.mouse = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    if (!this.nextHud || t > this.nextHud) { this.hud(); this.nextHud = t + 250; }
  },

  /** The first person's own lines: his state, what he holds, the keys. */
  hud() {
    const box = document.getElementById('fp');
    if (!box) return;
    box.hidden = !this.active;
    document.getElementById('camEyes')?.classList.toggle('on', this.active);
    if (!this.active) return;
    const p = this.priest(), secs = (n) => Math.ceil(n / TPS);
    const lines = [];
    if (p) {
      const state = { down: 'Knocked out: he gets up at half his health', carried: 'Carried off by the enemy!', chained: `Chained to an enemy Altar: ${p.runes}/5 runes` }[p.state];
      lines.push(`<b>High Priest</b> ${Math.ceil(p.hp)}/${p.hpMax}${state ? ` · ${state}` : ''}`);
      if (p.casting > 0) lines.push(`Casting the ${spellName(p.spell)}: ${secs(p.casting)} s`);
      else if (p.praying > 0) lines.push(`Praying for the ${spellName(p.prayer)}: ${secs(p.praying)} s (walking breaks it off)`);
      else if (p.spell) lines.push(`Holds the ${spellName(p.spell)} · <kbd>Q</kbd> cast it round him (⚡${defs.get(p.spell)?.cost})`);
      const held = p.carrying === null || p.carrying === undefined ? null : G.view.entities.get(p.carrying);
      if (held?.kind === 'crystal') lines.push(`Holds a crystal (⚡${held.value}) · <kbd>B</kbd> bank it · <kbd>X</kbd> drop it`);
      const prayers = this.prayers();
      if (!p.spell && !(p.praying > 0) && prayers.length) lines.push(`<kbd>R</kbd> pray for the ${spellName(prayers[this.prayer % prayers.length])}${prayers.length > 1 ? ' · <kbd>Shift</kbd>+<kbd>R</kbd> another' : ''}`);
    }
    const build = G.tool.kind === 'build' ? defs.get(G.tool.type) : null;
    lines.push(build ? `Laying a ${build.name} (⚡${build.cost}): click to lay it · wheel or <kbd>Tab</kbd> for another · right-click to put it away`
      : 'Wheel or <kbd>Tab</kbd>: something to build');
    lines.push(document.pointerLockElement === this.el.canvas
      ? '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · mouse look · click act · <kbd>Esc</kbd> free the mouse · <kbd>V</kbd> view from above'
      : '<b>Click the view to look about with the mouse</b> · <kbd>V</kbd> view from above');
    const html = lines.map((l) => `<div>${l}</div>`).join('');
    const info = document.getElementById('fpInfo');
    if (info && info.dataset.html !== html) { info.innerHTML = html; info.dataset.html = html; }
  },
});
