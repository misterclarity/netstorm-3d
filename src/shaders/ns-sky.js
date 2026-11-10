/**
 * A gradient sky with a soft sun, for <a-sky material="shader: ns-sky">: deep blue overhead, a warm
 * haze at the horizon and a lighter blue below, where the sea of clouds lies. The colours are
 * written in the shader as display values (a `color` uniform would be converted to linear space).
 * `night` (0 to 1, ns-sun.js) darkens it to a night sky with stars and a moon opposite the sun.
 */
AFRAME.registerShader('ns-sky', {
  schema: {
    sunDirection: { type: 'vec3', default: { x: -0.53, y: 0.71, z: 0.41 }, is: 'uniform' },
    night: { type: 'number', default: 0, is: 'uniform' },
  },
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    varying vec3 vDir;
    uniform vec3 sunDirection;
    uniform float night;
    void main() {
      vec3 zenith = vec3(0.17, 0.36, 0.68);
      vec3 middle = vec3(0.50, 0.68, 0.88);
      vec3 horizon = vec3(0.93, 0.89, 0.82);
      vec3 below = vec3(0.50, 0.64, 0.84);
      float h = vDir.y;
      vec3 c = h > 0.0 ? mix(horizon, middle, smoothstep(0.0, 0.25, h)) : mix(horizon, below, smoothstep(0.0, -0.35, h));
      c = mix(c, zenith, smoothstep(0.25, 0.9, h));
      float s = max(dot(normalize(vDir), normalize(sunDirection)), 0.0);
      c += vec3(1.0, 0.85, 0.6) * (pow(s, 64.0) * 0.6 + pow(s, 6.0) * 0.12);
      if (night > 0.0) {
        // night: deep blue overhead, a dim violet horizon, stars, and the moon across from the sun
        vec3 n = h > 0.0 ? mix(vec3(0.16, 0.15, 0.27), vec3(0.04, 0.06, 0.16), smoothstep(0.0, 0.6, h)) : mix(vec3(0.16, 0.15, 0.27), vec3(0.08, 0.10, 0.20), smoothstep(0.0, -0.35, h));
        vec3 cell = floor(vDir * 220.0);
        float star = step(0.9975, fract(sin(dot(cell, vec3(12.9898, 78.233, 45.164))) * 43758.5453)) * smoothstep(0.02, 0.3, h);
        n += vec3(0.9, 0.92, 1.0) * star;
        float m = max(dot(normalize(vDir), normalize(vec3(-sunDirection.x, sunDirection.y, -sunDirection.z))), 0.0);
        n += vec3(0.85, 0.88, 1.0) * (smoothstep(0.9993, 0.9996, m) * 0.9 + pow(m, 40.0) * 0.12);
        c = mix(c, n, night);
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
});
