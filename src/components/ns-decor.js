/**
 * The islands' greenery and stones: trees, pines, bushes, rocks, flowers and tufts of grass on
 * island ground, so that the islands do not look bare. They are only to look at: the rules never
 * see them, clicks go through them, and they keep clear of what the battle needs, standing
 * nowhere near a building, a geyser, a Temple or a Residence, and none on a bridge. Where
 * something is built they are cleared away. Each kind is one instanced mesh, so the whole lot
 * costs a few draw calls. Each cell's lot is fixed by its place (`hash`), so the islands look the
 * same each time; their colours follow the Fury of the island's owner.
 */
import { G, WORLD, wx, wz, hash, playerTheme } from '../state.js';

const { THREE } = AFRAME;
const ISLAND = 1;

// the parts, made once: one unit is one cell
const GEO = {
  trunk: new THREE.CylinderGeometry(0.06, 0.1, 0.62, 5).translate(0, 0.31, 0),
  crown: new THREE.IcosahedronGeometry(0.36, 0).translate(0, 0.82, 0),
  pine: new THREE.ConeGeometry(0.34, 0.75, 6).translate(0, 0.7, 0),
  pineTop: new THREE.ConeGeometry(0.24, 0.55, 6).translate(0, 1.08, 0),
  bush: new THREE.IcosahedronGeometry(0.24, 0).scale(1, 0.72, 1).translate(0, 0.14, 0),
  rock: new THREE.DodecahedronGeometry(0.2, 0).scale(1.2, 0.62, 1).translate(0, 0.08, 0),
  flower: new THREE.IcosahedronGeometry(0.06, 0).translate(0, 0.07, 0),
  tuft: new THREE.ConeGeometry(0.05, 0.3, 3).translate(0, 0.15, 0),
};
const MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.9 });
const SHADOWS = new Set(['trunk', 'crown', 'pine', 'pineTop', 'bush', 'rock']);

/** Each Fury's greens and flowers: the islands of a side look like its Temple's. */
const PALETTE = {
  sun: { leaves: ['#5f9a3a', '#6fae45', '#86b84a', '#4f8a34'], flowers: ['#ffd84a', '#ff7a4a', '#ffffff', '#ffb0c8'], grass: '#7fa848' },
  wind: { leaves: ['#7f9a3a', '#93a74a', '#a3b45a', '#6f8a34'], flowers: ['#fff3a0', '#ffffff', '#e8c870'], grass: '#94a64a' },
  rain: { leaves: ['#3f8f6a', '#4fa07a', '#5aa88a', '#357f5c'], flowers: ['#7ac8ff', '#ffffff', '#b0e0ff'], grass: '#5f9a5a' },
  thunder: { leaves: ['#4f6a44', '#5a5f72', '#64546e', '#46603e'], flowers: ['#c49aff', '#ff9ad8', '#ffffff'], grass: '#5f6e4c' },
};
const ROCKS = ['#8a8478', '#9a9286', '#7a7268', '#a39a8c'];
const TRUNK = '#6b4a2c';

