// The age of mammals, 66 million years ago: the first clear dawn after the impact winter. The
// old forest stands dead in the mist, young conifers and ferns are coming up through it, birds
// (the dinosaurs that lived) cross the light, and on a fallen trunk a small mammal sits up to
// watch the Sun come back. Painted like the film's other life scenes: a sky with one light,
// then layers back to front that fade into the air, each moved by parallax (uPan).
#include <illustration>
#include <creatures>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uT;
uniform float uDawn, uPan, uElev;
uniform vec2 uSun;

const float HY = -0.115;                        // the horizon
const vec3 INK = vec3(0.012, 0.01, 0.012);

// The air the far layers fade into: the dawn sky's, under what is left of the ash.
vec3 ashAt(vec2 p) {
  vec3 a = mix(vec3(0.075, 0.066, 0.066), vec3(0.028, 0.028, 0.034), smoothstep(0.0, 0.5, p.y - HY));
  return a + vec3(0.17, 0.1, 0.065) * exp(-length((p - uSun) * vec2(1.0, 1.6)) * 3.2);
}
vec3 airOf(float x) {
  return mix(airAt(x, HY, uSun, uElev), ashAt(vec2(x, HY + 0.015)), 0.72 * (1.0 - uDawn));
}

// The tops of a distant conifer forest along a ridge: two rows of spires of uneven height.
float treeline(float x, float freq, float seed) {
  float c = floor(x * freq), f = fract(x * freq);
  float h = hash11(c + seed);
  float a = max(0.0, 1.0 - abs(f - 0.5) * (2.4 + 2.2 * h)) * (0.35 + 0.65 * h);
  float x2 = x * freq * 1.37 + 0.5;
  float c2 = floor(x2), f2 = fract(x2);
  float h2 = hash11(c2 + seed + 17.0);
  float b = max(0.0, 1.0 - abs(f2 - 0.5) * (2.8 + 2.0 * h2)) * (0.25 + 0.75 * h2);
  return max(a, b);
}

// A dead tree left standing: a tapering trunk snapped off at the top, with a few broken limbs.
float sdSnag(vec2 p, float s, float seed) {
  if (abs(p.x) > 0.7 * s || p.y > 2.5 * s || p.y < -0.05) return 1.0;
  float lean = (hash11(seed) - 0.5) * 0.3;
  float tall = 1.5 + 0.7 * hash11(seed + 3.0);
  vec2 top = vec2(lean, tall) * s;
  float d = sdTaper(p, vec2(0.0), top, 0.075 * s, 0.03 * s);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float h = hash11(seed + fi * 5.1 + 1.0);
    float y = 0.55 + 0.42 * fi + 0.2 * h;
    if (y > tall - 0.1) continue;
    vec2 a = vec2(lean * y / tall, y) * s;
    float side = (i % 2 == 0) ? 1.0 : -1.0;
    if (hash11(seed + 9.0) > 0.5) side = -side;
    vec2 b = a + vec2(side * (0.2 + 0.22 * h), 0.14 + 0.14 * h) * s;
    d = min(d, sdTaper(p, a, b, 0.03 * s, 0.008 * s));
  }
  return d;
}

// The fallen trunk across the foreground, with the stubs of two limbs.
float sdLog(vec2 p) {
  float d = sdBezierTaper(p, vec2(1.08, -0.262), vec2(0.62, -0.165), vec2(0.15, -0.055), 0.036, 0.012);
  d = min(d, sdBezierTaper(p, vec2(0.62, -0.15), vec2(0.585, -0.05), vec2(0.535, 0.012), 0.013, 0.004));
  d = min(d, sdTaper(p, vec2(0.83, -0.2), vec2(0.885, -0.118), 0.013, 0.005));
  d = min(d, sdTaper(p, vec2(0.16, -0.057), vec2(0.118, -0.03), 0.01, 0.003));
  // Bark.
  return d + 0.0022 * gnoise(p * vec2(70.0, 45.0)) + 0.0012 * gnoise(p * 160.0);
}

// The mammal, sitting on the trunk and facing the Sun.
const vec2 PERCH = vec2(0.385, -0.0915);
const float MSIZE = 0.108;
float sdPerched(vec2 p) {
  vec2 q = (p - PERCH) / MSIZE;
  q.x = -q.x;
  return sdMammal(q, uGTime) * MSIZE;
}

