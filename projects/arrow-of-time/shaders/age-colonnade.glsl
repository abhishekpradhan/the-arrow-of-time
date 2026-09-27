// Philosophy, 500 BCE: the colonnade of a Doric temple above the Aegean at sunset. Low sun pours
// between the fluted columns in shafts through the dusty air, striping the marble walkway and the
// cella wall; a philosopher in a himation stands in the light, looking out to sea.
// Metres; the colonnade runs along x with its columns at z = 0 and the sea to +z; y up.
#define MARCH_STEPS 140
#define SHADOW_STEPS 32
#include <noise>
#include <color>
#include <camera>
#include <sdf3>
#include <march>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uT;

const vec3 SUN = vec3(0.4523, 0.0785, 0.8884);   // low over the sea, 4.5 degrees up
const vec3 SUN_COL = vec3(1.0, 0.56, 0.26) * 3.6;
const float SPACING = 4.3;
const float COL_H = 10.4;
const float BASE = 1.6;          // top of the three-step stylobate
const float WALL_Z = -6.0;       // the cella wall

float columnRadius(float y) {
  float u = clamp(y / COL_H, 0.0, 1.0);
  return mix(0.95, 0.74, u) + 0.035 * sin(3.1416 * u);   // taper with a slight entasis
}

float column(vec3 p) {
  float id;
  vec3 q = vec3(repLim1(p.x, SPACING, 30.0, id), p.y - BASE, p.z);
  float r = columnRadius(q.y);
  // Twenty shallow flutes meeting at sharp arrises.
  float a = atan(q.z, q.x) * 20.0 / 6.2832;
  float f = abs(fract(a) - 0.5) * 2.0;
  float shaft = length(q.xz) - r + 0.045 * (1.0 - f * f);
  shaft = max(shaft * 0.85, abs(q.y - COL_H * 0.5) - COL_H * 0.5);
  // Capital: the cushion of the echinus and the square abacus.
  float echinus = sdCone(q - vec3(0.0, COL_H + 0.28, 0.0), 0.28, 0.78, 1.08);
  float abacus = sdBox(q - vec3(0.0, COL_H + 0.72, 0.0), vec3(1.15, 0.16, 1.15));
  return min(shaft, min(echinus, abacus));
}

float entablature(vec3 p) {
  float y0 = BASE + COL_H + 0.88;
  float arch = sdBox(p - vec3(0.0, y0 + 0.7, 0.0), vec3(200.0, 0.7, 1.05));
  // Frieze: triglyphs over every column and between them, metopes set back.
  float fz = p.z - 1.0;
  float tri = abs(fract(p.x / (SPACING * 0.5) + 0.5) - 0.5) * SPACING * 0.5;
  float frieze = sdBox(p - vec3(0.0, y0 + 2.1, -0.05), vec3(200.0, 0.7, 1.0 + 0.08 * step(tri, 0.42)));
  float cornice = sdBox(p - vec3(0.0, y0 + 3.0, 0.1), vec3(200.0, 0.22, 1.35));
  // The ceiling of the walkway, to the cella wall.
  float roof = sdBox(p - vec3(0.0, y0 + 2.9, (WALL_Z) * 0.5), vec3(200.0, 0.3, -WALL_Z * 0.5 + 0.2));
  return min(min(arch, frieze), min(cornice, roof));
}

// Three steps down towards the sea; the top one is the walkway.
float stylobate(vec3 p) {
  float d = 1e9;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float top = BASE * (fi + 1.0) / 3.0, front = 1.7 + 0.45 * (2.0 - fi);
    d = min(d, sdBox(p - vec3(0.0, top * 0.5, (front - 7.0) * 0.5), vec3(200.0, top * 0.5, (front + 7.0) * 0.5)));
  }
  return d;
}

float wall(vec3 p) { return sdBox(p - vec3(0.0, 7.0, WALL_Z - 0.6), vec3(200.0, 7.0, 0.6)); }

// The philosopher: a bearded man in a himation draped over one shoulder, his other arm raised
// towards the sea as he speaks. Local +x is the way he faces.
float figure(vec3 p) {
  vec3 q = p - vec3(9.4, BASE, -1.6);
  q.xz = rot2(-1.25) * q.xz;
  float robe = sdCone(q - vec3(0.0, 0.62, 0.0), 0.62, 0.3, 0.21);
  float torso = sdEllipsoid(q - vec3(0.0, 1.28, 0.0), vec3(0.17, 0.3, 0.23));
  float drape = sdCapsule(q, vec3(0.02, 1.5, -0.2), vec3(0.06, 0.95, 0.2), 0.09);
  float shoulders = sdCapsule(q, vec3(0.0, 1.5, -0.2), vec3(0.0, 1.5, 0.2), 0.08);
  float head = sdSphere(q - vec3(0.02, 1.72, 0.0), 0.105);
  float beard = sdEllipsoid(q - vec3(0.08, 1.63, 0.0), vec3(0.06, 0.08, 0.07));
  float lift = 0.05 * sin(uT * 1.3);
  float upper = sdCapsule(q, vec3(0.0, 1.48, 0.2), vec3(0.2, 1.36 + lift, 0.3), 0.05);
  float fore = sdCapsule(q, vec3(0.2, 1.36 + lift, 0.3), vec3(0.46, 1.5 + 2.0 * lift, 0.36), 0.04);
  float body = smin(smin(robe, torso, 0.08), smin(drape, shoulders, 0.05), 0.04);
  return min(min(body, smin(head, beard, 0.03)), min(upper, fore));
}

