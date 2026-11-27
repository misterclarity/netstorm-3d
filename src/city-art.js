/**
 * The sky cities' own buildings (sim/city-map.ts lays them out; src/components/ns-city.js draws
 * them): houses in the styles of the four Furies and of Altamar's whitewash, market stalls,
 * lamps, trees, fountains, the quarters' landmarks, the Temple of Concord, Altamar's domed hall,
 * bell tower, windmills, warehouses and piers. Low-poly, as the game's own models: each built of a
 * few boxes, cylinders, cones and domes, written into a Batch: one geometry for the lot, coloured
 * per vertex, and one more for what glows by night (windows, lanterns). What moves (sails, vanes,
 * fountain jets, the Temple's orbs, sparks) is listed in `movers` for the component to drive.
 *
 * In a prop's own frame x runs across its front, z out of its front, y up, from the middle of its
 * cells at its ground; a cell is one unit.
 */
import { THREE } from './state.js';
import { grade } from './models.js';

/** The unit shapes, each with its base at y 0 and its middle at x 0, z 0, flat and non-indexed. */
const SHAPES = (() => {
  const base = (g, lift = 0.5) => { g.translate(0, lift, 0); return g.toNonIndexed(); };
  // a gable: a triangular prism one wide (x), one deep (z), its ridge along z at height 1
  const gable = new THREE.BufferGeometry();
  const P = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, 0.5];
  const idx = [0, 2, 1, 3, 5, 4, 0, 3, 4, 0, 4, 2, 1, 2, 4, 1, 4, 5, 0, 1, 5, 0, 5, 3];
  gable.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  gable.setIndex(idx);
  const g = gable.toNonIndexed();
  g.computeVertexNormals();
  return {
    box: base(new THREE.BoxGeometry(1, 1, 1)),
    cyl: base(new THREE.CylinderGeometry(0.5, 0.5, 1, 10)),
    cyl6: base(new THREE.CylinderGeometry(0.5, 0.5, 1, 6)),
    cyl16: base(new THREE.CylinderGeometry(0.5, 0.5, 1, 16)),
    // (about its middle, to lie on its side: a barrel vault)
    rod: new THREE.CylinderGeometry(0.5, 0.5, 1, 16).toNonIndexed(),
    taper: base(new THREE.CylinderGeometry(0.38, 0.5, 1, 10)),
    frustum: base(new THREE.CylinderGeometry(0.28, 0.5, 1, 4).rotateY(Math.PI / 4)),
    cone: base(new THREE.ConeGeometry(0.5, 1, 10)),
    cone6: base(new THREE.ConeGeometry(0.5, 1, 6)),
    pyramid: base(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4)),
    dome: new THREE.SphereGeometry(0.5, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed(),
    // (a flat square facing up, at its base: a line painted on a roof; give it a height of 1)
    quad: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).toNonIndexed(),
    // (a cylinder's side alone, open at its ends: a ring round a dome, a cone or a vault)
    hoop: base(new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1, true)),
    ball: base(new THREE.IcosahedronGeometry(0.5, 1)),
    rock: base(new THREE.IcosahedronGeometry(0.5, 0)),
    gable: g,
  };
})();

const coarse = (shape, sx, sy, sz) => (shape === 'ball' && Math.max(sx, sy, sz) < 0.5 ? 'rock' : shape);

const COLORS = new Map();
/** A colour as the batch keeps it: through the models' solarpunk grade (models.js), as theirs are. */
const color = (hex) => {
  let c = COLORS.get(hex);
  if (!c) { c = new THREE.Color(grade(hex)); COLORS.set(hex, c); }
  return c;
};

/** Many shapes, each placed and coloured, made into one geometry. */
export class Batch {
  constructor() {
    this.parts = [];
    this.count = 0;
  }

  add(shape, matrix, hex) {
    const g = SHAPES[shape];
    this.parts.push({ g, m: matrix.clone(), c: color(hex) });
    this.count += g.attributes.position.count;
  }

