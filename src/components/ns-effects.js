/**
 * Shells in flight (from the world's list of shots), their impacts, explosions of what is
 * destroyed and the debris of fallen bridges and islets.
 */
import { G, NS, ME, defs, FURY_COLOR, FACING_YAW, wx, wz } from '../state.js';
import { spellLook } from '../spells.js';
import { mat, part, box, ico } from '../models.js';

const { THREE } = AFRAME;
/** How far from the Disc Thrower's middle its disc leaves, at the hook of its arm (models.js). */
const DISC_REACH = Math.hypot(0.42, 1.62);
/** How far ahead of the Thunder Cannon's middle its dragon's jaws are (models.js: head and mouth). */
const DRAGON_MOUTH = 2.5;
/** Flyers that strike (rules/flyers.ts), the colour of their strike and the height it comes from. */
const STING = { rainflyer: { color: '#8ff6ff', from: 2.6 }, sunflyer: { color: '#ffe08a', from: 3.9 } };
const ZAP_STEPS = 4;
/** The height a flyer's model hangs at (models.js, its body at 4.2) where shots at it hit. */
const FLYER_Y = 3.8;
const ZAP_GEO = new THREE.CylinderGeometry(0.08, 0.08, 1, 4);
const UP = new THREE.Vector3(0, 1, 0);
/** A Spell's orb, the ring of its reach (1 across, scaled to it), its fireball and a falling rock. */
const ORB_GEO = new THREE.OctahedronGeometry(0.36, 0);
const RING_GEO = new THREE.RingGeometry(0.9, 1, 48);
const BALL_GEO = new THREE.SphereGeometry(1, 20, 14);
const ROCK_GEO = new THREE.DodecahedronGeometry(0.35, 0);

