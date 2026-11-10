/**
 * The minimap: the islands and bridges, everything on them and what the camera sees, drawn on a
 * canvas in the corner. Click or drag on it to look there. Its buttons (and keys H, P, F) jump to
 * your Temple or Priest, or keep the camera on the selected unit.
 */
import { G, ME, WORLD, OWNER_COLOR, FURY_COLOR, origin, wx, wz, playerTheme } from './state.js';
import { groundPoint, lookAtCell, unit } from './space.js';

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
  drawBase() {
    const v = G.view;
    let x0 = WORLD, y0 = WORLD, x1 = 0, y1 = 0;
    for (let y = 0; y < WORLD; y++) for (let x = 0; x < WORLD; x++) {
      if (v.terrain[y * WORLD + x]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    const span = Math.max(x1 - x0, y1 - y0) + 12;
    this.x0 = Math.floor((x0 + x1) / 2 - span / 2);
    this.y0 = Math.floor((y0 + y1) / 2 - span / 2);
    this.span = span;
    const s = SIZE / span, g = this.base.getContext('2d');
    g.clearRect(0, 0, SIZE, SIZE);
    for (let y = this.y0; y < this.y0 + span; y++) {
      for (let x = this.x0; x < this.x0 + span; x++) {
        if (x < 0 || y < 0 || x >= WORLD || y >= WORLD) continue;
        const i = y * WORLD + x, t = v.terrain[i];
        if (!t) continue;
        const owner = v.owner[i];
        g.fillStyle = t >= 2 && t <= 4 ? '#8a5a34' : owner ? shade(FURY_COLOR[playerTheme(owner)], 0.55) : '#6f7a5a';
        g.fillRect((x - this.x0) * s, (y - this.y0) * s, Math.ceil(s), Math.ceil(s));
      }
    }
  }

  draw() {
    if (!G.view || this.canvas.offsetParent === null) return;
    if (this.revision !== G.view.terrainRevision || this.world !== G.world) {
      this.revision = G.view.terrainRevision;
      this.world = G.world;
      this.drawBase();
    }
    const g = this.ctx, s = SIZE / this.span;
    const px = (x) => (x - this.x0) * s, py = (y) => (y - this.y0) * s;
    g.clearRect(0, 0, SIZE, SIZE);
    g.drawImage(this.base, 0, 0);
    for (const e of G.view.entities.values()) {
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

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
  return `rgb(${c.join(',')})`;
}
