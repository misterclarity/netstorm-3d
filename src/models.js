/**
 * Low-poly stand-ins for every kind of thing on the battlefield, built from three.js primitives.
 * Each builder fills a group whose origin is the middle of the thing's footprint on the ground;
 * `rep` collects what moves (rep.anim) and the parts the unit component needs to reach.
 *
 * Shapes and materials are shared: one geometry per shape and size, one material per colour and
 * finish. Once built, a model is baked (bake()): the parts that never move are merged into a mesh
 * per finish, their colours kept per vertex, and that merged geometry is shared by every model
 * with the same key. A Temple is then a handful of draw calls instead of thirty, and nothing a
 * unit's model holds on the GPU has to be freed when the unit is gone.
 */
import { THREE, defs, ART, OWNER_COLOR, FURY_COLOR, FACING_YAW, hash } from './state.js';

const matCache = new Map();
export function mat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!matCache.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...extra });
    // a plain finish (no glow of its own) can be merged with others of the same finish
    m.userData = { finish: 'emissive' in extra ? null : JSON.stringify(extra) };
    matCache.set(key, m);
  }
  return matCache.get(key);
}
export const glow = (c, e, i) => mat(c, { emissive: e, emissiveIntensity: i, roughness: 0.3 });

export function part(group, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

/** A part that moves on its own (turns, bobs, pulses): bake() leaves it as it is. */
function moving(mesh) {
  mesh.userData.moves = true;
  return mesh;
}

const geoCache = new Map();
/** One geometry per shape and size, shared by every model; never disposed. */
function shape(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
export const box = (x, y, z) => shape(`box${x},${y},${z}`, () => new THREE.BoxGeometry(x, y, z));
const cyl = (a, b, h, n = 8) => shape(`cyl${a},${b},${h},${n}`, () => new THREE.CylinderGeometry(a, b, h, n));
const cone = (r, h, n = 6) => shape(`cone${r},${h},${n}`, () => new THREE.ConeGeometry(r, h, n));
const sph = (r, w = 10, h = 8) => shape(`sph${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
const dome = (r) => shape(`dome${r}`, () => new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2));
export const ico = (r, d = 0) => shape(`ico${r},${d}`, () => new THREE.IcosahedronGeometry(r, d));
const octa = (r) => shape(`octa${r}`, () => new THREE.OctahedronGeometry(r, 0));
const dodeca = (r) => shape(`dodeca${r}`, () => new THREE.DodecahedronGeometry(r, 0));
const plane = (w, h) => shape(`plane${w},${h}`, () => new THREE.PlaneGeometry(w, h));

/**
 * The geysers' steam: white, see-through, each instance as opaque as its instance colour's red
 * (instanced meshes have a colour per instance but no opacity per instance).
 */
let steamMat = null;
function steamMaterial() {
  if (!steamMat) {
    steamMat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, depthWrite: false, flatShading: true });
    steamMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#ifdef USE_COLOR\n  diffuseColor.a *= vColor.r;\n#endif');
    };
    steamMat.customProgramCacheKey = () => 'ns-steam';
  }
  return steamMat;
}

/* ------------------------------------------ baking ------------------------------------------ */
const bakeCache = new Map();

/** `meshes` as one geometry in their group's space; with `colors`, each one's colour per vertex. */
function merge(meshes, colors) {
  const parts = meshes.map((m) => {
    m.updateMatrix();
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
    return { g, c: m.material.color };
  });
  const count = parts.reduce((n, p) => n + p.g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = colors ? new Float32Array(count * 3) : null;
  let o = 0;
  for (const { g, c } of parts) {
    const k = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (col) for (let i = o; i < o + k; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    o += k;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/**
 * Merge the parts of a built model that do not move: in each of its groups, one mesh per finish
 * (plain parts of any colour together, coloured per vertex; each glow on its own). Models with the
 * same `key` are built the same, so the merged geometries are made once and shared.
 */
export function bake(root, key) {
  let n = 0;
  const visit = (group) => {
    const id = `${key}#${n++}`, kids = [...group.children];
    const still = kids.filter((c) => c.isMesh && !c.userData.moves);
    if (still.length > 1) {
      let merged = bakeCache.get(id);
      if (!merged) {
        const sets = new Map();
        for (const m of still) {
          const finish = m.material.userData?.finish;
          const k = finish != null ? `plain${finish}` : m.material.uuid;
          if (!sets.has(k)) {
            const material = finish != null ? mat('#ffffff', { ...JSON.parse(finish), vertexColors: true }) : m.material;
            sets.set(k, { material, meshes: [], colors: finish != null });
          }
          sets.get(k).meshes.push(m);
        }
        merged = [...sets.values()].map((set) => ({ material: set.material, geometry: merge(set.meshes, set.colors) }));
        bakeCache.set(id, merged);
      }
      for (const m of still) group.remove(m);
      for (const { material, geometry } of merged) part(group, geometry, material);
    }
    for (const c of kids) if (!c.isMesh && c.isObject3D) visit(c);
  };
  visit(root);
  return root;
}

/* ---------------------------------------- the Furies ---------------------------------------- */
/** Each Fury's look: its stone, a darker stone, roofs, trim, an accent and its glow. */
const FURY = {
  sun: { stone: '#dccaa0', dark: '#a8916a', roof: '#c4703a', trim: '#d9a63a', accent: '#5fb7ad', yard: '#c9b48d', glow: ['#ffe48a', '#ffb000'] },
  wind: { stone: '#cdb08a', dark: '#87603f', roof: '#6f9f72', trim: '#efe6cf', accent: '#9bcf6a', yard: '#b9a27c', glow: ['#fff3c0', '#ffd24a'] },
  rain: { stone: '#9aaebf', dark: '#5e7286', roof: '#3d7db2', trim: '#e3f1f7', accent: '#5cc0ea', yard: '#a9b9c6', glow: ['#c8f2ff', '#29a8ff'] },
  thunder: { stone: '#625b72', dark: '#3a3443', roof: '#5d4690', trim: '#c27a3e', accent: '#a184ea', yard: '#6e6879', glow: ['#e6d2ff', '#9a5cff'] },
  fire: { stone: '#8c4f3c', dark: '#4b2b23', roof: '#c4442a', trim: '#e8a040', accent: '#ff8a3a', yard: '#7a4a3a', glow: ['#ffd08a', '#ff5a1a'] },
};

/** The Fury a thing belongs to (the Fire Temple and Fire Ant have none in the unit data). */
function furyOf(e) {
  return defs.get(e?.type)?.theme ?? (e?.type?.startsWith('fire') ? 'fire' : 'sun');
}

/** A Fury's materials. */
function kit(e) {
  const k = FURY[furyOf(e)] ?? FURY.sun;
  return {
    k,
    stone: mat(k.stone), dark: mat(k.dark), roof: mat(k.roof), accent: mat(k.accent), yard: mat(k.yard),
    trim: mat(k.trim, { metalness: 0.35, roughness: 0.45 }),
    glow: glow(k.glow[0], k.glow[1], 0.9),
  };
}
const team = (rep) => mat(OWNER_COLOR[rep.owner] ?? '#cccccc');
const metal = (c) => mat(c, { metalness: 0.55, roughness: 0.35 });
const see = (c, opacity, extra = {}) => mat(c, { transparent: true, opacity, depthWrite: false, ...extra });

/** A ridge roof 1 wide (x), 1 high and 1 long (z), standing on y = 0; scaled to fit. */
const gable = () => shape('gable', () => {
  const v = [
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, -0.5, -0.5, 0, -0.5, 0, 1, -0.5,
    -0.5, 0, -0.5, -0.5, 0, 0.5, 0, 1, 0.5, -0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5,
    0.5, 0, 0.5, 0.5, 0, -0.5, 0, 1, -0.5, 0.5, 0, 0.5, 0, 1, -0.5, 0, 1, 0.5,
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
});
/** A square pyramid 1 across and 1 high, its base on y = 0 and its sides along x and z. */
const pyramid = () => shape('pyramid', () => new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0));
const ring = (r, t, n = 20) => shape(`ring${r},${t},${n}`, () => new THREE.TorusGeometry(r, t, 5, n));

/** A ridge roof `w` × `l` (ridge along z), `h` high, its eaves at y. */
function roof(g, material, w, h, l, x, y, z, turn = 0) {
  const r = part(g, gable(), material, x, y, z);
  r.scale.set(w, h, l);
  r.rotation.y = turn;
  return r;
}
/** A group inside `g` at (x, y, z), for parts that move together. */
function holder(g, x = 0, y = 0, z = 0) {
  const h = new THREE.Group();
  h.position.set(x, y, z);
  g.add(h);
  return h;
}
/** Turn `obj` about `axis` at `speed` radians a second, from `phase`. */
function spin(rep, obj, axis, speed, phase = 0) {
  rep.anim.push((s) => { obj.rotation[axis] = phase + s * speed; });
  return obj;
}
/** A glowing part that pulses: a material of its own, freed with the unit. */
function pulsing(rep, mesh, low = 0.5, high = 1.4, rate = 3) {
  mesh.material = mesh.material.clone();
  rep.own.push(mesh.material);
  moving(mesh);
  rep.anim.push((s) => { mesh.material.emissiveIntensity = low + (high - low) * (0.5 + 0.5 * Math.sin(s * rate + rep.id)); });
  return mesh;
}
/** The owner's banner on a pole of height h at (x, z). */
function banner(rep, g, x, z, h, size = 1) {
  part(g, cyl(0.05 * size, 0.06 * size, h, 6), mat('#e8e4da'), x, h / 2, z);
  part(g, sph(0.09 * size, 6, 4), metal('#d9a63a'), x, h + 0.05, z);
  const cloth = moving(part(g, plane(1.1 * size, 0.65 * size), mat(OWNER_COLOR[rep.owner] ?? '#ccc', { side: THREE.DoubleSide }), x + 0.55 * size, h - 0.38 * size, z));
  rep.anim.push((s) => { cloth.rotation.y = Math.sin(s * 2.2 + rep.id) * 0.25; });
}
/** A thin ring of the owner's colour round a base of radius r, at height y. */
function band(rep, g, r, y, segments = 12) {
  part(g, ring(r, 0.065, Math.max(segments, 12)), team(rep), 0, y, 0).rotation.x = Math.PI / 2;
}

export const MODELS = {
  /* ---------------------------------------- Temples ----------------------------------------- */
  temple(rep, g, e) {
    const f = furyOf(e), p = kit(e), w = (e.fx ?? 8) * 0.46, d = (e.fy ?? 6) * 0.46;
    if (f === 'wind') return MODELS.windTemple(rep, g, p, w, d);
    // a two-step oval plinth
    part(g, cyl(1, 1.06, 0.5, 18), p.dark, 0, 0.25, 0).scale.set(w, 1, d);
    part(g, cyl(0.86, 0.9, 0.4, 18), p.stone, 0, 0.7, 0).scale.set(w, 1, d);
    if (f === 'thunder') {
      // a ziggurat of dark stone with copper ledges, a crystal on top and rods at its corners
      for (let i = 0; i < 3; i++) {
        const s = 1 - i * 0.27;
        part(g, box(w * 1.3 * s, 0.75, d * 1.3 * s), i % 2 ? p.stone : p.dark, 0, 1.25 + i * 0.75, 0);
        part(g, box(w * 1.3 * s + 0.08, 0.08, d * 1.3 * s + 0.08), p.trim, 0, 1.64 + i * 0.75, 0);
      }
      const crystal = pulsing(rep, part(g, octa(0.6), p.glow, 0, 4.4, 0), 0.6, 1.6, 2.4);
      crystal.scale.set(0.8, 1.8, 0.8);
      spin(rep, crystal, 'y', 0.5);
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        part(g, cyl(0.06, 0.1, 2.2, 6), p.trim, x * w * 0.78, 2.0, z * d * 0.72);
        part(g, ico(0.16), p.glow, x * w * 0.78, 3.15, z * d * 0.72);
      }
    } else if (f === 'fire') {
      // a brazier on a dais of red stone, ringed by obsidian spikes
      part(g, cyl(1.2, 1.5, 0.9, 8), p.dark, 0, 1.35, 0);
      part(g, cyl(1.1, 0.7, 0.6, 10), p.trim, 0, 2.1, 0);
      const flame = moving(part(g, cone(0.75, 1.8, 7), glow('#ffb347', '#ff5a1a', 1.4), 0, 3.2, 0));
      rep.anim.push((s) => { flame.scale.set(1 + Math.sin(s * 7) * 0.08, 1 + Math.sin(s * 5.3 + 1) * 0.15, 1 + Math.cos(s * 6.1) * 0.08); flame.rotation.y = s * 1.5; });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        part(g, cone(0.3, 1.9, 4), mat('#2a1d1d'), Math.cos(a) * w * 0.72, 1.85, Math.sin(a) * d * 0.72).rotation.set(Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2);
      }
    } else if (f === 'rain') {
      // a pool round a three-roofed pagoda, ice crystals on columns about it
      part(g, cyl(0.7, 0.7, 0.1, 24), glow('#7dd6ec', '#1d7690', 0.45), 0, 0.93, 0).scale.set(w, 1, d);
      for (const [r, h, y, rr] of [[0.95, 1.0, 1.45, 1.75], [0.7, 0.8, 2.6, 1.35], [0.45, 0.65, 3.55, 0.95]]) {
        part(g, cyl(r * 0.85, r, h, 8), p.stone, 0, y, 0);
        part(g, cone(rr, 0.55, 8), p.roof, 0, y + h / 2 + 0.25, 0);
      }
      const drop = moving(part(g, octa(0.32), p.glow, 0, 4.6, 0));
      drop.scale.y = 1.6;
      rep.anim.push((s) => { drop.rotation.y = s * 0.8; drop.position.y = 4.6 + Math.sin(s * 1.6) * 0.12; });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6, x = Math.cos(a) * w * 0.82, z = Math.sin(a) * d * 0.82;
        part(g, cyl(0.17, 0.22, 1.5, 6), p.trim, x, 1.65, z);
        part(g, octa(0.26), glow('#c8f2ff', '#29a8ff', 0.8), x, 2.6, z).scale.y = 1.5;
      }
    } else {
      // the Sun's: a pool round a stepped pyramid that holds up a turning sun
      part(g, cyl(0.7, 0.7, 0.1, 24), glow('#ffd88a', '#e8a33a', 0.35), 0, 0.93, 0).scale.set(w, 1, d);
      part(g, box(2.6, 0.6, 2.2), p.stone, 0, 1.25, 0);
      part(g, box(1.8, 0.6, 1.5), p.dark, 0, 1.85, 0);
      part(g, box(1.0, 0.5, 0.9), p.stone, 0, 2.4, 0);
      const sun = spin(rep, holder(g, 0, 3.4, 0), 'y', 0.6);
      part(sun, cyl(0.55, 0.55, 0.14, 16), p.glow).rotation.x = Math.PI / 2;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        part(sun, cone(0.13, 0.45, 4), p.trim, Math.cos(a) * 0.8, Math.sin(a) * 0.8, 0).rotation.z = a - Math.PI / 2;
      }
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, x = Math.cos(a) * w * 0.82, z = Math.sin(a) * d * 0.82;
        part(g, cyl(0.18, 0.24, 1.6, 6), p.stone, x, 1.7, z);
        part(g, cone(0.22, 0.4, 6), p.trim, x, 2.7, z);
      }
    }
    banner(rep, g, -w * 0.86, -d * 0.6, 4.6);
  },
  windTemple(rep, g, p, w, d) {
    // a timber deck under a crown of tall spires, pennants on the tallest, a slow ring of vanes
    part(g, cyl(1, 1.08, 0.8, 9), mat('#8d6a4a'), 0, 0.4, 0).scale.set(w * 0.9, 1, d * 0.95);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const plank = part(g, box(1.7, 1.5, 0.28), mat(i % 2 ? '#b07a52' : '#c9a57c'), Math.cos(a) * w * 0.62, 1.3, Math.sin(a) * d * 0.62);
      plank.rotation.set(0, -a + Math.PI / 2, 0);
      plank.rotateX(-0.35);
    }
    for (const [x, z, h, r] of [[-1.2, -0.6, 7.5, 0.42], [-0.3, -1.0, 9, 0.48], [0.7, -0.7, 8, 0.44], [1.5, -0.2, 6.2, 0.36], [-1.9, 0.2, 5.4, 0.34]]) {
      const s = part(g, cone(r, h, 6), mat('#d6b98e'), x, 0.8 + h / 2, z);
      s.rotation.z = -x * 0.03;
      s.rotation.x = z * 0.04;
    }
    const vanes = spin(rep, holder(g, 0, 2.6, 0), 'y', 0.35);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      part(vanes, box(0.08, 0.9, 1.0), mat('#efe6cf'), Math.cos(a) * 2.2, 0, Math.sin(a) * 2.2).rotation.y = -a;
    }
    for (const [x, z] of [[-3, 1.4], [3.1, 1.2], [2.6, -1.7], [-2.7, -1.6]]) part(g, ico(0.65), mat('#4f7d36'), x, 0.7, z);
    banner(rep, g, -0.3, -1.0, 9.6, 1.2);
  },

  /* --------------------------------------- Workshops ---------------------------------------- */
  workshop(rep, g, e) {
    const d = defs.get(e.type), f = furyOf(e), p = kit(e);
    const w = (e.fx ?? d?.footX ?? 7) * 0.92, h = (e.fy ?? d?.footY ?? 6) * 0.92;
    part(g, box(w, 0.3, h), p.dark, 0, 0.15, 0);
    part(g, box(w * 0.96, 0.06, h * 0.96), p.yard, 0, 0.33, 0);
    if (e.type === 'outpost') MODELS.outpost(rep, g, p, w, h);
    else if (e.type === 'guildfactory') {
      // a guild hall: a long hall with a bell tower, a banner of each Fury over the door
      part(g, box(w * 0.7, 2.0, h * 0.5), p.stone, -w * 0.05, 1.35, -h * 0.1);
      roof(g, p.roof, h * 0.56, 1.1, w * 0.75, -w * 0.05, 2.35, -h * 0.1, Math.PI / 2);
      part(g, box(0.9, 3.6, 0.9), p.dark, w * 0.32, 2.1, -h * 0.25);
      part(g, pyramid(), p.roof, w * 0.32, 3.9, -h * 0.25).scale.set(1.2, 1.1, 1.2);
      ['#e8b04a', '#59b3e6', '#8cc05a', '#a184ea'].forEach((c, i) => part(g, box(0.4, 0.9, 0.04), mat(c), -w * 0.3 + i * 0.5, 1.6, h * 0.16));
    } else if (f === 'wind') {
      // a timber barn and a windmill whose sails turn
      part(g, box(w * 0.5, 1.8, h * 0.5), p.stone, -w * 0.17, 1.25, -h * 0.1);
      part(g, box(w * 0.52, 0.12, h * 0.52), p.dark, -w * 0.17, 0.4, -h * 0.1);
      roof(g, p.roof, w * 0.56, 1.3, h * 0.56, -w * 0.17, 2.15, -h * 0.1);
      part(g, box(0.9, 1.1, 0.06), p.dark, -w * 0.17, 0.9, h * 0.16);
      part(g, cyl(0.6, 0.95, 3.6, 8), mat('#efe6cf'), w * 0.27, 2.1, -h * 0.12);
      part(g, cone(0.85, 0.9, 8), p.roof, w * 0.27, 4.35, -h * 0.12);
      const sails = spin(rep, holder(g, w * 0.27, 3.6, -h * 0.12 + 0.75), 'z', 0.9);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2, spar = part(sails, box(0.1, 2.0, 0.08), p.dark), sail = part(sails, box(0.5, 1.5, 0.03), mat('#f3ecd8'));
        spar.rotation.z = a;
        spar.translateY(1.0);
        sail.rotation.z = a;
        sail.translateY(1.15);
        sail.translateX(0.3);
        sail.translateZ(0.03);
      }
      for (const [x, z] of [[-w * 0.42, h * 0.32], [-w * 0.32, h * 0.38]]) part(g, cyl(0.28, 0.28, 0.5, 8), mat('#e2c56a'), x, 0.6, z).rotation.z = Math.PI / 2;
    } else if (f === 'rain') {
      // a hall of blue stone, its water wheel turning in a channel, a round cistern
      part(g, box(w * 0.55, 2.0, h * 0.48), p.stone, -w * 0.08, 1.35, -h * 0.15);
      roof(g, p.roof, h * 0.54, 1.0, w * 0.6, -w * 0.08, 2.35, -h * 0.15, Math.PI / 2);
      part(g, box(0.5, 0.2, h * 0.7), p.dark, -w * 0.4, 0.42, 0);
      part(g, box(0.36, 0.06, h * 0.68), glow('#7dd6ec', '#1d7690', 0.5), -w * 0.4, 0.5, 0);
      const wheel = spin(rep, holder(g, -w * 0.4, 1.25, -h * 0.05), 'x', 0.8);
      part(wheel, ring(0.85, 0.07, 16), p.dark).rotation.y = Math.PI / 2;
      for (let i = 0; i < 8; i++) part(wheel, box(0.28, 0.08, 1.7), p.trim).rotation.x = (i / 8) * Math.PI;
      part(g, cyl(0.85, 0.95, 2.2, 12), p.trim, w * 0.3, 1.45, -h * 0.12);
      part(g, cyl(0.75, 0.75, 0.06, 12), glow('#7dd6ec', '#1d7690', 0.5), w * 0.3, 2.58, -h * 0.12);
      part(g, ring(0.88, 0.07, 12), p.roof, w * 0.3, 2.56, -h * 0.12).rotation.x = Math.PI / 2;
    } else if (f === 'thunder') {
      // a forge of dark iron under a saw-tooth roof, a coil tower that crackles, a smokestack
      part(g, box(w * 0.58, 1.9, h * 0.5), p.dark, -w * 0.1, 1.3, -h * 0.14);
      for (let i = 0; i < 3; i++) roof(g, p.roof, w * 0.2, 0.8, h * 0.52, -w * 0.3 + i * w * 0.19, 2.25, -h * 0.14);
      for (let i = 0; i < 3; i++) part(g, box(0.5, 0.5, 0.05), glow('#ffb05a', '#ff6a1a', 0.9), -w * 0.3 + i * w * 0.2, 1.0, h * 0.12);
      part(g, cyl(0.35, 0.5, 3.6, 8), p.stone, w * 0.3, 2.1, -h * 0.15);
      for (let i = 0; i < 4; i++) part(g, ring(0.5 - i * 0.04, 0.08, 14), p.trim, w * 0.3, 1.4 + i * 0.7, -h * 0.15).rotation.x = Math.PI / 2;
      pulsing(rep, part(g, sph(0.42, 10, 8), p.glow, w * 0.3, 4.2, -h * 0.15), 0.5, 1.8, 6);
      part(g, cyl(0.25, 0.32, 2.8, 8), mat('#2c2833'), -w * 0.36, 2.6, -h * 0.3);
    } else {
      // the Sun's: a sandstone hall under a terracotta roof, a domed tower and a chimney
      part(g, box(w * 0.62, 2.0, h * 0.5), mat('#e6dccb'), -w * 0.12, 1.35, -h * 0.18);
      roof(g, p.roof, h * 0.56, 1.2, w * 0.66, -w * 0.12, 2.35, -h * 0.18, Math.PI / 2);
      part(g, cyl(0.8, 0.9, 3.2, 10), mat('#ddd3c0'), w * 0.3, 1.9, -h * 0.12);
      part(g, dome(0.85), p.accent, w * 0.3, 3.5, -h * 0.12);
      part(g, cone(0.12, 0.6, 6), p.trim, w * 0.3, 4.6, -h * 0.12);
      part(g, box(0.3, 1.0, 0.3), mat('#7a6a5a'), -w * 0.35, 3.0, -h * 0.3);
      part(g, box(w * 0.5, 0.05, h * 0.32), mat('#e9e4da'), -w * 0.05, 0.37, h * 0.28);
      for (const [x, z] of [[-w * 0.44, h * 0.4], [w * 0.44, -h * 0.42]]) part(g, cone(0.45, 1.6), mat('#3f6f31'), x, 1.1, z);
    }
    banner(rep, g, w * 0.44, h * 0.38, 3.0, 0.8);
    // a gem per unit in its production slots
    rep.slotsMark = new THREE.Group();
    rep.slotsMark.position.set(-w * 0.45, 0.4, h * 0.45);
    g.add(rep.slotsMark);
  },
  outpost(rep, g, p, w, h) {
    // a stockade of posts round a watchtower
    const posts = [];
    for (let i = 0; i < 9; i++) posts.push([-w * 0.45 + (i / 8) * w * 0.9, -h * 0.45], [-w * 0.45 + (i / 8) * w * 0.9, h * 0.45]);
    for (let i = 1; i < 6; i++) posts.push([-w * 0.45, -h * 0.45 + (i / 6) * h * 0.9], [w * 0.45, -h * 0.45 + (i / 6) * h * 0.9]);
    for (const [x, z] of posts) {
      if (Math.abs(x) < 0.5 && z > 0) continue; // the gate
      part(g, cyl(0.13, 0.15, 1.3, 5), mat('#8a6040'), x, 0.95, z);
      part(g, cone(0.15, 0.25, 5), mat('#8a6040'), x, 1.72, z);
    }
    for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) part(g, box(0.14, 2.8, 0.14), mat('#6f4e33'), x - w * 0.15, 1.7, z - h * 0.1);
    part(g, box(1.4, 0.15, 1.4), mat('#6f4e33'), -w * 0.15, 3.1, -h * 0.1);
    roof(g, p.roof, 1.5, 0.8, 1.5, -w * 0.15, 3.2, -h * 0.1);
    part(g, box(1.6, 0.8, 1.0), p.stone, w * 0.2, 0.75, -h * 0.15);
    roof(g, p.roof, 1.1, 0.5, 1.7, w * 0.2, 1.15, -h * 0.15, Math.PI / 2);
    banner(rep, g, -w * 0.15, -h * 0.1, 4.6);
  },

  altar(rep, g) {
    part(g, cyl(3.2, 3.4, 0.4, 16), mat('#d8c9a8'), 0, 0.2, 0);
    part(g, cyl(2.5, 2.7, 0.25, 16), mat('#c4b38f'), 0, 0.52, 0);
    part(g, cyl(2.2, 2.2, 0.08, 20), mat('#b08d64'), 0, 0.68, 0);
    part(g, ring(2.2, 0.08, 24), metal('#d9a63a'), 0, 0.72, 0).rotation.x = Math.PI / 2;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const s = part(g, cone(0.35, 2.6, 5), mat('#c99a6a'), Math.cos(a) * 2.7, 1.5, Math.sin(a) * 2.7);
      s.rotation.z = Math.cos(a) * 0.35;
      s.rotation.x = -Math.sin(a) * 0.35;
      part(g, sph(0.12, 6, 4), glow('#ffb347', '#ff7a1a', 1), Math.cos(a) * 2.95, 2.75, Math.sin(a) * 2.95);
    }
    part(g, cyl(0.7, 0.5, 0.5, 8), mat('#6d5a48'), 0, 0.95, 0);
    const fire = moving(part(g, ico(0.5), glow('#ffb347', '#ff7a1a', 1.2), 0, 1.45, 0));
    rep.anim.push((s) => { fire.scale.setScalar(0.85 + Math.sin(s * 5) * 0.12); fire.rotation.y = s; });
  },

  /* -------------------------------------- Generators ---------------------------------------- */
  generator(rep, g, e) {
    const f = furyOf(e), p = kit(e);
    part(g, cyl(1.15, 1.28, 0.4, 8), p.dark, 0, 0.2, 0);
    band(rep, g, 1.17, 0.42, 8);
    if (f === 'wind') {
      // a mast with a turbine of three blades
      part(g, cyl(0.1, 0.18, 3.2, 6), mat('#8a6040'), 0, 2.0, 0);
      part(g, box(0.3, 0.3, 0.7), p.dark, 0, 3.6, 0);
      const rotor = spin(rep, holder(g, 0, 3.6, 0.42), 'z', 3, rep.id);
      part(rotor, sph(0.14, 6, 4), p.trim);
      for (let i = 0; i < 3; i++) {
        const blade = part(rotor, box(0.16, 1.3, 0.04), mat('#efe6cf'), 0, 0, 0);
        blade.rotation.z = (i / 3) * Math.PI * 2;
        blade.translateY(0.7);
      }
    } else if (f === 'rain') {
      // a fountain basin under a floating orb of water
      part(g, cyl(0.95, 0.75, 0.55, 12), p.stone, 0, 0.68, 0);
      part(g, cyl(0.82, 0.82, 0.06, 12), glow('#7dd6ec', '#1d7690', 0.5), 0, 0.95, 0);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        part(g, cyl(0.07, 0.09, 1.6, 6), p.trim, Math.cos(a) * 0.8, 1.6, Math.sin(a) * 0.8).rotation.set(-Math.sin(a) * 0.25, 0, Math.cos(a) * 0.25);
      }
      const orb = moving(part(g, sph(0.45, 12, 10), mat('#8fe0ff', { emissive: '#1f9fe0', emissiveIntensity: 0.7, transparent: true, opacity: 0.8 }), 0, 2.2, 0));
      rep.anim.push((s) => { orb.position.y = 2.2 + Math.sin(s * 1.7 + rep.id) * 0.15; orb.scale.set(1, 1 + Math.sin(s * 3) * 0.06, 1); });
    } else if (f === 'thunder') {
      // a tesla coil: copper rings up a dark column, a sphere that crackles
      part(g, cyl(0.3, 0.42, 2.4, 8), p.stone, 0, 1.6, 0);
      for (let i = 0; i < 5; i++) part(g, ring(0.42 - i * 0.04, 0.06, 14), p.trim, 0, 0.9 + i * 0.45, 0).rotation.x = Math.PI / 2;
      pulsing(rep, part(g, sph(0.42, 12, 10), p.glow, 0, 3.15, 0), 0.4, 2.0, 7);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        part(g, cone(0.12, 0.8, 5), p.trim, Math.cos(a) * 0.9, 0.8, Math.sin(a) * 0.9);
      }
    } else {
      // the Sun's: an obelisk that holds up a turning sun disc
      part(g, box(0.55, 2.2, 0.55), p.stone, 0, 1.5, 0);
      part(g, pyramid(), p.trim, 0, 2.6, 0).scale.set(0.6, 0.45, 0.6);
      const disc = spin(rep, holder(g, 0, 2.15, 0.33), 'z', 1.2);
      part(disc, cyl(0.42, 0.42, 0.08, 14), p.glow).rotation.x = Math.PI / 2;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        part(disc, cone(0.08, 0.3, 4), p.trim, Math.cos(a) * 0.58, Math.sin(a) * 0.58, 0).rotation.z = a - Math.PI / 2;
      }
    }
  },

  /* ---------------------------------------- Guns -------------------------------------------- */
  cannon(rep, g, e) {
    const f = furyOf(e), p = kit(e);
    part(g, cyl(1.2, 1.32, 0.35, 10), p.dark, 0, 0.17, 0);
    band(rep, g, 1.22, 0.38, 10);
    const turret = holder(g, 0, 0.42, 0);
    rep.turret = turret;
    turret.rotation.y = FACING_YAW[e.facing ?? 2];
    const barrel = holder(turret, 0, 0.8, 0.95);
    barrel.rotation.x = Math.PI / 2 - 0.25;
    rep.barrel = barrel;
    rep.barrelZ = 0.95;
    if (f === 'rain') {
      // the Ice Cannon: a frosted tank and a barrel of ice
      part(turret, cyl(0.72, 0.85, 0.5, 6), p.stone, 0, 0.25, 0);
      part(turret, sph(0.6, 10, 8), mat('#cfefff', { transparent: true, opacity: 0.75, roughness: 0.2 }), 0, 0.85, -0.2);
      part(barrel, cyl(0.2, 0.3, 2.0, 6), mat('#bfe8f5', { emissive: '#3aa8d8', emissiveIntensity: 0.35, roughness: 0.2 }));
      for (let i = 0; i < 4; i++) part(barrel, cone(0.08, 0.4, 4), mat('#e8f8ff'), Math.cos(i * 1.57) * 0.28, -0.3 + i * 0.3, Math.sin(i * 1.57) * 0.28).rotation.set(Math.sin(i * 1.57) * 0.9, 0, -Math.cos(i * 1.57) * 0.9);
    } else if (f === 'thunder') {
      // the Thunder Cannon: a long dark barrel in copper coils, its mouth aglow
      part(turret, box(1.3, 0.6, 1.3), p.stone, 0, 0.3, 0);
      part(turret, box(0.9, 0.5, 0.9), p.dark, 0, 0.8, -0.1);
      part(barrel, cyl(0.15, 0.22, 2.6, 8), metal('#2c2833'), 0, 0.2, 0);
      for (let i = 0; i < 3; i++) part(barrel, ring(0.24, 0.06, 12), p.trim, 0, -0.5 + i * 0.5, 0).rotation.x = Math.PI / 2;
      part(barrel, sph(0.16, 8, 6), p.glow, 0, 1.5, 0);
    } else {
      // the Sun Cannon: a stout bronze gun with gold bands
      part(turret, cyl(0.75, 0.85, 0.6, 10), mat('#4a4744'), 0, 0.3, 0);
      part(turret, sph(0.55), metal('#8a5a2a'), 0, 0.7, 0);
      part(barrel, cyl(0.22, 0.3, 1.9, 10), metal('#8a5a2a'));
      part(barrel, ring(0.27, 0.06, 12), p.trim, 0, 0.85, 0).rotation.x = Math.PI / 2;
      part(barrel, ring(0.31, 0.06, 12), p.trim, 0, -0.3, 0).rotation.x = Math.PI / 2;
    }
  },
  archer(rep, g, e) {
    const f = furyOf(e), p = kit(e);
    part(g, cyl(1.1, 1.22, 0.45, 10), p.dark, 0, 0.22, 0);
    band(rep, g, 1.12, 0.47, 10);
    const turret = holder(g, 0, 0.5, 0);
    rep.turret = turret;
    turret.rotation.y = FACING_YAW[e.facing ?? 2];
    if (f === 'wind') {
      // the Crossbow: a great bow on a timber stand, drawn, a bolt laid in it
      part(turret, cyl(0.45, 0.55, 0.5, 8), mat('#8a6040'), 0, 0.25, 0);
      part(turret, box(0.5, 0.5, 0.6), mat('#6f4e33'), 0, 0.7, -0.1);
      part(turret, box(0.34, 0.24, 2.4), mat('#a87a50'), 0, 1.05, 0.35);
      for (const s of [-1, 1]) {
        // each arm sweeps out and back from the bow's middle; the string runs from its tip to the nock
        const arm = part(turret, box(1.25, 0.16, 0.16), mat('#5a3d27'), s * 0.6, 1.1, 1.3);
        arm.rotation.y = s * 0.42;
        part(turret, sph(0.08, 6, 4), metal('#c0c0c0'), s * 1.15, 1.1, 1.05);
        const string = part(turret, box(0.035, 0.035, 1.45), mat('#f3ecd8'), s * 0.58, 1.12, 0.48);
        string.rotation.y = -s * 0.98;
      }
      part(turret, cyl(0.05, 0.05, 2.0, 5), mat('#8a6a4a'), 0, 1.2, 0.55).rotation.x = Math.PI / 2;
      part(turret, cone(0.12, 0.38, 4), metal('#c0c0c0'), 0, 1.2, 1.7).rotation.x = Math.PI / 2;
      part(turret, box(0.04, 0.22, 0.25), team(rep), 0, 1.3, -0.4);
    } else {
      // the Disc Thrower: a throwing arm with a golden disc that whirls, a counterweight behind
      part(turret, dome(0.85), mat('#ece6d6'), 0, -0.05, 0);
      part(turret, cyl(0.9, 0.9, 0.12, 16), p.trim, 0, 0.02, 0);
      part(turret, cyl(0.12, 0.16, 1.0, 6), p.dark, 0, 0.75, 0);
      part(turret, box(0.16, 0.16, 1.9), mat('#8a6040'), 0, 1.25, 0.1);
      part(turret, sph(0.28, 8, 6), p.dark, 0, 1.25, -0.8);
      const disc = moving(part(turret, cyl(0.38, 0.38, 0.07, 16), glow('#ffe48a', '#e8a33a', 0.5), 0, 1.25, 1.1));
      rep.anim.push((s) => { disc.rotation.y = s * 6; });
    }
  },
  antiair(rep, g, e) {
    const p = kit({ type: e.type ?? 'thunderarcher' });
    part(g, cyl(1.0, 1.15, 0.45, 8), p.dark, 0, 0.22, 0);
    band(rep, g, 1.02, 0.47, 8);
    part(g, cyl(0.45, 0.65, 2.4, 8), p.stone, 0, 1.6, 0);
    for (let i = 0; i < 2; i++) part(g, ring(0.55 - i * 0.07, 0.07, 14), p.trim, 0, 1.2 + i * 0.9, 0).rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const rod = part(g, cyl(0.04, 0.07, 1.6, 5), metal('#c27a3e'), Math.cos(a) * 0.4, 3.3, Math.sin(a) * 0.4);
      rod.rotation.z = -Math.cos(a) * 0.35;
      rod.rotation.x = Math.sin(a) * 0.35;
      part(g, sph(0.09, 6, 4), p.glow, Math.cos(a) * 0.68, 4.05, Math.sin(a) * 0.68);
    }
    pulsing(rep, part(g, ico(0.36, 1), p.glow, 0, 3.05, 0), 0.6, 1.6, 4);
  },

  /* --------------------------------------- Defences ----------------------------------------- */
  blocker(rep, g, e) {
    const f = furyOf(e), p = kit(e);
    if (f === 'wind') {
      // the Wind Tower: a timber lattice under a fan that turns
      part(g, box(2.2, 0.3, 2.2), p.dark, 0, 0.15, 0);
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) part(g, cyl(0.08, 0.12, 2.8, 5), mat('#8a6040'), x * 0.8, 1.6, z * 0.8).rotation.set(-z * 0.12, 0, x * 0.12);
      for (const y of [1.0, 2.0]) for (const r of [0, Math.PI / 2]) part(g, box(1.6, 0.08, 0.08), mat('#6f4e33'), 0, y, 0).rotation.y = r;
      part(g, box(1.3, 0.14, 1.3), mat('#a87a50'), 0, 2.95, 0);
      part(g, cone(0.95, 0.7, 4), p.roof, 0, 3.4, 0).rotation.y = Math.PI / 4;
      const fan = spin(rep, holder(g, 0, 2.35, 0.75), 'z', 4, rep.id);
      for (let i = 0; i < 4; i++) {
        const b = part(fan, box(0.2, 0.75, 0.04), mat('#efe6cf'));
        b.rotation.z = (i / 4) * Math.PI * 2;
        b.translateY(0.4);
      }
      band(rep, g, 0.12, 3.85, 6);
    } else if (f === 'rain') {
      // the Ice Tower: shards of ice out of a rock
      part(g, dodeca(1.0), p.dark, 0, 0.35, 0).scale.set(1.2, 0.55, 1.2);
      const ice = mat('#cdeffc', { emissive: '#3aa8d8', emissiveIntensity: 0.25, transparent: true, opacity: 0.85, roughness: 0.15 });
      for (const [x, z, h, r, tx, tz] of [[0, 0, 3.6, 0.5, 0, 0], [0.55, 0.3, 2.4, 0.35, 0.18, -0.12], [-0.5, 0.35, 2.1, 0.32, 0.15, 0.2], [0.1, -0.6, 2.6, 0.34, -0.2, 0.08], [-0.45, -0.4, 1.6, 0.28, -0.1, -0.25]]) {
        part(g, cone(r, h, 5), ice, x, 0.5 + h / 2, z).rotation.set(tx, 0, tz);
      }
      band(rep, g, 1.0, 0.45, 9);
    } else if (f === 'thunder') {
      // the Bulwark: a heavy bastion of dark stone, copper spikes on its corners
      part(g, box(2.5, 0.45, 2.5), p.dark, 0, 0.22, 0);
      part(g, cyl(1.05, 1.5, 1.9, 4), p.stone, 0, 1.4, 0).rotation.y = Math.PI / 4;
      part(g, box(1.6, 0.12, 1.6), p.trim, 0, 2.4, 0);
      part(g, box(1.2, 0.4, 1.2), p.dark, 0, 2.65, 0);
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) part(g, cone(0.09, 0.55, 5), p.trim, x * 0.62, 2.75, z * 0.62);
      for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const slit = part(g, box(0.5, 0.1, 0.05), p.glow, Math.sin(r) * 0.9, 1.6, Math.cos(r) * 0.9);
        slit.rotation.y = r;
      }
      part(g, ring(1.6, 0.065, 4), team(rep), 0, 0.46, 0).rotation.set(Math.PI / 2, 0, Math.PI / 4);
    } else {
      // the Stone Tower: round, battlemented, the owner's pennant on top
      part(g, cyl(1.1, 1.2, 0.35, 10), p.dark, 0, 0.17, 0);
      part(g, cyl(0.8, 0.95, 2.6, 10), p.stone, 0, 1.6, 0);
      part(g, cyl(0.95, 0.95, 0.25, 10), p.trim, 0, 2.95, 0);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        part(g, box(0.3, 0.35, 0.22), p.stone, Math.cos(a) * 0.82, 3.25, Math.sin(a) * 0.82).rotation.y = -a;
      }
      part(g, box(0.18, 0.45, 0.06), mat('#3a3330'), 0, 1.7, 0.86);
      banner(rep, g, 0, 0, 4.2, 0.6);
    }
  },
  fence(rep, g, e) {
    const f = furyOf(e), p = kit(e);
    if (e.type === 'fenceshield') {
      // the Force Field: a small pylon in a bubble
      part(g, cyl(0.3, 0.4, 0.3, 8), p.dark, 0, 0.15, 0);
      part(g, cyl(0.08, 0.12, 1.0, 6), p.trim, 0, 0.75, 0);
      const bubble = moving(part(g, sph(0.55, 12, 8), see('#bfe0ff', 0.3, { emissive: '#4a8aff', emissiveIntensity: 0.4 }), 0, 0.75, 0));
      rep.anim.push((s) => { bubble.scale.setScalar(1 + Math.sin(s * 3 + rep.id) * 0.05); });
      band(rep, g, 0.32, 0.32, 8);
      return;
    }
    if (f === 'rain') {
      // the Acid Barricade: stone posts round a pool of acid that bubbles
      part(g, cyl(1.2, 1.3, 0.35, 12), p.dark, 0, 0.17, 0);
      part(g, cyl(1.0, 1.0, 0.06, 12), glow('#b8ff6a', '#4fd02a', 0.8), 0, 0.37, 0);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        part(g, box(0.35, 1.4, 0.35), p.stone, Math.cos(a) * 1.05, 0.9, Math.sin(a) * 1.05).rotation.y = -a;
        part(g, pyramid(), p.roof, Math.cos(a) * 1.05, 1.6, Math.sin(a) * 1.05).scale.set(0.45, 0.35, 0.45);
      }
      for (let i = 0; i < 3; i++) {
        const b = moving(part(g, ico(0.14, 0), glow('#d8ff9a', '#6fe03a', 1), Math.cos(i * 2.1) * 0.45, 0.45, Math.sin(i * 2.1) * 0.45));
        rep.anim.push((s) => { const k = (s * 0.7 + i / 3) % 1; b.position.y = 0.4 + k * 0.7; b.scale.setScalar(1 - k); });
      }
      band(rep, g, 1.22, 0.36, 12);
    } else if (f === 'thunder') {
      // the Arc Spire: a needle under two rings of light that turn
      part(g, cyl(0.9, 1.1, 0.4, 6), p.dark, 0, 0.2, 0);
      part(g, cone(0.32, 3.6, 6), p.stone, 0, 2.2, 0);
      for (const [y, r, sp] of [[1.6, 0.65, 1.4], [2.6, 0.45, -2]]) {
        const hoop = spin(rep, holder(g, 0, y, 0), 'y', sp);
        part(hoop, ring(r, 0.05, 18), p.glow).rotation.x = Math.PI / 2 + 0.3;
      }
      pulsing(rep, part(g, sph(0.15, 8, 6), p.glow, 0, 4.05, 0), 0.6, 2, 8);
      band(rep, g, 0.92, 0.42, 6);
    } else {
      // the Sun Barricade: low walls round a post that holds a sun stone
      part(g, cyl(1.15, 1.25, 0.25, 10), p.dark, 0, 0.12, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        part(g, box(0.9, 0.6, 0.32), p.stone, Math.cos(a) * 0.95, 0.55, Math.sin(a) * 0.95).rotation.y = -a + Math.PI / 2;
      }
      part(g, cyl(0.12, 0.18, 1.6, 6), p.trim, 0, 1.05, 0);
      const stone = moving(part(g, ico(0.3, 1), p.glow, 0, 2.05, 0));
      rep.anim.push((s) => { stone.scale.setScalar(0.9 + Math.sin(s * 3 + rep.id) * 0.1); stone.rotation.y = s; });
      band(rep, g, 1.17, 0.27, 10);
    }
  },
  farm(rep, g) {
    // the Edge Farm: a plot of crops by a tiny shed
    part(g, box(0.95, 0.12, 0.95), mat('#7a5a3a'), 0, 0.06, 0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) part(g, cone(0.09, 0.3, 4), mat('#6fa34a'), -0.3 + c * 0.3, 0.27, -0.3 + r * 0.25);
    part(g, box(0.3, 0.3, 0.25), mat('#c9a57c'), 0.32, 0.27, 0.32);
    part(g, box(0.06, 0.4, 0.06), team(rep), -0.4, 0.32, 0.4);
  },

  /* ---------------------------------------- Aviaries ---------------------------------------- */
  aviary(rep, g, e) {
    const f = furyOf(e), p = kit(e);
    if (f === 'wind') {
      // the Devil Maker: a funnel on stilts, a swirl of dust turning in it
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        part(g, cyl(0.07, 0.12, 1.4, 5), mat('#8a6040'), Math.cos(a) * 0.7, 0.7, Math.sin(a) * 0.7).rotation.set(-Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2);
      }
      part(g, cyl(1.25, 0.4, 1.4, 12), mat('#c9a57c'), 0, 2.0, 0);
      part(g, ring(1.25, 0.08, 16), p.dark, 0, 2.7, 0).rotation.x = Math.PI / 2;
      const swirl = spin(rep, holder(g, 0, 2.3, 0), 'y', 3, rep.id);
      for (let i = 0; i < 3; i++) part(swirl, cone(0.9 - i * 0.22, 0.8, 7), see('#e8d2a8', 0.45), 0, 0.3 + i * 0.4, 0).rotation.x = Math.PI;
      band(rep, g, 0.42, 1.35, 10);
    } else if (f === 'rain') {
      // the Man o'War Pool: a basin in which a jellyfish bobs
      part(g, cyl(1.3, 1.4, 0.55, 16), p.stone, 0, 0.27, 0);
      part(g, cyl(1.1, 1.1, 0.06, 16), glow('#7dd6ec', '#1d7690', 0.5), 0, 0.52, 0);
      part(g, ring(1.2, 0.09, 18), p.trim, 0, 0.57, 0).rotation.x = Math.PI / 2;
      const jelly = holder(g, 0, 1.0, 0);
      rep.anim.push((s) => { jelly.position.y = 1.0 + Math.sin(s * 1.5 + rep.id) * 0.18; jelly.rotation.y = s * 0.3; });
      part(jelly, dome(0.55), see('#d7a8ff', 0.75, { emissive: '#8a5cff', emissiveIntensity: 0.35 }));
      for (let i = 0; i < 6; i++) part(jelly, cyl(0.03, 0.01, 0.6, 4), see('#e8c8ff', 0.7), Math.cos(i) * 0.3, -0.3, Math.sin(i) * 0.3);
      band(rep, g, 1.32, 0.12, 16);
    } else {
      // the Whirlibase: a landing pad, a hangar, a windsock in the owner's colour
      part(g, cyl(1.3, 1.4, 0.3, 16), p.stone, 0, 0.15, 0);
      part(g, ring(0.85, 0.06, 18), p.trim, 0, 0.32, 0).rotation.x = Math.PI / 2;
      const hangar = part(g, cyl(0.6, 0.6, 1.3, 10), p.roof, 0, 0.3, -0.75);
      hangar.rotation.z = Math.PI / 2;
      hangar.scale.set(1, 1, 1.1);
      part(g, cyl(0.04, 0.05, 1.4, 5), mat('#e8e4da'), 1.05, 1.0, 0.7);
      part(g, cone(0.14, 0.6, 6), team(rep), 1.05, 1.6, 0.98).rotation.x = Math.PI / 2 + 0.3;
      const rotor = spin(rep, holder(g, 0, 0.85, 0.2), 'y', 1.5);
      part(rotor, box(1.3, 0.03, 0.1), mat('#3a3330'));
      part(rotor, box(0.1, 0.03, 1.3), mat('#3a3330'));
      part(g, sph(0.22, 8, 6), metal('#c8a24a'), 0, 0.62, 0.2);
    }
  },

  /* ---------------------------------------- Flyers ------------------------------------------ */
  flyer(rep, g, e) {
    const f = furyOf(e);
    const body = holder(g, 0, 4.2, 0);
    rep.anim.push((s) => { body.position.y = 4.2 + Math.sin(s * 2 + rep.id) * 0.15; });
    if (f === 'wind') {
      // the Dust Devil: a little whirlwind
      const whirl = spin(rep, holder(body), 'y', 6, rep.id);
      for (let i = 0; i < 4; i++) part(whirl, cone(0.55 - i * 0.1, 0.5, 7), see('#e2c79a', 0.55 - i * 0.05), 0, 0.3 - i * 0.35, 0).rotation.x = Math.PI;
      part(body, sph(0.1, 6, 4), team(rep), 0, 0.65, 0);
    } else if (f === 'rain') {
      // the Man o'War: a jellyfish of the air, its tentacles swaying
      part(body, dome(0.45), see('#d7a8ff', 0.8, { emissive: '#8a5cff', emissiveIntensity: 0.35 }));
      part(body, sph(0.12, 6, 4), team(rep), 0, 0.35, 0);
      const tails = holder(body);
      rep.anim.push((s) => { tails.rotation.x = Math.sin(s * 2.5 + rep.id) * 0.15; tails.rotation.z = Math.cos(s * 2.1 + rep.id) * 0.15; });
      for (let i = 0; i < 6; i++) part(tails, cyl(0.025, 0.01, 0.9, 4), see('#e8c8ff', 0.7), Math.cos(i) * 0.25, -0.45, Math.sin(i) * 0.25);
    } else {
      // the Whirligig: a gold pod under a rotor
      part(body, sph(0.32, 10, 8), metal('#c8a24a')).scale.set(1, 0.8, 1.3);
      part(body, box(0.08, 0.08, 0.7), mat('#6b4a2c'), 0, 0, -0.55);
      part(body, sph(0.1), team(rep), 0, -0.25, 0);
      const rotor = spin(rep, holder(body, 0, 0.38, 0), 'y', 18);
      part(rotor, box(1.8, 0.03, 0.12), mat('#3a3330'));
      part(rotor, box(0.12, 0.03, 1.8), mat('#3a3330'));
    }
  },

  /* --------------------------------- Walkers and floaters ----------------------------------- */
  walker(rep, g, e) {
    const f = furyOf(e);
    rep.cargo = holder(g, 0, 1.9, 0);
    if (f === 'wind') return MODELS.skater(rep, g);
    if (f === 'rain') return MODELS.crab(rep, g);
    if (f === 'thunder') return MODELS.bulf(rep, g);
    if (f === 'fire') return MODELS.ant(rep, g);
    return MODELS.golem(rep, g, e);
  },
  golem(rep, g, e) {
    // the Sun's Golem: a stone figure with glowing eyes and the owner's belt
    const body = holder(g);
    part(body, box(0.5, 0.55, 0.36), mat('#b9a98a'), 0, 0.72, 0);
    part(body, box(0.3, 0.26, 0.28), mat('#c9b99a'), 0, 1.15, 0);
    part(body, box(0.52, 0.08, 0.38), team(rep), 0, 0.84, 0);
    part(body, box(0.56, 0.12, 0.3), mat('#9c8d70'), 0, 1.0, 0);
    const legs = [-0.13, 0.13].map((x) => moving(part(body, box(0.16, 0.45, 0.18), mat('#9c8d70'), x, 0.22, 0)));
    const arms = [-0.33, 0.33].map((x) => moving(part(body, box(0.12, 0.45, 0.14), mat('#a99a7c'), x, 0.72, 0)));
    for (const x of [-0.07, 0.07]) part(body, box(0.05, 0.05, 0.02), glow('#ffe39a', '#ffb43a', 1), x, 1.17, 0.15);
    body.scale.setScalar(1.25);
    rep.walk = (phase) => {
      const a = Math.sin(phase) * 0.5;
      legs[0].rotation.x = a; legs[1].rotation.x = -a; arms[0].rotation.x = -a; arms[1].rotation.x = a;
    };
  },
  skater(rep, g) {
    // the Sail Skater: a deck on runners under a three-cornered sail
    const body = holder(g);
    for (const x of [-0.22, 0.22]) part(body, box(0.06, 0.08, 1.1), metal('#7a7a7a'), x, 0.08, 0);
    for (const x of [-0.22, 0.22]) for (const z of [-0.3, 0.3]) part(body, box(0.04, 0.2, 0.04), mat('#6f4e33'), x, 0.2, z);
    part(body, box(0.6, 0.08, 1.0), mat('#a87a50'), 0, 0.33, 0);
    part(body, box(0.62, 0.06, 0.12), team(rep), 0, 0.4, -0.42);
    part(body, cyl(0.035, 0.04, 1.5, 5), mat('#6f4e33'), 0, 1.1, -0.05);
    part(body, cone(0.5, 1.2, 3), mat('#f3ecd8', { side: THREE.DoubleSide }), 0, 1.15, 0.22).scale.set(0.12, 1, 0.75);
    part(body, box(0.18, 0.1, 0.02), team(rep), 0.09, 1.82, -0.05);
    body.scale.setScalar(1.15);
    rep.walk = (phase) => { body.rotation.z = Math.sin(phase * 0.5) * 0.08; body.position.y = Math.abs(Math.sin(phase)) * 0.04; };
  },
  crab(rep, g) {
    // the Crystal Crab: a blue shell with crystals on its back, claws held up
    const body = holder(g, 0, 0.35, 0);
    part(body, sph(0.4, 10, 6), mat('#4f86b5'), 0, 0, 0).scale.set(1.3, 0.55, 1.0);
    part(body, box(0.5, 0.06, 0.06), team(rep), 0, 0.12, -0.38);
    for (const [x, z, s] of [[0, 0, 1], [0.18, -0.1, 0.7], [-0.18, -0.08, 0.75]]) part(body, octa(0.16 * s), glow('#c8f2ff', '#29a8ff', 0.9), x, 0.3 * s, z).scale.y = 1.7;
    for (const x of [-0.06, 0.06]) part(body, sph(0.04, 5, 4), mat('#111111'), x, 0.18, 0.38);
    const legs = [];
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1, k = i % 3;
      const leg = moving(part(body, box(0.42, 0.05, 0.05), mat('#3d6f9a'), side * 0.55, -0.12, -0.18 + k * 0.18));
      leg.rotation.z = side * -0.5;
      legs.push({ leg, side, k });
    }
    for (const s of [-1, 1]) {
      part(body, box(0.08, 0.08, 0.35), mat('#3d6f9a'), s * 0.32, 0.05, 0.45);
      part(body, cone(0.1, 0.25, 4), mat('#6fa8d8'), s * 0.32, 0.12, 0.66).rotation.x = Math.PI / 2;
    }
    rep.walk = (phase) => {
      for (const { leg, side, k } of legs) leg.rotation.z = side * (-0.5 + Math.sin(phase * 1.5 + k * 2) * 0.25);
      body.rotation.z = Math.sin(phase) * 0.05;
    };
  },
  bulf(rep, g) {
    // the Bulf: a horned beast of the thunder, its eyes alight
    const body = holder(g);
    part(body, box(0.5, 0.45, 0.85), mat('#4a4058'), 0, 0.7, 0);
    part(body, box(0.55, 0.35, 0.4), mat('#5d5070'), 0, 0.85, 0.2);
    part(body, box(0.56, 0.08, 0.5), team(rep), 0, 0.98, -0.1);
    const head = holder(body, 0, 0.8, 0.55);
    part(head, box(0.34, 0.3, 0.32), mat('#5d5070'));
    for (const s of [-1, 1]) {
      part(head, cone(0.06, 0.35, 5), metal('#c27a3e'), s * 0.22, 0.18, 0).rotation.z = -s * 0.9;
      part(head, sph(0.04, 5, 4), glow('#e6d2ff', '#9a5cff', 1.5), s * 0.09, 0.05, 0.17);
    }
    const legs = [[-0.17, 0.28], [0.17, 0.28], [-0.17, -0.28], [0.17, -0.28]].map(([x, z]) => moving(part(body, box(0.13, 0.5, 0.13), mat('#3a3443'), x, 0.25, z)));
    part(body, cyl(0.03, 0.02, 0.4, 4), mat('#3a3443'), 0, 0.8, -0.5).rotation.x = -0.8;
    body.scale.setScalar(1.1);
    rep.walk = (phase) => {
      const a = Math.sin(phase) * 0.45;
      legs[0].rotation.x = a; legs[3].rotation.x = a; legs[1].rotation.x = -a; legs[2].rotation.x = -a;
      head.rotation.x = Math.sin(phase * 2) * 0.05;
    };
  },
  ant(rep, g) {
    // the Fire Ant: three red segments on six legs
    const body = holder(g, 0, 0.35, 0);
    for (const [z, r] of [[-0.35, 0.22], [0, 0.15], [0.3, 0.17]]) part(body, sph(r, 8, 6), mat('#c4442a'), 0, 0, z).scale.set(1, 0.85, 1.2);
    part(body, box(0.3, 0.05, 0.05), team(rep), 0, 0.15, 0);
    for (const s of [-1, 1]) part(body, cyl(0.015, 0.01, 0.3, 4), mat('#2a1d1d'), s * 0.08, 0.2, 0.45).rotation.x = 0.8;
    const legs = [];
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1, k = i % 3;
      const leg = moving(part(body, box(0.4, 0.03, 0.03), mat('#2a1d1d'), side * 0.22, -0.12, -0.12 + k * 0.12));
      leg.rotation.z = side * -0.6;
      legs.push({ leg, side, k });
    }
    rep.walk = (phase) => { for (const { leg, side, k } of legs) leg.rotation.y = Math.sin(phase * 2 + k * 2 + side) * 0.3; };
  },
  balloon(rep, g, e) {
    const f = furyOf(e);
    if (f === 'wind') {
      // the Air Ship: a canvas envelope with fins, a gondola, a propeller behind
      const body = holder(g, 0, 4.3, 0);
      rep.anim.push((s) => { body.position.y = 4.3 + Math.sin(s * 1.1 + rep.id) * 0.15; });
      part(body, sph(1, 14, 10), mat('#efe6cf')).scale.set(0.85, 0.75, 2.0);
      part(body, ring(0.86, 0.06, 18), team(rep), 0, 0, 0.4).scale.set(1, 0.88, 1);
      for (const r of [0, Math.PI / 2, Math.PI]) part(body, box(0.06, 0.6, 0.6), mat('#9bcf6a'), 0, 0, -1.9).rotation.z = r;
      part(body, box(0.5, 0.35, 1.0), mat('#87603f'), 0, -1.05, 0.1);
      for (const x of [-0.2, 0.2]) part(body, cyl(0.02, 0.02, 0.5, 4), mat('#5a4a3a'), x, -0.75, 0.1);
      const prop = spin(rep, holder(body, 0, -1.05, -0.55), 'z', 14);
      part(prop, box(0.08, 0.7, 0.03), mat('#3a3330'));
      rep.cargo = holder(g, 0, 2.6, 0);
    } else if (f === 'rain') {
      // the Cloud Floater: a cloud that carries a basket
      const body = holder(g, 0, 3.4, 0);
      rep.anim.push((s) => { body.position.y = 3.4 + Math.sin(s * 1.3 + rep.id) * 0.2; });
      for (const [x, y, z, r] of [[0, 0, 0, 0.6], [0.55, -0.1, 0.1, 0.45], [-0.5, -0.05, -0.1, 0.48], [0.1, 0.3, -0.3, 0.42], [-0.15, -0.15, 0.45, 0.38]]) part(body, ico(r, 1), mat('#f4f8ff'), x, y, z);
      for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) part(body, box(0.02, 0.6, 0.02), mat('#5a4a3a'), x, -0.85, z);
      part(body, box(0.5, 0.3, 0.5), mat('#8a6a4a'), 0, -1.25, 0);
      part(body, box(0.52, 0.06, 0.52), team(rep), 0, -1.1, 0);
      rep.cargo = holder(g, 0, 1.5, 0);
    } else {
      // the Sun's Balloon: a hot-air balloon in the owner's colour
      const body = holder(g, 0, 3.2, 0);
      rep.anim.push((s) => { body.position.y = 3.2 + Math.sin(s * 1.3 + rep.id) * 0.18; });
      part(body, sph(0.75, 12, 10), mat('#e8c46a')).scale.set(1, 1.15, 1);
      part(body, cyl(0.48, 0.48, 0.08, 12), team(rep), 0, -0.8, 0);
      for (const [x, z] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) part(body, box(0.03, 0.7, 0.03), mat('#5a4a3a'), x, -1.15, z);
      part(body, box(0.6, 0.35, 0.6), mat('#8a5a34'), 0, -1.6, 0);
      rep.cargo = holder(g, 0, 1.4, 0);
    }
  },

  /* ------------------------------------ Priests and the map ---------------------------------- */
  priest(rep, g) {
    // the High Priest: a robe in the owner's colour, a golden mitre and a staff with a light
    const body = holder(g);
    part(body, cone(0.34, 1.0, 8), team(rep), 0, 0.5, 0);
    part(body, cyl(0.2, 0.25, 0.1, 8), metal('#d9a63a'), 0, 0.72, 0);
    part(body, sph(0.17), mat('#edcfa8'), 0, 1.12, 0);
    part(body, cone(0.15, 0.4, 8), metal('#d9a63a'), 0, 1.42, 0);
    part(body, cyl(0.025, 0.025, 1.5, 5), mat('#6f4e33'), 0.3, 0.75, 0.1);
    part(body, ico(0.09, 0), glow('#fff3c0', '#ffd24a', 1.2), 0.3, 1.55, 0.1);
    body.scale.setScalar(1.3);
    rep.body = body;
  },
  crystal(rep, g) {
    const c = moving(part(g, octa(0.28), glow('#bff4ff', '#39c6ff', 1.1), 0, 0.45, 0));
    c.scale.y = 1.5;
    rep.anim.push((s) => { c.rotation.y = s * 2; c.position.y = 0.45 + Math.sin(s * 3 + rep.id) * 0.08; });
  },
  geyser(rep, g) {
    part(g, cyl(0.55, 0.7, 0.12, 10), mat('#3a3330'), 0, 0.06, 0);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3, r = 0.25 + hash(i, 7, 70) * 0.22;
      part(g, dodeca(r), mat('#857766'), Math.cos(a) * 0.95, r * 0.6, Math.sin(a) * 0.95);
    }
    // ten puffs of steam in one draw: an instanced mesh whose instances fade one by one
    const steam = moving(new THREE.InstancedMesh(ico(1, 1), steamMaterial(), 10));
    steam.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    steam.setColorAt(0, new THREE.Color(1, 1, 1));
    // where the puffs can be, so that a geyser off screen is not drawn
    steam.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 0), 4);
    g.add(steam);
    rep.own.push(steam);
    rep.steam = { mesh: steam, puffs: Array.from({ length: 10 }, (_, i) => ({ phase: i / 10, seed: hash(i, rep.id, 71) })) };
  },
  obelisk(rep, g) {
    part(g, box(0.7, 3.2, 0.7), mat('#7d7a84'), 0, 1.6, 0);
    part(g, cone(0.5, 0.8, 4), mat('#9a97a2'), 0, 3.6, 0).rotation.y = Math.PI / 4;
    part(g, box(0.72, 0.4, 0.72), glow('#c8b8ff', '#7a5cff', 0.8), 0, 2.2, 0);
  },
  residence(rep, g) {
    part(g, box(2.2, 1.2, 1.7), mat('#e1d3b4'), 0, 0.66, 0);
    const top = part(g, cone(1.75, 1.05, 4), mat('#a8513a'), 0, 1.78, 0);
    top.rotation.y = Math.PI / 4;
    top.scale.z = 0.82;
    part(g, box(0.26, 0.7, 0.26), mat('#7a6a5a'), 0.6, 2.0, -0.3);
    part(g, box(0.42, 0.65, 0.05), mat('#6b4a2c'), 0, 0.38, 0.86);
    for (const x of [-0.7, 0.7]) part(g, box(0.34, 0.3, 0.05), glow('#ffe39a', '#ffb43a', 0.7), x, 0.8, 0.86);
    part(g, ico(0.45), mat('#4b7a30'), -1.4, 0.4, 1.3);
    part(g, ico(0.35), mat('#4b7a30'), 1.45, 0.35, -1.2);
  },
  generic(rep, g, e) {
    const d = defs.get(e.type);
    const fx = e.fx ?? 1, fy = e.fy ?? 1;
    part(g, box(fx * 0.8, 1.4, fy * 0.8), mat('#d9d0bd'), 0, 0.7, 0);
    part(g, cone(Math.max(fx, fy) * 0.6, 1, 4), mat(FURY_COLOR[d?.theme] ?? '#bbb'), 0, 1.9, 0).rotation.y = Math.PI / 4;
  },
};