  geometry() {
    const pos = new Float32Array(this.count * 3), nor = new Float32Array(this.count * 3), col = new Float32Array(this.count * 3);
    const v = new THREE.Vector3(), n = new THREE.Matrix3();
    let o = 0;
    for (const { g, m, c } of this.parts) {
      n.getNormalMatrix(m);
      const p = g.attributes.position, q = g.attributes.normal;
      for (let i = 0; i < p.count; i++, o++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m);
        pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
        v.fromBufferAttribute(q, i).applyMatrix3(n).normalize();
        nor[o * 3] = v.x; nor[o * 3 + 1] = v.y; nor[o * 3 + 2] = v.z;
        col[o * 3] = c.r; col[o * 3 + 1] = c.g; col[o * 3 + 2] = c.b;
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  }
}

const M = new THREE.Matrix4(), L = new THREE.Matrix4(), E = new THREE.Euler(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** The turn that brings a prop's front (+z) to face way r: 0 north (-z), 1 east, 2 south, 3 west. */
export const TURN = [Math.PI, Math.PI / 2, 0, -Math.PI / 2];

/** Builds into the batches in a prop's frame. */
export class Kit {
  /** `frame`: the prop's frame in the city's space; `lit` the batch of what is lit, `glow` of what
   * glows, `shine` of what is glossy (the solar cells). */
  constructor(lit, glow, movers, lights, shine = lit) {
    this.lit = lit;
    this.glowing = glow;
    this.shining = shine;
    this.movers = movers;
    this.lights = lights;
    this.frame = new THREE.Matrix4();
  }

  /** Into the frame of a prop whose cells' middle is at (x, y, z) facing way r (0 N .. 3 W). */
  at(x, y, z, r) {
    Q.setFromAxisAngle(UP, TURN[r] ?? 0);
    this.frame.compose(V.set(x, y, z), Q, S.set(1, 1, 1));
    return this;
  }

  matrix(x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    E.set(rx, ry, rz);
    L.compose(V.set(x, y, z), Q.setFromEuler(E), S.set(sx, sy, sz));
    return M.multiplyMatrices(this.frame, L);
  }

  /** A shape of size (sx, sy, sz), its base's middle at (x, y, z), turned by (rx, ry, rz). A small
   * ball (a leaf, a flower, a head) is the coarser one: a city has thousands of them. */
  part(shape, x, y, z, sx, sy, sz, hex, rx = 0, ry = 0, rz = 0) {
    this.lit.add(coarse(shape, sx, sy, sz), this.matrix(x, y, z, sx, sy, sz, rx, ry, rz), hex);
  }

  /** The same, glowing by night. */
  glow(shape, x, y, z, sx, sy, sz, hex, rx = 0, ry = 0, rz = 0) {
    this.glowing.add(coarse(shape, sx, sy, sz), this.matrix(x, y, z, sx, sy, sz, rx, ry, rz), hex);
  }

  /** The same, glossy: solar cells. */
  shine(shape, x, y, z, sx, sy, sz, hex, rx = 0, ry = 0, rz = 0) {
    this.shining.add(coarse(shape, sx, sy, sz), this.matrix(x, y, z, sx, sy, sz, rx, ry, rz), hex);
  }

  /** A part turned by the quaternion q (a roof's hips, its slopes), glossy if `shine`. */
  partQ(shape, x, y, z, sx, sy, sz, hex, q, shine = false) {
    L.compose(V.set(x, y, z), q, S.set(sx, sy, sz));
    (shine ? this.shining : this.lit).add(coarse(shape, sx, sy, sz), M.multiplyMatrices(this.frame, L), hex);
  }

  /** Where (x, y, z) of the frame is in the city's space. */
  point(x, y, z) {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.frame);
  }

  /** A lamp's light by night at (x, y, z), of colour hex. */
  light(x, y, z, hex = '#ffc46b') {
    this.lights.push({ at: this.point(x, y, z), hex });
  }

  /** Something that moves: `kind` for the component, at (x, y, z) of the frame, `turn` its frame's turn. */
  mover(kind, x, y, z, extra = {}) {
    const q = new THREE.Quaternion().setFromRotationMatrix(this.frame);
    this.movers.push({ kind, at: this.point(x, y, z), q, ...extra });
  }
}

/* ------------------------------------------ palettes ------------------------------------------ */

const pick = (list, v) => list[Math.floor(v * list.length) % list.length];
const FURY = { sun: '#e8a23a', rain: '#3f8fd8', wind: '#7fb04a', thunder: '#8f6ae0', med: '#2f68b8', concord: '#d8c07a' };
// (windows of glass that shows the sky)
const WINDOW = '#3f5c63';
const LANTERN = '#ffc870';
const STYLE = {
  sun: { walls: ['#e2c08a', '#d9b07a', '#e8cd9e', '#d6a76c'], trim: '#a8683a', door: '#6a4024', lit: '#ffcf7a' },
  rain: { walls: ['#cbd7e0', '#bccbd6', '#d6dfe5'], trim: '#eef3f6', door: '#2f5f8a', lit: '#cfe6ff' },
  wind: { walls: ['#efeedc', '#e5e8d2', '#f1e9d6'], trim: '#7a5a3a', door: '#5a7a3a', lit: '#fff0b0' },
  thunder: { walls: ['#c9bfd8', '#bdb3cf', '#d2c9de'], trim: '#c98a4a', door: '#5a4a78', lit: '#d8c8ff' },
  med: { walls: ['#f6f4ee', '#f1eee5', '#f8f6f1', '#ede7db'], trim: '#e2dccf', door: '#2f68b8', lit: '#ffd88a' },
};
const SHUTTERS = ['#2f68b8', '#2a8f9a', '#4f8f4a', '#c98a2c', '#2f68b8'];

/** A prop's width (across its front) and depth, in cells. */
export function sizeOf(p) {
  return p.r % 2 === 0 ? [p.w, p.h] : [p.h, p.w];
}

/* ------------------------------------------- houses ------------------------------------------- */

/** Windows along a face: on wall z = d (the front) or x = w (a side), each floor's. */
function windows(k, st, W, D, floors, v, door) {
  for (let f = 0; f < floors; f++) {
    const y = 0.45 + f * 1.15;
    // the front
    const nf = Math.max(1, Math.floor(W / 0.95));
    for (let i = 0; i < nf; i++) {
      const x = -W / 2 + (i + 0.5) * (W / nf);
      if (f === 0 && Math.abs(x - door) < 0.5) continue;
      const lit = ((v * 97 + i * 13 + f * 7) % 1) < 0.55;
      (lit ? k.glow : k.part).call(k, 'box', x, y, D / 2, 0.3, 0.42, 0.06, lit ? st.lit : WINDOW);
    }
    // the sides
    const ns = Math.max(1, Math.floor(D / 1.1));
    for (let i = 0; i < ns; i++) {
      const z = -D / 2 + (i + 0.5) * (D / ns);
      for (const s of [-1, 1]) {
        const lit = ((v * 53 + i * 11 + f * 5 + s) % 1) < 0.45;
        (lit ? k.glow : k.part).call(k, 'box', (s * W) / 2, y, z, 0.06, 0.42, 0.3, lit ? st.lit : WINDOW);
      }
    }
  }
}

/* ------------------------------ solar roofs: every roof is a solar panel ------------------------------ */
/** Solar cells, tinted to the quarter's Fury (as the models' are: models.js, PV); the pale lines
 * between the cells; brass. */
const CELLS = { sun: '#3069a0', rain: '#2f6fb0', wind: '#2b7a86', thunder: '#4a55a6', med: '#3069a0' };
const LINES = '#cfe2ea', BRASS = '#d9aa45';
const cellsOf = (s) => CELLS[s] ?? CELLS.sun;
const UP3 = new THREE.Vector3(0, 1, 0), QS = new THREE.Quaternion(), A3 = new THREE.Vector3(), B3 = new THREE.Vector3();
const X3 = new THREE.Vector3(), N3 = new THREE.Vector3(), Z3 = new THREE.Vector3(), BASIS = new THREE.Matrix4();
/** A straight seam `t` thick from a to b ([x, y, z] in the prop's frame): a hip, a ridge, a rib. */
function seam(k, a, b, t, hex) {
  A3.set(...a);
  B3.set(...b);
  QS.setFromUnitVectors(UP3, B3.clone().sub(A3).normalize());
  k.partQ('box', a[0], a[1], a[2], t, A3.distanceTo(B3), t, hex, QS);
}
/** A line `t` wide from a to b on a face whose outward normal is n: a line between the cells, flat
 * (two triangles, where a seam has twelve: the cities have thousands of them). */
function strip(k, a, b, n, t, hex) {
  A3.set(...a);
  B3.set(...b);
  X3.subVectors(B3, A3);
  const len = X3.length();
  X3.divideScalar(len);
  N3.set(...n);
  N3.addScaledVector(X3, -N3.dot(X3)).normalize();
  Z3.crossVectors(X3, N3);
  QS.setFromRotationMatrix(BASIS.makeBasis(X3, N3, Z3));
  k.partQ('quad', (A3.x + B3.x) / 2, (A3.y + B3.y) / 2, (A3.z + B3.z) / 2, len, 1, t, hex, QS);
}
/** A flat roof W × D at height y that is one solar panel: brass round it, its cells ruled both ways. */
function solarFlat(k, W, D, y, s, x = 0, z = 0) {
  k.part('box', x, y, z, W, 0.06, D, BRASS);
  k.shine('box', x, y + 0.02, z, W - 0.16, 0.06, D - 0.16, cellsOf(s));
  const iw = W - 0.16, id = D - 0.16, nx = Math.max(1, Math.round(iw / 0.5)), nz = Math.max(1, Math.round(id / 0.5));
  for (let i = 1; i < nx; i++) k.part('quad', x - iw / 2 + (iw * i) / nx, y + 0.085, z, 0.03, 1, id, LINES);
  for (let i = 1; i < nz; i++) k.part('quad', x, y + 0.086, z - id / 2 + (id * i) / nz, iw, 1, 0.03, LINES);
}
/**
 * A ridge roof as the gable shape (`w` across, `rise` high, `l` long, its ridge along z turned
 * `turn`), its eaves' middle at (x, y, z): all solar panel, each slope one sheet of cells ruled
 * across, brass on its ridge and eaves; its two ends of `ends`.
 */
function solarGable(k, x, y, z, w, rise, l, s, ends, turn = 0) {
  k.part('gable', x, y, z, w * 0.98, rise * 0.98, l * 0.98, ends, 0, turn, 0);
  const half = w / 2, tilt = Math.atan2(rise, half), slope = Math.hypot(rise, half), c = Math.cos(turn), sn = Math.sin(turn);
  // a point (u across, v up, t along the ridge, `off` out of the slope on `side`) in the prop's frame
  const at = (u, v, t, side = 0, off = 0) => {
    const uu = u + side * Math.sin(tilt) * off, vv = v + Math.cos(tilt) * off;
    return [x + uu * c + t * sn, y + vv, z - uu * sn + t * c];
  };
  for (const side of [-1, 1]) {
    QS.setFromEuler(new THREE.Euler(0, turn, -side * tilt, 'YXZ'));
    k.partQ('box', ...at((side * half) / 2, rise / 2, 0, side, 0.005), slope + 0.08, 0.05, l + 0.1, cellsOf(s), QS, true);
    // its cells: lines down the slope, and along it, on the sheet (its face 0.055 out)
    const o = at(0, 0, 0), out = at(0, 0, 0, side, 1).map((v, i) => v - o[i]), n = Math.max(1, Math.round(l / 0.5));
    for (let i = 1; i < n; i++) { const t = -l / 2 + (l * i) / n; strip(k, at(side * half, 0, t, side, 0.058), at(0, rise, t, side, 0.058), out, 0.03, LINES); }
    for (const f of [1 / 3, 2 / 3]) strip(k, at(side * half * (1 - f), rise * f, -l / 2, side, 0.059), at(side * half * (1 - f), rise * f, l / 2, side, 0.059), out, 0.03, LINES);
    seam(k, at(side * half, 0, -l / 2 - 0.05, side, 0.04), at(side * half, 0, l / 2 + 0.05, side, 0.04), 0.07, BRASS);
  }
  seam(k, at(0, rise + 0.03, -l / 2 - 0.06), at(0, rise + 0.03, l / 2 + 0.06), 0.09, BRASS);
}
/** A pyramid roof W × D, `top` high, its eaves' middle at (x, y, z): its faces one solar panel each,
 * brass on its hips and eaves, the cells ruled across. */
function solarPyramid(k, x, y, z, W, top, D, s) {
  k.shine('pyramid', x, y, z, W, top, D, cellsOf(s));
  const apex = [x, y + top + 0.02, z], corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([cx, cz]) => [x + (cx * W * 1.01) / 2, y + 0.01, z + (cz * D * 1.01) / 2]);
  const lerp = (a, b, f) => a.map((v, i) => v + (b[i] - v) * f);
  corners.forEach((cn, i) => {
    const next = corners[(i + 1) % 4], mid = lerp(cn, next, 0.5);
    // (the face's outward normal: out from the middle of its foot as far as the roof is high, and up
    // as far as the foot is from the middle; the cells' lines lie just off the face)
    const across = Math.hypot(mid[0] - x, mid[2] - z), out = [((mid[0] - x) / across) * top, across, ((mid[2] - z) / across) * top];
    const off = (pt) => pt.map((v, j) => v + (out[j] / Math.hypot(...out)) * 0.012);
    seam(k, cn, apex, 0.07, BRASS);
    seam(k, cn, next, 0.07, BRASS);
    for (const f of [0.3, 0.6]) strip(k, off(lerp(cn, apex, f)), off(lerp(next, apex, f)), out, 0.03, LINES);
    strip(k, off(mid), off(apex), out, 0.03, LINES);
  });
}
/** A cone roof `d` across and `h` high on (x, y, z) (as the cone shape): all solar cells, rings of
 * brass at its eaves and of the cells' lines up it. */
