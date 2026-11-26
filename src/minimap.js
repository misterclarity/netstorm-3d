/**
 * The minimap: the islands and bridges, everything on them and what the camera sees, drawn on a
 * canvas in the corner. Click or drag on it to look there. Its buttons (and keys H, P, F) jump to
 * your Temple or Priest, or keep the camera on the selected unit. Under the fog of war
 * (src/fog.js), island ground not yet explored is dark grey, and what the fog hides is not drawn.
 */
import { G, ME, WORLD, OWNER_COLOR, FURY_COLOR, origin, wx, wz, playerTheme } from './state.js';
import { groundPoint, lookAtCell, unit } from './space.js';
import { FOG, seenEntity } from './fog.js';

/** Island ground not yet explored: the fog's lilac mist (ns-fog.js). */
const FOGGED = '#8e8a9c';

const { THREE } = AFRAME;
const SIZE = 190;

export class Minimap {
  constructor(game) {
    this.game = game;
    this.canvas = document.getElementById('miniCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = SIZE;
    this.revision = -1;
    this.raycaster = new THREE.Raycaster();
    const look = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = this.x0 + ((e.clientX - r.left) / r.width) * this.span;
      const y = this.y0 + ((e.clientY - r.top) / r.height) * this.span;
      G.follow = null;
      lookAtCell(wx(x), wz(y));
    };
    let dragging = false;
    this.canvas.addEventListener('pointerdown', (e) => { dragging = true; this.canvas.setPointerCapture(e.pointerId); look(e); });
    this.canvas.addEventListener('pointermove', (e) => { if (dragging) look(e); });
    this.canvas.addEventListener('pointerup', () => { dragging = false; });
    document.getElementById('camTemple').onclick = () => this.toTemple();
    document.getElementById('camPriest').onclick = () => this.toPriest();
    document.getElementById('camFollow').onclick = () => this.toggleFollow();
    document.getElementById('camEyes').onclick = () => this.game.fp().toggle();
  }

  rig() {
    return document.getElementById('camera')?.components['orbit-rig'];
  }

  toTemple() {
    const t = G.world?.templeOf(ME);
    G.follow = null;
    if (t) lookAtCell(wx(t.x + t.fx / 2), wz(t.y + t.fy / 2), 45);
  }

  toPriest() {
    const p = G.world?.priestOf(ME);
    if (!p) return;
    G.selected = p.id;
    G.group = [];
    G.follow = p.id;
    this.game.hud.dirty = true;
    lookAtCell(wx(p.x + 0.5), wz(p.y + 0.5), 32);
  }

  toggleFollow() {
    G.follow = G.follow === null && G.selected !== null ? G.selected : null;
    const rig = this.rig();
    if (G.follow !== null && rig?.enabled) rig.zoomTo(Math.min(rig.goal.r, 40 * unit()));
  }

  /** Keep the camera on the unit followed, while it lasts. */
  follow() {
    document.getElementById('camFollow').classList.toggle('on', G.follow !== null);
    if (G.follow === null) return;
    const el = this.game.units()?.byId.get(G.follow);
    if (!el || !G.view.entities.has(G.follow)) { G.follow = null; return; }
    lookAtCell(el.object3D.position.x, el.object3D.position.z);
  }

