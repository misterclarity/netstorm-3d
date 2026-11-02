/**
 * Everything on the battlefield as A-Frame entities. `ns-units` keeps one child
 * <a-entity ns-unit="id: N"> for each entity of the world (buildings, transports, flyers, priests,
 * crystals, geysers) and one <a-entity ns-residence> for each Residence; `ns-unit` draws its entity
 * as a model or a sprite card, moves it smoothly from cell to cell and shows its health.
 */
import { G, NS, ART, TPS, PX, FACING_YAW, wx, wz, playerTheme, defs } from '../state.js';
import { MODELS, heightOf, modelKind, spriteKey, cargoModel, part, ico, glow, bake } from '../models.js';

const { THREE } = AFRAME;

/**
 * The camera's turn this frame on the battlefield, which every card and health bar copies: the
 * camera's own, less the battlefield root's when the table is turned.
 */
const facing = { t: -1, q: new THREE.Quaternion(), r: new THREE.Quaternion() };
function cameraTurn(scene, t) {
  if (facing.t !== t && scene.camera) {
    scene.camera.getWorldQuaternion(facing.q);
    const root = document.getElementById('world')?.object3D;
    if (root) facing.q.premultiply(root.getWorldQuaternion(facing.r).invert());
    facing.t = t;
  }
  return facing.q;
}

/** Which way the camera looks across the battlefield this frame, as a facing: 0 north ... 3 west. */
const look = { t: -1, way: 0, v: new THREE.Vector3() };
function cameraLook(scene, t) {
  if (look.t !== t) {
    const q = cameraTurn(scene, t), v = look.v.set(0, 0, -1).applyQuaternion(q);
    // looking straight down, the top of the view is the way it looks
    if (Math.hypot(v.x, v.z) < 0.2) v.set(0, 1, 0).applyQuaternion(q);
    look.way = Math.abs(v.x) > Math.abs(v.z) ? (v.x > 0 ? 1 : 3) : (v.z > 0 ? 2 : 0);
    look.t = t;
  }
  return look.way;
}

const PUFF = new THREE.Object3D(), FADE = new THREE.Color();
/**
 * An Aerial Transport's sprite in the air: the original draws one aloft 44 pixels up (an altitude
 * of 4 cells at 11 rows a cell), here 44 / PX; landed, it still hovers a little, clear of what
 * stands about. A soft shadow under it shows where it is.
 */
const AIR = { aloft: 44 / PX, landed: 1.3 };
const AIR_SHADOW = { geo: new THREE.CircleGeometry(1, 24), mat: new THREE.MeshBasicMaterial({ color: '#0a1020', transparent: true, opacity: 0.3, depthWrite: false }) };
const cards = new WeakMap();
/** A sprite's texture, plane and material, made once per picture and shared by every card of it. */
function cardParts(img) {
  let c = cards.get(img);
  if (!c) {
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    const w = img.width / PX, h = img.height / PX;
    c = { geo: new THREE.PlaneGeometry(w, h), mat: new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }), h };
    cards.set(img, c);
  }
  return c;
}

/** A sprite as a card standing on the ground at (ox, oz), its bottom edge there, facing the camera. */
function makeCard(img, ox, oz) {
  const { geo, mat, h } = cardParts(img);
  const card = new THREE.Mesh(geo, mat);
  card.position.y = h / 2;
  const holder = new THREE.Group();
  holder.position.set(ox, 0.06, oz);
  holder.add(card);
  return holder;
}

