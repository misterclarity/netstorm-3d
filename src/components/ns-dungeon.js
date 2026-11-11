/**
 * Dungeons as the view shows them. The rules (scripts/house-rules.mjs, digDungeon) lay a dungeon
 * out in tiles: rock, floor, stairs, pillars, water, chests, and ragged rooms of their kinds. This
 * dresses it as caves nobody built: raw rock walls that lean and bulge, uneven vaults hung with
 * stalactites, rubble, rough columns where floor and vault have grown together; an entry whose
 * rough steps climb to a doorway of daylight (moonlight at night); crystals glowing blue and
 * violet; threads of glow-worms among the columns; a still pool; glowing mushrooms, roots and
 * fireflies; a slab under a beam from a crack in the vault, standing stones about it; a floor
 * cracked with fire. And what the dark keeps: eyes that watch from the walls and are gone when he
 * comes near, glyphs that hang in the air and wake as he passes, old bones, wisps that drift.
 *
 * It is drawn cheaply. Two lights are real: the Priest's own, which goes with him and casts the
 * shadows, and the daylight at the stairs; everything else that shines is glow (it lights
 * nothing). The stone is matte and plain. The dungeon is cut into chunks of CHUNK tiles, each a
 * handful of instanced meshes, and only the chunks his light reaches are drawn at all: past
 * REVEAL the dark (the fog) has everything, and what is not lit is not there.
 *
 * On the island stands each dungeon's portal. The dungeon is drawn far below the sea of clouds,
 * and shown (the islands, the sky and the clouds hidden) while the player looks through the eyes
 * of a Priest who is down in it (src/systems/ns-fp.js).
 */
import { THREE, G, NS, ME, wx, wz } from '../state.js';
import { groundAt } from '../heights.js';
import { nightness } from './ns-sun.js';

/** How bright the deep's lights are (physical units: candela). */
const LUX = 4.5;
/** Scene units a tile; where the dungeons lie; the rock's top, over every vault. */
export const TILE_SIZE = 1.6;
const DEPTH = -420;
const TOP = 5;
/** How far the Priest's light shows anything, in scene units; tiles a chunk. */
const REVEAL = 16;
const CHUNK = 6;
/** Each kind of room's vault, in scene units (it wanders about this); passages, the stairwell. */
const HEIGHT = { entry: 3, crystal: 3.3, hall: 3.2, pool: 2.9, grotto: 2.7, shrine: 3.7, ember: 3, passage: 2.4, stairs: 4.2 };
/** Each kind's tint of its walls, floor and vault: all rock. */
const TINT = {
  entry: ['#7d766c', '#6c665e', '#4a4540'], hall: ['#84786a', '#70675b', '#4d453c'], shrine: ['#8a867c', '#77736a', '#524f48'],
  passage: ['#6f6a63', '#605b55', '#3e3a36'], stairs: ['#7d766c', '#6c665e', '#4a4540'],
  crystal: ['#5d6474', '#4d5464', '#2c3240'], pool: ['#5b6a62', '#4f5c55', '#2d3532'], grotto: ['#61674f', '#555a45', '#30332a'],
  ember: ['#6a4c40', '#5a3e33', '#2f211b'],
};
/** The tone his light takes in each kind of room. */
const TONE = { entry: '#ffe2b8', hall: '#ffe2b8', passage: '#ffd7a3', stairs: '#ffe9c8', crystal: '#c4e6ff', pool: '#c8fff0', grotto: '#dcffc4', shrine: '#fff2cc', ember: '#ffbf98' };

/* ------------------------------------------------ textures ----------------------------------------------- */

/** A small seeded random number generator, so that the textures look the same each time. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A texture drawn on a canvas, repeating. */
function canvasTexture(size, draw, color = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Speckles of light and dark over a canvas, for grain. */
function grain(g, size, rand, n, alpha) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(rand() * 255);
    g.fillStyle = `rgba(${v},${v},${v},${alpha * rand()})`;
    const r = 1 + rand() * 3;
    g.fillRect(rand() * size, rand() * size, r, r);
  }
}