float mapD(vec3 p) {
  float d = min(column(p), entablature(p));
  d = min(d, min(stylobate(p), wall(p)));
  d = min(d, figure(p));
  // The ground falls away to the sea beyond the steps.
  d = min(d, p.y + 30.0 - 0.0);
  return d;
}

// Is a point in the sun? The columns and entablature are the only occluders between the walkway
// and the low sun, so test them along the sun ray analytically (used for the light shafts).
float sunlit(vec3 p) {
  if (p.z > 1.2) return 1.0;
  // Carry the point along the sun ray to the plane of the columns.
  float s = (0.0 - p.z) / SUN.z;
  vec3 c = p + SUN * s;
  if (c.y > BASE + COL_H + 0.7) return 0.0;              // under the entablature and roof
  float id;
  float x = repLim1(c.x, SPACING, 30.0, id);
  float r = columnRadius(c.y - BASE);
  // The sun ray crosses the column's circle if |x| < r / cos(angle).
  float w = r / sqrt(1.0 - SUN.x * SUN.x);
  return smoothstep(w - 0.05, w + 0.05, abs(x));
}

vec3 sky(vec3 rd) {
  float mu = max(dot(rd, SUN), 0.0);
  float e = max(rd.y, 0.0);
  vec3 col = mix(vec3(1.1, 0.48, 0.2), vec3(0.3, 0.2, 0.3), smoothstep(0.0, 0.25, e));
  col = mix(col, vec3(0.08, 0.1, 0.24), smoothstep(0.2, 0.7, e));
  col += SUN_COL * (0.06 * pow(mu, 4.0) + 0.3 * pow(mu, 40.0) + 1.5 * pow(mu, 800.0));
  col += SUN_COL * 6.0 * smoothstep(0.9998, 0.99992, mu);
  return col;
}

vec3 sea(vec3 ro, vec3 rd) {
  // The Aegean far below: dark water with the sun's glitter path.
  float t = (-30.0 - ro.y) / rd.y;
  vec3 p = ro + rd * t;
  vec3 n = normalize(vec3(0.08 * gnoise(p.xz * 0.05 + uT * 0.2), 1.0, 0.08 * gnoise(p.zx * 0.05 - uT * 0.2)));
  vec3 r = reflect(rd, n);
  vec3 col = vec3(0.02, 0.04, 0.07) + sky(r) * 0.25 * (0.02 + 0.98 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0));
  col += SUN_COL * 0.6 * pow(max(dot(r, SUN), 0.0), 300.0);
  return col;
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  float pix = pixelAngle(uRes.y);
  vec3 col = rd.y < -0.005 ? sea(ro, rd) : sky(rd);
  float t = march(ro, rd, 0.2, 400.0, pix * 0.5);
  float tEnd = t > 0.0 ? t : 60.0;
  if (t > 0.0) {
    vec3 pos = ro + rd * t;
    vec3 n = calcNormal(pos, max(0.002, t * pix));
    float dFig = figure(pos);
    // Marble, warmed by age; the figure's wool himation is a pale ochre.
    vec3 alb = vec3(0.78, 0.72, 0.62) * (0.9 + 0.1 * fbm(pos.xy * 1.5 + pos.zx, 3));
    if (dFig < 0.01) alb = vec3(0.62, 0.5, 0.36);
    if (pos.y < -1.0) alb = vec3(0.3, 0.3, 0.22);
    float sh = softShadow(pos + n * 0.02, SUN, 0.05, 60.0, 24.0);
    float dif = max(dot(n, SUN), 0.0);
    float ao = calcAO(pos, n, 1.2);
    // Warm sky from the sea side, cool from above, warm bounce from the sunlit floor.
    vec3 amb = vec3(0.12, 0.1, 0.14) * (0.6 + 0.4 * n.y) + vec3(0.3, 0.14, 0.06) * max(n.z, 0.0) * 0.5 + vec3(0.22, 0.12, 0.06) * max(-n.y, 0.0);
    col = alb * (SUN_COL * dif * sh + amb * ao);
    col = mix(col, sky(normalize(vec3(rd.x, 0.02, rd.z))) * 0.6, 1.0 - exp(-t * 0.004));
  }
  // Light shafts: sunlight scattered by dust in the air, where the columns let it through.
  float shafts = 0.0;
  float span = min(tEnd, 30.0);
  float jitter = hash12(gl_FragCoord.xy + fract(uT) * 100.0);
  for (int i = 0; i < 24; i++) {
    float ti = (float(i) + jitter) / 24.0 * span;
    vec3 q = ro + rd * ti;
    shafts += sunlit(q) * step(q.y, BASE + COL_H + 0.7) * step(q.z, 1.2);
  }
  shafts *= span / 24.0;
  // Dust scatters a little in every direction and much more towards the sun.
  float phase = 0.6 + 3.0 * pow(max(dot(rd, SUN), 0.0), 5.0);
  col += SUN_COL * 0.007 * shafts * phase;
  fragColor = vec4(col, 1.0);
}
