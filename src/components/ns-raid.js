/**
 * The Combahee Raid in the scene (sim/raid.ts has its rules): a wooden dock at each landing; the
 * families on their way to the airships and the crowds waiting on the landings; the sky mines the
 * Wayfinder found, floating in the wind; the flocks of birds that warn him of a sentry; the
 * airships' shells; the bridge at the ferry burning; his veil while he is in disguise and a glow
 * about him while he sings; a marker over each quarters and over his scouts' cove; and the North
 * Star in the night sky. The Combahee itself is sky: nothing is drawn for it.
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

  /** The figures where they are: the families on their way, a little apart, and the crowds. */
  figures(r, s) {
    let n = 0;
    const put = (x, z, scale, lean, seed) => {
      if (n >= FIGURES) return;
      tmp.p.set(x, Math.abs(Math.sin(s * 7 + seed)) * 0.04 * lean, z);
      tmp.q.setFromEuler(tmp.e.set(0, seed * 6.28, 0));
      tmp.s.setScalar(scale);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      this.bodies.setMatrixAt(n, tmp.m);
      this.heads.setMatrixAt(n, tmp.m);
      // some carry a bundle on the head, the children none
      if (scale < 0.8 || h01(seed * 1000 | 0, 4) > 0.45) tmp.m.makeScale(0, 0, 0);
      this.bundles.setMatrixAt(n, tmp.m);
      n++;
    };
    for (const f of r.families) {
      const k = f.waiting ? 0 : f.along / NS.STEP;
      const cx = f.fromX + (f.x - f.fromX) * k + 0.5, cy = f.fromY + (f.y - f.fromY) * k + 0.5;
      for (let i = 0; i < f.size; i++) {
        const a = h01(f.id, i) * Math.PI * 2, d = i === 0 ? 0 : 0.25 + h01(i, f.id) * 0.45;
        put(wx(cx + Math.cos(a) * d), wz(cy + Math.sin(a) * d), i >= f.size - f.children ? 0.62 : 0.95 + h01(i, 9) * 0.12, f.waiting ? 0 : 1, f.id * 13 + i);
      }
    }
    for (const l of r.landings) {
      const shown = Math.min(l.crowd, CROWD_SHOWN);
      for (let i = 0; i < shown; i++) {
        const u = h01(l.id * 97 + i, 5), v = h01(l.id * 89 + i, 6);
        put(wx(l.x + 0.2 + u * (l.w - 0.4)), wz(l.y + 0.2 + v * (l.h - 0.4)), i % 5 === 4 ? 0.62 : 1, 0.3, l.id * 1000 + i);
      }
    }
    for (const m of [this.bodies, this.heads, this.bundles]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
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
