/**
 * The fog of war, seen (`ns-fog`): island ground the player has not explored (src/fog.js) lies
 * under a haze, as in an RTS (a soft lilac mist, like a low cloud come to rest on it): flat, a hand
 * above the ground, soft at its edges and slowly stirring, darker by night. Where the player's things come within sight it thins away over half a
 * second. One plane over the map for each level of the islands (heights.js), drawn by a shader from
 * a texture of the fog's density, a texel to a cell: dense over ground not yet explored, nothing
 * over ground explored or open sky; blurred at the edge of what has been seen, so that it fades out
 * over a couple of cells there, and stopping at the islands' rims. Without the fog (the setting),
 * nothing is drawn.
 */
import { G, WORLD, origin } from '../state.js';
import { HEIGHTS, TIER, heightOfCell } from '../heights.js';
import { nightness } from './ns-sun.js';
import { FOG } from '../fog.js';

const { THREE } = AFRAME;
const N = WORLD;
/** The levels of tiered islands, and the texture's channel each is drawn from (R, G, B). */
const LEVELS = [-1, 0, 1];
const HAZE = '#aaa4be';
/** How high over its ground the haze lies, and how fast it thins (ms to most of the way). */
const LIFT = 0.4;
const FADE_MS = 160;

const land = (t) => t === 1 || t === 5;

/** A box blur of radius r, along the rows and then the columns, of a map-sized array (in place). */
function blur(a, tmp, r) {
  const k = 1 / (2 * r + 1), at = (v) => Math.min(N - 1, Math.max(0, v));
  for (let y = 0; y < N; y++) {
    const row = y * N;
    let s = 0;
    for (let x = -r; x <= r; x++) s += a[row + at(x)];
    for (let x = 0; x < N; x++) {
      tmp[row + x] = s * k;
      s += a[row + at(x + r + 1)] - a[row + at(x - r)];
    }
  }
  for (let x = 0; x < N; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[at(y) * N + x];
    for (let y = 0; y < N; y++) {
      a[y * N + x] = s * k;
      s += tmp[at(y + r + 1) * N + x] - tmp[at(y - r) * N + x];
    }
  }
}

const VERTEX = `
  varying vec2 vCell;
  #include <fog_pars_vertex>
  void main() {
    vCell = position.xz;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const FRAGMENT = `
  uniform sampler2D map;
  uniform vec3 channel;
  uniform vec3 color;
  uniform float time;
  uniform float dark;
  uniform float size;
  varying vec2 vCell;
  #include <fog_pars_fragment>
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    float d = dot(texture2D(map, vCell / size).rgb, channel);
    if (d < 0.01) discard;
    vec2 p = vCell * 0.09;
    float n = noise(p + vec2(time * 0.035, time * 0.021)) * 0.62 + noise(p * 2.7 - vec2(time * 0.05, time * 0.013)) * 0.38;
    gl_FragColor = vec4(color * (0.7 + 0.6 * n) * mix(1.0, 0.55, dark), min(0.93, d * (0.76 + 0.24 * n)));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