/** The health bar's shapes and colours, shared by every bar. */
let BAR = null;
function barParts() {
  BAR ??= {
    back: new THREE.PlaneGeometry(1.4, 0.16),
    fill: new THREE.PlaneGeometry(1.36, 0.11),
    dark: new THREE.MeshBasicMaterial({ color: '#1a1a1a', depthTest: false, transparent: true, opacity: 0.8 }),
    good: new THREE.MeshBasicMaterial({ color: '#6fd08c', depthTest: false }),
    hurt: new THREE.MeshBasicMaterial({ color: '#f2c14e', depthTest: false }),
    low: new THREE.MeshBasicMaterial({ color: '#ff6b5b', depthTest: false }),
  };
  return BAR;
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
      const rep = el.components['ns-unit']?.rep;
      if (game.destroyed.has(id) && rep) game.effects()?.explode(rep, el.object3D.position);
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
      foot: e?.kind === 'building' ? [e.fx, e.fy] : null, height: 1.6,
      own: [], // what this unit alone holds on the GPU, freed with it
    };
    this.model = new THREE.Group();
    if (e) {
      (MODELS[kind] ?? MODELS.generic)(this.rep, this.model, e);
      bake(this.model, `${kind}|${e.type ?? ''}|${e.owner ?? 0}`);
      this.rep.height = heightOf(this.model);
      // an Aerial Transport's ring under it spans the ship
      if (e.kind === 'transport' && NS.flies(defs.get(e.type))) {
        const b = new THREE.Box3().setFromObject(this.model);
        this.rep.span = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
        this.rep.flies = true;
        this.rep.alt = e.aloft ? AIR.aloft : AIR.landed;
        this.rep.lift = e.aloft ? 1 : 0;
        this.shadow = new THREE.Mesh(AIR_SHADOW.geo, AIR_SHADOW.mat);
        this.shadow.rotation.x = -Math.PI / 2;
        this.shadow.position.y = 0.07;
        this.shadow.scale.set(1.5, 1, 1);
        this.shadow.visible = false;
        this.el.object3D.add(this.shadow);
      }
    }
    this.el.setObject3D('model', this.model);
    this.pos = null;
    this.art = this.el.sceneEl.systems['ns-art'];
    if (e) this.place(e, 16, true);
  },

  /** Everything else it uses is shared (bake(), cardParts(), barParts(), ns-art's frames). */
  remove() {
    for (const m of this.rep.own) m.dispose();
    this.animMesh?.material.dispose();
  },

  /** Where the entity stands now, in world cells, a mover part-way to its next cell. */
  cellPos(e) {
    if (e.kind === 'building') return [e.x + e.fx / 2, e.y + e.fy / 2];
    if (e.kind === 'flyer') return [e.px / NS.FLYER_SCALE, e.py / NS.FLYER_SCALE];
    let x = e.x + 0.5, y = e.y + 0.5;
    if (e.path?.length && e.move > 0) {
      const f = NS.stepShare(e), [nx, ny] = e.path[0];
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
      if (rep.barrel) rep.barrel.position.z = (rep.barrelZ ?? 0.95) - (e.lastShot >= 0 && G.world.tick - e.lastShot < 3 ? 0.25 : 0);
      if (rep.slotsMark) this.markSlots(e);
    }
    if (rep.steam) this.steam(e, s);
    if (rep.walk) rep.walk(e.path?.length ? rep.phase : 0);
    if (rep.cargo) this.cargo(e);
    for (const f of rep.anim) f(s);

    // an air ship's sprite rises as it takes off and sinks as it lands
    if (rep.flies) {
      rep.alt += ((e.aloft || e.path?.length ? AIR.aloft : AIR.landed) - rep.alt) * (1 - Math.exp(-dt / 350));
      rep.lift = (rep.alt - AIR.landed) / (AIR.aloft - AIR.landed); // the 3D model's height follows
    }

    // in "Sprites" mode: the frame of its animation where it has one, else its still sprite, else
    // the model
    const frame = this.art.frameOf(e);
    if (this.shadow) this.shadow.visible = false;
    if (frame) {
      this.showFrame(e, frame, visible, t, s);
      this.model.visible = false;
      if (this.card) this.card.visible = false;
      this.healthBar(e, t);
      return;
    }
    if (this.anim) this.anim.visible = false;
    const key = spriteKey(e, cameraLook(this.el.sceneEl, t)), img = this.art.sprite(key);
    if (img) {
      if (this.cardKey !== key) this.setCard(e, key, img);
      this.card.visible = visible;
      this.model.visible = false;
      if (e.kind === 'flyer') this.card.position.y = 3.6 + Math.sin(s * 2 + rep.id) * 0.15;
      if (rep.flies) this.card.position.y = this.airLift(visible, s);
      this.card.quaternion.copy(cameraTurn(this.el.sceneEl, t));
    } else {
      if (this.card) this.card.visible = false;
      this.model.visible = visible;
    }
    this.healthBar(e, t);
  },

  /**
   * An animation frame as a card facing the camera, standing where the original draws it: its hot
   * spot on the unit's place (for a building, the hot foot of its footprint), and the card's
   * bottom on the ground below the picture's lowest row, read as a ¾ view (11 rows to a cell).
   */
  showFrame(e, f, visible, t, s) {
    if (!this.anim) {
      this.anim = new THREE.Group();
      this.animMesh = new THREE.Mesh(f.geo, new THREE.MeshBasicMaterial({ map: f.tex, alphaTest: 0.5, side: THREE.DoubleSide }));
      this.anim.add(this.animMesh);
      this.el.object3D.add(this.anim);
    }
    this.animMesh.geometry = f.geo;
    this.animMesh.material.map = f.tex;
    this.animMesh.position.y = f.h / PX / 2;
    let hx = 0, hy = 0; // the hot spot, from the unit's middle, in cells
    if (e.kind === 'building' || e.kind === 'geyser') {
      const [fx, fy] = ART.hotFeet[e.kind === 'geyser' ? 'geyser' : e.type] ?? [0, 0];
      const foot = e.kind === 'geyser' ? { x: e.x - 1, y: e.y - 1, w: 3, h: 3 } : { x: e.x, y: e.y, w: e.fx, h: e.fy };
      const [mx, my] = this.cellPos(e);
      hx = foot.x + foot.w - fx - mx;
      hy = foot.y + foot.h - fy - my;
    }
    const across = (f.w / 2 - f.hx) / PX;
    if (e.kind === 'flyer') this.anim.position.set(across, 3.6 + Math.sin(s * 2 + this.rep.id) * 0.15, 0);
    else this.anim.position.set(hx + across, this.rep.flies ? this.airLift(visible, s) : 0.06, hy + (f.h - f.hy) / 11);
    this.anim.scale.y = e.kind === 'building' && e.rising > 0 ? Math.max(0.06, 1 - e.rising / (NS.BUILD_SECONDS * TPS)) : 1;
    this.anim.visible = visible;
    this.anim.quaternion.copy(cameraTurn(this.el.sceneEl, t));
  },

  /** How high an air ship's sprite is drawn, gently bobbing; its shadow shown on the ground. */
  airLift(visible, s) {
    const rep = this.rep, up = rep.alt + Math.sin(s * 1.2 + rep.id) * 0.1 * (rep.alt / AIR.aloft);
    this.shadow.visible = visible;
    this.shadow.scale.set(1.5 - rep.alt * 0.12, 1 - rep.alt * 0.08, 1);
    return 0.06 + up;
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
    const { mesh, puffs } = this.rep.steam, on = e.stock > 0 && this.art.mode !== 'sprites';
    mesh.visible = on;
    if (!on) return;
    puffs.forEach((p, i) => {
      const k = (s * 0.32 + p.phase) % 1;
      PUFF.position.set(Math.sin(k * 6 + p.seed * 9) * 0.25 * k, 0.3 + k * 4.8, Math.cos(k * 5 + p.seed * 7) * 0.2 * k);
      PUFF.scale.setScalar(0.25 + k * 1.05);
      PUFF.updateMatrix();
      mesh.setMatrixAt(i, PUFF.matrix);
      const a = Math.min(1, k * 6) * (1 - k) * 0.6; // its opacity, carried by the colour's red
      mesh.setColorAt(i, FADE.setRGB(a, a, a));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
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
    const parts = barParts();
    if (!this.bar) {
      this.bar = new THREE.Group();
      const bg = new THREE.Mesh(parts.back, parts.dark);
      this.barFg = new THREE.Mesh(parts.fill, parts.good);
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
    this.barFg.material = f > 0.6 ? parts.good : f > 0.3 ? parts.hurt : parts.low;
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
    this.el.object3D.position.set(wx(x + foot / 2), 0, wz(y + foot / 2));
    this.art = this.el.sceneEl.systems['ns-art'];
    this.front = foot / 2 - 0.15;
  },

  /** The house in the colours of the Fury that holds its island. */
  build(theme) {
    this.model = new THREE.Group();
    MODELS.residence({ anim: [], own: [] }, this.model, theme);
    bake(this.model, `residence|${theme}`);
    this.el.setObject3D('model', this.model);
    this.theme = theme;
  },

  tick(t) {
    const owner = G.view?.owner[this.data.y * NS.W + this.data.x] ?? 0, theme = owner ? playerTheme(owner) : 'sun';
    if (theme !== this.theme) this.build(theme);
    const key = `residence:${theme}`;
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
