/**
 * Where the battlefield is. Everything on it lives under <a-entity id="world">, in cell units:
 * one map cell is one unit, the middle of the map's ground at the origin. On the screen that root
 * is the scene itself; in the tabletop modes it is shrunk onto a table, so one cell is about a
 * centimetre. These turn points and rays between the scene and the battlefield.
 */
import { origin } from './state.js';

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

/** Where a ray of the scene meets the battlefield's ground (its y = 0), in cell units; or null. */
export function groundPoint(ray) {
  const r = root();
  const local = ray.clone();
  if (r) {
    r.updateWorldMatrix(true, false);
    local.applyMatrix4(inverse.copy(r.matrixWorld).invert());
  }
  const hit = new THREE.Vector3();
  return local.intersectPlane(plane, hit) ? hit : null;
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
  const p = toScene(new THREE.Vector3(x, 0, z));
  rig.focus(p.x, p.z, radius ? radius * unit() : undefined, p.y);
}