/** Raw rock: blotches over blotches. */
function rock(relief) {
  return canvasTexture(256, (g, s) => {
    const rand = seeded(23);
    g.fillStyle = relief ? '#7a7a7a' : '#b4aea6';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      const v = relief ? 60 + rand() * 160 : 120 + rand() * 120, r = 6 + rand() * 30;
      const x = rand() * s, y = rand() * s;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, relief ? `rgba(${v},${v},${v},0.5)` : `rgba(${v},${v * 0.96},${v * 0.9},0.45)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      // drawn wrapped, so that it repeats without a seam
      for (const [ox, oy] of [[0, 0], [-s, 0], [s, 0], [0, -s], [0, s]]) { g.save(); g.translate(ox, oy); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
    }
    grain(g, s, rand, 3000, relief ? 0.5 : 0.25);
  }, !relief);
}

/** Planks of wood. */
function planks() {
  return canvasTexture(128, (g, s) => {
    const rand = seeded(5);
    for (let k = 0; k < 4; k++) {
      const v = 95 + rand() * 40;
      g.fillStyle = `rgb(${v},${v * 0.68},${v * 0.42})`;
      g.fillRect(0, k * s / 4, s, s / 4 - 2);
      g.strokeStyle = 'rgba(40,24,12,0.35)';
      for (let i = 0; i < 6; i++) { g.beginPath(); const y = k * s / 4 + rand() * s / 4; g.moveTo(0, y); g.bezierCurveTo(s / 3, y + 4, s * 2 / 3, y - 4, s, y); g.stroke(); }
    }
  });
}

/** A soft round glow, for flames, crystals, motes. */
let GLOW = null;
function glowTexture() {
  GLOW ??= canvasTexture(64, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
  return GLOW;
}

/** Ripples, as a normal map, for the pools. */
function ripples() {
  return canvasTexture(256, (g, s) => {
    const img = g.createImageData(s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const a = (x / s) * Math.PI * 2, b = (y / s) * Math.PI * 2;
        const dx = Math.cos(a * 3 + Math.sin(b * 2)) * 0.5 + Math.cos(a * 7 + b * 2) * 0.25;
        const dy = Math.cos(b * 4 + Math.sin(a * 3)) * 0.5 + Math.cos(b * 9 - a) * 0.2;
        const i = (y * s + x) * 4;
        img.data[i] = 128 + dx * 90;
        img.data[i + 1] = 128 + dy * 90;
        img.data[i + 2] = 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }, false);
}

/* ---------------------------------------------- shaders ---------------------------------------------- */

/** A shaft of light: a cone of glowing air, brightest where the light comes in, soft at its edges,
 * stirred by dust. Added on top of the scene. */
function shaftMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 }, strength: { value: 0.5 } },
    vertexShader: `
      varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormal;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 color; uniform float time; uniform float strength;
      varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormal;
      void main() {
        vec3 view = normalize(cameraPosition - vWorld);
        float edge = pow(abs(dot(normalize(vNormal), view)), 2.2);
        float along = smoothstep(0.0, 0.35, vUv.y) * mix(0.35, 1.0, vUv.y);
        float dust = 0.78 + 0.22 * sin(vWorld.y * 2.3 + time * 0.6 + vWorld.x * 1.7) * sin(vWorld.z * 1.9 - time * 0.4);
        gl_FragColor = vec4(color * strength * edge * along * dust, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

/* --------------------------------------------- the component --------------------------------------------- */

/** A glyph nobody can read, drawn in light. */
function glyph(seed) {
  return canvasTexture(64, (g, s) => {
    const rand = seeded(seed);
    g.strokeStyle = '#fff';
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.36, rand() * 3, 3 + rand() * 3);
    g.stroke();
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.moveTo(s * (0.25 + rand() * 0.5), s * (0.2 + rand() * 0.6));
      g.lineTo(s * (0.25 + rand() * 0.5), s * (0.2 + rand() * 0.6));
      g.stroke();
    }
    g.beginPath();
    g.arc(s * (0.35 + rand() * 0.3), s * (0.35 + rand() * 0.3), 3, 0, 7);
    g.fill();
  });
}

AFRAME.registerComponent('ns-dungeon', {
  init() {
    this.root = new THREE.Group();
    this.root.visible = false;
    this.el.setObject3D('dungeons', this.root);
    this.portals = new THREE.Group();
    this.inside = false;
    this.built = null;
    this.mats = null;
    this.boost = 0;
    this.tone = new THREE.Color('#ffd7a3');
    // the Priest's own light: it goes with him, held at his staff, and casts the shadows
    this.lamp = new THREE.PointLight('#ffd7a3', 9 * LUX, REVEAL, 1.0);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(512, 512);
    this.lamp.shadow.bias = -0.004;
    this.lamp.shadow.camera.near = 0.1;
    this.lamp.shadow.camera.far = REVEAL;
    this.root.add(this.lamp);
    this.fade = document.getElementById('fade');
    this.el.sceneEl.addEventListener('ns-new-game', () => this.build());
  },

  /** The dungeons of the battle anew: their insides below, their portals on the islands. */
  build() {
    this.clear();
    const world = G.world;
    if (!world?.dungeons?.length) return;
    this.mats ??= this.materials();
    document.getElementById('world')?.object3D.add(this.portals);
    this.built = world.dungeons.map((d, n) => {
      const group = new THREE.Group();
      group.position.set(n * (d.w * TILE_SIZE + 60), DEPTH, 0);
      this.root.add(group);
      const inside = this.dress(d, group);
      this.portal(d);
      return { d, group, ...inside };
    });
  },

  clear() {
    for (const b of this.built ?? []) {
      b.group.removeFromParent();
      b.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); if (o.material?.userData?.own) o.material.dispose(); });
    }
    this.built = null;
    for (const c of [...this.portals.children]) c.removeFromParent();
  },

  /** Plain, matte and few: one stone for everything of rock, and a handful for what glows. */
  materials() {
    const lam = (o) => new THREE.MeshLambertMaterial(o), basic = (o) => new THREE.MeshBasicMaterial(o);
    const T = TILE_SIZE, wall = new THREE.BoxGeometry(T, 1, T), uv = wall.attributes.uv;
    // a wall's rock repeats up its height
    for (let f = 0; f < 6; f++) if (f !== 2 && f !== 3) for (let v = 0; v < 4; v++) uv.setY(f * 4 + v, uv.getY(f * 4 + v) * (TOP / T));
    this.geo = {
      wall, flat: new THREE.BoxGeometry(T, 1, T), lump: new THREE.DodecahedronGeometry(0.5, 0), spike: new THREE.ConeGeometry(0.5, 1, 5),
      shard: new THREE.OctahedronGeometry(0.22, 0), stem: new THREE.CylinderGeometry(0.035, 0.05, 1, 5), cap: new THREE.SphereGeometry(0.5, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      dot: new THREE.SphereGeometry(0.035, 6, 4), strand: new THREE.CylinderGeometry(0.012, 0.012, 1, 3), skull: new THREE.SphereGeometry(0.13, 7, 5),
      bone: new THREE.CylinderGeometry(0.025, 0.025, 0.5, 4), crack: new THREE.BoxGeometry(1, 0.04, 0.06), tile: new THREE.PlaneGeometry(T, T), pane: new THREE.PlaneGeometry(0.7, 0.7),
    };
    return {
      stone: lam({ map: rock(false) }),
      wood: lam({ map: planks() }),
      iron: lam({ color: '#3b3a3e' }),
      gold: lam({ color: '#c79a3c', emissive: '#3a2400' }),
      bone: lam({ color: '#cfc8b4' }),
      root: lam({ color: '#4a3a28' }),
      stem: lam({ color: '#d9d2bc' }),
      water: new THREE.MeshStandardMaterial({ color: '#0e3c46', roughness: 0.12, metalness: 0.2, normalMap: ripples(), normalScale: new THREE.Vector2(0.6, 0.6), transparent: true, opacity: 0.9, emissive: '#04191f' }),
      crystalBlue: lam({ color: '#7fe6ff', emissive: '#2fb8ff', emissiveIntensity: 1.6, flatShading: true }),
      crystalViolet: lam({ color: '#d7a6ff', emissive: '#9b4dff', emissiveIntensity: 1.5, flatShading: true }),
      capGreen: lam({ color: '#b6ff9a', emissive: '#56e36a', emissiveIntensity: 1.3 }),
      capViolet: lam({ color: '#f0b6ff', emissive: '#c45cff', emissiveIntensity: 1.2 }),
      ember: basic({ color: '#ff7a1e' }),
      eye: basic({ color: '#ffe27a' }),
      worm: basic({ color: '#8fe8ff' }),
      orb: basic({ color: '#fff0c8' }),
      flame: new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffb35a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      opening: basic({ color: '#fff4dc' }),
      dark: basic({ color: '#050505' }),
      glyphs: [1, 2, 3, 4].map((k) => glyph(k * 17)),
    };
  },

  /** A dungeon's inside, dressed: its rock in chunks, its rooms' things, what the dark keeps. */
  dress(d, group) {
    const M = this.mats, GEO = this.geo, N = d.w, T = TILE_SIZE, TILE = NS.TILE;
    const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= d.h ? TILE.rock : d.tiles[y * N + x]);
    const kind = new Array(N * d.h).fill('passage');
    // (a room's rock bulges a tile past its bounds)
    for (const r of d.rooms) {
      for (let y = r.y - 1; y <= r.y + r.h; y++) {
        for (let x = r.x - 1; x <= r.x + r.w; x++) {
          const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
          if (x >= 0 && y >= 0 && x < N && y < d.h && (inside || kind[y * N + x] === 'passage')) kind[y * N + x] = r.kind;
        }
      }
    }
    kind[d.stairs[1] * N + d.stairs[0]] = 'stairs';
    const kindAt = (x, y) => (x < 0 || y < 0 || x >= N || y >= d.h ? 'passage' : kind[y * N + x]);
    const local = (x, y, h = 0) => new THREE.Vector3((x - N / 2) * T, h, (y - d.h / 2) * T);
    const rand = seeded(d.seed * 131 + 7);
    const vault = new Float32Array(N * d.h);
    for (let i = 0; i < N * d.h; i++) vault[i] = HEIGHT[kind[i]] + (kind[i] === 'stairs' ? 0 : (rand() - 0.5) * 0.7);
    const high = (x, y) => vault[y * N + x] ?? 2.4;

    // chunks: each a group with its rock (four instanced meshes) and its things
    const chunks = new Map();
    const chunkAt = (tx, ty) => {
      const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK), key = `${cx},${cy}`;
      let c = chunks.get(key);
      if (!c) {
        c = { g: new THREE.Group(), mid: local((cx + 0.5) * CHUNK, (cy + 0.5) * CHUNK), lots: { wall: [], flat: [], lump: [], spike: [] } };
        group.add(c.g);
        chunks.set(key, c);
      }
      return c;
    };
    const home = (v) => chunkAt(v.x / T + N / 2, v.z / T + d.h / 2);
    const put = (lot, v, s, r, color) => home(v).lots[lot].push({ v, s, r, color });
    const shade = (hex) => new THREE.Color(hex).multiplyScalar(0.8 + rand() * 0.4);
    const mesh = (geo, mat, v, parent) => { const o = new THREE.Mesh(geo, mat); o.position.copy(v); (parent ?? home(v).g).add(o); return o; };
    const anim = [], glows = [];
    const glowAt = (v, color, size, pulse = 0) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
      sp.material.userData.own = true;
      sp.position.copy(v);
      sp.scale.setScalar(size);
      const c = home(v);
      c.g.add(sp);
      glows.push({ sp, g: c.g, pulse, phase: rand() * 6 });
      return sp;
    };
    const wallSide = (x, y) => NS.DIRS.map(([dx, dy]) => [dx, dy]).filter(([dx, dy]) => at(x + dx, y + dy) === TILE.rock)[0];
    const open = [], byWall = [];

    // the rock: walls that lean and bulge, floors, vaults of uneven height
    for (let y = -1; y <= d.h; y++) {
      for (let x = -1; x <= N; x++) {
        const t = at(x, y);
        if (t === TILE.rock) {
          let near = null;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (at(x + dx, y + dy) === TILE.rock) continue;
              const k = kindAt(x + dx, y + dy);
              if (!near || (near === 'passage' && k !== 'passage')) near = k;
            }
          }
          if (!near) continue;
          const grow = 1.05 + rand() * 0.3;
          put('wall', local(x + 0.5 + (rand() - 0.5) * 0.3, y + 0.5 + (rand() - 0.5) * 0.3, TOP / 2), [grow, TOP, grow], [0, (rand() - 0.5) * 0.7, 0], shade(TINT[near][0]));
          continue;
        }
        const k = kindAt(x, y), h = high(x, y);
        put('flat', local(x + 0.5, y + 0.5, -0.1), [1, 0.2, 1], [0, 0, 0], shade(TINT[k][1]));
        put('flat', local(x + 0.5, y + 0.5, (h + TOP) / 2), [1, TOP - h, 1], [0, 0, 0], shade(TINT[k][2]));
        if (t !== TILE.floor) continue;
        open.push([x, y]);
        const side = wallSide(x, y);
        if (!side) continue;
        byWall.push([x, y, side]);
        // (not by the stairs: the way out stays clear)
        if (Math.abs(x - d.stairs[0]) + Math.abs(y - d.stairs[1]) <= 2) continue;
        // the wall bulges into the cave: lumps at its foot and up its face
        for (let n = 0; n < 2; n++) {
          const sz = 0.5 + rand() * 0.7, v = local(x + 0.5 + side[0] * (0.48 + rand() * 0.1) + (side[1] ? rand() - 0.5 : 0), y + 0.5 + side[1] * (0.48 + rand() * 0.1) + (side[0] ? rand() - 0.5 : 0), n ? rand() * h : 0.1);
          put('lump', v, [sz, sz * (0.7 + rand() * 0.9), sz], [rand() * 3, rand() * 3, rand() * 3], shade(TINT[k][0]));
        }
      }
    }
    // stalactites from the vaults, stalagmites and rubble by the walls
    for (const [x, y] of open) {
      const k = kindAt(x, y), h = high(x, y);
      if (k === 'stairs') continue;
      for (let n = 0; n < 2; n++) {
        if (rand() > 0.34) continue;
        const len = Math.min(h - 1.95, 0.25 + rand() * 0.9), w = 0.12 + rand() * 0.22;
        if (len > 0.15) put('spike', local(x + rand(), y + rand(), h - len / 2 + 0.03), [w, len, w], [Math.PI, rand() * 3, 0], shade(TINT[k][2]));
      }
    }
    for (const [x, y, side] of byWall) {
      const k = kindAt(x, y), v = () => local(x + 0.5 + side[0] * 0.3 + (rand() - 0.5) * 0.5, y + 0.5 + side[1] * 0.3 + (rand() - 0.5) * 0.5, 0);
      if (rand() < 0.16) { const len = 0.3 + rand() * 0.9, w = 0.18 + rand() * 0.25; put('spike', v().setY(len / 2), [w, len, w], [0, rand() * 3, 0], shade(TINT[k][1])); }
      if (rand() < 0.22) for (let n = 0; n < 3; n++) { const sz = 0.1 + rand() * 0.25; put('lump', v().setY(sz * 0.3), [sz, sz * 0.7, sz], [rand() * 3, rand() * 3, 0], shade(TINT[k][1])); }
    }
    // columns, where floor and vault have grown together: a stack of rough stone, thick at both
    // ends; a shrine's are standing stones, leaning
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < N; x++) {
        if (at(x, y) !== TILE.pillar) continue;
        const k = kindAt(x, y), h = high(x, y), base = local(x + 0.5 + (rand() - 0.5) * 0.25, y + 0.5 + (rand() - 0.5) * 0.25);
        if (k === 'shrine') {
          const tall = 1.6 + rand() * 0.9;
          put('lump', base.clone().setY(tall / 2 - 0.1), [0.75 + rand() * 0.2, tall * 1.15, 0.5 + rand() * 0.2], [(rand() - 0.5) * 0.25, rand() * 3, (rand() - 0.5) * 0.25], shade('#8f8a80'));
          continue;
        }
        const parts = 5;
        for (let n = 0; n < parts; n++) {
          const f = n / (parts - 1), wide = 0.62 + Math.abs(f - 0.5) * 0.9 + rand() * 0.2;
          put('lump', base.clone().add(new THREE.Vector3((rand() - 0.5) * 0.14, f * h, (rand() - 0.5) * 0.14)), [wide, h / parts * 1.7, wide], [0, rand() * 3, 0], shade(TINT[k][0]));
        }
      }
    }

    // the rooms, each of its kind; none has a light of its own, only glow
    const shafts = [], wisps = [];
    const pick = (list) => list[Math.floor(rand() * list.length)];
    for (const r of d.rooms) {
      const mid = local(r.x + r.w / 2, r.y + r.h / 2), hgt = HEIGHT[r.kind];
      const inRoom = ([x, y]) => x >= r.x - 1 && x <= r.x + r.w && y >= r.y - 1 && y <= r.y + r.h;
      const floor = open.filter(inRoom), walls = byWall.filter(inRoom);
      if (!floor.length) continue;
      if (r.kind === 'crystal') {
        for (let k = 0; k < 7 && walls.length; k++) {
          const [x, y, [dx, dy]] = pick(walls), base = local(x + 0.5 + dx * 0.3, y + 0.5 + dy * 0.3);
          const mat = rand() < 0.65 ? M.crystalBlue : M.crystalViolet;
          for (let n = 0; n < 3; n++) {
            const len = 0.5 + rand() * 1.2, o = mesh(GEO.shard, mat, base.clone().add(new THREE.Vector3((rand() - 0.5) * 0.6, len * 0.45, (rand() - 0.5) * 0.6)));
            o.scale.set(1, len * 2.2, 1);
            o.rotation.set((rand() - 0.5) * 0.9, rand() * 3, (rand() - 0.5) * 0.9);
          }
          glowAt(base.clone().setY(0.8), mat === M.crystalBlue ? '#4fc8ff' : '#b06bff', 2.4, 0.15);
        }
        for (let k = 0; k < 5; k++) {
          const [x, y] = pick(floor), o = mesh(GEO.shard, M.crystalBlue, local(x + 0.5, y + 0.5, high(x, y) - 0.45));
          o.scale.set(1, 2.6, 1);
        }
      } else if (r.kind === 'hall') {
        // threads of glow-worms hang among the columns
        for (let k = 0; k < 14; k++) {
          const [x, y] = pick(floor), len = 0.3 + rand() * 0.8, top = local(x + rand(), y + rand(), high(x, y));
          mesh(GEO.strand, M.worm, top.clone().setY(top.y - len / 2)).scale.y = len;
          mesh(GEO.dot, M.worm, top.clone().setY(top.y - len));
        }
        for (let k = 0; k < 4; k++) { const [x, y] = pick(floor); glowAt(local(x + 0.5, y + 0.5, high(x, y) - 0.6), '#7fdcff', 1.6, 0.3); }
      } else if (r.kind === 'pool') {
        for (let y = r.y; y < r.y + r.h; y++) {
          for (let x = r.x; x < r.x + r.w; x++) {
            if (at(x, y) !== TILE.water) continue;
            mesh(GEO.tile, M.water, local(x + 0.5, y + 0.5, 0.14)).rotation.x = -Math.PI / 2;
            // its bank: stones where the water ends
            for (const [dx, dy] of NS.DIRS) {
              if (at(x + dx, y + dy) === TILE.water) continue;
              const sz = 0.3 + rand() * 0.3;
              put('lump', local(x + 0.5 + dx * 0.5 + (rand() - 0.5) * 0.4, y + 0.5 + dy * 0.5 + (rand() - 0.5) * 0.4, 0.08), [sz, sz * 0.6, sz], [rand() * 3, rand() * 3, 0], shade(TINT.pool[1]));
            }
          }
        }
        for (let k = 0; k < 4; k++) glowAt(mid.clone().add(new THREE.Vector3((rand() - 0.5) * r.w * 0.6, 0.35, (rand() - 0.5) * r.h * 0.6)), '#3fd0c0', 0.8, 0.5);
      } else if (r.kind === 'grotto') {
        for (let k = 0; k < 9 && walls.length; k++) {
          const [x, y, [dx, dy]] = pick(walls), base = local(x + 0.5 + dx * 0.2, y + 0.5 + dy * 0.2);
          const mat = rand() < 0.6 ? M.capGreen : M.capViolet;
          for (let n = 0; n < 3; n++) {
            const hh = 0.2 + rand() * 0.55, p3 = base.clone().add(new THREE.Vector3((rand() - 0.5) * 0.7, 0, (rand() - 0.5) * 0.7));
            mesh(GEO.stem, M.stem, p3.clone().setY(hh / 2)).scale.y = hh;
            mesh(GEO.cap, mat, p3.clone().setY(hh)).scale.setScalar(0.24 + hh * 0.5);
          }
          glowAt(base.clone().setY(0.45), mat === M.capGreen ? '#6dff86' : '#d07bff', 1.5, 0.2);
        }
        this.motes(home(mid).g, mid, r, hgt, '#c8ff8a', 14, 0.09, anim, 0.6);
      } else if (r.kind === 'shrine') {
        // a slab nobody remembers, a light over it, a beam on it from a crack in the vault
        const top = high(r.x + (r.w >> 1), r.y + (r.h >> 1));
        put('lump', mid.clone().setY(0.3), [1.9, 0.9, 1.3], [0, rand() * 3, 0], shade('#8f8a80'));
        const orb = mesh(GEO.skull, M.orb, mid.clone().setY(1.3));
        glowAt(mid.clone().setY(1.3), '#ffd27a', 1.3, 0.2);
        anim.push({ g: home(mid).g, f: (t) => { orb.position.y = 1.3 + Math.sin(t * 1.2) * 0.08; } });
        const crack = mesh(new THREE.CircleGeometry(0.45, 9), M.opening, mid.clone().setY(top - 0.01));
        crack.rotation.x = Math.PI / 2;
        shafts.push(this.shaft(home(mid).g, mid.clone().setY(top), mid.clone(), 0.4, 1.4, 'beam'));
      } else if (r.kind === 'ember') {
        for (let k = 0; k < 14; k++) {
          const [x, y] = pick(floor), o = mesh(GEO.crack, M.ember, local(x + rand(), y + rand(), 0.02));
          o.scale.x = 0.4 + rand() * 1.2;
          o.rotation.y = rand() * Math.PI;
          if (rand() < 0.3) glowAt(o.position.clone().setY(0.15), '#ff6a1a', 1.1, 0.35);
        }
        for (let k = 0; k < 5; k++) { const [x, y] = pick(floor), sz = 0.5 + rand() * 0.7; put('lump', local(x + rand(), y + rand(), sz * 0.3), [sz, sz * 0.8, sz], [rand() * 3, rand() * 3, 0], shade('#5a3a30')); }
        this.motes(home(mid).g, mid, r, hgt, '#ff8a3a', 20, 0.07, anim, -1.2);
      }
      // a wisp drifts about some rooms; dust in all, seen where his light falls
      if (r.kind !== 'entry' && rand() < 0.6) {
        const sp = glowAt(mid.clone().setY(1.2), r.kind === 'ember' ? '#ffb070' : '#bfe8ff', 0.5, 0.4);
        wisps.push({ sp, mid, rx: r.w * T * 0.28, rz: r.h * T * 0.28, w: 0.25 + rand() * 0.3, ph: rand() * 6 });
      }
      this.motes(home(mid).g, mid, r, hgt, '#fff2d8', 12, 0.04, anim, 0.05);
    }

    // the stairs: rough steps up to a doorway of daylight (moonlight at night), whose light falls
    // down them into the cave
    let sky = null;
    {
      const [sx, sy] = d.stairs, [ax, ay] = d.arrive, dx = sx - ax, dy = sy - ay, steps = 7;
      for (let k = 0; k < steps; k++) {
        const v = local(sx + 0.5 - dx * 0.5 + dx * (k + 0.5) / steps + (rand() - 0.5) * 0.04, sy + 0.5 - dy * 0.5 + dy * (k + 0.5) / steps + (rand() - 0.5) * 0.04, (k + 1) * 0.22 / 2);
        put('flat', v, [dx ? 1 / steps : 0.96, (k + 1) * 0.22, dy ? 1 / steps : 0.96], [0, (rand() - 0.5) * 0.06, 0], shade(TINT.stairs[1]));
      }
      const door = new THREE.Group();
      door.position.copy(local(sx + 0.5 + dx * 0.49, sy + 0.5 + dy * 0.49, 1.55));
      door.rotation.y = Math.atan2(-dx, -dy);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.7), M.opening);
      pane.position.y = 0.85;
      const arch = new THREE.Mesh(new THREE.CircleGeometry(0.55, 9, 0, Math.PI), M.opening);
      arch.position.y = 1.7;
      door.add(pane, arch);
      home(door.position).g.add(door);
      glowAt(local(sx + 0.5 + dx * 0.4, sy + 0.5 + dy * 0.4, 2.5), '#fff3d8', 3.2, 0.05).userData.sky = true;
      const from = local(sx + 0.5 + dx * 0.45, sy + 0.5 + dy * 0.45, 2.6), to = local(ax + 0.5 - dx * 2.2, ay + 0.5 - dy * 2.2, 0);
      shafts.push(this.shaft(home(from).g, from, to, 0.6, 1.9, 'sky'));
      // the one real light besides his own (always on: lights that come and go cost a shader each)
      sky = new THREE.SpotLight('#fff1d6', 60 * LUX, 20, 0.42, 0.65, 1.2);
      sky.position.copy(from);
      sky.target.position.copy(to);
      group.add(sky, sky.target);
    }

    // the chests: wood bound with iron; their lids open as they are opened
    const chests = d.chests.map((k) => {
      const [dx, dy] = wallSide(k.x, k.y) ?? [0, -1], g = new THREE.Group();
      g.position.copy(local(k.x + 0.5 - dx * 0.05, k.y + 0.5 - dy * 0.05));
      g.rotation.y = Math.atan2(-dx, -dy); // its front to the cave
      const part = (geo, mat, x, y, z, parent = g) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
      part(new THREE.BoxGeometry(1.0, 0.55, 0.62), M.wood, 0, 0.3, 0);
      for (const bx of [-0.36, 0.36]) part(new THREE.BoxGeometry(0.07, 0.57, 0.64), M.iron, bx, 0.3, 0);
      const hinge = new THREE.Group();
      hinge.position.set(0, 0.58, -0.31);
      g.add(hinge);
      part(new THREE.CylinderGeometry(0.31, 0.31, 1.0, 8, 1, false, 0, Math.PI), M.wood, 0, 0, 0.31, hinge).rotation.z = Math.PI / 2;
      part(new THREE.BoxGeometry(1.0, 0.04, 0.62), M.wood, 0, 0, 0.31, hinge);
      part(new THREE.PlaneGeometry(0.9, 0.52), M.dark, 0, 0.575, 0).rotation.x = -Math.PI / 2;
      part(new THREE.BoxGeometry(0.16, 0.18, 0.05), M.gold, 0, 0.5, 0.33);
      home(g.position).g.add(g);
      const shine = glowAt(g.position.clone().setY(0.7), '#ffd27a', 1.2, 0.25);
      return { chest: k, g, hinge, shine, open: k.opened ? 1 : 0, was: k.opened, orb: null };
    });

    // what the dark keeps. Eyes in the walls: they watch, blink, and are gone when he comes near
    const eyes = [];
    for (let k = 0; k < 16 && byWall.length; k++) {
      const [x, y, [dx, dy]] = pick(byWall), g = new THREE.Group();
      g.position.copy(local(x + 0.5 + dx * 0.36, y + 0.5 + dy * 0.36, 0.4 + rand() * 1.3));
      g.rotation.y = Math.atan2(-dx, -dy);
      for (const ex of [-0.07, 0.07]) { const o = new THREE.Mesh(GEO.dot, M.eye); o.position.x = ex; g.add(o); }
      g.scale.setScalar(0.8 + rand() * 0.9);
      home(g.position).g.add(g);
      eyes.push({ g, at: g.position, ph: rand() * 20, gone: 0 });
    }
    // glyphs that hang in the air by the walls, and wake as he passes
    const glyphs = [];
    for (let k = 0; k < 12 && byWall.length; k++) {
      const [x, y, [dx, dy]] = pick(byWall);
      const mat = new THREE.MeshBasicMaterial({ map: pick(M.glyphs), color: pick(['#7fd8ff', '#ffcf7a', '#c79bff']), transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      mat.userData.own = true;
      const o = mesh(GEO.pane, mat, local(x + 0.5 + dx * 0.2, y + 0.5 + dy * 0.2, 1 + rand() * 0.8));
      o.rotation.y = Math.atan2(-dx, -dy);
      glyphs.push({ o, y: o.position.y, ph: rand() * 6 });
    }
    // old bones by the walls, roots through the vaults of the passages
    for (let k = 0; k < 9 && byWall.length; k++) {
      const [x, y, [dx, dy]] = pick(byWall), base = local(x + 0.5 + dx * 0.15, y + 0.5 + dy * 0.15, 0);
      mesh(GEO.skull, M.bone, base.clone().setY(0.12)).scale.set(1, 0.9, 1.15);
      for (let n = 0; n < 3; n++) {
        const o = mesh(GEO.bone, M.bone, base.clone().add(new THREE.Vector3((rand() - 0.5) * 0.7, 0.03, (rand() - 0.5) * 0.7)));
        o.rotation.set(Math.PI / 2, 0, rand() * 3);
      }
    }
    for (const [x, y] of open) {
      if (kindAt(x, y) !== 'passage' || rand() > 0.3) continue;
      const len = 0.3 + rand() * 0.7, o = mesh(GEO.stem, M.root, local(x + rand(), y + rand(), high(x, y) - len / 2));
      o.scale.set(0.8, len, 0.8);
      o.rotation.z = (rand() - 0.5) * 0.5;
      if (rand() < 0.12) glowAt(local(x + 0.5, y + 0.5, 0.25), '#59e0a0', 0.5, 0.4);
    }

    // each chunk's rock, as four instanced meshes
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
    for (const c of chunks.values()) {
      for (const [lot, items] of Object.entries(c.lots)) {
        if (!items.length) continue;
        const im = new THREE.InstancedMesh(GEO[lot], M.stone, items.length);
        items.forEach((it, n) => {
          im.setMatrixAt(n, m4.compose(it.v, q.setFromEuler(e.set(...it.r)), sc.set(...it.s)));
          im.setColorAt(n, it.color);
        });
        im.castShadow = lot === 'wall' || lot === 'lump';
        im.receiveShadow = true;
        im.frustumCulled = false;
        c.g.add(im);
      }
      c.lots = null;
    }
    return { anim, glows, shafts, chests, local, chunks: [...chunks.values()], eyes, glyphs, wisps, sky, kindAt };
  },

  /** Dust or fireflies or embers drifting in a room: `rise` is how they go (up for embers). */
  motes(parent, mid, r, hgt, color, n, size, anim, rise) {
    const T = TILE_SIZE, pos = new Float32Array(n * 3), seed = [];
    const rand = seeded(Math.floor(mid.x * 97 + mid.z * 31 + n));
    for (let i = 0; i < n; i++) seed.push([(rand() - 0.5) * r.w * T * 0.8, rand() * hgt, (rand() - 0.5) * r.h * T * 0.8, rand() * 10]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color, size, map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    mat.userData.own = true;
    const pts = new THREE.Points(geo, mat);
    pts.position.copy(mid);
    pts.frustumCulled = false;
    parent.add(pts);
    anim.push({
      g: parent,
      f: (t) => {
        for (let i = 0; i < n; i++) {
          const [x, y, z, ph] = seed[i];
          pos[i * 3] = x + Math.sin(t * 0.2 + ph) * 0.4;
          pos[i * 3 + 1] = rise < 0 ? (y + t * -rise * 0.4 + ph) % hgt : y + Math.sin(t * 0.3 + ph) * 0.3 * (1 + rise);
          pos[i * 3 + 2] = z + Math.cos(t * 0.17 + ph * 1.3) * 0.4;
        }
        geo.attributes.position.needsUpdate = true;
      },
    });
  },

  /** A shaft of light from `from` down to `to`: the glowing air it falls through (no light of its own). */
  shaft(parent, from, to, top, bottom, tone) {
    const len = from.distanceTo(to), cone = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, len, 16, 1, true), shaftMaterial('#fff1d6'));
    cone.material.userData.own = true;
    cone.position.copy(from).add(to).multiplyScalar(0.5);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), from.clone().sub(to).normalize());
    parent.add(cone);
    return { cone, tone, mid: cone.position };
  },

  /** The portal of a dungeon on its island: a stone gate over stairs going down, braziers by it. */
  portal(d) {
    const M = this.mats, g = new THREE.Group(), x = d.x + 1, y = d.y + 1;
    g.position.set(wx(x), groundAt(x, y), wz(y));
    g.scale.setScalar(1.15);
    const mesh = (geo, mat, px, py, pz) => { const o = new THREE.Mesh(geo, mat); o.position.set(px, py, pz); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
    const stone = new THREE.MeshLambertMaterial({ map: M.stone.map, color: '#b3aca0' });
    mesh(new THREE.BoxGeometry(2.1, 0.18, 2.1), stone, 0, 0.09, 0);
    mesh(new THREE.BoxGeometry(0.4, 1.9, 1.8), stone, -0.8, 1.05, 0);
    mesh(new THREE.BoxGeometry(0.4, 1.9, 1.8), stone, 0.8, 1.05, 0);
    mesh(new THREE.BoxGeometry(2.0, 1.9, 0.3), stone, 0, 1.05, -0.8);
    const arch = mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.9, 12, 1, false, 0, Math.PI), stone, 0, 2.0, 0.05);
    arch.rotation.z = Math.PI / 2;
    arch.rotation.y = Math.PI / 2;
    mesh(new THREE.PlaneGeometry(1.2, 1.85), M.dark, 0, 1.0, 0.62).castShadow = false;
    for (let k = 0; k < 4; k++) mesh(new THREE.BoxGeometry(1.15, 0.12, 0.3), stone, 0, 0.3 - k * 0.07, 0.8 - k * 0.32).castShadow = false;
    const rune = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 6, 16), M.orb);
    rune.position.set(0, 2.55, 0.97);
    g.add(rune);
    for (const side of [-1, 1]) {
      mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.8, 6), M.iron, side * 1.25, 0.4, 0.95);
      mesh(new THREE.CylinderGeometry(0.2, 0.12, 0.16, 8), M.iron, side * 1.25, 0.86, 0.95);
      const f = new THREE.Sprite(M.flame);
      f.position.set(side * 1.25, 1.2, 0.95);
      f.scale.setScalar(1.1);
      g.add(f);
    }
    g.userData.dungeon = d.id;
    this.portals.add(g);
  },

  /** Where tile (x, y) of the dungeon at index n is in the scene, `h` above its floor. */
  toScene(n, x, y, h) {
    const b = this.built?.[n];
    if (!b) return null;
    b.group.updateWorldMatrix(true, false);
    return b.local(x, y, h).applyMatrix4(b.group.matrixWorld);
  },

  /** Down or up: the dungeon shown with the deep's dark, or the islands again. */
  setInside(on) {
    if (on === this.inside) return;
    this.inside = on;
    G.below = on;
    document.body.classList.toggle('below', on);
    const scene = this.el.sceneEl;
    this.root.visible = on;
    for (const el of [document.getElementById('table'), document.querySelector('a-sky'), document.getElementById('clouds')]) if (el) el.object3D.visible = !on;
    const fog = scene.object3D.fog;
    if (on) {
      this.saved = { fog: fog ? { color: fog.color.clone(), near: fog.near, far: fog.far } : null };
      // the dark has everything past his light
      if (fog) { fog.color.set('#020203'); fog.near = 6; fog.far = REVEAL; }
      const sky = document.getElementById('skylight')?.getObject3D('light');
      if (sky) { sky.color.set('#5a6684'); sky.groundColor.set('#1c1714'); sky.intensity = 0.2; }
      scene.renderer?.setClearColor?.('#020203');
    } else {
      if (fog && this.saved?.fog) { fog.color.copy(this.saved.fog.color); fog.near = this.saved.fog.near; fog.far = this.saved.fog.far; }
      // the sun puts its light and fog back as the hour has them
      const sun = document.getElementById('sun')?.components['ns-sun'];
      if (sun) sun.dark = -1;
    }
    // a moment of dark between the two
    if (this.fade) {
      this.fade.style.transition = 'none';
      this.fade.style.opacity = '1';
      requestAnimationFrame(() => requestAnimationFrame(() => { this.fade.style.transition = 'opacity 0.7s'; this.fade.style.opacity = '0'; }));
    }
  },

  tick(t, dt) {
    if (!this.built && G.world?.dungeons?.length) this.build();
    const fp = G.fp?.active ? G.world?.priestOf(ME) : null;
    const b = fp ? G.world.below?.get(fp.id) : null;
    this.setInside(!!b);
    const s = t / 1000, dark = G.world?.nights ? nightness(G.world.tick / NS.TPS) : 0;
    // the portals' braziers breathe
    for (const g of this.portals.children) for (const f of g.children) if (f.isSprite) f.scale.setScalar(1.1 * (0.88 + 0.12 * Math.sin(s * 9 + f.position.x)));
    if (!this.inside || !this.built) return;
    const here = this.built[b.dungeon];
    for (const x of this.built) x.group.visible = x === here;
    // where he is, in the dungeon's own space: only the chunks his light reaches are drawn
    const tx = b.x / NS.WALK_SUB, ty = b.y / NS.WALK_SUB, me = here.local(tx, ty, 1.4);
    const reach = REVEAL + CHUNK * TILE_SIZE * 0.71;
    for (const c of here.chunks) c.g.visible = Math.hypot(c.mid.x - me.x, c.mid.z - me.z) < reach;
    const near = (v) => Math.hypot(v.x - me.x, v.z - me.z);
    // daylight down the stairs, or moonlight at night
    const sky = new THREE.Color('#fff1d6').lerp(new THREE.Color('#8fa6ff'), dark);
    here.sky.color.copy(sky);
    here.sky.intensity = 60 * (1 - dark * 0.55) * LUX;
    for (const sh of here.shafts) {
      const u = sh.cone.material.uniforms, seen = THREE.MathUtils.clamp((REVEAL - near(sh.mid)) / 6, 0, 1);
      u.color.value.copy(sh.tone === 'sky' ? sky : this.tone.set('#ffe2a8'));
      u.time.value = s;
      u.strength.value = (sh.tone === 'sky' ? 0.8 * (1 - dark * 0.4) : 0.55) * seen;
    }
    this.mats.opening.color.copy(sky).multiplyScalar(1.4);
    for (const gl of here.glows) {
      if (!gl.g.visible) continue;
      if (gl.sp.userData.sky) gl.sp.material.color.copy(sky);
      if (gl.pulse) gl.sp.material.opacity = 0.9 * (1 - gl.pulse + gl.pulse * (0.5 + 0.5 * Math.sin(s * 2 + gl.phase)));
    }
    for (const a of here.anim) if (a.g.visible) a.f(s);
    this.mats.water.normalMap.offset.set(s * 0.012, s * 0.007);
    // eyes: they blink, and are gone when he comes near (and stay gone a while)
    for (const ey of here.eyes) {
      if (near(ey.at) < 5.5) ey.gone = s + 20;
      ey.g.visible = s > ey.gone && Math.sin(s * 0.7 + ey.ph) > -0.85 && (s * 0.31 + ey.ph) % 5 > 0.15;
    }
    // glyphs wake as he passes; wisps drift
    for (const gy of here.glyphs) {
      const wake = THREE.MathUtils.clamp(1 - near(gy.o.position) / 6, 0, 1);
      gy.o.material.opacity = 0.08 + wake * 0.75 + 0.05 * Math.sin(s * 1.7 + gy.ph);
      gy.o.position.y = gy.y + Math.sin(s * 0.8 + gy.ph) * 0.06;
    }
    for (const w of here.wisps) w.sp.position.set(w.mid.x + Math.cos(s * w.w + w.ph) * w.rx, 1.1 + Math.sin(s * 0.9 + w.ph) * 0.35, w.mid.z + Math.sin(s * w.w * 1.3 + w.ph) * w.rz);
    // the chests: a lid opens as its chest is opened, his light flaring, and a Spell's glow rises out
    for (const c of here.chests) {
      if (c.chest.opened && !c.was) {
        c.was = true;
        this.boost = 1;
        if (c.chest.holds.length) {
          c.orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#bfe8ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
          c.orb.material.userData.own = true;
          c.orb.position.copy(c.g.position).setY(0.7);
          c.orb.scale.setScalar(0.6);
          c.g.parent.add(c.orb);
          c.orbAge = 0;
        }
      }
      c.open += ((c.chest.opened ? 1 : 0) - c.open) * Math.min(1, dt / 220);
      c.hinge.rotation.x = -c.open * 1.9;
      c.shine.material.opacity = c.chest.opened ? 0 : 0.5 + 0.3 * Math.sin(s * 2.4 + c.chest.id);
      if (c.orb) {
        c.orbAge += dt / 1000;
        c.orb.position.y = 0.7 + c.orbAge * 0.9;
        c.orb.scale.setScalar(0.6 + c.orbAge * 0.5);
        c.orb.material.opacity = Math.max(0, 1 - c.orbAge / 1.6);
        if (c.orbAge > 1.6) { c.orb.removeFromParent(); c.orb = null; }
      }
    }
    this.boost *= Math.exp(-dt / 400);
    // the Priest's light, held at his staff, in the tone of the cave he is in
    const cam = this.el.sceneEl.camera;
    if (cam) {
      const o = new THREE.Vector3(0.18, 0.62, 0.12).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion())).add(cam.getWorldPosition(new THREE.Vector3()));
      this.lamp.position.copy(this.root.worldToLocal(o));
      this.lamp.color.lerp(this.tone.set(TONE[here.kindAt(Math.floor(tx), Math.floor(ty))] ?? TONE.passage), Math.min(1, dt / 600));
      this.lamp.intensity = 9 * LUX * (0.96 + 0.04 * Math.sin(s * 7)) * (1 + this.boost * 1.5);
    }
  },
});
