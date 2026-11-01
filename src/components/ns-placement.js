/**
 * What the player is about to do, and what threatens it: the cells of a bridge piece or a building
 * under the cursor (green where it can go, red where not, and why), the ends a piece joins by, the
 * reach of the gun being laid and of the enemy's guns, Energy rings, the ring under the selected
 * thing and the one under the cursor, with a tooltip.
 *
 * Enemy reach shows while a piece or a building is in hand, for an enemy gun under the cursor or
 * selected, and always when "show enemy ranges" is on (G key).
 */
import { NS, G, ME, defs, facingText, WORLD, wx, wz, errorText, FURY_COLOR } from '../state.js';
import { energyAt, sourceOf, energyTip } from '../energy.js';
import { reachOf, reachOfBuilding, isGun } from '../reach.js';

const { THREE } = AFRAME;
const KIND_COLOR = { mine: '#ffd27a', foe: '#ff5a4a', energy: '#7fd6ff' };
// Energy rings in their Fury's colour ('energy:w' ...), brighter where they count for the site
const ENERGY_LETTERS = { w: 'wind', r: 'rain', t: 'thunder', s: 'sun' };

AFRAME.registerComponent('ns-placement', {
  init() {
    this.root = new THREE.Group();
    this.el.setObject3D('overlay', this.root);
    const see = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    this.ok = see('#6fd08c', 0.45);
    this.bad = see('#ff6b5b', 0.45);
    this.mats = {};
    for (const [k, c] of Object.entries(KIND_COLOR)) this.mats[k] = { line: see(c, 0.85), fill: see(c, k === 'foe' ? 0.1 : 0.07) };
    for (const [l, fury] of Object.entries(ENERGY_LETTERS)) {
      this.mats[`energy:${l}`] = { line: see(FURY_COLOR[fury], 0.45), fill: see(FURY_COLOR[fury], 0.03) };
      this.mats[`energy:${l}:on`] = { line: see(FURY_COLOR[fury], 0.95), fill: see(FURY_COLOR[fury], 0.12) };
    }
    this.endOn = see('#f2c14e', 0.95);
    this.endOff = see('#ffffff', 0.55);
    this.cellGeo = new THREE.BoxGeometry(0.94, 0.12, 0.94);
    this.endGeo = new THREE.BoxGeometry(0.7, 0.2, 0.14);
    this.cells = [];
    this.ends = [];
    this.shapes = new Map(); // key → mesh group, reused while the same shape is shown
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 4), new THREE.MeshBasicMaterial({ color: '#ffd27a' }));
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), see('#f2c14e', 0.9));
    this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), see('#ffffff', 0.5));
    this.selRing.rotation.x = this.hoverRing.rotation.x = -Math.PI / 2;
    this.root.add(this.arrow, this.selRing, this.hoverRing);
    this.tip = document.getElementById('tip');
    this.showEnemyReach = false;
  },

  toggleEnemyReach() {
    this.showEnemyReach = !this.showEnemyReach;
    document.getElementById('rangesToggle')?.classList.toggle('on', this.showEnemyReach);
  },

  cell(i, x, y, ok) {
    let m = this.cells[i];
    if (!m) {
      m = new THREE.Mesh(this.cellGeo, this.ok);
      this.root.add(m);
      this.cells[i] = m;
    }
    m.material = ok ? this.ok : this.bad;
    m.position.set(wx(x + 0.5), 0.08, wz(y + 0.5));
    m.visible = true;
  },

  /** A bar across the edge a piece's end joins through, bright where it meets ground or bridge. */
  end(i, x, y, dir, joins) {
    let m = this.ends[i];
    if (!m) {
      m = new THREE.Mesh(this.endGeo, this.endOn);
      this.root.add(m);
      this.ends[i] = m;
    }
    const [dx, dy] = NS.DIRS[dir];
    m.material = joins ? this.endOn : this.endOff;
    m.position.set(wx(x + 0.5 + dx * 0.5), 0.2, wz(y + 0.5 + dy * 0.5));
    m.rotation.y = dx ? Math.PI / 2 : 0;
    m.visible = true;
  },

  /** A reach shape on the ground: a translucent fill with a bright edge. */
  shape(shape, tone) {
    const key = `${tone}:${JSON.stringify(shape.circle ?? shape.poly)}`;
    let g = this.shapes.get(key);
    if (!g) {
      g = new THREE.Group();
      const m = this.mats[tone];
      if (shape.circle) {
        const [cx, cy, r] = shape.circle;
        const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0, r - 0.12), r, 96), m.line);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 96), m.fill);
        for (const mesh of [ring, disc]) { mesh.rotation.x = -Math.PI / 2; mesh.position.set(wx(cx), mesh === ring ? 0.11 : 0.1, wz(cy)); }
        g.add(ring, disc);
      } else {
        const pts = shape.poly.map(([x, y]) => new THREE.Vector2(wx(x), -wz(y)));
        const fill = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)), m.fill);
        fill.rotation.x = -Math.PI / 2;
        fill.position.y = 0.1;
        g.add(fill);
        // the edge, as thin flat strips
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length], len = a.distanceTo(b);
          const strip = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.14), m.line);
          strip.rotation.x = -Math.PI / 2;
          strip.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
          strip.position.set((a.x + b.x) / 2, 0.11, -(a.y + b.y) / 2);
          g.add(strip);
        }
      }
      this.root.add(g);
      this.shapes.set(key, g);
    }
    g.visible = true;
    g.userData.used = true;
  },

  tick() {
    if (!G.view) return;
    const game = this.el.sceneEl.systems['ns-game'];
    const tool = G.tool, at = G.hover;
    let cells = 0, ends = 0, tip = '', bad = false, power = null;
    for (const g of this.shapes.values()) g.userData.used = false;
    this.arrow.visible = false;
    const enemyGuns = () => [...G.view.entities.values()].filter((e) => e.kind === 'building' && e.owner && G.world.hostile(ME, e.owner) && !e.rising && isGun(defs.get(e.type)));
    let showEnemies = this.showEnemyReach;

    if (at && tool.kind === 'piece') {
      const piece = G.world.players.get(ME).hand[tool.hand];
      if (piece) {
        const err = G.view.canDropPiece({ player: ME, hand: tool.hand, x: at.x, y: at.y, rot: G.rot });
        for (const [dx, dy] of NS.rotatePiece(NS.PIECES[piece.piece], G.rot)) this.cell(cells++, at.x + dx, at.y + dy, !err);
        for (const [cx, cy, dir] of NS.pieceEnds(piece.piece, G.rot)) {
          const [dx, dy] = NS.DIRS[dir], nx = at.x + cx + dx, ny = at.y + cy + dy;
          const t = nx >= 0 && ny >= 0 && nx < WORLD && ny < WORLD ? G.view.terrain[ny * WORLD + nx] : 0;
          this.end(ends++, at.x + cx, at.y + cy, dir, t >= 1 && t <= 4);
        }
        tip = err ? errorText(err) : 'Click to lay · R to rotate · the yellow ends join';
        bad = !!err;
        showEnemies = true;
      }
    } else if (at && tool.kind === 'build') {
      const def = defs.get(tool.type), a = NS.anchorFor(def, at.x, at.y), aims = NS.hasFacing(def);
      const err = G.view.canBuild({ player: ME, type: def.id, ...a, ...(aims ? { facing: G.facing } : {}) });
      for (let i = 0; i < def.footX * def.footY; i++) this.cell(cells++, a.x + (i % def.footX), a.y + Math.floor(i / def.footX), !err);
      for (const s of reachOf(def, a.x, a.y, G.facing)) this.shape(s, s.kind === 'energy' ? `energy:${sourceOf({ kind: 'building', type: def.id, owner: ME })?.letter ?? 's'}:on` : 'mine');
      power = energyAt(def, a.x, a.y);
      if (power.need.length) {
        // every ring of Energy the player has, in its Fury's colour; bright where it counts here
        const counts = new Set(power.sources.filter((src) => src.used).map((src) => src.b.id));
        for (const b of G.view.entities.values()) {
          if (b.kind !== 'building' || b.rising > 0 || !b.owner || G.view.hostile(ME, b.owner)) continue;
          const src = sourceOf(b);
          if (src) this.shape({ circle: [b.x + b.fx / 2, b.y + b.fy / 2, G.view.energyRange] }, `energy:${src.letter}${counts.has(b.id) ? ':on' : ''}`);
        }
      }
      if (aims) {
        const [dx, dy] = NS.DIRS[G.facing], cx = wx(a.x + def.footX / 2), cz = wz(a.y + def.footY / 2);
        this.arrow.visible = true;
        this.arrow.position.set(cx + dx * (def.footX / 2 + 1.2), 0.6, cz + dy * (def.footY / 2 + 1.2));
        this.arrow.rotation.set(dy * Math.PI / 2, 0, -dx * Math.PI / 2);
      }
      tip = err === 'no energy' ? energyTip(power)
        : err ? errorText(err)
          : `Click to build ${def.name} (${def.cost})${aims ? ` · ${facingText(def, G.facing)} · R to turn` : ''}${power.need.length ? ` · ${energyTip(power)}` : ''}`;
      bad = !!err;
      showEnemies = true;
    }

    // the selected gun's reach, and the one under the cursor
    const hov = tool.kind === 'select' ? G.hoverPick ?? (at ? NS.entityAt(G.view, at.x, at.y) : null) : null;
    for (const e of [G.selected !== null ? G.view.entities.get(G.selected) : null, hov]) {
      // a Temple's or Generator's ring of Energy, in its Fury's colour
      const src = e?.kind === 'building' && !e.rising && tool.kind === 'select' ? sourceOf(e) : null;
      if (src) this.shape({ circle: [e.x + e.fx / 2, e.y + e.fy / 2, G.view.energyRange] }, `energy:${src.letter}:on`);
      if (e?.kind !== 'building' || !isGun(defs.get(e.type)) || e.rising) continue;
      for (const s of reachOfBuilding(e)) if (s.kind !== 'energy') this.shape(s, e.owner === ME ? 'mine' : 'foe');
    }
    if (showEnemies) for (const b of enemyGuns()) for (const s of reachOfBuilding(b)) if (s.kind !== 'energy') this.shape(s, 'foe');

    for (let i = cells; i < this.cells.length; i++) this.cells[i].visible = false;
    for (let i = ends; i < this.ends.length; i++) this.ends[i].visible = false;
    for (const [key, g] of this.shapes) {
      if (g.userData.used) continue;
      g.visible = false;
      if (this.shapes.size > 200) { this.root.remove(g); g.traverse((o) => o.geometry?.dispose()); this.shapes.delete(key); }
    }

    // rings under the selected thing and the one under the cursor
    const units = game.units();
    const ringUnder = (mesh, id, pulse) => {
      // a unit added this frame has its component but is not set up yet: no ring until it is
      const unit = id === null || id === undefined ? null : units?.byId.get(id)?.components['ns-unit'];
      mesh.visible = !!unit?.rep;
      if (!unit?.rep) return;
      // an Aerial Transport's ring is as wide as the ship above it
      const el = unit.el, foot = unit.rep.foot, r = foot ? Math.max(...foot) * 0.62 : unit.rep.span ? Math.max(1.6, unit.rep.span * 1.05) : 0.72;
      mesh.position.set(el.object3D.position.x, 0.12, el.object3D.position.z);
      mesh.scale.setScalar(r * (pulse ? 1 + Math.sin(performance.now() / 200) * 0.04 : 1));
    };
    ringUnder(this.selRing, G.selected, true);
    ringUnder(this.hoverRing, hov && hov.id !== G.selected ? hov.id : null, false);
    if (hov) tip = game.hud.describe(hov);
    // the tabletop panel shows it too, where there is no mouse
    this.tipText = tip || '';
    this.tipBad = bad;
    if (tip && G.mouse) {
      this.tip.textContent = tip;
      this.tip.className = bad ? 'bad' : '';
      this.tip.style.display = 'block';
      this.tip.style.left = `${G.mouse.x + 16}px`;
      this.tip.style.top = `${G.mouse.y + 14}px`;
    } else this.tip.style.display = 'none';
  },
});
