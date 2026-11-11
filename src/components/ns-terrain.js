/**
 * The floating islands and the bridges between them, built from the world's terrain grid and
 * rebuilt when it changes (`ns-terrain`). Each island's top is one textured surface (the original
 * grass tiles in "Sprites" mode, a painted stand-in otherwise); under it hangs rock, deeper the
 * further a cell lies from the sky, with a few spikes under the larger islands. With tiered islands
 * (heights.js) each stands on its level, a cliff where it meets lower ground, the bridges are laid
 * flat on theirs, and where a bridge joins another level a lift stands, its car riding up and down
 * with whoever rides it.
 */
import { G, NS, WORLD, FURY_TILES, GROUND_PAINT, wx, wz, hash, playerTheme } from '../state.js';
import { HEIGHTS, heightOfCell } from '../heights.js';

const { THREE } = AFRAME;

AFRAME.registerComponent('ns-terrain', {
  init() {
    this.islands = new THREE.Group();
    this.bridges = new THREE.Group();
    this.el.setObject3D('islands', this.islands);
    this.el.setObject3D('bridges', this.bridges);
    this.canvas = document.createElement('canvas');
    this.topMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    this.rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    this.spikeMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.95 });
    this.makeBridgeMeshes();
    const scene = this.el.sceneEl;
    scene.addEventListener('ns-new-game', () => this.rebuild(true));
    scene.addEventListener('ns-terrain', () => this.rebuild(false));
    scene.addEventListener('ns-art-mode', () => this.repaint());
  },

  land(x, y) {
    if (x < 0 || y < 0 || x >= WORLD || y >= WORLD) return false;
    const t = G.view.terrain[y * WORLD + x];
    return t === 1 || t === 5; // island ground or an Edge Farm on its rim
  },

  rebuild(force) {
    const v = G.view;
    // the islands change rarely (an islet laid or fallen, ground changing hands): only then rebuild
    let sig = 0;
    for (let i = 0; i < WORLD * WORLD; i++) {
      const t = v.terrain[i];
      if (t === 1 || t === 5) sig = (Math.imul(sig, 31) + i * 7 + v.owner[i] * 13 + t) | 0;
    }
    if (force || sig !== this.sig) {
      this.sig = sig;
      this.buildIslands();
    }
    this.buildBridges();
  },

  repaint() {
    if (!this.box) return;
    this.paintGround();
    this.topMat.map = this.texture;
    this.topMat.needsUpdate = true;
  },

  /** One square of the top texture per cell. */
  paintGround() {
    const { x0, y0, w, h, T } = this.box, cv = this.canvas;
    const art = this.el.sceneEl.systems['ns-art'];
    const tiles = art.mode === 'sprites' ? art.tiles : null;
    cv.width = w * T;
    cv.height = h * T;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    // ground nobody owns (a geyser's, an islet's) that touches an owned island is painted as that
    // island's ground, by whichever owned ground is nearest along the land: else it shows as a green
    // seam between the two
    const near = new Map(), queue = [];
    for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) { const i = (y0 + cy) * WORLD + x0 + cx; if (this.land(x0 + cx, y0 + cy) && G.view.owner[i]) { near.set(i, G.view.owner[i]); queue.push(i); } }
    for (let n = 0; n < queue.length; n++) {
      const i = queue[n], x = i % WORLD, y = (i / WORLD) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = (y + dy) * WORLD + x + dx;
        if (this.land(x + dx, y + dy) && !near.has(j)) { near.set(j, near.get(i)); queue.push(j); }
      }
    }
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        const x = x0 + cx, y = y0 + cy;
        if (!this.land(x, y)) continue;
        const owner = near.get(y * WORLD + x) ?? 0;
        const theme = owner ? playerTheme(owner) : 'sun';
        const set = tiles?.[owner ? FURY_TILES[theme] : 'rgrass'];
        if (set?.length) {
          g.drawImage(set[Math.floor(hash(x, y, 40) * set.length)], cx * T, cy * T, T, T);
        } else {
          const [r, gg, b] = owner ? GROUND_PAINT[theme] : [138, 140, 104];
          const v = 0.9 + hash(x, y, 41) * 0.18, q = T / 16;
          g.fillStyle = `rgb(${r * v | 0},${gg * v | 0},${b * v | 0})`;
          g.fillRect(cx * T, cy * T, T, T);
          for (let i = 0; i < 6; i++) {
            const l = 0.75 + hash(x * 7 + i, y, 42) * 0.5;
            g.fillStyle = `rgba(${r * l | 0},${gg * l | 0},${b * l | 0},0.9)`;
            g.fillRect(cx * T + hash(x, y * 9 + i, 43) * 14 * q, cy * T + hash(x * 3 + i, y, 44) * 14 * q, (2 + hash(i, x, 45) * 3) * q, 2 * q);
          }
        }
        // a darker lip where the island ends
        g.fillStyle = 'rgba(70, 52, 30, 0.55)';
        const lip = Math.max(1, T / 8);
        if (!this.land(x, y - 1)) g.fillRect(cx * T, cy * T, T, lip);
        if (!this.land(x, y + 1)) g.fillRect(cx * T, cy * T + T - lip * 1.5, T, lip * 1.5);
        if (!this.land(x - 1, y)) g.fillRect(cx * T, cy * T, lip, T);
        if (!this.land(x + 1, y)) g.fillRect(cx * T + T - lip, cy * T, lip, T);
      }
    }
    if (!this.texture) {
      this.texture = new THREE.CanvasTexture(cv);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.anisotropy = 8;
    }
    this.texture.magFilter = tiles ? THREE.NearestFilter : THREE.LinearFilter;
    this.texture.dispose(); // the canvas may have changed size
    this.texture.needsUpdate = true;
  },

  buildIslands() {
    for (const c of [...this.islands.children]) {
      this.islands.remove(c);
      c.geometry?.dispose();
      if (c.isInstancedMesh) c.dispose(); // its instances' buffers too
    }
    const L = (x, y) => this.land(x, y);
    let x0 = WORLD, y0 = WORLD, x1 = -1, y1 = -1;
    for (let y = 0; y < WORLD; y++) {
      for (let x = 0; x < WORLD; x++) {
        if (L(x, y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      }
    }
    if (x1 < 0) return;
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(WORLD - 1, x1 + 1); y1 = Math.min(WORLD - 1, y1 + 1);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    this.box = { x0, y0, w, h, T: Math.max(4, Math.min(16, Math.floor(4096 / Math.max(w, h)))) };
    this.paintGround();

    // how far every cell lies from the sky: the rock under it hangs that much deeper
    const dist = new Float32Array(w * h).fill(1e9), q = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!L(x0 + x, y0 + y)) { dist[y * w + x] = 0; q.push(x, y); }
    for (let i = 0; i < q.length; i += 2) {
      const x = q[i], y = q[i + 1], v = dist[y * w + x] + 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && dist[ny * w + nx] > v) { dist[ny * w + nx] = v; q.push(nx, ny); }
        }
      }
    }
    const D = (x, y) => dist[(y - y0) * w + (x - x0)];
    // the corners of the cells, addressed in world cells
    const C = w + 1, cLand = new Uint8Array(C * (h + 1)), cDist = new Float32Array(C * (h + 1));
    for (let cy = 0; cy <= h; cy++) {
      for (let cx = 0; cx <= w; cx++) {
        let n = 0, m = 1e9;
        for (const [x, y] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) {
          if (L(x0 + x, y0 + y)) { n++; m = Math.min(m, D(x0 + x, y0 + y)); }
        }
        cLand[cy * C + cx] = n;
        cDist[cy * C + cx] = n === 4 ? m - 0.5 : 0;
      }
    }
    const ci = (X, Y) => (Y - y0) * C + (X - x0);
    const edge = (X, Y) => { const n = cLand[ci(X, Y)]; return n > 0 && n < 4; };
    const top = (X, Y) => {
      let x = wx(X), z = wz(Y), y = 0.015 * hash(X, Y, 3);
      if (edge(X, Y)) { x += (hash(X, Y, 1) - 0.5) * 0.42; z += (hash(X, Y, 2) - 0.5) * 0.42; y = -0.05 - 0.1 * hash(X, Y, 4); }
      return [x, y, z];
    };
    const depth = (X, Y) => {
      const d = cDist[ci(X, Y)];
      if (edge(X, Y)) return 0.5 + 0.7 * hash(X, Y, 5);
      return 0.9 + 2.0 * Math.sqrt(d) + 0.24 * d + (hash(X, Y, 6) - 0.5) * 1.5 * Math.min(1, d / 2);
    };
    const bottom = (X, Y) => {
      const [x, , z] = top(X, Y), j = edge(X, Y) ? 0.25 : 0.55;
      return [x + (hash(X, Y, 7) - 0.5) * j, -depth(X, Y), z + (hash(X, Y, 8) - 0.5) * j];
    };
    const A = new THREE.Color('#7b5b3a'), B = new THREE.Color('#5b5550'), K = new THREE.Color('#3a3634');
    const rock = (dd, x, z) => {
      const t = THREE.MathUtils.clamp(dd / 10, 0, 1);
      const band = 0.9 + 0.12 * Math.sin(dd * 2.6 + hash(x * 13 | 0, z * 7 | 0, 9) * 1.5);
      const c = t < 0.45 ? A.clone().lerp(B, t / 0.45) : B.clone().lerp(K, (t - 0.45) / 0.55);
      return c.multiplyScalar(band * (0.92 + hash(x * 31 | 0, z * 17 | 0, 10) * 0.16));
    };
    const grass = new THREE.Color('#4f7a2f');
    const tp = [], tuv = [], rp = [], rc = [], spikes = [];
    const tri = (arr, a, b, c) => arr.push(...a, ...b, ...c);
    // with tiered islands, each cell's ground stands at its height
    const heightOf = (x, y) => heightOfCell(x, y);
    const lift = (p, up) => [p[0], p[1] + up, p[2]];
    const col = (...cs) => { for (const c of cs) rc.push(c.r, c.g, c.b); };
    const uv = (X, Y) => [(X - x0) / w, 1 - (Y - y0) / h];
    const rk = (p, f = 1) => rock(-p[1] * f, p[0], p[2]);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!L(x, y)) continue;
        const a = [x, y], b = [x + 1, y], c = [x + 1, y + 1], d = [x, y + 1], hh = heightOf(x, y);
        const T = (p) => lift(top(...p), hh), Bot = (p) => lift(bottom(...p), hh);
        // the top faces up: (a, d, c) and (a, c, b)
        tri(tp, T(a), T(d), T(c)); tuv.push(...uv(...a), ...uv(...d), ...uv(...c));
        tri(tp, T(a), T(c), T(b)); tuv.push(...uv(...a), ...uv(...c), ...uv(...b));
        const pa = bottom(...a), pb = bottom(...b), pc = bottom(...c), pd = bottom(...d);
        // (the rock's colour goes by its depth under the island's own top)
        tri(rp, lift(pa, hh), lift(pc, hh), lift(pd, hh)); col(rk(pa), rk(pc), rk(pd));
        tri(rp, lift(pa, hh), lift(pb, hh), lift(pc, hh)); col(rk(pa), rk(pb), rk(pc));
        // walls where the island meets the sky, walked so that they face outward; and a cliff
        // where it meets lower ground, down to that ground's top
        for (const [dx, dy, p, s] of [[0, -1, a, b], [1, 0, b, c], [0, 1, c, d], [-1, 0, d, a]]) {
          if (L(x + dx, y + dy)) {
            const below = heightOf(x + dx, y + dy);
            if (below >= hh) continue;
            const tA = T(p), tB = T(s), lA = lift(top(...p), below), lB = lift(top(...s), below), cliff = rock(1.5, tA[0], tA[2]);
            tri(rp, tA, tB, lB); col(grass, grass, cliff);
            tri(rp, tA, lB, lA); col(grass, cliff, cliff);
            continue;
          }
          const tA = T(p), tB = T(s), bA = Bot(p), bB = Bot(s);
          tri(rp, tA, tB, bB); col(grass, grass, rk(bottom(...s), 0.6));
          tri(rp, tA, bB, bA); col(grass, rk(bottom(...s), 0.6), rk(bottom(...p), 0.6));
        }
        if (D(x, y) >= 2 && hash(x, y, 50) < 0.045) {
          const [px, py, pz] = bottom(x, y);
          spikes.push([px, py + 0.4 + hh, pz, 0.5 + hash(x, y, 51) * 1.1, 1.5 + hash(x, y, 52) * (2 - py * 0.5), py]);
        }
      }
    }
    const topGeo = new THREE.BufferGeometry();
    topGeo.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    topGeo.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
    topGeo.computeVertexNormals();
    this.topMat.map = this.texture;
    this.topMat.needsUpdate = true;
    const topMesh = new THREE.Mesh(topGeo, this.topMat);
    topMesh.receiveShadow = true;
    const rockGeo = new THREE.BufferGeometry();
    rockGeo.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    rockGeo.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
    rockGeo.computeVertexNormals();
    const rockMesh = new THREE.Mesh(rockGeo, this.rockMat);
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    this.islands.add(topMesh, rockMesh);
    if (spikes.length) {
      const cone = new THREE.ConeGeometry(1, 1, 6);
      cone.rotateX(Math.PI);
      cone.translate(0, -0.5, 0);
      const inst = new THREE.InstancedMesh(cone, this.spikeMat, spikes.length);
      const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), e = new THREE.Euler();
      spikes.forEach(([x, y, z, r, hh, under], i) => {
        qt.setFromEuler(e.set((hash(i, 1, 53) - 0.5) * 0.3, hash(i, 2, 54) * 6, (hash(i, 3, 55) - 0.5) * 0.3));
        m.compose(new THREE.Vector3(x, y, z), qt, new THREE.Vector3(r, hh, r));
        inst.setMatrixAt(i, m);
        inst.setColorAt(i, rock((-under - 0.4 + hh * 0.5) * 0.55, x, z));
      });
      inst.castShadow = true;
      this.islands.add(inst);
    }
  },

  makeBridgeMeshes() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    for (let i = 0; i < 8; i++) {
      const l = 0.85 + hash(i, 1, 60) * 0.3;
      g.fillStyle = `rgb(${150 * l | 0},${104 * l | 0},${62 * l | 0})`;
      g.fillRect(0, i * 8, 64, 7);
      g.fillStyle = 'rgba(60,38,20,0.9)';
      g.fillRect(0, i * 8 + 7, 64, 1);
    }
    const wood = new THREE.CanvasTexture(cv);
    wood.colorSpace = THREE.SRGBColorSpace;
    const N = 3000;
    const make = (geo, material, n) => {
      const im = new THREE.InstancedMesh(geo, material, n);
      im.castShadow = true;
      im.receiveShadow = true;
      im.count = 0;
      im.frustumCulled = false;
      this.bridges.add(im);
      return im;
    };
    this.deck = make(new THREE.BoxGeometry(1.02, 0.16, 1.02), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.9 }), N);
    this.deck.setColorAt(0, new THREE.Color('#fff'));
    this.beam = make(new THREE.BoxGeometry(0.16, 0.22, 1.02), new THREE.MeshStandardMaterial({ color: '#4d321c', roughness: 0.9 }), N);
    this.rail = make(new THREE.BoxGeometry(1, 0.08, 0.08), new THREE.MeshStandardMaterial({ color: '#6a4426', roughness: 0.9 }), N * 2);
    this.post = make(new THREE.BoxGeometry(0.1, 0.32, 0.1), new THREE.MeshStandardMaterial({ color: '#6a4426', roughness: 0.9 }), N * 2);
    // a lift: four posts of timber bound with iron from its foot to its head, a beam across the
    // head with a pulley, ropes, and the car: a platform with a rail round it
    const L = 200, iron = new THREE.MeshStandardMaterial({ color: '#5d5a62', metalness: 0.5, roughness: 0.45 });
    this.liftPost = make(new THREE.BoxGeometry(0.12, 1, 0.12), new THREE.MeshStandardMaterial({ color: '#7a5030', roughness: 0.85 }), L * 4);
    this.liftBand = make(new THREE.BoxGeometry(1.1, 0.07, 1.1), iron, L * 8);
    this.liftHead = make(new THREE.BoxGeometry(1.2, 0.2, 0.2), new THREE.MeshStandardMaterial({ color: '#4d321c', roughness: 0.9 }), L);
    this.liftWheel = make(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 12), iron, L);
    this.liftRope = make(new THREE.BoxGeometry(0.03, 1, 0.03), new THREE.MeshStandardMaterial({ color: '#d8c79a', roughness: 1 }), L * 2);
    this.liftCar = make(new THREE.BoxGeometry(0.92, 0.14, 0.92), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.9 }), L);
    this.liftRail = make(new THREE.BoxGeometry(0.92, 0.3, 0.92), new THREE.MeshStandardMaterial({ color: '#c9a14a', metalness: 0.4, roughness: 0.5, wireframe: true }), L);
    this.cars = new Map();
    HEIGHTS.onRide = (key, y) => this.placeCar(key, y);
  },

  /** The lifts' frames, where heights.js found them; their cars are moved in tick(). */
  buildLifts() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const flat = new THREE.Quaternion(), wheelTurn = new THREE.Quaternion();
    const lifts = HEIGHTS.on ? HEIGHTS.lifts.slice(0, 200) : [];
    let n = 0, band = 0;
    for (const lift of lifts) {
      const cx = wx(lift.x), cz = wz(lift.y), tall = lift.high - lift.low + 1.6, mid = lift.low - 0.3 + tall / 2;
      [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].forEach(([ox, oz], k) => {
        this.liftPost.setMatrixAt(n * 4 + k, m.compose(p.set(cx + ox, mid, cz + oz), flat, s.set(1, tall, 1)));
      });
      for (let k = 0; k * 2.4 < tall; k++) this.liftBand.setMatrixAt(band++, m.compose(p.set(cx, lift.low - 0.2 + k * 2.4, cz), flat, s.set(1, 1, 1)));
      const along = lift.dx ? Math.PI / 2 : 0;
      q.setFromEuler(new THREE.Euler(0, along, 0));
      this.liftHead.setMatrixAt(n, m.compose(p.set(cx, lift.high + 1.4, cz), q, s.set(1, 1, 1)));
      wheelTurn.setFromEuler(new THREE.Euler(0, along, Math.PI / 2));
      this.liftWheel.setMatrixAt(n, m.compose(p.set(cx, lift.high + 1.15, cz), wheelTurn, s.set(1, 1, 1)));
      n++;
    }
    this.liftPost.count = n * 4;
    this.liftBand.count = band;
    for (const im of [this.liftHead, this.liftWheel]) im.count = n;
    for (const im of [this.liftPost, this.liftBand, this.liftHead, this.liftWheel]) im.instanceMatrix.needsUpdate = true;
    this.liftsShown = lifts;
    this.liftIndex = new Map(lifts.map((l, i) => [l.key, i]));
    for (const key of [...this.cars.keys()]) if (!lifts.some((l) => l.key === key)) this.cars.delete(key);
    this.moveCars(0);
  },

  /** Each lift's car sinks back down to its foot unless someone rides it (placeCar); its ropes follow. */
  moveCars(dt) {
    const lifts = this.liftsShown ?? [], since = this.lastFrame ?? 0;
    lifts.forEach((lift, n) => {
      // a rider drawn this frame or the last holds the car
      const ride = HEIGHTS.riding.get(lift.key);
      if (ride && ride.at >= since) return;
      const y = this.cars.get(lift.key) ?? lift.low;
      this.setCar(n, lift, y + Math.sign(lift.low - y) * Math.min(Math.abs(lift.low - y), (dt / 1000) * 6));
    });
    for (const im of [this.liftCar, this.liftRail]) { im.count = lifts.length; im.instanceMatrix.needsUpdate = true; }
    this.liftRope.count = lifts.length * 2;
    this.liftRope.instanceMatrix.needsUpdate = true;
  },

  /** The car of the lift with this key at height y, as its rider is drawn (ns-units, via heights.js). */
  placeCar(key, y) {
    const n = this.liftIndex?.get(key);
    if (n === undefined) return;
    this.setCar(n, this.liftsShown[n], y);
    for (const im of [this.liftCar, this.liftRail, this.liftRope]) im.instanceMatrix.needsUpdate = true;
  },

  setCar(n, lift, y) {
    const m = this.carMatrix ??= new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    this.cars.set(lift.key, y);
    const cx = wx(lift.x), cz = wz(lift.y), rope = lift.high + 1.15 - y;
    this.liftCar.setMatrixAt(n, m.compose(p.set(cx, y - 0.07, cz), q, s));
    this.liftRail.setMatrixAt(n, m.compose(p.set(cx, y + 0.15, cz), q, s));
    for (const k of [0, 1]) {
      const off = k ? 0.22 : -0.22;
      this.liftRope.setMatrixAt(n * 2 + k, m.compose(p.set(cx + off * (lift.dx ? 0 : 1), y + rope / 2, cz + off * (lift.dx ? 1 : 0)), q, s.set(1, Math.max(0.01, rope), 1)));
      s.set(1, 1, 1);
    }
  },

  /**
   * A lift that has been hit shows what is left of it over its head, as a building's bar: its car
   * takes every hit on those riding it (the house rules), and bursts when it is spent.
   */
  liftBars() {
    const hits = G.world?.lifts, parent = this.liftCar?.parent;
    this.bars ??= new Map();
    const seen = new Set();
    if (hits?.size && this.liftIndex && parent) {
      const cam = this.el.sceneEl.camera, q = new THREE.Quaternion(), up = new THREE.Quaternion();
      parent.getWorldQuaternion(up).invert();
      cam?.getWorldQuaternion(q);
      for (const [key, left] of hits) {
        const n = this.liftIndex.get(key);
        if (n === undefined) continue;
        const lift = this.liftsShown[n], f = Math.max(0, Math.min(1, left / NS.LIFT_HP));
        let bar = this.bars.get(key);
        if (!bar) {
          const group = new THREE.Group();
          const back = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.2), new THREE.MeshBasicMaterial({ color: '#1b1f27', transparent: true, opacity: 0.85, depthWrite: false }));
          const fill = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.12), new THREE.MeshBasicMaterial({ color: '#6fd08c', depthWrite: false }));
          fill.position.z = 0.001;
          back.renderOrder = 10;
          fill.renderOrder = 11;
          group.add(back, fill);
          parent.add(group);
          bar = { group, fill };
          this.bars.set(key, bar);
        }
        bar.group.position.set(wx(lift.x), lift.high + 2.1, wz(lift.y));
        bar.group.quaternion.copy(up).multiply(q);
        bar.fill.scale.x = Math.max(0.001, f);
        bar.fill.position.x = -0.7 * (1 - f);
        bar.fill.material.color.set(f > 0.6 ? '#6fd08c' : f > 0.3 ? '#f2c14e' : '#ff7a6b');
        seen.add(key);
      }
    }
    for (const [key, bar] of this.bars) {
      if (seen.has(key)) continue;
      bar.group.removeFromParent();
      for (const m of bar.group.children) { m.geometry.dispose(); m.material.dispose(); }
      this.bars.delete(key);
    }
  },

  tick(t, dt) {
    if (this.liftsShown?.length) this.moveCars(Math.min(dt, 100));
    if (this.liftsShown?.length || this.bars?.size) this.liftBars();
    this.lastFrame = t;
  },

  /**
   * Every bridge cell as a wooden deck, with rails on the sides it does not continue on; with
   * tiered islands on its level, and a lift wherever it joins another.
   */
  buildBridges() {
    const v = G.view, m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), none = new THREE.Quaternion();
    const whole = new THREE.Color('#ffffff'), cracked = new THREE.Color('#a07a5c'), hard = new THREE.Color('#b8b2a8');
    let d = 0, r = 0, po = 0;
    for (let y = 0; y < WORLD; y++) {
      for (let x = 0; x < WORLD; x++) {
        const i = y * WORLD + x, t = v.terrain[i];
        if (t < 2 || t > 4 || d >= this.deck.instanceMatrix.count) continue;
        const links = v.links[i] || 15, px = wx(x + 0.5), pz = wz(y + 0.5), h = heightOfCell(x, y);
        m.compose(p.set(px, h - 0.08, pz), (links & 2) || (links & 8) ? turn : none, one); // planks across the way
        this.deck.setMatrixAt(d, m);
        const wear = v.wear?.[i] ?? 0;
        this.deck.setColorAt(d, t === 4 ? hard : t === 3 ? cracked : whole.clone().multiplyScalar(1 - Math.min(0.35, wear * 0.05)));
        m.compose(p.set(px, h - 0.26, pz), (links & 1) || (links & 4) ? none : turn, one);
        this.beam.setMatrixAt(d, m);
        d++;
        for (const [open, ox, oz, ew] of [[!(links & 1), 0, -0.46, false], [!(links & 4), 0, 0.46, false], [!(links & 2), 0.46, 0, true], [!(links & 8), -0.46, 0, true]]) {
          if (!open) continue;
          m.compose(p.set(px + ox, h + 0.22, pz + oz), ew ? turn : none, one);
          this.rail.setMatrixAt(r++, m);
        }
        for (const [ox, oz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
          if (hash(x * 3 + (ox > 0), y * 3 + (oz > 0), 61) < 0.55) {
            m.compose(p.set(px + ox, h + 0.12, pz + oz), none, one);
            this.post.setMatrixAt(po++, m);
          }
        }
      }
    }
    this.buildLifts();
    for (const [im, n] of [[this.deck, d], [this.beam, d], [this.rail, r], [this.post, po]]) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  },
});
