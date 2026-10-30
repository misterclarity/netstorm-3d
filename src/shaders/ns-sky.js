/**
 * A gradient sky with a soft sun, for <a-sky material="shader: ns-sky">: deep blue overhead, a warm
 * haze at the horizon and a lighter blue below, where the sea of clouds lies. The colours are
 * written in the shader as display values (a `color` uniform would be converted to linear space).
 */
AFRAME.registerShader('ns-sky', {
  schema: {
    sunDirection: { type: 'vec3', default: { x: -0.53, y: 0.71, z: 0.41 }, is: 'uniform' },
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
      gl_FragColor = vec4(c, 1.0);
    }`,
});
