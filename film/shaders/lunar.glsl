// The Sea of Tranquility, 1969, for the Moon landing (shaders/moonlanding.glsl): a mare plain in
// early-morning sunlight, peppered with craters of every size, from bowls a hundred metres across
// down to pits the size of a hand, and strewn with stones. Metres; the landing site at the origin,
// y up; the Moon's curve drops the far ground away (radius 1737 km).
//
// The large-scale ground does not change, so it is baked once into a height field (uTerrain,
// rgba16f: height, its x and z slopes, and whether the Sun reaches it) covering uBakeSize metres
// round the site; define TERRAIN_BAKE to compile the bake pass. Craters smaller than a texel and
// the stones are added live near the camera.
#include <noise>

uniform sampler2D uTerrain, uTerrainFar;
uniform float uBakeSize, uBakeFar;   // metres each bake covers (the far one coarser, wider)
uniform vec3 uSunDir;          // towards the Sun (low in the east)
uniform float uBakeLayers;     // bake pass: crater layers to include (4 near, 2 far)

const float R_MOON = 1737400.0;

// A crater of radius r centred at c: a bowl, a raised rim and its ejecta. fresh 0..1: old craters
// are shallow and soft, young ones deep with sharp rims.
float crater(vec2 p, vec2 c, float r, float fresh) {
  float d = length(p - c) / r;
  float depth = mix(0.06, 0.22, fresh);
  float rim = mix(0.015, 0.06, fresh);
  float w = mix(0.35, 0.16, fresh);
  float bowl = d < 1.0 ? depth * (d * d - 1.0) : 0.0;
  // The bowl's floor is flattened (infill) in older craters.
  bowl = max(bowl, -depth * mix(0.55, 1.0, fresh));
  return r * (bowl + rim * exp(-pow((d - 1.0) / w, 2.0)) + rim * 0.35 * exp(-max(d - 1.0, 0.0) * 2.5) * step(1.0, d));
}

// One layer of craters: cells of size cell, a crater in some, radius up to rMax.
float craterLayer(vec2 p, float cell, float rMax, float density, float seed) {
  vec2 id0 = floor(p / cell);
  float h = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = id0 + vec2(i, j);
      vec4 k = hash43(vec3(id, seed));
      if (k.z > density) continue;
      // Radii follow a steep power law: many small, a few large.
      float r = rMax * (0.15 + 0.85 * pow(k.w, 2.5));
      vec2 c = (id + 0.5 + (k.xy - 0.5) * 0.6) * cell;
      h += crater(p, c, r, fract(k.w * 7.3 + k.x));
    }
  }
  return h;
}

// Gentle swells of the mare surface.
float swell(vec2 p) {
  return 2.2 * (fbm(p * 0.004 + 3.0, 4) - 0.5) + 0.7 * (fbm(p * 0.02 + 9.0, 3) - 0.5);
}

// The ground the bake holds (and the far ground, less its finest layers).
float groundLarge(vec2 p, int layers) {
  float h = swell(p);
  h += craterLayer(p, 260.0, 80.0, 0.35, 1.0);
  h += craterLayer(p, 90.0, 26.0, 0.5, 2.0);
  if (layers > 2) h += craterLayer(p, 32.0, 9.0, 0.55, 3.0);
  if (layers > 3) h += craterLayer(p, 11.0, 3.0, 0.6, 4.0);
  // The landing site itself: a level patch among the craters (Armstrong flew past a field of
  // boulders round a large crater to find one), with Little West crater 60 m to the east.
  float site = smoothstep(26.0, 10.0, length(p));
  h = mix(h, swell(p) * 0.4, site);
  h += crater(p, vec2(58.0, -8.0), 12.0, 0.8) * (1.0 - site);
  return h;
}

