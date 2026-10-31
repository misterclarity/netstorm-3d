/**
 * An orbiting camera for the battlefield: drag to orbit, right-drag or Shift-drag to pan, wheel or
 * pinch to zoom, W A S D / arrows to pan, Q E to turn. A press that hardly moves is a click: it is
 * emitted on the scene as `ns-tap`; pointer movement without a press as `ns-hover`.
 */
import { keysOff } from '../state.js';

const { THREE } = AFRAME;

AFRAME.registerComponent('orbit-rig', {
  schema: {
    target: { type: 'vec3', default: { x: -7, y: 0, z: 7 } },
    radius: { default: 82 },
    theta: { default: 0 }, // degrees about the vertical; 0 looks north
    phi: { default: 55 }, // degrees from straight down
    minRadius: { default: 9 },
    maxRadius: { default: 190 },
    bounds: { default: 110 },
  },

  init() {
    const d = this.data;
    this.home = { t: new THREE.Vector3().copy(d.target), r: d.radius, th: THREE.MathUtils.degToRad(d.theta), ph: THREE.MathUtils.degToRad(d.phi) };
    this.goal = { t: this.home.t.clone(), r: d.radius, th: this.home.th, ph: this.home.ph };
    this.cur = { t: this.home.t.clone(), r: d.radius * 1.35, th: this.home.th - 0.5, ph: this.home.ph + 0.08 };
    this.pointers = new Map();
    this.keys = new Set();
    this.autoRotate = false;
    /** Off while a headset moves the camera. */
    this.enabled = true;
    const scene = this.el.sceneEl;
    if (scene.canvas) this.bind(scene.canvas);
    else scene.addEventListener('render-target-loaded', () => this.bind(scene.canvas));
    window.addEventListener('keydown', (e) => { if (!keysOff(e)) this.keys.add(e.key.toLowerCase()); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  },

  reset() {
    this.goal = { t: this.home.t.clone(), r: this.home.r, th: this.home.th, ph: this.home.ph };
  },

  /** A new starting view, glided to. */
  setHome(target, radius) {
    this.home.t.copy(target);
    if (radius) this.home.r = radius;
    this.reset();
  },

  /** Glide to look at scene point (x, y, z), and optionally to a distance. */
  focus(x, z, radius, y = 0) {
    this.goal.t.set(x, y, z);
    if (radius) this.zoomTo(radius);
  },

  /** The view as it is now, to come back to with snap(). */
  view() {
    return { t: this.goal.t.clone(), r: this.goal.r, th: this.goal.th, ph: this.goal.ph };
  },

  zoomTo(radius) {
    this.goal.r = THREE.MathUtils.clamp(radius, this.data.minRadius, this.data.maxRadius);
  },

  /** Jump straight to a view, without the glide. */
  snap(view) {
    Object.assign(this.goal, view);
    if (view.t) this.goal.t = view.t.clone();
    Object.assign(this.cur, { r: this.goal.r, th: this.goal.th, ph: this.goal.ph });
    this.cur.t.copy(this.goal.t);
  },

  bind(canvas) {
    const scene = this.el.sceneEl;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, {
        x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), button: e.button,
        pan: e.button === 2 || e.button === 1 || e.shiftKey, moved: 0,
      });
      this.pinch = null;
      if (this.pointers.size > 1) for (const p of this.pointers.values()) p.moved = 99; // a pinch is no tap
    });
    const end = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      this.pinch = null;
      if (p && e.type === 'pointerup' && p.moved < 7 && performance.now() - p.t < 700) {
        scene.emit('ns-tap', { x: e.clientX, y: e.clientY, button: p.button, touch: e.pointerType === 'touch', shift: e.shiftKey }, false);
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { if (!this.pointers.size) scene.emit('ns-hover', null, false); });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType !== 'touch') scene.emit('ns-hover', { x: e.clientX, y: e.clientY }, false);
        return;
      }
      p.moved = Math.max(p.moved, Math.hypot(e.clientX - p.sx, e.clientY - p.sy));
      if (this.pointers.size === 2) {
        p.x = e.clientX; p.y = e.clientY;
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (this.pinch) {
          this.zoom(this.pinch.dist / Math.max(dist, 1));
          this.pan(mid.x - this.pinch.mid.x, mid.y - this.pinch.mid.y);
        }
        this.pinch = { dist, mid };
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (p.moved < 7) return;
      if (p.pan || e.shiftKey) this.pan(dx, dy);
      else {
        this.goal.th -= dx * 0.006;
        this.goal.ph = THREE.MathUtils.clamp(this.goal.ph - dy * 0.005, 0.2, 1.42);
      }
      if (e.pointerType !== 'touch') scene.emit('ns-hover', { x: e.clientX, y: e.clientY }, false);
    });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  },

  zoom(f) {
    this.goal.r = THREE.MathUtils.clamp(this.goal.r * f, this.data.minRadius, this.data.maxRadius);
  },

  pan(dx, dy) {
    this.el.emit('orbit-pan', null, false);
    const s = this.goal.r * 0.0016, th = this.goal.th, b = this.data.bounds;
    this.goal.t.x = THREE.MathUtils.clamp(this.goal.t.x - (Math.cos(th) * dx + Math.sin(th) * dy) * s, -b, b);
    this.goal.t.z = THREE.MathUtils.clamp(this.goal.t.z - (-Math.sin(th) * dx + Math.cos(th) * dy) * s, -b, b);
  },

  tick(t, dt) {
    if (!this.enabled) return;
    dt = Math.min(dt, 100);
    const k = this.keys, sp = dt * 0.5;
    if (!document.activeElement || document.activeElement === document.body) {
      if (k.has('arrowleft') || k.has('a')) this.pan(sp, 0);
      if (k.has('arrowright') || k.has('d')) this.pan(-sp, 0);
      if (k.has('arrowup') || k.has('w')) this.pan(0, sp);
      if (k.has('arrowdown') || k.has('s')) this.pan(0, -sp);
      if (k.has('q')) this.goal.th += dt * 0.0016;
      if (k.has('e')) this.goal.th -= dt * 0.0016;
    }
    if (this.autoRotate) this.goal.th += dt * 0.00006;
    const a = 1 - Math.pow(0.0025, dt / 1000);
    const c = this.cur, g = this.goal;
    c.t.lerp(g.t, a);
    c.r += (g.r - c.r) * a;
    c.th += (g.th - c.th) * a;
    c.ph += (g.ph - c.ph) * a;
    const o = this.el.object3D;
    o.position.set(c.t.x + c.r * Math.sin(c.ph) * Math.sin(c.th), c.t.y + c.r * Math.cos(c.ph), c.t.z + c.r * Math.sin(c.ph) * Math.cos(c.th));
    o.lookAt(c.t);
    o.rotateY(Math.PI); // an entity's lookAt aims its +Z; the camera inside looks down -Z
  },
});
