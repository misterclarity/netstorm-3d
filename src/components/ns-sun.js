/**
 * Settings of the sun's shadow that the light component does not take: a normal bias against
 * shadow acne, and a smaller shadow map on small screens.
 */
AFRAME.registerComponent('ns-sun', {
  schema: { normalBias: { default: 0.04 }, smallScreenMap: { default: 2048 } },

  init() {
    this.apply = this.apply.bind(this);
    this.el.addEventListener('object3dset', this.apply);
    this.apply();
  },

  apply() {
    const light = this.el.getObject3D('light');
    if (!light?.shadow) return;
    light.shadow.normalBias = this.data.normalBias;
    if (Math.min(innerWidth, innerHeight) <= 700) light.shadow.mapSize.set(this.data.smallScreenMap, this.data.smallScreenMap);
  },
});
