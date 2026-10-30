/**
 * Everything on the battlefield as A-Frame entities. `ns-units` keeps one child
 * <a-entity ns-unit="id: N"> for each entity of the world (buildings, transports, flyers, priests,
 * crystals, geysers) and one <a-entity ns-residence> for each Residence; `ns-unit` draws its entity
 * as a model or a sprite card, moves it smoothly from cell to cell and shows its health.
 */
import { G, NS, TPS, PX, FACING_YAW, wx, wz, playerTheme } from '../state.js';
import { MODELS, HEIGHT, modelKind, spriteKey, cargoModel, part, ico, glow } from '../models.js';

const { THREE } = AFRAME;

/** The camera's turn this frame, which every card and health bar copies. */
const facing = { t: -1, q: new THREE.Quaternion() };
function cameraTurn(scene, t) {
  if (facing.t !== t && scene.camera) {
    scene.camera.getWorldQuaternion(facing.q);
    facing.t = t;
  }
  return facing.q;
}

/** A sprite as a card standing on the ground at (ox, oz), its bottom edge there, facing the camera. */
export function makeCard(img, ox, oz) {
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  const w = img.width / PX, h = img.height / PX;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }));
  card.position.y = h / 2;
  const holder = new THREE.Group();
  holder.position.set(ox, 0.06, oz);
  holder.add(card);
  return holder;
}

AFRAME.registerComponent('ns-units', {
  init() {
    this.byId = new Map();
    this.residences = [];
    this.el.sceneEl.addEventListener('ns-new-game', () => this.reset());
  },

  reset() {
    for (const el of [...this.byId.values(), ...this.residences]) el.parentNode?.removeChild(el);
    this.byId.clear();
    this.residences = G.view.residences.map(([x, y]) => this.add('ns-residence', { x, y }));
  },

  add(component, data) {
    const el = document.createElement('a-entity');
    el.setAttribute(component, data);
    this.el.appendChild(el);
    return el;
  },

  tick() {
    if (!G.view) return;
    for (const e of G.view.entities.values()) {
      if (!this.byId.has(e.id)) this.byId.set(e.id, this.add('ns-unit', { id: e.id }));
    }
    const game = this.el.sceneEl.systems['ns-game'];
    for (const [id, el] of this.byId) {
      if (G.view.entities.has(id)) continue;
      if (game.destroyed.has(id) && el.components['ns-unit']) game.effects()?.explode(el.components['ns-unit'].rep, el.object3D.position);
      el.parentNode?.removeChild(el);
      this.byId.delete(id);
    }
    game.destroyed.clear();
  },
});

