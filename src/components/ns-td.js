/**
 * A tower defense battle in the scene (src/td-hud.js; the rules are sim/td.ts): a frame round each
 * empty stone platform, brighter under the cursor and pulsing while there is Storm Power for a gun,
 * the link across the bridge between an Arc gate's two; the storm gates the horde comes out of,
 * swirling; small arrows along its ways; the reach of the gun pointed at in a menu, or of the gun
 * whose menu is open, cell by cell (walkers' ground amber, airships' sky blue); the reach of a Spell
 * being aimed; a gun's rank in stars over it; a frosty ring under a chilled walker, and a pale one
 * about a gun the flagship holds still. And the High Priest's: the ring of his blessing at his
 * feet, brighter when he is picked, with the reach of his bolts; the reach of his Storm Hammer as it
 * is aimed; his own hit points over him; a glow under each gun he blesses, pulsing in a Rally; a
 * gold ring under each walker he holds up. Built as a battle starts; nothing is drawn elsewhere.
 */
import { NS, G, ME, THREE, wx, wz } from '../state.js';
import { groundAt } from '../heights.js';
import { spotAt } from '../td-hud.js';

const CELLS = 4000;

/** A square frame round a 3×3 platform, lying flat. */
function frameGeometry() {
  return new THREE.RingGeometry(1.3 * Math.SQRT2, 1.52 * Math.SQRT2, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2);
}

/** A small arrow, lying flat, pointing along +x. */
function arrowGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0.32, 0);
  s.lineTo(-0.2, 0.26);
  s.lineTo(-0.08, 0);
  s.lineTo(-0.2, -0.26);
  s.closePath();
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
}

