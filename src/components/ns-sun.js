import { THREE, G, NS, TPS } from '../state.js';

/** Seconds a dusk or a dawn takes: it ends as the night (or the day) begins by the rules. */
const TWILIGHT = 24;
const DAY = { sun: '#fff0d8', sunI: 2.6, sky: '#e3eefc', ground: '#7a6248', skyI: 1.15, fog: '#b4c8e4' };
const NIGHT = { sun: '#a9bcff', sunI: 0.9, sky: '#7686bc', ground: '#3a3848', skyI: 0.85, fog: '#232d48' };

/**
 * How dark it is at second `s` of the battle, 0 (day) to 1 (night): with days and nights on
 * (settings.js, the house rules), the light fades over the TWILIGHT before nightfall and comes back
 * over the TWILIGHT before dawn.
 */
export function nightness(s) {
  const cycle = NS.DAY_SECONDS + NS.NIGHT_SECONDS, x = s % cycle;
  const fade = (from) => { const k = Math.min(1, Math.max(0, (x - from) / TWILIGHT)); return k * k * (3 - 2 * k); };
  if (x < NS.DAY_SECONDS - TWILIGHT) return 0;
  if (x < NS.DAY_SECONDS) return fade(NS.DAY_SECONDS - TWILIGHT);
  if (x < cycle - TWILIGHT) return 1;
  return 1 - fade(cycle - TWILIGHT);
}

/**
 * The sun: settings of its shadow that the light component does not take (a normal bias against
 * shadow acne, a smaller shadow map on small screens); and day and night, which turn the sun to a
 * pale moon, the sky light down and blue, the fog and the sky dark with stars.
 */
AFRAME.registerComponent('ns-sun', {
  schema: { normalBias: { default: 0.04 }, smallScreenMap: { default: 2048 } },

  init() {
    this.apply = this.apply.bind(this);
    this.el.addEventListener('object3dset', this.apply);
    this.apply();
    this.dark = -1;
    this.c = new THREE.Color();
    this.from = new THREE.Color();
  },

  apply() {
    const light = this.el.getObject3D('light');
    if (!light?.shadow) return;
    light.shadow.normalBias = this.data.normalBias;
    if (Math.min(innerWidth, innerHeight) <= 700) light.shadow.mapSize.set(this.data.smallScreenMap, this.data.smallScreenMap);
  },

  tick() {
    const w = G.world, dark = w?.nights ? nightness(w.tick / TPS) : 0;
    if (Math.abs(dark - this.dark) < 0.003) return;
    this.dark = dark;
    const mix = (a, b) => this.c.set(a).lerp(this.from.set(b), dark);
    const sun = this.el.getObject3D('light');
    if (sun) {
      sun.color.copy(mix(DAY.sun, NIGHT.sun));
      sun.intensity = DAY.sunI + (NIGHT.sunI - DAY.sunI) * dark;
    }
    const sky = document.getElementById('skylight')?.getObject3D('light');
    if (sky) {
      sky.color.copy(mix(DAY.sky, NIGHT.sky));
      sky.groundColor.copy(mix(DAY.ground, NIGHT.ground));
      sky.intensity = DAY.skyI + (NIGHT.skyI - DAY.skyI) * dark;
    }
    const fog = this.el.sceneEl.object3D.fog;
    if (fog) fog.color.copy(mix(DAY.fog, NIGHT.fog));
    const dome = document.querySelector('a-sky')?.getObject3D('mesh')?.material;
    if (dome?.uniforms?.night) dome.uniforms.night.value = dark;
  },
});
