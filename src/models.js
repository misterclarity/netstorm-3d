/**
 * Low-poly stand-ins for every kind of thing on the battlefield, built from three.js primitives.
 * Each builder fills a group whose origin is the middle of the thing's footprint on the ground;
 * `rep` collects what moves (rep.anim) and the parts the unit component needs to reach.
 */
import { THREE, defs, ART, OWNER_COLOR, FURY_COLOR, FACING_YAW, hash } from './state.js';

const matCache = new Map();
export function mat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...extra }));
  }
  return matCache.get(key);
}
export const glow = (c, e, i) => mat(c, { emissive: e, emissiveIntensity: i, roughness: 0.3 });
const gold = () => mat('#d4a23c', { metalness: 0.4, roughness: 0.4 });

export function part(group, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}
export const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
export const cyl = (a, b, h, n = 8) => new THREE.CylinderGeometry(a, b, h, n);
export const cone = (r, h, n = 6) => new THREE.ConeGeometry(r, h, n);
export const sph = (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
export const dome = (r) => new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
export const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);

function flag(rep, g, x, z, h) {
  part(g, cyl(0.05, 0.06, h, 6), mat('#e8e4da'), x, h / 2, z);
  const cloth = part(g, new THREE.PlaneGeometry(1.1, 0.65), mat(OWNER_COLOR[rep.owner] ?? '#ccc', { side: THREE.DoubleSide }), x + 0.55, h - 0.38, z);
  rep.anim.push((s) => { cloth.rotation.y = Math.sin(s * 2.2 + rep.id) * 0.25; });
}

