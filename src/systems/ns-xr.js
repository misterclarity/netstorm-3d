/**
 * The tabletop modes: the battlefield shrunk onto a table, about a centimetre a cell.
 *
 * - VR: the table is a round war table in front of you, on an islet of your own above the clouds.
 * - AR: you point at a real table (or the floor) and the islands float over it.
 * - On the screen ("Tabletop" in the top bar, or T) the orbiting camera looks at the same table, a
 *   preview of what a headset shows.
 *
 * The battlefield's root (#world) is scaled, turned and moved inside the table (#table); everything
 * on it keeps working in cells (space.js turns rays and points between the two). Hand controllers
 * point at the map with a ray and the trigger acts as the mouse's click; a phone's tap does the
 * same. A panel at the table's edge, always on the player's side, shows the HUD and its buttons.
 */
import { G, THREE } from '../state.js';
import { groundCell, groundPoint, toLocal, toScene } from '../space.js';
import { Panel } from '../xr-panel.js';

const BOARD = { preview: 1.15, vr: 1.15, ar: 0.8 }; // metres across the map's ground, before zooming
const AHEAD = 1.15; // metres from the player to the table's middle
const TOP = 0.62; // radius of the VR war table's top, metres
const PREVIEW_AT = new THREE.Vector3(0, 0.8, -AHEAD);
const Y = new THREE.Vector3(0, 1, 0);
const $ = (id) => document.getElementById(id);
const v1 = new THREE.Vector3(), q1 = new THREE.Quaternion();

/** Rings of flagstones, for the top of your islet. */
function flagstones() {
  const n = 1024, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d'), mid = n / 2;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.fillStyle = '#5f594f';
  g.fillRect(0, 0, n, n);
  const ring = 46;
  for (let r0 = 0; r0 < mid; r0 += ring) {
    const r1 = r0 + ring, count = r0 ? Math.max(6, Math.round((2 * Math.PI * (r0 + ring / 2)) / 70)) : 1, turn = rnd();
    for (let i = 0; i < count; i++) {
      const a0 = ((i + turn) / count) * Math.PI * 2, a1 = ((i + 1 + turn) / count) * Math.PI * 2, tone = 128 + rnd() * 40;
      g.fillStyle = `rgb(${tone + 22}, ${tone + 14}, ${tone - 2})`;
      g.beginPath();
      if (r0) {
        g.arc(mid, mid, r1 - 3, a0 + 0.012, a1 - 0.012);
        g.arc(mid, mid, r0 + 3, a1 - 0.012, a0 + 0.012, true);
      } else g.arc(mid, mid, r1 - 3, 0, Math.PI * 2);
      g.closePath();
      g.fill();
    }
  }
  // a brass compass rose in the middle
  g.strokeStyle = '#c9a14a';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(mid, mid, ring * 2 - 8, 0, Math.PI * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** The VR scenery: your islet over the clouds, and the war table the battle stands on. */
function makeScenery() {
  const stone = new THREE.MeshStandardMaterial({ color: '#8b8278', roughness: 0.92, flatShading: true });
  const wood = new THREE.MeshStandardMaterial({ color: '#4b3524', roughness: 0.7 });
  const inlay = new THREE.MeshStandardMaterial({ color: '#a3896a', roughness: 0.85 });
  const brass = new THREE.MeshStandardMaterial({ color: '#c9a14a', roughness: 0.35, metalness: 0.7 });
  const paving = new THREE.MeshStandardMaterial({ map: flagstones(), roughness: 0.95 });
  const rock = new THREE.MeshStandardMaterial({ color: '#6e5640', roughness: 1, flatShading: true });

  // the table: a wooden top with a brass rim on a stone column, its top at the table's y = 0
  const stand = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(TOP, TOP * 0.97, 0.05, 72), wood);
  top.position.y = -0.025;
  top.receiveShadow = true;
  const face = new THREE.Mesh(new THREE.CircleGeometry(TOP * 0.93, 72), inlay);
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.001;
  face.receiveShadow = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(TOP, 0.013, 8, 96), brass);
  rim.rotation.x = Math.PI / 2;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.15, 1, 20), stone);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.33, 0.07, 24), stone);
  stand.add(top, face, rim, column, foot);
  stand.userData.height = (h) => {
    const c = Math.max(0.05, h - 0.05);
    column.scale.y = c;
    column.position.y = -0.05 - c / 2;
    foot.position.y = -h + 0.035;
  };

  // your islet: a paved top over a crag of rock, the clouds far below
  const floor = new THREE.Group();
  const lawn = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.45, 0.3, 64), [rock, paving, rock]);
  lawn.position.y = -0.15;
  lawn.receiveShadow = true;
  const crag = new THREE.ConeGeometry(2.45, 3.4, 28, 5);
  const p = crag.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), k = Math.sin(i * 12.9898) * 43758.5453;
    const n = (k - Math.floor(k) - 0.5) * (y < 1.6 ? 0.45 : 0);
    p.setXYZ(i, p.getX(i) * (1 + n), y, p.getZ(i) * (1 + n));
  }
  crag.computeVertexNormals();
  const under = new THREE.Mesh(crag, rock);
  under.rotation.x = Math.PI;
  under.position.y = -0.3 - 1.7;
  floor.add(lawn, under);

  // in AR: only the islands' shadow, on the real table
  const catcher = new THREE.Mesh(new THREE.CircleGeometry(0.6, 48), new THREE.ShadowMaterial({ opacity: 0.32 }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = 0.002;
  catcher.receiveShadow = true;
  return { stand, floor, catcher };
}

/** A pointing ray drawn from a hand controller: a thin beam and a ring where it lands. */
function makeBeam() {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.0016, 0.0016, 1, 6, 1, true);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, -0.5);
  const beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffe7a8', transparent: true, opacity: 0.7, fog: false, toneMapped: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.005, 0.009, 24),
    new THREE.MeshBasicMaterial({ color: '#ffe7a8', side: THREE.DoubleSide, fog: false, toneMapped: false, depthTest: false }));
  ring.renderOrder = 20;
  group.add(beam, ring);
  group.userData = { beam, ring, buttons: [] };
  return group;
}