function solarCone(k, x, y, z, d, h, s, shape = 'cone') {
  k.shine(shape, x, y, z, d, h, d, cellsOf(s));
  k.part('cyl16', x, y - 0.02, z, d + 0.08, 0.05, d + 0.08, BRASS);
  for (const f of [0.3, 0.6]) k.part('hoop', x, y + h * f, z, d * (1 - f) + 0.04, 0.02, d * (1 - f) + 0.04, LINES);
}
/** A dome (as the dome shape, sx × sy × sz) on (x, y, z): all solar cells, brass ribs down it and a
 * brass ring at its foot, the cells' lines round it. */
function solarDome(k, x, y, z, sx, sy, sz, s, ribs = 10, rib = BRASS) {
  k.shine('dome', x, y, z, sx, sy, sz, cellsOf(s));
  k.part('cyl16', x, y - 0.02, z, sx + 0.08, 0.05, sz + 0.08, rib);
  for (const f of [0.38, 0.72]) {
    const r = Math.sqrt(1 - f * f);
    k.part('hoop', x, y + sy * 0.5 * f, z, sx * r + 0.035, 0.02, sz * r + 0.035, LINES);
  }
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2, pt = (th) => [x + 0.5 * 1.012 * sx * Math.cos(th) * Math.cos(a), y + 0.5 * 1.012 * sy * Math.sin(th), z + 0.5 * 1.012 * sz * Math.cos(th) * Math.sin(a)];
    for (let j = 0; j < 4; j++) seam(k, pt((j / 4) * (Math.PI / 2)), pt(((j + 1) / 4) * (Math.PI / 2)), Math.max(0.035, sx * 0.012), rib);
  }
}
/** A barrel vault (as the rod shape lying along z: `w` across, `l` long, `h` high) about (x, y, z):
 * all solar cells, brass at its crown, the cells' lines over it. */
function solarVault(k, x, y, z, w, l, h, s) {
  k.shine('rod', x, y, z, w, l, h, cellsOf(s), Math.PI / 2);
  const n = Math.max(1, Math.round(l / 0.55));
  for (let i = 1; i < n; i++) k.part('hoop', x, y, z - l / 2 + (l * i) / n, w + 0.035, 0.02, h + 0.035, LINES, Math.PI / 2);
  seam(k, [x, y + h / 2 + 0.01, z - l / 2], [x, y + h / 2 + 0.01, z + l / 2], 0.07, BRASS);
}
/** Ivy down a wall: strands from the top (y) of the front (z = D / 2) at a few places across W. */
function ivy(k, W, D, y, v) {
  for (let i = 0; i < 3; i++) {
    const x = (((v * 59 + i * 0.29) % 1) - 0.5) * (W - 0.4), len = 0.6 + ((v * 71 + i * 0.43) % 1) * Math.min(1.2, y - 0.3);
    k.part('box', x, y - len, D / 2 + 0.04, 0.16, len, 0.06, i % 2 ? '#4f9a3c' : '#3f8a3a');
    k.part('ball', x, y - len - 0.05, D / 2 + 0.07, 0.24, 0.2, 0.12, '#5c9e40');
  }
}

