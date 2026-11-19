/**
 * The Combahee Raid in the scene (sim/raid.ts has its rules): a wooden dock at each landing; the
 * families on their way to the airships, with what they carry (bundles, baskets, steaming pots of
 * rice, sacks) and their animals (chickens, and two pigs), and the crowds waiting on the landings;
 * the skiffs that row them out to a ship, and a crowd clinging to them; the wardens at the quarters
 * and the volunteers sent up to drive them off; the sentries' riders off with the alarm; the sky
 * mines the Wayfinder found, floating in the wind, and the stakes across it beyond the ferry; the
 * flocks of birds that warn him of a sentry; the airships' shells, and the mills they set burning;
 * the bridge at the ferry burning; his veil while he is in disguise and a glow about him while he
 * sings; a marker over each objective's place; and the North Star in the night sky. The Combahee
 * itself is sky: nothing is drawn for it. (Many of these come from the raid of June 1863, as the
 * article "Raid on Combahee Ferry" tells it.)
 *
 * The people are drawn as small figures of the game's own, many to an instanced mesh: as many as
 * walk, and of a crowd on a landing up to CROWD_SHOWN. Nothing aims at them and nothing carries
 * them: they walk, and wait, and go aboard (sim/raid.ts).
 */
import { THREE, G, NS, wx, wz } from '../state.js';
import { nightness } from './ns-sun.js';

/** The most figures drawn at once, walking or waiting; and of one crowd on a landing. */
const FIGURES = 700;
const CROWD_SHOWN = 70;
/** How high the sky mines float: where a laden airship rides the wind (ns-units' AIR.aloft). */
const MINE_HEIGHT = 2.6;
/** Clothes and skin, varied figure by figure. */
const CLOTHES = ['#6d5a48', '#7b6a55', '#56606b', '#8a7458', '#5b4b3f', '#8c8273', '#6b4f3a', '#4d5a4a', '#9a8a6e', '#7a5f52'];
const SKIN = ['#4a2c1e', '#5a3826', '#6b4430', '#3f2619', '#7a5038', '#c9a27e', '#e0b994', '#8d5a3b'];

const tmp = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color(), e: new THREE.Euler() };
/** A matrix that draws nothing: for what a figure does not carry. */
const NONE = new THREE.Matrix4().makeScale(0, 0, 0);

/** A small, even hash of two numbers: 0 to 1. */
const h01 = (a, b) => {
  let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  x ^= x >>> 15;
  return ((Math.imul(x, 0x2c1b3c6d) ^ (x >>> 12)) >>> 0) / 4294967296;
};