AFRAME.registerComponent('ns-effects', {
  init() {
    this.root = new THREE.Group();
    this.el.setObject3D('effects', this.root);
    this.fx = [];
    this.shells = [];
    this.discs = [];
    this.stings = new Map(); // flyer → its strike cooldown at the last step
    this.held = new Map(); // caster → the orb of its Spell and the ring of its reach
    this.inFlight = new Map();
    this.el.sceneEl.addEventListener('ns-new-game', () => {
      for (const f of this.fx) this.end(f);
      this.fx = [];
      this.inFlight.clear();
      this.stings.clear();
      for (const held of this.held.values()) for (const m of [held.orb, held.ring]) { this.root.remove(m); m.material.dispose(); }
      this.held.clear();
    });
  },

  tick(t, dt) {
    if (!G.view) return;
    this.shots(G.paused ? 0 : G.clock.alpha);
    this.strikes();
    this.casters(t / 1000);
    const s = Math.min(dt, 250) / 1000;
    this.fx = this.fx.filter((f) => {
      f.age += s;
      const k = Math.min(1, f.age / f.life);
      f.update(f, k, s);
      if (k < 1) return true;
      this.end(f);
      return false;
    });
  },

  /** An effect over: off the scene, and its own material (a puff's fade) freed. */
  end(f) {
    this.root.remove(f.obj);
    if (f.own) f.obj.material.dispose();
  },

  /** Each shot arcs from its gun to where it lands; a puff where it came down. */
  shots(alpha) {
    const now = G.world.tick + alpha, live = new Set();
    let n = 0, nd = 0;
    for (const shot of G.view.shots) {
      const key = `${shot.gun.id}:${shot.leave}:${shot.target}`, gun = shot.gun;
      live.add(key);
      const from = new THREE.Vector3(wx(gun.x + gun.fx / 2), 1.4, wz(gun.y + gun.fy / 2));
      // a shot at a flyer goes up to it, at the height its model flies (models.js)
      const aloft = G.view.entities.get(shot.target)?.kind === 'flyer' && !shot.blocked;
      const to = new THREE.Vector3(wx(shot.x + 0.5), aloft ? FLYER_Y : 0.6, wz(shot.y + 0.5));
      this.inFlight.set(key, to);
      if (now < shot.leave) continue;
      const k = THREE.MathUtils.clamp((now - shot.leave) / Math.max(1, shot.land - shot.leave), 0, 1);
      // the Disc Thrower's disc leaves the hook of its arm (models.js), whirling, low and flat
      if (gun.type === 'sunarcher') {
        const dir = to.clone().sub(from).setY(0).normalize();
        from.addScaledVector(dir, DISC_REACH).setY(1.95);
        const d = this.disc(nd++);
        d.position.lerpVectors(from, to, k);
        d.position.y += Math.sin(k * Math.PI) * from.distanceTo(to) * 0.08;
        d.rotation.set(0.25, now * 1.2, 0);
        continue;
      }
      // the Thunder Cannon's dragon spits a ball of fire from its jaws (models.js), trailing flame
      const dragon = gun.type === 'thundercannon';
      if (dragon) {
        const yaw = FACING_YAW[gun.facing ?? 2];
        from.add(new THREE.Vector3(Math.sin(yaw) * DRAGON_MOUTH, 0, Math.cos(yaw) * DRAGON_MOUTH)).setY(2.8);
      }
      let m = this.shells[n];
      if (!m) {
        m = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffd27a' }));
        m.add(new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.35, depthWrite: false })));
        this.root.add(m);
        this.shells[n] = m;
      }
      const theme = defs.get(gun.type)?.theme ?? 'sun';
      m.material.color.set(dragon ? '#ffd27a' : theme === 'sun' ? '#ffd27a' : FURY_COLOR[theme]);
      m.children[0].material.color.set(dragon ? '#ff4a1a' : '#ffb347');
      m.scale.setScalar(dragon ? 1.15 : 1);
      m.visible = true;
      m.position.lerpVectors(from, to, k);
      m.position.y += Math.sin(k * Math.PI) * from.distanceTo(to) * (dragon ? 0.06 : 0.18);
      if (dragon && !G.paused && Math.random() < 0.5) this.puff(m.position, Math.random() < 0.5 ? '#ff7a1a' : '#ffcf5a', 0.7, 0.3);
      n++;
    }
    for (let i = n; i < this.shells.length; i++) this.shells[i].visible = false;
    for (let i = nd; i < this.discs.length; i++) this.discs[i].visible = false;
    for (const [key, to] of this.inFlight) {
      if (live.has(key)) continue;
      this.inFlight.delete(key);
      this.puff(to, '#ffb347', 0.5, 0.35);
    }
  },

  /**
   * A flyer's strike, which the world deals without a shot or an event (rules/flyers.ts): seen as
   * its strike cooldown starts over, once a step. A Man o'War stings with a crackling discharge
   * down its tentacles, a Whirligig with a flash of its gun, each onto what it strikes.
   */
  strikes() {
    if (G.world.tick === this.struck) return;
    this.struck = G.world.tick;
    for (const e of G.view.entities.values()) {
      if (e.kind !== 'flyer' || !STING[e.type]) continue;
      const was = this.stings.get(e.id);
      this.stings.set(e.id, e.cooldown);
      const target = e.target === null ? undefined : G.view.entities.get(e.target);
      if (was === undefined || e.cooldown <= was || !target) continue;
      const { color, from: high } = STING[e.type];
      const big = target.kind === 'building';
      const from = new THREE.Vector3(wx(e.px / NS.FLYER_SCALE), high, wz(e.py / NS.FLYER_SCALE));
      const to = new THREE.Vector3(wx(target.x + (big ? target.fx / 2 : 0.5)), big ? 1.2 : 0.8, wz(target.y + (big ? target.fy / 2 : 0.5)));
      this.zap(from, to, color);
      this.zap(from, to, '#ffffff');
      this.puff(to, color, 1.1, 0.4);
    }
    for (const id of this.stings.keys()) if (!G.view.entities.has(id)) this.stings.delete(id);
  },

  /**
   * Whoever holds a Spell, a Priest or a carrier, has its orb glowing over its head; while one
   * casts, a ring on the ground pulses round it as far as the Spell will reach, and the player's
   * own caster, selected, shows that ring faintly, to aim by.
   */
  casters(s) {
    const units = this.el.sceneEl.querySelector('[ns-units]')?.components['ns-units'];
    const live = new Set();
    for (const e of G.view.entities.values()) {
      if ((e.kind !== 'priest' && e.kind !== 'transport') || !e.spell || (e.kind === 'priest' && e.state !== 'normal')) continue;
      const el = units?.byId.get(e.id), rep = el?.components['ns-unit']?.rep;
      if (!el) continue;
      live.add(e.id);
      const { color } = spellLook(e.spell), at = el.object3D.position;
      let held = this.held.get(e.id);
      if (!held) {
        const orb = new THREE.Mesh(ORB_GEO, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
        const ring = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        this.root.add(orb, ring);
        held = { orb, ring };
        this.held.set(e.id, held);
      }
      held.orb.position.set(at.x, Math.min(rep?.height ?? 2, 3) + 0.5 + Math.sin(s * 3 + e.id) * 0.12, at.z);
      held.orb.scale.setScalar(1 + 0.15 * Math.sin(s * 5 + e.id));
      held.orb.rotation.y = s * 2;
      const reach = (defs.get(e.spell)?.range ?? 1) + 0.5, aiming = e.owner === ME && G.selected === e.id;
      held.ring.visible = e.casting > 0 || aiming;
      held.ring.position.set(at.x, 0.18, at.z);
      held.ring.scale.setScalar(reach);
      held.ring.material.opacity = e.casting > 0 ? 0.45 + 0.4 * Math.sin(s * 10) : 0.3;
    }
    for (const [id, held] of this.held) {
      if (live.has(id)) continue;
      for (const m of [held.orb, held.ring]) { this.root.remove(m); m.material.dispose(); }
      this.held.delete(id);
    }
  },

  /**
   * A Spell going off round its caster (rules/spells.ts casts it there): a fireball and a shock
   * wave for the blasts, bolts out of the sky for the Thunder Spells, rocks for the Bombardment,
   * a sphere that falls in on itself for the Graviton, a swirl for the Summons, and for the rest a
   * ring of the Spell's colour spreading as far as it reaches.
   */
  cast(at, spell) {
    const reach = (defs.get(spell)?.range ?? 1) + 0.5, { look, color } = spellLook(spell);
    const ground = at.clone().setY(0.3), spot = () => {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (reach - 0.5);
      return ground.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    };
    this.wave(ground, reach, color);
    if (look === 'blast') {
      this.fireball(ground, reach, color);
      for (let i = 0; i < 6; i++) this.puff(spot().setY(0.6), '#5a5048', 1.4, 1.6);
    } else if (look === 'lightning') {
      for (let i = 0; i < 8; i++) {
        const to = spot();
        this.zap(to.clone().setY(14).add(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5)), to, color);
        this.puff(to, color, 0.8, 0.4);
      }
    } else if (look === 'rocks') {
      for (let i = 0; i < 12; i++) this.rock(spot(), i * 0.06);
    } else if (look === 'implode') {
      this.fireball(ground.clone().setY(2), reach, color, true);
    } else if (look === 'summon') {
      for (let i = 0; i < 5; i++) this.puff(spot().setY(1.5 + i * 0.5), color, 1.2, 1.0);
    } else {
      for (let i = 0; i < 5; i++) this.puff(spot().setY(0.8), color, 0.9, 0.9);
    }
  },

  /** A flat ring that spreads over the ground to `reach` and fades. */
  wave(at, reach, color) {
    const m = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(at);
    this.root.add(m);
    this.fx.push({ obj: m, own: true, age: 0, life: 0.9, update: (f, k) => { m.scale.setScalar(0.3 + reach * Math.min(1, k * 1.6)); m.material.opacity = 1 - k; } });
  },

  /** A ball of fire that swells to `reach` and fades, or, falling in, shrinks from it. */
  fireball(at, reach, color, inward = false) {
    const m = new THREE.Mesh(BALL_GEO, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
    m.position.copy(at);
    this.root.add(m);
    this.fx.push({ obj: m, own: true, age: 0, life: inward ? 0.8 : 1.1, update: (f, k) => {
      const grow = inward ? 1 - k : Math.min(1, k * 2.5);
      m.scale.setScalar(Math.max(0.05, reach * grow));
      m.material.opacity = inward ? 0.7 * (1 - k * 0.5) : 0.85 * (1 - k);
    } });
  },

  /** A rock falling out of the sky onto a spot, with a puff where it lands. */
  rock(to, delay) {
    const m = new THREE.Mesh(ROCK_GEO, new THREE.MeshBasicMaterial({ color: '#4a3a2c' }));
    m.position.copy(to).setY(16);
    m.visible = false;
    this.root.add(m);
    let landed = false;
    this.fx.push({ obj: m, own: true, age: 0, life: 0.7 + delay, update: (f, k) => {
      const t = Math.max(0, f.age - delay) / 0.7;
      m.visible = f.age >= delay && t < 1;
      m.position.y = 16 - 15.7 * Math.min(1, t) ** 2;
      if (t >= 1 && !landed) { landed = true; this.puff(to.clone().setY(0.5), '#6b5a48', 0.9, 0.6); }
    } });
  },

  /** A crackling bolt from one point to another: a few jagged strokes that fade within a moment. */
  zap(from, to, color) {
    const bolt = new THREE.Group(), material = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    const points = [from];
    for (let i = 1; i < ZAP_STEPS; i++) {
      const k = i / ZAP_STEPS;
      points.push(from.clone().lerp(to, k).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.5)));
    }
    points.push(to);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], len = a.distanceTo(b);
      const stroke = new THREE.Mesh(ZAP_GEO, material);
      stroke.position.copy(a).lerp(b, 0.5);
      stroke.scale.set(1, len, 1);
      stroke.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
      bolt.add(stroke);
    }
    this.root.add(bolt);
    this.fx.push({ obj: bolt, own: false, age: 0, life: 0.45, update: (f, k) => { material.opacity = 1 - k; if (k >= 1) material.dispose(); } });
  },

  /** The i-th disc in flight: a golden sun disc with eight points, made once and kept. */
  disc(i) {
    let d = this.discs[i];
    if (!d) {
      d = new THREE.Group();
      const gold = new THREE.MeshBasicMaterial({ color: '#ffd84a' });
      d.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.07, 16), gold));
      for (let j = 0; j < 8; j++) {
        const a = (j / 8) * Math.PI * 2, ray = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 4), gold);
        ray.position.set(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4);
        ray.rotation.set(0, -a, -Math.PI / 2);
        d.add(ray);
      }
      d.add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 6), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.28, depthWrite: false })));
      this.root.add(d);
      this.discs[i] = d;
    }
    d.visible = true;
    return d;
  },

  puff(at, color, size, life) {
    const m = new THREE.Mesh(ico(1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
    m.position.copy(at);
    m.scale.setScalar(size * 0.3);
    this.root.add(m);
    this.fx.push({ obj: m, own: true, age: 0, life, update: (f, k) => { f.obj.scale.setScalar(size * (0.3 + k)); f.obj.material.opacity = 1 - k; } });
  },

  explode(rep, position) {
    const at = position.clone().setY(0.8);
    const big = rep?.kind === 'building' ? 1 + (rep.foot?.[0] ?? 3) / 3 : 0.6;
    this.puff(at, '#ffb347', big * 1.6, 0.6);
    this.puff(at.clone().add(new THREE.Vector3(0, 0.6, 0)), '#666', big * 2.2, 1.4);
    for (let i = 0; i < 10 * big; i++) {
      const d = new THREE.Mesh(box(0.25, 0.25, 0.25), mat(i % 2 ? '#5a4a3a' : '#8a7a66'));
      d.position.copy(at);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 6, 3 + Math.random() * 5, (Math.random() - 0.5) * 6).multiplyScalar(0.8 + big * 0.2);
      this.root.add(d);
      this.fx.push({
        obj: d, age: 0, life: 1.6,
        update: (f, k, dt) => { vel.y -= 14 * dt; f.obj.position.addScaledVector(vel, dt); f.obj.rotation.x += dt * 6; f.obj.rotation.z += dt * 4; },
      });
    }
  },

  /** A bridge cell or an islet dropping out of the sky. */
  fall(x, y, w, h, bridge) {
    const g = new THREE.Group();
    part(g, box(w * 0.95, bridge ? 0.16 : 1.4, h * 0.95), mat(bridge ? '#8a5a34' : '#6b5a44'), 0, bridge ? 0 : -0.7, 0);
    g.position.set(wx(x + w / 2), 0, wz(y + h / 2));
    this.root.add(g);
    let vy = 0;
    const spin = (Math.random() - 0.5) * 2;
    this.fx.push({ obj: g, age: 0, life: 3, update: (f, k, dt) => { vy -= 12 * dt; g.position.y += vy * dt; g.rotation.z += spin * dt; } });
  },
});