/** A house of the style p.s on its cells, its door toward the street. */
export function house(k, p) {
  const [cw, cd] = sizeOf(p), st = STYLE[p.s] ?? STYLE.med, v = p.v;
  const W = cw - 0.22, D = cd - 0.22;
  const big = cw * cd;
  const floors = 1 + (v > 0.35 ? 1 : 0) + (v > 0.8 && big >= 6 ? 1 : 0);
  const H = floors * 1.15, wall = pick(st.walls, v);
  const door = ((v * 31) % 1 - 0.5) * Math.max(0, W - 1.2);
  // the walls, a plinth, the door and its step
  k.part('box', 0, 0, 0, W, H, D, wall);
  k.part('box', 0, 0, 0, W + 0.06, 0.18, D + 0.06, st.trim);
  k.part('box', door, 0, D / 2, 0.5, 0.9, 0.08, p.s === 'med' ? pick(SHUTTERS, (v * 13) % 1) : st.door);
  k.part('box', door, 0, D / 2 + 0.12, 0.7, 0.08, 0.3, st.trim);
  windows(k, st, W, D, floors, v, door);
  // a lantern by the door
  k.glow('box', door + 0.45, 0.95, D / 2 + 0.07, 0.12, 0.18, 0.12, LANTERN);
  if (((v * 17) % 1) < 0.5) k.light(door + 0.45, 1.05, D / 2 + 0.2);
  switch (p.s) {
    case 'sun': {
      // a flat roof behind a parapet; a sun disc over the door; on some a pavilion with an awning
      k.part('box', 0, H, 0, W + 0.1, 0.25, D + 0.1, st.trim);
      k.part('cyl', door, 1.0, D / 2 + 0.05, 0.42, 0.05, 0.42, '#e8b43a', Math.PI / 2);
      // solarpunk: the roof (inside its parapet) one solar panel; ivy on some fronts
      solarFlat(k, W - 0.2, D - 0.2, H + 0.2, 'sun');
      if (((v * 9) % 1) < 0.4) ivy(k, W, D, H, v);
      if (v > 0.55 && big >= 6) {
        k.part('box', -W / 4, H + 0.25, -D / 4, W / 2.4, 0.9, D / 2.4, wall);
        solarFlat(k, W / 2, D / 2 + 0.3, H + 1.15, 'sun', -W / 4, -D / 4 + 0.15);
      }
      // (an awning of solar cells over the door)
      if (((v * 5) % 1) < 0.5) { k.part('box', door, 1.05, D / 2 + 0.3, 1.1, 0.05, 0.6, BRASS, 0.25); k.shine('box', door, 1.07, D / 2 + 0.3, 1.0, 0.05, 0.5, cellsOf('sun'), 0.25); }
      break;
    }
    case 'rain': {
      // a vaulted roof; a round turret on the bigger houses; a rain barrel by the door
      k.part('box', 0, H, 0, W + 0.08, 0.12, D + 0.08, st.trim);
      solarVault(k, 0, H + 0.06, 0, W * 0.98, D + 0.1, Math.min(1.5, W * 0.6), 'rain');
      if (big >= 9 || (v > 0.7 && big >= 6)) {
        k.part('cyl', W / 2 - 0.4, 0, -D / 2 + 0.4, 0.9, H + 0.9, 0.9, wall);
        solarCone(k, W / 2 - 0.4, H + 0.9, -D / 2 + 0.4, 1.15, 1.0, 'rain');
      }
      k.part('cyl', door - 0.55, 0, D / 2 + 0.2, 0.36, 0.5, 0.36, '#6f8aa0');
      if (((v * 9) % 1) < 0.55) ivy(k, W, D, H, v);
      break;
    }
    case 'wind': {
      // a steep gable, timber at the corners and a band between the floors, a pennant on the ridge
      solarGable(k, 0, H, 0, W + 0.25, Math.min(1.6, 0.6 + W * 0.4), D + 0.25, 'wind', st.trim);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.part('box', (sx * W) / 2, 0, (sz * D) / 2, 0.12, H, 0.12, st.trim);
      for (let f = 1; f < floors; f++) k.part('box', 0, f * 1.15 - 0.05, 0, W + 0.04, 0.1, D + 0.04, st.trim);
      if (v > 0.4) {
        const top = H + Math.min(1.6, 0.6 + W * 0.4);
        k.part('box', 0, top - 0.1, -D / 4, 0.05, 0.9, 0.05, '#5a4a3a');
        k.part('box', 0.22, top + 0.5, -D / 4, 0.42, 0.24, 0.03, FURY.wind);
      }
      break;
    }
    case 'thunder': {
      // a steep slate pyramid, metal at the eaves, a lightning rod with a violet glow at its tip
      k.part('box', 0, H, 0, W + 0.12, 0.15, D + 0.12, st.trim);
      const top = Math.min(2.2, 0.9 + Math.min(W, D) * 0.6);
      solarPyramid(k, 0, H + 0.15, 0, W + 0.1, top, D + 0.1, 'thunder');
      k.part('cyl', 0, H + 0.15 + top - 0.2, 0, 0.06, 0.9, 0.06, '#b8c0d0');
      k.glow('ball', 0, H + top + 0.65, 0, 0.16, 0.16, 0.16, '#c9a8ff');
      if (((v * 9) % 1) < 0.6) ivy(k, W, D, H, v);
      break;
    }
    default: {
      // Altamar's: a flat roof behind a low parapet; on some a blue dome, a pergola on the roof,
      // bougainvillea over the door, a chimney
      k.part('box', 0, H, 0, W + 0.08, 0.22, D + 0.08, '#efebe2');
      // (the roof inside its parapet one solar panel; a dome all solar cells)
      solarFlat(k, W - 0.25, D - 0.25, H + 0.18, 'med');
      if (v < 0.3) {
        const r = Math.min(W, D) * 0.62;
        k.part('cyl', 0, H + 0.2, 0, r, 0.35, r, wall);
        solarDome(k, 0, H + 0.55, 0, r, r * 1.05, r, 'med', 8);
        k.part('ball', 0, H + 0.5 + r * 0.55, 0, 0.12, 0.12, 0.12, '#f0e8d0');
      } else if (v > 0.8) {
        // a pergola on the roof: white posts, two beams, slats across them, a vine along one side
        const pw = W - 0.5, pd = D - 0.5, wood = '#8a6a44';
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.part('box', (sx * pw) / 2, H + 0.22, (sz * pd) / 2, 0.1, 1.0, 0.1, '#f1ece2');
        for (const sz of [-1, 1]) k.part('box', 0, H + 1.2, (sz * pd) / 2, pw + 0.3, 0.1, 0.08, wood);
        const n = Math.max(3, Math.round(pw / 0.4));
        for (let i = 0; i < n; i++) k.part('box', -pw / 2 + (i * pw) / (n - 1), H + 1.3, 0, 0.06, 0.07, pd + 0.3, wood);
        for (let i = 0; i < 4; i++) {
          k.part('ball', -pw / 2 + (i + 0.5) * (pw / 4), H + 1.38, pd / 2 - 0.1 - ((v * 37 + i) % 1) * 0.3, 0.42, 0.14, 0.32, '#4f8f3a');
          if (i % 2) k.part('ball', -pw / 2 + (i + 0.5) * (pw / 4) + 0.12, H + 1.42, pd / 2 - 0.05, 0.16, 0.12, 0.16, '#c2307a');
        }
        k.part('box', -pw / 2, H + 0.22, pd / 2 - 0.05, 0.12, 1.05, 0.14, '#4f7f3a');
      }
      if (((v * 23) % 1) < 0.5) {
        for (let i = 0; i < 4; i++) k.part('ball', door + (i - 1.5) * 0.28, 1.0 + (i % 2) * 0.2, D / 2 + 0.06, 0.32, 0.26, 0.18, i % 3 ? '#c2307a' : '#d84a95');
        k.part('ball', door, 1.25, D / 2 + 0.02, 0.9, 0.3, 0.16, '#4f7f3a');
      }
      if (((v * 41) % 1) < 0.35) k.part('box', -W / 2 + 0.35, H, -D / 2 + 0.35, 0.3, 0.6, 0.3, '#ece6da');
      // shutters by the windows of the front
      const sh = pick(SHUTTERS, (v * 29) % 1);
      for (let f = 0; f < floors; f++) for (const sx of [-1, 1]) if (W > 1.4) k.part('box', sx * (W / 2 - 0.3), 0.42 + f * 1.15, D / 2 + 0.02, 0.12, 0.46, 0.04, sh);
    }
  }
}

