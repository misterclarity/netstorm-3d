/**
 * Dungeons as the view shows them. The rules (scripts/house-rules.mjs, digDungeon) lay a dungeon
 * out in tiles: rock, floor, stairs, pillars, water, chests, and rooms of their kinds. This dresses
 * it: walls of brick or raw rock, flagstone and rock floors, vaults with stalactites; an entry hall
 * whose stairs climb into a shaft of daylight (moonlight at night) that falls down them; a crystal
 * cave glowing blue and violet; a hall of pillars between flickering torches and hanging banners;
 * a still pool whose ripples throw back every light; a grotto of glowing mushrooms and fireflies;
 * a shrine where a beam from a crack in the vault falls on an altar between four pillars; an ember
 * cave cracked with fire. Dust drifts in the light, the Priest's own light goes with him and casts
 * the pillars' shadows, and the chests open as he opens them. Only a few real lights shine (the
 * renderer pays for each on every surface); the rest is glow.
 *
 * On the island stands each dungeon's portal: a stone gate over stairs going down, a brazier at
 * either side. The dungeon is drawn far below the sea of clouds, and shown (the islands, the sky
 * and the clouds hidden, the light and the fog of the deep put up) while the player looks through
 * the eyes of a Priest who is down in it (src/systems/ns-fp.js).
 */
import { THREE, G, NS, ME, wx, wz } from '../state.js';
import { groundAt } from '../heights.js';
import { nightness } from './ns-sun.js';

/** How bright the deep's lights are (physical units: candela). */
const LUX = 4.5;
/** Scene units a tile; where the dungeons lie; the rock's top, over every vault. */
export const TILE_SIZE = 1.6;
const DEPTH = -420;
const TOP = 9;
/** Each kind of room's vault, in scene units; passages and the stairwell. */
const HEIGHT = { entry: 5.2, crystal: 5.6, hall: 6.4, pool: 4.6, grotto: 4.2, shrine: 7.4, ember: 5, passage: 2.9, stairs: 4.6 };
const BRICK = new Set(['entry', 'hall', 'shrine', 'passage', 'stairs']);
/** Each kind's tint of its walls, floor and vault. */
const TINT = {
  entry: ['#a39a8e', '#8d867c', '#4a4540'], hall: ['#b49a78', '#9a8466', '#4d4134'], shrine: ['#c9c3b6', '#b3ad9f', '#5a564e'],
  passage: ['#8f877d', '#7a736a', '#3e3a36'], stairs: ['#a39a8e', '#8d867c', '#4a4540'],
  crystal: ['#5d6474', '#4d5464', '#2c3240'], pool: ['#5b6a62', '#4f5c55', '#2d3532'], grotto: ['#61674f', '#555a45', '#30332a'],
  ember: ['#6a4c40', '#5a3e33', '#2f211b'],
};

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

/** Brick courses: the colour map, and the relief (mortar low, the bricks' faces worn). */
function bricks(relief) {
  return canvasTexture(256, (g, s) => {
    const rand = seeded(relief ? 7 : 7);
    g.fillStyle = relief ? '#202020' : '#6b645c';
    g.fillRect(0, 0, s, s);
    const rows = 8, bh = s / rows;
    for (let r = 0; r < rows; r++) {
      const bw = s / 4, shift = (r % 2) * bw / 2;
      for (let k = -1; k < 5; k++) {
        const x = k * bw + shift, v = relief ? 150 + rand() * 90 : 150 + rand() * 70;
        g.fillStyle = relief ? `rgb(${v},${v},${v})` : `rgb(${v},${v * 0.95},${v * 0.88})`;
        g.fillRect(x + 3, r * bh + 3, bw - 6, bh - 6);
        if (!relief && rand() < 0.3) { g.fillStyle = 'rgba(40,36,30,0.25)'; g.fillRect(x + 3 + rand() * bw * 0.5, r * bh + 3, bw * 0.3, bh - 6); }
      }
    }
    grain(g, s, rand, 2500, relief ? 0.35 : 0.18);
  }, !relief);
}