AFRAME.registerComponent('ns-raid', {
  init() {
    this.root = new THREE.Group();
    this.el.setObject3D('raid', this.root);
    this.fx = [];
    this.el.sceneEl.addEventListener('ns-new-game', () => this.build());
  },

  remove() { this.clear(); },

  /** What a battle of the raid holds on the GPU of its own, given back. */
  clear() {
    for (const o of [...this.root.children]) {
      o.removeFromParent();
      o.traverse((x) => { x.geometry?.dispose(); if (x.material && !x.material.userData.shared) x.material.dispose(); });
    }
    this.fx = [];
    this.built = null;
  },

  build() {
    this.clear();
    const r = G.world?.raid;
    if (!r) return;
    this.built = r;
    this.docks(r);
    this.people();
    this.mines(r);
    this.markers(r);
    this.northStar();
    this.flames = this.flameSprites(r);
    this.aura();
    this.skiffs = this.skiffBoats(r);
    this.wardens = this.wardenFigures(r);
    this.parties = new Map();
    this.riders = this.riderFigures();
    this.stakes(r);
    this.millFires = [];
    this.pigsSeen = false;
    this.pigFamilies = new Set();
  },

  /** A wooden dock where each landing meets the wind: planks out over the sky on a beam, a post each
   * side at its end for the airships' lines. */
  docks(r) {
    const woods = ['#9a7a58', '#8a6b4b', '#a3845f'].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true }));
    const g = new THREE.Group(), post = new THREE.CylinderGeometry(0.07, 0.09, 0.6, 6);
    for (const l of r.landings) {
      const [dx, dy] = l.dock, cx = l.x + l.w / 2, cy = l.y + l.h / 2;
      // out from the landing's middle toward its dock: `along` that way, `across` the other
      const ax = Math.abs(dx + 0.5 - cx) >= Math.abs(dy + 0.5 - cy) ? Math.sign(dx + 0.5 - cx) : 0, ay = ax ? 0 : Math.sign(dy + 0.5 - cy);
      const length = 2.2, width = (ax ? l.h : l.w) * 0.7, x0 = cx + ax * (l.w / 2 - 0.2), y0 = cy + ay * (l.h / 2 - 0.2);
      const planks = Math.round(length / 0.36);
      for (let k = 0; k < planks; k++) {
        const along = (k + 0.5) * (length / planks), size = length / planks - 0.05;
        const plank = new THREE.Mesh(new THREE.BoxGeometry(ax ? size : width, 0.08, ay ? size : width), woods[(k * 7 + l.id) % woods.length]);
        plank.position.set(wx(x0 + ax * along), -0.04 + (h01(k, l.id) - 0.5) * 0.03, wz(y0 + ay * along));
        plank.rotation.y = (h01(l.id, k) - 0.5) * 0.06;
        plank.castShadow = plank.receiveShadow = true;
        g.add(plank);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(ax ? length : 0.18, 0.16, ay ? length : 0.18), woods[1]);
      beam.position.set(wx(x0 + (ax * length) / 2), -0.16, wz(y0 + (ay * length) / 2));
      g.add(beam);
      for (const side of [-1, 1]) {
        const p = new THREE.Mesh(post, woods[1]);
        p.position.set(wx(x0 + ax * (length - 0.2) + ay * side * width * 0.45), 0.26, wz(y0 + ay * (length - 0.2) + ax * side * width * 0.45));
        g.add(p);
      }
    }
    this.root.add(g);
  },

  /** The figures: bodies, heads and the bundles some carry, each an instanced mesh. */
  people() {
    const make = (geo, material) => {
      const m = new THREE.InstancedMesh(geo, material, FIGURES);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false; // (they move over the whole map: drawn as one)
      this.root.add(m);
      return m;
    };
    const body = new THREE.ConeGeometry(0.2, 0.62, 6);
    body.translate(0, 0.31, 0);
    const head = new THREE.SphereGeometry(0.09, 6, 5);
    head.translate(0, 0.72, 0);
    const bundle = new THREE.SphereGeometry(0.13, 7, 4);
    bundle.scale(1.1, 0.62, 1.1);
    bundle.translate(0, 0.86, 0);
    this.bodies = make(body, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }));
    this.heads = make(head, new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }));
    this.bundles = make(bundle, new THREE.MeshStandardMaterial({ color: '#cbbf9f', roughness: 0.9, flatShading: true }));
    // what else they carry: baskets, pots of rice still steaming, sacks; and their animals
    const basket = new THREE.CylinderGeometry(0.15, 0.11, 0.14, 8, 1, true);
    basket.translate(0, 0.85, 0);
    const pot = new THREE.CylinderGeometry(0.11, 0.09, 0.15, 8);
    pot.translate(0, 0.86, 0);
    const sack = new THREE.SphereGeometry(0.13, 6, 4);
    sack.scale(0.9, 1.25, 0.8);
    sack.translate(0, 0.5, -0.17);
    this.baskets = make(basket, new THREE.MeshStandardMaterial({ color: '#a8834f', roughness: 0.95, flatShading: true, side: THREE.DoubleSide }));
    this.pots = make(pot, new THREE.MeshStandardMaterial({ color: '#3d3833', roughness: 0.6, metalness: 0.3, flatShading: true }));
    this.sacks = make(sack, new THREE.MeshStandardMaterial({ color: '#b9a57d', roughness: 1, flatShading: true }));
    const steam = new THREE.SphereGeometry(0.06, 5, 4);
    this.steam = make(steam, new THREE.MeshBasicMaterial({ color: '#f2f2f2', transparent: true, opacity: 0.45, depthWrite: false }));
    this.steam.castShadow = false;
    const pig = new THREE.BoxGeometry(0.34, 0.2, 0.2);
    pig.translate(0, 0.16, 0);
    const snout = new THREE.BoxGeometry(0.1, 0.12, 0.13);
    snout.translate(0.21, 0.2, 0);
    const chicken = new THREE.SphereGeometry(0.075, 6, 5);
    chicken.scale(1.15, 1, 0.9);
    chicken.translate(0, 0.1, 0);
    const pink = new THREE.MeshStandardMaterial({ color: '#d99a95', roughness: 0.8, flatShading: true });
    this.pigs = make(pig, pink);
    this.snouts = make(snout, pink);
    this.chickens = make(chicken, new THREE.MeshStandardMaterial({ color: '#f1ece0', roughness: 0.8, flatShading: true }));
    for (let i = 0; i < FIGURES; i++) {
      this.bodies.setColorAt(i, tmp.c.set(CLOTHES[Math.floor(h01(i, 1) * CLOTHES.length)]));
      this.heads.setColorAt(i, tmp.c.set(SKIN[Math.floor(h01(i, 2) * SKIN.length)]));
    }
  },

  /** The sky mines known: dark spiked orbs floating where the airships ride, a red ring about each. */
  mines(r) {
    this.mineMeshes = new Map();
    const orb = new THREE.IcosahedronGeometry(0.3, 0);
    const spike = new THREE.ConeGeometry(0.06, 0.26, 4);
    spike.translate(0, 0.38, 0);
    const ring = new THREE.TorusGeometry(0.85, 0.045, 4, 24);
    ring.rotateX(Math.PI / 2);
    const dark = new THREE.MeshStandardMaterial({ color: '#2f2a2c', metalness: 0.6, roughness: 0.35, flatShading: true, emissive: '#3a0b08', emissiveIntensity: 0.6 });
    const red = new THREE.MeshBasicMaterial({ color: '#ff5a46', transparent: true, opacity: 0.8, depthWrite: false });
    const ways = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    const up = new THREE.Vector3(0, 1, 0);
    for (const t of r.mines) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(orb, dark));
      for (const [x, y, z] of ways) {
        const s = new THREE.Mesh(spike, dark);
        s.quaternion.setFromUnitVectors(up, new THREE.Vector3(x, y, z));
        g.add(s);
      }
      const halo = new THREE.Mesh(ring, red);
      halo.name = 'ring';
      g.add(halo);
      g.position.set(wx(t.x + 0.5), MINE_HEIGHT, wz(t.y + 0.5));
      g.visible = false;
      this.root.add(g);
      this.mineMeshes.set(t.id, g);
    }
  },

  /**
   * Lantern-like markers over where the objectives are (raid-hud.js): at the scouting a gold one over
   * each quarters he has still to visit and a blue one over his scouts' cove; at the raid a gold one
   * over each landing whose families are not called yet, an orange one over the bridge at Ferry Isle
   * while it stands, and a green one over Windgate once enough are aboard.
   */
  markers(r) {
    this.marks = new Map();
    this.cove = this.ferry = this.home = null;
    const geo = new THREE.OctahedronGeometry(0.45, 0);
    const mark = (x, y, color) => {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, transparent: true, opacity: 0.9 }));
      m.position.set(wx(x), 4.2, wz(y));
      m.scale.y = 1.6;
      this.root.add(m);
      return m;
    };
    if (r.mission === 'scout') {
      for (const q of r.quarters) this.marks.set(q.id, mark(q.door[0] + 0.5, q.door[1] + 0.5, '#ffd27a'));
      this.cove = mark(r.cove.x + r.cove.w / 2, r.cove.y + r.cove.h / 2, '#9fe2ff');
      return;
    }
    for (const q of r.quarters) {
      const l = r.landings[q.landing];
      this.marks.set(q.id, mark(l.x + l.w / 2, l.y + l.h / 2, '#ffd27a'));
    }
    const [bx, by] = r.bridge.cells[Math.floor(r.bridge.cells.length / 2)];
    this.ferry = mark(bx + 1, by + 0.5, '#ff8a3a');
    const home = r.landings.find((l) => l.home);
    this.home = mark(home.x + home.w / 2, home.y + home.h / 2, '#7bd88f');
  },

  /** The North Star, and the faint Little Dipper it is the tip of, in the night sky to the north. */
  northStar() {
    const tex = starTexture();
    const star = (x, y, size, bright) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#fff7e0', transparent: true, depthWrite: false, opacity: bright, blending: THREE.AdditiveBlending, fog: false }));
      s.position.set(x, y, -330);
      s.scale.setScalar(size);
      return s;
    };
    // (as high over the horizon as the Combahee of 1863 lies north of the equator: 32.6°)
    const sky = new THREE.Group();
    sky.add(star(0, 211, 14, 1));
    for (const [x, y] of [[9, 204], [16, 198], [20, 190], [30, 188], [33, 179], [24, 177]]) sky.add(star(x, y, 6, 0.55));
    this.sky = sky;
    this.root.add(sky);
  },

  /** The flames along the bridge at the ferry while it burns: soft tongues of fire, three to a cell. */
  flameSprites(r) {
    const tex = flameTexture();
    const mats = ['#fff0b0', '#ffb04a', '#ff6a2a'].map((color) => new THREE.SpriteMaterial({
      map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    const g = new THREE.Group();
    for (let i = 0; i < r.bridge.cells.length * 3; i++) {
      const s = new THREE.Sprite(mats[i % 3]);
      s.center.set(0.5, 0.05); // (it grows up from its foot)
      s.visible = false;
      g.add(s);
    }
    g.count = 0;
    this.root.add(g);
    return g;
  },

  /**
   * About the Wayfinder: a veil of drifting mist while he is in disguise (in either art style: the
   * Priest's sprite cannot change its clothes), and a warm glow at his feet while he sings.
   */
  aura() {
    const veil = new THREE.Group();
    const wisp = new THREE.SphereGeometry(0.3, 7, 5);
    const mist = new THREE.MeshBasicMaterial({ color: '#c3cddc', transparent: true, opacity: 0.2, depthWrite: false });
    for (let i = 0; i < 12; i++) veil.add(new THREE.Mesh(wisp, mist));
    veil.visible = false;
    const glow = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.95, 32), new THREE.MeshBasicMaterial({
      color: '#ffd27a', transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    glow.rotation.x = -Math.PI / 2;
    glow.visible = false;
    this.veil = veil;
    this.glow = glow;
    this.root.add(veil, glow);
  },

  /** Smoke rising and spreading as it thins. */
  smoke(at, size, life) {
    const m = new THREE.Mesh(smokeGeometry(), new THREE.MeshBasicMaterial({ color: '#3f3b38', transparent: true, opacity: 0.5, depthWrite: false }));
    m.position.copy(at);
    m.scale.setScalar(size * 0.3);
    this.root.add(m);
    this.fx.push({
      kind: 'smoke', obj: m, age: 0, life, own: [m.material],
      update: (f, k, dt) => {
        f.obj.position.y += dt * 1.5;
        f.obj.position.x += dt * 0.35;
        f.obj.scale.setScalar(size * (0.3 + k * 0.7));
        f.obj.material.opacity = 0.5 * (1 - k);
      },
    });
  },

  /* ------------------------------------- events ------------------------------------- */

  /** A flock of birds rises from about (x, y) and scatters. */
  birds(x, y) {
    if (!this.built) return;
    // (pale birds, as the egrets of the fields: a dark one would not be seen at night)
    const geo = birdGeometry(), mat = new THREE.MeshBasicMaterial({ color: '#efe9da', side: THREE.DoubleSide });
    for (let i = 0; i < 16; i++) {
      const b = new THREE.Mesh(geo, mat);
      const a = h01(i, x * 31 + y) * Math.PI * 2, sp = 2 + h01(i, 7) * 3;
      b.position.set(wx(x + 0.5) + Math.cos(a) * 1.2, 1.5 + h01(i, 3), wz(y + 0.5) + Math.sin(a) * 1.2);
      b.scale.setScalar(1.8);
      this.root.add(b);
      this.fx.push({
        kind: 'birds', obj: b, age: 0, life: 3.2, own: i === 0 ? [mat] : [],
        update: (f, k, dt, s) => {
          f.obj.position.x += Math.cos(a) * sp * dt;
          f.obj.position.z += Math.sin(a) * sp * dt;
          f.obj.position.y += (4 - k * 2) * dt;
          f.obj.rotation.y = -a + Math.PI / 2;
          f.obj.scale.set(1.8, 1.8 * (0.3 + Math.abs(Math.sin(s * 14 + i))), 1.8);
        },
      });
    }
  },

  /** An airship's shell: a flash at her side, a ball in a high arc, a burst where it lands. */
  shell(ship, x, y) {
    const unit = this.el.sceneEl.systems['ns-game'].units()?.byId.get(ship), from = unit?.object3D.position;
    const effects = this.el.sceneEl.systems['ns-game'].effects();
    if (!from || !this.built) return;
    const alt = unit.components['ns-unit']?.rep.alt ?? 1.3;
    const a = from.clone().add(new THREE.Vector3(0, alt + 0.4, 0)), b = new THREE.Vector3(wx(x + 0.5), 0.8, wz(y + 0.5));
    effects?.puff(a.clone(), '#fff1b0', 0.8, 0.25);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: '#2b2b2b' }));
    this.root.add(ball);
    this.fx.push({
      kind: 'shell', obj: ball, age: 0, life: 0.7, own: [ball.material, ball.geometry],
      update: (f, k) => { f.obj.position.lerpVectors(a, b, k); f.obj.position.y += Math.sin(k * Math.PI) * 3; },
      done: () => { effects?.puff(b.clone(), '#ffb347', 1.0, 0.35); this.smoke(b.clone().setY(1.1), 1.1, 1.5); },
    });
  },

  /** A sky mine going off against an airship: a flash of fire in the air, shards, smoke. */
  burst(x, y) {
    if (!this.built) return;
    const effects = this.el.sceneEl.systems['ns-game'].effects(), at = new THREE.Vector3(wx(x + 0.5), MINE_HEIGHT, wz(y + 0.5));
    effects?.puff(at.clone(), '#fff3c4', 1.0, 0.25);
    effects?.puff(at.clone(), '#ff8a3a', 1.7, 0.6);
    this.smoke(at.clone().setY(MINE_HEIGHT + 0.6), 1.3, 2.4);
    const shard = new THREE.TetrahedronGeometry(0.1, 0), dark = new THREE.MeshBasicMaterial({ color: '#2f2a2c' });
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(shard, dark), a = h01(i, x + y) * Math.PI * 2, rise = 1 + h01(i, 5) * 3, out = 2 + h01(i, 6) * 3;
      m.position.copy(at);
      this.root.add(m);
      this.fx.push({
        kind: 'burst', obj: m, age: 0, life: 1.4, own: i === 0 ? [dark, shard] : [],
        update: (f, k, dt) => {
          f.obj.position.x += Math.cos(a) * out * dt;
          f.obj.position.z += Math.sin(a) * out * dt;
          f.obj.position.y += (rise - k * 9) * dt;
          f.obj.rotation.x += dt * 9;
        },
      });
    }
  },

  /* -------------------------------------- tick -------------------------------------- */

  tick(t, dt) {
    const r = G.world?.raid;
    if (r !== this.built) { if (r) this.build(); else if (this.built) this.clear(); }
    if (!r) return;
    const s = t / 1000, sec = Math.min(dt, 100) / 1000;
    this.figures(r, s);
    for (const m of r.mines) {
      const g = this.mineMeshes.get(m.id);
      g.visible = m.known && !m.spent;
      if (!g.visible) continue;
      g.position.y = MINE_HEIGHT + Math.sin(s * 1.3 + m.id) * 0.12;
      g.rotation.y = s * 0.4 + m.id;
      g.getObjectByName('ring').rotation.y = -s;
    }
    // the markers: a quarters until he has been (the scouting), a landing until its people are
    // called; the cove bright once all are visited; the bridge while it stands; home once enough
    // are aboard
    const bob = (m, k) => { m.rotation.y = s * 1.4; m.position.y = 4.2 + Math.sin(s * 2 + k) * 0.25; };
    for (const q of r.quarters) {
      const m = this.marks.get(q.id);
      m.visible = !r.verdict && (r.mission === 'scout' ? !q.visited : !q.called && q.left > 0);
      bob(m, q.id);
    }
    if (this.cove) {
      this.cove.material.emissiveIntensity = r.quarters.every((q) => q.visited) ? 2 + Math.sin(s * 5) : 0.5;
      this.cove.visible = !r.verdict;
      bob(this.cove, 7);
    }
    if (this.ferry) {
      this.ferry.visible = !r.verdict && !r.bridge.burned && !r.bridge.burning && !r.battery.came;
      bob(this.ferry, 9);
    }
    if (this.home) {
      this.home.visible = !r.verdict && NS.freed(G.world) >= r.target;
      this.home.material.emissiveIntensity = 2 + Math.sin(s * 5);
      bob(this.home, 11);
    }
    // the North Star by night
    const dark = G.world.nights ? nightness(G.world.clockSeconds()) : 0;
    this.sky.visible = dark > 0.2;
    for (const st of this.sky.children) st.material.opacity = (st === this.sky.children[0] ? 1 : 0.55) * dark;
    this.burn(r, s);
    this.about(r, s);
    this.people2(r, s);
    // the passing effects
    for (const f of [...this.fx]) {
      f.age += sec;
      const k = Math.min(1, f.age / f.life);
      f.update(f, k, sec, s);
      if (k >= 1) {
        f.done?.();
        f.obj.removeFromParent();
        for (const m of f.own ?? []) m.dispose();
        this.fx.splice(this.fx.indexOf(f), 1);
      }
    }
  },

  /** His veil and his glow, where his unit is drawn. */
  about(r, s) {
    const unit = this.el.sceneEl.systems['ns-game'].units()?.byId.get(r.guide), him = G.world.entities.get(r.guide);
    const here = unit?.object3D.position, up = him?.state === 'normal';
    this.veil.visible = !!here && up && G.world.tick < r.disguise.until;
    this.glow.visible = !!here && up && r.singing >= 0 && !him.path?.length;
    if (this.veil.visible) {
      this.veil.position.copy(here);
      this.veil.children.forEach((w, i) => {
        const a = s * 0.9 + (i / 12) * Math.PI * 2, h = 0.2 + ((s * 0.35 + i / 12) % 1) * 1.7;
        w.position.set(Math.cos(a) * 0.6, h, Math.sin(a) * 0.6);
        w.scale.setScalar(0.6 + Math.sin(s * 2 + i) * 0.3);
      });
    }
    if (this.glow.visible) {
      this.glow.position.copy(here).setY(here.y + 0.05);
      this.glow.material.opacity = 0.2 + Math.sin(s * 3) * 0.08;
      this.glow.scale.setScalar(1 + Math.sin(s * 1.5) * 0.08);
    }
  },

  /** The figures where they are: the families on their way, a little apart, with what they carry
   * and their animals; and the crowds on the landings, jostling while they cling to the skiffs. */
  figures(r, s) {
    let n = 0, steam = 0, pigs = 0, hens = 0;
    const none = NONE;
    const put = (x, z, scale, lean, seed) => {
      if (n >= FIGURES) return;
      tmp.p.set(x, Math.abs(Math.sin(s * 7 + seed)) * 0.04 * lean, z);
      tmp.q.setFromEuler(tmp.e.set(0, seed * 6.28, 0));
      tmp.s.setScalar(scale);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      this.bodies.setMatrixAt(n, tmp.m);
      this.heads.setMatrixAt(n, tmp.m);
      // what each carries: a bundle, a basket or a pot on the head, a sack on the back; the children
      // nothing
      const what = scale < 0.8 ? 9 : Math.floor(h01(seed * 1000 | 0, 4) * 7);
      this.bundles.setMatrixAt(n, what <= 1 ? tmp.m : none);
      this.baskets.setMatrixAt(n, what === 2 ? tmp.m : none);
      this.pots.setMatrixAt(n, what === 3 ? tmp.m : none);
      this.sacks.setMatrixAt(n, what === 4 ? tmp.m : none);
      // the rice in a pot still steaming
      if (what === 3 && steam < FIGURES - 1) {
        for (let k = 0; k < 2; k++) {
          const rise = (s * 0.6 + k * 0.5 + h01(seed, k)) % 1;
          tmp.p.set(x + Math.sin(s * 2 + seed + k) * 0.05, (0.95 + rise * 0.45) * scale, z);
          tmp.s.setScalar(0.6 + rise * 1.2);
          tmp.m.compose(tmp.p, tmp.q, tmp.s);
          this.steam.setMatrixAt(steam++, tmp.m);
        }
      }
      n++;
    };
    const animal = (mesh, at, x, z, turn, seed) => {
      tmp.p.set(x, Math.abs(Math.sin(s * 9 + seed)) * 0.03, z);
      tmp.q.setFromEuler(tmp.e.set(0, turn, 0));
      tmp.s.setScalar(1);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      mesh.setMatrixAt(at, tmp.m);
    };
    for (const f of r.families) {
      const k = f.waiting ? 0 : f.along / NS.STEP;
      const cx = f.fromX + (f.x - f.fromX) * k + 0.5, cy = f.fromY + (f.y - f.fromY) * k + 0.5;
      for (let i = 0; i < f.size; i++) {
        const a = h01(f.id, i) * Math.PI * 2, d = i === 0 ? 0 : 0.25 + h01(i, f.id) * 0.45;
        put(wx(cx + Math.cos(a) * d), wz(cy + Math.sin(a) * d), i >= f.size - f.children ? 0.62 : 0.95 + h01(i, 9) * 0.12, f.waiting ? 0 : 1, f.id * 13 + i);
      }
      // the way they go, for the animals trotting along behind
      const turn = Math.atan2(-(f.y - f.fromY), f.x - f.fromX);
      if (pigFamily(f.id) && pigs < 8) {
        for (let i = 0; i < 2; i++) {
          const back = 0.55 + i * 0.35, side = (i - 0.5) * 0.3;
          const px = wx(cx) - Math.cos(turn) * back, pz = wz(cy) + Math.sin(turn) * back + side;
          animal(this.pigs, pigs, px, pz, turn, f.id + i);
          animal(this.snouts, pigs++, px, pz, turn, f.id + i);
        }
      }
      if (h01(f.id, 78) < 0.22) {
        const many = 1 + Math.floor(h01(f.id, 79) * 3);
        for (let i = 0; i < many && hens < 60; i++) {
          const a = s * 2.5 + i * 2.1 + f.id;
          animal(this.chickens, hens++, wx(cx) + Math.cos(a) * 0.55, wz(cy) + Math.sin(a * 1.3) * 0.5, a, f.id * 7 + i);
        }
      }
    }
    for (const l of r.landings) {
      // (clinging to the skiffs, the crowd presses and sways toward the dock)
      const shown = Math.min(l.crowd, CROWD_SHOWN), shove = l.clinging ? 3 : 0.3;
      for (let i = 0; i < shown; i++) {
        const u = h01(l.id * 97 + i, 5), v = h01(l.id * 89 + i, 6);
        const jx = l.clinging ? Math.sin(s * 6 + i) * 0.06 : 0;
        put(wx(l.x + 0.2 + u * (l.w - 0.4)) + jx, wz(l.y + 0.2 + v * (l.h - 0.4)), i % 5 === 4 ? 0.62 : 1, shove, l.id * 1000 + i);
      }
      if (shown > 12 && hens < 60) animal(this.chickens, hens++, wx(l.x + 0.4 + h01(l.id, 3) * (l.w - 0.8)), wz(l.y + 0.5), s * 1.5, l.id);
    }
    for (const m of [this.bodies, this.heads, this.bundles, this.baskets, this.pots, this.sacks]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
    for (const [m, c] of [[this.steam, steam], [this.pigs, pigs], [this.snouts, pigs], [this.chickens, hens]]) {
      m.count = c;
      m.instanceMatrix.needsUpdate = true;
    }
  },

  /* ------------------------- the skiffs, wardens, volunteers, riders ------------------------- */

  /** Two skiffs at each landing, to row the people out to a ship tied up there; a lantern at each bow. */
  skiffBoats(r) {
    const hull = new THREE.BoxGeometry(0.6, 0.2, 1.1);
    hull.translate(0, 0.1, -0.1);
    const bow = new THREE.ConeGeometry(0.42, 0.5, 4);
    bow.rotateX(Math.PI / 2);
    bow.rotateZ(Math.PI / 4);
    bow.scale(1, 0.34, 1);
    bow.translate(0, 0.1, 0.68);
    const oar = new THREE.BoxGeometry(1.2, 0.04, 0.07);
    const lantern = new THREE.BoxGeometry(0.1, 0.14, 0.1);
    lantern.translate(0, 0.3, 0.7);
    const glow = new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: '#ffb347', emissiveIntensity: 2.4 });
    const wood = new THREE.MeshStandardMaterial({ color: '#a07a4c', roughness: 0.9, flatShading: true });
    const sitter = new THREE.ConeGeometry(0.11, 0.34, 5);
    sitter.translate(0, 0.3, 0);
    const cloth = new THREE.MeshStandardMaterial({ color: '#7b6a55', roughness: 0.9, flatShading: true });
    const all = [];
    for (const l of r.landings) {
      for (let k = 0; k < 2; k++) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(hull, wood));
        const o = new THREE.Mesh(oar, wood);
        o.position.y = 0.2;
        g.add(o, new THREE.Mesh(bow, wood), new THREE.Mesh(lantern, glow));
        for (let i = 0; i < 3; i++) {
          const m = new THREE.Mesh(sitter, cloth);
          m.position.set((i - 1) * 0.14, 0.08, (i - 1) * 0.36);
          m.name = 'aboard';
          g.add(m);
        }
        g.visible = false;
        g.userData = { landing: l.id, k };
        this.root.add(g);
        all.push(g);
      }
    }
    return all;
  },

  /** A warden by each estate's quarters: a dark coat, a wide hat, a lantern. */
  wardenFigures(r) {
    const coat = new THREE.MeshStandardMaterial({ color: '#2b2a33', roughness: 0.8, flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: '#c9a27e', roughness: 0.8, flatShading: true });
    const lamp = new THREE.MeshStandardMaterial({ color: '#ffcf70', emissive: '#ffb347', emissiveIntensity: 2 });
    const map = new Map();
    for (const q of r.quarters) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 6), coat);
      body.position.y = 0.35;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), skin);
      head.position.y = 0.8;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 10), coat);
      brim.position.y = 0.88;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.12, 8), coat);
      crown.position.y = 0.95;
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.09), lamp);
      light.position.set(0.22, 0.45, 0.05);
      g.add(body, head, brim, crown, light);
      g.position.set(wx(q.door[0] + 1.5), 0, wz(q.door[1] + 0.5));
      g.visible = r.mission === 'raid';
      this.root.add(g);
      map.set(q.id, { g, fled: null });
    }
    return map;
  },

  /** The volunteers a horn sends up from a landing to its quarters: five in a file. */
  partyFor(q) {
    if (this.parties.has(q.id)) return this.parties.get(q.id);
    const blue = new THREE.MeshStandardMaterial({ color: '#2c3e66', roughness: 0.8, flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: '#5a3826', roughness: 0.8, flatShading: true });
    const stock = new THREE.MeshStandardMaterial({ color: '#3b2b1f', roughness: 0.9 });
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.62, 6), blue);
      body.position.y = 0.31;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 6, 5), skin);
      head.position.y = 0.7;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.07, 8), blue);
      cap.position.y = 0.79;
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.6, 0.03), stock);
      gun.position.set(0.14, 0.55, 0);
      gun.rotation.z = 0.2;
      m.add(body, head, cap, gun);
      g.add(m);
    }
    this.root.add(g);
    const p = { g, set: G.world.tick };
    this.parties.set(q.id, p);
    return p;
  },

  /** The sentries' riders: a runner with a torch, off inland through the trees with the alarm. */
  riderFigures() {
    const tunic = new THREE.MeshStandardMaterial({ color: '#8a2e22', roughness: 0.8, flatShading: true });
    const stick = new THREE.MeshStandardMaterial({ color: '#3b2b1f', roughness: 0.9 });
    const pool = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.72, 6), tunic);
      body.position.y = 0.36;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), tunic);
      head.position.y = 0.82;
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.45, 0.03), stick);
      pole.position.set(0.22, 0.7, 0);
      const torch = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTexture(), color: '#ffc46b', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      torch.center.set(0.5, 0.05);
      torch.position.set(0.22, 0.92, 0);
      torch.scale.set(0.4, 0.7, 1);
      g.add(body, head, pole, torch);
      g.visible = false;
      this.root.add(g);
      pool.push(g);
    }
    return pool;
  },

  /** The Sun-lords' stakes across the wind beyond the ferry, each driven into a floating rock. */
  stakes(r) {
    const wood = new THREE.MeshStandardMaterial({ color: '#8a6a45', roughness: 0.95, flatShading: true });
    const stone = new THREE.MeshStandardMaterial({ color: '#8a847c', roughness: 1, flatShading: true });
    const post = new THREE.CylinderGeometry(0.12, 0.15, 2, 6);
    const point = new THREE.ConeGeometry(0.15, 0.35, 6);
    const rock = new THREE.IcosahedronGeometry(0.5, 0);
    const g = new THREE.Group();
    const x = r.pilings;
    const rows = [];
    for (let y = 0; y < NS.H; y++) if (r.wind[y * NS.W + x]) rows.push(y);
    for (const y of rows) {
      const lean = (h01(x, y) - 0.5) * 0.25;
      const p = new THREE.Mesh(post, wood);
      p.position.set(wx(x + 0.5), 0.75, wz(y + 0.5));
      p.rotation.z = lean;
      const t = new THREE.Mesh(point, wood);
      t.position.set(wx(x + 0.5) - Math.sin(lean) * 1.1, 1.9, wz(y + 0.5));
      t.rotation.z = lean;
      const b = new THREE.Mesh(rock, stone);
      b.position.set(wx(x + 0.5), -0.3, wz(y + 0.5));
      b.scale.set(1, 0.6, 1);
      g.add(p, t, b);
    }
    if (rows.length > 1) {
      for (const h of [0.5, 1.2]) {
        const rope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, rows.length - 1), wood);
        rope.position.set(wx(x + 0.5), h, wz((rows[0] + rows[rows.length - 1]) / 2 + 0.5));
        g.add(rope);
      }
    }
    this.root.add(g);
  },

  /** A mill the airships' guns have set burning: flames and smoke on where it stood. */
  burnMill(x, y) {
    if (!this.built) return;
    const tex = flameTexture(), g = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: ['#fff0b0', '#ffb04a', '#ff6a2a'][i % 3], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      f.center.set(0.5, 0.05);
      f.userData.at = [(h01(i, x) - 0.5) * 2.2, (h01(i, y) - 0.5) * 2.2];
      g.add(f);
    }
    g.position.set(wx(x + 0.5), 0, wz(y + 0.5));
    this.root.add(g);
    this.millFires.push({ g, x, y, since: null });
  },

  /** The skiffs, the wardens, the volunteers, the riders and the burning mills, as the raid stands. */
  people2(r, s) {
    const w = G.world, units = this.el.sceneEl.systems['ns-game'].units();
    // the skiffs: between a landing with people and the ship tied up there
    const moored = new Map();
    for (const b of r.ships.values()) {
      const t = w.entities.get(b.id), at = t && !b.snagged ? NS.mooredAt(w, t) : null;
      if (at && !moored.has(at.id)) moored.set(at.id, units?.byId.get(b.id));
    }
    for (const g of this.skiffs) {
      const l = r.landings[g.userData.landing], ship = moored.get(l.id);
      g.visible = r.mission === 'raid' && !!ship && l.crowd > 0;
      if (!g.visible) continue;
      const alt = ship.components['ns-unit']?.rep.alt ?? 1.3;
      const b = ship.object3D.position.clone().setY(alt - 0.3);
      const a = new THREE.Vector3(wx(l.x + l.w / 2), 0.1, wz(l.y + l.h / 2)).lerp(b, 0.25);
      // out and back, the two by turns; clinging, they rock where they are with people on them
      const phase = (s / 4 + g.userData.k * 0.5) % 1, out = phase < 0.5;
      const k = l.clinging ? 0.05 + 0.04 * Math.sin(s * 7 + g.userData.k) : out ? phase * 2 : 2 - phase * 2;
      g.position.lerpVectors(a, b, Math.max(0, k));
      g.position.y += Math.sin(k * Math.PI) * 0.5;
      const side = g.userData.k ? 0.7 : -0.7, dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
      g.position.x += (-dz / len) * side;
      g.position.z += (dx / len) * side;
      g.lookAt(b.x, g.position.y, b.z);
      g.rotation.z = l.clinging ? Math.sin(s * 9 + g.userData.k) * 0.18 : Math.sin(s * 3) * 0.05;
      g.children[1].rotation.y = Math.sin(s * 6 + g.userData.k) * 0.5;
      for (const m of g.children) if (m.name === 'aboard') m.visible = l.clinging || out;
    }
    // the wardens: watching, or off at a run away from the landing and gone
    for (const q of r.quarters) {
      const wd = this.wardens.get(q.id);
      if (q.warden === 'fled' && wd.fled === null) wd.fled = s;
      if (wd.fled === null) {
        wd.g.visible = r.mission === 'raid';
        wd.g.rotation.y = Math.sin(s * 0.7 + q.id) * 0.8;
        continue;
      }
      const t = s - wd.fled, l = r.landings[q.landing];
      const dx = q.door[0] - (l.x + l.w / 2), dy = q.door[1] - (l.y + l.h / 2), len = Math.hypot(dx, dy) || 1;
      wd.g.visible = t < 2.6;
      wd.g.position.set(wx(q.door[0] + 1.5 + (dx / len) * t * 2.4), Math.abs(Math.sin(t * 12)) * 0.08, wz(q.door[1] + 0.5 + (dy / len) * t * 2.4));
      wd.g.rotation.y = Math.atan2(dx, dy);
    }
    // the volunteers: up from the landing to the door, then standing by it till the quarters is empty
    for (const q of r.quarters) {
      if (!(q.party > 0) || r.mission !== 'raid') continue;
      const p = this.partyFor(q), l = r.landings[q.landing];
      const k = Math.min(1, Math.max(0, (w.tick - p.set) / Math.max(1, q.party - p.set)));
      p.g.visible = q.left > 0 || r.families.some((f) => f.quarters === q.id);
      const lx = l.x + l.w / 2, ly = l.y + l.h / 2;
      const fx = lx + (q.door[0] - 0.5 - lx) * k, fy = ly + (q.door[1] + 0.5 - ly) * k;
      const turn = Math.atan2(q.door[0] - lx, q.door[1] - ly);
      p.g.children.forEach((m, i) => {
        const back = k < 1 ? i * 0.45 : 0, side = k < 1 ? 0 : (i - 2) * 0.45;
        m.position.set(wx(fx) - Math.sin(turn) * back + Math.cos(turn) * side, k < 1 ? Math.abs(Math.sin(s * 10 + i)) * 0.05 : 0, wz(fy) - Math.cos(turn) * back - Math.sin(turn) * side);
        m.rotation.y = k < 1 ? turn : turn + Math.PI;
      });
    }
    // the riders, running from their sentry inland, away from the wind, till the trees hide them
    const riders = r.alarm?.riders ?? [];
    this.riders.forEach((g, i) => {
      const rd = riders[i], t = rd ? (w.tick - rd.set) / NS.TPS : 99;
      g.visible = !!rd && t < 5;
      if (!g.visible) return;
      const inland = rd.y + 0.5 > NS.windY(rd.x + 0.5) ? 1 : -1;
      g.position.set(wx(rd.x + 0.5 + Math.sin(t * 1.3) * 0.5), Math.abs(Math.sin(t * 14)) * 0.1, wz(rd.y + 0.5 + inland * (1.5 + t * 2.2)));
      g.rotation.y = inland > 0 ? 0 : Math.PI;
      g.scale.setScalar(t > 4 ? 5 - t : 1);
    });
    // the mills burning, fiercely at first, then smouldering
    for (const f of this.millFires) {
      f.since ??= s;
      const t = s - f.since, strength = Math.max(0.35, 1 - t / 90);
      f.g.children.forEach((sp, i) => {
        const flicker = 0.7 + Math.abs(Math.sin(s * (6 + i) + i * 2)) * 0.5;
        sp.position.set(sp.userData.at[0], 0, sp.userData.at[1]);
        sp.scale.set(0.9 * strength * flicker, 2.2 * strength * flicker, 1);
      });
      if (s - (f.smoked ?? 0) > 0.6) {
        f.smoked = s;
        this.smoke(new THREE.Vector3(wx(f.x + 0.5) + (h01(Math.floor(s), 2) - 0.5) * 2, 2, wz(f.y + 0.5)), 1.6 * strength + 0.4, 3);
      }
    }
    // the two pigs: when their family reaches a landing, the word goes round
    for (const f of r.families) if (pigFamily(f.id)) this.pigFamilies.add(f.id);
    for (const id of this.pigFamilies) {
      if (!r.families.some((f) => f.id === id)) {
        this.pigFamilies.delete(id);
        if (!this.pigsSeen && !r.verdict) {
          this.pigsSeen = true;
          this.el.sceneEl.systems['ns-game'].hud?.toast('Two pigs trot down to the landing with their family. They have named one after the Sun-lords’ general and the other after their high lord.', 'good');
        }
      }
    }
  },

  /** The bridge at the ferry burning: flames on its cells that still stand, flickering. */
  burn(r, s) {
    const p = r.bridge, g = this.flames, burning = p.burning > 0 && !p.burned;
    g.count = 0;
    g.children.forEach((f, i) => {
      f.visible = burning;
      if (!burning) return;
      const [x, y] = p.cells[Math.floor(i / 3)], k = i % 3;
      const left = (p.burning - G.world.tick) / (NS.BURN_SECONDS * NS.TPS), grow = 1 - Math.max(0, Math.min(1, left));
      const flicker = 0.7 + Math.abs(Math.sin(s * (7 + k * 2) + x * 3 + y * 7 + k * 2)) * 0.45;
      f.position.set(wx(x + 0.2 + k * 0.3 + Math.sin(s * 3 + i) * 0.04), 0.0, wz(y + 0.25 + h01(x * 7 + k, y) * 0.5));
      f.scale.set((0.55 + grow * 0.45) * (0.85 + flicker * 0.2), (0.8 + grow * 1.2) * flicker * (k === 0 ? 1.2 : 1), 1);
      g.count++;
    });
    // and smoke going up from it, a puff now and then
    if (burning && s - (this.smoked ?? 0) > 0.3) {
      this.smoked = s;
      const [x, y] = p.cells[Math.floor(h01(Math.floor(s * 10), 3) * p.cells.length)];
      this.smoke(new THREE.Vector3(wx(x + 0.5), 1.6, wz(y + 0.5)), 1.1, 2.2);
    }
  },
});