AFRAME.registerComponent('ns-unit', {
  schema: { id: { type: 'int' } },

  init() {
    const e = G.view.entities.get(this.data.id);
    const kind = e ? modelKind(e) : 'generic';
    this.rep = {
      id: this.data.id, kind: e?.kind, type: e?.type, owner: e?.owner ?? 0, anim: [], yaw: 0, phase: 0,
      foot: e?.kind === 'building' ? [e.fx, e.fy] : null, height: HEIGHT[kind] ?? (e?.kind === 'building' ? 2.5 : 1.6),
    };
    this.model = new THREE.Group();
    if (e) (MODELS[kind] ?? MODELS.generic)(this.rep, this.model, e);
    this.el.setObject3D('model', this.model);
    this.pos = null;
    this.art = this.el.sceneEl.systems['ns-art'];
    if (e) this.place(e, 16, true);
  },

  /** Where the entity stands now, in world cells, a mover part-way to its next cell. */
  cellPos(e) {
    if (e.kind === 'building') return [e.x + e.fx / 2, e.y + e.fy / 2];
    if (e.kind === 'flyer') return [e.px / 100, e.py / 100];
    let x = e.x + 0.5, y = e.y + 0.5;
    if (e.path?.length && e.move > 0) {
      const f = Math.min(1, e.move / 100), [nx, ny] = e.path[0];
      x += (nx + 0.5 - x) * f;
      y += (ny + 0.5 - y) * f;
    }
    return [x, y];
  },

  place(e, dt, snap = false) {
    const [cx, cy] = this.cellPos(e), tx = wx(cx), tz = wz(cy);
    if (!this.pos || snap) this.pos = new THREE.Vector3(tx, 0, tz);
    const dx = tx - this.pos.x, dz = tz - this.pos.z, dd = Math.hypot(dx, dz);
    if (dd > 4) this.pos.set(tx, 0, tz);
    else {
      const k = 1 - Math.exp(-dt / 90);
      this.pos.x += dx * k;
      this.pos.z += dz * k;
    }
    const rep = this.rep;
    if (dd > 0.01 && (e.kind === 'transport' || e.kind === 'priest' || e.kind === 'flyer')) {
      let turn = Math.atan2(dx, dz) - rep.yaw;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      rep.yaw += turn * Math.min(1, dt / 120);
      rep.phase += dt * 0.012 * Math.min(1, dd * 4);
    }
    this.el.object3D.position.copy(this.pos);
    this.model.rotation.y = rep.yaw;
  },

  tick(t, dt) {
    const e = G.view?.entities.get(this.data.id);
    if (!e) return;
    const rep = this.rep, s = t / 1000;
    this.place(e, dt);
    let visible = true;
    if (e.kind === 'crystal' && e.carriedBy !== null) visible = false;
    if (e.kind === 'priest') {
      visible = e.state !== 'carried';
      rep.body.rotation.x = e.state === 'down' ? -Math.PI / 2 * 0.95 : 0;
      rep.body.position.y = e.state === 'down' ? 0.25 : e.state === 'chained' ? 0.5 + Math.sin(s * 2) * 0.1 : 0;
    }
    if (e.kind === 'building') {
      const grow = e.rising > 0 ? Math.max(0.06, 1 - e.rising / (NS.BUILD_SECONDS * TPS)) : 1;
      this.model.scale.y = grow;
      if (this.card) this.card.scale.y = grow;
      if (rep.turret) rep.turret.rotation.y = FACING_YAW[e.facing ?? 2];
      if (rep.barrel) rep.barrel.position.z = 0.95 - (e.lastShot >= 0 && G.world.tick - e.lastShot < 3 ? 0.25 : 0);
      if (rep.slotsMark) this.markSlots(e);
    }
    if (rep.steam) this.steam(e, s);
    if (rep.walk) rep.walk(e.path?.length ? rep.phase : 0);
    if (rep.cargo) this.cargo(e);
    for (const f of rep.anim) f(s);

    // a sprite card in "Sprites" mode where the original has a picture for it, else the model
    const key = spriteKey(e), img = this.art.sprite(key);
    if (img) {
      if (this.cardKey !== key) this.setCard(e, key, img);
      this.card.visible = visible;
      this.model.visible = false;
      if (e.kind === 'flyer') this.card.position.y = 3.6 + Math.sin(s * 2 + rep.id) * 0.15;
      this.card.quaternion.copy(cameraTurn(this.el.sceneEl, t));
    } else {
      if (this.card) this.card.visible = false;
      this.model.visible = visible;
    }
    this.healthBar(e, t);
  },

  setCard(e, key, img) {
    if (this.card) this.el.object3D.remove(this.card);
    // the bottom of a ¾-view picture is the near edge of the footprint
    const front = e.kind === 'building' ? e.fy / 2 - 0.15 : e.kind === 'geyser' ? 0.9 : 0.3;
    this.card = makeCard(img, 0, front);
    this.cardKey = key;
    this.el.object3D.add(this.card);
  },

  steam(e, s) {
    const on = e.stock > 0 && this.art.mode !== 'sprites';
    for (const p of this.rep.steam) {
      p.mesh.visible = on;
      if (!on) continue;
      const k = (s * 0.32 + p.phase) % 1;
      p.mesh.position.set(Math.sin(k * 6 + p.seed * 9) * 0.25 * k, 0.3 + k * 4.8, Math.cos(k * 5 + p.seed * 7) * 0.2 * k);
      p.mesh.scale.setScalar(0.25 + k * 1.05);
      p.mesh.material.opacity = Math.min(1, k * 6) * (1 - k) * 0.6;
    }
  },

  cargo(e) {
    const want = e.carrying ?? null;
    if (this.cargoId === want) return;
    this.cargoId = want;
    this.rep.cargo.clear();
    if (want !== null) this.rep.cargo.add(cargoModel(G.view.entities.get(want)));
  },

  markSlots(e) {
    const sig = e.slots.join(',');
    if (this.slotSig === sig) return;
    this.slotSig = sig;
    this.rep.slotsMark.clear();
    e.slots.forEach((type, i) => {
      const c = { sun: '#e8b04a', rain: '#59b3e6', wind: '#8cc05a', thunder: '#a184ea' }[G.world.def(type).theme ?? 'sun'];
      part(this.rep.slotsMark, ico(0.22), glow(c, c, 0.6), i * 0.55, 0.2, 0);
    });
  },

  healthBar(e, t) {
    const seen = this.model.visible || !!this.card?.visible;
    const show = e.hp !== undefined && e.hpMax > 0 && seen && (e.hp < e.hpMax || G.selected === e.id);
    if (!show) { if (this.bar) this.bar.visible = false; return; }
    if (!this.bar) {
      this.bar = new THREE.Group();
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.16), new THREE.MeshBasicMaterial({ color: '#1a1a1a', depthTest: false, transparent: true, opacity: 0.8 }));
      this.barFg = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.11), new THREE.MeshBasicMaterial({ color: '#6fd08c', depthTest: false }));
      this.barFg.position.z = 0.001;
      bg.renderOrder = 10;
      this.barFg.renderOrder = 11;
      this.bar.add(bg, this.barFg);
      this.el.object3D.add(this.bar);
    }
    const f = Math.max(0, e.hp / e.hpMax);
    this.bar.visible = true;
    this.barFg.scale.x = Math.max(0.001, f);
    this.barFg.position.x = -0.68 * (1 - f);
    this.barFg.material.color.set(f > 0.6 ? '#6fd08c' : f > 0.3 ? '#f2c14e' : '#ff6b5b');
    this.bar.position.y = this.rep.height + 0.6;
    this.bar.scale.setScalar(e.kind === 'building' ? 1.6 : 0.8);
    this.bar.quaternion.copy(cameraTurn(this.el.sceneEl, t));
  },
});