/* ------------------------------------------- market ------------------------------------------- */

export function stall(k, p) {
  const [cw, cd] = sizeOf(p), W = cw - 0.25, D = cd - 0.3, c = FURY[p.s] ?? FURY.med, wood = '#8a6440';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.part('box', (sx * W) / 2, 0, (sz * D) / 2, 0.08, 1.7, 0.08, wood);
  k.part('box', 0, 0, D / 2 - 0.2, W, 0.8, 0.4, wood);
  // a striped awning, sloping to the front
  const n = 5;
  for (let i = 0; i < n; i++) k.part('box', -W / 2 + (i + 0.5) * (W / n), 1.62, 0.05, W / n + 0.01, 0.05, D + 0.5, i % 2 ? '#f4efe4' : c, 0.22);
  // the wares on the counter
  const wares = ['#d8402a', '#e8a23a', '#7fb04a', '#f2d43a', '#8f6ae0', '#3f8fd8'];
  for (let i = 0; i < 5; i++) k.part(i % 2 ? 'ball' : 'box', -W / 2 + 0.3 + i * ((W - 0.6) / 4), 0.8, D / 2 - 0.2, 0.22, 0.2, 0.22, wares[(i + Math.floor(p.v * 6)) % wares.length]);
}

export function lamp(k, p) {
  const c = FURY[p.s] ?? '#3a3a3a';
  k.part('cyl', 0, 0, 0, 0.26, 0.15, 0.26, '#4a4a4a');
  k.part('cyl', 0, 0.15, 0, 0.09, 1.75, 0.09, '#3a3a40');
  k.glow('box', 0, 1.9, 0, 0.26, 0.32, 0.26, LANTERN);
  k.part('pyramid', 0, 2.22, 0, 0.34, 0.24, 0.34, p.s === 'med' ? '#2f2f36' : c);
  k.light(0, 2.05, 0);
}

export function planter(k, p) {
  const stone = p.s === 'med' ? '#c0704a' : '#bdb5a5';
  k.part(p.s === 'med' ? 'taper' : 'box', 0, 0, 0, 0.8, 0.5, 0.8, stone);
  k.part('ball', 0, 0.45, 0, 0.8, 0.75, 0.8, p.s === 'thunder' ? '#3f6a5a' : '#5a8f3a');
  for (let i = 0; i < 3; i++) k.part('ball', Math.cos(i * 2.1) * 0.25, 0.95, Math.sin(i * 2.1) * 0.25, 0.14, 0.14, 0.14, FURY[p.s] ?? '#d84a95');
}

export function crates(k, p) {
  k.part('box', -0.15, 0, -0.1, 0.55, 0.5, 0.55, '#9a7044', 0, p.v);
  k.part('box', 0.2, 0, 0.2, 0.45, 0.42, 0.45, '#8a6038', 0, -p.v);
  k.part('box', -0.1, 0.5, -0.05, 0.4, 0.38, 0.4, '#a87a4a', 0, p.v * 2);
  k.part('cyl', 0.28, 0, -0.28, 0.32, 0.55, 0.32, '#7a5030');
}

/* -------------------------------------------- trees ------------------------------------------- */

export function tree(k, p) {
  const v = p.v, s = 0.85 + v * 0.35;
  switch (p.s) {
    case 'sun': {
      // a palm: a leaning trunk, fronds about its top
      const lean = (v - 0.5) * 0.3;
      k.part('taper', 0, 0, 0, 0.22, 2.6 * s, 0.22, '#8a6a46', lean, 0, lean * 0.5);
      const tx = Math.sin(lean * 0.5) * 2.6 * s, tz = Math.sin(lean) * 2.6 * s, ty = 2.55 * s;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + v * 3;
        k.part('box', tx + Math.cos(a) * 0.55, ty, tz + Math.sin(a) * 0.55, 0.22, 0.05, 1.3, i % 2 ? '#5f8f3a' : '#4f7f32', 0.35, -a + Math.PI / 2, 0);
      }
      k.part('ball', tx, ty - 0.1, tz, 0.3, 0.3, 0.3, '#6a4a2a');
      break;
    }
    case 'rain':
      k.part('taper', 0, 0, 0, 0.24, 1.2 * s, 0.24, '#5a4a3a');
      k.part('ball', 0, 0.9 * s, 0, 1.6 * s, 1.3 * s, 1.6 * s, '#3f7f6a');
      k.part('ball', 0.35, 1.5 * s, 0.2, 0.9 * s, 0.8 * s, 0.9 * s, '#4f8f78');
      break;
    case 'wind':
      k.part('taper', 0, 0, 0, 0.16, 1.4 * s, 0.16, '#dcd6c8');
      k.part('ball', 0, 1.0 * s, 0, 0.9 * s, 2.6 * s, 0.9 * s, '#8fb35a');
      break;
    case 'thunder':
      k.part('taper', 0, 0, 0, 0.2, 0.7 * s, 0.2, '#4a3a30');
      for (let i = 0; i < 3; i++) k.part('cone6', 0, 0.5 * s + i * 0.75 * s, 0, (1.5 - i * 0.35) * s, 1.25 * s, (1.5 - i * 0.35) * s, i % 2 ? '#4f8a6a' : '#3f7a5e');
      break;
    default:
      cypress(k, p);
  }
}

