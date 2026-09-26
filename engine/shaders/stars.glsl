// Procedural star fields for full-screen shaders.
// For 3D camera moves prefer the instanced `StarSphere` component (no seams, true parallax).
#include <common>
#include <color>

// One layer of stars on a 2D plane.
//   p       : position in "cell" units (1 unit = one grid cell, at most one star per cell)
//   px      : size of one screen pixel in the same units (for anti-aliasing)
//   density : probability a cell has a star (0..1)
//   seed    : layer seed
// Returns linear HDR radiance. Stars keep constant energy when sub-pixel, so they never shimmer.
vec3 starLayer(vec2 p, float px, float density, float seed, float time, float twinkle) {
  vec2 cell = floor(p);
  vec3 col = vec3(0.0);
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(i, j);
      vec4 h = hash42(c + seed * 31.7);
      if (h.w > density) continue;
      vec3 h2 = hash32(c + seed * 7.3 + 11.0);
      vec2 pos = c + 0.15 + 0.7 * h.xy;
      float d2 = dot(p - pos, p - pos);
      // Power-law brightness: a handful of bright stars, many faint ones.
      float mag = pow(h.z, 18.0) * 30.0 + pow(h.z, 4.0) * 1.0 + 0.02;
      // Physical radius ~ tiny; widen to at least ~0.7px and conserve energy.
      // Radius capped well inside the 3x3 search so glows never show cell edges.
      float r = min(max(px * 0.75, 0.02), 0.28);
      float energy = mag * (0.02 * 0.02) / (r * r);
      float dd = sqrt(d2);
      float core = exp(-d2 / (r * r)) * min(energy, mag * 4.0);
      // Soft halo for bright stars, fading to zero within one cell.
      float halo = exp(-dd / (0.05 + px * 1.5)) * mag * 0.012 * smoothstep(0.95, 0.5, dd);
      float tw = 1.0 + twinkle * (0.5 * sin(time * (2.0 + 6.0 * h2.x) + TAU * h2.y));
      vec3 tint = blackbody(mix(2800.0, 14000.0, pow(h2.z, 1.6)));
      col += (core + halo) * tw * tint;
    }
  return col;
}

// Several layers at different scales = a convincing, deep field.
vec3 starField(vec2 uv, float pxScale, float time, float seed, float amount) {
  vec3 c = vec3(0.0);
  c += starLayer(uv * 30.0, pxScale * 30.0, 0.5, seed + 1.0, time, 0.25) * 0.6;
  c += starLayer(uv * 70.0, pxScale * 70.0, 0.3, seed + 2.0, time, 0.35) * 0.35;
  c += starLayer(uv * 140.0, pxScale * 140.0, 0.15, seed + 3.0, time, 0.0) * 0.25;
  return c * amount;
}