/** Which model a world entity gets: one builder per role, which draws each Fury's own. */
export function modelKind(e) {
  if (['priest', 'crystal', 'geyser', 'obelisk', 'flyer'].includes(e.kind)) return e.kind;
  const d = defs.get(e.type);
  if (e.kind === 'transport') return d?.cls === 'Aerial Transport' || d?.group === 'balloon' ? 'balloon' : 'walker';
  if (!d) return 'generic';
  if (d.cls === 'Energy') return 'temple';
  if (d.cls === 'Production') return 'workshop';
  if (d.cls === 'Altar') return 'altar';
  if (d.cls === 'Anti-Air') return 'antiair';
  if (e.type === 'fenceshield') return 'fence';
  if (e.type === 'efarm') return 'farm';
  return { battery: 'generator', cannon: 'cannon', archer: 'archer', blocker: 'blocker', aviary: 'aviary', fence: 'fence' }[d.group] ?? 'generic';
}

/** How tall a built model stands, for the health bar over it. */
export function heightOf(model) {
  const box3 = new THREE.Box3().setFromObject(model);
  return box3.isEmpty() ? 1.6 : Math.max(1.2, box3.max.y);
}

/** The original sprite an entity is drawn with in "Sprites" mode, or null to keep its model. */
export function spriteKey(e) {
  const has = (k) => k in ART.sprites;
  if (e.kind === 'priest') return e.state === 'down' ? 'priest:down' : 'priest';
  if (e.kind === 'crystal' || e.kind === 'geyser') return e.kind;
  if (e.kind === 'transport' || e.kind === 'flyer') return has(e.type) ? e.type : null;
  if (e.kind === 'building') {
    if (has(`${e.type}:${e.facing}`)) return `${e.type}:${e.facing}`;
    return has(e.type) ? e.type : null;
  }
  return null;
}

/** A small model of a captive or crystal carried over a Golem's head. */
export function cargoModel(thing) {
  const g = new THREE.Group();
  if (thing?.kind === 'priest') {
    MODELS.priest({ owner: thing.owner, anim: [], own: [] }, g);
    bake(g, `cargo|priest|${thing.owner}`);
    g.rotation.z = Math.PI / 2;
    g.position.y = -0.2;
    g.scale.setScalar(0.8);
  } else {
    part(g, octa(0.25), glow('#bff4ff', '#39c6ff', 1.1)).scale.y = 1.5;
  }
  return g;
}

