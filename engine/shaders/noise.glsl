// Procedural noise: value, gradient, fbm, ridged, Worley/Voronoi, domain warping.
// The fbm octave rotations, Voronoi border distance and domain warp follow Inigo Quilez
// (https://iquilezles.org/articles/, MIT License); see THIRD_PARTY_NOTICES.md.
#include <common>

// ---------------------------------------------------------------- value noise
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}

// ------------------------------------------------------------- gradient noise
// Returns roughly [-1, 1].
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 ga = hash22(i) * 2.0 - 1.0;
  vec2 gb = hash22(i + vec2(1, 0)) * 2.0 - 1.0;
  vec2 gc = hash22(i + vec2(0, 1)) * 2.0 - 1.0;
  vec2 gd = hash22(i + vec2(1, 1)) * 2.0 - 1.0;
  float va = dot(ga, f), vb = dot(gb, f - vec2(1, 0)), vc = dot(gc, f - vec2(0, 1)), vd = dot(gd, f - vec2(1, 1));
  return 1.4 * mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y);
}

float gnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  #define GN_G(o) (hash33(i + o) * 2.0 - 1.0)
  float n000 = dot(GN_G(vec3(0, 0, 0)), f - vec3(0, 0, 0));
  float n100 = dot(GN_G(vec3(1, 0, 0)), f - vec3(1, 0, 0));
  float n010 = dot(GN_G(vec3(0, 1, 0)), f - vec3(0, 1, 0));
  float n110 = dot(GN_G(vec3(1, 1, 0)), f - vec3(1, 1, 0));
  float n001 = dot(GN_G(vec3(0, 0, 1)), f - vec3(0, 0, 1));
  float n101 = dot(GN_G(vec3(1, 0, 1)), f - vec3(1, 0, 1));
  float n011 = dot(GN_G(vec3(0, 1, 1)), f - vec3(0, 1, 1));
  float n111 = dot(GN_G(vec3(1, 1, 1)), f - vec3(1, 1, 1));
  #undef GN_G
  return 1.2 * mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
                   mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

// --------------------------------------------------------------------- fbm
const mat2 FBM_M2 = mat2(1.6, 1.2, -1.2, 1.6);
const mat3 FBM_M3 = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64) * 2.02;

// Value-noise fbm in [0,1].
float fbm(vec2 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < oct; i++) { s += a * vnoise(p); n += a; p = FBM_M2 * p; a *= 0.5; }
  return s / n;
}
float fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < oct; i++) { s += a * vnoise(p); n += a; p = FBM_M3 * p; a *= 0.5; }
  return s / n;
}
// Gradient-noise fbm in roughly [-1,1].
float gfbm(vec2 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < oct; i++) { s += a * gnoise(p); p = FBM_M2 * p; a *= 0.5; }
  return s;
}
float gfbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < oct; i++) { s += a * gnoise(p); p = FBM_M3 * p; a *= 0.5; }
  return s;
}
// Ridged multifractal (sharp crests) in [0,1].
float ridged(vec3 p, int oct) {
  float s = 0.0, a = 0.5, w = 1.0, n = 0.0;
  for (int i = 0; i < oct; i++) {
    float r = 1.0 - abs(gnoise(p));
    r *= r;
    r *= w;
    w = saturate(r * 2.0);
    s += a * r; n += a;
    p = FBM_M3 * p; a *= 0.5;
  }
  return s / n;
}
// Turbulence: sum of |noise| - billowy look for smoke and clouds.
float turb(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < oct; i++) { s += a * abs(gnoise(p)); n += a; p = FBM_M3 * p; a *= 0.5; }
  return s / n;
}

// ------------------------------------------------------------ Worley/Voronoi
// Returns (F1, F2) distances.
vec2 worley(vec2 p) {
  vec2 n = floor(p), f = fract(p);
  float F1 = 8.0, F2 = 8.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(i, j);
      vec2 r = g + hash22(n + g) - f;
      float d = dot(r, r);
      if (d < F1) { F2 = F1; F1 = d; } else if (d < F2) F2 = d;
    }
  return sqrt(vec2(F1, F2));
}
vec2 worley(vec3 p) {
  vec3 n = floor(p), f = fract(p);
  float F1 = 8.0, F2 = 8.0;
  for (int k = -1; k <= 1; k++)
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        vec3 g = vec3(i, j, k);
        vec3 r = g + hash33(n + g) - f;
        float d = dot(r, r);
        if (d < F1) { F2 = F1; F1 = d; } else if (d < F2) F2 = d;
      }
  return sqrt(vec2(F1, F2));
}
// Distance to the nearest Voronoi cell border (x) and a per-cell random id (y).
// Inigo Quilez, "Voronoi - distances" (https://www.shadertoy.com/view/ldl3W8, MIT).
vec2 voronoiEdge(vec2 x) {
  vec2 n = floor(x), f = fract(x);
  vec2 mg = vec2(0), mr = vec2(0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(i, j);
      vec2 r = g + hash22(n + g) - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
  md = 8.0;
  for (int j = -2; j <= 2; j++)
    for (int i = -2; i <= 2; i++) {
      vec2 g = mg + vec2(i, j);
      vec2 r = g + hash22(n + g) - f;
      if (dot(mr - r, mr - r) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
    }
  return vec2(md, hash12(n + mg));
}

// --------------------------------------------------------- domain warping
// Classic two-level warp (Quilez). Returns warped fbm in [0,1]; `q` receives the first warp.
float warpedFbm(vec2 p, float t, int oct, out vec2 q) {
  q = vec2(fbm(p + vec2(0.0, 0.0) + 0.05 * t, oct), fbm(p + vec2(5.2, 1.3) - 0.04 * t, oct));
  vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + 0.03 * t, oct), fbm(p + 4.0 * q + vec2(8.3, 2.8) - 0.02 * t, oct));
  return fbm(p + 4.0 * r, oct);
}
