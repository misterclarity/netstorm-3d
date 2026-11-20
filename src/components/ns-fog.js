/**
 * The fog of war, seen (`ns-fog`): island ground the player has not explored (src/fog.js) lies
 * under a blanket of low cloud, the low-poly puffs of the sky's own clouds (ns-clouds.js), which
 * lifts and thins away over a second as the player's things come within sight of it. A puff to
 * each two by two cells of island ground, on its island's level (heights.js), and over the inner
 * ground a bigger billow to each four by four, higher and paler, so that the top rolls; each lifts
 * once most of its cells are explored. One instanced mesh for the lot. Without the fog (the
 * setting), nothing is drawn.
 */
import { G, WORLD, wx, wz, hash } from '../state.js';
import { heightOfCell } from '../heights.js';
import { FOG } from '../fog.js';

const { THREE } = AFRAME;
const LIFT_MS = 1400;
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), C = new THREE.Color();

const land = (t) => t === 1 || t === 5;

AFRAME.registerComponent('ns-fog', {
  init() {
    this.group = new THREE.Group();
    this.el.setObject3D('fog', this.group);
    this.geo = new THREE.IcosahedronGeometry(1, 1);
    this.mat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#3a4658', emissiveIntensity: 0.35, flatShading: true });
    this.puffs = [];
    this.lifting = [];
    const scene = this.el.sceneEl;
    scene.addEventListener('ns-new-game', () => this.layout(true));
    scene.addEventListener('ns-terrain', () => this.layout(false));
  },

  /** The blanket for the islands as they are, over the ground not yet explored. */
  layout(force) {
    const v = G.view;
    if (!v) return;
    let islands = FOG.on ? 1 : 0;
    for (let i = 0; i < WORLD * WORLD; i++) if (land(v.terrain[i])) islands = (Math.imul(islands, 31) + i) | 0;
    if (!force && islands === this.islands) return;
    this.islands = islands;
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.dispose(); this.mesh = null; }
    this.puffs = [];
    this.lifting = [];
    this.rev = FOG.revision;
    if (!FOG.on) return;
    // n by n cells from (bx, by): a puff over them (as `make` has it, if it does) when at least
    // `least` of them are island ground, and not explored yet
    const over = (bx, by, n, least, make) => {
      const cells = [];
      let sx = 0, sy = 0;
      for (let dy = 0; dy < n; dy++) {
        for (let dx = 0; dx < n; dx++) {
          const x = bx + dx, y = by + dy, i = y * WORLD + x;
          if (x < WORLD && y < WORLD && land(v.terrain[i])) { cells.push(i); sx += x + 0.5; sy += y + 0.5; }
        }
      }
      if (cells.length < least) return;
      const puff = { cells, gone: false, t: 0 };
      if (this.clear(puff)) return;
      const h = heightOfCell(cells[0] % WORLD, Math.floor(cells[0] / WORLD)), r = (k) => hash(bx, by, k + n * 10);
      const look = make(wx(sx / cells.length) + (r(2) - 0.5) * n * 0.25, wz(sy / cells.length) + (r(3) - 0.5) * n * 0.25, h, r);
      if (look) this.puffs.push({ ...puff, ...look, turn: r(5) * 6 });
    };
    // the blanket: a puff to each 2×2, some with a smaller one on top
    for (let by = 0; by < WORLD; by += 2) {
      for (let bx = 0; bx < WORLD; bx += 2) {
        over(bx, by, 2, 1, (x, z, h, r) => ({ x, z, y: h + 0.3 + r(4) * 0.25, s: 1.1 + r(1) * 0.55, flat: 0.5 + r(6) * 0.14, shade: 0.84 + r(7) * 0.08 }));
        over(bx, by, 2, 3, (x, z, h, r) => (r(8) < 0.35 ? { x: x + (r(9) - 0.5), z: z + (r(10) - 0.5), y: h + 0.85 + r(11) * 0.2, s: 0.8 + r(12) * 0.3, flat: 0.6, shade: 0.93 } : null));
      }
    }
    // the billows over the inner ground, between the blanket's lines
    for (let by = 1; by < WORLD; by += 4) {
      for (let bx = 1; bx < WORLD; bx += 4) over(bx, by, 4, 10, (x, z, h, r) => ({ x, z, y: h + 0.95 + r(4) * 0.5, s: 2.1 + r(1) * 0.9, flat: 0.42 + r(6) * 0.12, shade: 0.93 + r(7) * 0.06 }));
    }
    if (!this.puffs.length) return;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, this.puffs.length);
    this.puffs.forEach((p, n) => {
      p.n = n;
      mesh.setMatrixAt(n, this.matrix(p, 0));
      mesh.setColorAt(n, C.setRGB(p.shade, p.shade, Math.min(1, p.shade + 0.04)));
    });
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.computeBoundingSphere();
    this.mesh = mesh;
    this.group.add(mesh);
  },

  /** A puff lifts once most of its cells are explored. */
  clear(p) {
    let n = 0;
    for (const i of p.cells) n += FOG.seen[i];
    return n * 2 >= p.cells.length;
  },

  /** A puff `k` of the way through lifting: rising, and thinning away. */
  matrix(p, k) {
    const s = p.s * (1 - k * k);
    return M4.compose(P.set(p.x, p.y + k * 1.6, p.z), Q.setFromAxisAngle(UP, p.turn + k), S.set(s * (1 + k * 0.3), s * p.flat, s * (1 + k * 0.3)));
  },

  tick(t, dt) {
    if (!this.mesh) return;
    if (this.rev !== FOG.revision) {
      this.rev = FOG.revision;
      for (const p of this.puffs) {
        if (p.gone || !this.clear(p)) continue;
        p.gone = true;
        this.lifting.push(p);
      }
    }
    if (!this.lifting.length) return;
    const step = Math.min(dt, 100) / LIFT_MS;
    this.lifting = this.lifting.filter((p) => {
      p.t = Math.min(1, p.t + step);
      this.mesh.setMatrixAt(p.n, this.matrix(p, p.t));
      return p.t < 1;
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  },

  remove() {
    if (this.mesh) this.mesh.dispose();
    this.geo.dispose();
    this.mat.dispose();
  },
});