AFRAME.registerComponent('ns-fog', {
  init() {
    this.group = new THREE.Group();
    this.el.setObject3D('fog', this.group);
    this.bytes = new Uint8Array(N * N * 4);
    this.texture = new THREE.DataTexture(this.bytes, N, N);
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    // per level: the density drawn now, the one it thins toward, and where the level's ground is
    this.now = LEVELS.map(() => new Float32Array(N * N));
    this.goal = LEVELS.map(() => new Float32Array(N * N));
    this.ground = LEVELS.map(() => new Float32Array(N * N));
    this.unseen = new Float32Array(N * N);
    this.tmp = new Float32Array(N * N);
    this.fading = [];
    const geo = new THREE.PlaneGeometry(N, N).rotateX(-Math.PI / 2).translate(N / 2, 0, N / 2);
    this.planes = LEVELS.map((level, k) => {
      const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        map: { value: null }, channel: { value: new THREE.Vector3(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0) },
        color: { value: new THREE.Color(HAZE) }, time: { value: 0 }, dark: { value: 0 }, size: { value: N },
      }]);
      uniforms.map.value = this.texture;
      const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, fog: true }));
      // (under every other overlay: rings and previews show over it)
      mesh.renderOrder = -1;
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    });
    const scene = this.el.sceneEl;
    scene.addEventListener('ns-new-game', () => this.layout(true));
    scene.addEventListener('ns-terrain', () => this.layout(false));
  },

  /** Where each level's ground is, for the islands as they are now. */
  layout(force) {
    const v = G.view;
    if (!v) return;
    let islands = (FOG.on ? 1 : 0) + (HEIGHTS.on ? 2 : 0);
    for (let i = 0; i < N * N; i++) if (land(v.terrain[i])) islands = (Math.imul(islands, 31) + i) | 0;
    if (!force && islands === this.islands) return;
    this.islands = islands;
    for (const g of this.ground) g.fill(0);
    if (FOG.on) {
      for (let i = 0; i < N * N; i++) if (land(v.terrain[i])) this.ground[this.levelOf(i % N, (i / N) | 0)][i] = 1;
    }
    this.planes.forEach((m, k) => {
      m.visible = FOG.on && this.ground[k].some((d) => d > 0);
      m.position.set(-origin.x, LEVELS[k] * (HEIGHTS.on ? TIER : 0) + LIFT, -origin.z);
    });
    this.refresh(true);
  },

  levelOf(x, y) {
    return HEIGHTS.on ? Math.max(0, Math.min(2, Math.round(heightOfCell(x, y) / TIER) + 1)) : 1;
  },

  /** The density the haze thins toward, from what is explored now; at once with `snap`. */
  refresh(snap) {
    this.rev = FOG.revision;
    this.fading = [];
    if (!FOG.on) return;
    const u = this.unseen;
    for (let i = 0; i < N * N; i++) u[i] = FOG.seen[i] ? 0 : 1;
    blur(u, this.tmp, 1);
    blur(u, this.tmp, 1);
    for (let k = 0; k < LEVELS.length; k++) {
      const goal = this.goal[k], now = this.now[k], ground = this.ground[k];
      for (let i = 0; i < N * N; i++) {
        goal[i] = u[i] * ground[i];
        if (snap) now[i] = goal[i];
        else if (Math.abs(now[i] - goal[i]) > 0.004) this.fading.push(k * N * N + i);
      }
      if (snap) for (let i = 0; i < N * N; i++) this.bytes[i * 4 + k] = Math.round(now[i] * 255);
    }
    if (snap) this.texture.needsUpdate = true;
  },

  /** How thick the haze is drawn over cell (x, y) now, 0 to 1. */
  densityAt(x, y) {
    const i = y * N + x;
    return Math.max(...this.now.map((now) => now[i]));
  },

  tick(t, dt) {
    if (!FOG.on || !this.planes.some((m) => m.visible)) return;
    // what was explored since: a few times a second at most
    if (this.rev !== FOG.revision && t - (this.at ?? 0) > 120) {
      this.at = t;
      this.refresh(false);
    }
    if (this.fading.length) {
      const k = 1 - Math.exp(-Math.min(dt, 100) / FADE_MS);
      this.fading = this.fading.filter((j) => {
        const level = Math.floor(j / (N * N)), i = j - level * N * N, now = this.now[level], goal = this.goal[level][i];
        now[i] += (goal - now[i]) * k;
        const done = Math.abs(goal - now[i]) < 0.004;
        if (done) now[i] = goal;
        this.bytes[i * 4 + level] = Math.round(now[i] * 255);
        return !done;
      });
      this.texture.needsUpdate = true;
    }
    const dark = G.world?.nights ? nightness(G.world.clockSeconds()) : 0;
    for (const m of this.planes) {
      m.material.uniforms.time.value = t / 1000;
      m.material.uniforms.dark.value = dark;
    }
  },

  remove() {
    this.texture.dispose();
    this.planes[0].geometry.dispose();
    for (const m of this.planes) m.material.dispose();
  },
});
