// Life, 3.8 billion years ago: a field of hydrothermal vents on the floor of the first ocean.
// Spires of mineral stand on mounds of pillow lava, pouring black smoke that the glow of their
// own mouths lights from below; the only other light is what that glow scatters into the water.
// Painted like the film's other life scenes: layers back to front that fade into the murk, each
// moved by parallax as the camera drifts in (uPan, uPush).
#include <illustration>
#include <sdf>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uT;
uniform float uPan, uPush;

const vec3 INK = vec3(0.0035, 0.005, 0.007);
const vec3 GLOW = vec3(1.0, 0.4, 0.11);
const vec3 DEEP = vec3(0.0015, 0.01, 0.019);
const vec3 MURK = vec3(0.008, 0.042, 0.066);

// The water at p: darkest on the floor, and warmed a little round the vent field.
vec3 water(vec2 p) {
  vec3 c = mix(DEEP, MURK, smoothstep(-0.45, 0.45, p.y));
  float d = length((p - vec2(-0.2, -0.05)) * vec2(1.0, 1.25));
  return c + GLOW * 0.022 * exp(-d * 3.2) + vec3(0.0, 0.012, 0.02) * exp(-d * 1.4);
}

// A chimney: a ragged spire of stacked mineral from the mound at y0 up to its mouth at y1.
// Each flank weathers on its own, with ledges where hot fluid pooled and froze, so no two
// spires (and no two sides of one) match.
float chimneyX(float y, float x0, float h, float seed) {
  return x0 + 0.013 * gnoise(vec2(y * 8.0, seed)) + 0.035 * h * h * (hash11(seed) - 0.5);
}
float sdChimney(vec2 p, float x0, float y0, float y1, float w0, float w1, float seed) {
  float h = saturate((p.y - y0) / (y1 - y0));
  float cx = chimneyX(p.y, x0, h, seed);
  float side = p.x > cx ? 1.0 : 0.0;
  float w = mix(w0, w1, pow(h, 0.7));
  float rough = 0.3 * gnoise(vec2(p.y * 19.0, seed + 3.0 + side * 7.0)) + 0.17 * gnoise(vec2(p.y * 47.0, seed + 5.0 + side * 11.0))
              + 0.08 * gnoise(vec2(p.y * 110.0, seed + side * 5.0));
  float ledge = smoothstep(0.6, 0.9, vnoise(vec2(p.y * 14.0, seed * 2.0 + side * 31.0)));
  w *= 1.0 + rough + 0.55 * ledge;
  float d = abs(p.x - cx) - w;
  return max(d, p.y - y1 - 0.006 * gnoise(vec2(p.x * 70.0, seed)) - 0.012 * (side - 0.5) * (hash11(seed + 2.0) - 0.5));
}
// Where chimney `seed` vents: the top of its spire.
vec2 mouthOf(float x0, float y1, float seed) { return vec2(chimneyX(y1, x0, 1.0, seed), y1); }

// Smoke from a mouth at m, bent by a slow current: its density (0..1) and the height h above
// the mouth. It billows by reading warped noise that rises with time.
float plume(vec2 p, vec2 m, float spread, float seed, out float h) {
  vec2 s = p - m;
  h = max(s.y, 0.0);
  if (s.y < -0.012) return 0.0;
  float cx = 0.16 * pow(h, 1.7) + 0.011 * sin(h * 15.0 - uGTime * 0.9 + seed);
  float w = 0.009 + spread * pow(h, 0.92);
  float x = (s.x - cx) / w;
  vec2 q = vec2(s.x * 7.5, (s.y - uGTime * 0.1) * 7.5) + seed * 3.7;
  float n = fbm(q + 1.25 * vec2(fbm(q * 1.6 + 3.0, 3), fbm(q * 1.6 + 7.0, 3)), 5);
  float body = exp(-x * x * 1.5) * smoothstep(-0.008, 0.014, s.y);
  return saturate(body * (0.4 + 1.5 * n) - 0.17) * exp(-h * 0.75);
}

