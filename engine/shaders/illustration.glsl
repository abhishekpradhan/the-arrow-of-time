// Painted light for illustrated scenes: skies from the sun's elevation, silhouettes that fade
// into the air with distance, rim light, clouds, mist and smoke. Picture coordinates as from
// centered() (y in [-0.5, 0.5]); `hy` is the height of the horizon, `sun` the sun's position in
// the picture (below hy once it has set) and `e` its elevation in degrees.
#include <common>
#include <noise>
#include <color>
#include <stars>

// ---------------------------------------------------------------- the sky
// A clear sky against the sun's elevation: the zenith, the band above the horizon, the horizon
// itself, the glow around the sun, and how many stars show. Keys run from deep night (-18 deg)
// through dusk and a low sun to midday (40 deg).
struct SkyTone { vec3 zenith; vec3 mid; vec3 horizon; vec3 glow; float stars; };

SkyTone skyTone(float e) {
  float E[7] = float[7](-18.0, -9.0, -4.0, 0.0, 5.0, 15.0, 40.0);
  vec3 Z[7] = vec3[7](vec3(0.003, 0.005, 0.016), vec3(0.012, 0.02, 0.07), vec3(0.04, 0.055, 0.17),
                      vec3(0.09, 0.1, 0.28), vec3(0.12, 0.2, 0.45), vec3(0.1, 0.24, 0.55), vec3(0.06, 0.2, 0.55));
  vec3 M[7] = vec3[7](vec3(0.006, 0.01, 0.028), vec3(0.04, 0.05, 0.14), vec3(0.22, 0.14, 0.3),
                      vec3(0.55, 0.28, 0.36), vec3(0.55, 0.45, 0.55), vec3(0.38, 0.52, 0.75), vec3(0.3, 0.5, 0.82));
  vec3 H[7] = vec3[7](vec3(0.012, 0.016, 0.035), vec3(0.22, 0.12, 0.14), vec3(0.85, 0.32, 0.16),
                      vec3(1.35, 0.52, 0.2), vec3(1.25, 0.8, 0.45), vec3(0.95, 0.88, 0.78), vec3(0.78, 0.86, 0.95));
  vec3 G[7] = vec3[7](vec3(0.0), vec3(0.25, 0.1, 0.07), vec3(0.9, 0.32, 0.12),
                      vec3(1.8, 0.7, 0.25), vec3(1.6, 1.0, 0.5), vec3(1.2, 1.0, 0.75), vec3(0.9, 0.85, 0.75));
  float S[7] = float[7](1.0, 0.7, 0.15, 0.0, 0.0, 0.0, 0.0);
  e = clamp(e, E[0], E[6]);
  int i = 0;
  for (int k = 0; k < 6; k++) if (e > E[k + 1]) i = k + 1;
  i = min(i, 5);
  float u = smoothstep(0.0, 1.0, (e - E[i]) / (E[i + 1] - E[i]));
  return SkyTone(mix(Z[i], Z[i + 1], u), mix(M[i], M[i + 1], u), mix(H[i], H[i + 1], u), mix(G[i], G[i + 1], u), mix(S[i], S[i + 1], u));
}

// The sky at p. The horizon band is warmest and brightest on the sun's side; the glow is the
// light scattered forwards around the sun, wider and redder when it is low.
vec3 paintSky(vec2 p, float hy, vec2 sun, float e) {
  SkyTone s = skyTone(e);
  float h = p.y - hy;
  float side = exp(-abs(p.x - sun.x) * 0.8);
  vec3 hor = s.horizon * (0.62 + 0.5 * side);
  vec3 col = mix(hor, s.mid * (0.8 + 0.3 * side), smoothstep(0.0, 0.17, h));
  col = mix(col, s.zenith, smoothstep(0.1, 0.62, h));
  float d = length((p - sun) * vec2(1.0, 1.3));
  float low = 1.0 - smoothstep(2.0, 25.0, e);
  col += s.glow * (0.25 * exp(-d * 2.4) + 0.5 * exp(-d * (9.0 - 4.0 * low)) + 0.8 * exp(-d * 35.0));
  return max(col, 0.0);
}

// The colour of the air near the horizon at x: what distant silhouettes fade into.
vec3 airAt(float x, float hy, vec2 sun, float e) { return paintSky(vec2(x, hy + 0.015), hy, sun, e); }

// The sun's disc (radius r), white at midday and orange-red near the horizon, very bright so it
// blooms. Draw it over the sky, under everything else.
vec3 sunDisc(vec2 p, vec2 sun, float r, float e) {
  float d = length(p - sun);
  float disc = 1.0 - smoothstep(r * 0.92, r * 1.04, d);
  float limb = 0.75 + 0.25 * sqrt(max(1.0 - d * d / (r * r), 0.0));
  vec3 c = mix(vec3(1.0, 0.45, 0.14), vec3(1.0, 0.93, 0.82), smoothstep(-1.0, 12.0, e));
  return c * disc * limb * 22.0 * smoothstep(-1.2, 0.2, e);
}