  /** The islands and bridges, redrawn when the terrain changes. */
  /**
   * The ground under the dots: a pixel a cell, scaled up crisp. The islands' bounds are found again
   * only when the ground or the world changes; the fog changing (as often as the Priest or a Golem
   * moves) only paints the pixels anew, from colours worked out once a repaint, not a string a cell.
   */
  drawBase() {
    const v = G.view;
    if (this.boundsRev !== v.terrainRevision || this.boundsWorld !== G.world) {
      this.boundsRev = v.terrainRevision;
      this.boundsWorld = G.world;
      let x0 = WORLD, y0 = WORLD, x1 = 0, y1 = 0;
      for (let y = 0; y < WORLD; y++) for (let x = 0; x < WORLD; x++) {
        if (v.terrain[y * WORLD + x]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      }
      const span = Math.max(x1 - x0, y1 - y0) + 12;
      this.x0 = Math.floor((x0 + x1) / 2 - span / 2);
      this.y0 = Math.floor((y0 + y1) / 2 - span / 2);
      this.span = span;
    }
    const span = this.span;
    if (this.cells?.width !== span) {
      this.cells = document.createElement('canvas');
      this.cells.width = this.cells.height = span;
      this.pixels = this.cells.getContext('2d').createImageData(span, span);
    }
    const px = new Uint32Array(this.pixels.data.buffer), owners = new Map();
    const ownerColor = (o) => { let c = owners.get(o); if (c === undefined) owners.set(o, (c = rgba(FURY_COLOR[playerTheme(o)], 0.55))); return c; };
    px.fill(0);
    for (let y = 0; y < span; y++) {
      const cy = this.y0 + y;
      if (cy < 0 || cy >= WORLD) continue;
      for (let x = 0; x < span; x++) {
        const cx = this.x0 + x;
        if (cx < 0 || cx >= WORLD) continue;
        const i = cy * WORLD + cx, t = v.terrain[i];
        if (!t) continue;
        const bridge = t >= 2 && t <= 4, fogged = FOG.on && !FOG.seen[i];
        if (fogged && bridge) continue;
        const owner = v.owner[i];
        px[y * span + x] = fogged ? COLOR.fogged : bridge ? COLOR.bridge : owner ? ownerColor(owner) : COLOR.ground;
      }
    }
    this.cells.getContext('2d').putImageData(this.pixels, 0, 0);
    const g = this.base.getContext('2d');
    g.clearRect(0, 0, SIZE, SIZE);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.cells, 0, 0, SIZE, SIZE);
  }

  draw() {
    if (!G.view || this.canvas.offsetParent === null) return;
    if (this.revision !== G.view.terrainRevision || this.world !== G.world || this.fogRev !== FOG.revision) {
      this.revision = G.view.terrainRevision;
      this.world = G.world;
      this.fogRev = FOG.revision;
      this.drawBase();
    }
    const g = this.ctx, s = SIZE / this.span;
    const px = (x) => (x - this.x0) * s, py = (y) => (y - this.y0) * s;
    g.clearRect(0, 0, SIZE, SIZE);
    g.drawImage(this.base, 0, 0);
    for (const e of G.view.entities.values()) {
      if (!seenEntity(G.world, e)) continue;
      if (e.kind === 'geyser') {
        if (e.stock > 0) { g.fillStyle = '#bff4ff'; g.fillRect(px(e.x) - 1, py(e.y) - 1, 3, 3); }
        continue;
      }
      if (e.kind === 'crystal' || e.kind === 'obelisk') continue;
      g.fillStyle = OWNER_COLOR[e.owner] ?? '#ccc';
      if (e.kind === 'building') g.fillRect(px(e.x), py(e.y), Math.max(2, e.fx * s), Math.max(2, e.fy * s));
      else if (e.kind === 'priest') {
        g.beginPath(); g.arc(px(e.x + 0.5), py(e.y + 0.5), 3.2, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
      } else {
        const fx = e.kind === 'flyer' ? e.px / 100 : e.x + 0.5, fy = e.kind === 'flyer' ? e.py / 100 : e.y + 0.5;
        g.fillRect(px(fx) - 1, py(fy) - 1, 2.5, 2.5);
      }
    }
    // what the camera sees: the screen's corners on the ground
    const cam = this.game.el.camera;
    if (cam && this.rig()?.enabled && !this.game.xr()?.mode) {
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
        this.raycaster.setFromCamera(new THREE.Vector2(x, y), cam);
        return groundPoint(this.raycaster.ray);
      });
      if (corners.every(Boolean)) {
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = 1.2;
        g.beginPath();
        corners.forEach((c, i) => { const X = px(c.x + origin.x), Y = py(c.z + origin.z); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
        g.closePath();
        g.stroke();
      }
    }
  }
}

/** A colour ('#rrggbb', darkened by `k`) as an opaque pixel of an ImageData seen as 32-bit words
 * (the bytes red, green, blue, alpha: little-endian, as every browser is). */
function rgba(hex, k = 1) {
  const n = parseInt(hex.slice(1), 16), c = (v) => Math.round(((n >> v) & 255) * k);
  return ((255 << 24) | (c(0) << 16) | (c(8) << 8) | c(16)) >>> 0;
}

/** The minimap's ground: under the fog, a bridge, a free island (an owned one: its Fury's colour). */
const COLOR = { fogged: rgba(FOGGED), bridge: rgba('#a8804e'), ground: rgba('#7aa05a') };