/** A storm gate's swirl, drawn once. */
function swirlTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(230,200,255,0.95)');
  grad.addColorStop(0.25, 'rgba(120,60,180,0.85)');
  grad.addColorStop(0.7, 'rgba(40,20,70,0.75)');
  grad.addColorStop(1, 'rgba(20,10,40,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(210,170,255,0.55)';
  g.lineWidth = 3;
  for (let k = 0; k < 4; k++) {
    g.beginPath();
    for (let t = 0; t < 1; t += 0.02) {
      const a = k * (Math.PI / 2) + t * 4.2, r = 6 + t * 54;
      g[t ? 'lineTo' : 'moveTo'](64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The crackle of an Arc gate's band, drawn once: zigzags of light across a dark strip. */
let CRACKLE = null;
function crackleTexture() {
  if (CRACKLE) return CRACKLE;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(160,110,255,0)');
  grad.addColorStop(0.5, 'rgba(170,120,255,0.55)');
  grad.addColorStop(1, 'rgba(160,110,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 64);
  g.lineWidth = 2.2;
  for (let k = 0; k < 3; k++) {
    g.strokeStyle = k ? 'rgba(220,200,255,0.8)' : 'rgba(255,255,255,0.95)';
    g.beginPath();
    let y = 32;
    for (let x = 0; x <= 256; x += 8) {
      y = Math.max(8, Math.min(56, y + (Math.sin(x * 0.37 + k * 2.1) + Math.sin(x * 0.11 + k)) * 7));
      g[x ? 'lineTo' : 'moveTo'](x, y);
    }
    g.stroke();
  }
  CRACKLE = new THREE.CanvasTexture(c);
  CRACKLE.wrapS = THREE.RepeatWrapping;
  CRACKLE.colorSpace = THREE.SRGBColorSpace;
  return CRACKLE;
}

/** Stars for a rank, drawn once each. */
const RANK_TEXTURES = new Map();
function rankTexture(rank) {
  if (!RANK_TEXTURES.has(rank)) {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 32;
    const g = c.getContext('2d');
    g.font = 'bold 26px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(40,28,10,0.9)';
    g.fillStyle = '#ffd04a';
    const text = '★'.repeat(rank);
    g.strokeText(text, 48, 17);
    g.fillText(text, 48, 17);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    RANK_TEXTURES.set(rank, tex);
  }
  return RANK_TEXTURES.get(rank);
}

AFRAME.registerComponent('ns-td', {
  init() {
    this.group = new THREE.Group();
    this.el.object3D.add(this.group);
    this.onNew = () => this.build();
    this.el.sceneEl.addEventListener('ns-new-game', this.onNew);
    this.m4 = new THREE.Matrix4();
    this.v = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3(1, 1, 1);
    this.clear();
  },

  remove() {
    this.el.sceneEl.removeEventListener('ns-new-game', this.onNew);
    this.clear();
  },

  clear() {
    for (const o of [...(this.group?.children ?? [])]) {
      this.group.remove(o);
      o.traverse?.((m) => {
        m.geometry?.dispose();
        if (m.material && !m.material.shared) m.material.dispose?.();
      });
    }
    this.frames = [];
    this.links = [];
    this.gates = [];
    this.badges = new Map();
    this.bands = new Map();
    this.hero = null;
    this.cells = null;
    this.ring = null;
    this.chill = null;
    this.held = null;
    this.previewSig = '';
  },

  /** A cell's middle in the scene, at the height of its ground. */
  at(x, y, up = 0) {
    return new THREE.Vector3(wx(x), groundAt(x, y) + up, wz(y));
  },

  build() {
    this.clear();
    const td = G.world?.td;
    this.el.object3D.visible = !!td;
    if (!td) return;

    // the frames round the platforms, and the links of the Arc gates
    const frameGeo = frameGeometry();
    td.spots.forEach((s, k) => {
      const color = s.pair ? '#c9a2ff' : '#ffe08a';
      for (const [x, y] of [[s.x, s.y], ...(s.pair ? [s.pair] : [])]) {
        const m = new THREE.Mesh(frameGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
        m.position.copy(this.at(x + 1.5, y + 1.5, 0.3));
        m.renderOrder = 2;
        m.userData = { spot: k };
        this.group.add(m);
        this.frames.push(m);
      }
      if (s.pair) {
        const a = this.at(s.x + 1.5, s.y + 1.5, 0.35), b = this.at(s.pair[0] + 1.5, s.pair[1] + 1.5, 0.35);
        const len = a.distanceTo(b), mid = a.clone().add(b).multiplyScalar(0.5);
        const link = new THREE.Group();
        for (let i = 0; i < Math.floor(len / 0.8); i++) {
          const dash = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.12), new THREE.MeshBasicMaterial({ color: '#c9a2ff', transparent: true, opacity: 0.75 }));
          dash.position.set(-len / 2 + 0.4 + i * 0.8, 0, 0);
          link.add(dash);
        }
        link.position.copy(mid);
        link.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
        link.userData = { spot: k };
        this.group.add(link);
        this.links.push(link);
      }
    });

    // the storm gates the horde comes out of: a dark ring about a swirl, upright across the way
    const swirl = swirlTexture();
    for (const route of td.routes) {
      const [x0, y0] = route.cells[0], [x1, y1] = route.cells[Math.min(3, route.cells.length - 1)];
      const gate = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.22, 8, 28), new THREE.MeshStandardMaterial({ color: '#2a1840', emissive: '#5a2a90', emissiveIntensity: 0.8, roughness: 0.6 }));
      const face = new THREE.Mesh(new THREE.CircleGeometry(1.45, 32), new THREE.MeshBasicMaterial({ map: swirl, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      gate.add(ring, face);
      gate.position.copy(this.at(x0 + 0.5, y0 + 0.5, route.air ? 9 : 1.7));
      gate.rotation.y = Math.atan2(x1 - x0, y1 - y0);
      gate.userData = { face };
      this.group.add(gate);
      this.gates.push(gate);
    }

    // arrows along the walkers' ways, every few cells
    const marks = [];
    for (const route of td.routes) {
      if (route.air) continue;
      for (let i = 3; i < route.cells.length - 2; i += 5) {
        const [x, y] = route.cells[i], [nx, ny] = route.cells[i + 1];
        marks.push([x + 0.5, y + 0.5, Math.atan2(-(ny - y), nx - x)]);
      }
    }
    if (marks.length) {
      const arrows = new THREE.InstancedMesh(arrowGeometry(), new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.45, depthWrite: false }), marks.length);
      marks.forEach(([x, y, a], i) => {
        this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
        arrows.setMatrixAt(i, this.m4.compose(this.at(x, y, 0.12), this.q, this.s.set(1, 1, 1)));
      });
      arrows.renderOrder = 2;
      this.group.add(arrows);
    }

    // the reach of a gun or a Spell, cell by cell
    this.cells = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.32, depthWrite: false }), CELLS);
    this.cells.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CELLS * 3), 3);
    this.cells.count = 0;
    this.cells.renderOrder = 3;
    this.cells.frustumCulled = false;
    this.group.add(this.cells);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd04a', transparent: true, opacity: 0.85, depthWrite: false }));
    this.ring.visible = false;
    this.ring.renderOrder = 4;
    this.group.add(this.ring);

    // the frost under a chilled walker, the pale ring about a gun held still
    this.chill = new THREE.InstancedMesh(new THREE.RingGeometry(0.3, 0.52, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#bfe8ff', transparent: true, opacity: 0.8, depthWrite: false }), 256);
    this.chill.count = 0;
    this.chill.frustumCulled = false;
    this.group.add(this.chill);
    this.held = new THREE.InstancedMesh(new THREE.RingGeometry(1.7, 2.0, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#cfe6ff', transparent: true, opacity: 0.7, depthWrite: false }), 64);
    this.held.count = 0;
    this.held.frustumCulled = false;
    this.group.add(this.held);

    // the High Priest's: his blessing's ring, his bolts' when picked, his hit points, the guns he
    // blesses, the walkers he holds up
    const ring = (inner, color, opacity) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(inner, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      m.renderOrder = 4;
      this.group.add(m);
      return m;
    };
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.26), new THREE.MeshBasicMaterial({ color: '#1c1408', transparent: true, opacity: 0.85, depthTest: false }));
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.16), new THREE.MeshBasicMaterial({ color: '#ffd04a', depthTest: false }));
    fill.position.z = 0.001;
    back.renderOrder = 13;
    fill.renderOrder = 14;
    const bar = new THREE.Group();
    bar.add(back, fill);
    this.group.add(bar);
    this.hero = {
      bless: ring(0.97, '#ffd04a', 0.35),
      pick: ring(0.8, '#fff3c4', 0.9),
      reach: ring(0.985, '#fff3c4', 0.6),
      bar,
      fill,
      glow: new THREE.InstancedMesh(new THREE.RingGeometry(1.2, 1.65, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd04a', transparent: true, opacity: 0.55, depthWrite: false }), 64),
      holds: new THREE.InstancedMesh(new THREE.RingGeometry(0.34, 0.5, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd04a', transparent: true, opacity: 0.9, depthWrite: false }), 8),
    };
    for (const m of [this.hero.glow, this.hero.holds]) {
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = 4;
      this.group.add(m);
    }
  },

  /** The High Priest's rings, bar and glows, as he stands, is picked or aims. */
  heroTick(t, w, td, units) {
    const h = this.hero, hero = td.hero, p = NS.tdPriest(w), el = p && units?.byId.get(p.id);
    const standing = !!el && hero.down === 0 && !td.over, k = hero.skills;
    const at = el ? el.object3D.position : null;
    h.bless.visible = standing;
    h.pick.visible = standing && G.tdHero;
    h.reach.visible = standing && (G.tdHero || G.tdCast === 'hammer');
    h.bar.visible = !!el && !td.over;
    if (at) {
      const blessed = NS.TD_HERO.bless.reach[k.bless] + 0.5, rally = hero.rally > 0;
      h.bless.position.set(at.x, at.y + 0.2, at.z);
      h.bless.scale.setScalar(rally ? NS.TD_HERO.rally.reach + 0.5 : blessed);
      h.bless.material.opacity = rally ? 0.45 + 0.3 * Math.sin(t / 120) : 0.3;
      h.pick.position.set(at.x, at.y + 0.22, at.z);
      h.pick.scale.setScalar(0.9 + 0.08 * Math.sin(t / 180));
      h.reach.position.set(at.x, at.y + 0.21, at.z);
      h.reach.scale.setScalar(G.tdCast === 'hammer' ? NS.TD_HERO.hammer.range + 0.5 : NS.TD_HERO.bolt.reach[k.bolt] + 0.5);
      // his hit points over him, facing the camera
      const f = Math.max(0, hero.hp / hero.hpMax);
      h.bar.position.set(at.x, at.y + 3.1, at.z);
      h.bar.quaternion.copy(this.el.sceneEl.camera.getWorldQuaternion(this.q));
      h.fill.scale.x = Math.max(0.001, hero.down > 0 ? 0 : f);
      h.fill.position.x = -0.9 * (1 - (hero.down > 0 ? 0 : f));
      h.fill.material.color.set(f > 0.5 ? '#ffd04a' : f > 0.25 ? '#ff9f43' : '#ff6b5b');
    }
    // a glow under each gun he blesses (in a Rally, within its reach)
    let n = 0;
    if (standing) {
      for (const [id] of td.ranks) {
        const b = w.entities.get(id);
        if (!b || n >= 64 || NS.tdBlessing(w, b.x + b.fx / 2, b.y + b.fy / 2) <= 1) continue;
        h.glow.setMatrixAt(n++, this.m4.compose(this.at(b.x + b.fx / 2, b.y + b.fy / 2, 0.32), this.q.identity(), this.s.setScalar(hero.rally > 0 ? 1 + 0.12 * Math.sin(t / 110) : 1)));
      }
    }
    h.glow.count = n;
    h.glow.instanceMatrix.needsUpdate = true;
    h.glow.material.opacity = hero.rally > 0 ? 0.8 : 0.45;
    // a ring under each walker he holds up
    n = 0;
    for (const id of hero.holding) {
      const u = units?.byId.get(id);
      if (!u || n >= 8) continue;
      this.v.copy(u.object3D.position);
      this.v.y += 0.12;
      h.holds.setMatrixAt(n++, this.m4.compose(this.v, this.q.identity(), this.s.setScalar(1)));
    }
    h.holds.count = n;
    h.holds.instanceMatrix.needsUpdate = true;
  },

  /** The cells shown: a gun's reach (pointed at in the menu, or its own), or a Spell's. */
  preview() {
    const w = G.world, td = w.td, p = G.tdPreview;
    let ground = null, air = null, sig = '';
    if (p?.tower !== undefined) {
      const b = w.entities.get(p.tower);
      if (b) {
        const rank = td.ranks.get(b.id) ?? 1;
        sig = `t${b.id}:${b.facing}:${rank}`;
        if (sig !== this.previewSig) ({ ground, air } = NS.tdReach(w, b.type, b.x, b.y, b.facing, rank));
      }
    } else if (p?.type) {
      const s = td.spots[p.spot];
      const f = NS.tdFacing(w, p.type, s.x, s.y);
      sig = `s${p.spot}:${p.type}:${f}`;
      if (sig !== this.previewSig) ({ ground, air } = NS.tdReach(w, p.type, s.x, s.y, f, 1));
    }
    if (sig === this.previewSig) return;
    this.previewSig = sig;
    const cells = this.cells, c = new THREE.Color();
    let n = 0;
    const put = (set, hex) => {
      c.set(hex);
      for (const i of set ?? []) {
        if (n >= CELLS) break;
        const x = i % 256, y = Math.floor(i / 256);
        cells.setMatrixAt(n, this.m4.compose(this.at(x + 0.5, y + 0.5, 0.16), this.q.identity(), this.s.set(1, 1, 1)));
        cells.setColorAt(n++, c);
      }
    };
    put(ground, '#ffb43a');
    // what reaches the air, where it is not the ground's too
    if (air) put([...air].filter((i) => !ground?.has(i)), '#7fc8ff');
    cells.count = n;
    cells.instanceMatrix.needsUpdate = true;
    if (cells.instanceColor) cells.instanceColor.needsUpdate = true;
  },

  tick(t) {
    const w = G.world, td = w?.td;
    if (!td || !this.cells) return;
    const me = w.players.get(ME), cheapest = Math.min(...td.towers.map((k) => NS.TD_TOWERS[k].cost));
    const hover = G.hover ? spotAt(G.hover.x, G.hover.y) : -1, pulse = 0.55 + 0.3 * Math.sin(t / 260);

    // the empty platforms' frames
    for (const m of this.frames) {
      const s = td.spots[m.userData.spot], built = s.tower !== null && w.entities.has(s.tower);
      m.visible = !built && !td.over;
      m.material.opacity = m.userData.spot === hover ? 1 : me.storm >= cheapest ? pulse : 0.35;
    }
    for (const l of this.links) l.visible = td.spots[l.userData.spot].tower === null;

    // an Arc gate's band between its two spires, while both stand: it flashes with each pulse
    td.spots.forEach((s, k) => {
      if (!s.pair) return;
      const a = s.tower === null ? null : w.entities.get(s.tower), b = a ? w.entities.get(td.posts.get(a.id)) : null;
      let band = this.bands.get(k);
      if (!a || !b || a.rising > 0 || b.rising > 0) { if (band) band.visible = false; return; }
      if (!band) {
        const from = this.at(s.x + 1.5, s.y + 1.5, 1.3), to = this.at(s.pair[0] + 1.5, s.pair[1] + 1.5, 1.3);
        const len = from.distanceTo(to);
        const tex = crackleTexture().clone();
        tex.needsUpdate = true;
        tex.repeat.set(len / 4, 1);
        band = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.6), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
        band.position.copy(from).add(to).multiplyScalar(0.5);
        band.rotation.y = -Math.atan2(to.z - from.z, to.x - from.x);
        band.renderOrder = 5;
        this.bands.set(k, band);
        this.group.add(band);
      }
      band.visible = true;
      band.material.map.offset.x = (t / 900) % 1;
      // a pulse a second: bright, fading until the next
      const into = (t % 1000) / 1000, paused = a.paralyzed > 0 || b.paralyzed > 0;
      band.material.opacity = paused ? 0.15 : 0.35 + 0.65 * (1 - into) ** 2;
    });

    // the storm gates swirl
    for (const g of this.gates) g.userData.face.rotation.z = -t / 600;

    this.preview();

    // a Spell being aimed, or the Priest's Storm Hammer: its reach about the cell under the cursor
    if (G.tdCast && G.hover) {
      const hammer = G.tdCast === 'hammer', p = hammer ? NS.tdPriest(w) : null;
      const r = hammer ? NS.TD_HERO.hammer.reach[td.hero.skills.hammer] : NS.TD_SPELLS[G.tdCast]?.reach ?? 2;
      const far = p && Math.hypot(G.hover.x - p.x, G.hover.y - p.y) > NS.TD_HERO.hammer.range;
      this.ring.visible = true;
      this.ring.position.copy(this.at(G.hover.x + 0.5, G.hover.y + 0.5, 0.25));
      this.ring.scale.setScalar(r + 0.5);
      this.ring.material.color.set(far ? '#ff6b5b' : hammer ? '#fff3c4' : G.tdCast === 'bombparalyze' ? '#9fd8ff' : '#ffd04a');
    } else {
      this.ring.visible = false;
    }

    // ranks over the guns
    const units = this.el.sceneEl.querySelector('[ns-units]')?.components['ns-units'];
    if (this.hero) this.heroTick(t, w, td, units);
    const alive = new Set();
    for (const [id, rank] of td.ranks) {
      if (rank < 2 || td.spent.get(id) === undefined) continue;
      const el = units?.byId.get(id), b = w.entities.get(id);
      if (!el || !b) continue;
      alive.add(id);
      let badge = this.badges.get(id);
      if (!badge || badge.userData.rank !== rank) {
        if (badge) this.group.remove(badge);
        badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: rankTexture(rank), transparent: true, depthWrite: false }));
        badge.scale.set(2.4, 0.8, 1);
        badge.userData.rank = rank;
        badge.renderOrder = 12;
        this.badges.set(id, badge);
        this.group.add(badge);
      }
      const rep = el.components['ns-unit']?.rep;
      badge.position.copy(this.at(b.x + b.fx / 2, b.y + b.fy / 2, (rep?.height ?? 2.5) + 1.4));
    }
    for (const [id, badge] of this.badges) {
      if (!alive.has(id)) { this.group.remove(badge); badge.material.dispose(); this.badges.delete(id); }
    }

    // frost under the chilled, pale rings about the guns held still
    let n = 0;
    for (const [id, enemy] of td.enemies) {
      if (enemy.chill <= 0 || n >= 256) continue;
      const el = units?.byId.get(id);
      if (!el) continue;
      this.v.copy(el.object3D.position);
      this.v.y += 0.1;
      this.chill.setMatrixAt(n++, this.m4.compose(this.v, this.q.identity(), this.s.set(1, 1, 1)));
    }
    this.chill.count = n;
    this.chill.instanceMatrix.needsUpdate = true;
    n = 0;
    for (const [id] of td.ranks) {
      const b = w.entities.get(id);
      if (!b || b.paralyzed <= 0 || n >= 64) continue;
      this.held.setMatrixAt(n++, this.m4.compose(this.at(b.x + b.fx / 2, b.y + b.fy / 2, 0.3), this.q.identity(), this.s.setScalar(0.9 + 0.1 * Math.sin(t / 150))));
    }
    this.held.count = n;
    this.held.instanceMatrix.needsUpdate = true;
  },
});