AFRAME.registerComponent('ns-decor', {
  init() {
    this.group = new THREE.Group();
    this.el.setObject3D('decor', this.group);
    this.meshes = [];
    this.sig = '';
    this.wait = 0;
    const scene = this.el.sceneEl;
    scene.addEventListener('ns-new-game', () => this.rebuild(true));
    scene.addEventListener('ns-terrain', () => this.rebuild(true));
    // on the original's pixel-art ground the greens are toned down to its darker, earthier colours
    const tone = () => MAT.color.set(scene.systems['ns-art']?.mode === 'sprites' ? '#a29a7c' : '#ffffff');
    scene.addEventListener('ns-art-mode', tone);
    scene.addEventListener('loaded', tone);
  },

  /** What stands on the islands: rebuilt when it changes (a building laid or gone). */
  signature() {
    let sig = `${G.view.terrainRevision}|${G.view.residences.length}`;
    for (const e of G.view.entities.values()) if (e.kind === 'building' || e.kind === 'geyser') sig += `|${e.id}`;
    return sig;
  },

  tick(t, dt) {
    if (!G.view) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = 500;
    if (this.signature() !== this.sig) this.rebuild(false);
  },

  rebuild() {
    const v = G.view;
    if (!v) return;
    this.sig = this.signature();
    for (const m of this.meshes) { this.group.remove(m); m.dispose(); }
    this.meshes = [];

    // where nothing may grow: buildings and geysers with a cell around them, Temples with three,
    // Residences, and anything standing on a cell
    const keep = new Uint8Array(WORLD * WORLD);
    const clear = (x0, y0, w, h, margin) => {
      for (let y = y0 - margin; y < y0 + h + margin; y++) {
        for (let x = x0 - margin; x < x0 + w + margin; x++) if (x >= 0 && y >= 0 && x < WORLD && y < WORLD) keep[y * WORLD + x] = 1;
      }
    };
    for (const e of v.entities.values()) {
      if (e.kind === 'building') clear(e.x, e.y, e.fx, e.fy, v.def(e.type).cls === 'Energy' ? 3 : 1);
      else if (e.kind === 'geyser') clear(e.x - 1, e.y - 1, 3, 3, 1);
    }
    for (const [x, y] of v.residences) clear(x, y, 4, 4, 0);

    const lots = { trunk: [], crown: [], pine: [], pineTop: [], bush: [], rock: [], flower: [], tuft: [] };
    const put = (kind, x, z, scale, color, turn) => lots[kind].push([x, z, scale, color, turn]);
    const island = (x, y) => x >= 0 && y >= 0 && x < WORLD && y < WORLD && v.terrain[y * WORLD + x] === ISLAND;
    for (let y = 0; y < WORLD; y++) {
      for (let x = 0; x < WORLD; x++) {
        const i = y * WORLD + x;
        if (v.terrain[i] !== ISLAND || keep[i] || v.occupant[i]) continue;
        // near the rim the trees stand thicker
        let rim = 0;
        for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (!island(x + dx, y + dy)) rim++;
        const pal = PALETTE[v.owner[i] ? playerTheme(v.owner[i]) : 'sun'] ?? PALETTE.sun;
        const r = hash(x, y, 1), jx = (hash(x, y, 2) - 0.5) * 0.6, jz = (hash(x, y, 3) - 0.5) * 0.6;
        const cx = wx(x + 0.5) + jx, cz = wz(y + 0.5) + jz, turn = hash(x, y, 4) * Math.PI * 2;
        const size = 0.8 + hash(x, y, 5) * 0.55, pick = (list, s) => list[Math.floor(hash(x, y, s) * list.length)];
        const trees = 0.03 + Math.min(rim, 3) * 0.035;
        if (r < trees) {
          const tone = pick(pal.leaves, 6);
          if (hash(x, y, 7) < (pal === PALETTE.wind || pal === PALETTE.thunder ? 0.55 : 0.25)) {
            put('trunk', cx, cz, size * 0.8, TRUNK, turn);
            put('pine', cx, cz, size, tone, turn);
            put('pineTop', cx, cz, size, tone, turn);
          } else {
            put('trunk', cx, cz, size, TRUNK, turn);
            put('crown', cx, cz, size, tone, turn);
          }
        } else if (r < trees + 0.035) put('bush', cx, cz, size, pick(pal.leaves, 8), turn);
        else if (r < trees + 0.055) put('rock', cx, cz, size, pick(ROCKS, 9), turn);
        else if (r < trees + 0.09) {
          for (let k = 0; k < 3; k++) put('flower', cx + (hash(x, y, 20 + k) - 0.5) * 0.5, cz + (hash(x, y, 30 + k) - 0.5) * 0.5, 1, pick(pal.flowers, 40 + k), 0);
        } else if (r < trees + 0.2) {
          for (let k = 0; k < 3; k++) put('tuft', cx + (hash(x, y, 50 + k) - 0.5) * 0.4, cz + (hash(x, y, 60 + k) - 0.5) * 0.4, 0.8 + hash(x, y, 70 + k) * 0.5, pal.grass, hash(x, y, 80 + k) * 6);
        }
      }
    }

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    for (const [kind, list] of Object.entries(lots)) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(GEO[kind], MAT, list.length);
      list.forEach(([x, z, scale, color, turn], n) => {
        m4.compose(p.set(x, 0.02, z), q.setFromAxisAngle(up, turn), s.setScalar(scale));
        mesh.setMatrixAt(n, m4);
        mesh.setColorAt(n, c.set(color));
      });
      mesh.castShadow = SHADOWS.has(kind);
      mesh.receiveShadow = false;
      mesh.computeBoundingSphere();
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  },
});
