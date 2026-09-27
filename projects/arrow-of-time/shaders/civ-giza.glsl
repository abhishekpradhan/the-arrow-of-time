// The Pyramids, 2500 BCE: Giza under a high sun. Khufu, Khafre and Menkaure stand in their casing
// of polished white Tura limestone, each with a blazing face turned to the sun and a cool face in
// shadow, the queens' pyramids beside them. In front, on the bright plateau, a gang hauls a block
// on a wooden sledge while a man pours water on the sand before its runners and an overseer walks
// beside them with his staff. Heat shimmers over the horizon.
#include <arrow-of-time/civ-common>

const float HY = -0.06;
const vec3 INK = vec3(0.05, 0.035, 0.025);
const vec3 LIME = vec3(0.97, 0.93, 0.84);
const vec3 SAND = vec3(0.9, 0.62, 0.36);

vec3 sunLight() { return vec3(1.0, 0.93, 0.8) * 2.3; }
vec3 skyLight() { return vec3(0.24, 0.32, 0.5); }

// A pyramid seen a little off its diagonal: base half width w, height h, centred at x0 on the
// ground y0; the ridge down its near corner lies `turn` of the way to the right. Returns coverage
// and the face colour (lit on the right, shadowed on the left).
float pyramid(vec2 q, float x0, float y0, float w, float h, float turn, out vec3 c) {
  vec2 apex = vec2(x0, y0 + h), bl = vec2(x0 - w, y0), br = vec2(x0 + w, y0), ridge = vec2(x0 + turn * w, y0);
  float left = sdTriangle(q, bl, apex, ridge);
  float right = sdTriangle(q, ridge, apex, br);
  vec3 L = sunLight(), S = skyLight();
  vec3 bounce = SAND * 0.35;
  c = right < left ? LIME * (S * 0.5 + L * 0.95) : LIME * (S * 0.75 + bounce * 0.8);
  // Faint courses of the casing, visible only close to the edges where the light grazes.
  float courses = step(0.5, fract((q.y - y0) / h * 60.0));
  c *= 0.97 + 0.03 * courses;
  // The capstone catches the sun.
  c += vec3(1.0, 0.85, 0.55) * 3.0 * smoothstep(0.012, 0.0, length(q - apex + vec2(0.0, 0.006)));
  return cover(min(left, right), PX);
}