export function cypress(k, p) {
  const s = 0.85 + p.v * 0.4;
  k.part('taper', 0, 0, 0, 0.18, 0.5, 0.18, '#5a4632');
  k.part('ball', 0, 0.3, 0, 0.75 * s, 3.6 * s, 0.75 * s, '#2f5a35');
  k.part('ball', 0.05, 1.6 * s, 0.05, 0.55 * s, 2.2 * s, 0.55 * s, '#36643c');
}

export function olive(k, p) {
  const s = 0.85 + p.v * 0.3;
  k.part('taper', 0.05, 0, 0, 0.22, 0.9 * s, 0.22, '#6b5a48', 0, 0, 0.25);
  k.part('taper', -0.1, 0.7 * s, 0, 0.16, 0.7 * s, 0.16, '#6b5a48', 0, 0, -0.35);
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + p.v * 4;
    k.part('rock', Math.cos(a) * 0.35, 1.1 * s + (i % 2) * 0.25, Math.sin(a) * 0.35, 1.1 * s, 0.75 * s, 1.1 * s, i % 2 ? '#8a9a6a' : '#7d8f60', 0, a, 0);
  }
}

export function lemon(k, p) {
  const s = 0.8 + p.v * 0.3;
  k.part('taper', 0, 0, 0, 0.16, 0.8 * s, 0.16, '#5a4632');
  k.part('ball', 0, 0.6 * s, 0, 1.25 * s, 1.15 * s, 1.25 * s, '#3f7a35');
  for (let i = 0; i < 4; i++) {
    const a = i * 1.57 + p.v * 3;
    k.part('ball', Math.cos(a) * 0.55 * s, 1.0 * s + (i % 3) * 0.2, Math.sin(a) * 0.55 * s, 0.15, 0.15, 0.15, '#f2d43a');
  }
}

/* ----------------------------------------- landmarks ------------------------------------------ */

export function fountain(k, p) {
  const [cw] = sizeOf(p), R = cw / 2 - 0.25, stone = p.s === 'rain' ? '#b9c9d4' : '#e2dccf';
  k.part('cyl16', 0, 0, 0, R * 2, 0.5, R * 2, stone);
  k.part('cyl16', 0, 0.42, 0, R * 2 - 0.3, 0.06, R * 2 - 0.3, '#4fa0d0');
  k.part('cyl', 0, 0.45, 0, 0.5, 1.1, 0.5, stone);
  k.part('cyl16', 0, 1.45, 0, 1.4, 0.18, 1.4, stone);
  k.part('cyl16', 0, 1.58, 0, 1.2, 0.04, 1.2, '#5ab0e0');
  k.part('cyl', 0, 1.6, 0, 0.25, 0.6, 0.25, stone);
  k.part('ball', 0, 2.15, 0, 0.32, 0.32, 0.32, p.s === 'rain' ? '#3f8fd8' : '#e8d9a8');
  k.mover('jet', 0, 2.4, 0, { size: 1 });
  for (let i = 0; i < 4; i++) k.mover('jet', Math.cos(i * Math.PI / 2 + Math.PI / 4) * (R - 0.4), 0.5, Math.sin(i * Math.PI / 2 + Math.PI / 4) * (R - 0.4), { size: 0.6 });
}

export function sundial(k) {
  k.part('cyl16', 0, 0, 0, 2.8, 0.3, 2.8, '#d9b07a');
  k.part('cyl16', 0, 0.3, 0, 2.2, 0.25, 2.2, '#e8cd9e');
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.part('box', Math.cos(a) * 0.9, 0.55, Math.sin(a) * 0.9, 0.08, 0.04, 0.3, '#a8683a', 0, -a, 0);
  }
  k.part('frustum', 0, 0.55, 0, 0.6, 3.6, 0.6, '#e2c08a');
  k.part('pyramid', 0, 4.15, 0, 0.36, 0.4, 0.36, '#e8b43a');
  k.part('cyl', 0, 3.2, 0.2, 0.95, 0.06, 0.95, '#e8b43a', Math.PI / 2);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.part('ball', Math.cos(a) * 0.72, 3.14 + Math.sin(a) * 0.72, 0.24, 0.13, 0.13, 0.13, '#f2c84a');
  }
  k.glow('cyl', 0, 3.2, 0.26, 0.5, 0.02, 0.5, '#ffd56a', Math.PI / 2);
}

export function windtower(k) {
  k.part('cyl6', 0, 0, 0, 2.3, 0.4, 2.3, '#c9c7ad');
  k.part('taper', 0, 0.4, 0, 1.6, 4.6, 1.6, '#efeedc');
  for (const y of [1.6, 3.0]) k.part('cyl', 0, y, 0, 1.62, 0.16, 1.62, '#7f9a5d');
  k.part('cyl', 0, 4.9, 0, 2.0, 0.14, 2.0, '#7a5a3a');
  solarCone(k, 0, 5.04, 0, 1.4, 1.0, 'wind');
  k.part('cyl', 0, 6.0, 0, 0.08, 0.8, 0.08, '#5a4a3a');
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    k.part('box', Math.cos(a) * 0.95, 4.6, Math.sin(a) * 0.95, 0.05, 0.6, 0.05, '#5a4a3a');
    k.part('box', Math.cos(a) * 0.95 + 0.18, 5.0, Math.sin(a) * 0.95, 0.34, 0.2, 0.02, FURY.wind, 0, -a, 0);
  }
  k.glow('box', 0, 3.4, 0.79, 0.3, 0.4, 0.05, '#fff0b0');
  k.mover('vane', 0, 6.65, 0, { arms: 4, length: 1.1, hex: '#efeedc', axis: 'y' });
}

export function coil(k) {
  k.part('box', 0, 0, 0, 2.7, 0.45, 2.7, '#4a4e5e');
  k.part('box', 0, 0.45, 0, 2.0, 0.4, 2.0, '#5b6072');
  k.part('cyl', 0, 0.85, 0, 0.5, 3.6, 0.5, '#8a93a8');
  for (let i = 0; i < 5; i++) k.part('cyl16', 0, 1.2 + i * 0.6, 0, 1.3 - i * 0.12, 0.1, 1.3 - i * 0.12, '#7f6ad8');
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    k.part('cyl', sx * 0.85, 0.85, sz * 0.85, 0.12, 1.4, 0.12, '#9aa3b5');
    k.glow('ball', sx * 0.85, 2.25, sz * 0.85, 0.2, 0.2, 0.2, '#c9a8ff');
  }
  k.glow('ball', 0, 4.4, 0, 0.9, 0.9, 0.9, '#b89cff');
  k.mover('sparks', 0, 4.85, 0, { hex: '#d8c8ff' });
  k.light(0, 4.85, 0, '#b89cff');
}

