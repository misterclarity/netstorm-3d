/**
 * Where the battlefield is. Everything on it lives under <a-entity id="world">, in cell units:
 * one map cell is one unit, the middle of the map's ground at the origin. On the screen that root
 * is the scene itself; in the tabletop modes it is shrunk onto a table, so one cell is about a
 * centimetre. These turn points and rays between the scene and the battlefield.
 */
import { origin } from './state.js';
import { HEIGHTS, groundAt } from './heights.js';

const { THREE } = AFRAME;
const inverse = new THREE.Matrix4();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** The battlefield's root object (the #world entity's). */
export function root() {
  return document.getElementById('world')?.object3D ?? null;
}

/** Metres (scene units) per cell. */
export function unit() {
  const r = root();
  if (!r) return 1;
  r.updateWorldMatrix(true, false);
  return new THREE.Vector3().setFromMatrixScale(r.matrixWorld).x;
}

/** A battlefield point in the scene. */
export function toScene(v) {
  const r = root();
  if (!r) return v.clone();
  r.updateWorldMatrix(true, false);
  return v.clone().applyMatrix4(r.matrixWorld);
}

/** A scene point on the battlefield. */
export function toLocal(v) {
  const r = root();
  if (!r) return v.clone();
  r.updateWorldMatrix(true, false);
  return v.clone().applyMatrix4(inverse.copy(r.matrixWorld).invert());
}

/** A ray of the scene on the battlefield, in cell units. */
export function localRay(ray) {
  const r = root();
  const local = ray.clone();
  if (r) {
    r.updateWorldMatrix(true, false);
    local.applyMatrix4(inverse.copy(r.matrixWorld).invert());
  }
  return local;
}

/** Where a ray of the scene meets the battlefield's ground, in cell units; or null. */
export function groundPoint(ray) {
  return surfacePoint(localRay(ray));
}

/**
 * Where a ray on the battlefield meets the ground: the plane y = 0 on a level map; with tiered
 * islands (heights.js) the first island, bridge or cliff it comes to, or over the sky the height
 * of the land round about. Walked down the ray a fifth of a cell at a time from the highest
 * ground to the lowest, then narrowed down.
 */
export function surfacePoint(local) {
  const hit = new THREE.Vector3();
  if (!HEIGHTS.on) return local.intersectPlane(plane, hit) ? hit : null;
  const o = local.origin, d = local.direction;
  if (d.y > -1e-4) return null;
  const top = HEIGHTS.high + 0.3, bottom = HEIGHTS.low - 0.3;
  const below = (k) => {
    hit.copy(d).multiplyScalar(k).add(o);
    return hit.y <= groundAt(hit.x + origin.x, hit.z + origin.z);
  };
  let k0 = Math.max(0, (top - o.y) / d.y);
  const end = (bottom - o.y) / d.y, step = 0.2 / Math.max(Math.hypot(d.x, d.z), -d.y);
  if (end < 0) return null;
  if (below(k0)) return hit.copy(d).multiplyScalar(k0).add(o);
  for (let k = k0 + step; k < end + step; k += step) {
    if (!below(Math.min(k, end))) { k0 = k; continue; }
    let lo = k0, hi = Math.min(k, end);
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      if (below(mid)) hi = mid; else lo = mid;
    }
    below(hi);
    return hit;
  }
  return null;
}

/** The map cell a ray of the scene points at, or null. */
export function groundCell(ray) {
  const hit = groundPoint(ray);
  return hit ? { x: Math.floor(hit.x + origin.x), y: Math.floor(hit.z + origin.z) } : null;
}

/**
 * Turn the orbiting camera to battlefield point (x, z), at a distance given in cells; nothing while
 * a headset's own camera is in use.
 */
export function lookAtCell(x, z, radius) {
  const rig = document.getElementById('camera')?.components['orbit-rig'];
  if (!rig?.enabled) return;
  const p = toScene(new THREE.Vector3(x, groundAt(x + origin.x, z + origin.z), z));
  rig.focus(p.x, p.z, radius ? radius * unit() : undefined, p.y);
}
