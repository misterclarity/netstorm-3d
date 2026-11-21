/**
 * A sky city, drawn (`ns-city`): what sim/city-map.ts lays out as the city's own (G.world.city),
 * built from the models of src/city-art.js into one geometry lit as the rest of the scene, one that
 * glows by night (windows, lanterns, the Furies' spires), soft lights over the lamps by night, a
 * low wall along every rim (in Altamar with vines hanging over it), and what moves: the windmills'
 * sails and the wind tower's vane turning, the fountains' jets, the Thunder quarter's sparks, the
 * Temple of Concord's orb and the Furies' four about it, and townsfolk strolling the streets; and a
 * gold marker over each sight of the stroll not yet seen (src/city-hud.js). Built as a battle starts
 * in a city; nothing is drawn elsewhere.
 */
import { G, ME, WORLD, wx, wz, hash, THREE } from '../state.js';
import { heightOfCell } from '../heights.js';
import { nightness } from './ns-sun.js';
import { Batch, Kit, BUILD, rim, person, jet, sizeOf } from '../city-art.js';
import { seenSights } from '../city-hud.js';

/** The fronts of the four ways, in cells: north, east, south, west. */
const WAYS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
/** The ground the townsfolk walk on: streets, squares, the quay, the rose, terraces (city-map.ts PAVE). */
const STREETS = new Set([1, 2, 4, 5, 6]);
const FOLK = { concord: 48, altamar: 36 };
const CLOTHES = {
  concord: ['#e8a23a', '#3f8fd8', '#7fb04a', '#8f6ae0', '#d8d0c0', '#c0503a', '#5a6a8a', '#e6d8b0'],
  altamar: ['#f2efe6', '#2f68b8', '#d8d0c0', '#c0704a', '#4f8f4a', '#e6c84a', '#2a8f9a', '#8a6a44'],
};

/** A soft round glow for the lamps' light by night. */
let glowMap = null;
function glowTexture() {
  if (glowMap) return glowMap;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  glowMap = new THREE.CanvasTexture(c);
  return glowMap;
}

/** The turning parts: a hub and arms with sails or cups, about +y (a vane) or +z (sails). */
function rotor(kind, arms, length, hex) {
  const b = new Batch(), k = new Kit(b, b, [], []);
  if (kind === 'sails') {
    k.part('rod', 0, 0, 0.1, 0.36, 0.3, 0.36, '#5a4632', Math.PI / 2);
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2, dx = -Math.sin(a), dy = Math.cos(a);
      k.part('box', 0, 0, 0.15, 0.08, length, 0.06, '#6a5038', 0, 0, a);
      // the sail beside its spar, from a little out from the hub
      k.part('box', dy * 0.26 + dx * 0.3, -dx * 0.26 + dy * 0.3, 0.17, 0.46, length - 0.45, 0.02, hex, 0, 0, a);
    }
  } else {
    k.part('cyl', 0, -0.1, 0, 0.2, 0.25, 0.2, '#5a4a3a');
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2;
      k.part('box', (Math.cos(a) * length) / 2, 0, (Math.sin(a) * length) / 2, length, 0.05, 0.05, '#5a4a3a', 0, -a, 0);
      k.part('box', Math.cos(a) * length, -0.2, Math.sin(a) * length, 0.06, 0.45, 0.42, hex, 0, -a, 0);
    }
  }
  return b.geometry();
}