export function spire(k, p) {
  const c = FURY[p.s] ?? FURY.concord;
  k.part('box', 0, 0, 0, 0.75, 0.4, 0.75, '#ece8dc');
  k.part('box', 0, 0.4, 0, 0.6, 0.1, 0.6, '#d8c07a');
  k.glow('cone6', 0, 0.5, 0, 0.42, 2.4, 0.42, c);
  k.light(0, 1.6, 0, c);
}

export function concord(k) {
  const marble = '#ece8dc', gold = '#d8b860';
  k.part('cyl16', 0, 0, 0, 6.8, 0.35, 6.8, '#ddd7c8');
  k.part('cyl16', 0, 0.35, 0, 5.8, 0.35, 5.8, marble);
  k.part('cyl16', 0, 0.7, 0, 4.8, 0.35, 4.8, marble);
  k.part('cyl16', 0, 1.04, 0, 4.9, 0.03, 4.9, gold);
  // stairs up on the four sides
  for (let s = 0; s < 4; s++) {
    const a = (s * Math.PI) / 2;
    for (let i = 0; i < 3; i++) k.part('box', Math.sin(a) * (3.2 - i * 0.5), i * 0.35, Math.cos(a) * (3.2 - i * 0.5), s % 2 ? 0.5 : 1.6, 0.35, s % 2 ? 1.6 : 0.5, marble);
  }
  // the cella, its ring of columns, the entablature and the gilded dome with its lantern
  k.part('cyl16', 0, 1.05, 0, 2.6, 2.2, 2.6, '#e6dcc0');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    k.part('cyl', Math.cos(a) * 1.9, 1.05, Math.sin(a) * 1.9, 0.34, 2.2, 0.34, marble);
  }
  k.part('cyl16', 0, 3.25, 0, 4.4, 0.35, 4.4, marble);
  k.part('cyl16', 0, 3.6, 0, 4.0, 0.1, 4.0, gold);
  // (its dome all solar cells between ribs of gold)
  solarDome(k, 0, 3.7, 0, 3.6, 3.0, 3.6, 'sun', 16, gold);
  k.part('cyl', 0, 5.15, 0, 0.6, 0.5, 0.6, marble);
  k.part('cone', 0, 5.65, 0, 0.7, 0.6, 0.7, gold);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    k.glow('box', Math.cos(a) * 1.31, 1.6, Math.sin(a) * 1.31, 0.35, 0.9, 0.35, '#ffe2a0', 0, -a, 0);
  }
  // the four Furies' spires at the corners: Thunder north-west... each by its quarter
  const fury = [['thunder', -1, -1], ['sun', 1, -1], ['rain', 1, 1], ['wind', -1, 1]];
  for (const [f, sx, sz] of fury) {
    k.part('box', sx * 2.85, 0, sz * 2.85, 0.8, 0.5, 0.8, marble);
    k.glow('cone6', sx * 2.85, 0.5, sz * 2.85, 0.5, 3.4, 0.5, FURY[f]);
    k.light(sx * 2.85, 2.5, sz * 2.85, FURY[f]);
  }
  k.mover('orb', 0, 7.4, 0, {});
}

/* ------------------------------------------ Altamar ------------------------------------------- */

export function windmill(k) {
  k.part('taper', 0, 0, 0, 2.5, 3.4, 2.5, '#f6f4ee');
  k.part('cyl', 0, 0, 0, 2.6, 0.25, 2.6, '#e2dccf');
  solarCone(k, 0, 3.35, 0, 2.3, 1.3, 'med');
  k.part('box', 0, 0, 1.2, 0.55, 1.0, 0.1, '#2f68b8');
  k.glow('box', 0, 2.0, 1.12, 0.3, 0.38, 0.06, '#ffd88a');
  k.part('cyl', 0, 3.25, 1.05, 0.22, 0.5, 0.22, '#5a4632', Math.PI / 2);
  k.mover('sails', 0, 3.25, 1.35, { arms: 6, length: 2.1, hex: '#f2efe6', axis: 'z' });
}

export function hall(k) {
  const white = '#f6f4ee', stone = '#e6e0d2', [W, D] = [8.6, 6.6];
  k.part('box', 0, 0, 0, W, 0.5, D, stone);
  for (let i = 0; i < 3; i++) k.part('box', 0, i * 0.17, D / 2 + 0.25 - i * 0.18, 4.2, 0.17, 0.55, stone);
  k.part('box', 0, 0.5, -0.4, 6.2, 3.2, 5.0, white);
  k.part('box', 0, 3.7, -0.4, 6.4, 0.2, 5.2, stone);
  // the drum and the great blue dome, its lantern
  k.part('cyl16', 0, 3.9, -0.4, 3.9, 1.1, 3.9, white);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    k.part('box', Math.cos(a) * 1.94, 4.15, -0.4 + Math.sin(a) * 1.94, 0.22, 0.6, 0.22, WINDOW, 0, -a, 0);
  }
  solarDome(k, 0, 5.0, -0.4, 4.0, 3.6, 4.0, 'med', 16);
  k.part('cyl', 0, 6.75, -0.4, 0.7, 0.6, 0.7, white);
  solarDome(k, 0, 7.35, -0.4, 0.75, 0.6, 0.75, 'med', 6);
  k.part('ball', 0, 7.7, -0.4, 0.2, 0.2, 0.2, '#e8c860');
  // a small dome on each corner of the roof
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.part('cyl', sx * 2.5, 3.9, -0.4 + sz * 1.9, 1.0, 0.45, 1.0, white);
    solarDome(k, sx * 2.5, 4.35, -0.4 + sz * 1.9, 1.05, 0.9, 1.05, 'med', 6);
  }
  // the portico: six columns, a roof and a pediment, the door and a round window over it
  for (let i = 0; i < 6; i++) k.part('cyl', -2.5 + i, 0.5, 2.85, 0.32, 2.6, 0.32, white);
  k.part('box', 0, 3.1, 2.4, 6.0, 0.3, 1.4, stone);
  solarGable(k, 0, 3.4, 2.4, 1.5, 0.9, 6.2, 'med', white, Math.PI / 2);
  k.part('box', 0, 0.5, 2.11, 1.2, 1.9, 0.06, '#5a3a24');
  k.glow('cyl16', 0, 2.75, 2.12, 0.9, 0.04, 0.9, '#ffd88a', Math.PI / 2);
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) k.glow('box', sx * 3.11, 1.3, -2.2 + i * 1.5, 0.05, 1.1, 0.42, '#ffd88a');
  k.light(-1.6, 1.4, 3.3);
  k.light(1.6, 1.4, 3.3);
}

