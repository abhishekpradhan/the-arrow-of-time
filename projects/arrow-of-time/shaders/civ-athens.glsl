// Philosophy, 500 BCE: late afternoon above the Aegean. The sun hangs low over the sea, laying a
// road of glitter across the water; on the Acropolis a Doric temple takes the light on its
// columns, cypresses and olives on the rock below it. On a terrace above the shore, men in
// himations talk: one speaks, one leans on his staff and listens, one sits on the step. They are
// dark against the sea's glare, edged with gold.
#include <arrow-of-time/civ-common>

const float HY = -0.03;
const vec3 INK = vec3(0.03, 0.018, 0.014);
const vec3 MARBLE = vec3(0.92, 0.84, 0.72);
const vec3 ROCK = vec3(0.55, 0.42, 0.32);

vec3 sunLight() { return vec3(1.0, 0.66, 0.34) * 2.2; }
vec3 skyLight() { return vec3(0.16, 0.15, 0.24); }

// The Doric temple on the rock (layer coordinates, scale s, its stylobate's left end at o).
// Lit from the right: columns shaded round, the pediment's face in the sun. Returns coverage.
float temple(vec2 q, vec2 o, float s, out vec3 c) {
  vec2 r = (q - o) / s;
  vec3 L = sunLight(), S = skyLight();
  float steps = sdBox(r - vec2(0.5, 0.02), vec2(0.52, 0.02));
  steps = min(steps, sdBox(r - vec2(0.5, 0.05), vec2(0.5, 0.012)));
  // Columns: eight, with gaps; each shaded as a cylinder lit from the right.
  float colW = 0.035;
  float cx = (floor(r.x / 0.13 + 0.5)) * 0.13;
  cx = clamp(cx, 0.04, 0.96);
  float column = max(abs(r.x - cx) - colW * (1.0 - 0.15 * clamp((r.y - 0.06) / 0.3, 0.0, 1.0)), max(0.06 - r.y, r.y - 0.36));
  float ent = sdBox(r - vec2(0.5, 0.39), vec2(0.5, 0.03));
  float frieze = sdBox(r - vec2(0.5, 0.435), vec2(0.5, 0.017));
  float roof = sdTriangle(r, vec2(-0.01, 0.45), vec2(1.01, 0.45), vec2(0.5, 0.52));
  float d = min(min(steps, column), min(min(ent, frieze), roof));
  float u = clamp((r.x - cx) / colW, -1.0, 1.0);
  float lit = smoothstep(-0.2, 0.8, u);
  c = MARBLE * (S + L * 0.18);
  if (column <= d + 1e-5) c = MARBLE * (S + L * (0.12 + 0.75 * lit)) * (0.94 + 0.06 * step(0.5, fract(u * 3.0 + 0.5)));
  if (steps <= d + 1e-5) c = MARBLE * (S + L * (r.y > 0.035 ? 0.55 : 0.3));
  if (ent <= d + 1e-5 || frieze <= d + 1e-5) c = MARBLE * (S + L * 0.35) * (frieze <= d + 1e-5 ? 0.85 + 0.15 * step(0.5, fract(r.x * 16.0)) : 1.0);
  if (roof <= d + 1e-5) c = vec3(0.55, 0.3, 0.2) * (S + L * 0.5);
  return cover(d * s, PX);
}