vec3 scene(vec2 p) {
  float e = uElev;
  // A deep desert sky, paler and dustier towards the horizon.
  vec3 col = paintSky(p, HY, uSun, e);
  col = mix(col, vec3(0.03, 0.11, 0.36), smoothstep(0.05, 0.4, p.y - HY) * 0.5);
  if (p.y > HY) {
    vec2 cq = vec2(p.x * 1.4 + uGTime * 0.01, (p.y - HY) * 9.0);
    float ci = smoothstep(0.6, 0.85, fbm(cq * vec2(1.0, 0.5) + fbm(cq * 2.0, 3), 5)) * smoothstep(0.15, 0.3, p.y - HY);
    col = mix(col, vec3(1.3, 1.25, 1.2), ci * 0.4);
  }
  vec3 dust = vec3(0.85, 0.72, 0.56);
  col = mix(col, dust, exp(-max(p.y - HY, 0.0) / 0.035) * 0.75);
  // Heat shimmer: everything near the horizon wavers.
  vec2 ps = p + vec2(0.0, 0.0012 * gnoise(vec2(p.x * 90.0, uGTime * 3.0)) * exp(-abs(p.y - HY) / 0.02));

  // ---- the pyramids, far out on the plateau, hazed a little.
  vec2 q = L(ps, 0.18);
  vec3 air = mix(airAt(q.x, HY, uSun, e), dust, 0.5);
  float ground = HY + 0.002;
  vec3 pc;
  float a;
  a = pyramid(q, -0.58, ground - 0.005, 0.32, 0.29, 0.25, pc);  col = mix(col, mix(pc, air, 0.3), a);   // Khufu
  a = pyramid(q, -0.02, ground - 0.002, 0.3, 0.27, 0.25, pc);    col = mix(col, mix(pc, air, 0.22), a);  // Khafre, on higher ground
  a = pyramid(q, 0.44, ground - 0.002, 0.13, 0.115, 0.3, pc);   col = mix(col, mix(pc, air, 0.15), a);  // Menkaure
  for (int i = 0; i < 3; i++) {
    a = pyramid(q, 0.64 + 0.075 * float(i), ground - 0.001, 0.032, 0.028, 0.3, pc);
    col = mix(col, mix(pc, air, 0.12), a);
  }
  // Khafre kept a cap of its casing longest: at the top it gleams a shade brighter.

  // ---- the plateau: bright sand in long ripples, dunes towards us.
  q = L(p, 0.6);
  float plat = HY - 0.012 + 0.006 * fbm(vec2(q.x * 4.0, 2.0), 3);
  if (q.y < plat) {
    float depth = plat - q.y;
    float rip = 0.5 + 0.5 * sin(q.y * 900.0 / (1.0 + depth * 30.0) + fbm(q * vec2(6.0, 30.0), 3) * 6.0);
    vec3 sand = SAND * (skyLight() * 0.4 + sunLight() * (0.5 + 0.07 * rip * smoothstep(0.0, 0.1, depth))) * (0.9 + 0.2 * fbm(q * vec2(3.0, 12.0), 4));
    sand = mix(sand, mix(airAt(q.x, HY, uSun, e), dust, 0.6), exp(-depth / 0.025) * 0.5);
    col = mix(col, sand, cover(q.y - plat, PX));
  }

  // ---- the gang hauling a block on a sledge, a man wetting the sand, the overseer.
  vec2 l = normalize(uSun - p);
  float gy = -0.19;
  float travel = 0.018 * uT;
  {
    // Short shadows of noon, cast down and to the left.
    float sh = 1e9;
    vec2 blockC = vec2(-0.05 + travel, gy);
    sh = min(sh, sdEllipse(q - blockC - vec2(-0.02, -0.006), vec2(0.075, 0.009)));
    for (int i = 0; i < 10; i++) sh = min(sh, sdEllipse(q - vec2(0.09 + 0.045 * float(i) + travel, gy) - vec2(-0.012, -0.004), vec2(0.018, 0.005)));
    col *= 1.0 - 0.35 * cover(sh, PX * 3.0);
    // The block on its sledge.
    float sledge = sdBox(q - blockC - vec2(0.0, 0.006), vec2(0.07, 0.006));
    sledge = min(sledge, sdTaper(q, blockC + vec2(0.065, 0.006), blockC + vec2(0.085, 0.02), 0.005, 0.004));
    float block = sdBox(q - blockC - vec2(0.0, 0.045), vec2(0.055, 0.034));
    vec3 bc = LIME * 0.85 * (skyLight() * 0.8 + sunLight() * (q.y - blockC.y > 0.075 ? 0.9 : 0.5));
    if (q.x - blockC.x > 0.035) bc = LIME * 0.85 * (skyLight() * 0.6 + sunLight() * 0.85);
    col = mix(col, INK * 2.0, cover(sledge, PX));
    col = mix(col, bc, cover(block, PX));
    // Ropes from the sledge to the haulers.
    vec2 r0 = blockC + vec2(0.08, 0.018);
    float rope = 1e9;
    // The haulers: two files leaning into the ropes.
    float men = 1e9;
    for (int i = 0; i < 10; i++) {
      float fi = float(i);
      float s = 0.1;
      vec2 base = vec2(0.1 + 0.045 * fi + travel, gy + 0.002 * mod(fi, 2.0));
      Pose f = haulPose(uGTime * 3.4 + fi * 0.7);
      men = min(men, sdFigure((q - base) / s, f, vec4(0.0, 0.9, 0.0, 0.0), 1.0) * s);
      vec2 grip = base + (f.neck + vec2(0.05, -0.05)) * s;
      rope = min(rope, sdSegment(q, r0, grip));
    }
    col = mix(col, INK * 2.5, cover(rope - 0.0009, PX));
    vec2 g = vec2(0.0);
    col = mix(col, INK + vec3(0.9, 0.62, 0.38) * 0.12, cover(men, PX));
    // The man pouring water on the sand in front of the runners.
    float s = 0.1;
    vec2 wb = blockC + vec2(0.1, 0.0);
    Pose w = reapPose(1.0);
    w.handN = w.neck + vec2(0.16, -0.08);
    w.handF = w.neck + vec2(0.12, 0.02);
    float wd = sdFigure((q - wb) / s * vec2(-1.0, 1.0), w, vec4(0.0, 0.9, 0.0, 0.0), 1.0) * s;
    vec2 jar = wb + vec2(-0.028, 0.06);
    wd = min(wd, sdEllipse(q - jar, vec2(0.011, 0.014)));
    col = mix(col, INK + vec3(0.9, 0.62, 0.38) * 0.12, cover(wd, PX));
    float pour = sdSegment(q, jar + vec2(-0.008, -0.01), jar + vec2(-0.016, -0.055)) - 0.0012;
    col = mix(col, vec3(0.8, 0.9, 1.0) * 1.5, cover(pour, PX) * 0.7);
    // The overseer beside them with his staff.
    vec2 ob = vec2(0.6 + travel * 0.9, gy - 0.045);
    float os = 0.115;
    Pose o = walkPose(uGTime * 3.0, 0.12);
    o.handF = o.neck + vec2(0.1, -0.12);
    float od = sdFigure((q - ob) / os, o, vec4(0.6, 0.0, 0.0, 0.0), 1.0) * os;
    od = min(od, sdSegment(q, ob + vec2(0.035, -0.003), ob + vec2(0.05, 0.13)) - 0.0014);
    col *= 1.0 - 0.35 * cover(sdEllipse(q - ob - vec2(-0.012, -0.004), vec2(0.02, 0.005)), PX * 3.0);
    col = mix(col, INK + vec3(0.9, 0.62, 0.38) * 0.12, cover(od, PX));
  }

  // ---- a crest of sand close by, its ripples in relief.
  q = L(p, 1.6);
  float crest = -0.33 + 0.04 * sin(q.x * 2.2 + 1.0) + 0.012 * fbm(vec2(q.x * 5.0, 7.0), 3);
  if (q.y < crest) {
    float depth = crest - q.y;
    float rip = sin(q.x * 70.0 + q.y * 20.0 + 3.0 * fbm(q * 8.0, 3));
    vec3 sand = SAND * (skyLight() * 0.4 + sunLight() * (0.45 + 0.08 * rip));
    sand *= 0.8 + 0.2 * smoothstep(0.0, 0.02, depth);
    col = mix(col, sand, soft(q.y - crest, 3.0));
  }
  return col;
}
