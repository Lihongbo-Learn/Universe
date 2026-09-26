/**
 * GLSL sources for the Milky Way GPU particle systems (Task 2-a).
 * Plain TS template strings — NEVER put a backtick inside shader code.
 * Rendered with NoToneMapping; fragment outputs are linear and final.
 */

/** Star field vertex shader — perspective point sizing + varying passthrough. */
export const STAR_VERTEX = `
uniform float uScale;

attribute float aSize;
attribute float aPhase;
attribute vec3 color;

varying vec3 vColor;
varying float vPhase;

void main() {
  vColor = color;
  vPhase = aPhase;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / (-mvPosition.z), 1.0, 260.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

/** Star field fragment shader — soft round sprite with per-star twinkle. */
export const STAR_FRAGMENT = `
uniform float uTime;

varying vec3 vColor;
varying float vPhase;

void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  float alpha = smoothstep(0.5, 0.05, d);
  alpha *= alpha;
  alpha *= 0.8 + 0.2 * sin(uTime * 1.7 + vPhase);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(vColor * alpha, alpha);
}
`;

/** Dust vertex shader — same sizing rule, bigger sprites. */
export const DUST_VERTEX = `
uniform float uScale;

attribute float aSize;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / (-mvPosition.z), 1.0, 420.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

/** Dust fragment shader — near-black soft blob, normal blending darkens stars. */
export const DUST_FRAGMENT = `
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  float alpha = smoothstep(0.5, 0.08, d);
  alpha *= alpha;
  gl_FragColor = vec4(vec3(0.008, 0.006, 0.010), alpha * 0.5);
}
`;