vec3 scene(vec2 p) {
  float e = uElev;
  SkyTone st = skyTone(e);
  vec3 col = paintSky(p, HY, uSun, e);
  vec4 c1 = stratus(p, uSun, e, HY, 0.2, 0.08, 0.5, uGTime, 6.0);
  col = col * (1.0 - c1.a) + c1.rgb;
  vec4 c2 = stratus(p, uSun, e, HY, 0.07, 0.03, 0.35, uGTime, 9.0);
  col = col * (1.0 - c2.a) + c2.rgb;
  col += sunDisc(p, uSun, 0.03, e);
  vec3 SL = sunLight(), SK = skyLight();

  // ---- the sea, mirroring the sky, the sun's road of glitter across it.
  vec2 q = L(p, 0.05);
  if (p.y < HY) {
    float depth = HY - p.y;
    float wave = gnoise(vec2(p.x * 26.0 / (depth + 0.04), depth * 110.0 - uGTime * 1.2));
    vec2 m = vec2(p.x + wave * depth * 0.25, HY + depth * 0.8);
    vec3 refl = paintSky(m, HY, uSun, e);
    col = refl * vec3(0.32, 0.34, 0.44) + vec3(0.004, 0.012, 0.03);
    float glit = pow(saturate(gnoise(vec2(p.x * 160.0, depth * 500.0 - uGTime * 2.5)) * 0.5 + 0.5), 7.0);
    float road = exp(-abs(p.x - uSun.x) / (0.015 + depth * 0.5));
    col += SL * (glit * 3.5 + 0.22) * road;
  }
  // Far islands in the haze.
  vec3 air = airAt(q.x, HY, uSun, e);
  float isl = HY + 0.022 * exp(-pow((q.x + 0.3) / 0.35, 2.0)) + 0.012 * exp(-pow((q.x - 0.85) / 0.12, 2.0)) + 0.004 * fbm(vec2(q.x * 12.0, 1.0), 3) - 0.002;
  fill(col, p.y - isl + step(p.y, HY - 0.001) * 1.0, PX, inkIn(air, 0.7, INK));

  // ---- the Acropolis: a long rock with sheer cliffs and a wall along its brow, the temple on
  // its top; the cliff turned to the sun glows, the face towards us is in shade.
  q = L(p, 0.35);
  air = airAt(q.x, HY, uSun, e);
  float base = HY - 0.04;
  float top = 0.085 + 0.003 * fbm(vec2(q.x * 25.0, 2.0), 3);
  float xl = -0.8, xr = -0.24;
  float yy = clamp((q.y - base) / (top - base), 0.0, 1.0);
  float jag = 0.018 * fbm(vec2(q.y * 35.0, 5.0), 4) + 0.008 * gnoise(vec2(q.y * 120.0, 1.0));
  float hw = 0.5 * (xr - xl) * (1.0 + 0.28 * pow(1.0 - yy, 2.0)) + jag;
  float crag = max(abs(q.x - 0.5 * (xl + xr)) - hw, max(q.y - top, base - q.y));
  float rightFace = smoothstep(-0.035, -0.005, q.x - (0.5 * (xl + xr) + hw));
  float strata = 0.5 + 0.5 * sin(q.x * 180.0 + 8.0 * fbm(q * vec2(20.0, 60.0), 3));
  vec3 rc = ROCK * (SK * 0.9 + SL * (0.08 + 0.8 * rightFace)) * (0.78 + 0.22 * strata * (1.0 - yy * 0.3));
  // The wall along the brow of the rock.
  float wall = max(abs(q.x - 0.5 * (xl + xr)) - 0.5 * (xr - xl) + 0.01, abs(q.y - top + 0.012) - 0.012);
  rc = mix(rc, vec3(0.75, 0.62, 0.48) * (SK + SL * (0.2 + 0.6 * rightFace)), cover(wall, PX));
  col = mix(col, mix(rc, air, 0.15), cover(crag, PX));
  vec3 tc;
  float a = temple(q, vec2(-0.66, top - 0.001), 0.28, tc);
  col = mix(col, mix(tc, air, 0.08), a);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float x = -0.95 + fi * 0.19 + 0.05 * sin(fi * 5.0);
    if (abs(x + 0.52) < 0.2) continue;
    float y0 = base + 0.002 + 0.006 * sin(fi * 2.3);
    fill(col, sdCypress(q - vec2(x, y0), 0.07 + 0.03 * fract(fi * 0.61)), PX, mix(INK * 1.5, air, 0.2));
  }

  // ---- the terrace above the shore, with the philosophers, dark against the glare.
  q = L(p, 1.0);
  air = airAt(q.x, HY, uSun, e);
  float terr = -0.235 + 0.003 * sin(q.x * 3.0);
  vec3 stone = MARBLE * (SK * 0.55 + SL * 0.06) * (0.9 + 0.15 * fbm(q * vec2(8.0, 40.0), 3));
  // The step's lit front edge.
  stone = mix(stone, MARBLE * (SK + SL * 0.55), smoothstep(-0.008, -0.002, q.y - terr) * smoothstep(0.0, -0.002, q.y - terr));
  fill(col, q.y - terr, PX, stone);
  float men = 1e9;
  {
    float s = 0.21;
    vec2 b0 = vec2(-0.02, terr);
    Pose f0 = oratePose(uGTime);
    f0.handN = f0.neck + vec2(0.3, 0.05 + 0.1 * (0.5 + 0.5 * sin(uGTime * 2.1)));
    men = min(men, sdFigure((q - b0) / s, f0, vec4(1.0, 0.0, 0.0, 0.0), 1.05) * s);
    vec2 b1 = vec2(0.27, terr);
    vec2 r1 = (q - b1) / s;
    r1.x = -r1.x;
    Pose f1 = standPose(sin(uGTime * 1.2), -0.05);
    f1.handN = f1.neck + vec2(0.16, -0.12);
    men = min(men, sdFigure(r1, f1, vec4(1.0, 0.0, 0.0, 0.0), 1.05) * s);
    men = min(men, sdSegment(q, b1 + vec2(-0.16 * s, 0.0), b1 + vec2(-0.2 * s, 0.9 * s)) - 0.0018);
    vec2 b2 = vec2(0.41, terr - 0.004);
    vec2 r2 = (q - b2) / s;
    r2.x = -r2.x;
    Pose f2 = sitPose(sin(uGTime), 0.0, 0.1);
    f2.hip = vec2(0.0, 0.2);
    f2.footN = vec2(0.2, -0.0);
    f2.footF = vec2(0.16, 0.0);
    f2.neck = vec2(0.04, 0.53);
    f2.head = f2.neck + vec2(0.035, 0.095);
    f2.handN = vec2(0.22, 0.32);
    f2.handF = vec2(0.18, 0.3);
    men = min(men, sdFigure(r2, f2, vec4(1.0, 0.0, 0.0, 0.0), 1.05) * s);
  }
  if (men < 0.01) {
    vec2 e2 = vec2(0.0015, 0.0);
    // (A cheap gradient for the rim: the direction from the figures' middle.)
    vec2 g = normalize(q - vec2(0.2, terr + 0.12));
    float rim = exp(-abs(men) / 0.0022) * max(dot(g, normalize(uSun - p)), 0.0);
    col = mix(col, INK + SL * 0.7 * rim, cover(men, PX));
  }
  return col;
}