export function belltower(k) {
  const white = '#f6f4ee';
  k.part('box', 0, 0, 0, 1.7, 5.3, 1.7, white);
  k.part('box', 0, 5.3, 0, 1.9, 0.16, 1.9, '#e2dccf');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.part('box', sx * 0.72, 5.46, sz * 0.72, 0.3, 1.2, 0.3, white);
  k.part('box', 0, 6.66, 0, 1.9, 0.16, 1.9, '#e2dccf');
  k.part('cone', 0, 5.7, 0, 0.7, 0.75, 0.7, '#c9a040');
  solarDome(k, 0, 6.82, 0, 1.3, 1.1, 1.3, 'med', 8);
  k.part('cyl', 0, 4.25, 0.86, 0.7, 0.04, 0.7, '#f8f4e8', Math.PI / 2);
  k.part('box', 0.12, 4.4, 0.89, 0.04, 0.28, 0.02, '#2a2a2a', 0, 0, -0.6);
  k.part('box', 0, 0, 0.86, 0.5, 0.95, 0.05, '#2f68b8');
}

export function warehouse(k, p) {
  const [cw, cd] = sizeOf(p), W = cw - 0.25, D = cd - 0.25, wall = pick(['#f1ece2', '#ece4d2', '#f4f0e6'], p.v);
  k.part('box', 0, 0, 0, W, 2.2, D, wall);
  solarGable(k, 0, 2.2, 0, D + 0.3, 1.2, W + 0.3, 'med', wall, Math.PI / 2);
  k.part('box', 0, 0, D / 2, 1.6, 1.7, 0.08, '#5a3a24');
  k.part('cyl16', 0, 1.7, D / 2, 1.6, 0.08, 1.0, '#5a3a24', Math.PI / 2);
  for (const sx of [-1, 1]) k.glow('box', sx * (W / 2 - 0.9), 1.2, D / 2 + 0.01, 0.4, 0.45, 0.04, '#ffd88a');
  for (let i = 0; i < 3; i++) k.part('box', -W / 2 + 0.5 + i * 0.55, 0, D / 2 + 0.5, 0.45, 0.45, 0.45, '#9a7044', 0, i * 0.4, 0);
  k.light(W / 2 - 0.4, 1.8, D / 2 + 0.2);
}

export function pergola(k) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.part('cyl', sx * 2.1, 0, sz * 2.1, 0.24, 2.3, 0.24, '#f4f0e6');
  for (const sz of [-1, 1]) k.part('box', 0, 2.3, sz * 2.1, 4.7, 0.16, 0.16, '#8a6a44');
  for (let i = 0; i < 7; i++) k.part('box', -2.1 + i * 0.7, 2.46, 0, 0.1, 0.1, 4.7, '#8a6a44');
  for (let i = 0; i < 14; i++) {
    const a = i * 2.39, r = 0.6 + (i % 5) * 0.35;
    k.part('ball', Math.cos(a) * r, 2.45, Math.sin(a) * r, 1.0, 0.45, 1.0, i % 3 ? '#4f8f3a' : '#c2307a');
  }
  for (const sx of [-1, 1]) k.part('box', sx * 1.4, 0, 0, 0.45, 0.42, 1.5, '#c0a070');
  k.part('cyl16', 0, 0, 0, 0.9, 0.5, 0.9, '#c0704a');
  k.part('ball', 0, 0.45, 0, 0.8, 0.6, 0.8, '#d84a95');
}

/** A wooden pier out over the sky, `long` cells out from the rim (its frame's front). */
export function pier(k, p, long = 5.5) {
  const [cw] = sizeOf(p), W = cw - 0.2, wood = '#8a6440';
  for (let i = 0; i < Math.round(long * 2.5); i++) k.part('box', 0, -0.12, -0.45 + i * 0.4 + 0.2, W, 0.12, 0.36, i % 2 ? wood : '#7a5638');
  for (const sx of [-1, 1]) {
    k.part('box', (sx * W) / 2, 0, long / 2 - 0.5, 0.08, 0.7, long, '#6a4a30');
    for (let i = 0; i <= long; i += 2) k.part('cyl', (sx * W) / 2, -1.6, -0.3 + i, 0.18, 1.6, 0.18, '#5a3c26');
  }
  k.part('cyl', 0, 0, long - 0.7, 0.3, 0.9, 0.3, '#5a3c26');
  k.glow('box', (W / 2) - 0.05, 0.75, long - 0.6, 0.22, 0.28, 0.22, LANTERN);
  k.light(W / 2 - 0.05, 0.9, long - 0.6);
}

/** What each kind of prop is drawn with. */
export const BUILD = {
  house, stall, lamp, planter, crates, tree, cypress, olive, lemon, fountain, sundial, windtower, coil, spire, concord,
  windmill, hall, belltower, warehouse, pergola,
  pier: (k, p) => pier(k, p, 5.5),
  dock: (k, p) => pier(k, p, 5),
};

/* ------------------------------------- rims and hanging gardens -------------------------------- */

/** A low wall along the edge of a cell, and in Altamar's gardens vines hanging over it. */
export function rim(k, med, v, vines) {
  // in the frame of the edge: its middle at the origin, z out over the sky
  k.part('box', 0, 0, -0.08, 1.02, 0.42, 0.16, med ? '#f4f0e6' : '#bdb6a6');
  k.part('box', 0, 0.42, -0.08, 1.06, 0.07, 0.22, med ? '#c0704a' : '#a59e8e');
  if (vines && v < 0.3) {
    // a clump over the wall, and two or three strands hanging from it, leaves along them and now
    // and then a flower
    const x = (v / 0.3 - 0.5) * 0.5;
    k.part('ball', x, 0.36, 0.06, 0.48, 0.3, 0.3, '#4f8f3a');
    const strands = 2 + Math.floor(((v * 13) % 1) * 2);
    for (let i = 0; i < strands; i++) {
      const h = (v * (31 + i * 17)) % 1, long = 0.7 + h * 2.4, sx = x + (i - (strands - 1) / 2) * 0.2;
      k.part('box', sx, -long, 0.1, 0.05, long + 0.4, 0.05, '#3f6f2e');
      for (let j = 0; j * 0.75 < long; j++) {
        const flower = (j + i) % 3 === 2;
        k.part('ball', sx + ((j % 2) - 0.5) * 0.08, -0.15 - j * 0.75, 0.13, flower ? 0.18 : 0.24, flower ? 0.18 : 0.2, 0.13, flower ? '#d84a95' : '#5d9142');
      }
    }
  }
}

/** A fountain's jet: a thin column of water, thinning as it rises, rounded at its top. */
export function jet() {
  const b = new Batch(), k = new Kit(b, b, [], []);
  k.part('taper', 0, 0, 0, 0.13, 0.92, 0.13, '#ffffff');
  k.part('ball', 0, 0.85, 0, 0.13, 0.16, 0.13, '#ffffff');
  return b.geometry();
}

/** A townsperson: a body and a head, in the colour of their instance. */
export function person() {
  const b = new Batch(), k = new Kit(b, b, [], []);
  k.part('cone', 0, 0, 0, 0.42, 0.95, 0.42, '#ffffff');
  k.part('ball', 0, 0.92, 0, 0.24, 0.26, 0.24, '#ffffff');
  return b.geometry();
}
