// Colour science helpers: blackbody, palettes, tonemappers, grading.
#include <common>

vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// Approximate colour of a blackbody at temperature T (Kelvin), linear RGB, max component ~1.
// Tanner Helland's curve fit (2012) to Mitchell Charity's blackbody colour table.
vec3 blackbody(float T) {
  float t = clamp(T, 1000.0, 40000.0) / 100.0;
  vec3 c;
  c.r = t <= 66.0 ? 255.0 : 329.698727446 * pow(t - 60.0, -0.1332047592);
  c.g = t <= 66.0 ? 99.4708025861 * log(t) - 161.1195681661 : 288.1221695283 * pow(t - 60.0, -0.0755148492);
  c.b = t >= 66.0 ? 255.0 : (t <= 19.0 ? 0.0 : 138.5177312231 * log(t - 10.0) - 305.0447927307);
  return srgbToLinear(clamp(c / 255.0, 0.0, 1.0));
}

// Cosine palette, Inigo Quilez (https://iquilezles.org/articles/palettes/, MIT): a + b*cos(2pi(c*t + d)).
vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) { return a + b * cos(TAU * (c * t + d)); }

vec3 adjustSaturation(vec3 c, float s) { return mix(vec3(luma(c)), c, s); }

vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

// ---------------------------------------------------------------- tonemappers
// ACES fitted, Stephen Hill (@self_shadow), as published in MJP's BakingLab
// (https://github.com/TheRealMJP/BakingLab, MIT License, Copyright (c) 2016 MJP; see
// THIRD_PARTY_NOTICES.md). Input linear, output linear [0,1].
vec3 tonemapACES(vec3 c) {
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  c = inM * c;
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return saturate(outM * (a / b));
}

// Khronos PBR Neutral tone mapper: preserves hue/saturation of bright colours.
// Adapted from https://github.com/KhronosGroup/ToneMapping (Apache License 2.0, Copyright
// The Khronos Group Inc.): renamed and given its constants inline. See THIRD_PARTY_NOTICES.md.
vec3 tonemapNeutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

// AgX (Troy Sobotka), using Benjamin Wrensch's "Minimal AgX" matrices and polynomial fit
// (https://iolite-engine.com/blog_posts/minimal_agx_implementation, MIT License, Copyright (c)
// 2024 Missing Deadlines; see THIRD_PARTY_NOTICES.md). Output converted back to linear.
vec3 tonemapAgX(vec3 v) {
  const mat3 agxM = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                         0.0784335999999992, 0.878468636469772, 0.0784336,
                         0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 agxInv = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                           -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                           -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  const float minEv = -12.47393, maxEv = 4.026069;
  v = agxM * max(v, 1e-10);
  v = clamp(log2(v), minEv, maxEv);
  v = (v - minEv) / (maxEv - minEv);
  vec3 x2 = v * v, x4 = x2 * x2;
  v = 15.5 * x4 * x2 - 40.14 * x4 * v + 31.96 * x4 - 6.868 * x2 * v + 0.4298 * x2 + 0.1191 * v - 0.00232;
  v = agxInv * v;
  return pow(saturate(v), vec3(2.2));
}

vec3 tonemap(vec3 c, int mode) {
  if (mode == 1) return tonemapNeutral(c);
  if (mode == 2) return tonemapAgX(c);
  return tonemapACES(c);
}

// Saturated "fire" ramp: 0 = cool ember (deep violet/crimson) .. 1 = white-hot.
vec3 fireRamp(float x) {
  x = saturate(x);
  vec3 c = mix(vec3(0.10, 0.015, 0.09), vec3(0.75, 0.07, 0.035), smoothstep(0.0, 0.3, x));
  c = mix(c, vec3(1.0, 0.36, 0.05), smoothstep(0.25, 0.55, x));
  c = mix(c, vec3(1.0, 0.72, 0.28), smoothstep(0.5, 0.8, x));
  c = mix(c, vec3(1.0, 0.96, 0.88), smoothstep(0.8, 1.0, x));
  return c;
}