/** Whether a family brings the pigs (two of them; in 1863 they were named after two Confederate
 * generals): one family in twenty-five. */
const pigFamily = (id) => h01(id, 77) < 0.04;

/** A tongue of fire: white at its foot, yellow, then orange and red where it thins out. */
let flameTex = null;
function flameTexture() {
  if (flameTex) return flameTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 100, 2, 32, 84, 60);
  grad.addColorStop(0, 'rgba(255,255,235,1)');
  grad.addColorStop(0.3, 'rgba(255,214,120,0.95)');
  grad.addColorStop(0.65, 'rgba(255,120,40,0.55)');
  grad.addColorStop(1, 'rgba(220,50,10,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(32, 2);
  g.bezierCurveTo(40, 34, 60, 60, 56, 98);
  g.bezierCurveTo(52, 124, 12, 124, 8, 98);
  g.bezierCurveTo(4, 60, 26, 40, 32, 2);
  g.fill();
  flameTex = new THREE.CanvasTexture(c);
  flameTex.colorSpace = THREE.SRGBColorSpace;
  return flameTex;
}

/** A puff of smoke. */
let smokeGeo = null;
const smokeGeometry = () => (smokeGeo ??= new THREE.IcosahedronGeometry(1, 1));

/** A soft round star. */
let starTex = null;
function starTexture() {
  if (starTex) return starTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,246,220,0.9)');
  grad.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  starTex = new THREE.CanvasTexture(c);
  return starTex;
}

/** A bird in flight: two wings in a shallow V. */
let birdGeo = null;
function birdGeometry() {
  if (birdGeo) return birdGeo;
  birdGeo = new THREE.BufferGeometry();
  birdGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0.1, -0.32, 0.1, -0.05, 0, 0, -0.1,
    0, 0, 0.1, 0, 0, -0.1, 0.32, 0.1, -0.05,
  ]), 3));
  birdGeo.computeVertexNormals();
  return birdGeo;
}
