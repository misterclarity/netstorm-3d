/**
 * The art style: the 3D models (solarpunk: gardens, solar and wind), or the original game's sprites
 * as camera-facing cards. The models are shown unless the player picks the sprites (HUD: Sprites),
 * a choice remembered in this browser. The sprites are not part of this repository: they are read
 * at run time from netstorm-web's repository on GitHub (at the commit the submodule pins), which
 * works wherever the page may load images from other sites. Where it may not, the models stay.
 *
 * Units are animated as in netstorm-web: its slotOf() says which frame ("slot") each unit shows on
 * each tick (walking, turning, firing, building, chanting …). A type's frames are loaded the first
 * time a unit of it is drawn, a few at a time; until a frame has come, the still sprite stands in.
 */
import { ART, NS, G } from '../state.js';

const { THREE } = AFRAME;
const PX = 16; // pixels per cell across
const LOADS_AT_ONCE = 8;
/** Where the player's pick of art style is kept (storage can be missing or refuse: then none is). */
const PICK = 'ns3d-art';
const picked = () => { try { return localStorage.getItem(PICK); } catch { return null; } };

AFRAME.registerSystem('ns-art', {
  init() {
    this.frames = new Map(); // "type:slot" → frame, or 'loading' / 'missing'
    this.queue = [];
    this.loading = 0;
    this.typesAsked = new Set();
    this.resetScene();
    this.el.addEventListener('ns-new-game', () => this.resetScene());
    this.mode = 'models';
    this.images = null; // sprite key → HTMLImageElement
    this.tiles = null; // grass set → HTMLImageElement[]
    this.available = null; // true / false once tried
    this.load();
  },

  load() {
    const get = (path) => new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = ART.base + path;
    });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 12000));
    const all = Promise.all([
      Promise.all(Object.entries(ART.sprites).map(async ([k, p]) => [k, await get(p)])),
      Promise.all(Object.entries(ART.tiles).map(async ([k, list]) => [k, await Promise.all(list.map(get))])),
    ]);
    Promise.race([all, timeout]).then(([sprites, tiles]) => {
      this.images = Object.fromEntries(sprites);
      this.tiles = Object.fromEntries(tiles);
      this.available = true;
      this.el.emit('ns-art-available', { ok: true });
      if (picked() === 'sprites') this.setMode('sprites');
    }).catch(() => {
      this.available = false;
      this.el.emit('ns-art-available', { ok: false });
    });
  },

  /** Show `mode` ('models' or 'sprites'); `remember`, as the player's own pick, for the next time too. */
  setMode(mode, remember = false) {
    if (remember) { try { localStorage.setItem(PICK, mode); } catch { /* not kept */ } }
    if (mode === 'sprites' && !this.images) return;
    this.mode = mode;
    this.el.emit('ns-art-mode', { mode });
  },

  /** netstorm-web's animation state of the units (headings, turns, guns), per battle. */
  resetScene() {
    this.scene = { world: G.view, headings: new Map(), aims: new Map(), states: new NS.VisualStates(), guns: new Map() };
  },

  /** The frame an entity shows this tick ({ tex, geo, w, h, hx, hy }), or null for none yet; `adjust`
   * may change the engine's slot (a tower defense battle's High Priest: ns-units.js). */
  frameOf(e, adjust = null) {
    if (this.mode !== 'sprites' || !this.images) return null;
    if (this.scene.world !== G.view) this.resetScene();
    let slot;
    try { slot = NS.slotOf(e, G.world.tick, this.scene); } catch { return null; }
    if (slot && adjust) slot = adjust(slot);
    return slot ? this.frame(slot[0], slot[1]) : null;
  },

  /** A frame of a type's animation, loading it (and, in the background, the type's other frames). */
  frame(type, n) {
    const key = `${type}:${n}`, found = this.frames.get(key);
    if (found && typeof found === 'object') return found;
    if (found) return null; // loading, or not there
    const entry = ART.slots[type]?.[n];
    if (!entry) { this.frames.set(key, 'missing'); return null; }
    this.frames.set(key, 'loading');
    this.queue.unshift([key, type, entry]); // the frame wanted now goes first
    if (!this.typesAsked.has(type)) {
      this.typesAsked.add(type);
      ART.slots[type].forEach((other, i) => {
        const k = `${type}:${i}`;
        if (other && !this.frames.has(k)) { this.frames.set(k, 'loading'); this.queue.push([k, type, other]); }
      });
    }
    this.pump();
    return null;
  },

  pump() {
    while (this.loading < LOADS_AT_ONCE && this.queue.length) {
      const [key, type, entry] = this.queue.shift();
      const [file, ox, oy] = entry.split(',');
      this.loading++;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const done = (ok) => {
        this.loading--;
        if (ok) {
          const tex = new THREE.Texture(img);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.magFilter = THREE.NearestFilter;
          tex.needsUpdate = true;
          // the hot spot lies at -offset inside the picture
          this.frames.set(key, { tex, w: img.width, h: img.height, hx: -Number(ox), hy: -Number(oy), geo: new THREE.PlaneGeometry(img.width / PX, img.height / PX) });
        } else this.frames.set(key, 'missing');
        this.pump();
      };
      img.onload = () => done(true);
      img.onerror = () => done(false);
      img.src = `${ART.base}sprites/${type}/${file}.png`;
    }
  },

  /** The picture for a sprite key while sprites are shown, else null. */
  sprite(key) {
    return this.mode === 'sprites' && key ? this.images?.[key] ?? null : null;
  },
});