// Lay a plume over col: black smoke, underlit near the mouth and catching a little of the
// water's light on its billows higher up.
void smoke(inout vec3 col, vec2 p, vec2 m, float spread, float seed, float fog, float amount) {
  float h;
  float d = plume(p, m, spread, seed, h) * amount;
  if (d <= 0.001) return;
  vec2 q = vec2((p.x - m.x) * 7.5, (p.y - m.y - uGTime * 0.1) * 7.5) + seed * 3.7;
  float billow = fbm(q * 2.3 + 11.0, 4);
  vec3 c = mix(vec3(0.006, 0.008, 0.01), vec3(0.03, 0.045, 0.055), smoothstep(0.35, 0.75, billow));
  c += GLOW * (0.5 * exp(-h * 22.0) + 0.17 * exp(-h * 5.0)) * (0.35 + 1.0 * billow);
  col = mix(col, mix(c, water(p), fog), saturate(d * 1.25));
}

void main() {
  vec2 p0 = centered(vUv, uAspect) * (1.0 - 0.06 * uPush) + vec2(0.0, 0.012 * uPush);
  float px = 1.0 / uRes.y;
  float fl = 0.85 + 0.1 * sin(uGTime * 5.3) * sin(uGTime * 3.1) + 0.06 * sin(uGTime * 11.0);
  vec3 col = water(p0);

  // ---- far: other vents, almost lost, each a dim ember under its own smoke.
  vec2 pf = p0 + vec2(uPan * 0.15, 0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = i == 0 ? 0.52 : i == 1 ? 0.78 : -0.78;
    float top = i == 0 ? -0.07 : i == 1 ? -0.14 : -0.1;
    float d = sdChimney(pf, x, -0.3, top, 0.035, 0.012, 20.0 + fi * 4.0);
    vec2 m = mouthOf(x, top, 20.0 + fi * 4.0);
    smoke(col, pf, m, 0.16, 30.0 + fi, 0.8, 0.55);
    fill(col, d, px * 2.0, inkIn(water(pf), 0.8, INK));
    col += GLOW * 0.035 * exp(-length(pf - m) / 0.012) * fl;
  }
  float ridge = -0.27 + 0.03 * fbm(vec2(pf.x * 2.6 + 4.0, 1.0), 4);
  fill(col, pf.y - ridge, px * 2.0, inkIn(water(pf), 0.78, INK));

  // ---- middle: the vent field. Four spires on a mound; smoke first, so it rises behind them.
  vec2 pm = p0 + vec2(uPan * 0.6, 0.0);
  const int NC = 4;
  float X[NC] = float[NC](-0.36, -0.235, -0.13, -0.02);
  float TOP[NC] = float[NC](-0.03, 0.105, 0.015, -0.085);
  float W0[NC] = float[NC](0.05, 0.062, 0.05, 0.04);
  float W1[NC] = float[NC](0.016, 0.02, 0.015, 0.013);
  for (int i = 0; i < NC; i++) {
    vec2 m = mouthOf(X[i], TOP[i], float(i) * 2.3 + 1.0);
    smoke(col, pm, m + vec2(0.0, -0.004), 0.2 + 0.035 * float(i), float(i) * 5.0 + 2.0, 0.12, 1.0);
  }
  float mound = -0.24 + 0.05 * exp(-pow((pm.x + 0.19) / 0.3, 2.0)) + 0.016 * gnoise(vec2(pm.x * 7.0, 2.0)) + 0.006 * gnoise(vec2(pm.x * 23.0, 5.0));
  float dField = pm.y - mound;
  int nearest = 0;
  float dMouth = 1e9;
  for (int i = 0; i < NC; i++) {
    dField = min(dField, sdChimney(pm, X[i], -0.3, TOP[i], W0[i], W1[i], float(i) * 2.3 + 1.0));
    // A younger spire growing against its flank.
    float sgn = (i % 2 == 0) ? 1.0 : -1.0;
    dField = min(dField, sdChimney(pm, X[i] + sgn * (W0[i] * 0.85), -0.3, mix(-0.25, TOP[i], 0.42 + 0.12 * float(i % 3)), W0[i] * 0.55, W1[i] * 0.7, float(i) * 2.3 + 51.0));
    float dm = length(pm - mouthOf(X[i], TOP[i], float(i) * 2.3 + 1.0));
    if (dm < dMouth) { dMouth = dm; nearest = i; }
  }
  if (dField < 0.01) {
    vec2 m = mouthOf(X[nearest], TOP[nearest], float(nearest) * 2.3 + 1.0);
    // The rock: black sulphide, crusted and pitted, glowing in cracks near the hot mouths and
    // edged with the light of the vent it faces.
    vec3 rock = INK * (1.0 + 2.5 * fbm(pm * vec2(55.0, 30.0), 4));
    float crack = pow(1.0 - abs(gnoise(pm * 70.0 + 3.0)), 26.0) * smoothstep(0.45, 0.7, vnoise(pm * 21.0));
    rock += GLOW * crack * 0.8 * exp(-dMouth * 24.0) * fl;
    rock += GLOW * 0.5 * fl * exp(-max(-dField, 0.0) / 0.0035) * exp(-dMouth * 7.5) * smoothstep(-0.02, 0.05, m.y - pm.y + 0.02);
    rock += vec3(0.004, 0.011, 0.015) * exp(-max(-dField, 0.0) / 0.006);
    col = mix(col, mix(rock, water(pm), 0.1), cover(dField, px));
  }
  // The mouths themselves: fluid at four hundred degrees, glowing, and the water lit round it.
  for (int i = 0; i < NC; i++) {
    vec2 m = mouthOf(X[i], TOP[i], float(i) * 2.3 + 1.0);
    // (An ember across the lip, not a flame standing on it.)
    float r = length(pm - m - vec2(0.0, 0.004));
    float lip = length((pm - m - vec2(0.0, 0.002)) * vec2(0.75, 2.4));
    col += GLOW * fl * (0.6 * exp(-lip / 0.006) + 0.13 * exp(-r / 0.03) + 0.03 * exp(-r / 0.14));
  }

  // ---- particles: marine snow sinking everywhere, flecks of mineral carried up in the plumes.
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float sc = 34.0 + 22.0 * fk;
    vec2 g = (p0 + vec2(uPan * (0.3 + 0.5 * fk), 0.0)) * sc + vec2(uGTime * 0.05 * (fk - 1.0), uGTime * (0.1 + 0.05 * fk));
    vec2 cell = floor(g);
    vec3 hh = hash32(cell + fk * 19.0);
    if (hh.z > 0.82) {
      vec2 dq = fract(g) - (0.2 + 0.6 * hh.xy);
      float tw = 0.55 + 0.45 * sin(uGTime * (1.0 + 2.0 * hh.x) + hh.y * 30.0);
      float nearVent = exp(-length(p0 - vec2(-0.2, 0.0)) * 3.0);
      vec3 c = mix(vec3(0.25, 0.55, 0.7), GLOW * 1.4, nearVent);
      col += c * exp(-dot(dq, dq) / (0.0035 + 0.003 * fk)) * tw * (0.045 + 0.14 * nearVent) * (0.5 + 0.5 * fk);
    }
  }

  // ---- near: pillow lava in front of the lens, out of focus.
  vec2 pn = p0 + vec2(uPan * 1.6, 0.0);
  float rocks = pn.y - (-0.36 + 0.05 * gnoise(vec2(pn.x * 2.4, 9.0)) + 0.02 * gnoise(vec2(pn.x * 7.0, 3.0)));
  rocks = min(rocks, sdEllipse(pn - vec2(-0.82, -0.36), vec2(0.2, 0.11)));
  rocks = min(rocks, sdEllipse(pn - vec2(0.95, -0.4), vec2(0.24, 0.1)));
  col = mix(col, INK * 0.6, cover(rocks, px * 7.0));
  fragColor = vec4(col, 1.0);
}