AFRAME.registerSystem('ns-xr', {
  init() {
    /** null: the screen · 'preview': a table on the screen · 'vr' · 'ar' */
    this.mode = null;
    this.zoom = 1;
    this.yaw = 0;
    this.pan = new THREE.Vector2(); // the map point (in cells) over the table's middle
    this.lift = 12; // cells from the ground down to the lowest rock under it
    this.placing = false;
    this.handheld = false;
    this.session = null;
    this.beams = new Map();
    this.active = null;
    this.panelYaw = 0;
    this.measured = null;
    this.onSelect = this.onSelect.bind(this);
    this.onSelectStart = this.onSelectStart.bind(this);
    this.onSqueeze = this.onSqueeze.bind(this);
    this.el.addEventListener('loaded', () => this.setup());
  },

  game() { return this.el.systems['ns-game']; },
  rig() { return $('camera')?.components['orbit-rig']; },

  setup() {
    this.table = $('table').object3D;
    this.world = $('world').object3D;
    this.sunEl = $('sun');
    this.scenery = makeScenery();
    this.el.object3D.add(this.scenery.floor);
    this.table.add(this.scenery.stand, this.scenery.catcher);
    this.panel = new Panel(this.game(), this);
    this.holder = new THREE.Group();
    this.holder.add(this.panel.mesh);
    this.table.add(this.holder);
    const rig = this.rig();
    if (rig) this.rigLimits = { minRadius: rig.data.minRadius, maxRadius: rig.data.maxRadius, bounds: rig.data.bounds };
    this.layout();

    $('xrTable').onclick = () => this.toggle();
    $('xrVR').onclick = () => this.enterXR('vr');
    $('xrAR').onclick = () => this.enterXR('ar');
    navigator.xr?.isSessionSupported?.('immersive-vr').then((ok) => { $('xrVR').hidden = !ok; }, () => {});
    navigator.xr?.isSessionSupported?.('immersive-ar').then((ok) => { $('xrAR').hidden = !ok; }, () => {});
    this.el.addEventListener('enter-vr', () => this.onEnter());
    this.el.addEventListener('exit-vr', () => this.onExit());
    this.el.addEventListener('ar-hit-test-select', (e) => this.placed(e.detail));
    this.el.addEventListener('ns-new-game', () => { this.measured = null; this.resetView(); });
    if (new URLSearchParams(location.search).has('tabletop')) this.setMode('preview');
  },

  /* ------------------------------------- the modes --------------------------------------- */
  /** The tabletop preview on the screen, on or off. */
  toggle() {
    if (this.mode === 'vr' || this.mode === 'ar') return;
    this.setMode(this.mode ? null : 'preview');
  },

  async enterXR(kind) {
    try {
      if (kind === 'ar') await this.el.enterAR();
      else await this.el.enterVR();
    } catch (err) {
      this.game().hud.toast(`Could not start ${kind.toUpperCase()}: ${err?.cause?.message ?? err?.message ?? err}`, 'bad');
    }
  },

  /** Leave the headset, or the preview. */
  exit() {
    if (this.session) this.el.exitVR();
    else this.setMode(null);
  },

  onEnter() {
    const session = this.el.xrSession;
    if (!session || this.session === session) return; // fullscreen without a headset is no tabletop
    this.session = session;
    this.before = this.mode;
    this.handheld = false;
    session.addEventListener('select', this.onSelect);
    session.addEventListener('selectstart', this.onSelectStart);
    session.addEventListener('squeeze', this.onSqueeze);
    this.setMode(this.el.is('ar-mode') ? 'ar' : 'vr');
    // the headset's poses are relative to the camera's entity: it stays at the scene's origin
    // (look-controls does this too, but only where A-Frame sees a headset, not on a phone)
    const cam = $('camera').object3D;
    cam.position.set(0, 0, 0);
    cam.rotation.set(0, 0, 0);
    cam.updateMatrix();
    cam.updateMatrixWorld(true);
    this.needCenter = true;
  },

  onExit() {
    const session = this.session;
    if (!session) return;
    session.removeEventListener('select', this.onSelect);
    session.removeEventListener('selectstart', this.onSelectStart);
    session.removeEventListener('squeeze', this.onSqueeze);
    this.session = null;
    $('camera').object3D.matrixAutoUpdate = true;
    for (const beam of this.beams.values()) beam.removeFromParent();
    this.beams.clear();
    this.active = null;
    this.setMode(this.before === 'preview' ? 'preview' : null);
  },

  setMode(mode) {
    const was = this.mode, rig = this.rig();
    if (was === mode || !this.table) return;
    if (!was && rig) this.screenView = rig.view();
    this.mode = mode;
    document.body.classList.toggle('tabletop', !!mode);
    $('xrTable').classList.toggle('on', !!mode);
    $('camera').setAttribute('camera', 'near', mode ? 0.02 : 0.3);
    if (rig) {
      rig.enabled = mode !== 'vr' && mode !== 'ar';
      Object.assign(rig.data, mode ? { minRadius: 0.12, maxRadius: 4, bounds: 4 } : this.rigLimits);
    }
    if (mode) {
      this.table.position.copy(PREVIEW_AT);
      this.table.rotation.set(0, 0, 0);
      this.panelYaw = 0;
    }
    if (mode === 'ar') this.startPlacing();
    else this.stopPlacing();
    this.sunMap(mode === 'vr' || mode === 'ar' ? 2048 : null);
    this.measured = null;
    this.measure();
    this.layout();
    if (mode === 'preview' && rig) {
      const c = toScene(new THREE.Vector3());
      rig.setHome(c, 1.3);
      rig.snap({ t: c, r: 1.3, th: 0, ph: 0.9 });
    } else if (!mode && rig) {
      this.game().frameView();
      if (this.screenView) rig.snap(this.screenView);
    }
    G.hover = null;
    G.follow = null;
    if (this.game().hud) this.game().hud.dirty = true;
    this.el.emit('ns-tabletop', { mode }, false);
  },

  /** Metres per cell on the table. */
  scale() {
    return (BOARD[this.mode] ?? 1) / Math.max(40, G.span ?? 100) * this.zoom;
  },

  /** How far the table reaches: the war table's top in VR, the map's ground in AR. */
  reach() {
    return this.mode === 'ar' ? BOARD.ar / 2 + 0.02 : TOP;
  },

  /** Put the battlefield, the scenery and the sun's shadow where the mode wants them. */
  layout() {
    const m = this.mode, T = this.table, W = this.world;
    if (!T) return;
    if (!m) {
      T.position.set(0, 0, 0);
      T.rotation.set(0, 0, 0);
      W.position.set(0, 0, 0);
      W.rotation.set(0, 0, 0);
      W.scale.setScalar(1);
    } else {
      const s = this.scale();
      W.scale.setScalar(s);
      W.rotation.set(0, this.yaw, 0);
      // the map point `pan` over the table's middle; the lowest rock just clear of the table top
      v1.set(-this.pan.x, 0, -this.pan.y).applyAxisAngle(Y, this.yaw).multiplyScalar(s);
      W.position.set(v1.x, (this.lift + 1) * s, v1.z);
    }
    const sceneryOn = m === 'vr' || m === 'preview';
    this.scenery.floor.visible = sceneryOn;
    this.scenery.stand.visible = sceneryOn;
    this.scenery.stand.userData.height(Math.max(0.3, T.position.y));
    this.scenery.catcher.visible = m === 'ar';
    this.holder.visible = !!m;
    this.el.querySelector('a-sky').object3D.visible = m !== 'ar';
    $('clouds').object3D.visible = m !== 'ar';
    const scene = this.el.object3D;
    if (m === 'ar' && scene.fog) { this.fog = scene.fog; scene.fog = null; }
    if (m !== 'ar' && this.fog) { scene.fog = this.fog; this.fog = null; }
    this.shadows(m ? this.scale() : 1);
  },

  /** The sun's shadow box, made to fit the battlefield at scale `s` (metres per cell). */
  shadows(s) {
    const light = this.sunEl.getObject3D('light');
    if (!light?.shadow) return;
    const d = this.sunEl.getAttribute('light'), cam = light.shadow.camera;
    cam.left = d.shadowCameraLeft * s;
    cam.right = d.shadowCameraRight * s;
    cam.top = d.shadowCameraTop * s;
    cam.bottom = d.shadowCameraBottom * s;
    cam.near = d.shadowCameraNear * s;
    cam.far = d.shadowCameraFar * s;
    cam.updateProjectionMatrix();
    light.shadow.normalBias = (this.sunEl.getAttribute('ns-sun')?.normalBias ?? 0.04) * s;
  },

  /** A smaller shadow map for a headset, which draws every frame twice; null for the screen's. */
  sunMap(size) {
    const light = this.sunEl.getObject3D('light');
    if (!light?.shadow) return;
    this.mapSize ??= light.shadow.mapSize.x;
    const want = size ?? this.mapSize;
    if (light.shadow.mapSize.x === want) return;
    light.shadow.mapSize.set(want, want);
    light.shadow.map?.dispose();
    light.shadow.map = null;
  },

  /** How deep the islands' rock reaches under their ground, in cells. */
  measure() {
    const terrain = $('terrain')?.object3D;
    if (!terrain || !this.mode) return;
    this.world.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(terrain);
    if (box.isEmpty()) return;
    this.lift = Math.min(40, Math.max(3, -toLocal(v1.set(0, box.min.y, 0)).y));
  },

  /* ------------------------------ the table and the view on it ----------------------------- */
  /** The table in front of the player, at a height to stand at; `t` an XR pose, else the camera's. */
  recenter(t) {
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
    if (t) {
      pos.set(t.position.x, t.position.y, t.position.z);
      quat.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w);
    } else {
      this.el.camera.getWorldPosition(pos);
      this.el.camera.getWorldQuaternion(quat);
    }
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat).setY(0);
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const height = pos.y > 0.9 ? THREE.MathUtils.clamp(pos.y - 0.78, 0.45, 1.15) : pos.y - 0.78;
    this.table.position.set(pos.x + fwd.x * AHEAD, height, pos.z + fwd.z * AHEAD);
    this.table.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0);
    this.scenery.floor.position.set(pos.x, 0, pos.z);
    this.panelYaw = 0;
    this.layout();
  },

  /** AR: the next trigger pull or tap puts the table where the ray meets a real surface. */
  startPlacing() {
    if (this.mode !== 'ar') return;
    this.placing = true;
    this.el.setAttribute('ar-hit-test', 'enabled', true);
  },

  stopPlacing() {
    this.placing = false;
    if (this.el.getAttribute('ar-hit-test')?.enabled) this.el.setAttribute('ar-hit-test', 'enabled', false);
  },

  /** The surface found: the table goes there, turned to face the player. */
  placed(detail) {
    if (!this.placing || !detail?.position) return;
    const head = this.el.camera.getWorldPosition(new THREE.Vector3());
    this.table.position.copy(detail.position);
    this.table.rotation.set(0, Math.atan2(head.x - detail.position.x, head.z - detail.position.z), 0);
    this.panelYaw = 0;
    this.stopPlacing();
    this.layout();
    this.game().sound().play('rotatepiece');
  },

  turn(dir) {
    this.yaw += dir * Math.PI / 8;
    this.layout();
  },

  zoomBy(f) {
    this.zoom = THREE.MathUtils.clamp(this.zoom * f, 0.5, 4);
    this.clampPan();
    this.layout();
  },

  resetView() {
    this.zoom = 1;
    this.yaw = 0;
    this.pan.set(0, 0);
    this.layout();
  },

  clampPan() {
    const r = (G.span ?? 100) / 2;
    this.pan.set(THREE.MathUtils.clamp(this.pan.x, -r, r), THREE.MathUtils.clamp(this.pan.y, -r, r));
  },

  /** A line of what the hands do, for the panel's foot. */
  hint() {
    if (this.mode === 'preview') return 'The table as a headset shows it: click the map as on the screen, drag to look around, T or Exit to leave.';
    if (this.handheld) return 'Tap a unit to select it, then tap where it goes. With a piece or a building chosen, tap once to see it and again to place it.';
    return `Trigger: select, lay, build · Grip: cancel · A/X: rotate the piece · Right stick: turn and zoom the map · Left stick: move it · B/Y: ${this.mode === 'ar' ? 'move the table' : 'recenter'}`;
  },

  /* ---------------------------------------- input ---------------------------------------- */
  /** The scene ray of an input source in an XR frame, or null. */
  rayOf(source, frame, ref) {
    const pose = ref && frame?.getPose(source.targetRaySpace, ref);
    if (!pose) return null;
    const { position: p, orientation: o } = pose.transform;
    q1.set(o.x, o.y, o.z, o.w);
    return new THREE.Ray(new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(0, 0, -1).applyQuaternion(q1));
  },

  refSpace() {
    return this.el.renderer?.xr?.getReferenceSpace?.() ?? null;
  },

  onSelectStart(e) {
    // pressing on the panel while placing the table is not a place for it
    if (!this.placing) return;
    const ray = this.rayOf(e.inputSource, e.frame, this.refSpace());
    if (ray && this.panel.pick(ray)) this.el.setAttribute('ar-hit-test', 'enabled', false);
  },

  onSelect(e) {
    const mode = e.inputSource.targetRayMode, ray = this.rayOf(e.inputSource, e.frame, this.refSpace());
    if (mode === 'screen') this.handheld = true;
    if (!ray) return;
    if (mode === 'tracked-pointer') this.active = e.inputSource;
    if (this.placing) {
      this.panel.press(ray);
      if (this.placing) this.el.setAttribute('ar-hit-test', 'enabled', true);
      return;
    }
    this.press(ray, mode === 'screen' || mode === 'transient-pointer');
  },

  onSqueeze() {
    if (this.placing) this.stopPlacing();
    else this.game().cancel();
  },

  /**
   * A press along a scene ray: the panel's button, else the map cell, as a click there. A screen's
   * tap (`transient`) has no hover, so with a piece or building chosen the first tap shows where it
   * goes and a second on the same cell places it.
   */
  press(ray, transient = false) {
    if (this.panel.press(ray)) return true;
    const game = this.game();
    if (!G.started || game.hud.modalOpen()) return false;
    const cell = groundCell(ray);
    if (!cell) return false;
    if (transient && G.tool.kind !== 'select') {
      const same = G.hover && G.hover.x === cell.x && G.hover.y === cell.y;
      G.hover = cell;
      if (!same) return true;
    }
    game.primary(cell.x, cell.y, false, game.airAt(ray));
    return true;
  },

  panelHover(ray) { return !!this.mode && this.panel.hoverAt(ray); },
  panelPress(ray) { return !!this.mode && this.panel.press(ray); },

  /** Each hand's ray drawn, the active one's cell hovered, and the sticks and buttons read. */
  pollInputs(dt, frame, ref) {
    if (!frame || !ref || !this.session) return;
    const seen = new Set(), sources = [...this.session.inputSources];
    const pointers = sources.filter((x) => x.targetRayMode === 'tracked-pointer' || x.targetRayMode === 'gaze');
    if (!pointers.includes(this.active)) this.active = pointers.find((x) => x.handedness === 'right') ?? pointers[0] ?? null;
    let hover = null;
    for (const source of sources) {
      seen.add(source);
      const tracked = source.targetRayMode === 'tracked-pointer' || source.targetRayMode === 'gaze';
      let beam = this.beams.get(source);
      if (!beam) { beam = makeBeam(); this.beams.set(source, beam); this.el.object3D.add(beam); }
      const ray = tracked ? this.rayOf(source, frame, ref) : null;
      beam.visible = !!ray;
      if (ray) {
        const onPanel = this.panel.pick(ray);
        let far = onPanel?.distance ?? null;
        if (far === null) {
          const g = groundPoint(ray);
          if (g) far = toScene(g).distanceTo(ray.origin);
        }
        const len = Math.min(far ?? 1.2, 6);
        const { beam: b, ring } = beam.userData;
        beam.position.copy(ray.origin);
        beam.quaternion.setFromUnitVectors(v1.set(0, 0, -1), ray.direction);
        b.scale.set(1, 1, len);
        ring.visible = far !== null;
        ring.position.set(0, 0, -len);
        if (source === this.active) hover = ray;
      }
      this.sticks(source, beam.userData, dt);
    }
    for (const [source, beam] of this.beams) {
      if (!seen.has(source)) { beam.removeFromParent(); this.beams.delete(source); }
    }
    G.hoverPick = null;
    if (this.placing) { this.panel.hoverAt(hover); G.hover = null; return; }
    if (hover) {
      if (this.panel.hoverAt(hover)) G.hover = null;
      else { G.hover = groundCell(hover); G.hoverPick = this.game().airAt(hover); }
      G.mouse = null;
    } else if (pointers.length) {
      // a hand that points nowhere it can see
      this.panel.hoverAt(null);
      G.hover = null;
    }
  },

  /** A controller's thumbstick and buttons: turn, zoom and move the map; rotate; recenter. */
  sticks(source, state, dt) {
    const gp = source.gamepad;
    if (!gp) return;
    const k = Math.min(dt, 100) / 1000;
    const a = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] ?? 0, gp.axes[1] ?? 0];
    const [sx, sy] = a.map((x) => (Math.abs(x) < 0.2 ? 0 : x));
    if (sx || sy) {
      if (source.handedness === 'left') {
        // the map slides under the table's middle, as the stick points
        v1.set(sx, 0, sy).applyAxisAngle(Y, -this.yaw).multiplyScalar(k * 0.35 / this.scale());
        this.pan.x += v1.x;
        this.pan.y += v1.z;
        this.clampPan();
      } else {
        this.yaw -= sx * k * 1.6;
        this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(-sy * k * 1.3), 0.5, 4);
        this.clampPan();
      }
      this.layout();
    }
    const pressed = gp.buttons.map((b) => b.pressed);
    const edge = (i) => pressed[i] && !state.buttons[i];
    if (edge(4)) this.game().rotate();
    if (edge(5)) { if (this.mode === 'ar') this.startPlacing(); else this.recenter(); }
    if (edge(3)) this.resetView();
    state.buttons = pressed;
  },

  /** The panel eases round the table to the side the player is on, tilted to their eyes. */
  followHead(dt) {
    const cam = this.el.camera;
    if (!cam) return;
    this.table.updateWorldMatrix(true, false);
    const head = this.table.worldToLocal(cam.getWorldPosition(v1));
    const az = Math.atan2(head.x, head.z);
    let d = az - this.panelYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) > 0.35) this.panelYaw += d * Math.min(1, dt / 500);
    this.holder.rotation.y = this.panelYaw;
    const r = this.reach() + 0.1, y = 0.06;
    this.panel.mesh.position.set(0, y, r);
    const hz = Math.hypot(head.x, head.z) - r, hy = head.y - y;
    this.panel.mesh.rotation.x = THREE.MathUtils.clamp(Math.atan2(-hy, hz), -1.35, -0.15);
  },

  tick(t, dt) {
    if (!this.mode || !this.table) return;
    if (this.measured !== G.terrainRevision) {
      this.measured = G.terrainRevision;
      this.measure();
      this.layout();
    }
    if (this.session) {
      const frame = this.el.frame, ref = this.refSpace();
      if (this.needCenter && frame && ref) {
        const pose = frame.getViewerPose(ref);
        if (pose) { this.needCenter = false; this.recenter(pose.transform); }
      }
      this.pollInputs(dt, frame, ref);
    }
    this.followHead(dt);
    this.panel.update(dt);
  },
});

/**
 * A hand: the controller's own model wherever the headset knows it (as laser-controls sets them
 * up, without its ray: ns-xr draws its own), and the hand itself with hand tracking.
 */
AFRAME.registerComponent('ns-hand', {
  schema: { default: 'right' },
  init() {
    const c = { hand: this.data, model: true };
    for (const name of ['meta-touch-controls', 'pico-controls', 'valve-index-controls', 'vive-controls', 'vive-focus-controls',
      'windows-motion-controls', 'hp-mixed-reality-controls', 'magicleap-controls', 'oculus-go-controls']) {
      if (AFRAME.components[name]) this.el.setAttribute(name, c);
    }
    if (AFRAME.components['generic-tracked-controller-controls']) this.el.setAttribute('generic-tracked-controller-controls', { hand: this.data });
    if (AFRAME.components['hand-tracking-controls']) this.el.setAttribute('hand-tracking-controls', { hand: this.data });
  },
});
