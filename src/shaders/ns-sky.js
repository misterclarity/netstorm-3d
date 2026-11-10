/**
 * A gradient sky with a soft sun, for <a-sky material="shader: ns-sky">: deep blue overhead, a warm
 * haze at the horizon and a lighter blue below, where the sea of clouds lies. The colours are
 * written in the shader as display values (a `color` uniform would be converted to linear space).
 * `night` (0 to 1, ns-sun.js) darkens it to a night sky with stars and a moon opposite the sun;
 * `moon` is its phase as the house rules number them: 0 new, 1 first quarter, 2 full, 3 third quarter.
 */
AFRAME.registerShader('ns-sky', {
  schema: {
    sunDirection: { type: 'vec3', default: { x: -0.53, y: 0.71, z: 0.41 }, is: 'uniform' },
    night: { type: 'number', default: 0, is: 'uniform' },
    moon: { type: 'number', default: 2, is: 'uniform' },
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
    uniform float moon;
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
        vec3 d = normalize(vDir), md = normalize(vec3(-sunDirection.x, sunDirection.y, -sunDirection.z));
        float m = max(dot(d, md), 0.0);
        // the moon's disc, in coordinates across it (-1 to 1), lit by its phase: the terminator
        // runs from the right edge (new) through the middle (a quarter) to the left edge (full),
        // the waxing moon lit on the right, the waning on the left; the dark part faintly seen
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), md)), up = cross(md, right);
        vec2 q = vec2(dot(d, right), dot(d, up)) / 0.032;
        float disc = (1.0 - smoothstep(0.92, 1.0, length(q))) * step(0.0, dot(d, md));
        float k = cos(moon * 1.5707963), across = sqrt(max(0.0, 1.0 - q.y * q.y));
        float side = moon < 2.0 ? q.x : -q.x;
        float lit = moon == 2.0 ? 1.0 : smoothstep(-0.06, 0.06, side - k * across);
        float full = 0.5 - 0.5 * k;
        vec3 cell = floor(vDir * 220.0);
        float star = step(0.9975, fract(sin(dot(cell, vec3(12.9898, 78.233, 45.164))) * 43758.5453)) * smoothstep(0.02, 0.3, h);
        n += vec3(0.9, 0.92, 1.0) * star * (1.0 - disc);
        n += vec3(0.85, 0.88, 1.0) * (disc * (0.07 + 0.83 * lit) + pow(m, 40.0) * 0.12 * (0.25 + 0.75 * full));
        c = mix(c, n, night);
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
});
