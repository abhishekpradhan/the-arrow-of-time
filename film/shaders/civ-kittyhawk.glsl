// Flight, 1903: the Wright Flyer over the sand at Kill Devil Hills, black against the last of the
// light. (The first flights were made in the morning; the film's day has run on.) The Flyer is a
// small 3D model projected obliquely, so its long span, the struts and wires between the wings,
// the elevator out in front, the twin rudders, the pilot lying on the lower wing and the blurred
// propellers all read in silhouette. Wilbur runs alongside; the camp's sheds and the big dune
// behind; the Atlantic a line of light; Venus in the afterglow.
#include <arrow-of-time/civ-common>

const float HY = -0.11;
const vec3 INK = vec3(0.012, 0.011, 0.016);

// ---------------------------------------------------------------- the Flyer
// Model coordinates in metres: x forward, y up, z along the span. An oblique projection: the far
// wing (+z) recedes up and to the left, and shrinks a little.
vec2 FC;       // where the Flyer's centre is in the picture
float FS;      // picture units per metre
float PITCH;

vec2 pj(vec3 P) {
  P.xy = rot2(PITCH) * P.xy;
  float k = 1.0 / (1.0 + 0.03 * P.z);
  return FC + (vec2(P.x, P.y) + vec2(-0.36, 0.2) * P.z) * FS * k;
}

float quad(vec2 q, vec3 a, vec3 b, vec3 c, vec3 d) {
  vec2 A = pj(a), B = pj(b), C = pj(c), D = pj(d);
  return min(sdTriangle(q, A, B, C), sdTriangle(q, A, C, D));
}

float rod(vec2 q, vec3 a, vec3 b, float r) { return sdSegment(q, pj(a), pj(b)) - r; }

// Distance to the Flyer; `cloth` receives the distance to its fabric surfaces alone.
float flyer(vec2 q, out float cloth, out float props) {
  float r = FS * 0.035;                 // spruce struts, a few centimetres, still visible
  float w = FS * 0.012;                 // bracing wires: fine lines
  float d = 1e9;
  // The wings: 12.3 m span, 2 m chord, 1.8 m apart.
  float wings = min(quad(q, vec3(-1.0, 0.0, -6.15), vec3(1.0, 0.0, -6.15), vec3(1.0, 0.0, 6.15), vec3(-1.0, 0.0, 6.15)),
                    quad(q, vec3(-1.0, 1.8, -6.15), vec3(1.0, 1.8, -6.15), vec3(1.0, 1.8, 6.15), vec3(-1.0, 1.8, 6.15)));
  // (Seen almost edge on, the wings are thin: give them their thickness.)
  wings = min(wings, min(rod(q, vec3(0.9, 0.0, -6.15), vec3(0.9, 0.0, 6.15), FS * 0.05), rod(q, vec3(0.9, 1.8, -6.15), vec3(0.9, 1.8, 6.15), FS * 0.05)));
  // The elevator ahead on its outriggers, the twin rudders behind on theirs.
  float elev = min(quad(q, vec3(2.9, 0.45, -2.3), vec3(3.7, 0.45, -2.3), vec3(3.7, 0.45, 2.3), vec3(2.9, 0.45, 2.3)),
                   quad(q, vec3(2.9, 1.05, -2.3), vec3(3.7, 1.05, -2.3), vec3(3.7, 1.05, 2.3), vec3(2.9, 1.05, 2.3)));
  float rud = min(quad(q, vec3(-3.2, 0.1, -0.3), vec3(-2.6, 0.1, -0.3), vec3(-2.6, 1.8, -0.3), vec3(-3.2, 1.8, -0.3)),
                  quad(q, vec3(-3.2, 0.1, 0.3), vec3(-2.6, 0.1, 0.3), vec3(-2.6, 1.8, 0.3), vec3(-3.2, 1.8, 0.3)));
  cloth = min(min(wings, elev), rud);
  d = cloth;
  for (int i = 0; i < 8; i++) {
    float z = -6.0 + float(i) * (12.0 / 7.0);
    d = min(d, min(rod(q, vec3(0.85, 0.0, z), vec3(0.85, 1.8, z), r), rod(q, vec3(-0.85, 0.0, z), vec3(-0.85, 1.8, z), r)));
    if (i < 7) {
      float z2 = z + 12.0 / 7.0;
      d = min(d, min(rod(q, vec3(0.85, 0.0, z), vec3(0.85, 1.8, z2), w), rod(q, vec3(0.85, 1.8, z), vec3(0.85, 0.0, z2), w)));
    }
  }
  for (int i = -1; i <= 1; i += 2) {
    float z = float(i) * 0.9;
    d = min(d, min(rod(q, vec3(0.9, 0.05, z), vec3(3.3, 0.45, z), r), rod(q, vec3(0.9, 1.75, z), vec3(3.3, 1.05, z), r)));
    d = min(d, min(rod(q, vec3(-0.9, 0.2, z * 0.33), vec3(-2.9, 0.4, z * 0.33), r), rod(q, vec3(-0.9, 1.6, z * 0.33), vec3(-2.9, 1.5, z * 0.33), r)));
    // Skids under it all.
    d = min(d, rod(q, vec3(-0.6, -0.3, z), vec3(3.4, -0.25, z), r * 1.2));
  }
  // Orville lying prone on the lower wing, the engine beside him.
  vec2 pa = pj(vec3(0.8, 0.12, -0.4)), pb = pj(vec3(-0.7, 0.12, -0.4));
  d = min(d, sdSegment(q, pa, pb) - FS * 0.2);
  d = min(d, sdCircle(q - pa - (pa - pb) * 0.05, FS * 0.14));
  vec2 e0 = pj(vec3(-0.1, 0.35, 0.45));
  d = min(d, sdBox(q - e0, vec2(FS * 0.3, FS * 0.2)));
  // The propellers behind the wings: discs blurred by their spin, a blade caught in each.
  props = 1e9;
  for (int i = -1; i <= 1; i += 2) {
    vec2 c = pj(vec3(-1.15, 0.95, float(i) * 1.6));
    vec2 ax = pj(vec3(-1.15, 0.95, float(i) * 1.6 + 1.3)) - c;
    // The disc lies in the y-z plane: an ellipse with axes along the picture's up and the span.
    mat2 m = mat2(ax, vec2(0.0, 1.3 * FS));
    vec2 uv = inverse(m) * (q - c);
    props = min(props, (length(uv) - 1.0) * FS * 0.9);
    float ang = uGTime * 45.0 * float(i);
    vec2 blade = vec2(cos(ang), sin(ang));
    d = min(d, sdSegment(q, c - m * blade * 0.95, c + m * blade * 0.95) - FS * 0.05);
  }
  return d;
}

