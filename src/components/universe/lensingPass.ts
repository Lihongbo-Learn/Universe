/**
 * Screen-space gravitational-lensing post-process (Task 2-b).
 * Radially warps the rendered frame around the projected black-hole center:
 * each pixel samples the source frame at r' = r - Rs^2 / r (aspect corrected),
 * with a subtle chromatic split near the photon ring and an Einstein-ring glow.
 */
import { Vector2 } from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const LENSING_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const LENSING_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uCenter;
uniform float uRs;
uniform float uAspect;
uniform float uEnabled;
uniform float uTime;

varying vec2 vUv;

// Radial lens warp for one channel: r' = r - rs^2 / r, clamped at 0.
vec3 sampleWarped(vec2 dir, float r, float rs) {
  float nr = r - (rs * rs) / max(r, 1e-4);
  nr = max(nr, 0.0);
  vec2 warped = uCenter + dir * nr * vec2(1.0 / uAspect, 1.0);
  return texture2D(tDiffuse, warped).rgb;
}

void main() {
  vec2 d = vUv - uCenter;
  d.x *= uAspect;
  float r = max(length(d), 1e-4);
  vec2 dir = d / r;

  // Chromatic split near the ring: R/G/B deflected by slightly different horizons.
  vec3 col;
  col.r = sampleWarped(dir, r, uRs * 0.965).r;
  col.g = sampleWarped(dir, r, uRs).g;
  col.b = sampleWarped(dir, r, uRs * 1.035).b;

  // Subtle pulsing Einstein-ring glow just outside the shadow.
  float e = (r - uRs * 2.3) / max(uRs * 0.16, 1e-4);
  float ring = exp(-e * e);
  float shimmer = 0.92 + 0.08 * sin(uTime * 1.7);
  col += vec3(1.0, 0.62, 0.25) * ring * 0.35 * shimmer;

  // uEnabled lerps between the warped and the raw frame for a smooth toggle.
  vec3 plain = texture2D(tDiffuse, vUv).rgb;
  gl_FragColor = vec4(mix(plain, col, uEnabled), 1.0);
}
`;

/** Builds the lensing ShaderPass. ShaderPass clones the uniforms internally. */
export function createLensingPass(): ShaderPass {
  return new ShaderPass({
    name: 'GravitationalLensingPass',
    uniforms: {
      tDiffuse: { value: null },
      uCenter: { value: new Vector2(0.5, 0.5) },
      uRs: { value: 0.12 },
      uAspect: { value: 1.0 },
      uEnabled: { value: 0.0 },
      uTime: { value: 0.0 },
    },
    vertexShader: LENSING_VERTEX_SHADER,
    fragmentShader: LENSING_FRAGMENT_SHADER,
  });
}