/** Flagstones: irregular slabs with dark joints. */
function flags(relief) {
  return canvasTexture(256, (g, s) => {
    const rand = seeded(11);
    g.fillStyle = relief ? '#181818' : '#4a4640';
    g.fillRect(0, 0, s, s);
    const n = 3, step = s / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = relief ? 140 + rand() * 100 : 120 + rand() * 70, j = () => (rand() - 0.5) * 10;
        g.fillStyle = relief ? `rgb(${v},${v},${v})` : `rgb(${v},${v * 0.97},${v * 0.92})`;
        g.beginPath();
        g.moveTo(x * step + 4 + j(), y * step + 4 + j());
        g.lineTo((x + 1) * step - 4 + j(), y * step + 4 + j());
        g.lineTo((x + 1) * step - 4 + j(), (y + 1) * step - 4 + j());
        g.lineTo(x * step + 4 + j(), (y + 1) * step - 4 + j());
        g.closePath();
        g.fill();
      }
    }
    // a crack or two
    g.strokeStyle = relief ? '#303030' : 'rgba(20,18,16,0.6)';
    g.lineWidth = 1.5;
    for (let k = 0; k < 4; k++) {
      let x = rand() * s, y = rand() * s;
      g.beginPath();
      g.moveTo(x, y);
      for (let i = 0; i < 5; i++) { x += (rand() - 0.5) * 40; y += (rand() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
    grain(g, s, rand, 2000, relief ? 0.4 : 0.2);
  }, !relief);
}

/** Raw rock: blotches over blotches. */
function rock(relief) {
  return canvasTexture(256, (g, s) => {
    const rand = seeded(23);
    g.fillStyle = relief ? '#7a7a7a' : '#5e5a55';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      const v = relief ? 60 + rand() * 160 : 60 + rand() * 80, r = 6 + rand() * 30;
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

/** A banner's cloth: a field, a border and a sun. */
function bannerTexture(field, trim) {
  return canvasTexture(128, (g, s) => {
    g.fillStyle = field;
    g.fillRect(0, 0, s, s);
    g.fillStyle = trim;
    g.fillRect(6, 0, 6, s);
    g.fillRect(s - 12, 0, 6, s);
    g.beginPath();
    g.arc(s / 2, s * 0.42, s * 0.16, 0, Math.PI * 2);
    g.fill();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.fillRect(s / 2 + Math.cos(a) * s * 0.24 - 3, s * 0.42 + Math.sin(a) * s * 0.24 - 3, 6, 6);
    }
  });
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

AFRAME.registerComponent('ns-dungeon', {
  init() {
    this.root = new THREE.Group();
    this.root.visible = false;
    this.el.setObject3D('dungeons', this.root);
    this.portals = new THREE.Group();
    this.inside = false;
    this.built = null;
    this.mats = null;
    // the Priest's own light: it goes with him, held at his staff, and casts shadows
    this.lamp = new THREE.PointLight('#ffd7a3', 4.5 * LUX, 18, 1.2);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(512, 512);
    this.lamp.shadow.bias = -0.004;
    this.lamp.shadow.camera.near = 0.1;
    this.root.add(this.lamp);
    // a flash where a chest is opened
    this.flash = new THREE.PointLight('#ffd27a', 0, 7, 1.5);
    this.root.add(this.flash);
    this.fade = document.getElementById('fade');
    const scene = this.el.sceneEl;
    scene.addEventListener('ns-new-game', () => this.build());
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
      group.position.set(n * (d.w * TILE_SIZE + 40), DEPTH, 0);
      this.root.add(group);
      const inside = this.dress(d, group);
      this.portal(d);
      return { d, group, ...inside };
    });
  },

  clear() {
    for (const b of this.built ?? []) {
      b.group.removeFromParent();
      b.group.traverse((o) => { if (o.isMesh || o.isPoints || o.isSprite) { o.geometry?.dispose(); if (o.material?.userData?.own) o.material.dispose(); } });
    }
    this.built = null;
    for (const c of [...this.portals.children]) { c.removeFromParent(); c.traverse((o) => o.geometry?.dispose()); }
  },

  materials() {
    const brickMap = bricks(false), brickBump = bricks(true), flagMap = flags(false), flagBump = flags(true);
    const rockMap = rock(false), rockBump = rock(true);
    const std = (o) => new THREE.MeshStandardMaterial(o);
    return {
      brick: std({ map: brickMap, bumpMap: brickBump, bumpScale: 2.4, roughness: 0.92 }),
      rock: std({ map: rockMap, bumpMap: rockBump, bumpScale: 3.2, roughness: 0.96 }),
      flags: std({ map: flagMap, bumpMap: flagBump, bumpScale: 1.8, roughness: 0.85 }),
      floorRock: std({ map: rockMap, bumpMap: rockBump, bumpScale: 2.2, roughness: 0.9 }),
      vault: std({ map: rockMap, bumpMap: rockBump, bumpScale: 2.6, roughness: 1 }),
      pillar: std({ map: brickMap, bumpMap: brickBump, bumpScale: 1.2, roughness: 0.8, color: '#d8d0c2' }),
      marble: std({ color: '#e7e1d4', roughness: 0.35, metalness: 0.05 }),
      wood: std({ map: planks(), roughness: 0.75 }),
      iron: std({ color: '#3b3a3e', roughness: 0.45, metalness: 0.7 }),
      gold: std({ color: '#e0b04a', roughness: 0.3, metalness: 0.9, emissive: '#3a2400', emissiveIntensity: 0.6 }),
      water: std({ color: '#0e3c46', roughness: 0.05, metalness: 0.3, normalMap: ripples(), normalScale: new THREE.Vector2(0.6, 0.6), transparent: true, opacity: 0.9, emissive: '#04191f' }),
      crystalBlue: std({ color: '#7fe6ff', emissive: '#2fb8ff', emissiveIntensity: 2.2, roughness: 0.15, metalness: 0.1, flatShading: true }),
      crystalViolet: std({ color: '#d7a6ff', emissive: '#9b4dff', emissiveIntensity: 2, roughness: 0.15, flatShading: true }),
      capGreen: std({ color: '#b6ff9a', emissive: '#56e36a', emissiveIntensity: 1.8, roughness: 0.6 }),
      capViolet: std({ color: '#f0b6ff', emissive: '#c45cff', emissiveIntensity: 1.6, roughness: 0.6 }),
      stem: std({ color: '#d9d2bc', roughness: 0.8 }),
      root: std({ color: '#4a3a28', roughness: 1 }),
      ember: new THREE.MeshBasicMaterial({ color: '#ff7a1e' }),
      flame: new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffb35a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      bannerRed: std({ map: bannerTexture('#7a1f24', '#d9a63a'), roughness: 0.9, side: THREE.DoubleSide }),
      bannerBlue: std({ map: bannerTexture('#1f3a7a', '#d9d2c0'), roughness: 0.9, side: THREE.DoubleSide }),
      opening: new THREE.MeshBasicMaterial({ color: '#fff4dc' }),
      dark: new THREE.MeshBasicMaterial({ color: '#050505' }),
    };
  },

  /** A dungeon's inside, dressed: its stone, its rooms' things, its lights. */
  dress(d, group) {
    const M = this.mats, N = d.w, T = TILE_SIZE, TILE = NS.TILE;
    const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= d.h ? TILE.rock : d.tiles[y * N + x]);
    const kind = new Array(N * d.h).fill('passage');
    for (const r of d.rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) kind[y * N + x] = r.kind;
    kind[d.stairs[1] * N + d.stairs[0]] = 'stairs';
    const local = (x, y, h = 0) => new THREE.Vector3((x - N / 2) * T, h, (y - d.h / 2) * T);
    const rand = seeded(d.seed * 131 + 7);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color(), e = new THREE.Euler();
    // instanced stone: walls (brick, rock), floors (flags, rock), vaults
    const lots = { brick: [], rock: [], flags: [], floorRock: [], vault: [] };
    for (let y = -1; y <= d.h; y++) {
      for (let x = -1; x <= N; x++) {
        const t = at(x, y);
        if (t === TILE.rock) {
          // a wall where rock meets an open tile: of the kind of the room beside it
          // (a room's kind before a passage's)
          let near = null;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (at(x + dx, y + dy) === TILE.rock) continue;
              const k = kind[(y + dy) * N + x + dx];
              if (!near || (near === 'passage' && k !== 'passage')) near = k;
            }
          }
          if (!near) continue;
          const cave = !BRICK.has(near), j = cave ? 0.12 : 0;
          lots[cave ? 'rock' : 'brick'].push({ x, y, h: TOP / 2, sy: TOP, tint: TINT[near][0], jx: (rand() - 0.5) * j * 2, jz: (rand() - 0.5) * j * 2, turn: cave ? (rand() - 0.5) * 0.5 : 0, grow: cave ? 1 + rand() * 0.25 : 1 });
          continue;
        }
        const k = kind[y * N + x], hgt = HEIGHT[k];
        lots[BRICK.has(k) && k !== 'passage' ? 'flags' : 'floorRock'].push({ x, y, h: -0.1, sy: 0.2, tint: TINT[k][1], jx: 0, jz: 0, turn: 0, grow: 1 });
        lots.vault.push({ x, y, h: (hgt + TOP) / 2, sy: TOP - hgt, tint: TINT[k][2], jx: 0, jz: 0, turn: 0, grow: 1 });
      }
    }
    const box = (sx, sz) => {
      const g = new THREE.BoxGeometry(sx, 1, sz);
      // the sides' texture repeats along the height, a brick course to every 0.4
      const uv = g.attributes.uv;
      for (let f = 0; f < 6; f++) {
        if (f === 2 || f === 3) continue;
        for (let v = 0; v < 4; v++) uv.setY(f * 4 + v, uv.getY(f * 4 + v) * (TOP / T));
      }
      return g;
    };
    const geos = { brick: box(T, T), rock: box(T, T), flags: new THREE.BoxGeometry(T, 1, T), floorRock: new THREE.BoxGeometry(T, 1, T), vault: new THREE.BoxGeometry(T, 1, T) };
    for (const [name, items] of Object.entries(lots)) {
      if (!items.length) continue;
      const im = new THREE.InstancedMesh(geos[name], M[name], items.length);
      items.forEach((it, n) => {
        const v = local(it.x + 0.5 + it.jx, it.y + 0.5 + it.jz, it.h);
        im.setMatrixAt(n, m4.compose(p.copy(v), q.setFromEuler(e.set(0, it.turn, 0)), s.set(it.grow, it.sy, it.grow)));
        im.setColorAt(n, c.set(it.tint).multiplyScalar(0.85 + rand() * 0.3));
      });
      im.castShadow = name !== 'flags' && name !== 'floorRock';
      im.receiveShadow = true;
      group.add(im);
    }
    const lights = [], anim = [], glows = [];
    const glowAt = (v, color, size, pulse = 0) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
      sp.material.userData.own = true;
      sp.position.copy(v);
      sp.scale.setScalar(size);
      group.add(sp);
      glows.push({ sp, size, pulse, phase: rand() * 6 });
      return sp;
    };
    const light = (v, color, intensity, distance, flicker = 0, shadow = false) => {
      const l = new THREE.PointLight(color, intensity * LUX, distance, 1.6);
      l.position.copy(v);
      if (shadow) { l.castShadow = true; l.shadow.mapSize.set(512, 512); l.shadow.bias = -0.004; l.shadow.camera.near = 0.1; }
      group.add(l);
      lights.push({ l, base: intensity * LUX, flicker, phase: rand() * 10 });
      return l;
    };
    const mesh = (geo, mat, v, parent = group) => { const o = new THREE.Mesh(geo, mat); o.position.copy(v); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };
    const wallSide = (x, y) => NS.DIRS.map(([dx, dy]) => [dx, dy]).find(([dx, dy]) => at(x + dx, y + dy) === TILE.rock);

    // pillars, as tall as their room
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < N; x++) {
        if (at(x, y) !== TILE.pillar) continue;
        const k = kind[y * N + x], hgt = HEIGHT[k], v = local(x + 0.5, y + 0.5);
        const mat = k === 'shrine' ? M.marble : M.pillar;
        mesh(new THREE.CylinderGeometry(0.42, 0.48, hgt, 14), mat, v.clone().setY(hgt / 2));
        mesh(new THREE.BoxGeometry(1.25, 0.35, 1.25), mat, v.clone().setY(0.17));
        mesh(new THREE.BoxGeometry(1.2, 0.3, 1.2), mat, v.clone().setY(hgt - 0.15));
      }
    }

    // the rooms, each of its kind
    let shadows = 1; // the lamp's; a hall's torch and a shrine's beam cast them too, one of each
    const shafts = [];
    for (const r of d.rooms) {
      const hgt = HEIGHT[r.kind], mid = local(r.x + r.w / 2, r.y + r.h / 2);
      const floorTiles = [];
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (at(x, y) === TILE.floor) floorTiles.push([x, y]);
      const byWall = floorTiles.filter(([x, y]) => wallSide(x, y));
      const pick = (list) => list[Math.floor(rand() * list.length)];
      if (r.kind === 'crystal') {
        // clusters of crystals by the walls and hanging from the vault, glowing blue and violet
        for (let k = 0; k < 9 && byWall.length; k++) {
          const [x, y] = pick(byWall), [dx, dy] = wallSide(x, y), base = local(x + 0.5 + dx * 0.32, y + 0.5 + dy * 0.32);
          const mat = rand() < 0.65 ? M.crystalBlue : M.crystalViolet;
          for (let n = 0; n < 4; n++) {
            const len = 0.5 + rand() * 1.4, o = mesh(new THREE.OctahedronGeometry(0.22, 0), mat, base.clone().add(new THREE.Vector3((rand() - 0.5) * 0.6, len * 0.45, (rand() - 0.5) * 0.6)));
            o.scale.set(1, len * 2.2, 1);
            o.rotation.set((rand() - 0.5) * 0.9, rand() * 3, (rand() - 0.5) * 0.9);
            o.castShadow = false;
          }
          glowAt(base.clone().setY(0.8), mat === M.crystalBlue ? '#4fc8ff' : '#b06bff', 2.2, 0.15);
        }
        for (let k = 0; k < 7; k++) {
          const [x, y] = pick(floorTiles), v = local(x + 0.5, y + 0.5, hgt);
          const o = mesh(new THREE.OctahedronGeometry(0.2, 0), M.crystalBlue, v.clone().setY(hgt - 0.5));
          o.scale.set(1, 3, 1);
          o.castShadow = false;
        }
        const l = light(mid.clone().setY(hgt - 1.6), '#58cfff', 15, 18, 0.12);
        anim.push((t) => { l.intensity = 15 * LUX * (0.85 + 0.15 * Math.sin(t * 0.9)); });
      } else if (r.kind === 'hall') {
        // torches on the long walls, banners between; one torch casts its shadows
        const along = r.w >= r.h, walls = along ? [[r.x + (r.w >> 1), r.y, 0, -1], [r.x + (r.w >> 1), r.y + r.h - 1, 0, 1]] : [[r.x, r.y + (r.h >> 1), -1, 0], [r.x + r.w - 1, r.y + (r.h >> 1), 1, 0]];
        for (const [x, y, dx, dy] of walls) {
          for (const off of [-2, 2]) {
            const tx = x + (along ? off : 0), ty = y + (along ? 0 : off);
            if (at(tx + dx, ty + dy) !== TILE.rock || at(tx, ty) === TILE.rock) continue;
            const v = local(tx + 0.5 + dx * 0.42, ty + 0.5 + dy * 0.42, 2.6);
            mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), M.iron, v.clone().setY(2.35));
            mesh(new THREE.CylinderGeometry(0.12, 0.07, 0.25, 8), M.iron, v.clone().setY(2.65));
            const f = glowAt(v.clone().setY(2.95), '#ffb050', 0.9, 0.3), f2 = glowAt(v.clone().setY(2.9), '#ff6a20', 1.5, 0.25);
            const l = light(v.clone().setY(3).add(new THREE.Vector3(-dx * 0.25, 0, -dy * 0.25)), '#ff9a4a', 7, 12, 0.35, shadows < 2 && off < 0);
            if (l.castShadow) shadows++;
            anim.push((t) => { const k = 0.85 + 0.1 * Math.sin(t * 13 + l.position.x) + 0.05 * Math.sin(t * 31); f.scale.setScalar(0.9 * k); f2.scale.setScalar(1.5 * k); });
          }
          // a banner in the middle of the wall
          const bv = local(x + 0.5 + dx * 0.44, y + 0.5 + dy * 0.44, hgt - 2.3);
          const ban = mesh(new THREE.PlaneGeometry(1.1, 2.6, 1, 6), rand() < 0.5 ? M.bannerRed : M.bannerBlue, bv);
          ban.rotation.y = Math.atan2(-dx, -dy);
          ban.castShadow = false;
          const pos = ban.geometry.attributes.position, rest = Float32Array.from(pos.array);
          anim.push((t) => { for (let i = 0; i < pos.count; i++) pos.setZ(i, rest[i * 3 + 2] + Math.sin(t * 1.3 + rest[i * 3 + 1] * 2) * 0.03 * (1.3 - rest[i * 3 + 1])); pos.needsUpdate = true; });
        }
      } else if (r.kind === 'pool') {
        // still water, ringed with stones; a teal light over it whose ripples it throws back
        for (let y = r.y; y < r.y + r.h; y++) {
          for (let x = r.x; x < r.x + r.w; x++) {
            if (at(x, y) !== TILE.water) continue;
            const w = mesh(new THREE.PlaneGeometry(T, T), M.water, local(x + 0.5, y + 0.5, 0.18));
            w.rotation.x = -Math.PI / 2;
            w.castShadow = false;
            const sunk = mesh(new THREE.BoxGeometry(T, 0.1, T), M.dark, local(x + 0.5, y + 0.5, -0.3));
            sunk.castShadow = false;
            for (const [dx, dy] of NS.DIRS) {
              if (at(x + dx, y + dy) === TILE.water) continue;
              const st = mesh(new THREE.BoxGeometry(dx ? 0.25 : T, 0.32, dy ? 0.25 : T), M.pillar, local(x + 0.5 + dx * 0.5, y + 0.5 + dy * 0.5, 0.16));
              st.castShadow = false;
            }
          }
        }
        light(mid.clone().setY(hgt - 1.4), '#4fe0d0', 5, 12, 0.08);
        for (let k = 0; k < 5; k++) glowAt(mid.clone().add(new THREE.Vector3((rand() - 0.5) * r.w, 0.4, (rand() - 0.5) * r.h)), '#3fd0c0', 0.5, 0.5);
      } else if (r.kind === 'grotto') {
        // glowing mushrooms by the walls, roots from the vault, fireflies
        for (let k = 0; k < 14 && byWall.length; k++) {
          const [x, y] = pick(byWall), [dx, dy] = wallSide(x, y), base = local(x + 0.5 + dx * 0.25, y + 0.5 + dy * 0.25);
          const mat = rand() < 0.6 ? M.capGreen : M.capViolet;
          for (let n = 0; n < 3; n++) {
            const hh = 0.2 + rand() * 0.55, at3 = base.clone().add(new THREE.Vector3((rand() - 0.5) * 0.7, 0, (rand() - 0.5) * 0.7));
            mesh(new THREE.CylinderGeometry(0.035, 0.05, hh, 6), M.stem, at3.clone().setY(hh / 2)).castShadow = false;
            const cap = mesh(new THREE.SphereGeometry(0.12 + hh * 0.25, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat, at3.clone().setY(hh));
            cap.castShadow = false;
          }
          glowAt(base.clone().setY(0.45), mat === M.capGreen ? '#6dff86' : '#d07bff', 1.4, 0.2);
        }
        for (let k = 0; k < 16; k++) {
          const [x, y] = pick(floorTiles), len = 0.6 + rand() * 1.6;
          const o = mesh(new THREE.CylinderGeometry(0.02, 0.05, len, 5), M.root, local(x + rand(), y + rand(), hgt - len / 2));
          o.rotation.z = (rand() - 0.5) * 0.4;
        }
        light(mid.clone().setY(1.6), '#79ff9c', 6, 13, 0.06);
        this.motes(group, mid, r, hgt, '#c8ff8a', 26, 0.09, anim, 0.6);
      } else if (r.kind === 'shrine') {
        // an altar under a beam from a crack in the vault, the orb on it glowing
        const altar = mid.clone();
        mesh(new THREE.BoxGeometry(1.5, 0.9, 1, 1, 1, 1), M.marble, altar.clone().setY(0.45));
        mesh(new THREE.BoxGeometry(1.7, 0.12, 1.2), M.gold, altar.clone().setY(0.95));
        const orb = mesh(new THREE.SphereGeometry(0.22, 18, 12), new THREE.MeshStandardMaterial({ color: '#fff6d8', emissive: '#ffd58a', emissiveIntensity: 3 }), altar.clone().setY(1.45));
        orb.material.userData.own = true;
        orb.castShadow = false;
        glowAt(altar.clone().setY(1.45), '#ffd27a', 1.1, 0.2);
        anim.push((t) => { orb.position.y = 1.45 + Math.sin(t * 1.2) * 0.08; });
        const crack = mesh(new THREE.CircleGeometry(0.55, 16), M.opening, altar.clone().setY(hgt - 0.01));
        crack.rotation.x = Math.PI / 2;
        crack.castShadow = false;
        shafts.push(this.shaft(group, altar.clone().setY(hgt), altar.clone(), 0.5, 1.7, 'beam', shadows < 3));
        shadows++;
      } else if (r.kind === 'ember') {
        // the floor cracked with fire, embers rising, a red glow that breathes
        for (let k = 0; k < 18; k++) {
          const [x, y] = pick(floorTiles), len = 0.4 + rand() * 1.2;
          const o = mesh(new THREE.BoxGeometry(len, 0.04, 0.06), M.ember, local(x + rand(), y + rand(), 0.01));
          o.rotation.y = rand() * Math.PI;
          o.castShadow = false;
          if (rand() < 0.35) glowAt(o.position.clone().setY(0.15), '#ff6a1a', 0.9, 0.35);
        }
        for (let k = 0; k < 6; k++) {
          const [x, y] = pick(floorTiles), sz = 0.3 + rand() * 0.5;
          mesh(new THREE.DodecahedronGeometry(sz, 0), M.floorRock, local(x + rand(), y + rand(), sz * 0.5));
        }
        const l = light(mid.clone().setY(1.2), '#ff5a1a', 9, 14, 0.25);
        anim.push((t) => { l.intensity = 9 * LUX * (0.8 + 0.2 * Math.sin(t * 2.1) * Math.sin(t * 3.7)); });
        this.motes(group, mid, r, hgt, '#ff8a3a', 40, 0.07, anim, -1.2);
      } else if (r.kind === 'entry') {
        // braziers either side of the stairs
        const [sx, sy] = d.stairs, [ax, ay] = d.arrive, dx = sx - ax, dy = sy - ay;
        for (const side of [-1, 1]) {
          const bx = ax + 0.5 + dy * side * 1.2, by = ay + 0.5 - dx * side * 1.2;
          if (at(Math.floor(bx), Math.floor(by)) !== TILE.floor) continue;
          const v = local(bx, by);
          mesh(new THREE.CylinderGeometry(0.08, 0.14, 1, 8), M.iron, v.clone().setY(0.5));
          mesh(new THREE.CylinderGeometry(0.32, 0.18, 0.25, 12), M.iron, v.clone().setY(1.05));
          const f = glowAt(v.clone().setY(1.35), '#ffb050', 1.1, 0.3);
          anim.push((t) => { f.scale.setScalar(1.1 * (0.88 + 0.12 * Math.sin(t * 11 + side))); });
        }
        light(mid.clone().setY(2.5), '#ffb070', 4, 11, 0.2);
      }
      // dust in every room, seen where the light falls
      this.motes(group, mid, r, hgt, '#fff2d8', 30, 0.04, anim, 0.05);
    }

    // the stairs: steps up into the shaft of light that falls down them from the island
    {
      const [sx, sy] = d.stairs, [ax, ay] = d.arrive, dx = sx - ax, dy = sy - ay, steps = 7;
      for (let k = 0; k < steps; k++) {
        const v = local(sx + 0.5 - dx * 0.5 + dx * (k + 0.5) / steps, sy + 0.5 - dy * 0.5 + dy * (k + 0.5) / steps, (k + 1) * 0.22 / 2);
        const st = mesh(new THREE.BoxGeometry(dx ? T / steps : T, (k + 1) * 0.22, dy ? T / steps : T), M.flags, v);
        st.receiveShadow = true;
      }
      // at their top a doorway of daylight (moonlight at night), arched, the way out; its light
      // falls down the stairs into the hall
      const door = new THREE.Group();
      door.position.copy(local(sx + 0.5 + dx * 0.49, sy + 0.5 + dy * 0.49, 1.55));
      door.rotation.y = Math.atan2(-dx, -dy);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.7), M.opening);
      pane.position.y = 0.85;
      const top = new THREE.Mesh(new THREE.CircleGeometry(0.55, 16, 0, Math.PI), M.opening);
      top.position.y = 1.7;
      door.add(pane, top);
      group.add(door);
      glowAt(local(sx + 0.5 + dx * 0.4, sy + 0.5 + dy * 0.4, 2.5), '#fff3d8', 3.2, 0.05).userData.sky = true;
      shafts.push(this.shaft(group, local(sx + 0.5 + dx * 0.45, sy + 0.5 + dy * 0.45, 2.6), local(ax + 0.5 - dx * 2.2, ay + 0.5 - dy * 2.2, 0), 0.6, 1.9, 'sky', true));
    }

    // the chests: wood bound with iron, a gold lock; their lids open as they are opened
    const chests = d.chests.map((k) => {
      const [dx, dy] = wallSide(k.x, k.y) ?? [0, -1], g = new THREE.Group();
      g.position.copy(local(k.x + 0.5 - dx * 0.05, k.y + 0.5 - dy * 0.05));
      g.rotation.y = Math.atan2(-dx, -dy); // its front to the room
      mesh(new THREE.BoxGeometry(1.0, 0.55, 0.62), M.wood, new THREE.Vector3(0, 0.3, 0), g);
      for (const bx of [-0.36, 0.36]) mesh(new THREE.BoxGeometry(0.07, 0.57, 0.64), M.iron, new THREE.Vector3(bx, 0.3, 0), g);
      const hinge = new THREE.Group();
      hinge.position.set(0, 0.58, -0.31);
      g.add(hinge);
      const lid = mesh(new THREE.CylinderGeometry(0.31, 0.31, 1.0, 14, 1, false, 0, Math.PI), M.wood, new THREE.Vector3(0, 0, 0.31), hinge);
      lid.rotation.z = Math.PI / 2;
      mesh(new THREE.BoxGeometry(1.0, 0.04, 0.62), M.wood, new THREE.Vector3(0, 0.0, 0.31), hinge);
      const hollow = mesh(new THREE.PlaneGeometry(0.9, 0.52), M.dark, new THREE.Vector3(0, 0.575, 0), g);
      hollow.rotation.x = -Math.PI / 2;
      hollow.castShadow = false;
      for (const bx of [-0.36, 0.36]) {
        const band = mesh(new THREE.CylinderGeometry(0.325, 0.325, 0.07, 14, 1, true, 0, Math.PI), M.iron, new THREE.Vector3(bx, 0, 0.31), hinge);
        band.rotation.z = Math.PI / 2;
      }
      mesh(new THREE.BoxGeometry(0.16, 0.18, 0.05), M.gold, new THREE.Vector3(0, 0.5, 0.33), g);
      group.add(g);
      const shine = glowAt(g.position.clone().setY(0.7), '#ffd27a', 1.2, 0.25);
      return { chest: k, g, hinge, shine, open: k.opened ? 1 : 0, was: k.opened, orb: null };
    });

    // passages: a sconce glows here and there, too dim to light the way: the Priest's light does
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < N; x++) {
        if (at(x, y) !== TILE.floor || kind[y * N + x] !== 'passage' || (x * 7 + y * 13) % 9 !== 0) continue;
        const side = wallSide(x, y);
        if (!side) continue;
        glowAt(local(x + 0.5 + side[0] * 0.45, y + 0.5 + side[1] * 0.45, 1.9), '#ff9a4a', 0.55, 0.3);
      }
    }
    return { lights, anim, glows, shafts, chests, local };
  },

  /** Dust or fireflies or embers drifting in a room: `rise` is how they go (up for embers). */
  motes(group, mid, r, hgt, color, n, size, anim, rise) {
    const T = TILE_SIZE, pos = new Float32Array(n * 3), seed = [];
    const rand = seeded(Math.floor(mid.x * 97 + mid.z * 31 + n));
    for (let i = 0; i < n; i++) {
      seed.push([(rand() - 0.5) * r.w * T * 0.9, rand() * hgt, (rand() - 0.5) * r.h * T * 0.9, rand() * 10]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color, size, map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    mat.userData.own = true;
    const pts = new THREE.Points(geo, mat);
    pts.position.copy(mid);
    pts.frustumCulled = false;
    group.add(pts);
    anim.push((t) => {
      for (let i = 0; i < n; i++) {
        const [x, y, z, ph] = seed[i];
        const yy = rise < 0 ? (y + t * -rise * 0.4 + ph) % hgt : y + Math.sin(t * 0.3 + ph) * 0.3 * (1 + rise);
        pos[i * 3] = x + Math.sin(t * 0.2 + ph) * 0.4;
        pos[i * 3 + 1] = yy;
        pos[i * 3 + 2] = z + Math.cos(t * 0.17 + ph * 1.3) * 0.4;
      }
      geo.attributes.position.needsUpdate = true;
    });
  },

  /** A shaft of light from `from` down to `to`: a spot light and the glowing air it falls through. */
  shaft(group, from, to, top, bottom, tone, shadow) {
    const spot = new THREE.SpotLight('#fff1d6', 60, 24, 0.42, 0.65, 1.2);
    spot.position.copy(from);
    spot.target.position.copy(to);
    group.add(spot, spot.target);
    if (shadow) { spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0006; spot.shadow.camera.near = 0.5; }
    const len = from.distanceTo(to), cone = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, len, 28, 1, true), shaftMaterial('#fff1d6'));
    cone.material.userData.own = true;
    cone.position.copy(from).add(to).multiplyScalar(0.5);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), from.clone().sub(to).normalize());
    cone.castShadow = cone.receiveShadow = false;
    group.add(cone);
    return { spot, cone, tone };
  },

  /** The portal of a dungeon on its island: a stone gate over stairs going down, braziers by it. */
  portal(d) {
    const M = this.mats, g = new THREE.Group(), x = d.x + 1, y = d.y + 1;
    g.position.set(wx(x), groundAt(x, y), wz(y));
    g.scale.setScalar(1.15);
    const mesh = (geo, mat, px, py, pz) => { const o = new THREE.Mesh(geo, mat); o.position.set(px, py, pz); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
    const stone = M.pillar;
    mesh(new THREE.BoxGeometry(2.1, 0.18, 2.1), stone, 0, 0.09, 0);
    mesh(new THREE.BoxGeometry(0.4, 1.9, 1.8), stone, -0.8, 1.05, 0);
    mesh(new THREE.BoxGeometry(0.4, 1.9, 1.8), stone, 0.8, 1.05, 0);
    mesh(new THREE.BoxGeometry(2.0, 1.9, 0.3), stone, 0, 1.05, -0.8);
    const arch = mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.9, 16, 1, false, 0, Math.PI), stone, 0, 2.0, 0.05);
    arch.rotation.z = Math.PI / 2;
    arch.rotation.y = Math.PI / 2;
    // the dark of the stairwell, steps going down into it, a rune glowing over the door
    const dark = mesh(new THREE.PlaneGeometry(1.2, 1.85), M.dark, 0, 1.0, 0.62);
    dark.castShadow = false;
    for (let k = 0; k < 4; k++) mesh(new THREE.BoxGeometry(1.15, 0.12, 0.3), stone, 0, 0.3 - k * 0.07, 0.8 - k * 0.32).castShadow = false;
    const rune = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 6, 20), new THREE.MeshStandardMaterial({ color: '#ffe3a0', emissive: '#ffb340', emissiveIntensity: 2.2 }));
    rune.position.set(0, 2.55, 0.97);
    g.add(rune);
    for (const side of [-1, 1]) {
      mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.8, 8), M.iron, side * 1.25, 0.4, 0.95);
      mesh(new THREE.CylinderGeometry(0.2, 0.12, 0.16, 10), M.iron, side * 1.25, 0.86, 0.95);
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

  /** Down or up: the dungeon shown with the deep's light and fog, or the islands again. */
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
      if (fog) { fog.color.set('#06070b'); fog.near = 3; fog.far = 34; }
      const sky = document.getElementById('skylight')?.getObject3D('light');
      if (sky) { sky.color.set('#5a6684'); sky.groundColor.set('#1c1714'); sky.intensity = 0.55; }
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
    // daylight down the stairs, or moonlight at night
    const sky = new THREE.Color('#fff1d6').lerp(new THREE.Color('#8fa6ff'), dark);
    for (const sh of here.shafts) {
      const tone = sh.tone === 'sky' ? sky : new THREE.Color('#ffe2a8');
      sh.spot.color.copy(tone);
      sh.spot.intensity = (sh.tone === 'sky' ? 60 * (1 - dark * 0.55) : 26) * LUX;
      sh.cone.material.uniforms.color.value.copy(tone);
      sh.cone.material.uniforms.time.value = s;
      sh.cone.material.uniforms.strength.value = sh.tone === 'sky' ? 0.8 * (1 - dark * 0.4) : 0.55;
    }
    this.mats.opening.color.copy(sky).multiplyScalar(1.4);
    for (const gl of here.glows) if (gl.sp.userData.sky) gl.sp.material.color.copy(sky);
    for (const l of here.lights) if (l.flicker) l.l.intensity = l.base * (1 - l.flicker * 0.5 + l.flicker * 0.5 * (Math.sin(s * 11 + l.phase) * 0.5 + Math.sin(s * 23 + l.phase * 2) * 0.5));
    for (const gl of here.glows) if (gl.pulse) gl.sp.material.opacity = 0.9 * (1 - gl.pulse + gl.pulse * (0.5 + 0.5 * Math.sin(s * 2 + gl.phase)));
    for (const f of here.anim) f(s);
    this.mats.water.normalMap.offset.set(s * 0.012, s * 0.007);
    // the chests: a lid opens as its chest is opened, with a flash, and a Spell's orb rises out
    for (const c of here.chests) {
      if (c.chest.opened && !c.was) {
        c.was = true;
        this.flash.position.copy(c.g.position).add(here.group.position).setY(DEPTH + 1.2);
        this.flash.intensity = 14 * LUX;
        if (c.chest.holds.length) {
          c.orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#bfe8ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
          c.orb.material.userData.own = true;
          c.orb.position.copy(c.g.position).setY(0.7);
          c.orb.scale.setScalar(0.6);
          here.group.add(c.orb);
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
    this.flash.intensity *= Math.exp(-dt / 400);
    // the Priest's light, held at his staff: right of his eyes, a little above and before them
    const cam = this.el.sceneEl.camera;
    if (cam) {
      const o = new THREE.Vector3(0.18, 0.62, 0.12).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion())).add(cam.getWorldPosition(new THREE.Vector3()));
      this.lamp.position.copy(this.root.worldToLocal(o));
      this.lamp.intensity = 4.5 * LUX * (0.96 + 0.04 * Math.sin(s * 7));
    }
  },
});
