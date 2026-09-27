// Farming, 10,000 BCE: sunrise over a field of wild wheat in the foothills of the Fertile
// Crescent. The sun clears the hills through the morning mist; a woman reaps with a flint sickle,
// another carries a sheaf home on her head, a child and a dog run ahead; smoke rises from the
// round huts of the village on the rise, and birds get up off the field. The wheat is backlit:
// dark ears haloed by bristles that catch the light.
#include <arrow-of-time/civ-common>

const float HY = -0.066;
const vec3 INK = vec3(0.02, 0.013, 0.012);
const vec3 GOLD = vec3(1.0, 0.68, 0.3);

// How much light comes through the wheat: most in line with the sun.
float through(vec2 p) { return 0.05 + 1.7 * exp(-length((p - uSun) * vec2(0.75, 1.4)) * 2.8); }

// A band of wheat with its foot at y0 (layer coordinates q, picture position p). Returns its
// coverage; `glow` receives the light through it: rims round the ears and the bristles.
float field(vec2 q, vec2 p, float y0, float h, float gap, float row, float aa, out float glow) {
  float earD, awnD;
  float d = wheatRow(q - vec2(0.0, y0), gap, h, row, uGTime, earD, awnD);
  d = min(d, q.y - y0 - h * 0.35);
  float c = cover(d, aa);
  float rim = exp(-max(earD, 0.0) / (aa + 0.006 * h)) * (1.0 - 0.7 * cover(earD + aa, aa));
  float awn = cover(awnD - 0.0025 * h, aa);
  glow = through(p) * (0.45 * rim + 0.5 * awn * (1.0 - c));
  return c;
}

// A round hut of mud and reeds with a domed thatch roof.
float hut(vec2 p, float s) {
  vec2 q = p / s;
  float wall = sdBox(q - vec2(0.0, 0.3), vec2(0.5, 0.3));
  float roof = sdEllipse(q - vec2(0.0, 0.58), vec2(0.62, 0.42));
  roof = max(roof, 0.55 - q.y);
  float door = sdBox(q - vec2(0.18, 0.18), vec2(0.1, 0.18));
  return max(min(wall, roof), -door) * s;
}

// A sickle: a flint blade set in a curved haft, held at `hand` (world units; the reaper is 0.2 tall).
float sickle(vec2 p, vec2 hand, float ang) {
  vec2 q = rot2(-ang) * (p - hand);
  float haft = sdTaper(q, vec2(0.0), vec2(0.0, 0.022), 0.0035, 0.003);
  float blade = abs(length(q - vec2(0.018, 0.022)) - 0.018) - 0.0022;
  blade = max(blade, -(q.y - 0.022));
  return min(haft, blade);
}

// A sheaf of cut wheat bound in the middle, ears fanning out at one end (length s).
float sheaf(vec2 p, vec2 c, float s, float ang) {
  vec2 q = rot2(-ang) * (p - c) / s;
  float d = 1e9;
  for (int i = 0; i < 7; i++) {
    float a = -0.3 + 0.1 * float(i);
    vec2 dir = vec2(sin(a), cos(a));
    d = min(d, sdSegment(q, -dir * 0.45, dir * 0.35) - 0.018);
    d = min(d, sdEllipse(rot2(-a) * (q - dir * 0.43), vec2(0.035, 0.11)));
  }
  d = min(d, sdEllipse(q, vec2(0.08, 0.045)));
  return d * s;
}