export const MODELS = {
  temple(rep, g, e) {
    const theme = defs.get(e.type)?.theme ?? 'sun';
    if (theme === 'wind') return MODELS.windTemple(rep, g);
    const c = FURY_COLOR[theme], rain = theme === 'rain';
    const base = part(g, cyl(3.4, 3.7, 0.7, 12), mat('#aaa59b'), 0, 0.35, 0);
    base.scale.z = 0.72;
    const water = part(g, cyl(2.8, 2.8, 0.1, 28), glow(rain ? '#7dd6ec' : c, rain ? '#1d7690' : c, 0.45), 0, 0.72, 0);
    water.scale.z = 0.72;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, px = Math.cos(a) * 3.05, pz = Math.sin(a) * 2.2;
      part(g, cyl(0.2, 0.27, 1.7, 6), mat('#cbc6ba'), px, 1.5, pz);
      part(g, ico(0.27), glow('#a8ecff', rain ? '#38b6e0' : c, 0.9), px, 2.5, pz);
    }
    const spout = part(g, cone(0.35, 1.8), glow('#d8f6ff', '#5bc9ec', 0.6), 0, 1.6, 0);
    rep.anim.push((s) => { spout.rotation.y = s * 0.6; });
    flag(rep, g, -3.2, -1.6, 4.2);
  },
  windTemple(rep, g) {
    const base = part(g, cyl(3.3, 3.6, 0.8, 9), mat('#8d6a4a'), 0, 0.4, 0);
    base.scale.z = 0.75;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const p = part(g, box(1.7, 1.5, 0.28), mat(i % 2 ? '#b07a52' : '#c9a57c'), Math.cos(a) * 2.3, 1.3, Math.sin(a) * 1.7);
      p.rotation.set(0, -a + Math.PI / 2, 0);
      p.rotateX(-0.35);
    }
    for (const [x, z, h, r] of [[-1.2, -0.6, 7.5, 0.42], [-0.3, -1.0, 9, 0.48], [0.7, -0.7, 8, 0.44], [1.5, -0.2, 6.2, 0.36], [-1.9, 0.2, 5.4, 0.34]]) {
      const s = part(g, cone(r, h), mat('#d6b98e'), x, 0.8 + h / 2, z);
      s.rotation.z = -x * 0.03;
      s.rotation.x = z * 0.04;
    }
    for (const [x, z] of [[-3, 1.4], [3.1, 1.2], [2.6, -1.7], [-2.7, -1.6]]) part(g, ico(0.65), mat('#4f7d36'), x, 0.7, z);
    flag(rep, g, 2.9, 0.5, 4.2);
  },
  workshop(rep, g, e) {
    const d = defs.get(e.type), theme = d.theme ?? 'sun', c = FURY_COLOR[theme];
    const w = d.footX * 0.92, h = d.footY * 0.92;
    part(g, box(w, 0.35, h), mat('#c9b79a'), 0, 0.17, 0);
    part(g, box(w * 0.62, 2.0, h * 0.5), mat('#e6dccb'), -w * 0.12, 1.35, -h * 0.18);
    const roof = part(g, cone(w * 0.45, 1.1, 4), mat(theme === 'sun' ? '#c4703a' : c), -w * 0.12, 2.9, -h * 0.18);
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = 0.62;
    part(g, cyl(0.8, 0.9, 3.2, 10), mat('#ddd3c0'), w * 0.3, 1.9, -h * 0.12);
    part(g, dome(0.85), mat(theme === 'sun' ? '#5fb7ad' : c), w * 0.3, 3.5, -h * 0.12);
    part(g, box(w * 0.5, 0.05, h * 0.32), mat('#e9e4da'), -w * 0.05, 0.37, h * 0.28);
    part(g, box(0.3, 1.0, 0.3), mat('#7a6a5a'), -w * 0.35, 2.6, -h * 0.3);
    for (const [x, z] of [[-w * 0.44, h * 0.4], [w * 0.44, h * 0.4], [w * 0.44, -h * 0.42]]) part(g, cone(0.45, 1.6), mat('#3f6f31'), x, 1.1, z);
    // a gem per unit in its production slots
    rep.slotsMark = new THREE.Group();
    rep.slotsMark.position.set(-w * 0.45, 0.4, h * 0.45);
    g.add(rep.slotsMark);
  },
  altar(rep, g) {
    part(g, cyl(3.2, 3.4, 0.4, 16), mat('#d8c9a8'), 0, 0.2, 0);
    part(g, cyl(2.2, 2.2, 0.08, 20), mat('#b08d64'), 0, 0.44, 0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const s = part(g, cone(0.35, 2.6, 5), mat('#c99a6a'), Math.cos(a) * 2.7, 1.5, Math.sin(a) * 2.7);
      s.rotation.z = Math.cos(a) * 0.35;
      s.rotation.x = -Math.sin(a) * 0.35;
    }
    const fire = part(g, ico(0.5), glow('#ffb347', '#ff7a1a', 1.2), 0, 0.9, 0);
    rep.anim.push((s) => { fire.scale.setScalar(0.85 + Math.sin(s * 5) * 0.12); fire.rotation.y = s; });
  },
  generator(rep, g, e) {
    const theme = defs.get(e.type)?.theme ?? 'sun';
    const [c, em] = { rain: ['#8fe0ff', '#1f9fe0'], wind: ['#ffd76a', '#ffae00'], sun: ['#ffe48a', '#ffc000'], thunder: ['#d6b8ff', '#8a5cff'] }[theme];
    part(g, cyl(1.0, 1.15, 0.5, 6), mat('#8c8f97'), 0, 0.25, 0);
    part(g, cyl(0.45, 0.7, 0.7, 6), mat('#a3a7b0'), 0, 0.85, 0);
    const crystal = part(g, new THREE.OctahedronGeometry(0.6, 0), glow(c, em, 0.9), 0, 2.0, 0);
    crystal.scale.y = 1.6;
    rep.anim.push((s) => { crystal.rotation.y = s * 0.9; crystal.position.y = 2 + Math.sin(s * 1.7 + rep.id) * 0.12; });
  },
  cannon(rep, g, e) {
    part(g, cyl(1.2, 1.3, 0.3, 10), mat('#bdb6a8'), 0, 0.15, 0);
    const turret = new THREE.Group();
    turret.position.y = 0.3;
    g.add(turret);
    part(turret, cyl(0.75, 0.85, 0.6, 10), mat('#4a4744'), 0, 0.3, 0);
    part(turret, sph(0.55), mat('#2f2d2b', { metalness: 0.5, roughness: 0.4 }), 0, 0.7, 0);
    const barrel = part(turret, cyl(0.2, 0.26, 1.9, 10), mat('#2a2928', { metalness: 0.5, roughness: 0.4 }), 0, 0.8, 0.95);
    barrel.rotation.x = Math.PI / 2 - 0.25;
    rep.turret = turret;
    rep.barrel = barrel;
    turret.rotation.y = FACING_YAW[e.facing ?? 2];
  },
  archer(rep, g, e) {
    part(g, cyl(1.1, 1.22, 0.45, 10), mat('#cfc8b8'), 0, 0.22, 0);
    part(g, dome(0.85), mat('#ece6d6'), 0, 0.45, 0);
    part(g, cyl(0.9, 0.9, 0.12, 16), gold(), 0, 0.52, 0);
    const bow = new THREE.Group();
    bow.position.y = 1.35;
    part(bow, box(0.18, 0.14, 1.5), mat('#6b4a2c'));
    const arc = part(bow, new THREE.TorusGeometry(0.6, 0.06, 4, 12, Math.PI), gold(), 0, 0, 0.55);
    arc.rotation.set(Math.PI / 2, 0, 0);
    g.add(bow);
    bow.rotation.y = FACING_YAW[e.facing ?? 2];
    rep.turret = bow;
  },
  blocker(rep, g) {
    part(g, cyl(1.0, 1.12, 0.4, 8), mat('#8a7a66'), 0, 0.2, 0);
    part(g, cyl(0.68, 0.8, 2.0, 8), mat('#9c7f62'), 0, 1.4, 0);
    part(g, cyl(0.92, 0.92, 0.26, 8), mat('#3f9f9a'), 0, 2.45, 0);
    part(g, dome(0.74), mat('#55b9b2'), 0, 2.56, 0);
    part(g, cone(0.12, 0.6), gold(), 0, 3.55, 0);
  },
  aviary(rep, g) {
    part(g, cyl(1.2, 1.3, 0.35, 12), mat('#bdb6a8'), 0, 0.17, 0);
    part(g, cyl(1.0, 1.0, 0.7, 12), mat('#e2dccd'), 0, 0.7, 0);
    part(g, dome(0.95), mat('#c8a560', { metalness: 0.3, roughness: 0.5 }), 0, 1.05, 0);
    part(g, cyl(1.02, 1.02, 0.1, 16), gold(), 0, 1.06, 0);
    const vane = part(g, box(1.4, 0.05, 0.14), mat('#6b4a2c'), 0, 2.15, 0);
    rep.anim.push((s) => { vane.rotation.y = s * 4; });
  },
  golem(rep, g, e) {
    // the Sun's Golem is stone; the other Furies' walkers take their colour
    const theme = defs.get(e?.type)?.theme ?? 'sun';
    const skin = theme === 'sun' ? '#b9a98a' : FURY_COLOR[theme];
    const body = new THREE.Group();
    g.add(body);
    part(body, box(0.5, 0.55, 0.36), mat(skin), 0, 0.72, 0);
    part(body, box(0.3, 0.26, 0.28), mat(theme === 'sun' ? '#c9b99a' : skin), 0, 1.15, 0);
    part(body, box(0.52, 0.08, 0.38), mat(OWNER_COLOR[rep.owner]), 0, 0.84, 0);
    const legs = [part(body, box(0.16, 0.45, 0.18), mat('#9c8d70'), -0.13, 0.22, 0), part(body, box(0.16, 0.45, 0.18), mat('#9c8d70'), 0.13, 0.22, 0)];
    const arms = [part(body, box(0.12, 0.45, 0.14), mat('#a99a7c'), -0.33, 0.72, 0), part(body, box(0.12, 0.45, 0.14), mat('#a99a7c'), 0.33, 0.72, 0)];
    part(body, box(0.05, 0.05, 0.02), glow('#ffe39a', '#ffb43a', 1), -0.07, 1.17, 0.15);
    part(body, box(0.05, 0.05, 0.02), glow('#ffe39a', '#ffb43a', 1), 0.07, 1.17, 0.15);
    body.scale.setScalar(1.25);
    rep.cargo = new THREE.Group();
    rep.cargo.position.y = 1.9;
    g.add(rep.cargo);
    rep.walk = (phase) => {
      const a = Math.sin(phase) * 0.5;
      legs[0].rotation.x = a; legs[1].rotation.x = -a; arms[0].rotation.x = -a; arms[1].rotation.x = a;
    };
  },
  balloon(rep, g, e) {
    const theme = defs.get(e.type)?.theme ?? 'sun';
    const body = new THREE.Group();
    body.position.y = 3.2;
    g.add(body);
    part(body, sph(0.75, 12, 10), mat(theme === 'sun' ? '#e8c46a' : FURY_COLOR[theme])).scale.set(1, 1.15, 1);
    part(body, cyl(0.06, 0.06, 0.08, 12), mat(OWNER_COLOR[rep.owner]), 0, -0.8, 0).scale.set(8, 1, 8);
    for (const [x, z] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) part(body, box(0.03, 0.7, 0.03), mat('#5a4a3a'), x, -1.15, z);
    part(body, box(0.6, 0.35, 0.6), mat('#8a5a34'), 0, -1.6, 0);
    rep.cargo = new THREE.Group();
    rep.cargo.position.y = 1.4;
    g.add(rep.cargo);
    rep.anim.push((s) => { body.position.y = 3.2 + Math.sin(s * 1.3 + rep.id) * 0.18; });
  },
  fence(rep, g, e) {
    const theme = defs.get(e.type)?.theme ?? 'sun', c = theme === 'sun' ? '#e8b04a' : FURY_COLOR[theme];
    part(g, cyl(0.35, 0.45, 0.3, 8), mat('#8a7a66'), 0, 0.15, 0);
    part(g, cyl(0.16, 0.2, 1.6, 8), mat('#9c8d70'), 0, 1.0, 0);
    const orb = part(g, ico(0.3, 1), glow(c, c, 0.9), 0, 2.0, 0);
    rep.anim.push((s) => { orb.scale.setScalar(0.9 + Math.sin(s * 3 + rep.id) * 0.1); });
  },
  antiair(rep, g, e) {
    const c = FURY_COLOR[defs.get(e.type)?.theme ?? 'thunder'] ?? '#a184ea';
    part(g, cyl(1.0, 1.15, 0.45, 8), mat('#6f6a78'), 0, 0.22, 0);
    part(g, cyl(0.45, 0.6, 2.2, 8), mat('#7d7889'), 0, 1.5, 0);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const rod = part(g, cyl(0.04, 0.06, 1.4, 5), mat('#c9c4d4', { metalness: 0.6, roughness: 0.3 }), Math.cos(a) * 0.35, 3.0, Math.sin(a) * 0.35);
      rod.rotation.z = Math.cos(a) * 0.3;
      rod.rotation.x = -Math.sin(a) * 0.3;
    }
    const orb = part(g, ico(0.35, 1), glow(c, c, 1.0), 0, 2.85, 0);
    rep.anim.push((s) => { orb.material.emissiveIntensity = 0.7 + Math.abs(Math.sin(s * 4 + rep.id)) * 0.6; });
  },
  flyer(rep, g) {
    const body = new THREE.Group();
    body.position.y = 4.2;
    g.add(body);
    part(body, sph(0.32, 10, 8), mat('#c8a24a', { metalness: 0.3, roughness: 0.5 })).scale.set(1, 0.8, 1.3);
    part(body, box(0.08, 0.08, 0.7), mat('#6b4a2c'), 0, 0, -0.55);
    part(body, sph(0.1), mat(OWNER_COLOR[rep.owner]), 0, -0.25, 0);
    const rotor = new THREE.Group();
    rotor.position.y = 0.38;
    body.add(rotor);
    part(rotor, box(1.8, 0.03, 0.12), mat('#3a3330'));
    part(rotor, box(0.12, 0.03, 1.8), mat('#3a3330'));
    rep.anim.push((s) => { rotor.rotation.y = s * 18; body.position.y = 4.2 + Math.sin(s * 2 + rep.id) * 0.15; });
  },
  priest(rep, g) {
    const body = new THREE.Group();
    g.add(body);
    part(body, cone(0.32, 1.0, 8), mat(OWNER_COLOR[rep.owner]), 0, 0.5, 0);
    part(body, sph(0.17), mat('#edcfa8'), 0, 1.12, 0);
    part(body, cone(0.14, 0.34, 8), gold(), 0, 1.4, 0);
    body.scale.setScalar(1.3);
    rep.body = body;
  },
  crystal(rep, g) {
    const c = part(g, new THREE.OctahedronGeometry(0.28, 0), glow('#bff4ff', '#39c6ff', 1.1), 0, 0.45, 0);
    c.scale.y = 1.5;
    rep.anim.push((s) => { c.rotation.y = s * 2; c.position.y = 0.45 + Math.sin(s * 3 + rep.id) * 0.08; });
  },
  geyser(rep, g) {
    part(g, cyl(0.55, 0.7, 0.12, 10), mat('#3a3330'), 0, 0.06, 0);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3, r = 0.25 + hash(i, 7, 70) * 0.22;
      part(g, new THREE.DodecahedronGeometry(r, 0), mat('#857766'), Math.cos(a) * 0.95, r * 0.6, Math.sin(a) * 0.95);
    }
    rep.steam = [];
    const puff = ico(1, 1);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(puff, new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, depthWrite: false, flatShading: true }));
      g.add(m);
      rep.steam.push({ mesh: m, phase: i / 10, seed: hash(i, rep.id, 71) });
    }
  },
  obelisk(rep, g) {
    part(g, box(0.7, 3.2, 0.7), mat('#7d7a84'), 0, 1.6, 0);
    part(g, cone(0.5, 0.8, 4), mat('#9a97a2'), 0, 3.6, 0).rotation.y = Math.PI / 4;
    part(g, box(0.72, 0.4, 0.72), glow('#c8b8ff', '#7a5cff', 0.8), 0, 2.2, 0);
  },
  residence(rep, g) {
    part(g, box(2.2, 1.2, 1.7), mat('#e1d3b4'), 0, 0.66, 0);
    const roof = part(g, cone(1.75, 1.05, 4), mat('#a8513a'), 0, 1.78, 0);
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = 0.82;
    part(g, box(0.26, 0.7, 0.26), mat('#7a6a5a'), 0.6, 2.0, -0.3);
    part(g, box(0.42, 0.65, 0.05), mat('#6b4a2c'), 0, 0.38, 0.86);
    for (const x of [-0.7, 0.7]) part(g, box(0.34, 0.3, 0.05), glow('#ffe39a', '#ffb43a', 0.7), x, 0.8, 0.86);
    part(g, ico(0.45), mat('#4b7a30'), -1.4, 0.4, 1.3);
    part(g, ico(0.35), mat('#4b7a30'), 1.45, 0.35, -1.2);
  },
  generic(rep, g, e) {
    const d = defs.get(e.type);
    const fx = e.fx ?? 1, fy = e.fy ?? 1;
    part(g, box(fx * 0.8, 1.4, fy * 0.8), mat('#d9d0bd'), 0, 0.7, 0);
    const roof = part(g, cone(Math.max(fx, fy) * 0.6, 1, 4), mat(FURY_COLOR[d?.theme] ?? '#bbb'), 0, 1.9, 0);
    roof.rotation.y = Math.PI / 4;
  },
};

