/**
 * GLSL shader sources for the black-hole scene (Task 2-b).
 * NOTE: no backticks and no ${ sequences may appear inside the shader code itself.
 */

/** Accretion disk vertex shader — passes world position, local xz, radius and angle. */
export const DISK_VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldPos;
varying vec2 vLocal;
varying float vR;
varying float vTheta;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vLocal = position.xz;
  vR = length(position.xz);
  vTheta = atan(position.z, position.x);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

/**
 * Accretion disk fragment shader.
 * - Keplerian differential rotation (inner rings spin faster).
 * - Angle-periodic value-noise fbm (no theta seam) sharpened into streaky filaments.
 * - Temperature color ramp white-hot -> orange -> dark red.
 * - Relativistic Doppler beaming: approaching side brighter and bluer.
 * - Inner-rim white-hot boost + rim alpha fades.
 */
export const DISK_FRAGMENT_SHADER = /* glsl */ `
uniform float uDiskPhase;
uniform float uWallTime;

varying vec3 vWorldPos;
varying vec2 vLocal;
varying float vR;
varying float vTheta;

const float TWO_PI = 6.28318530718;
const float R_IN = 2.7;
const float R_OUT = 15.0;
const float N_ARM = 30.0;
const float K_ROT = 8.0;

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.235);
  return fract(p.x * p.y);
}

// Value noise, periodic in x with integer periodX (kills the theta = +/-PI seam).
float pnoise(vec2 uv, float periodX) {
  vec2 cell = floor(uv);
  vec2 f = fract(uv);
  vec2 s = f * f * (3.0 - 2.0 * f);
  float x0 = mod(cell.x, periodX);
  float x1 = mod(cell.x + 1.0, periodX);
  float a = hash21(vec2(x0, cell.y));
  float b = hash21(vec2(x1, cell.y));
  float c = hash21(vec2(x0, cell.y + 1.0));
  float d = hash21(vec2(x1, cell.y + 1.0));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

// 4-octave fbm; octave doubling keeps the x periodicity (integer lattice wrap).
float fbm4(vec2 uv, float periodX) {
  float v = 0.0;
  float amp = 0.5;
  for (int k = 0; k < 4; k++) {
    v += amp * pnoise(uv, periodX);
    uv *= 2.0;
    periodX *= 2.0;
    amp *= 0.5;
  }
  return v;
}

void main() {
  // Keplerian rotation: w(r) = k / r^1.5, rotate the noise domain so the
  // pattern moves counter-clockwise (matches tangential velocity (-z, 0, x)).
  float w = K_ROT / pow(vR, 1.5);
  float thetaN = vTheta - uDiskPhase * w;
  float u = thetaN / TWO_PI * N_ARM;
  float vc = vR * 6.0;

  // Main 4-octave turbulent layer + a higher-frequency octave layer.
  float n1 = fbm4(vec2(u, vc), N_ARM);
  float n2 = pnoise(vec2(u * 3.0, vc * 4.0 + 17.0), N_ARM * 3.0) * 0.65
           + pnoise(vec2(u * 9.0, vc * 11.0 + 5.0), N_ARM * 9.0) * 0.35;

  // Sharpen into streaky filaments hugging the orbital direction.
  float streak = pow(clamp(n1 * 1.35, 0.0, 1.0), 2.6);
  float detail = pow(clamp(n2 * 1.35, 0.0, 1.0), 3.2);
  float filaments = streak * (0.45 + 1.1 * detail);

  // Temperature ramp by normalized radius t.
  float t = clamp((vR - R_IN) / (R_OUT - R_IN), 0.0, 1.0);
  vec3 col = mix(vec3(1.0, 0.97, 0.90), vec3(1.0, 0.62, 0.18), smoothstep(0.0, 0.45, t));
  col = mix(col, vec3(0.55, 0.10, 0.02), smoothstep(0.40, 1.0, t));

  // Brightness falls with radius; bottom face slightly dimmer than top face.
  float bright = mix(1.9, 0.4, t) * mix(1.0, 0.82, step(vLocal.y, -0.02));

  // Inner-rim white-hot boost (t < 0.08).
  float rim = smoothstep(0.08, 0.0, t);
  col += vec3(0.9, 0.75, 0.55) * rim;

  // Doppler beaming: brightness asymmetry + blue-shift on the approaching side.
  vec3 tangential = normalize(vec3(-vWorldPos.z, 0.0, vWorldPos.x));
  vec3 toCam = normalize(cameraPosition - vWorldPos);
  float dop = dot(tangential, toCam);
  float beam = pow(max(1.0 + 0.65 * dop, 0.18), 2.2);
  col = mix(col, vec3(0.85, 0.9, 1.0), clamp(dop * 0.5, 0.0, 0.4));

  // Alpha: fade in over the first 6% of the span, out over the last 22%.
  float aIn = smoothstep(R_IN, R_IN + 0.06 * (R_OUT - R_IN), vR);
  float aOut = 1.0 - smoothstep(R_OUT - 0.22 * (R_OUT - R_IN), R_OUT, vR);
  float density = (0.45 + 0.75 * n1) * (0.3 + 1.5 * filaments);
  float alpha = aIn * aOut * density;

  // F35 — breathing shimmer driven by wall-clock time (uWallTime keeps
  // advancing even when uDiskPhase is paused), so a frozen frame stays alive.
  float breathe = 1.0
    + 0.05 * sin(uWallTime * 1.7 + vR * 0.5)
    + 0.035 * sin(uWallTime * 0.83 + vTheta * 3.0);

  // Global intensity scale keeps the disk inside ACES head-room:
  // inner rim lands ~2.0 (white-hot), mid ~0.5 (orange), outer ~0.1 (dark red).
  vec3 emissive = col * (bright * (0.30 + 0.9 * filaments)) * beam * 0.42 * breathe;
  gl_FragColor = vec4(emissive, alpha);
}
`;

/** Starfield points vertex shader — fixed pixel sizes (no attenuation look). */
export const STAR_VERTEX_SHADER = /* glsl */ `
uniform float uPixelRatio;
attribute float aSize;
attribute vec3 aTint;
varying vec3 vTint;

void main() {
  vTint = aTint;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * uPixelRatio;
}
`;

/** Starfield points fragment shader — soft round sprite. */
export const STAR_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uMap;
varying vec3 vTint;

void main() {
  vec4 texel = texture2D(uMap, gl_PointCoord);
  if (texel.a < 0.01) discard;
  gl_FragColor = vec4(vTint * texel.rgb, texel.a);
}
`;
