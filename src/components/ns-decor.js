/**
 * The islands' greenery and stones: trees, pines, bushes, rocks, flowers and tufts of grass on
 * island ground, so that the islands do not look bare. The trees are the rules' too (world.treeGrows
 * and treeAt, scripts/house-rules.mjs): a shot at a unit behind one is stopped, and a Priest walked
 * in first person cannot walk through one; the rest are only to look at. Clicks go through them,
 * and they keep clear of what the battle needs, standing
 * nowhere near a building, a geyser, an Obelisk, a Temple or a Residence, and none on a bridge.
 * Each kind is one instanced mesh, so the whole lot costs a few draw calls. Each cell's lot is
 * fixed by its place (`hash`), so the islands look the same each time; their colours follow the
 * Fury of the island's owner.
 *
 * The lot is laid out when the islands change (a new map, an islet laid or fallen). After that a
 * building going up or coming down only hides or shows the plants around it, and an island that
 * changes hands only recolours its own: no new layout, no new meshes.
 */
import { G, WORLD, wx, wz, hash, playerTheme } from '../state.js';
import { heightOfCell } from '../heights.js';

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
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), C = new THREE.Color();

AFRAME.registerComponent('ns-decor', {
  init() {
    this.group = new THREE.Group();
    this.el.setObject3D('decor', this.group);
    this.meshes = {}; // kind → { mesh, items: [{ cell, x, z, scale, turn, role, pick, color, hidden }] }
    this.standing = '';
    this.owners = 0;
    this.wait = 0;
    const scene = this.el.sceneEl;
    scene.addEventListener('ns-new-game', () => this.layout(true));
    // the terrain changes with every bridge piece; the plants only with the islands themselves
    scene.addEventListener('ns-terrain', () => this.layout(false));
    // on the original's pixel-art ground the greens are toned down to its darker, earthier colours
    const tone = () => MAT.color.set(scene.systems['ns-art']?.mode === 'sprites' ? '#a29a7c' : '#ffffff');
    scene.addEventListener('ns-art-mode', tone);
    scene.addEventListener('loaded', tone);
  },

  /** What stands on the islands: the plants around it are hidden when it changes. */
  standingSig() {
    let sig = `${G.view.residences.length}`;
    for (const e of G.view.entities.values()) if (e.kind === 'building' || e.kind === 'geyser' || e.kind === 'obelisk') sig += `|${e.id}`;
    return sig;
  },

  /** Who holds the island ground the plants grow on: they are recoloured when it changes. */
  ownersSig() {
    let sig = 0;
    for (const cell of this.cells ?? []) sig = (Math.imul(sig, 31) + G.view.owner[cell] * 7 + cell) | 0;
    return sig;
  },

  tick(t, dt) {
    if (!G.view || !this.cells) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = 500;
    const standing = this.standingSig();
    if (standing !== this.standing) this.clearAround(standing);
    const owners = this.ownersSig();
    if (owners !== this.owners) this.recolor(owners);
  },

  /** The whole lot for the islands as they are: every cell of island ground that may grow something. */
  layout(force) {
    const v = G.view;
    if (!v) return;
    let islands = 0;
    for (let i = 0; i < WORLD * WORLD; i++) if (v.terrain[i] === ISLAND) islands = (Math.imul(islands, 31) + i) | 0;
    if (!force && islands === this.islands) return;
    this.islands = islands;
    for (const { mesh } of Object.values(this.meshes)) { this.group.remove(mesh); mesh.dispose(); }
    this.meshes = {};
    const lots = { trunk: [], crown: [], pine: [], pineTop: [], bush: [], rock: [], flower: [], tuft: [] }, cells = new Set();
    // with tiered islands (heights.js), on the ground of its island's height
    const put = (kind, cell, x, z, scale, role, pick, turn) => {
      lots[kind].push({ cell, x, y: heightOfCell(cell % WORLD, Math.floor(cell / WORLD)), z, scale, turn, role, pick, hidden: false });
      cells.add(cell);
    };
    const island = (x, y) => x >= 0 && y >= 0 && x < WORLD && y < WORLD && v.terrain[y * WORLD + x] === ISLAND;
    for (let y = 0; y < WORLD; y++) {
      for (let x = 0; x < WORLD; x++) {
        const i = y * WORLD + x;
        if (v.terrain[i] !== ISLAND) continue;
        // near the rim the trees stand thicker
        let rim = 0;
        for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (!island(x + dx, y + dy)) rim++;
        const r = hash(x, y, 1), jx = (hash(x, y, 2) - 0.5) * 0.6, jz = (hash(x, y, 3) - 0.5) * 0.6;
        const cx = wx(x + 0.5) + jx, cz = wz(y + 0.5) + jz, turn = hash(x, y, 4) * Math.PI * 2;
        const size = 0.8 + hash(x, y, 5) * 0.55, pick = (s) => hash(x, y, s);
        const trees = 0.03 + Math.min(rim, 3) * 0.035;
        // where a tree grows is the rules' (world.treeGrows: trees are cover, and in the way in first
        // person); the same odds as here
        if (G.world?.treeGrows ? G.world.treeGrows(x, y) : r < trees) {
          // pines grow more on Wind's and Thunder's islands; which Fury that is can change, so the
          // choice is by place alone and the colours follow the owner
          if (hash(x, y, 7) < 0.4) {
            put('trunk', i, cx, cz, size * 0.8, 'trunk', 0, turn);
            put('pine', i, cx, cz, size, 'leaves', pick(6), turn);
            put('pineTop', i, cx, cz, size, 'leaves', pick(6), turn);
          } else {
            put('trunk', i, cx, cz, size, 'trunk', 0, turn);
            put('crown', i, cx, cz, size, 'leaves', pick(6), turn);
          }
        } else if (r < trees + 0.035) put('bush', i, cx, cz, size, 'leaves', pick(8), turn);
        else if (r < trees + 0.055) put('rock', i, cx, cz, size, 'rock', pick(9), turn);
        else if (r < trees + 0.09) {
          for (let k = 0; k < 3; k++) put('flower', i, cx + (pick(20 + k) - 0.5) * 0.5, cz + (pick(30 + k) - 0.5) * 0.5, 1, 'flowers', pick(40 + k), 0);
        } else if (r < trees + 0.2) {
          for (let k = 0; k < 3; k++) put('tuft', i, cx + (pick(50 + k) - 0.5) * 0.4, cz + (pick(60 + k) - 0.5) * 0.4, 0.8 + pick(70 + k) * 0.5, 'grass', 0, pick(80 + k) * 6);
        }
      }
    }
    this.cells = [...cells];
    for (const [kind, items] of Object.entries(lots)) {
      if (!items.length) continue;
      const mesh = new THREE.InstancedMesh(GEO[kind], MAT, items.length);
      items.forEach((item, n) => mesh.setMatrixAt(n, this.matrix(item, false)));
      mesh.castShadow = SHADOWS.has(kind);
      mesh.receiveShadow = false;
      mesh.computeBoundingSphere();
      this.meshes[kind] = { mesh, items };
      this.group.add(mesh);
    }
    this.standing = '';
    this.owners = 0;
    this.recolor(this.ownersSig());
    this.clearAround(this.standingSig());
  },

  matrix(item, hidden) {
    return M4.compose(P.set(item.x, item.y + 0.02, item.z), Q.setFromAxisAngle(UP, item.turn), S.setScalar(hidden ? 0 : item.scale));
  },

  /** Hide the plants near what stands on the islands (and show again those it no longer covers). */
  clearAround(standing) {
    const v = G.view;
    this.standing = standing;
    const keep = new Uint8Array(WORLD * WORLD);
    const clear = (x0, y0, w, h, margin) => {
      for (let y = y0 - margin; y < y0 + h + margin; y++) {
        for (let x = x0 - margin; x < x0 + w + margin; x++) if (x >= 0 && y >= 0 && x < WORLD && y < WORLD) keep[y * WORLD + x] = 1;
      }
    };
    // buildings and geysers with a cell around them, Temples with three, Residences and Obelisks
    for (const e of v.entities.values()) {
      if (e.kind === 'building') clear(e.x, e.y, e.fx, e.fy, v.def(e.type).cls === 'Energy' ? 3 : 1);
      else if (e.kind === 'geyser') clear(e.x - 1, e.y - 1, 3, 3, 1);
      else if (e.kind === 'obelisk') clear(e.x, e.y, 1, 1, 1);
    }
    for (const [x, y] of v.residences) clear(x, y, 4, 4, 0);
    for (const d of v.dungeons ?? []) clear(d.x, d.y, 2, 2, 1);
    for (const { mesh, items } of Object.values(this.meshes)) {
      let changed = false;
      items.forEach((item, n) => {
        const hidden = keep[item.cell] === 1;
        if (hidden === item.hidden) return;
        item.hidden = hidden;
        mesh.setMatrixAt(n, this.matrix(item, hidden));
        changed = true;
      });
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    }
  },

  /** Colour each plant in the greens of the Fury that holds its island. */
  recolor(owners) {
    const v = G.view;
    this.owners = owners;
    for (const { mesh, items } of Object.values(this.meshes)) {
      items.forEach((item, n) => {
        const pal = PALETTE[v.owner[item.cell] ? playerTheme(v.owner[item.cell]) : 'sun'] ?? PALETTE.sun;
        const list = item.role === 'leaves' ? pal.leaves : item.role === 'flowers' ? pal.flowers : item.role === 'rock' ? ROCKS : null;
        mesh.setColorAt(n, C.set(list ? list[Math.floor(item.pick * list.length)] : item.role === 'grass' ? pal.grass : TRUNK));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  },
});