vec3 scene(vec2 p) {
  float e = uElev;
  SkyTone st = skyTone(e);
  vec3 col = paintSky(p, HY, uSun, e);
  vec4 c1 = stratus(p, uSun, e, HY, HY + 0.25, 0.08, 0.6, uGTime, 1.0);
  col = col * (1.0 - c1.a) + c1.rgb;
  vec4 c2 = stratus(p, uSun, e, HY, HY + 0.1, 0.035, 0.45, uGTime, 4.0);
  col = col * (1.0 - c2.a) + c2.rgb;
  col += sunDisc(p, uSun, 0.034, e);
  // Birds getting up off the field and wheeling away over the sunrise.
  for (int i = 0; i < 11; i++) {
    float fi = float(i);
    vec3 h = hash31(fi * 3.7 + 1.0);
    float u = uT + 1.6 + h.x * 0.8;
    vec2 b = vec2(0.5 - 0.12 * u + 0.14 * h.y + 0.015 * sin(u * 1.3 + fi), -0.03 + 0.05 * u + 0.07 * h.z);
    float s = 0.011 + 0.004 * h.x;
    fill(col, sdBird((p - b) / s, uGTime * 11.0 + fi * 2.1) * s, PX, INK * 2.5);
  }

  // ---- far: the foothills, soft in the haze, the mist lying in the valley below them.
  vec2 q = L(p, 0.08);
  vec3 air = airAt(q.x, HY, uSun, e);
  float hills = HY + 0.012 + 0.022 * fbm(vec2(q.x * 1.3 + 3.0, 1.0), 4) + 0.02 * exp(-pow((q.x + 0.72) / 0.22, 2.0));
  fill(col, q.y - hills, PX, inkIn(air, 0.74, INK));
  col = mix(col, air * 1.08 + st.glow * 0.06, 0.75 * mistBand(q, HY + 0.0, 0.012, uGTime, 1.0));

  // ---- the village on a rise to the right: round huts, a hearth's smoke, a few oaks.
  q = L(p, 0.25);
  air = airAt(q.x, HY, uSun, e);
  float rise = HY - 0.008 + 0.028 * exp(-pow((q.x - 0.62) / 0.26, 2.0)) + 0.005 * fbm(vec2(q.x * 6.0, 2.0), 3);
  vec3 vink = inkIn(air, 0.52, INK);
  fill(col, q.y - rise, PX, vink);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float x = 0.46 + fi * 0.055 + 0.015 * sin(fi * 5.1);
    float y0 = HY - 0.008 + 0.028 * exp(-pow((x - 0.62) / 0.26, 2.0));
    fill(col, hut(q - vec2(x, y0 - 0.002), 0.02 + 0.006 * fract(fi * 0.71)), PX, vink);
  }
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = 0.3 + fi * 0.36;
    float y0 = HY - 0.008 + 0.028 * exp(-pow((x - 0.62) / 0.26, 2.0));
    vec2 tq = q - vec2(x, y0);
    float tree = min(sdTaper(tq, vec2(0.0), vec2(0.002, 0.03), 0.003, 0.002), sdEllipse(tq - vec2(0.0, 0.04), vec2(0.028, 0.019)) + 0.004 * gnoise(tq * 300.0));
    fill(col, tree, PX, vink);
  }
  {
    float hh;
    float sm = smokeColumn(q, vec2(0.57, HY + 0.028), 0.55, 0.12, 0.011, uGTime, 2.0, hh);
    vec3 smc = mix(air * 0.95, air * 1.15, 0.5 + 0.5 * hh);
    col = mix(col, smc, sm * 0.35 * (1.0 - hh));
  }

  // ---- the far side of the field.
  float glow;
  q = L(p, 0.5);
  air = airAt(q.x, HY, uSun, e);
  float a = field(q, p, HY - 0.024, 0.022, 0.0035, 1.0, PX, glow);
  col = mix(col, inkIn(air, 0.32, INK), a) + GOLD * glow * 0.45;

  // ---- mid-ground: the harvest.
  q = L(p, 1.0);
  air = airAt(q.x, HY, uSun, e);
  vec3 mink = inkIn(air, 0.12, INK);
  vec2 l = normalize(uSun - p);
  {
    // The reaper, bent to the stalks, facing the sun: a flint sickle, a sheaf at her hip.
    float s = 0.2;
    vec2 base = vec2(0.2, -0.19);
    Pose f = reapPose(uGTime * 2.6);
    vec4 dress = vec4(0.7, 0.0, 0.0, 2.0);
    vec2 fq = (q - base) / s;
    fq.x = -fq.x;
    float d = sdFigure(fq, f, dress, 1.0) * s;
    vec2 hand = base + vec2(-f.handN.x, f.handN.y) * s;
    d = min(d, sickle(q, hand, 2.3 + 0.4 * sin(uGTime * 2.6)));
    d = min(d, sheaf(q, base + vec2(0.03, 0.095), 0.065, -0.7));
    float e2 = 0.0015;
    vec2 fqx = (q + vec2(e2, 0.0) - base) / s, fqy = (q + vec2(0.0, e2) - base) / s;
    fqx.x = -fqx.x;
    fqy.x = -fqy.x;
    vec2 g = vec2(sdFigure(fqx, f, dress, 1.0) * s, sdFigure(fqy, f, dress, 1.0) * s) - sdFigure(fq, f, dress, 1.0) * s;
    col = mix(col, INK + GOLD * rimLight(d, g, l, 0.002) * through(p) * 2.2, cover(d, PX));
  }
  {
    // A woman walking home with a sheaf on her head.
    float s = 0.19;
    vec2 base = vec2(-0.52 + 0.055 * uT, -0.2);
    Pose f = carryPose(uGTime * 4.4, 0.16);
    float d = sdFigure((q - base) / s, f, vec4(0.8, 0.0, 0.0, 0.0), 1.0) * s;
    d = min(d, sheaf(q, base + (f.head + vec2(0.0, 0.085)) * s, 0.075, 1.5));
    col = mix(col, mink, cover(d, PX));
  }
  {
    // A child running ahead with a dog.
    float s = 0.11;
    vec2 base = vec2(-0.32 + 0.1 * uT, -0.205);
    fill(col, sdFigure((q - base) / s, runPose(uGTime * 8.0), vec4(0.0, 0.8, 0.0, 0.0), 0.9) * s, PX, mink);
    float sd = 0.05;
    fill(col, sdDog((q - vec2(-0.19 + 0.1 * uT, -0.205)) / sd, uGTime * 12.0) * sd, PX, mink);
  }
  a = field(q, p, -0.235, 0.06, 0.0065, 2.0, PX, glow);
  col = mix(col, inkIn(air, 0.05, INK), a) + GOLD * glow * 0.6;

  // ---- near: tall wheat in two uneven rows, haloed where the sun comes through it.
  q = L(p, 2.0);
  a = field(q, p, -0.42, 0.13, 0.018, 3.0, PX * 1.3, glow);
  col = mix(col, INK * 0.85, a) + GOLD * glow * 0.6;
  q = L(p, 2.5);
  a = field(q + vec2(0.37, 0.0), p, -0.47, 0.17, 0.027, 7.0, PX * 1.8, glow);
  col = mix(col, INK * 0.7, a) + GOLD * glow * 0.55;
  return col;
}