void main() {
  vec2 p0 = centered(vUv, uAspect);
  float px = 1.0 / uRes.y;
  vec2 sun = uSun;
  SkyTone st = skyTone(uElev);
  float pall = 1.0 - uDawn;

  // ---- the sky: a clear dawn coming up under a pall of ash that thins as the light returns.
  vec3 col = mix(paintSky(p0, HY, sun, uElev), ashAt(p0), 0.72 * pall);
  col += sunDisc(p0, sun, 0.034, max(uElev, 1.0)) * (0.12 + 0.5 * uDawn) * smoothstep(-0.03, 0.02, sun.y - HY);
  // Broken cloud, lit from below on the Sun's side, thinner towards the caption's corner.
  {
    float calm = 1.0 - 0.55 * smoothstep(0.1, 0.8, p0.x);
    vec4 a = stratus(p0, sun, uElev, HY, HY + 0.2, 0.085, 0.55, uGTime, 3.0);
    vec4 b = stratus(p0, sun, uElev, HY, HY + 0.36, 0.075, 0.42, uGTime, 9.0);
    float lit = 0.3 + 0.7 * uDawn;
    col = mix(col, a.rgb / max(a.a, 1e-3) * lit + ashAt(p0) * 0.6 * pall, a.a * 0.75 * calm);
    col = mix(col, b.rgb / max(b.a, 1e-3) * lit + ashAt(p0) * 0.6 * pall, b.a * 0.6 * calm);
  }
  // Birds crossing the light.
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec3 h = hash31(fi * 3.7 + 1.0);
    vec2 c = vec2(-0.86 + 0.026 * uT + 0.07 * fi + 0.035 * h.x, HY + 0.19 + 0.05 * h.y - 0.012 * abs(fi - 2.5));
    float s = 0.009 + 0.004 * h.z;
    vec2 q = (p0 - c) / s;
    float flap = sin(uGTime * 6.5 + fi * 2.1 + h.x * 3.0);
    float lift = 0.15 + 0.5 * flap;
    float d = min(sdBezierTaper(q, vec2(0.0), vec2(-0.5, lift * 0.9), vec2(-1.0, lift * 0.4), 0.13, 0.025),
                  sdBezierTaper(q, vec2(0.0), vec2(0.5, lift * 0.9), vec2(1.0, lift * 0.4), 0.13, 0.025));
    d = min(d, sdEllipse(q, vec2(0.2, 0.09))) * s;
    fill(col, d, px, inkIn(airOf(c.x), 0.4, INK));
  }

  // ---- far: two forested ridges, lost in the haze, with mist lying between them.
  vec2 pf = p0 + vec2(uPan * 0.1, 0.0);
  vec3 air = airOf(pf.x);
  float ridge1 = HY + 0.02 + 0.04 * fbm(vec2(pf.x * 1.5 + 3.0, 1.0), 4) + 0.011 * treeline(pf.x, 47.0, 1.0);
  fill(col, pf.y - ridge1, px, inkIn(air, 0.76, INK));
  col = mix(col, air * 1.05, 0.55 * mistBand(pf, HY + 0.008, 0.02, uGTime, 1.0));
  vec2 pm1 = p0 + vec2(uPan * 0.24, 0.0);
  air = airOf(pm1.x);
  float ridge2 = HY - 0.02 + 0.034 * fbm(vec2(pm1.x * 2.1 + 9.0, 2.0), 4) + 0.021 * treeline(pm1.x, 25.0, 5.0);
  fill(col, pm1.y - ridge2, px, inkIn(air, 0.55, INK));
  col = mix(col, air * 1.08, 0.6 * mistBand(pm1, HY - 0.03, 0.022, uGTime, 4.0));

  // ---- middle: the old forest standing dead, and the new one coming up under it.
  vec2 pm = p0 + vec2(uPan * 0.55, 0.0);
  air = airOf(pm.x);
  float gm = HY - 0.075 + 0.012 * fbm(vec2(pm.x * 3.0, 5.0), 3);
  for (int i = 0; i < 22; i++) {
    float fi = float(i);
    vec3 h = hash31(fi * 7.3 + 4.0);
    // A back row, smaller and paler, then a front row.
    bool back = i < 10;
    float n = back ? 10.0 : 12.0, k = back ? fi : fi - 10.0;
    float x = -1.05 + 2.15 * (k + 0.2 + 0.6 * h.x) / n;
    // Keep a window open for the Sun.
    if (abs(x - sun.x) < (back ? 0.05 : 0.085)) continue;
    float y = gm - (back ? -0.004 : 0.006 + 0.014 * h.y);
    float fog = back ? 0.5 : 0.36 - 0.14 * h.y;
    float sc = back ? 0.62 : 1.0;
    float d;
    if (h.z < 0.42) d = sdSnag(pm - vec2(x, y), (0.055 + 0.065 * h.y) * sc, fi * 3.1);
    else d = sdConifer(pm - vec2(x, y), (0.03 + 0.045 * h.y * h.y) * sc);
    fill(col, d, px, inkIn(air, fog, INK));
  }
  {
    float depthK = smoothstep(gm, gm - 0.09, pm.y);
    vec3 g = inkIn(air, mix(0.3, 0.1, depthK), INK) * (0.9 + 0.2 * fbm(vec2(pm.x * 16.0, pm.y * 70.0), 3));
    fill(col, pm.y - gm, px, g);
  }
  // Ground mist, glowing where the Sun is behind it.
  {
    float m = mistBand(pm, gm + 0.012, 0.026, uGTime, 7.0);
    float near = exp(-abs(pm.x - sun.x) * 1.4);
    col = mix(col, air * 1.1 + st.glow * 0.1 * near * uDawn, m * (0.35 + 0.3 * near));
  }

  // ---- near: the ground, the fallen trunk, the mammal, ferns.
  vec2 pn = p0 + vec2(uPan * 1.0, 0.0);
  air = airOf(pn.x);
  vec2 toSun = normalize(sun - pn + vec2(uPan, 0.0));
  vec3 warm = st.glow * (0.25 + 0.75 * uDawn);
  float ground = -0.287 + 0.02 * gnoise(vec2(pn.x * 2.2, 3.0)) + 0.005 * gnoise(vec2(pn.x * 11.0, 8.0));
  if (pn.y < ground + 0.003) {
    // Dark earth, with the low light raking its top edge.
    vec3 g = inkIn(air, 0.045, INK) + warm * 0.05 * exp(-(ground - pn.y) / 0.005) * exp(-abs(pn.x - sun.x) * 0.9);
    col = mix(col, g, cover(pn.y - ground, px));
  }
  // Ferns unrolling along the ground.
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    vec3 h = hash31(fi * 11.3 + 2.0);
    float x = i < 4 ? -0.95 + 0.2 * fi + 0.08 * h.x : -0.05 + 0.12 * (fi - 4.0) + 0.05 * h.x;
    float s = 0.075 + 0.06 * h.y;
    vec2 base = vec2(x, -0.287 + 0.02 * gnoise(vec2(x * 2.2, 3.0)) - 0.004);
    float d = sdFern(pn - base, uGTime, fi * 1.7, s);
    vec2 e2 = vec2(0.002, 0.0);
    vec2 g = vec2(sdFern(pn + e2.xy - base, uGTime, fi * 1.7, s) - d, sdFern(pn + e2.yx - base, uGTime, fi * 1.7, s) - d);
    vec3 c = inkIn(air, 0.03, INK) + warm * 0.22 * rimLight(d, g, toSun, 0.0012);
    col = mix(col, c, cover(d, px));
  }
  // The trunk: its upper edge catches the Sun.
  {
    float d = sdLog(pn);
    if (d < 0.01) {
      vec2 e2 = vec2(0.002, 0.0);
      vec2 g = vec2(sdLog(pn + e2.xy) - d, sdLog(pn + e2.yx) - d);
      vec3 c = inkIn(air, 0.02, INK) * (1.0 + 0.3 * fbm(pn * vec2(60.0, 30.0), 3));
      c += warm * 0.7 * rimLight(d, g, toSun, 0.0026);
      col = mix(col, c, cover(d, px));
    }
  }
  // The mammal: a warm line of lit fur along its back and face.
  {
    float d = sdPerched(pn);
    if (d < 0.01) {
      vec2 e2 = vec2(0.0015, 0.0);
      vec2 g = vec2(sdPerched(pn + e2.xy) - d, sdPerched(pn + e2.yx) - d);
      vec3 c = INK + warm * 1.0 * rimLight(d, g, toSun, 0.002);
      col = mix(col, c, cover(d, px));
    }
  }
  // Motes drifting in the light.
  for (int i = 0; i < 18; i++) {
    float fi = float(i);
    vec3 h = hash31(fi * 17.7 + 5.0);
    vec2 c = vec2(-0.9 + 1.3 * h.x + 0.02 * sin(uGTime * 0.5 + fi), -0.26 + 0.34 * h.y + 0.012 * sin(uGTime * 0.37 + fi * 2.0) + 0.004 * uT);
    float tw = 0.5 + 0.5 * sin(uGTime * (0.8 + h.z) + fi * 3.0);
    col += warm * 0.5 * exp(-length(pn - c) / (px * 1.5)) * tw * exp(-abs(c.x - sun.x) * 1.6);
  }
  // ---- foreground: leaves close to the lens, out of focus.
  vec2 pg = p0 + vec2(uPan * 2.4, 0.0);
  float blur = px * 9.0;
  float fg = sdFern(pg - vec2(-0.86, -0.47), uGTime, 0.7, 0.2);
  fg = min(fg, sdFern(pg - vec2(0.2, -0.5), uGTime, 2.9, 0.15));
  fg = min(fg, sdFern(pg - vec2(0.97, -0.5), uGTime, 4.4, 0.19));
  col = mix(col, INK * 0.5, cover(fg - 0.004, blur));
  fragColor = vec4(col, 1.0);
}