/** Which model a world entity gets. */
export function modelKind(e) {
  if (['priest', 'crystal', 'geyser', 'obelisk', 'flyer'].includes(e.kind)) return e.kind;
  const d = defs.get(e.type);
  if (e.kind === 'transport') return d?.cls === 'Aerial Transport' || d?.group === 'balloon' ? 'balloon' : 'golem';
  if (!d) return 'generic';
  if (d.cls === 'Energy') return 'temple';
  if (d.cls === 'Production') return 'workshop';
  if (d.cls === 'Altar') return 'altar';
  if (d.cls === 'Anti-Air') return 'antiair';
  return { battery: 'generator', cannon: 'cannon', archer: 'archer', blocker: 'blocker', aviary: 'aviary', fence: 'fence' }[d.group] ?? 'generic';
}

/** How tall a thing stands, for its health bar. */
export const HEIGHT = { temple: 5, workshop: 4.2, altar: 3, generator: 3, cannon: 2.2, archer: 2, blocker: 4, aviary: 2.6, flyer: 5.2, balloon: 4.6, fence: 2.4, antiair: 3.6, geyser: 0 };

/** The original sprite an entity is drawn with in "Sprites" mode, or null to keep its model. */
export function spriteKey(e) {
  const has = (k) => k in ART.sprites;
  if (e.kind === 'priest') return e.state === 'down' ? 'priest:down' : 'priest';
  if (e.kind === 'crystal' || e.kind === 'geyser') return e.kind;
  if (e.kind === 'transport' || e.kind === 'flyer') return has(e.type) ? e.type : null;
  if (e.kind === 'building') {
    if (has(`${e.type}:${e.facing}`)) return `${e.type}:${e.facing}`;
    return has(e.type) ? e.type : null;
  }
  return null;
}

/** A small model of a captive or crystal carried over a Golem's head. */
export function cargoModel(thing) {
  const g = new THREE.Group();
  if (thing?.kind === 'priest') {
    MODELS.priest({ owner: thing.owner, anim: [] }, g);
    g.rotation.z = Math.PI / 2;
    g.position.y = -0.2;
    g.scale.setScalar(0.8);
  } else {
    part(g, new THREE.OctahedronGeometry(0.25, 0), glow('#bff4ff', '#39c6ff', 1.1)).scale.y = 1.5;
  }
  return g;
}