// Stones: most cells hold none; a few hold a rock, wider than tall.
float stones(vec2 p, float cell, float rMax, float seed, out float rock) {
  vec2 id = floor(p / cell);
  vec4 k = hash43(vec3(id, seed));
  rock = 0.0;
  if (k.z > 0.18) return 0.0;
  float r = rMax * (0.25 + 0.75 * k.w * k.w);
  vec2 c = (id + 0.5 + (k.xy - 0.5) * 0.5) * cell;
  vec2 q = rot2(k.x * 6.28) * (p - c) / vec2(r, r * (0.6 + 0.5 * k.y));
  float d = dot(q, q);
  if (d > 1.0) return 0.0;
  rock = 1.0;
  return r * 0.55 * sqrt(1.0 - d) * (0.85 + 0.3 * gnoise(p * 9.0 / rMax + k.xy * 20.0));
}

// The live fine layers (small craters, stones, regolith), faded out with distance (fade 0..1:
// callers use smoothstep(30, 8, distance)).
float groundFine(vec2 p, float fade, out float rock) {
  rock = 0.0;
  if (fade <= 0.0) return 0.0;
  float h = craterLayer(p, 3.6, 1.0, 0.55, 5.0) + craterLayer(p, 1.1, 0.3, 0.5, 6.0) * smoothstep(0.3, 0.7, fade);
  float r1, r2;
  h += stones(p, 1.7, 0.28, 7.0, r1) + stones(p, 0.55, 0.08, 8.0, r2) * smoothstep(0.5, 0.9, fade);
  rock = max(r1, r2);
  h += 0.012 * (fbm(p * 6.0, 3) - 0.5);
  return h * fade;
}

#ifdef TERRAIN_BAKE
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes;
void main() {
  vec2 p = (vUv - 0.5) * uBakeSize;
  float e = uBakeSize / uRes.x;
  int layers = int(uBakeLayers + 0.5);
  float h = groundLarge(p, layers);
  float hx = groundLarge(p + vec2(e, 0.0), layers), hz = groundLarge(p + vec2(0.0, e), layers);
  // Sunlight: march towards the Sun over the ground (a low Sun casts long shadows).
  vec3 l = normalize(uSunDir);
  float lit = 1.0;
  float t = max(0.4, e * 0.5);
  for (int i = 0; i < 80; i++) {
    vec3 q = vec3(p.x, h + 0.05, p.y) + l * t;
    float g = groundLarge(q.xz, min(layers, 3));
    lit = min(lit, 22.0 * (q.y - g) / t);
    t += max(max(0.35, e * 0.5), t * 0.07);
    if (lit < 0.0 || t > 1200.0) break;
  }
  fragColor = vec4(h, (hx - h) / e, (hz - h) / e, saturate(lit));
}
#else

// Baked ground at p (height, slopes, sunlight): the fine bake round the site, the coarse one
// beyond it, and past both a level plain.
vec4 bakedGround(vec2 p) {
  vec2 uv = p / uBakeSize + 0.5;
  if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) return texture(uTerrain, uv);
  vec2 uf = p / uBakeFar + 0.5;
  if (uf.x > 0.0 && uf.x < 1.0 && uf.y > 0.0 && uf.y < 1.0) return texture(uTerrainFar, uf);
  return vec4(0.0, 0.0, 0.0, 1.0);
}

// Height of the ground (with the Moon's curve) seen from the camera at distance dist.
float groundAt(vec2 p, float dist, out float rock) {
  float fade = smoothstep(30.0, 8.0, dist);
  float h = bakedGround(p).x + groundFine(p, fade, rock);
  return h - dot(p, p) / (2.0 * R_MOON);
}

// Regolith light: Lommel-Seeliger scattering (the full Moon bright to its edge, the ground flat
// lit even at grazing sun) with the opposition surge that halos the anti-solar point.
float regolith(vec3 n, vec3 l, vec3 v) {
  float mu0 = max(dot(n, l), 0.0), mu = max(dot(n, v), 0.02);
  float g = acos(clamp(dot(l, v), -1.0, 1.0));
  float surge = 1.0 + 0.9 / (1.0 + tan(g * 0.5) / 0.07);
  return 2.0 * mu0 / (mu0 + mu) * surge * 0.5;
}
#endif
