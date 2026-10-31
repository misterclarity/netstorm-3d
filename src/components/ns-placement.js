/**
 * What the player is about to do: the cells of a bridge piece or a building under the cursor (green
 * where it can go, red where not, and why), Energy rings, the gun's range and facing, the ring
 * under the selected thing and the one under the cursor, with a tooltip.
 */
import { NS, G, ME, defs, FACING_NAMES, wx, wz, errorText } from '../state.js';

const { THREE } = AFRAME;

AFRAME.registerComponent('ns-placement', {
  init() {
    this.root = new THREE.Group();
    this.el.setObject3D('overlay', this.root);
    const see = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    this.ok = see('#6fd08c', 0.45);
    this.bad = see('#ff6b5b', 0.45);
    this.energyRing = see('#7fd6ff', 0.5);
    this.energyDisc = see('#7fd6ff', 0.08);
    this.rangeRing = see('#ffd27a', 0.6);
    this.cellGeo = new THREE.BoxGeometry(0.94, 0.12, 0.94);
    this.cells = [];
    this.rings = [];
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 4), new THREE.MeshBasicMaterial({ color: '#ffd27a' }));
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), see('#f2c14e', 0.9));
    this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), see('#ffffff', 0.5));
    this.selRing.rotation.x = this.hoverRing.rotation.x = -Math.PI / 2;
    this.root.add(this.arrow, this.selRing, this.hoverRing);
    this.tip = document.getElementById('tip');
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

  ring(i, x, z, r, range) {
    let pair = this.rings[i];
    if (!pair) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96), this.energyRing);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 96), this.energyDisc);
      ring.rotation.x = disc.rotation.x = -Math.PI / 2;
      this.root.add(ring, disc);
      pair = this.rings[i] = { ring, disc };
    }
    pair.ring.material = range ? this.rangeRing : this.energyRing;
    pair.ring.visible = true;
    pair.disc.visible = !range;
    pair.ring.position.set(x, 0.1, z);
    pair.disc.position.set(x, 0.09, z);
    pair.ring.scale.setScalar(r);
    pair.disc.scale.setScalar(r);
  },

  tick() {
    if (!G.view) return;
    const game = this.el.sceneEl.systems['ns-game'];
    const tool = G.tool, at = G.hover;
    let cells = 0, rings = 0, tip = '', bad = false;
    this.arrow.visible = false;
    if (at && tool.kind === 'piece') {
      const piece = G.world.players.get(ME).hand[tool.hand];
      if (piece) {
        const err = G.view.canDropPiece({ player: ME, hand: tool.hand, x: at.x, y: at.y, rot: G.rot });
        for (const [dx, dy] of NS.rotatePiece(NS.PIECES[piece.piece], G.rot)) this.cell(cells++, at.x + dx, at.y + dy, !err);
        tip = err ? errorText(err) : 'Click to lay · R to rotate';
        bad = !!err;
      }
    } else if (at && tool.kind === 'build') {
      const def = defs.get(tool.type), a = NS.anchorFor(def, at.x, at.y), aims = NS.hasFacing(def);
      const err = G.view.canBuild({ player: ME, type: def.id, ...a, ...(aims ? { facing: G.facing } : {}) });
      for (let i = 0; i < def.footX * def.footY; i++) this.cell(cells++, a.x + (i % def.footX), a.y + Math.floor(i / def.footX), !err);
      const cx = wx(a.x + def.footX / 2), cz = wz(a.y + def.footY / 2);
      if (def.range > 0) this.ring(rings++, cx, cz, def.range, true);
      if (NS.energyNeed(def)) {
        for (const b of G.view.entities.values()) {
          if (b.kind !== 'building' || b.owner !== ME || b.rising > 0) continue;
          const src = defs.get(b.type);
          if (src.cls === 'Energy' || src.group === 'battery') this.ring(rings++, wx(b.x + b.fx / 2), wz(b.y + b.fy / 2), G.view.energyRange, false);
        }
      }
      if (aims) {
        const [dx, dy] = NS.DIRS[G.facing];
        this.arrow.visible = true;
        this.arrow.position.set(cx + dx * (def.footX / 2 + 1.2), 0.6, cz + dy * (def.footY / 2 + 1.2));
        this.arrow.rotation.set(dy * Math.PI / 2, 0, -dx * Math.PI / 2);
      }
      tip = err ? errorText(err) : `Click to build ${def.name} (${def.cost})${aims ? ` · faces ${FACING_NAMES[G.facing]} · R to turn` : ''}`;
      bad = !!err;
    }
    for (let i = cells; i < this.cells.length; i++) this.cells[i].visible = false;
    for (let i = rings; i < this.rings.length; i++) { this.rings[i].ring.visible = false; this.rings[i].disc.visible = false; }

    // rings under the selected thing and the one under the cursor
    const units = game.units();
    const ringUnder = (mesh, id, pulse) => {
      // a unit added this frame has its component but is not set up yet: no ring until it is
      const unit = id === null || id === undefined ? null : units?.byId.get(id)?.components['ns-unit'];
      mesh.visible = !!unit?.rep;
      if (!unit?.rep) return;
      const el = unit.el, foot = unit.rep.foot, r = foot ? Math.max(...foot) * 0.62 : 0.72;
      mesh.position.set(el.object3D.position.x, 0.12, el.object3D.position.z);
      mesh.scale.setScalar(r * (pulse ? 1 + Math.sin(performance.now() / 200) * 0.04 : 1));
    };
    ringUnder(this.selRing, G.selected, true);
    const hov = at && tool.kind === 'select' ? NS.entityAt(G.view, at.x, at.y) : null;
    ringUnder(this.hoverRing, hov && hov.id !== G.selected ? hov.id : null, false);
    if (hov) tip = game.hud.describe(hov);
    if (tip && G.mouse) {
      this.tip.textContent = tip;
      this.tip.className = bad ? 'bad' : '';
      this.tip.style.display = 'block';
      this.tip.style.left = `${G.mouse.x + 16}px`;
      this.tip.style.top = `${G.mouse.y + 14}px`;
    } else this.tip.style.display = 'none';
  },
});