// Stars fading in as the sky darkens (amount from skyTone().stars).
vec3 nightStars(vec2 p, float px, float t, float seed, float amount) {
  if (amount <= 0.001) return vec3(0.0);
  return starField(p, px, t, seed, amount);
}

// ---------------------------------------------------------------- silhouettes
// Coverage of a shape with signed distance d, anti-aliased over `aa` (one pixel, or several for
// a soft, out-of-focus edge).
float cover(float d, float aa) { return 1.0 - smoothstep(-aa, aa, d); }

// Lay colour c over col where d < 0.
void fill(inout vec3 col, float d, float aa, vec3 c) { col = mix(col, c, cover(d, aa)); }

// A silhouette's colour at depth `fog` (0 near, 1 lost in the haze): dark ink fading into the air.
vec3 inkIn(vec3 air, float fog, vec3 ink) { return mix(ink, air, fog); }

// Light wrapping round the edge of a dark shape from a bright source behind it: the outward
// gradient g of its distance field, the direction l to the light, the width of the rim.
float rimLight(float d, vec2 g, vec2 l, float width) {
  float facing = max(dot(g / max(length(g), 1e-6), l), 0.0);
  return exp(-abs(d) / width) * facing * step(d, width);
}

// ---------------------------------------------------------------- clouds, mist, smoke
// A bank of streaky cloud lit by the sun: premultiplied colour and coverage. y0 is the middle of
// the bank, `thick` half its depth, `coverAmt` how much of it is cloud (0..1).
vec4 stratus(vec2 p, vec2 sun, float e, float hy, float y0, float thick, float coverAmt, float t, float seed) {
  float v = (p.y - y0) / thick;
  if (abs(v) > 1.5) return vec4(0.0);
  vec2 q = vec2(p.x * 1.3 + t * 0.008 + seed * 7.3, p.y * 6.5 + seed * 1.7);
  float n = fbm(q, 5);
  float window = smoothstep(1.5, 0.3, abs(v));
  float dens = smoothstep(0.72 - 0.3 * coverAmt, 0.9 - 0.25 * coverAmt, n * (0.75 + 0.35 * window)) * window;
  // Lit on the side facing the sun (compare with the noise a little way towards it), and far more
  // brightly close to the sun; shadowed parts take the colour of the sky above.
  vec2 toSun = normalize(sun - p + vec2(1e-4));
  float n2 = fbm(q + toSun * vec2(0.05, 0.12), 4);
  float lit = saturate(0.5 + (n - n2) * 5.0);
  SkyTone s = skyTone(e);
  float near = exp(-length((p - sun) * vec2(0.8, 1.5)) * 2.0);
  vec3 bright = s.glow * (0.4 + 1.2 * near) + s.horizon * 0.3;
  vec3 shade = mix(s.mid, s.zenith, 0.4) * 0.8;
  vec3 c = mix(shade, bright, lit * (0.5 + 0.5 * smoothstep(-0.5, 0.5, -v)));
  return vec4(c * dens, dens);
}

// A band of mist lying at height y0 (density 0..1).
float mistBand(vec2 p, float y0, float thick, float t, float seed) {
  float v = (p.y - y0) / thick;
  float n = fbm(vec2(p.x * 2.2 - t * 0.03 + seed, p.y * 9.0 + seed * 3.1), 4);
  return exp(-v * v) * smoothstep(0.25, 0.75, n);
}

// A column of smoke from `base`, drifting with `wind` (screen units per unit of rise), widening
// as it rises. Returns its density (0..1); `h` receives the height up the column (0..1).
float smokeColumn(vec2 p, vec2 base, float wind, float height, float width, float t, float seed, out float h) {
  float rise = p.y - base.y;
  h = clamp(rise / height, 0.0, 1.0);
  if (rise < -0.01 || rise > height * 1.2) return 0.0;
  float cx = base.x + wind * rise + 0.02 * sin(rise * 9.0 - t * 1.3 + seed);
  float w = width * (0.35 + 1.6 * h);
  float x = (p.x - cx) / w;
  float n = fbm(vec2(p.x * 12.0 - t * 0.4 * sign(wind + 1e-4), rise * 10.0 - t * 1.1) + seed, 4);
  float body = exp(-x * x * 2.2) * smoothstep(-0.01, 0.03, rise) * (1.0 - smoothstep(0.6, 1.2, h));
  return saturate(body * (0.55 + 0.9 * n) - 0.12);
}
