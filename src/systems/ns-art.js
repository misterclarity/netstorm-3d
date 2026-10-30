/**
 * The art style: the simple 3D models, or the original game's sprites as camera-facing cards.
 * The sprites are not part of this repository: they are read at run time from netstorm-web's
 * repository on GitHub (at the commit the submodule pins), which works wherever the page may load
 * images from other sites. Where it may not, the models stay.
 */
import { ART } from '../state.js';

AFRAME.registerSystem('ns-art', {
  init() {
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
      this.setMode('sprites');
    }).catch(() => {
      this.available = false;
      this.el.emit('ns-art-available', { ok: false });
    });
  },

  setMode(mode) {
    if (mode === 'sprites' && !this.images) return;
    this.mode = mode;
    this.el.emit('ns-art-mode', { mode });
  },

  /** The picture for a sprite key while sprites are shown, else null. */
  sprite(key) {
    return this.mode === 'sprites' && key ? this.images?.[key] ?? null : null;
  },
});
