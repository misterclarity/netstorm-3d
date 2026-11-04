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
import { THREE, G, defs, ART, OWNER_COLOR, FURY_COLOR, FACING_YAW, hash } from './state.js';

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
/**
 * An Aerial Transport's body at its height: `high` aloft, `low` (its gondola just above the
 * ground) landed, and in between as it climbs or lands (`rep.lift`, 0 to 1, from ns-units),
 * bobbing only in the air. What it carries hangs `rep.cargoBelow` under the body, never in the
 * ground.
 */
function aloft(rep, body, low, high, bob, rate) {
  return (s) => {
    const k = rep.lift ?? 1;
    body.position.y = low + (high - low) * k + Math.sin(s * rate + rep.id) * bob * k;
    if (rep.cargo) rep.cargo.position.y = Math.max(0.35, body.position.y - (rep.cargoBelow ?? 2));
  };
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

/** A steady pseudo-random number in [0, 1) for a pair of whole numbers. */
function noise(a, b) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
/** How many ticks ago `e` last fired (Infinity if never). */
const since = (e) => (e?.lastShot >= 0 && G.world ? G.world.tick - e.lastShot : Infinity);
/** A turned shape: `pts` are [radius, y] pairs from the bottom up. */
const lathe = (key, pts, n = 12) => shape(`lathe${key}`, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), n));
/** A slice of a sphere's skin: the `i`th of `n` lunes, from the pole down to `to` (radians). */
const lune = (r, i, n, to = Math.PI) => shape(`lune${r},${i},${n},${to}`, () => new THREE.SphereGeometry(r, 3, 8, (i / n) * Math.PI * 2, (Math.PI * 2) / n, 0, to));
/**
 * A tube along `pts` ([x, y, z] in its group's space) of radius r, narrowing to `tip` × r at its end:
 * horns, tendrils, claws, sea serpents' necks. `sharp` runs it straight from point to point.
 */
function tube(key, pts, r, { n = 5, tip = 1, sharp = false, steps = 0 } = {}) {
  return shape(`tube${key}`, () => {
    const v = pts.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    let curve;
    if (sharp) {
      curve = new THREE.CurvePath();
      for (let i = 0; i < v.length - 1; i++) curve.add(new THREE.LineCurve3(v[i], v[i + 1]));
    } else curve = new THREE.CatmullRomCurve3(v);
    const segs = steps || pts.length * 4;
    const geo = new THREE.TubeGeometry(curve, segs, r, n, false);
    if (tip !== 1) {
      // narrow each ring of the tube toward its end
      const p = geo.attributes.position, at = new THREE.Vector3();
      for (let i = 0; i <= segs; i++) {
        const t = i / segs, k = 1 + (tip - 1) * t;
        curve.getPointAt(t, at);
        for (let j = 0; j <= n; j++) {
          const q = i * (n + 1) + j;
          p.setXYZ(q, at.x + (p.getX(q) - at.x) * k, at.y + (p.getY(q) - at.y) * k, at.z + (p.getZ(q) - at.z) * k);
        }
      }
      geo.computeVertexNormals();
    }
    return geo;
  });
}
/** A light that throws no shadow. */
function lit(mesh) {
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
/**
 * Lightning that crackles between a and b ([x, y, z]): one of three jagged bolts at a time, now
 * and then, a new one `rate` times a second.
 */
function zap(rep, g, a, b, { color = '#efe2ff', rate = 9, share = 0.45, jag = 0.22, r = 0.035, seed = 0 } = {}) {
  const bolts = [0, 1, 2].map((v) => {
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6, j = i % 6 ? jag : 0;
      pts.push([0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t + (noise(i * 3 + k, v + 7) - 0.5) * 2 * j));
    }
    const m = lit(moving(part(g, tube(`zap${a}|${b}|${v}|${jag}`, pts, r, { n: 3, sharp: true, steps: 12 }), glow(color, '#b98cff', 3))));
    m.visible = false;
    return m;
  });
  rep.anim.push((s) => {
    const k = Math.floor(s * rate), on = noise(k, rep.id + 0.5 + seed * 13.1) < share;
    bolts.forEach((m, i) => { m.visible = on && i === k % 3; });
  });
}
/**
 * Motes that rise from round (x, y, z), `h` high, shrinking as they go, `n` of them: embers,
 * bubbles, sparks, spray. `spread` is how far round they start; each is a mesh of its own.
 */
function motes(rep, g, x, y, z, { n = 5, h = 2, spread = 0.4, size = 0.08, material, rate = 0.5, sway = 0.15, fall = false }) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + noise(i, 3) * 2, r = spread * (0.3 + 0.7 * noise(i, 4));
    const m = lit(moving(part(g, ico(size, 0), material, x, y, z)));
    rep.anim.push((s) => {
      const k = (s * rate * (0.8 + noise(i, 5) * 0.4) + i / n + rep.id * 0.37) % 1;
      m.position.set(x + Math.cos(a + k * 2) * (r + sway * k), fall ? y + h * (1 - k) : y + h * k, z + Math.sin(a + k * 2) * (r + sway * k));
      m.scale.setScalar(fall ? 0.4 + 0.6 * (1 - k) : 1 - k * 0.85);
    });
  }
}
/** A ring that spreads from r0 to r1 at (x, y, z) and starts again: ripples on water, shock rings. */
function ripple(rep, g, x, y, z, r0, r1, { material, rate = 0.5, phase = 0, t = 0.04 }) {
  const m = lit(moving(part(g, ring(1, t, 24), material, x, y, z)));
  m.rotation.x = Math.PI / 2;
  rep.anim.push((s) => {
    const k = (s * rate + phase + rep.id * 0.21) % 1, r = r0 + (r1 - r0) * k;
    m.scale.set(r, r, 1 - k * 0.8);
  });
  return m;
}
/** A flame of two cones, flickering: at (x, y, z), `size` tall-ish. */
function flame(rep, g, x, y, z, size = 1, colors = ['#ffb347', '#ff5a1a', '#fff1b0', '#ffd24a']) {
  const f = holder(g, x, y, z);
  lit(part(f, cone(0.4 * size, 1.2 * size, 7), glow(colors[0], colors[1], 1.6), 0, 0.6 * size, 0));
  lit(part(f, cone(0.22 * size, 0.8 * size, 6), glow(colors[2], colors[3], 2.2), 0, 0.4 * size, 0));
  rep.anim.push((s) => {
    const p = rep.id * 0.7 + x;
    f.scale.set(1 + Math.sin(s * 9 + p) * 0.1, 1 + Math.sin(s * 6.3 + p) * 0.2 + Math.sin(s * 13 + p) * 0.06, 1 + Math.cos(s * 8.1 + p) * 0.1);
    f.rotation.y = s * 2 + p;
  });
  return f;
}
/** A slim dark cypress, or a round-topped tree, at (x, z). */
function cypress(g, x, z, h = 2.2) {
  part(g, cyl(0.06, 0.08, 0.4, 5), mat('#5a4030'), x, 0.5, z);
  part(g, lathe(`cypress${h}`, [[0.01, 0], [0.26, h * 0.18], [0.3, h * 0.45], [0.2, h * 0.75], [0.01, h]], 7), mat('#2f5a2a'), x, 0.6, z);
}
function tree(g, x, z, r = 0.55) {
  part(g, cyl(0.07, 0.1, 0.7, 5), mat('#5a4030'), x, 0.65, z);
  part(g, ico(r, 0), mat('#3f6f31'), x, 1.0 + r * 0.7, z);
  part(g, ico(r * 0.7, 0), mat('#4f8a3a'), x + r * 0.3, 1.2 + r, z - r * 0.2);
}