// Wilbur, running alongside with his hand up at the wing.
float runner(vec2 q, vec2 base, float s) {
  Pose f = runPose(uGTime * 7.0);
  f.handF = f.neck + vec2(0.18, 0.2);
  return sdFigure((q - base) / s, f, vec4(0.0, 0.0, 0.0, 2.0), 1.0) * s;
}

vec3 scene(vec2 p) {
  float e = uElev;
  SkyTone st = skyTone(e);
  vec3 col = paintSky(p, HY, uSun, e);
  col += nightStars(p, PX, uGTime, 17.0, st.stars * 1.3 * smoothstep(0.05, 0.3, p.y - HY));
  // Venus, and a thin crescent Moon.
  col += vec3(1.0, 0.97, 0.9) * exp(-dot(p - vec2(0.42, 0.14), p - vec2(0.42, 0.14)) / (PX * PX * 3.0)) * 5.0;
  {
    vec2 m = p - vec2(0.65, 0.22);
    float moon = max(length(m) - 0.014, -(length(m - vec2(0.006, 0.003)) - 0.013));
    col += vec3(1.0, 0.95, 0.85) * 1.2 * cover(moon, PX);
  }

  // ---- far: the Atlantic, a line of light, and the low dunes of the Banks.
  vec2 q = L(p, 0.05);
  vec3 air = airAt(q.x, HY, uSun, e);
  float sea = HY + 0.004;
  if (q.y < sea && q.x < -0.1) col = mix(col, air * 0.8 + st.glow * 0.1 * smoothstep(0.0, -0.4, q.x), 1.0);
  float banks = HY + 0.004 + 0.008 * smoothstep(-0.2, 0.3, q.x) * (0.6 + 0.4 * fbm(vec2(q.x * 8.0, 1.0), 3));
  fill(col, q.y - banks + step(q.x, -0.1) * 0.0 + (q.x < -0.1 ? 0.004 : 0.0), PX, inkIn(air, 0.6, INK));

  // ---- Big Kill Devil Hill, the camp's two sheds, the lifesaving men watching.
  q = L(p, 0.3);
  air = airAt(q.x, HY, uSun, e);
  float dune = HY - 0.005 + 0.1 * exp(-pow((q.x + 0.35) / 0.3, 2.0)) + 0.012 * fbm(vec2(q.x * 5.0, 2.0), 3);
  fill(col, q.y - dune, PX, inkIn(air, 0.32, INK));
  float sheds = min(sdBox(q - vec2(0.55, HY + 0.012), vec2(0.045, 0.014)), sdBox(q - vec2(0.68, HY + 0.01), vec2(0.035, 0.012)));
  sheds = min(sheds, min(sdTriangle(q, vec2(0.5, HY + 0.025), vec2(0.6, HY + 0.025), vec2(0.55, HY + 0.037)), sdTriangle(q, vec2(0.64, HY + 0.021), vec2(0.72, HY + 0.021), vec2(0.68, HY + 0.031))));
  fill(col, sheds, PX, inkIn(air, 0.3, INK));
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float s = 0.045;
    vec2 b = vec2(0.3 + fi * 0.04, HY - 0.004);
    Pose f = standPose(sin(uGTime + fi), 0.2);
    if (i == 1) f.handF = f.neck + vec2(0.12, 0.25);
    fill(col, sdFigure((q - b) / s, f, vec4(0.0, 0.0, 0.0, 1.0), 1.0) * s, PX, inkIn(air, 0.28, INK));
  }

  // ---- the level sand of the flying ground, the launching rail, the Flyer and Wilbur.
  q = L(p, 0.8);
  air = airAt(q.x, HY, uSun, e);
  float ground = -0.2 + 0.006 * sin(q.x * 3.0);
  fill(col, q.y - ground, PX, inkIn(air, 0.1, INK));
  fill(col, sdBox(q - vec2(-0.55, ground + 0.004), vec2(0.28, 0.003)), PX, INK);
  FC = vec2(-0.12 + 0.13 * (uT + 0.5), -0.075 + 0.006 * sin(uT * 2.2));
  FS = 0.05;
  PITCH = 0.04 * sin(uT * 2.2 + 0.8);
  float cloth, props;
  float d = flyer(q, cloth, props);
  // The muslin lets a little of the afterglow through; the frame is black.
  vec3 fc = INK;
  if (cloth <= d + 1e-5) fc = INK + air * 0.12;
  col = mix(col, INK + air * 0.1, cover(props, PX * 3.0) * 0.35);
  col = mix(col, fc, cover(d, PX * 0.8));
  // The Flyer's shadow racing over the sand below it.
  fill(col, runner(q, vec2(FC.x - 0.12, ground - 0.002), 0.13), PX, INK);

  // ---- close by: beach grass on a hummock of sand.
  q = L(p, 1.8);
  float hum = -0.33 + 0.03 * exp(-pow((q.x - 0.6) / 0.25, 2.0)) + 0.02 * exp(-pow((q.x + 0.9) / 0.3, 2.0));
  float grass = q.y - hum;
  float cell = floor(q.x / 0.018);
  for (int j = -2; j <= 2; j++) {
    float c = cell + float(j);
    vec3 h = hash31(c * 3.3 + 5.0);
    float x = (c + h.x) * 0.018;
    float base = -0.33 + 0.03 * exp(-pow((x - 0.6) / 0.25, 2.0)) + 0.02 * exp(-pow((x + 0.9) / 0.3, 2.0));
    float len = (0.03 + 0.06 * h.y) * smoothstep(-0.35, -0.3, base);
    vec2 a = vec2(x, base - 0.005), b = a + vec2((h.z - 0.5) * 0.04 + 0.006 * sin(uGTime * 1.5 + c), len);
    grass = min(grass, sdBezierTaper(q, a, a + vec2(0.0, len * 0.6), b, 0.003, 0.0006));
  }
  col = mix(col, INK * 0.8, soft(grass, 2.5));
  return col;
}
