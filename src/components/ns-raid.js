/**
 * The Combahee River Raid in the scene (sim/raid.ts has its rules): the river's water and the
 * landings' piers; the families on their way to the boats and the crowds waiting on the landings;
 * the torpedoes she found; the flocks of birds that warn her of a picket; the gunboats' shells; the
 * pontoon bridge burning; a marker over each quarters and over her scouts' cove; and the North
 * Star in the night sky.
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
/** How far below the islands' ground the water lies. */
const WATER = -0.32;
/** Clothes and skin, varied figure by figure. */
const CLOTHES = ['#6d5a48', '#7b6a55', '#56606b', '#8a7458', '#5b4b3f', '#8c8273', '#6b4f3a', '#4d5a4a', '#9a8a6e', '#7a5f52'];
const SKIN = ['#4a2c1e', '#5a3826', '#6b4430', '#3f2619', '#7a5038'];

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
    this.ripple?.dispose();
    this.ripple = null;
    this.fx = [];
    this.built = null;
  },

  build() {
    this.clear();
    const r = G.world?.raid;
    if (!r) return;
    this.built = r;
    this.water(r);
    this.piers(r);
    this.people();
    this.mines(r);
    this.markers(r);
    this.northStar();
    this.flames = this.flameSprites(r);
  },

  /** The river: a sheet of dark water over its cells, and under the pontoon bridge's. */
  water(r) {
    const cells = [];
    for (let i = 0; i < r.river.length; i++) if (r.river[i]) cells.push(i);
    for (const [x, y] of r.pontoon.cells) cells.push(y * NS.W + x);
    const pos = new Float32Array(cells.length * 18);
    cells.forEach((i, n) => {
      const x = wx(i % NS.W), z = wz(Math.floor(i / NS.W)), o = n * 18;
      pos.set([x, WATER, z, x, WATER, z + 1, x + 1, WATER, z, x + 1, WATER, z, x, WATER, z + 1, x + 1, WATER, z + 1], o);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const uv = new Float32Array(cells.length * 12);
    cells.forEach((i, n) => {
      const x = (i % NS.W) / 6, y = Math.floor(i / NS.W) / 6, d = 1 / 6;
      uv.set([x, y, x, y + d, x + d, y, x + d, y, x, y + d, x + d, y + d], n * 12);
    });
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.ripple = ripples();
    const mat = new THREE.MeshStandardMaterial({
      color: '#22465f', roughness: 0.18, metalness: 0.25, transparent: true, opacity: 0.86, map: this.ripple,
      emissive: '#0c1c2b', emissiveIntensity: 0.6,
    });
    const sheet = new THREE.Mesh(geo, mat);
    sheet.receiveShadow = true;
    this.root.add(sheet);
  },

  /** A wharf of weathered planks on posts where each landing meets the river. */
  piers(r) {
    const woods = ['#9a7a58', '#8a6b4b', '#a3845f'].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true }));
    const g = new THREE.Group(), post = new THREE.CylinderGeometry(0.07, 0.09, 0.9, 6);
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
      for (const end of [0.9, length - 0.15]) {
        for (const side of [-1, 1]) {
          const p = new THREE.Mesh(post, woods[1]);
          p.position.set(wx(x0 + ax * end + ay * side * width * 0.5), -0.2, wz(y0 + ay * end + ax * side * width * 0.5));
          g.add(p);
        }
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

  /** The torpedoes known: a dark float on the water and a red ring about it. */
  mines(r) {
    this.mineMeshes = new Map();
    const float = new THREE.SphereGeometry(0.32, 10, 6);
    const ring = new THREE.TorusGeometry(0.9, 0.05, 4, 24);
    ring.rotateX(Math.PI / 2);
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2724', metalness: 0.5, roughness: 0.4 });
    const red = new THREE.MeshBasicMaterial({ color: '#e0473a', transparent: true, opacity: 0.8 });
    for (const t of r.torpedoes) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(float, dark));
      g.add(new THREE.Mesh(ring, red));
      g.position.set(wx(t.x + 0.5), WATER + 0.05, wz(t.y + 0.5));
      g.visible = false;
      this.root.add(g);
      this.mineMeshes.set(t.id, g);
    }
  },

  /** A lantern-like marker over each quarters (and her scouts' cove): bright while it waits for her. */
  markers(r) {
    this.marks = new Map();
    const geo = new THREE.OctahedronGeometry(0.45, 0);
    const mark = (x, y, color) => {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, transparent: true, opacity: 0.9 }));
      m.position.set(wx(x), 4.2, wz(y));
      m.scale.y = 1.6;
      this.root.add(m);
      return m;
    };
    for (const q of r.quarters) this.marks.set(q.id, mark(q.x + 2, q.y + 2, '#ffd27a'));
    if (r.mission === 'scout') this.cove = mark(r.cove.x + r.cove.w / 2, r.cove.y + r.cove.h / 2, '#9fe2ff');
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
    // (as high over the horizon as the Combahee lies north of the equator: 32.6°)
    const sky = new THREE.Group();
    sky.add(star(0, 211, 14, 1));
    for (const [x, y] of [[9, 204], [16, 198], [20, 190], [30, 188], [33, 179], [24, 177]]) sky.add(star(x, y, 6, 0.55));
    this.sky = sky;
    this.root.add(sky);
  },

  /** The flames along the pontoon bridge while it burns: soft tongues of fire, three to a cell. */
  flameSprites(r) {
    const tex = flameTexture();
    const mats = ['#fff0b0', '#ffb04a', '#ff6a2a'].map((color) => new THREE.SpriteMaterial({
      map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    const g = new THREE.Group();
    for (let i = 0; i < r.pontoon.cells.length * 3; i++) {
      const s = new THREE.Sprite(mats[i % 3]);
      s.center.set(0.5, 0.05); // (it grows up from its foot)
      s.visible = false;
      g.add(s);
    }
    g.count = 0;
    this.root.add(g);
    return g;
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
    // (pale birds, as the egrets of the rice fields: a dark one would not be seen at night)
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

  /** A gunboat's shell: a flash at the boat, a ball in a high arc, a burst where it lands. */
  shell(boat, x, y) {
    const from = this.el.sceneEl.systems['ns-game'].units()?.byId.get(boat)?.object3D.position;
    const effects = this.el.sceneEl.systems['ns-game'].effects();
    if (!from || !this.built) return;
    const a = from.clone().add(new THREE.Vector3(0, 1.4, 0)), b = new THREE.Vector3(wx(x + 0.5), 0.8, wz(y + 0.5));
    effects?.puff(a.clone(), '#fff1b0', 0.8, 0.25);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: '#2b2b2b' }));
    this.root.add(ball);
    this.fx.push({
      kind: 'shell', obj: ball, age: 0, life: 0.7, own: [ball.material, ball.geometry],
      update: (f, k) => { f.obj.position.lerpVectors(a, b, k); f.obj.position.y += Math.sin(k * Math.PI) * 4; },
      done: () => { effects?.puff(b.clone(), '#ffb347', 1.0, 0.35); this.smoke(b.clone().setY(1.1), 1.1, 1.5); },
    });
  },

  /** A torpedo going off: a column of water and spray. */
  splash(x, y) {
    const effects = this.el.sceneEl.systems['ns-game'].effects(), at = new THREE.Vector3(wx(x + 0.5), WATER + 0.2, wz(y + 0.5));
    effects?.puff(at.clone(), '#ffd9a0', 1.4, 0.35);
    for (let i = 0; i < 4; i++) effects?.puff(at.clone().setY(0.5 + i * 0.8), '#d8ecff', 1.1 + i * 0.3, 0.8 + i * 0.2);
  },

  /* -------------------------------------- tick -------------------------------------- */

  tick(t, dt) {
    const r = G.world?.raid;
    if (r !== this.built) { if (r) this.build(); else if (this.built) this.clear(); }
    if (!r) return;
    const s = t / 1000, sec = Math.min(dt, 100) / 1000;
    if (this.ripple) this.ripple.offset.set((s * 0.012) % 1, (s * 0.02) % 1);
    this.figures(r, s);
    for (const tp of r.torpedoes) {
      const m = this.mineMeshes.get(tp.id);
      m.visible = tp.known && !tp.spent;
      if (m.visible) m.position.y = WATER + 0.05 + Math.sin(s * 1.6 + tp.id) * 0.05;
    }
    // the markers: a quarters bright until she has been (the scouting) or its people are called
    for (const q of r.quarters) {
      const m = this.marks.get(q.id);
      m.visible = r.mission === 'scout' ? !q.visited : !q.called && q.left > 0;
      m.rotation.y = s * 1.4;
      m.position.y = 4.2 + Math.sin(s * 2 + q.id) * 0.25;
    }
    if (this.cove) {
      this.cove.material.emissiveIntensity = r.quarters.every((q) => q.visited) ? 2 + Math.sin(s * 5) : 0.5;
      this.cove.rotation.y = s;
    }
    // the North Star by night
    const dark = G.world.nights ? nightness(G.world.clockSeconds()) : 0;
    this.sky.visible = dark > 0.2;
    for (const st of this.sky.children) st.material.opacity = (st === this.sky.children[0] ? 1 : 0.55) * dark;
    this.burn(r, s);
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

  /** The pontoon bridge burning: flames on its cells that still stand, flickering. */
  burn(r, s) {
    const p = r.pontoon, g = this.flames, burning = p.burning > 0 && !p.burned;
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

/** Ripples on the water: a soft, light pattern the water's colour runs through. */
function ripples() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#9fb7c8';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 70; i++) {
    const x = h01(i, 11) * 128, y = h01(i, 12) * 128, w = 10 + h01(i, 13) * 26;
    g.strokeStyle = `rgba(235,245,255,${0.18 + h01(i, 14) * 0.3})`;
    g.lineWidth = 1 + h01(i, 15) * 1.5;
    g.beginPath();
    g.ellipse(x, y, w, w * 0.18, 0, 0, Math.PI * 2);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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
