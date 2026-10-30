/**
 * A ring of low-poly clouds, drawn as one instanced mesh, turning slowly about the scene's middle.
 * Use several on one entity with A-Frame's multiple-instance syntax: ns-clouds__low, ns-clouds__high.
 */
import { hash } from '../state.js';

const { THREE } = AFRAME;

AFRAME.registerComponent('ns-clouds', {
  multiple: true,
  schema: {
    clusters: { default: 60 },
    seed: { default: 1 },
    innerRadius: { default: 20 },
    outerRadius: { default: 450 },
    height: { default: -60 },
    spread: { default: 16 },
    size: { default: 7 },
    spin: { default: 0.004 }, // radians a second
  },

  init() {
    const d = this.data, puffs = [];
    for (let c = 0; c < d.clusters; c++) {
      const a = hash(c, d.seed, 1) * Math.PI * 2, r = d.innerRadius + hash(c, d.seed, 2) * (d.outerRadius - d.innerRadius);
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r, cy = d.height + (hash(c, d.seed, 3) - 0.5) * d.spread;
      const n = 5 + Math.floor(hash(c, d.seed, 4) * 7), size = d.size * (0.6 + hash(c, d.seed, 5) * 0.8);
      for (let i = 0; i < n; i++) {
        const s = size * (0.55 + hash(c, i, 6) * 0.6);
        puffs.push([cx + (hash(c, i, 7) - 0.5) * size * 3.2, cy + hash(c, i, 8) * size * 0.5, cz + (hash(c, i, 9) - 0.5) * size * 1.8, s]);
      }
    }
    const material = new THREE.MeshLambertMaterial({ color: '#f6f8fc', emissive: '#4a5a70', emissiveIntensity: 0.25, flatShading: true });
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), material, puffs.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    puffs.forEach(([x, y, z, s], i) => {
      q.setFromEuler(e.set(0, hash(i, 3, 3) * 6, 0));
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * 0.62, s));
      mesh.setMatrixAt(i, m);
    });
    this.mesh = mesh;
    this.el.setObject3D(this.attrName, mesh);
  },

  tick(t) {
    this.mesh.rotation.y = (t / 1000) * this.data.spin;
  },

  remove() {
    this.el.removeObject3D(this.attrName);
  },
});