export const MODELS = {
  /* ---------------------------------------- Temples ----------------------------------------- */
  temple(rep, g, e) {
    const f = furyOf(e), p = kit(e), w = (e.fx ?? 8) * 0.46, d = (e.fy ?? 6) * 0.46;
    if (f === 'wind') return MODELS.windTemple(rep, g, p, w, d);
    // a two-step oval plinth
    part(g, cyl(1, 1.06, 0.5, 18), p.dark, 0, 0.25, 0).scale.set(w, 1, d);
    part(g, cyl(0.86, 0.9, 0.4, 18), p.stone, 0, 0.7, 0).scale.set(w, 1, d);
    /** Where on the plinth's oval, `k` of the way out, a bearing `a` is. */
    const on = (a, k) => [Math.cos(a) * w * k, Math.sin(a) * d * k];
    if (f === 'thunder') MODELS.thunderTemple(rep, g, p, w, d, on);
    else if (f === 'fire') {
      // a caldera: a lake of lava in a ring of obsidian fangs, a basalt brazier in its middle whose
      // fire leaps and throws up embers, and fire bowls on pillars round the rim
      pulsing(rep, part(g, cyl(0.8, 0.8, 0.1, 24), glow('#ff8a3a', '#ff3a00', 1), 0, 0.95, 0), 0.5, 1.3, 1.4).scale.set(w, 1, d);
      part(g, cyl(1.25, 1.55, 0.8, 6), p.dark, 0, 1.3, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        lit(part(g, box(0.07, 0.6, 0.04), glow('#ffb347', '#ff5a1a', 1.4), Math.cos(a) * 1.42, 1.3, Math.sin(a) * 1.42)).rotation.y = -a + Math.PI / 2;
      }
      part(g, lathe('firebowl', [[0.55, 0], [1.25, 0.45], [1.35, 0.7], [1.15, 0.72]], 10), p.trim, 0, 1.7, 0);
      part(g, cyl(1.12, 1.12, 0.1, 10), glow('#ff9a3a', '#ff4a00', 1.2), 0, 2.35, 0);
      flame(rep, g, 0, 2.3, 0, 1.7);
      flame(rep, g, 0.45, 2.3, 0.2, 0.9);
      flame(rep, g, -0.4, 2.3, -0.25, 1.0);
      motes(rep, g, 0, 2.8, 0, { n: 7, h: 3.4, spread: 0.6, size: 0.07, material: glow('#ffd08a', '#ff7a1a', 2.2), rate: 0.45, sway: 0.5 });
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + 0.3, [x, z] = on(a, 0.8), h = 1.6 + noise(i, 9) * 1.2;
        const fang = part(g, cone(0.3, h, 4), mat('#231a1f', { metalness: 0.4, roughness: 0.25 }), x, 0.9 + h / 2, z);
        fang.rotation.set(Math.sin(a) * 0.3, a, -Math.cos(a) * 0.3);
      }
      for (const a of [0.8, 2.35, 3.95, 5.5]) {
        const [x, z] = on(a, 0.98);
        part(g, cyl(0.2, 0.26, 1.4, 6), p.stone, x, 1.4, z);
        part(g, lathe('firecup', [[0.08, 0], [0.32, 0.18], [0.36, 0.3]], 7), p.trim, x, 2.1, z);
        flame(rep, g, x, 2.3, z, 0.45);
      }
    } else if (f === 'rain') {
      // after its sprite: a carved ring of pale stone round a pool that glows, fountains spouting
      // at its rim, and over the pool's middle a great drop of living water that turning streams
      // ring and ripples spread from
      part(g, cyl(0.8, 0.8, 0.1, 28), glow('#8fe3f5', '#1d8fb0', 0.55), 0, 0.93, 0).scale.set(w, 1, d);
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2, [x, z] = on(a, 0.86);
        const block = part(g, box(1.0, 0.5, 0.55), i % 2 ? p.stone : mat('#c3d2dc'), x, 1.12, z);
        block.rotation.y = Math.atan2(-d * Math.cos(a), -w * Math.sin(a));
        if (i % 2 === 0) part(g, sph(0.16, 6, 4), p.trim, x, 1.45, z);
      }
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2, [x, z] = on(a, 0.86);
        part(g, cyl(0.32, 0.42, 0.9, 8), p.stone, x, 1.35, z);
        part(g, lathe('rainbowl', [[0.12, 0], [0.5, 0.2], [0.55, 0.32]], 9), p.trim, x, 1.8, z);
        part(g, cyl(0.46, 0.46, 0.04, 9), glow('#8fe3f5', '#1d8fb0', 0.6), x, 2.08, z);
        const jet = lit(moving(part(g, cone(0.12, 1, 6), see('#dff7ff', 0.7, { emissive: '#4ac0f0', emissiveIntensity: 0.6 }), x, 2.1, z)));
        rep.anim.push((s) => { const k = 0.8 + 0.3 * Math.sin(s * 3 + i * 1.7 + rep.id); jet.scale.set(1, k, 1); jet.position.y = 2.1 + k * 0.5; });
      }
      part(g, dodeca(0.7), p.stone, 0, 0.95, 0).scale.set(1.3, 0.4, 1.1);
      const water = see('#9fe8ff', 0.78, { emissive: '#2aa0e0', emissiveIntensity: 0.9, roughness: 0.1 });
      const drop = holder(g, 0, 2.2, 0);
      rep.anim.push((s) => { drop.position.y = 2.2 + Math.sin(s * 1.3 + rep.id) * 0.18; drop.rotation.y = s * 0.4; });
      part(drop, lathe('raindrop', [[0.01, 0], [0.55, 0.35], [0.75, 0.9], [0.55, 1.6], [0.2, 2.2], [0.01, 2.5]], 12), water);
      lit(part(drop, octa(0.32), glow('#e8fbff', '#5ad0ff', 1.4), 0, 0.95, 0)).scale.y = 1.6;
      for (const [y, r, tilt, sp] of [[0.7, 1.3, 0.35, 1.1], [1.4, 1.0, -0.45, -1.6]]) {
        const stream = spin(rep, holder(g, 0, 2.2 + y, 0), 'y', sp, rep.id);
        const loop = part(stream, ring(r, 0.07, 22), water);
        loop.rotation.x = Math.PI / 2 + tilt;
        for (let k = 0; k < 3; k++) part(stream, sph(0.1, 6, 4), mat('#e8fbff', { emissive: '#5ad0ff', emissiveIntensity: 1 }), Math.cos(k * 2.1) * r, Math.sin(k * 2.1) * r * Math.sin(-tilt), Math.sin(k * 2.1) * r * Math.cos(tilt));
      }
      const ripples = see('#e8fbff', 0.5);
      for (let k = 0; k < 2; k++) ripple(rep, g, 0, 1.0, 0, 1.4, 2.6, { material: ripples, rate: 0.35, phase: k / 2 });
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
        const a = (i / 8) * Math.PI * 2, [x, z] = on(a, 0.82);
        part(g, cyl(0.18, 0.24, 1.6, 6), p.stone, x, 1.7, z);
        part(g, cone(0.22, 0.4, 6), p.trim, x, 2.7, z);
      }
    }
    banner(rep, g, -w * 0.86, -d * 0.6, 4.6);
  },
  /**
   * The Thunder Temple, after its sprite: a dome of dark glass on a drum, a red fire for its heart,
   * held in a crown of black tendrils that curl over it, thorned, lightning leaping from their
   * tips to the spire on its crown.
   */
  thunderTemple(rep, g, p, w, d, on) {
    const R = Math.min(w, d) * 0.62, black = mat('#1f1a26', { metalness: 0.45, roughness: 0.3 }), silver = metal('#b8b4c4');
    part(g, cyl(R * 1.05, R * 1.15, 0.6, 16), p.dark, 0, 1.15, 0);
    part(g, ring(R * 1.08, 0.08, 24), p.trim, 0, 1.45, 0).rotation.x = Math.PI / 2;
    lit(pulsing(rep, part(g, sph(R * 0.55, 12, 10), glow('#ff9a5a', '#ff3a10', 1), 0, 1.95, 0), 0.6, 1.9, 2.2));
    part(g, dome(R), see('#3a2a52', 0.55, { metalness: 0.6, roughness: 0.15 }), 0, 1.45, 0);
    part(g, ring(R * 0.7, 0.05, 18), silver, 0, 1.45 + R * 0.72, 0).rotation.x = Math.PI / 2;
    part(g, cone(0.12, 1.3, 6), silver, 0, 1.45 + R + 0.55, 0);
    const top = [0, 1.45 + R + 1.25, 0];
    pulsing(rep, part(g, sph(0.13, 8, 6), p.glow, ...top), 0.8, 2.4, 7);
    // the tendrils: out and up from the drum, then over toward the dome's crown, thorned outside
    const long = [[0, 0, 0], [0.55, 1.0, 0], [0.5, 2.1, 0], [-0.05, 2.75, 0], [-0.6, 2.7, 0]];
    const short = [[0, 0, 0], [0.45, 0.8, 0], [0.4, 1.6, 0], [0, 2.1, 0], [-0.4, 2.05, 0]];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8, [x, z] = on(a, 0.62), pts = i % 2 ? short : long;
      part(g, tube(i % 2 ? 'tendril2' : 'tendril1', pts, 0.2, { n: 6, tip: 0.2 }), black, x, 1.0, z).rotation.y = -a;
      const out = (lx, ly) => [x + Math.cos(a) * lx, 1.0 + ly, z + Math.sin(a) * lx];
      for (const [k, len] of [[1, 0.5], [2, 0.42]]) {
        const thorn = part(g, cone(0.07, len, 4), mat('#6e3a2b'), ...out(pts[k][0] + 0.15, pts[k][1]));
        thorn.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(a), 0.5, Math.sin(a)).normalize());
      }
      if (i % 2 === 0) zap(rep, g, out(...pts[4]), top, { seed: i, rate: 7, share: 0.3, jag: 0.18 });
    }
  },
  windTemple(rep, g, p, w, d) {
    // a timber deck under a crown of tall spires that rise out of a great spiral shell, as in its
    // sprite; a slow ring of vanes, and leaves and ribbons of wind whirling round it all
    part(g, cyl(1, 1.08, 0.8, 9), mat('#8d6a4a'), 0, 0.4, 0).scale.set(w * 0.9, 1, d * 0.95);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const plank = part(g, box(1.7, 1.5, 0.28), mat(i % 2 ? '#b07a52' : '#c9a57c'), Math.cos(a) * w * 0.62, 1.3, Math.sin(a) * d * 0.62);
      plank.rotation.set(0, -a + Math.PI / 2, 0);
      plank.rotateX(-0.35);
    }
    // the shell: a whorl that coils in and up round the spires' feet
    const whorl = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, a = t * Math.PI * 2.6 + 0.6, r = 2.5 - t * 1.6;
      whorl.push([Math.cos(a) * r * (w / 3.7), 1.0 + t * 1.9, Math.sin(a) * r * (d / 2.8)]);
    }
    part(g, tube(`windwhorl${w},${d}`, whorl, 0.45, { n: 7, tip: 0.3, steps: 48 }), mat('#a8784e'), 0, 0, 0);
    part(g, tube(`windwhorl2${w},${d}`, whorl.map(([x, y, z]) => [x * 1.02, y + 0.32, z * 1.02]), 0.12, { n: 5, tip: 0.3, steps: 48 }), mat('#e2c79a'), 0, 0, 0);
    for (const [x, z, h, r] of [[-1.2, -0.6, 7.5, 0.42], [-0.3, -1.0, 9, 0.48], [0.7, -0.7, 8, 0.44], [1.5, -0.2, 6.2, 0.36], [-1.9, 0.2, 5.4, 0.34]]) {
      const s = part(g, lathe(`windspire${h},${r}`, [[r, 0], [r * 0.9, h * 0.3], [r * 0.55, h * 0.7], [0.02, h]], 7), mat('#d6b98e'), x, 0.8, z);
      s.rotation.z = -x * 0.03;
      s.rotation.x = z * 0.04;
      part(g, ring(r * 0.92, 0.07, 10), p.dark, x, 0.8 + h * 0.3, z).rotation.x = Math.PI / 2;
    }
    const vanes = spin(rep, holder(g, 0, 2.6, 0), 'y', 0.35);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      part(vanes, box(0.08, 0.9, 1.0), mat('#efe6cf'), Math.cos(a) * 2.2, 0, Math.sin(a) * 2.2).rotation.y = -a;
    }
    // the wind: leaves and pale ribbons whirling up round the spires
    const gust = holder(g, 0, 0, 0);
    rep.anim.push((s) => { gust.rotation.y = -s * 0.9; gust.position.y = Math.sin(s * 0.7 + rep.id) * 0.25; });
    for (let i = 0; i < 9; i++) {
      const a = i * 2.3, r = 2.0 + (i % 3) * 0.45;
      const leaf = part(gust, cone(0.14, 0.4, 3), mat(['#9bcf6a', '#d8c45a', '#6fa34a'][i % 3], { side: THREE.DoubleSide }), Math.cos(a) * r, 2.2 + i * 0.6, Math.sin(a) * r);
      leaf.rotation.set(a, a * 1.7, 1.2);
      leaf.scale.z = 0.25;
    }
    for (let k = 0; k < 3; k++) {
      const pts = [];
      for (let i = 0; i <= 6; i++) { const a = k * 2.1 + i * 0.32, r = 2.6 + k * 0.3; pts.push([Math.cos(a) * r, 3 + k * 1.6 + i * 0.12, Math.sin(a) * r]); }
      lit(part(gust, tube(`windribbon${k}`, pts, 0.05, { n: 3, tip: 0.2 }), see('#ffffff', 0.55)));
    }
    for (const [x, z] of [[-3, 1.4], [3.1, 1.2], [2.6, -1.7], [-2.7, -1.6]]) part(g, ico(0.65), mat('#4f7d36'), x, 0.7, z);
    banner(rep, g, -0.3, -1.0, 9.6, 1.2);
  },

  /* --------------------------------------- Workshops ---------------------------------------- */
  workshop(rep, g, e) {
    const d = defs.get(e.type), f = furyOf(e), p = kit(e);
    const w = (e.fx ?? d?.footX ?? 7) * 0.92, h = (e.fy ?? d?.footY ?? 6) * 0.92;
    part(g, box(w, 0.3, h), p.dark, 0, 0.15, 0);
    if (f !== 'rain') part(g, box(w * 0.96, 0.06, h * 0.96), p.yard, 0, 0.33, 0);
    if (e.type === 'outpost') MODELS.outpost(rep, g, p, w, h);
    else if (e.type === 'guildfactory') {
      // a guild hall: a long hall with a bell tower whose bell swings, a banner of each Fury over the door
      part(g, box(w * 0.7, 2.0, h * 0.5), p.stone, -w * 0.05, 1.35, -h * 0.1);
      roof(g, p.roof, h * 0.56, 1.1, w * 0.75, -w * 0.05, 2.35, -h * 0.1, Math.PI / 2);
      part(g, box(0.9, 3.6, 0.9), p.dark, w * 0.32, 2.1, -h * 0.25);
      part(g, box(1.0, 0.12, 1.0), p.trim, w * 0.32, 3.95, -h * 0.25);
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) part(g, box(0.12, 0.8, 0.12), p.dark, w * 0.32 + x * 0.4, 4.4, -h * 0.25 + z * 0.4);
      part(g, pyramid(), p.roof, w * 0.32, 4.8, -h * 0.25).scale.set(1.2, 1.1, 1.2);
      const bell = holder(g, w * 0.32, 4.7, -h * 0.25);
      part(bell, lathe('bell', [[0.3, -0.5], [0.26, -0.35], [0.16, -0.05], [0.02, 0]], 8), metal('#c9a14a'));
      rep.anim.push((s) => { bell.rotation.x = Math.sin(s * 2.4 + rep.id) * 0.35; });
      ['#e8b04a', '#59b3e6', '#8cc05a', '#a184ea'].forEach((c, i) => {
        const cloth = moving(part(g, plane(0.42, 0.9), mat(c, { side: THREE.DoubleSide }), -w * 0.3 + i * 0.55, 1.75, h * 0.16));
        rep.anim.push((s) => { cloth.rotation.x = Math.sin(s * 2 + i) * 0.15; });
      });
      part(g, box(0.9, 1.2, 0.06), mat('#5a3d27'), -w * 0.05, 0.95, h * 0.16);
      for (const [x, z] of [[-w * 0.42, h * 0.35], [w * 0.42, h * 0.38]]) tree(g, x, z, 0.5);
    } else if (f === 'wind') MODELS.windWorkshop(rep, g, p, w, h);
    else if (f === 'rain') MODELS.rainWorkshop(rep, g, p, w, h);
    else if (f === 'thunder') MODELS.thunderWorkshop(rep, g, p, w, h);
    else MODELS.sunWorkshop(rep, g, p, w, h);
    banner(rep, g, w * 0.44, h * 0.38, 3.0, 0.8);
    // a gem per unit in its production slots
    rep.slotsMark = new THREE.Group();
    rep.slotsMark.position.set(-w * 0.45, 0.4, h * 0.45);
    g.add(rep.slotsMark);
  },
  /**
   * The Sun Workshop, after its sprite: a villa of pale stone under terracotta, a round tower
   * crowned with a dome of verdigris on which a little orrery turns, an arcade on a courtyard of
   * chequered tiles, a forge glowing in its arch, smoke from its chimney and cypresses about it.
   */
  sunWorkshop(rep, g, p, w, h) {
    const wall = mat('#ece2cf'), hx = -w * 0.08, hz = -h * 0.24;
    part(g, box(w * 0.56, 2.1, h * 0.36), wall, hx, 1.4, hz);
    part(g, box(w * 0.58, 0.14, h * 0.38), p.trim, hx, 2.5, hz);
    roof(g, p.roof, h * 0.42, 1.1, w * 0.62, hx, 2.55, hz, Math.PI / 2);
    for (let i = 0; i < 4; i++) part(g, box(0.36, 0.55, 0.05), mat('#3f5560'), hx - w * 0.2 + i * w * 0.13, 1.75, hz + h * 0.18 + 0.01);
    // the arcade
    const front = hz + h * 0.18 + 0.55;
    for (let i = 0; i < 6; i++) part(g, cyl(0.1, 0.12, 1.7, 6), wall, hx - w * 0.25 + i * w * 0.1, 1.2, front);
    part(g, box(w * 0.56, 0.22, 0.4), wall, hx, 2.12, front);
    part(g, box(w * 0.56, 0.06, 0.62), p.roof, hx, 2.25, front - 0.1);
    // the forge in its arch
    part(g, box(0.9, 1.2, 0.08), mat('#3a2a20'), hx + w * 0.05, 0.95, hz + h * 0.18 + 0.02);
    lit(pulsing(rep, part(g, box(0.7, 0.9, 0.04), glow('#ffcf6a', '#ff8a1a', 1), hx + w * 0.05, 0.85, hz + h * 0.18 + 0.07), 0.6, 1.6, 2.5));
    // the round tower and its dome, an orrery on top
    const tx = w * 0.3, tz = -h * 0.15;
    part(g, cyl(0.85, 0.95, 3.4, 12), mat('#e2d6bf'), tx, 2.0, tz);
    part(g, cyl(0.98, 0.98, 0.16, 12), p.trim, tx, 3.7, tz);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      part(g, box(0.22, 0.5, 0.05), mat('#3f5560'), tx + Math.cos(a) * 0.86, 2.6, tz + Math.sin(a) * 0.86).rotation.y = -a + Math.PI / 2;
    }
    part(g, lathe('sundome', [[0.9, 0], [0.88, 0.35], [0.7, 0.85], [0.35, 1.2], [0.05, 1.35]], 12), p.accent, tx, 3.78, tz);
    part(g, cyl(0.04, 0.04, 0.7, 4), p.trim, tx, 5.4, tz);
    const orrery = spin(rep, holder(g, tx, 5.75, tz), 'y', 0.8);
    lit(part(orrery, sph(0.16, 8, 6), p.glow));
    part(orrery, ring(0.42, 0.025, 16), p.trim).rotation.x = Math.PI / 2 - 0.3;
    part(orrery, sph(0.07, 6, 4), mat('#5fb7ad'), 0.42, 0.12, 0);
    part(orrery, ring(0.28, 0.02, 14), p.trim).rotation.x = Math.PI / 2 + 0.5;
    part(orrery, sph(0.05, 6, 4), mat('#c4703a'), -0.27, -0.12, 0.05);
    // the chimney and its smoke
    part(g, box(0.35, 1.1, 0.35), mat('#9a8670'), hx - w * 0.2, 3.1, hz - h * 0.05);
    motes(rep, g, hx - w * 0.2, 3.7, hz - h * 0.05, { n: 4, h: 2.2, spread: 0.05, size: 0.22, material: see('#d8d4cc', 0.55), rate: 0.25, sway: 0.5 });
    // the chequered courtyard
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
      part(g, box(w * 0.1, 0.05, h * 0.1), (r + c) % 2 ? mat('#f2efe6') : mat('#5fa8b5'), -w * 0.3 + c * w * 0.1, 0.38, h * 0.1 + r * h * 0.1);
    }
    for (const [x, z, k] of [[-w * 0.44, -h * 0.4, 2.6], [-w * 0.44, h * 0.38, 2.2], [w * 0.15, h * 0.4, 2.0], [w * 0.45, -h * 0.42, 2.4]]) cypress(g, x, z, k);
    tree(g, w * 0.3, h * 0.25, 0.5);
  },
  /**
   * The Wind Workshop, after its sprite: a tall lodge of ribbed timber and canvas, a cone that
   * tapers to a spike, a great windmill at its side whose sails turn, hay and trees by it.
   */
  windWorkshop(rep, g, p, w, h) {
    const lx = -w * 0.1, lz = -h * 0.08;
    part(g, lathe('windlodge', [[2.0, 0], [1.95, 0.8], [1.6, 2.4], [1.05, 4.0], [0.45, 5.4], [0.04, 6.6]], 10), mat('#d9c39a'), lx, 0.35, lz);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      part(g, tube('windrib', [[2.02, 0, 0], [1.97, 0.8, 0], [1.62, 2.4, 0], [1.07, 4.0, 0], [0.47, 5.4, 0], [0.06, 6.6, 0]], 0.07, { n: 4 }), mat('#7a5534'), lx, 0.35, lz).rotation.y = -a;
    }
    for (const [y, r] of [[1.2, 1.88], [2.9, 1.42], [4.4, 0.86]]) part(g, ring(r, 0.07, 14), p.dark, lx, 0.35 + y, lz).rotation.x = Math.PI / 2;
    part(g, box(0.9, 1.3, 0.1), mat('#5a3d27'), lx, 0.95, lz + 1.95);
    part(g, box(1.1, 0.12, 0.3), p.dark, lx, 1.65, lz + 2.0);
    lit(part(g, box(0.25, 0.32, 0.05), glow('#fff3c0', '#ffc24a', 0.8), lx + 0.9, 2.1, lz + 1.6));
    part(g, cone(0.12, 0.8, 5), p.trim, lx, 7.2, lz);
    // the windmill: a timber tower, its cap and four sails
    const mx = w * 0.3, mz = -h * 0.12;
    part(g, cyl(0.55, 0.9, 3.6, 8), mat('#efe6cf'), mx, 2.1, mz);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      part(g, box(0.06, 3.6, 0.06), mat('#87603f'), mx + Math.cos(a) * 0.73, 2.1, mz + Math.sin(a) * 0.73).rotation.set(Math.sin(a) * 0.1, 0, -Math.cos(a) * 0.1);
    }
    part(g, cone(0.8, 1.0, 8), p.roof, mx, 4.4, mz);
    const sails = spin(rep, holder(g, mx, 3.6, mz + 0.75), 'z', 0.9, rep.id);
    part(sails, sph(0.14, 6, 4), p.dark);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2, spar = part(sails, box(0.1, 2.3, 0.08), p.dark), sail = part(sails, box(0.6, 1.7, 0.03), mat('#f3ecd8'));
      spar.rotation.z = a;
      spar.translateY(1.15);
      sail.rotation.z = a;
      sail.translateY(1.3);
      sail.translateX(0.36);
      sail.translateZ(0.03);
    }
    for (const [x, z] of [[-w * 0.42, h * 0.32], [-w * 0.32, h * 0.38], [w * 0.05, h * 0.4]]) part(g, cyl(0.28, 0.28, 0.5, 8), mat('#e2c56a'), x, 0.6, z).rotation.z = Math.PI / 2;
    for (const [x, z] of [[-w * 0.42, -h * 0.4], [w * 0.45, h * 0.1], [-w * 0.45, h * 0.05]]) tree(g, x, z, 0.55);
  },
  /**
   * The Rain Workshop, after its sprite: domes like bubbles of glass on a rock in a lagoon, white
   * ribs about them, a water wheel turning in a channel, bubbles rising from the water, pines.
   */
  rainWorkshop(rep, g, p, w, h) {
    part(g, box(w * 0.96, 0.08, h * 0.96), glow('#8fe3f5', '#1d8fb0', 0.45), 0, 0.33, 0);
    part(g, dodeca(1), p.stone, -w * 0.04, 0.35, -h * 0.06).scale.set(w * 0.36, 0.5, h * 0.33);
    const glass = see('#bfeaff', 0.5, { emissive: '#3ab0f0', emissiveIntensity: 0.45, roughness: 0.1 }), white = mat('#f2f6f8');
    for (const [x, z, r] of [[-w * 0.12, -h * 0.12, 1.55], [w * 0.15, -h * 0.18, 1.15], [-w * 0.3, h * 0.08, 0.95], [w * 0.05, h * 0.12, 0.8]]) {
      part(g, cyl(r * 1.02, r * 1.05, 0.3, 14), p.stone, x, 0.75, z);
      lit(pulsing(rep, part(g, sph(r * 0.35, 8, 6), glow('#c8f2ff', '#29a8ff', 0.8), x, 0.9 + r * 0.35, z), 0.4, 1.3, 1.6 + r));
      part(g, dome(r), glass, x, 0.9, z);
      for (let i = 0; i < 3; i++) {
        const rib = part(g, shape(`rib${r}`, () => new THREE.TorusGeometry(r, 0.05, 4, 12, Math.PI)), white, x, 0.9, z);
        rib.rotation.y = (i / 3) * Math.PI;
      }
      part(g, cone(0.08, 0.5, 5), white, x, 0.9 + r + 0.2, z);
    }
    // the water wheel in its channel
    part(g, box(0.6, 0.35, h * 0.7), p.dark, w * 0.4, 0.5, 0);
    part(g, box(0.44, 0.06, h * 0.68), glow('#8fe3f5', '#1d8fb0', 0.6), w * 0.4, 0.66, 0);
    part(g, box(0.1, 1.6, 0.1), p.dark, w * 0.4, 1.2, -h * 0.1 + 0.95);
    const wheel = spin(rep, holder(g, w * 0.4, 1.35, -h * 0.1), 'x', 0.8);
    part(wheel, ring(0.9, 0.07, 16), white).rotation.y = Math.PI / 2;
    for (let i = 0; i < 8; i++) part(wheel, box(0.3, 0.08, 1.8), p.trim).rotation.x = (i / 8) * Math.PI;
    motes(rep, g, -w * 0.25, 0.4, h * 0.32, { n: 3, h: 1.4, spread: 0.6, size: 0.09, material: see('#ffffff', 0.7), rate: 0.4, sway: 0.1 });
    ripple(rep, g, w * 0.25, 0.39, h * 0.3, 0.2, 1.0, { material: see('#e8fbff', 0.5), rate: 0.4 });
    for (const [x, z, k] of [[-w * 0.44, -h * 0.4, 1], [w * 0.2, h * 0.42, 0.8], [-w * 0.05, -h * 0.44, 0.9], [w * 0.45, -h * 0.42, 1.1]]) {
      part(g, cone(0.55 * k, 1.8 * k, 6), mat('#2f5a3a'), x, 0.4 + 0.9 * k + 0.2, z);
      part(g, cone(0.4 * k, 1.2 * k, 6), mat('#3a6e45'), x, 0.4 + 1.6 * k + 0.2, z);
    }
  },
  /**
   * The Thunder Workshop, after its sprite: a citadel of dark domes on an apron of rust-red
   * thorns, its great dome crowned with a rod whose orb lightning leaps to from a coil tower,
   * furnace light in its slits, dark pines by its walls.
   */
  thunderWorkshop(rep, g, p, w, h) {
    const domeMat = mat('#4a4458', { metalness: 0.55, roughness: 0.3 }), silver = metal('#b8b4c4'), rust = mat('#7a3a2a');
    part(g, cyl(1, 1.05, 0.25, 16), rust, -w * 0.05, 0.45, -h * 0.05).scale.set(w * 0.42, 1, h * 0.4);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, x = -w * 0.05 + Math.cos(a) * w * 0.4, z = -h * 0.05 + Math.sin(a) * h * 0.38;
      const thorn = part(g, cone(0.16, 0.9, 4), rust, x, 0.75, z);
      thorn.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
    }
    const cx = -w * 0.05, cz = -h * 0.08;
    part(g, cyl(1.6, 1.75, 1.6, 14), p.stone, cx, 1.35, cz);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.2;
      lit(part(g, box(0.18, 0.7, 0.05), glow('#ffb05a', '#ff6a1a', 1.1), cx + Math.cos(a) * 1.66, 1.35, cz + Math.sin(a) * 1.66)).rotation.y = -a + Math.PI / 2;
    }
    part(g, ring(1.66, 0.08, 20), p.trim, cx, 2.15, cz).rotation.x = Math.PI / 2;
    part(g, dome(1.6), domeMat, cx, 2.15, cz);
    part(g, cone(0.1, 1.6, 6), silver, cx, 4.5, cz);
    const top = [cx, 5.4, cz];
    lit(pulsing(rep, part(g, sph(0.2, 10, 8), p.glow, ...top), 0.6, 2.4, 6));
    for (const [x, z, r] of [[-w * 0.33, -h * 0.28, 0.6], [w * 0.2, h * 0.22, 0.55], [-w * 0.32, h * 0.2, 0.5]]) {
      part(g, cyl(r, r * 1.08, 1.8, 10), p.dark, x, 1.2, z);
      part(g, dome(r * 1.05), domeMat, x, 2.1, z);
      part(g, cone(0.05, 0.7, 4), silver, x, 2.1 + r + 0.3, z);
    }
    // the coil tower, its lightning leaping to the great dome's rod
    const kx = w * 0.32, kz = -h * 0.2;
    part(g, cyl(0.3, 0.45, 3.4, 8), p.dark, kx, 2.0, kz);
    for (let i = 0; i < 5; i++) part(g, ring(0.46 - i * 0.04, 0.07, 14), p.trim, kx, 1.1 + i * 0.6, kz).rotation.x = Math.PI / 2;
    lit(pulsing(rep, part(g, sph(0.3, 10, 8), p.glow, kx, 4.0, kz), 0.5, 2.2, 8));
    zap(rep, g, [kx, 4.0, kz], top, { rate: 6, share: 0.5, jag: 0.35 });
    part(g, cyl(0.22, 0.3, 2.4, 8), mat('#2c2833'), w * 0.05, 3.0, -h * 0.38);
    motes(rep, g, w * 0.05, 4.2, -h * 0.38, { n: 3, h: 2.2, spread: 0.05, size: 0.24, material: see('#5a5464', 0.6), rate: 0.25, sway: 0.5 });
    for (const [x, z, k] of [[-w * 0.46, -h * 0.42, 1], [w * 0.44, h * 0.05, 0.85], [-w * 0.46, h * 0.4, 0.9], [w * 0.35, -h * 0.44, 1]]) {
      part(g, cone(0.5 * k, 1.9 * k, 5), mat('#26402e'), x, 0.4 + 0.95 * k + 0.15, z);
    }
  },
  /**
   * The Outpost, after its sprite: a villa round a court under a dome of grey lead, terracotta
   * roofs on its wings, cypresses at its corners and a beacon burning over its gate.
   */
  outpost(rep, g, p, w, h) {
    const wall = mat('#ece2cf'), tile = mat('#b8553a');
    for (const [x, z, sx, sz] of [[0, -h * 0.3, w * 0.7, 0.8], [0, h * 0.3, w * 0.7, 0.8], [-w * 0.3, 0, 0.8, h * 0.6], [w * 0.3, 0, 0.8, h * 0.6]]) {
      part(g, box(sx, 1.3, sz), wall, x, 1.0, z);
      part(g, box(sx + 0.2, 0.3, sz + 0.2), tile, x, 1.75, z);
    }
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      part(g, box(0.95, 1.9, 0.95), wall, x * w * 0.32, 1.3, z * h * 0.32);
      part(g, pyramid(), tile, x * w * 0.32, 2.25, z * h * 0.32).scale.set(1.15, 0.6, 1.15);
    }
    part(g, cyl(1.0, 1.05, 0.9, 12), wall, 0, 1.6, 0);
    part(g, lathe('outdome', [[1.05, 0], [1.0, 0.45], [0.75, 0.95], [0.35, 1.25], [0.05, 1.35]], 12), mat('#8d929c', { metalness: 0.4, roughness: 0.4 }), 0, 2.05, 0);
    part(g, box(0.7, 1.0, 0.1), mat('#5a3d27'), 0, 0.85, h * 0.3 + 0.41);
    part(g, cyl(0.06, 0.08, 0.4, 5), p.trim, 0, 3.55, 0);
    part(g, lathe('firecup', [[0.08, 0], [0.32, 0.18], [0.36, 0.3]], 7), p.trim, 0, 3.7, 0);
    flame(rep, g, 0, 3.9, 0, 0.5);
    for (const [x, z] of [[-w * 0.47, -h * 0.45], [w * 0.47, -h * 0.45], [-w * 0.47, h * 0.45], [w * 0.47, h * 0.45]]) cypress(g, x, z, 2.4);
  },

  altar(rep, g) {
    // after its sprite: a round dais with four lobes, two great tusks curving over it, a ring of
    // runes turning above a fire in its heart
    part(g, cyl(3.2, 3.4, 0.4, 16), mat('#d8c9a8'), 0, 0.2, 0);
    part(g, cyl(2.5, 2.7, 0.25, 16), mat('#c4b38f'), 0, 0.52, 0);
    part(g, cyl(2.2, 2.2, 0.08, 20), mat('#b08d64'), 0, 0.68, 0);
    part(g, ring(2.2, 0.08, 24), metal('#d9a63a'), 0, 0.72, 0).rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4, x = Math.cos(a) * 3.0, z = Math.sin(a) * 3.0;
      part(g, cyl(0.85, 0.95, 0.5, 12), mat('#c99a6a'), x, 0.25, z);
      part(g, ring(0.85, 0.06, 14), metal('#d9a63a'), x, 0.5, z).rotation.x = Math.PI / 2;
      part(g, lathe('firecup', [[0.08, 0], [0.32, 0.18], [0.36, 0.3]], 7), metal('#d9a63a'), x, 0.5, z);
      flame(rep, g, x, 0.75, z, 0.4);
    }
    for (const s of [-1, 1]) {
      // a tusk: up from the rim and over toward the middle, ivory banded with gold
      const pts = [[s * 2.6, 0.4, 0], [s * 3.0, 2.0, 0.2], [s * 2.5, 3.6, 0.3], [s * 1.4, 4.4, 0.2], [s * 0.6, 4.3, 0]];
      part(g, tube(`tusk${s}`, pts, 0.38, { n: 7, tip: 0.12 }), mat('#efe3c8'));
      for (const k of [0.15, 0.3]) {
        const at = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))).getPointAt(k);
        part(g, ring(0.38 * (1 - 0.88 * k) + 0.02, 0.06, 10), metal('#d9a63a'), at.x, at.y, at.z).rotation.set(Math.PI / 2, 0, s * 0.35);
      }
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const s = part(g, cone(0.25, 1.6, 5), mat('#c99a6a'), Math.cos(a) * 2.45, 1.4, Math.sin(a) * 2.45);
      s.rotation.z = Math.cos(a) * 0.3;
      s.rotation.x = -Math.sin(a) * 0.3;
    }
    part(g, cyl(0.7, 0.5, 0.5, 8), mat('#6d5a48'), 0, 0.95, 0);
    flame(rep, g, 0, 1.15, 0, 1.0);
    const runes = spin(rep, holder(g, 0, 2.6, 0), 'y', 0.6);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      lit(part(runes, box(0.22, 0.32, 0.04), glow('#ffd08a', '#ff8a1a', 1.4), Math.cos(a) * 1.3, Math.sin(i * 2.2) * 0.08, Math.sin(a) * 1.3)).rotation.y = -a + Math.PI / 2;
    }
    motes(rep, g, 0, 1.6, 0, { n: 5, h: 2.6, spread: 0.4, size: 0.06, material: glow('#ffd08a', '#ff7a1a', 2), rate: 0.5, sway: 0.3 });
  },

  /* -------------------------------------- Generators ---------------------------------------- */
  generator(rep, g, e) {
    const f = furyOf(e), p = kit(e);
    part(g, cyl(1.15, 1.28, 0.4, 8), p.dark, 0, 0.2, 0);
    band(rep, g, 1.17, 0.42, 8);
    if (f === 'wind') {
      // after its sprite: a golden crystal over a stepped shrine of grey stone, and round it a
      // ring of little sails the wind turns, as it feeds the crystal
      part(g, cyl(0.95, 1.05, 0.4, 8), mat('#a9a49a'), 0, 0.6, 0);
      part(g, cyl(0.68, 0.8, 0.5, 8), mat('#c2bdb2'), 0, 1.05, 0);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        part(g, box(0.16, 1.4, 0.16), mat('#d8d2c4'), Math.cos(a) * 0.62, 1.8, Math.sin(a) * 0.62);
      }
      part(g, cyl(0.8, 0.8, 0.1, 8), mat('#a9a49a'), 0, 2.5, 0);
      part(g, box(0.36, 0.9, 0.04), mat('#eef4f8'), 0, 1.75, 0.66);
      const gem = holder(g, 0, 3.2, 0);
      rep.anim.push((s) => { gem.position.y = 3.2 + Math.sin(s * 1.6 + rep.id) * 0.12; gem.rotation.y = s * 0.7; });
      lit(part(gem, octa(0.42), glow('#ffe38a', '#ffb000', 1.2))).scale.set(0.8, 1.8, 0.8);
      const sails = spin(rep, holder(g, 0, 3.0, 0), 'y', 2.2, rep.id);
      part(sails, ring(0.95, 0.03, 18), mat('#87603f')).rotation.x = Math.PI / 2;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2, x = Math.cos(a) * 0.95, z = Math.sin(a) * 0.95;
        part(sails, box(0.04, 0.6, 0.04), mat('#87603f'), x, 0, z);
        part(sails, box(0.03, 0.5, 0.42), mat('#efe6cf'), x, 0.02, z).rotation.y = -a + 0.6;
      }
    } else if (f === 'rain') {
      // after its sprite: a spire of blue crystal out of a mound of bubbles, glowing as it fills,
      // ripples round its foot and drops rising
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2, r = 0.32 + (i % 3) * 0.06;
        part(g, sph(r, 10, 8), mat('#6f9fc0', { roughness: 0.3, metalness: 0.2 }), Math.cos(a) * 0.72, 0.55 + (i % 2) * 0.12, Math.sin(a) * 0.72);
      }
      part(g, sph(0.6, 12, 8), mat('#8fb6cf', { roughness: 0.3 }), 0, 0.75, 0).scale.y = 0.7;
      lit(pulsing(rep, part(g, octa(0.5), glow('#bff0ff', '#29a8ff', 1), 0, 2.1, 0), 0.6, 1.6, 2)).scale.set(0.75, 2.6, 0.75);
      for (const [x, z, k] of [[0.35, 0.15, 0.5], [-0.3, 0.25, 0.4], [0.05, -0.38, 0.45]]) {
        part(g, octa(0.3 * k + 0.1), glow('#d8f6ff', '#4ac0f0', 0.8), x, 1.15, z).scale.set(0.8, 2.2, 0.8);
      }
      ripple(rep, g, 0, 0.45, 0, 1.0, 1.6, { material: see('#c8f2ff', 0.55), rate: 0.4 });
      motes(rep, g, 0, 1.1, 0, { n: 3, h: 2.2, spread: 0.5, size: 0.07, material: glow('#e8fbff', '#5ad0ff', 1.2), rate: 0.5, sway: 0.1 });
    } else if (f === 'thunder') {
      // after its sprite: a great crystal of red fire in silver claws on a dark plinth, sparks
      // leaping from it to the claws' tips
      part(g, cyl(0.8, 1.05, 0.7, 4), mat('#3a2c33'), 0, 0.75, 0).rotation.y = Math.PI / 4;
      part(g, cyl(0.62, 0.72, 0.25, 8), metal('#c27a3e'), 0, 1.2, 0);
      const tips = [];
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5, c = Math.cos(a), sn = Math.sin(a);
        const pts = [[c * 0.6, 1.2, sn * 0.6], [c * 0.85, 1.9, sn * 0.85], [c * 0.62, 2.7, sn * 0.62], [c * 0.25, 3.1, sn * 0.25]];
        part(g, tube(`tclaw${i}`, pts, 0.09, { n: 5, tip: 0.3 }), metal('#c9c6d2'));
        tips.push(pts[3]);
      }
      lit(pulsing(rep, part(g, octa(0.55), glow('#ff8a5a', '#ff3a10', 1), 0, 2.15, 0), 0.7, 2.0, 2.6)).scale.set(0.8, 1.7, 0.8);
      tips.forEach((tip, i) => zap(rep, g, [0, 2.6, 0], tip, { seed: i, rate: 5, share: 0.25, jag: 0.08, r: 0.025, color: '#ffd0a0' }));
    } else {
      // after its sprite: a sunflower of bronze panels on a stem, its face turned up to the sky,
      // that follows the sun round as it feeds on it
      part(g, cyl(0.7, 0.9, 0.7, 8), p.stone, 0, 0.75, 0);
      part(g, cyl(0.1, 0.16, 1.6, 6), metal('#6b5a44'), 0, 1.7, 0);
      for (const s of [-1, 1]) part(g, cone(0.25, 0.6, 3), mat('#6f9a3a', { side: THREE.DoubleSide }), s * 0.25, 1.4, 0).rotation.set(0, 0, s * -1.1);
      const face = holder(g, 0, 2.55, 0);
      rep.anim.push((s) => { face.rotation.set(0.85 + Math.sin(s * 0.31 + rep.id) * 0.1, Math.sin(s * 0.2 + rep.id) * 0.7, 0, 'YXZ'); });
      const turned = face;
      lit(pulsing(rep, part(turned, cyl(0.38, 0.38, 0.12, 12), glow('#ffd24a', '#ff9a00', 1), 0, 0.02, 0), 0.6, 1.4, 1.5));
      part(turned, cyl(0.42, 0.42, 0.08, 12), mat('#4a3a2c'), 0, -0.06, 0);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const petal = part(turned, box(0.5, 0.05, 0.8), i % 2 ? metal('#c9963a') : metal('#a8783a'), Math.cos(a) * 0.8, -0.02, Math.sin(a) * 0.8);
        petal.rotation.set(0, -a + Math.PI / 2, 0);
        petal.rotateX(0.18);
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
      // the Ice Cannon, after its sprite: a scallop shell of pale blue, ribbed, a crown of silver on
      // its back, a barrel of ice laid out of its lip, frost drifting down about it
      for (let i = 0; i < 12; i++) {
        const rib = part(turret, lune(0.95, i, 12, Math.PI / 2), mat(i % 2 ? '#9fcfe0' : '#d2f0fa', { roughness: 0.35 }), 0, 0.1, -0.1);
        rib.scale.set(1 + (i % 2) * 0.05, 0.85, 1 + (i % 2) * 0.05);
      }
      for (let i = 0; i < 12; i++) {
        const a = ((i + 0.5) / 12) * Math.PI * 2;
        part(turret, sph(0.14, 6, 4), mat('#e8f8ff'), Math.cos(a) * 0.95, 0.12, Math.sin(a) * 0.95 - 0.1);
      }
      part(turret, cyl(0.32, 0.38, 0.4, 10), metal('#c8ccd8'), 0, 0.95, -0.25);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        part(turret, cone(0.06, 0.3, 4), metal('#e8ecf4'), Math.cos(a) * 0.3, 1.27, Math.sin(a) * 0.3 - 0.25);
      }
      lit(pulsing(rep, part(turret, sph(0.14, 8, 6), glow('#e8fbff', '#5ad0ff', 1), 0, 1.25, -0.25), 0.5, 1.6, 2));
      part(barrel, cyl(0.2, 0.3, 2.0, 6), mat('#bfe8f5', { emissive: '#3aa8d8', emissiveIntensity: 0.45, roughness: 0.15 }));
      part(barrel, lathe('icemuzzle', [[0.2, 0], [0.32, 0.12], [0.28, 0.25], [0.16, 0.22]], 8), mat('#e8f8ff', { emissive: '#5ad0ff', emissiveIntensity: 0.5 }), 0, 0.95, 0);
      for (let i = 0; i < 4; i++) part(barrel, cone(0.08, 0.4, 4), mat('#e8f8ff'), Math.cos(i * 1.57) * 0.28, -0.3 + i * 0.3, Math.sin(i * 1.57) * 0.28).rotation.set(Math.sin(i * 1.57) * 0.9, 0, -Math.cos(i * 1.57) * 0.9);
      motes(rep, g, 0, 0.4, 0, { n: 4, h: 1.6, spread: 1.2, size: 0.06, material: see('#ffffff', 0.85), rate: 0.3, sway: 0.2, fall: true });
    } else if (f === 'thunder') {
      MODELS.dragon(rep, g, turret, barrel);
    } else {
      // the Sun Cannon, after its sprite: a great ball of black iron on four bronze legs bent like
      // a crab's, a short gun with a flared mouth, and on its back a vent that flares as it fires
      const bronze = metal('#a8783a'), iron = mat('#2e2b2a', { metalness: 0.5, roughness: 0.35 });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        part(turret, tube('sunleg', [[0.4, 0.75, 0], [0.9, 0.85, 0], [1.08, 0.35, 0], [1.1, -0.02, 0]], 0.08, { n: 5 }), bronze).rotation.y = -a;
        part(turret, sph(0.12, 6, 4), metal('#d9a63a'), Math.cos(a) * 1.1, 0, Math.sin(a) * 1.1);
      }
      part(turret, sph(0.66, 14, 10), iron, 0, 0.85, 0);
      part(turret, ring(0.67, 0.05, 20), metal('#d9a63a'), 0, 0.85, 0).rotation.x = Math.PI / 2;
      part(turret, ring(0.5, 0.04, 16), metal('#d9a63a'), 0, 1.28, 0).rotation.x = Math.PI / 2;
      part(turret, cyl(0.13, 0.17, 0.45, 6), iron, 0, 1.55, -0.3);
      const vent = lit(moving(part(turret, cyl(0.11, 0.11, 0.05, 6), glow('#ffcf6a', '#ff7a1a', 0.6), 0, 1.79, -0.3)));
      vent.material = vent.material.clone();
      rep.own.push(vent.material);
      rep.anim.push((s, en) => { const k = since(en); vent.material.emissiveIntensity = k < 10 ? 3.2 - k * 0.27 : 0.5 + 0.2 * Math.sin(s * 3 + rep.id); });
      part(barrel, cyl(0.27, 0.32, 1.5, 10), iron, 0, 0.15, 0);
      part(barrel, lathe('sunmuzzle', [[0.27, 0], [0.4, 0.22], [0.38, 0.3], [0.24, 0.28]], 10), bronze, 0, 0.88, 0);
      part(barrel, ring(0.3, 0.05, 12), metal('#d9a63a'), 0, 0.5, 0).rotation.x = Math.PI / 2;
      part(barrel, ring(0.33, 0.05, 12), metal('#d9a63a'), 0, -0.3, 0).rotation.x = Math.PI / 2;
    }
  },
  /**
   * The Thunder Cannon, the mightiest gun of the game, after its sprite: a silver dragon's torso
   * reared on a drum of red stone, its ribbed neck stretched toward the way it was laid, spiked down
   * the spine, horned, and its great bat wings spread wide. As it charges its eyes kindle and its
   * jaw drops; as the shot leaves it spits fire and its head jerks back (ns-units: rep.dragon).
   */
  dragon(rep, g, turret, barrel) {
    turret.remove(barrel);
    rep.barrel = null;
    const silver = metal('#a39fae'), dark = mat('#34303c'), bone = metal('#ddd8e4'), red = mat('#6e3a2b');
    // the drum and the claws that grip its rim
    part(turret, cyl(1.22, 1.36, 0.55, 14), red, 0, 0.0, 0);
    part(turret, ring(1.24, 0.07, 18), metal('#c27a3e'), 0, 0.27, 0).rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) {
      for (const dz of [0.55, 0.8]) part(turret, cone(0.07, 0.42, 5), bone, s * 0.42 + s * (dz - 0.55) * 0.6, 0.3, dz).rotation.x = Math.PI;
      part(turret, box(0.18, 0.5, 0.18), silver, s * 0.42, 0.55, 0.62).rotation.x = 0.4;
    }
    // the chest and a tail curled behind
    part(turret, sph(0.62, 10, 8), silver, 0, 0.95, 0.05).scale.set(1.05, 0.95, 1.25);
    for (let i = 0; i < 4; i++) {
      const seg = part(turret, box(0.34 - i * 0.06, 0.28 - i * 0.04, 0.42), dark, Math.sin(i * 0.9) * 0.25, 0.6 - i * 0.08, -0.65 - i * 0.36);
      seg.rotation.y = Math.sin(i * 0.9) * 0.5;
    }
    // the neck: plated segments rising forward, a spike on each
    const neck = [[0, 1.35, 0.35], [0, 1.68, 0.62], [0, 1.98, 0.88], [0, 2.2, 1.16], [0, 2.34, 1.42]];
    neck.forEach(([x, y, z], i) => {
      const next = neck[i + 1] ?? [x, y + 0.05, z + 0.3];
      const seg = part(turret, box(0.4 - i * 0.03, 0.34 - i * 0.02, 0.42), i % 2 ? silver : dark, x, y, z);
      seg.rotation.x = -Math.atan2(next[1] - y, next[2] - z);
      part(turret, cone(0.07, 0.48 - i * 0.05, 4), bone, x, y + 0.28, z - 0.05).rotation.x = -0.55;
    });
    // the head, its jaw and its fire: a holder that jerks back as it spits
    const head = holder(turret, 0, 2.42, 1.62);
    head.rotation.x = 0.12;
    part(head, box(0.42, 0.32, 0.62), silver, 0, 0.04, 0.12);
    part(head, box(0.32, 0.16, 0.5), silver, 0, 0.02, 0.62);
    part(head, box(0.34, 0.06, 0.12), dark, 0, 0.13, 0.36);
    for (const s of [-1, 1]) {
      part(head, cone(0.07, 0.75, 5), bone, s * 0.15, 0.24, -0.12).rotation.set(-1.15, 0, s * -0.25);
      part(head, cone(0.04, 0.36, 4), bone, s * 0.22, 0.05, -0.2).rotation.set(-1.4, 0, s * -0.6);
      for (let t = 0; t < 3; t++) part(head, cone(0.025, 0.12, 3), bone, s * 0.12, -0.08, 0.5 + t * 0.14).rotation.x = Math.PI;
    }
    const eyes = moving(part(head, box(0.44, 0.07, 0.07), mat('#ffb347', { emissive: '#ff5a00', emissiveIntensity: 0.6 }), 0, 0.12, 0.3));
    eyes.material = eyes.material.clone();
    rep.own.push(eyes.material);
    const jaw = holder(head, 0, -0.12, 0.2);
    part(jaw, box(0.28, 0.08, 0.6), dark, 0, 0, 0.3);
    for (const s of [-1, 1]) for (let t = 0; t < 3; t++) part(jaw, cone(0.025, 0.12, 3), bone, s * 0.1, 0.07, 0.3 + t * 0.14);
    // the fire it spits: an outer flame and a white-hot core, along the way it faces
    const fire = holder(head, 0, -0.02, 0.88);
    fire.visible = false;
    for (const [r, len, c, e] of [[0.42, 2.4, '#ff6a1a', '#ff3a00'], [0.2, 1.6, '#fff1b0', '#ffd24a']]) {
      part(fire, cone(r, len, 8), mat(c, { emissive: e, emissiveIntensity: 2.2, transparent: true, opacity: 0.85 }), 0, 0, len / 2).rotation.x = -Math.PI / 2;
    }
    for (const m of fire.children) moving(m);
    // the wings, spread: bones out from each shoulder, a membrane between them
    const wings = [];
    for (const s of [-1, 1]) {
      const wing = holder(turret, s * 0.5, 1.45, 0.05);
      wings.push(wing);
      const tips = [[1.0, 1.7, -0.25], [2.2, 1.1, -0.35], [2.75, 0.2, -0.4], [2.15, -0.6, -0.35]].map(([x, y, z]) => [s * x, y, z]);
      for (const [x, y, z] of tips) {
        const len = Math.hypot(x, y, z);
        const b = part(wing, cyl(0.035, 0.07, len, 5), bone, x / 2, y / 2, z / 2);
        b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x, y, z).normalize());
      }
      part(wing, shape(`wing${s}`, () => {
        const v = [];
        for (let i = 0; i < tips.length - 1; i++) {
          const [a, b] = [tips[i], tips[i + 1]];
          // the trailing edge sags between two bones
          const mid = [(a[0] + b[0]) * 0.36, (a[1] + b[1]) * 0.36, (a[2] + b[2]) / 2];
          v.push(0, 0, 0, ...a, ...mid, 0, 0, 0, ...mid, ...b);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
        geo.computeVertexNormals();
        return geo;
      }), mat('#8d8698', { side: THREE.DoubleSide, roughness: 0.6 }));
    }
    rep.dragon = { head, headZ: head.position.z, jaw, fire, eyes, wings };
  },
  archer(rep, g, e) {
    const f = furyOf(e), p = kit(e);
    part(g, cyl(1.1, 1.22, 0.45, 10), p.dark, 0, 0.22, 0);
    band(rep, g, 1.12, 0.47, 10);
    const turret = holder(g, 0, 0.5, 0);
    rep.turret = turret;
    turret.rotation.y = FACING_YAW[e.facing ?? 2];
    if (f === 'wind') {
      // the Crossbow, after its sprite: a ballista on a round deck of golden timber, its arms of
      // horn bent back, a winch at its tail. As it looses, its arms spring forward and its string
      // runs straight; then the winch turns and draws it back, and a new bolt is laid in it.
      part(turret, cyl(1.0, 1.05, 0.22, 16), mat('#d9b46a'), 0, 0.11, 0);
      part(turret, ring(0.99, 0.05, 20), metal('#c9a14a'), 0, 0.22, 0).rotation.x = Math.PI / 2;
      part(turret, ring(0.6, 0.03, 16), mat('#a8834f'), 0, 0.23, 0).rotation.x = Math.PI / 2;
      part(turret, box(0.55, 0.55, 0.7), mat('#6f4e33'), 0, 0.5, -0.1);
      part(turret, box(0.3, 0.22, 2.4), mat('#a87a50'), 0, 1.0, 0.35);
      part(turret, box(0.5, 0.3, 0.3), mat('#5a3d27'), 0, 1.1, 1.3);
      const C = [0, 1.12, 1.3], T = (s) => [s * 1.18, 1.12, 0.95], N = [0, 1.12, 0.25];
      const arms = [-1, 1].map((s) => {
        const arm = holder(turret, s * 0.15, C[1], C[2]);
        part(arm, tube(`bowarm${s}`, [[0, 0, 0], [s * 0.55, 0, 0.02], [s * 0.95, 0, -0.12], [s * 1.03, 0, -0.35]], 0.08, { n: 5, tip: 0.55 }), mat('#4a3324'));
        part(arm, sph(0.07, 6, 4), metal('#c0c0c0'), s * 1.03, 0, -0.35);
        return { arm, s };
      });
      const string = (from, to, key) => {
        const [dx, dz] = [to[0] - from[0], to[2] - from[2]], len = Math.hypot(dx, dz);
        const m = moving(part(turret, box(0.03, 0.03, len), mat('#f3ecd8'), (from[0] + to[0]) / 2, from[1], (from[2] + to[2]) / 2));
        m.rotation.y = Math.atan2(dx, dz);
        m.name = key;
        return m;
      };
      const drawn = [string(T(-1), N, 'l'), string(T(1), N, 'r')], loosed = string(T(-1), T(1), 'x');
      const bolt = holder(turret, 0, 1.2, 0.85);
      part(bolt, cyl(0.045, 0.045, 1.9, 5), mat('#8a6a4a')).rotation.x = Math.PI / 2;
      part(bolt, cone(0.12, 0.36, 4), metal('#c0c0c0'), 0, 0, 1.05).rotation.x = Math.PI / 2;
      for (const r of [0, Math.PI / 2]) part(bolt, box(0.2, 0.02, 0.22), team(rep), 0, 0, -0.8).rotation.z = r;
      const winch = holder(turret, 0, 0.95, -0.55);
      for (const s of [-1, 1]) part(winch, cyl(0.22, 0.22, 0.06, 8), mat('#5a3d27'), s * 0.3, 0, 0).rotation.z = Math.PI / 2;
      part(winch, cyl(0.08, 0.08, 0.6, 6), mat('#8a6a4a')).rotation.z = Math.PI / 2;
      for (let i = 0; i < 4; i++) part(winch, box(0.04, 0.34, 0.05), mat('#6f4e33'), 0.36, 0, 0).rotation.x = (i / 4) * Math.PI;
      rep.anim.push((s, en) => {
        const k = since(en), loose = k < 14, reload = k >= 14 && k < 40;
        for (const { arm, s: side } of arms) arm.rotation.y = loose ? -side * 0.22 * Math.max(0, 1 - k / 14) : 0;
        loosed.visible = loose;
        for (const m of drawn) m.visible = !loose;
        bolt.visible = !(k < 30);
        if (reload) winch.rotation.x = (k - 14) * 0.5;
      });
    } else {
      // the Disc Thrower, after its sprite: a white dome on a toothed rim, and on top a hooked
      // throwing arm that a spring whirls round about four times before it flings the golden disc
      // held in its hook (ns-units turns it, as the world's spin runs: rep.discArm)
      g.remove(turret);
      rep.turret = null;
      part(g, cyl(0.98, 1.02, 0.18, 16), p.accent, 0, 0.52, 0);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        part(g, box(0.2, 0.16, 0.24), p.trim, Math.cos(a) * 1.02, 0.52, Math.sin(a) * 1.02).rotation.y = -a;
      }
      part(g, dome(0.82), mat('#ece6d6'), 0, 0.6, 0);
      part(g, cyl(0.86, 0.86, 0.06, 16), p.trim, 0, 0.62, 0);
      part(g, cyl(0.1, 0.16, 0.7, 6), metal('#6b5a44'), 0, 1.6, 0);
      const arm = holder(g, 0, 1.95, 0);
      rep.discArm = arm;
      part(arm, sph(0.2, 8, 6), metal('#4a3a2c'));
      // the arm: out from the hub, bending as it goes, to a hook that cups the disc
      const wood = mat('#7a5a3c');
      for (const [x, z, len, turn] of [[0, 0.42, 0.62, 0], [0.12, 0.95, 0.5, 0.45], [0.36, 1.32, 0.42, 1.0]]) {
        part(arm, box(0.12, 0.12, len), wood, x, 0, z).rotation.y = turn;
      }
      part(arm, sph(0.09, 6, 4), metal('#c9a14a'), 0.06, 0, 0.7);
      part(arm, shape('dischook', () => new THREE.TorusGeometry(0.26, 0.05, 5, 10, Math.PI * 1.3)), metal('#c9a14a'), 0.42, 0, 1.62).rotation.set(Math.PI / 2, 0, -0.6);
      const disc = moving(part(arm, cyl(0.26, 0.26, 0.06, 14), glow('#ffe48a', '#e8a33a', 0.6), 0.42, 0, 1.62));
      rep.discOnArm = disc;
      rep.anim.push((s) => { disc.rotation.y = s * 5; });
    }
  },
  antiair(rep, g, e) {
    // the Vander Tower, after its sprite: twice the height of a Generator, a heavy square foot
    // with copper chevrons, a ribbed shaft, and four claws up round a great silver orb that
    // flashes as the tower fires (ns-units: rep.orb), nothing like the Thunder Generator's coil
    const dark = mat('#3a2c33'), stone = mat('#5e4852'), copper = metal('#c27a3e');
    part(g, cyl(1.5, 1.62, 0.5, 4), dark, 0, 0.25, 0).rotation.y = Math.PI / 4;
    part(g, cyl(0.95, 1.38, 1.35, 4), stone, 0, 1.17, 0).rotation.y = Math.PI / 4;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2, x = Math.sin(a) * 0.86, z = Math.cos(a) * 0.86;
      for (const s of [-1, 1]) {
        const v = part(g, box(0.42, 0.1, 0.06), copper, x + Math.cos(a) * s * 0.15, 1.05, z - Math.sin(a) * s * 0.15);
        v.rotation.set(-0.3, a, s * 0.55, 'YXZ');
      }
    }
    band(rep, g, 1.12, 0.52, 8);
    part(g, cyl(0.72, 0.8, 0.26, 12), copper, 0, 1.97, 0);
    part(g, cyl(0.46, 0.52, 1.5, 10), dark, 0, 2.85, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      part(g, box(0.13, 1.5, 0.13), stone, Math.cos(a) * 0.52, 2.85, Math.sin(a) * 0.52);
    }
    part(g, cyl(0.82, 0.58, 0.32, 12), copper, 0, 3.72, 0);
    for (let i = 0; i < 4; i++) {
      const claw = holder(g);
      claw.rotation.y = -((i / 4) * Math.PI * 2 + Math.PI / 4);
      part(claw, box(0.15, 0.8, 0.15), dark, 0.72, 4.18, 0).rotation.z = -0.42;
      part(claw, box(0.13, 0.78, 0.13), dark, 0.68, 4.86, 0).rotation.z = 0.55;
      part(claw, cone(0.08, 0.32, 4), copper, 0.42, 5.3, 0).rotation.z = 0.9;
    }
    const orb = moving(part(g, sph(0.64, 16, 12), mat('#f1f0f4', { metalness: 0.6, roughness: 0.22, emissive: '#8a86c8', emissiveIntensity: 0.15 }), 0, 4.62, 0));
    orb.material = orb.material.clone();
    rep.own.push(orb.material);
    rep.orb = orb;
  },

  /* --------------------------------------- Defences ----------------------------------------- */
  blocker(rep, g, e) {
    const f = furyOf(e), p = kit(e);
    if (f === 'wind') {
      // the Wind Tower: a timber lattice under a fan that turns, a curved shell on the side it was
      // laid facing ("on its curved back it is utterly invulnerable"), open on the other
      part(g, box(2.2, 0.3, 2.2), p.dark, 0, 0.15, 0);
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) part(g, cyl(0.08, 0.12, 2.8, 5), mat('#8a6040'), x * 0.8, 1.6, z * 0.8).rotation.set(-z * 0.12, 0, x * 0.12);
      for (const y of [1.0, 2.0]) for (const r of [0, Math.PI / 2]) part(g, box(1.6, 0.08, 0.08), mat('#6f4e33'), 0, y, 0).rotation.y = r;
      part(g, box(1.3, 0.14, 1.3), mat('#a87a50'), 0, 2.95, 0);
      part(g, cone(0.95, 0.7, 4), p.roof, 0, 3.4, 0).rotation.y = Math.PI / 4;
      const turned = holder(g);
      rep.turret = turned;
      turned.rotation.y = FACING_YAW[e.facing ?? 2];
      part(turned, shape('windshell', () => new THREE.CylinderGeometry(1.05, 1.45, 3.0, 9, 1, true, -1.8, 3.6)), mat('#a8834f', { side: THREE.DoubleSide }), 0, 1.75, 0);
      for (const a of [-1.65, -0.82, 0, 0.82, 1.65]) part(turned, box(0.12, 3.05, 0.1), p.trim, Math.sin(a) * 1.28, 1.75, Math.cos(a) * 1.28).rotation.set(-0.133, a, 0, 'YXZ');
      const fan = spin(rep, holder(turned, 0, 2.35, -0.75), 'z', 4, rep.id);
      for (let i = 0; i < 4; i++) {
        const b = part(fan, box(0.2, 0.75, 0.04), mat('#efe6cf'));
        b.rotation.z = (i / 4) * Math.PI * 2;
        b.translateY(0.4);
      }
      band(rep, g, 0.12, 3.85, 6);
    } else if (f === 'rain') {
      // the Ice Tower, after its sprite: a great drop of ice clear as glass on a dark pedestal, a
      // crystal turning in its heart, shards of ice at its foot and frost whirling round it
      part(g, dodeca(1.0), p.dark, 0, 0.35, 0).scale.set(1.25, 0.5, 1.25);
      part(g, lathe('icepedestal', [[0.95, 0], [0.8, 0.3], [0.45, 0.6], [0.55, 0.85], [0.75, 1.0]], 10), mat('#3c4c5e', { metalness: 0.3, roughness: 0.4 }), 0, 0.5, 0);
      part(g, ring(0.75, 0.05, 14), metal('#c8ccd8'), 0, 1.5, 0).rotation.x = Math.PI / 2;
      lit(pulsing(rep, part(g, octa(0.32), glow('#e8fbff', '#3ab0f0', 1.2), 0, 2.5, 0), 0.6, 1.8, 1.8)).scale.y = 1.8;
      part(g, lathe('icedrop', [[0.05, 0], [0.6, 0.12], [0.92, 0.6], [0.9, 1.3], [0.6, 2.1], [0.25, 2.7], [0.02, 3.1]], 14), see('#d8f4ff', 0.55, { emissive: '#4ab8e8', emissiveIntensity: 0.35, roughness: 0.05, metalness: 0.2 }), 0, 1.45, 0);
      const ice = mat('#cdeffc', { emissive: '#3aa8d8', emissiveIntensity: 0.25, roughness: 0.15 });
      for (const [a, h, r] of [[0.3, 1.1, 0.22], [1.9, 0.9, 0.2], [3.3, 1.2, 0.24], [4.6, 0.8, 0.18], [5.6, 1.0, 0.2]]) {
        part(g, cone(r, h, 5), ice, Math.cos(a) * 0.95, 0.55 + h / 2, Math.sin(a) * 0.95).rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
      }
      const frost = holder(g, 0, 0, 0);
      rep.anim.push((s) => { frost.rotation.y = s * 0.8 + rep.id; });
      for (let i = 0; i < 8; i++) part(frost, ico(0.06, 0), mat('#ffffff', { emissive: '#bfefff', emissiveIntensity: 0.8 }), Math.cos(i * 0.8) * 1.25, 1.2 + i * 0.35, Math.sin(i * 0.8) * 1.25);
      band(rep, g, 1.0, 0.45, 9);
    } else if (f === 'thunder') {
      // the Bulwark, after its sprite: a keep of red brick on a heavy foot, an arched gate of iron
      // with a furnace's light behind it, a ribbed dome of dark metal with a spike on its crown,
      // buttresses capped with copper spikes, light in its slits
      const brick = mat('#8a4a3a'), iron = mat('#3a3443', { metalness: 0.5, roughness: 0.35 });
      part(g, box(2.6, 0.45, 2.6), p.dark, 0, 0.22, 0);
      part(g, cyl(1.15, 1.4, 2.1, 8), brick, 0, 1.5, 0).rotation.y = Math.PI / 8;
      for (const y of [0.95, 1.65, 2.35]) part(g, cyl(1.42 - (y - 0.45) * 0.12, 1.44 - (y - 0.45) * 0.12, 0.08, 8), mat('#6e3a2b'), 0, y, 0).rotation.y = Math.PI / 8;
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const b = part(g, box(0.4, 2.1, 0.4), p.dark, x * 0.98, 1.3, z * 0.98);
        b.rotation.set(z * 0.12, Math.PI / 4, -x * 0.12, 'YXZ');
        part(g, cone(0.12, 0.6, 5), p.trim, x * 0.9, 2.65, z * 0.9);
      }
      part(g, box(0.75, 1.0, 0.12), iron, 0, 0.95, 1.3);
      part(g, cyl(0.375, 0.375, 0.12, 10), iron, 0, 1.45, 1.3).rotation.x = Math.PI / 2;
      lit(pulsing(rep, part(g, box(0.55, 0.85, 0.04), glow('#ffb05a', '#ff6a1a', 1), 0, 0.9, 1.37), 0.5, 1.4, 3));
      for (let i = 0; i < 5; i++) part(g, box(0.05, 0.85, 0.05), iron, -0.24 + i * 0.12, 0.9, 1.4);
      for (const r of [Math.PI / 2, Math.PI, -Math.PI / 2]) lit(part(g, box(0.1, 0.45, 0.05), p.glow, Math.sin(r) * 1.27, 1.8, Math.cos(r) * 1.27)).rotation.y = r;
      part(g, cyl(1.2, 1.2, 0.18, 12), p.trim, 0, 2.6, 0);
      part(g, dome(1.12), iron, 0, 2.68, 0);
      for (let i = 0; i < 8; i++) {
        const rib = part(g, shape('bulwarkrib', () => new THREE.TorusGeometry(1.14, 0.05, 4, 8, Math.PI / 2)), p.trim, 0, 2.68, 0);
        rib.rotation.y = (i / 8) * Math.PI * 2;
      }
      part(g, cone(0.12, 1.0, 6), metal('#b8b4c4'), 0, 4.2, 0);
      lit(pulsing(rep, part(g, sph(0.1, 6, 4), p.glow, 0, 4.75, 0), 0.6, 2, 5));
      part(g, ring(1.6, 0.065, 4), team(rep), 0, 0.46, 0).rotation.set(Math.PI / 2, 0, Math.PI / 4);
    } else {
      // the Stone Tower, after its sprite: a round tower of sandstone, battlemented, a lantern on
      // its top whose light glows, crowned by a dome of verdigris; the owner's pennant over it all
      part(g, cyl(1.25, 1.35, 0.4, 12), p.dark, 0, 0.2, 0);
      part(g, lathe('stonetower', [[1.05, 0], [0.95, 0.5], [0.84, 2.6], [0.9, 2.8]], 12), p.stone, 0, 0.4, 0);
      for (const y of [1.3, 2.3]) part(g, ring(0.9 - (y - 0.9) * 0.04, 0.05, 14), p.dark, 0, y, 0).rotation.x = Math.PI / 2;
      for (const a of [0.4, 2.5, 4.4]) part(g, box(0.16, 0.42, 0.06), mat('#3a3330'), Math.sin(a) * 0.9, 1.8, Math.cos(a) * 0.9).rotation.y = a;
      part(g, box(0.45, 0.75, 0.08), mat('#5a3d27'), 0, 0.75, 1.0);
      part(g, cyl(1.08, 0.9, 0.3, 12), p.trim, 0, 3.35, 0);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        part(g, box(0.28, 0.32, 0.2), p.stone, Math.cos(a) * 0.98, 3.65, Math.sin(a) * 0.98).rotation.y = -a;
      }
      lit(pulsing(rep, part(g, cyl(0.52, 0.52, 0.45, 10), glow('#ffe39a', '#ffb43a', 1), 0, 3.8, 0), 0.4, 1.2, 1.3));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        part(g, box(0.12, 0.5, 0.12), p.stone, Math.cos(a) * 0.56, 3.8, Math.sin(a) * 0.56);
      }
      part(g, cyl(0.68, 0.68, 0.1, 10), p.trim, 0, 4.06, 0);
      part(g, lathe('stoneonion', [[0.66, 0], [0.74, 0.25], [0.6, 0.6], [0.3, 0.95], [0.08, 1.2], [0.02, 1.35]], 12), p.accent, 0, 4.1, 0);
      banner(rep, g, 0, 0, 5.9, 0.6);
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
      // the Acid Barricade, after its sprite: a goblet of stone over a basin, a bowl of acid on top
      // that bubbles, a spout that pours it into the basin below, where it glows and ripples
      const acid = glow('#b8ff6a', '#4fd02a', 0.9);
      part(g, cyl(1.25, 1.35, 0.4, 14), p.stone, 0, 0.2, 0);
      part(g, ring(1.2, 0.07, 18), p.trim, 0, 0.42, 0).rotation.x = Math.PI / 2;
      part(g, cyl(1.08, 1.08, 0.05, 14), acid, 0, 0.42, 0);
      part(g, lathe('goblet', [[0.38, 0], [0.2, 0.3], [0.15, 1.15], [0.3, 1.45], [0.72, 1.75], [0.8, 2.0], [0.7, 2.02]], 12), mat('#b7c7d4'), 0, 0.4, 0);
      part(g, ring(0.78, 0.05, 16), p.trim, 0, 2.4, 0).rotation.x = Math.PI / 2;
      lit(pulsing(rep, part(g, cyl(0.7, 0.7, 0.06, 12), glow('#c8ff7a', '#5fe02a', 1), 0, 2.36, 0), 0.6, 1.4, 2.5));
      motes(rep, g, 0, 2.4, 0, { n: 3, h: 0.5, spread: 0.45, size: 0.08, material: glow('#d8ff9a', '#6fe03a', 1.2), rate: 0.9, sway: 0.05 });
      part(g, tube('acidspout', [[0.1, 1.4, 0], [0.45, 1.6, 0], [0.75, 1.5, 0], [0.85, 1.25, 0]], 0.07, { n: 5 }), metal('#8a9a6a'));
      const pour = lit(moving(part(g, cyl(0.05, 0.08, 0.8, 5), see('#c8ff7a', 0.8, { emissive: '#5fe02a', emissiveIntensity: 1.2 }), 0.85, 0.82, 0)));
      rep.anim.push((s) => { pour.scale.set(1 + Math.sin(s * 11 + rep.id) * 0.25, 1, 1 + Math.cos(s * 9 + rep.id) * 0.25); });
      ripple(rep, g, 0.85, 0.46, 0, 0.1, 0.45, { material: see('#d8ff9a', 0.6), rate: 0.8 });
      band(rep, g, 1.26, 0.36, 14);
    } else if (f === 'thunder') {
      // the Arc Spire, after its sprite: a silver orb held aloft in a twisted claw on a round
      // pedestal, lightning crawling from it to the claw's tips, a ring of light turning about it
      part(g, cyl(0.9, 1.1, 0.4, 8), p.dark, 0, 0.2, 0);
      part(g, lathe('arcpedestal', [[0.75, 0], [0.6, 0.3], [0.3, 0.6], [0.24, 1.4], [0.36, 1.75]], 10), p.stone, 0, 0.4, 0);
      part(g, ring(0.36, 0.05, 12), p.trim, 0, 2.15, 0).rotation.x = Math.PI / 2;
      const tips = [];
      for (let i = 0; i < 3; i++) {
        const pts = [];
        for (let k = 0; k <= 5; k++) {
          const t2 = k / 5, a = (i / 3) * Math.PI * 2 + t2 * 1.4, r = 0.3 + Math.sin(t2 * Math.PI) * 0.4;
          pts.push([Math.cos(a) * r, 2.1 + t2 * 1.3, Math.sin(a) * r]);
        }
        part(g, tube(`arcclaw${i}`, pts, 0.1, { n: 5, tip: 0.3 }), metal('#c9c6d2'));
        tips.push(pts[5]);
      }
      const orb = moving(part(g, sph(0.42, 14, 10), mat('#eeedf4', { metalness: 0.65, roughness: 0.2, emissive: '#9a8cff', emissiveIntensity: 0.2 }), 0, 2.85, 0));
      orb.material = orb.material.clone();
      rep.own.push(orb.material);
      rep.anim.push((s) => { orb.material.emissiveIntensity = 0.15 + 0.25 * Math.max(0, Math.sin(s * 5 + rep.id)) ** 4; });
      tips.forEach((tip, i) => zap(rep, g, [0, 2.85, 0], tip, { seed: i, rate: 6, share: 0.3, jag: 0.1, r: 0.025 }));
      const hoop = spin(rep, holder(g, 0, 2.85, 0), 'y', 1.6);
      lit(part(hoop, ring(0.8, 0.03, 22), p.glow)).rotation.x = Math.PI / 2 + 0.35;
      band(rep, g, 0.92, 0.42, 6);
    } else {
      // the Sun Barricade, after its sprite: a dome of burnished bronze on legs that arch out from it
      // like a beetle's, a porthole where a sun stone glows, a cap on its crown that turns
      part(g, cyl(1.15, 1.25, 0.25, 10), p.dark, 0, 0.12, 0);
      const bronze = metal('#b07a3a');
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        part(g, tube('sunbarleg', [[0.55, 1.25, 0], [1.0, 1.25, 0], [1.2, 0.8, 0], [1.12, 0.25, 0]], 0.08, { n: 5, tip: 0.6 }), metal('#d9b06a')).rotation.y = -a;
      }
      part(g, lathe('sunbardome', [[0.85, 0], [0.86, 0.45], [0.72, 0.95], [0.42, 1.25], [0.05, 1.35]], 12), bronze, 0, 0.25, 0);
      part(g, ring(0.86, 0.05, 16), p.trim, 0, 0.7, 0).rotation.x = Math.PI / 2;
      part(g, ring(0.24, 0.05, 12), metal('#d9b06a'), 0, 0.85, 0.82);
      lit(pulsing(rep, part(g, sph(0.2, 8, 6), p.glow, 0, 0.85, 0.74), 0.6, 1.8, 2.4));
      const cap = spin(rep, holder(g, 0, 1.6, 0), 'y', 0.9, rep.id);
      part(cap, cyl(0.38, 0.45, 0.22, 8), mat('#8a8f98', { metalness: 0.5, roughness: 0.35 }));
      for (let i = 0; i < 4; i++) part(cap, box(0.1, 0.12, 0.3), mat('#8a8f98'), Math.cos(i * 1.57) * 0.45, 0, Math.sin(i * 1.57) * 0.45).rotation.y = -i * 1.57;
      const stone = moving(part(g, ico(0.22, 1), p.glow, 0, 2.05, 0));
      rep.anim.push((s) => { stone.scale.setScalar(0.9 + Math.sin(s * 3 + rep.id) * 0.1); stone.rotation.y = s; });
      band(rep, g, 1.17, 0.27, 10);
    }
  },
  farm(rep, g) {
    // the Edge Farm: a plot of wheat that sways in the wind, a scarecrow in the owner's colour, a
    // fence of stakes and a tiny shed
    part(g, box(0.95, 0.12, 0.95), mat('#7a5a3a'), 0, 0.06, 0);
    const wheat = holder(g, 0, 0.12, 0);
    rep.anim.push((s) => { wheat.rotation.z = Math.sin(s * 1.8 + rep.id) * 0.06; wheat.rotation.x = Math.cos(s * 1.4 + rep.id) * 0.04; });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      part(wheat, cone(0.07, 0.34, 4), mat(r % 2 ? '#c9b04a' : '#a8b84a'), -0.32 + c * 0.22, 0.17, -0.3 + r * 0.22);
    }
    part(g, box(0.28, 0.28, 0.26), mat('#c9a57c'), 0.32, 0.26, 0.32);
    part(g, cone(0.24, 0.16, 4), mat('#8a5a34'), 0.32, 0.48, 0.32).rotation.y = Math.PI / 4;
    for (let i = 0; i < 5; i++) part(g, box(0.03, 0.18, 0.03), mat('#6f4e33'), -0.44 + i * 0.22, 0.2, 0.46);
    part(g, box(0.9, 0.025, 0.02), mat('#6f4e33'), 0, 0.24, 0.46);
    part(g, box(0.03, 0.55, 0.03), mat('#6f4e33'), -0.3, 0.38, 0.3);
    part(g, box(0.34, 0.03, 0.03), mat('#6f4e33'), -0.3, 0.5, 0.3);
    part(g, box(0.16, 0.18, 0.08), team(rep), -0.3, 0.48, 0.3);
    part(g, sph(0.06, 6, 4), mat('#e2c56a'), -0.3, 0.64, 0.3);
    part(g, cone(0.1, 0.08, 6), mat('#c9a14a'), -0.3, 0.7, 0.3);
  },

  /* ---------------------------------------- Aviaries ---------------------------------------- */
  aviary(rep, g, e) {
    const f = furyOf(e), p = kit(e);
    if (f === 'wind') {
      // the Devil Maker, after its sprite: a ramp of sandstone that curls round and up on itself
      // like a shell, a dark hollow at its heart where a dust devil is spun up, grit whirling
      part(g, cyl(1.3, 1.4, 0.25, 14), mat('#a8834f'), 0, 0.12, 0);
      const curl = [];
      for (let i = 0; i <= 14; i++) {
        const t2 = i / 14, a = t2 * Math.PI * 2.5, r = 1.15 - t2 * 0.6;
        curl.push([Math.cos(a) * r, 0.35 + t2 * 1.2, Math.sin(a) * r]);
      }
      part(g, tube('devilcurl', curl, 0.32, { n: 4, tip: 0.45, steps: 42 }), mat('#d9b878'));
      part(g, tube('devilcurl2', curl.map(([x, y, z]) => [x, y + 0.26, z]), 0.08, { n: 4, tip: 0.45, steps: 42 }), mat('#8a6040'));
      part(g, cyl(0.5, 0.42, 0.3, 10), mat('#2b2119'), 0, 0.4, 0);
      const swirl = spin(rep, holder(g, 0, 0.6, 0), 'y', 4, rep.id);
      for (let i = 0; i < 4; i++) part(swirl, cone(0.25 + i * 0.16, 0.6, 7), see(['#6b5236', '#7a6040', '#8a6e4c', '#a08460'][i], 0.75 - i * 0.12), 0, 0.3 + i * 0.45, 0).rotation.x = Math.PI;
      const grit = spin(rep, holder(g, 0, 0.6, 0), 'y', 7, rep.id * 2);
      for (let i = 0; i < 6; i++) {
        const a = i * 2.4, r = 0.3 + i * 0.12;
        part(grit, box(0.08, 0.06, 0.08), mat(i % 2 ? '#3a2d21' : '#7a6a58'), Math.cos(a) * r, 0.2 + i * 0.3, Math.sin(a) * r).rotation.set(a, a * 2, 0);
      }
      band(rep, g, 1.32, 0.26, 14);
    } else if (f === 'rain') {
      // the Man o'War Pool, after its sprite: a deep pool in a rounded square of carved stone, its
      // water glowing, a young man o'war bobbing in it, tentacles trailing, bubbles rising
      part(g, cyl(1.5, 1.6, 0.75, 4), p.stone, 0, 0.37, 0).rotation.y = Math.PI / 4;
      part(g, cyl(1.56, 1.56, 0.12, 4), p.trim, 0, 0.8, 0).rotation.y = Math.PI / 4;
      part(g, cyl(1.28, 1.28, 0.06, 4), glow('#7dd6ec', '#1d7690', 0.6), 0, 0.82, 0).rotation.y = Math.PI / 4;
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        part(g, cyl(0.2, 0.24, 0.5, 8), p.stone, x * 1.0, 1.05, z * 1.0);
        part(g, sph(0.17, 8, 6), mat('#c8f2ff', { emissive: '#29a8ff', emissiveIntensity: 0.6 }), x * 1.0, 1.4, z * 1.0);
      }
      const jelly = holder(g, 0, 1.3, 0);
      rep.anim.push((s) => { jelly.position.y = 1.3 + Math.sin(s * 1.5 + rep.id) * 0.18; jelly.rotation.y = s * 0.3; jelly.scale.set(1 + Math.sin(s * 3 + rep.id) * 0.06, 1 - Math.sin(s * 3 + rep.id) * 0.06, 1 + Math.sin(s * 3 + rep.id) * 0.06); });
      part(jelly, dome(0.55), see('#d7a8ff', 0.75, { emissive: '#8a5cff', emissiveIntensity: 0.4 }));
      part(jelly, ring(0.5, 0.04, 16), see('#f0d8ff', 0.8), 0, 0.02, 0).rotation.x = Math.PI / 2;
      const tails = holder(jelly);
      rep.anim.push((s) => { tails.rotation.x = Math.sin(s * 2.5 + rep.id) * 0.18; tails.rotation.z = Math.cos(s * 2.1 + rep.id) * 0.18; });
      for (let i = 0; i < 7; i++) part(tails, cyl(0.03, 0.01, 0.7, 4), see('#e8c8ff', 0.7), Math.cos(i * 0.9) * 0.32, -0.35, Math.sin(i * 0.9) * 0.32);
      motes(rep, g, 0, 0.85, 0, { n: 3, h: 1.4, spread: 0.8, size: 0.07, material: see('#ffffff', 0.7), rate: 0.4, sway: 0.1 });
      ripple(rep, g, 0, 0.86, 0, 0.6, 1.25, { material: see('#e8fbff', 0.5), rate: 0.5 });
      band(rep, g, 1.32, 0.12, 16);
    } else {
      // the Whirlibase, after its sprite: a dome of gold, its gores parted by dark ribs, on a drum
      // of white stone; on its crown a hatch where a Whirligig's rotor idles, and a windsock
      part(g, cyl(1.3, 1.4, 0.3, 16), p.stone, 0, 0.15, 0);
      part(g, cyl(1.12, 1.18, 0.95, 16), mat('#efe9dc'), 0, 0.77, 0);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.2;
        part(g, box(0.26, 0.42, 0.05), mat('#3f4a55'), Math.cos(a) * 1.15, 0.78, Math.sin(a) * 1.15).rotation.y = -a + Math.PI / 2;
      }
      part(g, cyl(1.2, 1.2, 0.1, 16), p.trim, 0, 1.25, 0);
      for (let i = 0; i < 12; i++) part(g, lune(1.1, i, 12, Math.PI / 2), metal(i % 2 ? '#d9a63a' : '#c08a2a'), 0, 1.28, 0).scale.y = 0.85;
      for (let i = 0; i < 6; i++) {
        const rib = part(g, shape('whirlrib', () => new THREE.TorusGeometry(1.11, 0.035, 4, 10, Math.PI / 2)), mat('#5a4030'), 0, 1.28, 0);
        rib.rotation.y = (i / 6) * Math.PI * 2;
        rib.scale.y = 0.85;
      }
      part(g, cyl(0.3, 0.34, 0.2, 10), mat('#5a4030'), 0, 2.2, 0);
      const rotor = spin(rep, holder(g, 0, 2.5, 0), 'y', 2.2, rep.id);
      part(rotor, cyl(0.04, 0.04, 0.25, 5), mat('#3a3330'), 0, -0.12, 0);
      part(rotor, box(1.6, 0.025, 0.1), mat('#3a3330'));
      part(g, cyl(0.04, 0.05, 1.6, 5), mat('#e8e4da'), 1.05, 1.1, 0.75);
      const sock = moving(part(g, cone(0.14, 0.6, 6), team(rep), 1.05, 1.75, 1.03));
      rep.anim.push((s) => { sock.rotation.set(Math.PI / 2 + 0.3 + Math.sin(s * 3 + rep.id) * 0.12, 0, Math.sin(s * 2.2 + rep.id) * 0.2); });
      band(rep, g, 1.3, 0.31, 16);
    }
  },

  /* ---------------------------------------- Flyers ------------------------------------------ */
  flyer(rep, g, e) {
    const f = furyOf(e);
    const body = holder(g, 0, 4.2, 0);
    rep.anim.push((s) => { body.position.y = 4.2 + Math.sin(s * 2 + rep.id) * 0.15; });
    if (f === 'wind') {
      // the Dust Devil: a little whirlwind of dark grit, so it stands out against a bright sky
      const whirl = spin(rep, holder(body), 'y', 6, rep.id);
      const dust = ['#6b5236', '#5c4630', '#4e3b29', '#413123'];
      for (let i = 0; i < 4; i++) part(whirl, cone(0.55 - i * 0.1, 0.5, 7), see(dust[i], 0.9 - i * 0.04), 0, 0.3 - i * 0.35, 0).rotation.x = Math.PI;
      part(whirl, cone(0.14, 1.5, 6), mat('#2b2119'), 0, -0.2, 0).rotation.x = Math.PI;
      // grit and pebbles caught up in it, whirling faster than the funnel
      const grit = spin(rep, holder(body), 'y', 9, rep.id * 2);
      for (let i = 0; i < 5; i++) {
        const a = i * 2.4, r = 0.5 - i * 0.07;
        part(grit, box(0.09, 0.07, 0.09), mat(i % 2 ? '#3a2d21' : '#5a5048'), Math.cos(a) * r, 0.35 - i * 0.28, Math.sin(a) * r).rotation.set(a, a * 2, 0);
      }
      part(body, sph(0.12, 6, 4), team(rep), 0, 0.65, 0);
      band(rep, body, 0.56, 0.56);
    } else if (f === 'rain') {
      // the Man o'War: a jellyfish of the air, its tentacles swaying; twice the others' size
      body.scale.setScalar(2);
      part(body, dome(0.45), see('#d7a8ff', 0.8, { emissive: '#8a5cff', emissiveIntensity: 0.35 }));
      part(body, sph(0.12, 6, 4), team(rep), 0, 0.35, 0);
      const tails = holder(body);
      rep.anim.push((s) => { tails.rotation.x = Math.sin(s * 2.5 + rep.id) * 0.15; tails.rotation.z = Math.cos(s * 2.1 + rep.id) * 0.15; });
      for (let i = 0; i < 6; i++) part(tails, cyl(0.025, 0.01, 0.9, 4), see('#e8c8ff', 0.7), Math.cos(i) * 0.25, -0.45, Math.sin(i) * 0.25);
    } else {
      // the Whirligig, after its sprite: a teardrop pod of dark steel and glass under a long rotor,
      // a ring of gold at its keel, a tail boom with a little rotor of its own; it sways as it flies
      const sway = holder(body);
      rep.anim.push((s) => { sway.rotation.set(0.12 + Math.sin(s * 1.3 + rep.id) * 0.05, 0, Math.sin(s * 1.7 + rep.id) * 0.06); });
      part(sway, lathe('whirlpod', [[0.02, -0.55], [0.18, -0.42], [0.32, -0.1], [0.33, 0.1], [0.24, 0.32], [0.08, 0.42], [0.02, 0.44]], 10), mat('#3a3a44', { metalness: 0.6, roughness: 0.3 }));
      part(sway, sph(0.22, 8, 6), see('#bfe6ff', 0.7, { emissive: '#4a8ab0', emissiveIntensity: 0.4 }), 0, 0.02, 0.18).scale.set(1, 0.8, 0.8);
      part(sway, ring(0.24, 0.045, 14), metal('#d9a63a'), 0, -0.32, 0).rotation.x = Math.PI / 2;
      part(sway, ring(0.32, 0.04, 14), team(rep), 0, 0.02, 0).rotation.x = Math.PI / 2;
      part(sway, box(0.06, 0.06, 0.8), mat('#5a4a3a'), 0, 0.05, -0.65);
      part(sway, box(0.03, 0.22, 0.14), team(rep), 0, 0.12, -1.02);
      const tail = spin(rep, holder(sway, 0.05, 0.08, -1.0), 'x', 20);
      part(tail, box(0.02, 0.4, 0.05), mat('#3a3330'));
      part(sway, cyl(0.03, 0.03, 0.3, 5), metal('#9a9aa4'), 0, 0.55, 0);
      const rotor = spin(rep, holder(sway, 0, 0.72, 0), 'y', 18);
      part(rotor, sph(0.07, 6, 4), metal('#d9a63a'));
      part(rotor, box(2.4, 0.025, 0.13), mat('#3a3330'));
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
    return MODELS.golem(rep, g);
  },
  golem(rep, g) {
    // the Sun's Golem: a lumbering figure of sandstone blocks, a sun rune glowing in its chest, eyes
    // of fire, moss on its shoulders, heavy fists that swing as it walks, the owner's belt
    const body = holder(g), stone = mat('#b9a98a'), dark = mat('#9c8d70');
    part(body, box(0.62, 0.5, 0.4), stone, 0, 0.86, 0);
    part(body, box(0.46, 0.2, 0.32), dark, 0, 0.55, 0);
    part(body, box(0.5, 0.07, 0.36), team(rep), 0, 0.64, 0);
    for (const s of [-1, 1]) {
      part(body, dodeca(0.17), mat('#a99a7c'), s * 0.37, 1.05, 0);
      part(body, ico(0.08, 0), mat('#6f9a3a'), s * 0.4, 1.17, -0.04);
    }
    lit(part(body, box(0.16, 0.16, 0.03), glow('#ffe39a', '#ffb43a', 1.4), 0, 0.9, 0.2)).rotation.z = Math.PI / 4;
    part(body, box(0.27, 0.24, 0.25), mat('#c9b99a'), 0, 1.24, 0.03);
    for (const x of [-0.07, 0.07]) lit(part(body, box(0.05, 0.04, 0.02), glow('#ffe39a', '#ff8a1a', 1.6), x, 1.26, 0.16));
    const limb = (x, y, len, w) => {
      const h = holder(body, x, y, 0);
      part(h, box(w, len, w * 1.1), dark, 0, -len / 2, 0);
      return h;
    };
    const legs = [-0.14, 0.14].map((x) => limb(x, 0.48, 0.46, 0.17));
    const arms = [-0.42, 0.42].map((x) => {
      const a = limb(x, 1.0, 0.5, 0.13);
      part(a, dodeca(0.12), stone, 0, -0.55, 0.02);
      return a;
    });
    body.scale.setScalar(1.25);
    rep.walk = (phase) => {
      const a = Math.sin(phase) * 0.55;
      legs[0].rotation.x = a; legs[1].rotation.x = -a; arms[0].rotation.x = -a * 0.8; arms[1].rotation.x = a * 0.8;
      body.position.y = Math.abs(Math.cos(phase)) * 0.05;
      body.rotation.z = Math.sin(phase) * 0.04;
    };
  },
  skater(rep, g) {
    // the Sail Skater, after its sprite: a skiff on two great spoked wheels and a runner, under a
    // sail that bellies in the wind, the owner's pennant at its masthead; its wheels turn as it rolls
    const body = holder(g), wood = mat('#a87a50'), dark = mat('#6f4e33');
    part(body, box(0.5, 0.16, 1.0), wood, 0, 0.38, 0);
    part(body, box(0.54, 0.08, 1.04), dark, 0, 0.48, 0);
    part(body, cone(0.28, 0.45, 4), wood, 0, 0.38, 0.7).rotation.set(Math.PI / 2, Math.PI / 4, 0);
    part(body, box(0.05, 0.3, 0.05), dark, 0, 0.2, 0.62);
    part(body, box(0.06, 0.04, 0.5), metal('#9a9aa4'), 0, 0.05, 0.62);
    part(body, box(0.62, 0.06, 0.12), team(rep), 0, 0.53, -0.42);
    const wheels = [-1, 1].map((s) => {
      const w = holder(body, s * 0.34, 0.32, -0.22);
      part(w, ring(0.3, 0.035, 12), dark).rotation.y = Math.PI / 2;
      for (let i = 0; i < 3; i++) part(w, box(0.03, 0.58, 0.04), mat('#c9a57c')).rotation.x = (i / 3) * Math.PI;
      return w;
    });
    part(body, cyl(0.035, 0.045, 1.7, 5), dark, 0, 1.3, 0.05);
    part(body, cyl(0.025, 0.025, 0.9, 4), dark, 0, 0.75, -0.3).rotation.x = Math.PI / 2;
    const sail = moving(part(body, shape('skatersail', () => new THREE.CylinderGeometry(0.75, 0.75, 1.3, 7, 1, true, -0.55, 1.1)), mat('#f3ecd8', { side: THREE.DoubleSide }), 0, 1.25, -0.72));
    sail.scale.set(0.9, 1, 0.8);
    part(body, box(0.22, 0.12, 0.02), team(rep), 0.11, 2.12, 0.05);
    body.scale.setScalar(1.1);
    rep.walk = (phase) => {
      for (const w of wheels) w.rotation.x = phase * 2;
      body.rotation.z = Math.sin(phase * 0.5) * 0.06;
      sail.scale.z = 0.8 + (phase ? 0.12 + Math.sin(phase * 1.3) * 0.05 : 0);
    };
  },
  crab(rep, g) {
    // the Crystal Crab: a crab of blue steel plates, crystals growing from its back, eyes on stalks,
    // jointed legs that scuttle and claws that open and snap
    const body = holder(g, 0, 0.42, 0), steel = mat('#4f86b5', { metalness: 0.45, roughness: 0.35 }), dark = mat('#2f5a80', { metalness: 0.4, roughness: 0.4 });
    part(body, sph(0.42, 12, 6), steel).scale.set(1.3, 0.5, 1.05);
    part(body, ring(0.5, 0.04, 16), dark, 0, 0, 0).scale.set(1.08, 0.86, 1);
    part(body, box(0.5, 0.06, 0.06), team(rep), 0, 0.14, -0.38);
    for (const [x, z, k] of [[0, -0.02, 1], [0.2, -0.12, 0.7], [-0.2, -0.1, 0.75], [0.05, 0.15, 0.55]]) lit(part(body, octa(0.16 * k), glow('#c8f2ff', '#29a8ff', 1), x, 0.22 + 0.12 * k, z)).scale.y = 1.8;
    for (const x of [-0.1, 0.1]) {
      part(body, cyl(0.02, 0.02, 0.2, 4), dark, x, 0.24, 0.36);
      part(body, sph(0.05, 6, 4), mat('#111111'), x, 0.35, 0.36);
    }
    const legs = [];
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1, k = i % 3, leg = holder(body, side * 0.42, -0.02, -0.2 + k * 0.2);
      part(leg, box(0.36, 0.05, 0.05), dark, side * 0.16, 0.08, 0).rotation.z = side * 0.5;
      part(leg, box(0.05, 0.4, 0.05), steel, side * 0.34, -0.12, 0).rotation.z = side * 0.25;
      legs.push({ leg, side, k });
    }
    const claws = [-1, 1].map((s) => {
      const arm = holder(body, s * 0.3, 0.02, 0.4);
      part(arm, box(0.08, 0.08, 0.3), dark, 0, 0, 0.12).rotation.y = s * -0.4;
      part(arm, sph(0.13, 8, 6), steel, s * -0.08, 0.04, 0.32).scale.set(1, 0.8, 1.3);
      part(arm, cone(0.06, 0.26, 4), mat('#6fa8d8'), s * -0.12, 0.0, 0.5).rotation.x = Math.PI / 2;
      const pincer = holder(arm, s * -0.06, 0.08, 0.4);
      part(pincer, cone(0.05, 0.24, 4), mat('#6fa8d8'), 0, 0, 0.1).rotation.x = Math.PI / 2;
      return pincer;
    });
    rep.anim.push((s) => { claws.forEach((c, i) => { c.rotation.x = -0.15 - Math.max(0, Math.sin(s * 2.3 + i * 2 + rep.id)) * 0.5; }); });
    rep.walk = (phase) => {
      for (const { leg, side, k } of legs) {
        leg.rotation.y = Math.sin(phase * 1.5 + k * 2 + (side > 0 ? Math.PI : 0)) * 0.3;
        leg.rotation.z = Math.max(0, Math.cos(phase * 1.5 + k * 2 + (side > 0 ? Math.PI : 0))) * side * 0.25;
      }
      body.rotation.z = Math.sin(phase) * 0.05;
    };
  },
  bulf(rep, g) {
    // the Bulf: a shaggy beast of the storm, great copper horns curling from its brow, a pack
    // lashed to its hump in the owner's colour, eyes alight, a tail that swishes
    const body = holder(g), fur = mat('#4a4058'), dark = mat('#3a3443'), copper = metal('#c27a3e');
    part(body, box(0.52, 0.46, 0.85), fur, 0, 0.72, 0);
    part(body, sph(0.36, 10, 8), mat('#5d5070'), 0, 0.95, 0.15).scale.set(1, 0.8, 1.1);
    for (let i = 0; i < 5; i++) part(body, cone(0.08, 0.22, 4), fur, (i % 2 ? 0.15 : -0.15), 0.52, -0.3 + i * 0.15).rotation.x = Math.PI;
    part(body, box(0.5, 0.3, 0.42), mat('#7a5a3a'), 0, 1.15, -0.12);
    part(body, cyl(0.14, 0.14, 0.56, 8), mat('#a87a50'), 0, 1.38, -0.12).rotation.z = Math.PI / 2;
    for (const z of [-0.25, 0.02]) part(body, box(0.56, 0.34, 0.05), team(rep), 0, 1.12, z);
    const head = holder(body, 0, 0.82, 0.52);
    part(head, box(0.34, 0.3, 0.32), mat('#5d5070'));
    part(head, box(0.24, 0.16, 0.16), fur, 0, -0.08, 0.18);
    for (const s of [-1, 1]) {
      part(head, tube(`bulfhorn${s}`, [[s * 0.15, 0.1, 0], [s * 0.38, 0.22, -0.05], [s * 0.45, 0.42, 0.08], [s * 0.32, 0.55, 0.18]], 0.06, { n: 5, tip: 0.25 }), copper);
      lit(part(head, sph(0.04, 5, 4), glow('#e6d2ff', '#9a5cff', 1.8), s * 0.1, 0.05, 0.17));
    }
    const legs = [[-0.17, 0.28], [0.17, 0.28], [-0.17, -0.28], [0.17, -0.28]].map(([x, z]) => {
      const leg = holder(body, x, 0.5, z);
      part(leg, box(0.14, 0.5, 0.14), dark, 0, -0.25, 0);
      part(leg, box(0.16, 0.06, 0.18), copper, 0, -0.47, 0.01);
      return leg;
    });
    const tail = holder(body, 0, 0.85, -0.43);
    part(tail, cyl(0.03, 0.02, 0.45, 4), dark, 0, -0.18, -0.08).rotation.x = -0.4;
    part(tail, cone(0.06, 0.14, 4), fur, 0, -0.42, -0.16).rotation.x = Math.PI;
    rep.anim.push((s) => { tail.rotation.z = Math.sin(s * 2.6 + rep.id) * 0.4; });
    body.scale.setScalar(1.1);
    rep.walk = (phase) => {
      const a = Math.sin(phase) * 0.45;
      legs[0].rotation.x = a; legs[3].rotation.x = a; legs[1].rotation.x = -a; legs[2].rotation.x = -a;
      head.rotation.x = Math.sin(phase * 2) * 0.06;
      body.position.y = Math.abs(Math.sin(phase)) * 0.03;
    };
  },
  ant(rep, g) {
    // the Fire Ant: an ant of red chitin, its abdomen smouldering, mandibles that work, antennae
    // that feel ahead, six legs rippling
    const body = holder(g, 0, 0.36, 0), chitin = mat('#c4442a', { metalness: 0.3, roughness: 0.35 });
    part(body, sph(0.24, 10, 8), chitin, 0, 0.04, -0.36).scale.set(1, 0.85, 1.25);
    lit(part(body, sph(0.17, 8, 6), glow('#ffb347', '#ff5a1a', 1.1), 0, 0.02, -0.46)).scale.set(1, 0.8, 1);
    part(body, sph(0.14, 8, 6), chitin, 0, 0, 0).scale.set(1, 0.85, 1.3);
    part(body, sph(0.16, 8, 6), chitin, 0, 0.02, 0.28).scale.set(1, 0.85, 1.1);
    part(body, box(0.3, 0.05, 0.05), team(rep), 0, 0.14, 0);
    for (const x of [-0.07, 0.07]) lit(part(body, sph(0.035, 5, 4), glow('#ffe39a', '#ff8a1a', 1.5), x, 0.08, 0.42));
    const feelers = [-1, 1].map((s) => {
      const f = holder(body, s * 0.06, 0.12, 0.38);
      part(f, tube(`antfeeler${s}`, [[0, 0, 0], [s * 0.08, 0.15, 0.08], [s * 0.14, 0.18, 0.25]], 0.012, { n: 3 }), mat('#2a1d1d'));
      return f;
    });
    const jaws = [-1, 1].map((s) => {
      const j = holder(body, s * 0.06, -0.02, 0.42);
      part(j, cone(0.03, 0.14, 4), mat('#2a1d1d'), 0, 0, 0.06).rotation.set(Math.PI / 2, 0, 0);
      return { j, s };
    });
    rep.anim.push((s) => {
      feelers.forEach((f, i) => { f.rotation.y = Math.sin(s * 4 + i * 1.3 + rep.id) * 0.3; });
      for (const { j, s: side } of jaws) j.rotation.y = side * (0.2 + Math.max(0, Math.sin(s * 5 + rep.id)) * 0.35);
    });
    const legs = [];
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1, k = i % 3, leg = holder(body, side * 0.1, -0.02, -0.12 + k * 0.14);
      part(leg, box(0.22, 0.03, 0.03), mat('#2a1d1d'), side * 0.1, 0.05, 0).rotation.z = side * 0.4;
      part(leg, box(0.03, 0.28, 0.03), mat('#2a1d1d'), side * 0.22, -0.12, 0).rotation.z = side * 0.3;
      legs.push({ leg, side, k });
    }
    rep.walk = (phase) => { for (const { leg, side, k } of legs) leg.rotation.y = Math.sin(phase * 2 + k * 2 + (side > 0 ? Math.PI : 0)) * 0.35; };
  },
  balloon(rep, g, e) {
    const f = furyOf(e);
    if (f === 'wind') {
      // the Air Ship: a canvas envelope with fins, a gondola, a propeller behind
      const body = holder(g, 0, 4.3, 0);
      body.scale.setScalar(1.25); // a big ship, a quarter larger than the other carriers' scale
      rep.anim.push(aloft(rep, body, 1.8, 4.3, 0.15, 1.1));
      part(body, sph(1, 14, 10), mat('#efe6cf')).scale.set(0.85, 0.75, 2.0);
      part(body, ring(0.86, 0.06, 18), team(rep), 0, 0, 0.4).scale.set(1, 0.88, 1);
      for (const r of [0, Math.PI / 2, Math.PI]) part(body, box(0.06, 0.6, 0.6), mat('#9bcf6a'), 0, 0, -1.9).rotation.z = r;
      part(body, box(0.5, 0.35, 1.0), mat('#87603f'), 0, -1.05, 0.1);
      for (const x of [-0.2, 0.2]) part(body, cyl(0.02, 0.02, 0.5, 4), mat('#5a4a3a'), x, -0.75, 0.1);
      const prop = spin(rep, holder(body, 0, -1.05, -0.55), 'z', 14);
      part(prop, box(0.08, 0.7, 0.03), mat('#3a3330'));
      rep.cargo = holder(g, 0, 2.3, 0);
      rep.cargoBelow = 2.0;
    } else if (f === 'rain') {
      // the Cloud Floater: a cloud that churns as it drifts, rain falling from it, a pod of ice
      // in a silver frame slung under it for its load
      const body = holder(g, 0, 3.4, 0);
      rep.anim.push(aloft(rep, body, 1.6, 3.4, 0.2, 1.3));
      const puffs = [[0, 0, 0, 0.62], [0.58, -0.1, 0.1, 0.46], [-0.52, -0.05, -0.1, 0.5], [0.1, 0.32, -0.3, 0.44], [-0.15, -0.15, 0.45, 0.4], [0.3, 0.2, 0.35, 0.36]];
      puffs.forEach(([x, y, z, r], i) => {
        const puff = moving(part(body, ico(r, 1), mat(i % 2 ? '#f4f8ff' : '#e2ecf6'), x, y, z));
        rep.anim.push((s) => { puff.scale.setScalar(1 + Math.sin(s * 1.1 + i * 1.7 + rep.id) * 0.07); });
      });
      for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) part(body, box(0.02, 0.55, 0.02), metal('#c8ccd8'), x, -0.75, z);
      part(body, octa(0.4), see('#cdeffc', 0.75, { emissive: '#3aa8d8', emissiveIntensity: 0.45, roughness: 0.1 }), 0, -1.2, 0).scale.set(1.1, 0.7, 1.1);
      part(body, ring(0.36, 0.035, 4), metal('#c8ccd8'), 0, -1.2, 0).rotation.set(Math.PI / 2, 0, Math.PI / 4);
      part(body, ring(0.38, 0.03, 12), team(rep), 0, -1.05, 0).rotation.x = Math.PI / 2;
      motes(rep, body, 0, -0.4, 0, { n: 5, h: 1.6, spread: 0.55, size: 0.04, material: see('#bfe6ff', 0.8), rate: 1.2, sway: 0, fall: true });
      rep.cargo = holder(g, 0, 1.5, 0);
      rep.cargoBelow = 1.9;
    } else {
      // the Sun's Balloon, after its sprite: an envelope of gores, cream and the owner's colour, a
      // burner whose flame flickers under its mouth, a gondola like a lantern hung on cords
      const body = holder(g, 0, 3.2, 0);
      rep.anim.push(aloft(rep, body, 1.9, 3.2, 0.18, 1.3));
      for (let i = 0; i < 12; i++) part(body, lune(0.8, i, 12, Math.PI * 0.8), i % 2 ? team(rep) : mat('#efe6cf')).scale.y = 1.15;
      part(body, ring(0.48, 0.04, 14), mat('#7a5a3c'), 0, -0.74, 0).rotation.x = Math.PI / 2;
      part(body, ring(0.8, 0.03, 18), mat('#7a5a3c'), 0, 0, 0).rotation.x = Math.PI / 2;
      flame(rep, body, 0, -1.02, 0, 0.32);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4, cord = part(body, cyl(0.012, 0.012, 0.85, 3), mat('#5a4a3a'), Math.cos(a) * 0.33, -1.15, Math.sin(a) * 0.33);
        cord.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
      }
      part(body, cyl(0.28, 0.22, 0.38, 6), mat('#8a5a34'), 0, -1.68, 0);
      part(body, ring(0.28, 0.04, 6), metal('#d9a63a'), 0, -1.5, 0).rotation.x = Math.PI / 2;
      lit(part(body, cyl(0.2, 0.2, 0.2, 6), glow('#ffe39a', '#ffb43a', 0.9), 0, -1.66, 0));
      rep.cargo = holder(g, 0, 1.4, 0);
      rep.cargoBelow = 1.8;
    }
  },

  /* ------------------------------------ Priests and the map ---------------------------------- */
  priest(rep, g) {
    // the High Priest: a robe in the owner's colour over a white under-robe, a gold mitre, a white
    // beard, a staff whose crystal glows. As he prays he lifts his staff and his free hand, its
    // light swells and a ring of runes turns at his feet.
    const body = holder(g), figure = holder(body), robe = team(rep), gold = metal('#d9a63a');
    part(figure, lathe('underrobe', [[0.34, 0], [0.28, 0.4], [0.18, 0.85], [0.12, 0.98]], 10), mat('#f2eee4'));
    part(figure, lathe('robe', [[0.38, 0.02], [0.32, 0.4], [0.22, 0.8], [0.18, 1.0]], 10), robe).scale.set(1, 1, 0.92);
    part(figure, ring(0.37, 0.03, 12), gold, 0, 0.06, 0).rotation.x = Math.PI / 2;
    part(figure, cyl(0.2, 0.24, 0.1, 8), gold, 0, 0.72, 0);
    part(figure, cone(0.26, 0.42, 8), robe, 0, 0.98, -0.02);
    part(figure, sph(0.15, 8, 6), mat('#edcfa8'), 0, 1.17, 0.02);
    part(figure, cone(0.1, 0.24, 6), mat('#f2f0ea'), 0, 1.0, 0.11).rotation.x = Math.PI + 0.25;
    part(figure, lathe('mitre', [[0.13, 0], [0.15, 0.15], [0.1, 0.32], [0.02, 0.42]], 8), gold, 0, 1.25, 0);
    const arm = (s) => {
      const a = holder(figure, s * 0.22, 0.92, 0);
      part(a, cone(0.09, 0.42, 6), robe, 0, -0.2, 0).rotation.x = Math.PI;
      part(a, sph(0.05, 5, 4), mat('#edcfa8'), 0, -0.42, 0);
      return a;
    };
    const right = arm(1), left = arm(-1);
    const staff = holder(right, 0, -0.4, 0.04);
    part(staff, cyl(0.025, 0.025, 1.5, 5), mat('#6f4e33'), 0, 0.3, 0);
    part(staff, ring(0.09, 0.02, 8), gold, 0, 1.06, 0);
    const light = lit(moving(part(staff, ico(0.09, 0), glow('#fff3c0', '#ffd24a', 1.2), 0, 1.1, 0)));
    if (rep.id != null) {
      // a light of his own, that swells as he prays (a captive carried off has none)
      light.material = light.material.clone();
      rep.own.push(light.material);
    }
    const runes = holder(g, 0, 0.08, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      lit(part(runes, box(0.16, 0.03, 0.08), glow('#fff3c0', '#ffd24a', 1.6), Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62)).rotation.y = -a;
    }
    runes.visible = false;
    rep.anim.push((s, e) => {
      const prays = (e?.praying > 0 || e?.casting > 0) && e.state === 'normal';
      runes.visible = prays;
      runes.rotation.y = s * 1.2;
      right.rotation.x = prays ? -2.4 : -0.15;
      staff.rotation.x = -right.rotation.x;
      left.rotation.set(prays ? -2.2 : 0, 0, prays ? 0.3 : 0.1);
      light.material.emissiveIntensity = prays ? 2 + Math.sin(s * 8) * 0.8 : 1 + Math.sin(s * 2 + rep.id) * 0.3;
      light.scale.setScalar(prays ? 1.6 : 1);
      figure.position.y = Math.abs(Math.sin((rep.phase ?? 0) * 1.0)) * 0.04;
    });
    body.scale.setScalar(1.3);
    rep.body = body;
    // a crystal he carries, over his head
    rep.cargo = holder(g, 0, 2.4, 0);
  },
  crystal(rep, g) {
    const c = moving(part(g, octa(0.28), glow('#bff4ff', '#39c6ff', 1.1), 0, 0.45, 0));
    c.scale.y = 1.5;
    rep.anim.push((s) => { c.rotation.y = s * 2; c.position.y = 0.45 + Math.sin(s * 3 + rep.id) * 0.08; });
  },
  geyser(rep, g) {
    // after its sprite: a vent ringed by columns of dark rock crusted with rust-red minerals, the
    // storm's power glowing blue in its throat while it lasts, steam blasting out of it
    part(g, cyl(0.6, 0.75, 0.14, 10), mat('#3a3330'), 0, 0.07, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3, h = 0.5 + hash(i, 7, 70) * 1.3, r = 0.2 + hash(i, 7, 72) * 0.12, x = Math.cos(a) * 0.95, z = Math.sin(a) * 0.95;
      const col = part(g, cyl(r * 0.8, r, h, 5), mat('#5a4e48'), x, h / 2, z);
      col.rotation.set(Math.sin(a) * 0.15, a, -Math.cos(a) * 0.15);
      part(g, cyl(r * 0.85, r * 0.8, 0.12, 5), mat('#b8643a'), x + Math.cos(a) * h * 0.07, h + 0.02, z + Math.sin(a) * h * 0.07).rotation.copy(col.rotation);
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.9, r = 0.18 + hash(i, 7, 71) * 0.15;
      part(g, dodeca(r), mat('#857766'), Math.cos(a) * 1.35, r * 0.5, Math.sin(a) * 1.35);
    }
    part(g, cyl(0.42, 0.5, 0.25, 10), mat('#2b2522'), 0, 0.2, 0);
    const throat = lit(moving(part(g, cyl(0.34, 0.34, 0.04, 10), glow('#c8f2ff', '#39c6ff', 1), 0, 0.33, 0)));
    throat.material = throat.material.clone();
    rep.own.push(throat.material);
    rep.anim.push((s, e) => { throat.material.emissiveIntensity = e?.stock > 0 ? 0.9 + Math.sin(s * 2.5 + rep.id) * 0.4 : 0.05; });
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
    // a monolith of dark stone on worn steps, runes glowing on its faces, its capstone a crystal
    // that floats and turns over it, motes of power circling its foot
    part(g, box(1.3, 0.25, 1.3), mat('#6d6a74'), 0, 0.12, 0);
    part(g, box(1.0, 0.2, 1.0), mat('#7d7a84'), 0, 0.35, 0);
    part(g, cyl(0.34, 0.48, 3.0, 4), mat('#5d5a66'), 0, 1.95, 0).rotation.y = Math.PI / 4;
    const rune = glow('#c8b8ff', '#7a5cff', 1.1);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      for (const [y, w, h] of [[1.0, 0.18, 0.22], [1.5, 0.12, 0.3], [2.05, 0.2, 0.12], [2.6, 0.1, 0.25]]) {
        const r = (0.48 - (y - 0.45) * 0.0467) * Math.SQRT1_2 + 0.02;
        lit(part(g, box(w, h, 0.03), rune, Math.sin(a) * r, y, Math.cos(a) * r)).rotation.y = a;
      }
    }
    part(g, cone(0.3, 0.4, 4), mat('#7d7a84'), 0, 3.65, 0).rotation.y = Math.PI / 4;
    const cap = holder(g, 0, 4.3, 0);
    rep.anim.push((s) => { cap.position.y = 4.3 + Math.sin(s * 1.4 + rep.id) * 0.15; cap.rotation.y = s * 0.9; });
    lit(part(cap, octa(0.28), glow('#e0d4ff', '#8a5cff', 1.4))).scale.y = 1.7;
    const ring2 = spin(rep, holder(g, 0, 0.6, 0), 'y', 1.1, rep.id);
    for (let i = 0; i < 4; i++) lit(part(ring2, ico(0.06, 0), glow('#e0d4ff', '#8a5cff', 1.8), Math.cos(i * 1.57) * 0.85, Math.sin(i * 2.3) * 0.2 + 0.3, Math.sin(i * 1.57) * 0.85));
  },
  /** "As a Temple is built, the alignment of that Temple grows into the Residence": its walls,
   * roof and trim are those of the Fury whose Temple holds the island (`theme`), the Sun's on
   * unclaimed ground. */
  residence(rep, g, theme = 'sun') {
    const p = FURY[theme] ?? FURY.sun;
    part(g, box(2.2, 1.2, 1.7), mat(p.stone), 0, 0.66, 0);
    part(g, box(2.3, 0.12, 1.8), mat(p.trim), 0, 1.3, 0);
    const top = part(g, cone(1.75, 1.05, 4), mat(p.roof), 0, 1.78, 0);
    top.rotation.y = Math.PI / 4;
    top.scale.z = 0.82;
    part(g, box(0.26, 0.7, 0.26), mat(p.dark), 0.6, 2.0, -0.3);
    part(g, box(0.42, 0.65, 0.05), mat('#6b4a2c'), 0, 0.38, 0.86);
    for (const x of [-0.7, 0.7]) part(g, box(0.34, 0.3, 0.05), glow(p.glow[0], p.glow[1], 0.7), x, 0.8, 0.86);
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

/**
 * The original sprite an entity is drawn with in "Sprites" mode, or null to keep its model.
 * `look` is the way the camera looks across the battlefield (0 north, as the original's view, 1
 * east...): a unit laid facing a way shows the picture of its facing as seen from there.
 */
export function spriteKey(e, look = 0) {
  const has = (k) => k in ART.sprites;
  if (e.kind === 'priest') return e.state === 'down' ? 'priest:down' : 'priest';
  if (e.kind === 'crystal' || e.kind === 'geyser') return e.kind;
  if (e.kind === 'transport' || e.kind === 'flyer') return has(e.type) ? e.type : null;
  if (e.kind === 'building') {
    const seen = `${e.type}:${((e.facing ?? 0) - look + 4) % 4}`;
    if (has(seen)) return seen;
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