AFRAME.registerComponent('ns-city', {
  init() {
    this.group = new THREE.Group();
    this.el.setObject3D('city', this.group);
    this.lit = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88, metalness: 0 });
    this.glowing = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.el.sceneEl.addEventListener('ns-new-game', () => this.build());
  },

  clear() {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      o.traverse?.((m) => {
        if (m.geometry && !m.isSprite) m.geometry.dispose();
        if (m.material && m.material !== this.lit && m.material !== this.glowing) m.material.dispose();
      });
    }
    this.movers = [];
    this.folk = [];
    this.lamps = null;
    this.markers = [];
  },

  /** The city of the battle that has begun, if it is one. */
  build() {
    this.clear();
    const city = G.world?.city;
    this.city = city ?? null;
    if (!city) return;
    const lit = new Batch(), glow = new Batch(), movers = [], lights = [];
    const k = new Kit(lit, glow, movers, lights);
    const med = city.name === 'altamar';
    // the props, each in its frame on its ground
    const piers = new Set();
    for (const p of city.props) {
      const make = BUILD[p.k];
      if (!make) continue;
      const [, depth] = sizeOf(p), [fx, fy] = WAYS[p.r];
      let cx = p.x + p.w / 2, cy = p.y + p.h / 2, gx = p.x, gy = p.y;
      if (p.k === 'pier' || p.k === 'dock') {
        // out from the rim: its frame at the cells' inner edge, on the ground it leaves from
        cx -= fx * (depth / 2 - 0.5);
        cy -= fy * (depth / 2 - 0.5);
        gx = Math.floor(cx - fx);
        gy = Math.floor(cy - fy);
        for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) piers.add(y * WORLD + x);
      }
      make(k.at(wx(cx), heightOfCell(gx, gy), wz(cy), p.r), p);
    }
    // a low wall along each rim, but where a bridge or a pier leaves it; vines over Altamar's
    const t = G.view.terrain;
    for (let y = 1; y < WORLD - 1; y++) {
      for (let x = 1; x < WORLD - 1; x++) {
        const i = y * WORLD + x;
        if (t[i] !== 1) continue;
        WAYS.forEach(([dx, dy], r) => {
          const j = (y + dy) * WORLD + x + dx;
          if (t[j] !== 0 || piers.has(j)) return;
          rim(k.at(wx(x + 0.5 + dx * 0.5), heightOfCell(x, y), wz(y + 0.5 + dy * 0.5), r), med, hash(x, y, 60 + r), med);
        });
      }
    }
    const solid = new THREE.Mesh(lit.geometry(), this.lit);
    solid.castShadow = solid.receiveShadow = true;
    const glowing = new THREE.Mesh(glow.geometry(), this.glowing);
    this.group.add(solid, glowing);
    this.lamps = this.lightsOf(lights);
    this.moversOf(movers);
    this.townsfolk(city);
    // the markers over the sights
    this.markers = city.sights.map((s) => {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), new THREE.MeshBasicMaterial({ color: '#ffd04a' }));
      m.position.set(wx(s.x), heightOfCell(Math.floor(s.x), Math.floor(s.y)) + 7.5, wz(s.y));
      m.scale.set(1, 1.6, 1);
      this.group.add(m);
      return m;
    });
  },

  /** The lamps' light by night: a soft glow over each. */
  lightsOf(lights) {
    if (!lights.length) return null;
    const pos = new Float32Array(lights.length * 3), col = new Float32Array(lights.length * 3), c = new THREE.Color();
    lights.forEach(({ at, hex }, n) => {
      pos.set([at.x, at.y, at.z], n * 3);
      c.set(hex);
      col.set([c.r, c.g, c.b], n * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const points = new THREE.Points(g, new THREE.PointsMaterial({ size: 2.2, map: glowTexture(), vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    points.frustumCulled = false;
    this.group.add(points);
    return points;
  },

  /** What turns, spouts, sparks and floats. */
  moversOf(movers) {
    const of = (kind) => movers.filter((m) => m.kind === kind);
    // the rotors: the windmills' sails, the wind tower's vane
    for (const kind of ['sails', 'vane']) {
      const list = of(kind);
      if (!list.length) continue;
      const m0 = list[0], mesh = new THREE.InstancedMesh(rotor(kind, m0.arms, m0.length, m0.hex), this.lit, list.length);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.movers.push({ kind, mesh, list });
    }
    // the fountains' jets
    const jets = of('jet');
    if (jets.length) {
      const mesh = new THREE.InstancedMesh(jet(), new THREE.MeshLambertMaterial({ color: '#dff6ff', emissive: '#3a6a88', transparent: true, opacity: 0.5, depthWrite: false }), jets.length);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.movers.push({ kind: 'jet', mesh, list: jets });
    }
    // the sparks about the coil's crown
    for (const m of of('sparks')) {
      const sparks = [];
      for (let i = 0; i < 6; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: m.hex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        s.scale.setScalar(0.5);
        this.group.add(s);
        sparks.push(s);
      }
      this.movers.push({ kind: 'sparks', at: m.at, sparks });
    }
    // the Temple of Concord's orb, and the Furies' four about it
    for (const m of of('orb')) {
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 1), new THREE.MeshBasicMaterial({ color: '#ffe08a' }));
      orb.position.copy(m.at);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffd27a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.position.copy(m.at);
      halo.scale.setScalar(4.5);
      const four = ['#e8a23a', '#3f8fd8', '#7fb04a', '#8f6ae0'].map((hex) => new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), new THREE.MeshBasicMaterial({ color: hex })));
      this.group.add(orb, halo, ...four);
      this.movers.push({ kind: 'orb', at: m.at, orb, halo, four });
    }
  },

  /**
   * The townsfolk: each walks from a cell of the streets to another of the same level by the
   * shortest way, waits a while there, and walks on.
   */
  townsfolk(city) {
    const streets = [];
    const v = G.view;
    for (let i = 0; i < WORLD * WORLD; i++) if (v.terrain[i] === 1 && STREETS.has(city.paint[i]) && !city.blocked[i] && !v.occupant[i]) streets.push(i);
    if (!streets.length) return;
    const n = FOLK[city.name] ?? 30, clothes = CLOTHES[city.name] ?? CLOTHES.concord;
    const mesh = new THREE.InstancedMesh(person(), new THREE.MeshLambertMaterial({ flatShading: true }), n);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const c = new THREE.Color();
    this.folk = [];
    for (let f = 0; f < n; f++) {
      const at = streets[Math.floor(hash(f, 3, 70) * streets.length)];
      mesh.setColorAt(f, c.set(clothes[f % clothes.length]));
      this.folk.push({ at, path: [], step: 0, wait: hash(f, 4, 71) * 6, pace: 0.9 + hash(f, 5, 72) * 0.6, seed: f, trips: 0, size: 0.85 + hash(f, 6, 73) * 0.3 });
    }
    this.streets = streets;
    this.folkMesh = mesh;
    this.group.add(mesh);
  },

  /** The shortest way over walkable cells of one level from cell `from` to a street cell picked for trip `n`. */
  wayFor(from, seed, n) {
    const v = G.view, w = G.world, level = w.level?.[from] ?? 0, city = this.city;
    // (one search's marks: cells marked in an earlier search count as unvisited)
    this.prev ??= new Int32Array(WORLD * WORLD);
    this.seen ??= new Uint32Array(WORLD * WORLD);
    this.search = (this.search ?? 0) + 1;
    const prev = this.prev, seen = this.seen, mark = this.search, queue = [from];
    prev[from] = from;
    seen[from] = mark;
    const goal = this.streets[Math.floor(hash(seed, n, 74) * this.streets.length)];
    let found = -1;
    for (let q = 0; q < queue.length && queue.length < 9000; q++) {
      const i = queue[q];
      if (i === goal) { found = i; break; }
      const x = i % WORLD, y = (i / WORLD) | 0;
      for (const [dx, dy] of WAYS) {
        const nx = x + dx, ny = y + dy, j = ny * WORLD + nx;
        if (seen[j] === mark || city.blocked[j] || (w.level?.[j] ?? 0) !== level || !w.walkable(ME, nx, ny) || v.occupant[j]) continue;
        seen[j] = mark;
        prev[j] = i;
        queue.push(j);
      }
    }
    // (a goal on another level or out of reach: the farthest cell reached instead)
    let end = found >= 0 ? found : queue[queue.length - 1];
    const path = [];
    while (end !== from && path.length < 9000) { path.push(end); end = prev[end]; }
    return path.reverse();
  },

  tick(t, dt) {
    if (!this.city) return;
    const s = t / 1000, night = G.world.nights ? nightness(G.world.clockSeconds()) : 0;
    // windows and lanterns brighter by night, the lamps' glow only then
    this.glowing.color.setScalar(0.55 + night * 0.95);
    if (this.lamps) this.lamps.material.opacity = night * 0.85;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), turn = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), axis = new THREE.Vector3();
    for (const m of this.movers) {
      if (m.kind === 'sails' || m.kind === 'vane') {
        m.list.forEach((r, i) => {
          axis.set(0, m.kind === 'vane' ? 1 : 0, m.kind === 'vane' ? 0 : 1);
          turn.setFromAxisAngle(axis, s * (m.kind === 'vane' ? 1.6 : 0.7) + i);
          q.copy(r.q).multiply(turn);
          m.mesh.setMatrixAt(i, m4.compose(r.at, q, one));
        });
        m.mesh.instanceMatrix.needsUpdate = true;
      } else if (m.kind === 'jet') {
        m.list.forEach((j, i) => {
          const h = j.size * (0.75 + 0.25 * Math.sin(s * 3.1 + i * 1.7));
          m.mesh.setMatrixAt(i, m4.compose(j.at, q.identity(), axis.set(Math.min(1, j.size * 1.1), h, Math.min(1, j.size * 1.1))));
        });
        m.mesh.instanceMatrix.needsUpdate = true;
      } else if (m.kind === 'sparks') {
        m.sparks.forEach((sp, i) => {
          const k = Math.floor(s * 9) + i * 7;
          sp.visible = hash(k, i, 75) < 0.6;
          sp.position.set(m.at.x + (hash(k, i, 76) - 0.5) * 1.6, m.at.y + (hash(k, i, 77) - 0.5) * 1.2, m.at.z + (hash(k, i, 78) - 0.5) * 1.6);
          sp.scale.setScalar(0.3 + hash(k, i, 79) * 0.5);
        });
      } else if (m.kind === 'orb') {
        const y = m.at.y + Math.sin(s * 1.1) * 0.3;
        m.orb.position.y = y;
        m.orb.rotation.set(s * 0.4, s * 0.7, 0);
        m.halo.position.y = y;
        m.halo.material.opacity = 0.35 + night * 0.5;
        m.four.forEach((o, i) => {
          const a = s * 0.8 + (i * Math.PI) / 2;
          o.position.set(m.at.x + Math.cos(a) * 1.7, y + Math.sin(s * 1.6 + i) * 0.25, m.at.z + Math.sin(a) * 1.7);
        });
      }
    }
    const seen = seenSights(G.world);
    this.markers?.forEach((m, i) => {
      m.visible = !seen.has(i);
      m.rotation.y = s * 1.2;
      m.position.y += (Math.sin(s * 2 + i) * 0.004);
    });
    this.walk(Math.min(dt, 100) / 1000);
  },

  /** The townsfolk a step on. */
  walk(dt) {
    if (!this.folk?.length) return;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    this.folk.forEach((f, n) => {
      if (f.wait > 0) {
        f.wait -= dt;
        if (f.wait <= 0) { f.path = this.wayFor(f.at, f.seed, ++f.trips); f.step = 0; }
      } else if (f.path.length) {
        f.step += dt * f.pace;
        while (f.step >= 1 && f.path.length) { f.at = f.path.shift(); f.step -= 1; }
        if (!f.path.length) { f.step = 0; f.wait = 2 + hash(f.seed, f.trips, 80) * 8; }
      } else {
        f.wait = 1;
      }
      const x0 = f.at % WORLD, y0 = (f.at / WORLD) | 0, next = f.path[0];
      const x1 = next != null ? next % WORLD : x0, y1 = next != null ? (next / WORLD) | 0 : y0, k = next != null ? f.step : 0;
      const x = x0 + (x1 - x0) * k + 0.5, y = y0 + (y1 - y0) * k + 0.5;
      p.set(wx(x), heightOfCell(x0, y0) + (next != null ? Math.abs(Math.sin(f.step * Math.PI * 2)) * 0.06 : 0), wz(y));
      if (next != null) q.setFromAxisAngle(up, Math.atan2(x1 - x0, y1 - y0));
      sc.setScalar(f.size);
      this.folkMesh.setMatrixAt(n, m4.compose(p, next != null ? q : q.setFromAxisAngle(up, f.seed), sc));
    });
    this.folkMesh.instanceMatrix.needsUpdate = true;
  },

  remove() {
    this.clear();
    this.lit.dispose();
    this.glowing.dispose();
  },
});