/** A Residence: part of the map, owned by whoever holds the ground under it. */
AFRAME.registerComponent('ns-residence', {
  schema: { x: { type: 'int' }, y: { type: 'int' } },

  init() {
    const { x, y } = this.data, foot = NS.RESIDENCE_FOOT;
    this.model = new THREE.Group();
    MODELS.residence({ anim: [] }, this.model);
    this.el.setObject3D('model', this.model);
    this.el.object3D.position.set(wx(x + foot / 2), 0, wz(y + foot / 2));
    this.art = this.el.sceneEl.systems['ns-art'];
    this.front = foot / 2 - 0.15;
  },

  tick(t) {
    const owner = G.view?.owner[this.data.y * NS.W + this.data.x] ?? 0;
    const key = `residence:${owner ? playerTheme(owner) : 'sun'}`;
    const img = this.art.sprite(key) ?? this.art.sprite('residence:sun');
    if (img && this.cardKey !== key) {
      if (this.card) this.el.object3D.remove(this.card);
      this.card = makeCard(img, 0, this.front);
      this.cardKey = key;
      this.el.object3D.add(this.card);
    }
    if (this.card) {
      this.card.visible = !!img;
      if (img) this.card.quaternion.copy(cameraTurn(this.el.sceneEl, t));
    }
    this.model.visible = !img;
  },
});
