// Animated silhouette creatures and plants as 2D signed distance fields.
// Conventions: local units, feet/base at y = 0, facing +x, roughly 1-2 units tall.
// `t` drives walk/swim/flap cycles. Negative distance = inside.
#include <sdf>

// ------------------------------------------------------------------ helpers
float sdLeg(vec2 p, vec2 hip, vec2 knee, vec2 foot, float r0, float r1, float r2) {
  return min(sdTaper(p, hip, knee, r0, r1), sdTaper(p, knee, foot, r1, r2));
}
vec2 rotAround(vec2 p, vec2 c, float a) { return c + rot2(a) * (p - c); }

// ------------------------------------------------------------------ Cambrian
float sdTrilobite(vec2 p, float t) {
  if (abs(p.x) > 0.8 || p.y > 0.5 || p.y < -0.1) return 1.0;
  // Segmented dome: outline ripples with the thoracic segments.
  float seg = 0.012 * sin(p.x * 60.0);
  float dome = sdEllipse(p - vec2(0.0, 0.0), vec2(0.5, 0.17 + seg));
  dome = max(dome, -p.y);
  // Genal spines trailing back and antennae forward.
  float spine = sdTaper(p, vec2(0.38, 0.03), vec2(0.62, 0.0), 0.02, 0.003);
  float ant = sdBezierTaper(p, vec2(0.46, 0.08), vec2(0.62, 0.2 + 0.03 * sin(t * 3.0)), vec2(0.75, 0.12), 0.008, 0.003);
  float tail = sdTaper(p, vec2(-0.45, 0.03), vec2(-0.58, 0.0), 0.03, 0.004);
  return min(min(dome, spine), min(ant, tail));
}

float sdAnomalocaris(vec2 p, float t) {
  if (abs(p.x) > 1.5 || abs(p.y) > 0.6) return 1.0;
  float d = sdEllipse(p, vec2(0.62, 0.1));
  // Undulating lateral lobes (a travelling wave along the body).
  for (int i = 0; i < 11; i++) {
    float fx = -0.5 + float(i) * 0.1;
    float w = sin(t * 5.0 - float(i) * 0.7);
    vec2 c = vec2(fx, 0.02);
    vec2 q = rot2(-0.5 + 0.35 * w) * (p - c);
    d = min(d, sdEllipse(q - vec2(-0.03, 0.12), vec2(0.07, 0.035)));
    d = min(d, sdEllipse(q - vec2(-0.03, -0.12), vec2(0.07, 0.03)));
  }
  // Head, stalked eyes, curled frontal appendages.
  d = min(d, sdEllipse(p - vec2(0.62, 0.02), vec2(0.13, 0.08)));
  d = min(d, sdTaper(p, vec2(0.62, 0.07), vec2(0.66, 0.2), 0.012, 0.01));
  d = min(d, sdCircle(p - vec2(0.67, 0.21), 0.035));
  float curl = 0.08 * sin(t * 2.0);
  d = min(d, sdBezierTaper(p, vec2(0.72, -0.02), vec2(0.98, -0.02 + curl), vec2(0.9, -0.22 - curl), 0.03, 0.01));
  // Tail fan.
  d = min(d, sdTaper(p, vec2(-0.6, 0.0), vec2(-0.85, 0.12), 0.03, 0.012));
  d = min(d, sdTaper(p, vec2(-0.6, 0.0), vec2(-0.88, 0.0), 0.03, 0.012));
  d = min(d, sdTaper(p, vec2(-0.6, 0.0), vec2(-0.85, -0.12), 0.03, 0.012));
  return d;
}

// Jellyfish bell + trailing tentacles (for glowing, translucent rendering use the distance smoothly).
float sdJelly(vec2 p, float t, float ph) {
  if (abs(p.x) > 0.5 || p.y > 0.35 || p.y < -1.2) return 1.0;
  float pulse = 0.5 + 0.5 * sin(t * 2.2 + ph);
  vec2 r = vec2(0.26 - 0.04 * pulse, 0.2 + 0.03 * pulse);
  float bell = max(sdEllipse(p, r), -p.y - 0.02);
  float d = bell;
  for (int i = 0; i < 5; i++) {
    float x0 = -0.18 + float(i) * 0.09;
    vec2 a = vec2(x0, 0.0);
    float len = 0.6 + 0.25 * fract(float(i) * 0.37 + ph);
    vec2 prev = a;
    for (int k = 1; k <= 5; k++) {
      float s = float(k) / 5.0;
      vec2 b = vec2(x0 + 0.05 * sin(t * 1.7 + s * 5.0 + float(i) + ph), -len * s);
      d = min(d, sdTaper(p, prev, b, 0.008, 0.005));
      prev = b;
    }
  }
  return d;
}

float sdSponge(vec2 p) {
  if (abs(p.x) > 0.5 || p.y > 1.2 || p.y < -0.1) return 1.0;
  float d = sdTaper(p, vec2(0.0, 0.0), vec2(0.03, 0.8), 0.12, 0.2);
  d = min(d, sdTaper(p, vec2(0.05, 0.0), vec2(0.28, 0.55), 0.06, 0.11));
  d = min(d, sdTaper(p, vec2(-0.05, 0.0), vec2(-0.25, 0.45), 0.05, 0.1));
  return d;
}

// Crinoid-like stalk with a feathery crown swaying in the current.
float sdCrinoid(vec2 p, float t, float ph) {
  if (abs(p.x) > 0.6 || p.y > 1.6 || p.y < -0.1) return 1.0;
  float sway = 0.12 * sin(t * 0.8 + ph);
  vec2 top = vec2(sway, 1.05);
  float d = sdBezierTaper(p, vec2(0.0, 0.0), vec2(0.0, 0.6), top, 0.02, 0.012);
  for (int i = 0; i < 7; i++) {
    float a = -1.1 + float(i) * 0.37 + 0.1 * sin(t + float(i));
    vec2 tip = top + vec2(sin(a), cos(a)) * 0.32;
    d = min(d, sdBezierTaper(p, top, top + vec2(sin(a) * 0.1, 0.18), tip, 0.012, 0.004));
  }
  return d;
}

// ------------------------------------------------------------------ onto land
float sdTiktaalik(vec2 p, float t) {
  if (abs(p.x) > 1.2 || p.y > 0.5 || p.y < -0.1) return 1.0;
  float step = sin(t * 2.0);
  float body = sdBezierTaper(p, vec2(-0.9, 0.12), vec2(-0.2, 0.2), vec2(0.35, 0.16), 0.02, 0.1);
  float head = sdEllipse(p - vec2(0.5, 0.15), vec2(0.2, 0.07));
  float fin1 = sdLeg(p, vec2(0.25, 0.12), vec2(0.35 + 0.05 * step, 0.08), vec2(0.42 + 0.06 * step, 0.0), 0.03, 0.022, 0.015);
  float fin2 = sdLeg(p, vec2(-0.25, 0.14), vec2(-0.18 - 0.04 * step, 0.07), vec2(-0.12 - 0.05 * step, 0.0), 0.025, 0.018, 0.012);
  float tailFin = sdTaper(p, vec2(-0.9, 0.12), vec2(-1.1, 0.2), 0.02, 0.05);
  return min(min(body, head), min(min(fin1, fin2), tailFin));
}

// ------------------------------------------------------------------ dinosaurs
float sdSauropod(vec2 p, float t, float ph) {
  if (p.x < -1.2 || p.x > 0.9 || p.y > 1.45 || p.y < -0.05) return 1.0;
  float w = t * 1.6 + ph;
  float bob = 0.01 * sin(w * 2.0);
  vec2 q = p - vec2(0.0, bob);
  float body = sdEllipse(rot2(-0.12) * (q - vec2(0.0, 0.46)), vec2(0.42, 0.21));
  float neck = sdBezierTaper(q, vec2(0.28, 0.55), vec2(0.5, 0.8), vec2(0.6, 1.25), 0.11, 0.04);
  float head = sdEllipse(rot2(-0.25) * (q - vec2(0.67, 1.28)), vec2(0.075, 0.035));
  float tail = sdBezierTaper(q, vec2(-0.32, 0.46), vec2(-0.7, 0.42), vec2(-1.08, 0.22), 0.1, 0.012);
  float d = smin(body, neck, 0.06);
  d = min(d, head);
  d = smin(d, tail, 0.05);
  // Pillar legs, near and far pairs in opposite phase.
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float ph2 = w + (fi < 2.0 ? 0.0 : PI) + (mod(fi, 2.0) < 1.0 ? 0.0 : PI * 0.5);
    float sw = 0.06 * sin(ph2);
    float lift = max(0.0, cos(ph2)) * 0.03;
    vec2 hip = fi < 2.0 ? vec2(0.24, 0.42) : vec2(-0.22, 0.4);
    vec2 foot = hip + vec2(sw, -hip.y + lift);
    vec2 knee = mix(hip, foot, 0.5) + vec2(fi < 2.0 ? 0.015 : -0.02, 0.0);
    d = min(d, sdLeg(q, hip, knee, foot, 0.07, 0.055, 0.05));
  }
  return d;
}

float sdTrex(vec2 p, float t, float ph) {
  if (p.x < -1.15 || p.x > 0.8 || p.y > 1.0 || p.y < -0.05) return 1.0;
  float w = t * 2.4 + ph;
  float bob = 0.015 * abs(sin(w));
  vec2 q = p - vec2(0.0, bob);
  float body = sdEllipse(rot2(0.12) * (q - vec2(0.02, 0.56)), vec2(0.3, 0.15));
  float tail = sdBezierTaper(q, vec2(-0.22, 0.6), vec2(-0.6, 0.66 + 0.02 * sin(w)), vec2(-1.05, 0.52), 0.13, 0.01);
  float neck = sdTaper(q, vec2(0.22, 0.62), vec2(0.36, 0.74), 0.11, 0.08);
  vec2 hq = rot2(-0.08) * (q - vec2(0.5, 0.76));
  float skull = sdRoundBox(hq, vec2(0.15, 0.065), 0.04);
  float jaw = sdRoundBox(rot2(0.18 + 0.05 * sin(w * 0.5)) * (q - vec2(0.47, 0.69)), vec2(0.13, 0.025), 0.02);
  float arm = sdLeg(q, vec2(0.26, 0.55), vec2(0.31, 0.48), vec2(0.35, 0.47), 0.022, 0.016, 0.01);
  float d = smin(body, tail, 0.06);
  d = smin(d, neck, 0.05);
  d = min(d, min(skull, jaw));
  d = min(d, arm);
  for (int i = 0; i < 2; i++) {
    float ph2 = w + float(i) * PI;
    float sw = 0.11 * sin(ph2);
    float lift = max(0.0, cos(ph2)) * 0.05;
    vec2 hip = vec2(-0.02, 0.52);
    vec2 knee = vec2(0.1 + sw * 0.6, 0.3 + lift * 0.5);
    vec2 ankle = vec2(0.0 + sw, 0.08 + lift);
    vec2 toe = ankle + vec2(0.11, -0.08 + lift * 0.3);
    d = min(d, sdTaper(q, hip, knee, 0.1, 0.06));
    d = min(d, sdTaper(q, knee, ankle, 0.055, 0.035));
    d = min(d, sdTaper(q, ankle, toe, 0.035, 0.015));
  }
  return d;
}

float sdPtero(vec2 p, float t, float ph) {
  if (abs(p.x) > 1.3 || abs(p.y) > 0.8) return 1.0;
  float flap = sin(t * 3.2 + ph);
  float body = sdEllipse(p, vec2(0.16, 0.045));
  float head = sdTaper(p, vec2(0.14, 0.02), vec2(0.42, -0.02), 0.03, 0.004);
  float crest = sdTaper(p, vec2(0.14, 0.03), vec2(-0.02, 0.16), 0.02, 0.004);
  vec2 tip = vec2(-0.2, 0.55 * flap);
  float wing = sdTriangle(p, vec2(0.08, 0.02), vec2(-0.08, 0.0), vec2(-0.25 + 0.05 * flap, tip.y * 1.6));
  float wing2 = sdTriangle(p, vec2(0.06, -0.01), vec2(-0.1, -0.02), vec2(-0.3, tip.y * 1.2 - 0.1));
  return min(min(body, head), min(crest, min(wing, wing2)));
}

// ------------------------------------------------------------------ mammals and people
float sdMammal(vec2 p, float t) {
  if (abs(p.x) > 0.8 || p.y > 0.8 || p.y < -0.05) return 1.0;
  float sniff = 0.02 * sin(t * 6.0);
  float body = sdEllipse(rot2(0.35) * (p - vec2(0.0, 0.2)), vec2(0.2, 0.11));
  float head = sdCircle(p - vec2(0.2, 0.33 + sniff), 0.08);
  float snout = sdTaper(p, vec2(0.24, 0.33 + sniff), vec2(0.34, 0.31 + sniff), 0.05, 0.015);
  float ear = sdTaper(p, vec2(0.18, 0.39 + sniff), vec2(0.16, 0.47 + sniff), 0.025, 0.01);
  float tail = sdBezierTaper(p, vec2(-0.17, 0.12), vec2(-0.45, 0.3), vec2(-0.3, 0.65 + 0.03 * sin(t * 2.0)), 0.04, 0.09);
  float legs = min(sdTaper(p, vec2(0.1, 0.12), vec2(0.13, 0.0), 0.035, 0.02), sdTaper(p, vec2(-0.1, 0.12), vec2(-0.07, 0.0), 0.05, 0.025));
  float d = smin(body, head, 0.04);
  d = min(min(d, snout), min(ear, legs));
  return smin(d, tail, 0.03);
}

// A person, feet at 0, ~1.0 tall. `look` tilts the head up (0 = ahead, 1 = sky).
float sdPerson(vec2 p, float look, float t) {
  if (abs(p.x) > 0.5 || p.y > 1.1 || p.y < -0.05) return 1.0;
  float breathe = 0.004 * sin(t * 1.5);
  float head = sdEllipse(rot2(0.5 * look) * (p - vec2(0.02 * look, 0.92 + breathe)), vec2(0.055, 0.068));
  float torso = sdTaper(p, vec2(0.0, 0.8), vec2(0.0, 0.5), 0.09, 0.075);
  float hips = sdEllipse(p - vec2(0.0, 0.5), vec2(0.08, 0.06));
  float legA = sdTaper(p, vec2(-0.03, 0.48), vec2(-0.05, 0.0), 0.045, 0.028);
  float legB = sdTaper(p, vec2(0.03, 0.48), vec2(0.06, 0.0), 0.045, 0.028);
  float armA = sdLeg(p, vec2(0.0, 0.78), vec2(-0.02, 0.6), vec2(0.0, 0.46), 0.03, 0.025, 0.02);
  float armB = sdLeg(p, vec2(0.02, 0.78), vec2(0.06, 0.6), vec2(0.05, 0.46), 0.03, 0.025, 0.02);
  float d = smin(torso, hips, 0.04);
  d = smin(d, head, 0.02);
  return min(d, min(min(legA, legB), min(armA, armB)));
}

// Seated person, facing +x (towards a fire), ~0.65 tall.
float sdSitter(vec2 p, float t, float ph) {
  if (abs(p.x) > 0.6 || p.y > 0.8 || p.y < -0.05) return 1.0;
  float sway = 0.01 * sin(t * 0.9 + ph);
  float head = sdCircle(p - vec2(0.05 + sway, 0.64), 0.06);
  float torso = sdTaper(p, vec2(0.02 + sway, 0.56), vec2(-0.04, 0.22), 0.08, 0.08);
  float thigh = sdTaper(p, vec2(-0.02, 0.2), vec2(0.24, 0.26), 0.07, 0.05);
  float shin = sdTaper(p, vec2(0.24, 0.26), vec2(0.28, 0.0), 0.045, 0.03);
  float arm = sdLeg(p, vec2(0.03 + sway, 0.5), vec2(0.14, 0.34), vec2(0.24, 0.3), 0.03, 0.025, 0.02);
  return min(smin(smin(torso, head, 0.02), thigh, 0.03), min(shin, arm));
}

// ------------------------------------------------------------------ plants
float sdFern(vec2 p, float t, float ph, float s) {
  if (abs(p.x) > 1.0 * s || p.y > 1.3 * s || p.y < -0.05) return 1.0;
  float d = 1e9;
  for (int i = 0; i < 6; i++) {
    float a = -0.9 + float(i) * 0.36 + 0.05 * sin(t * 0.9 + ph + float(i));
    vec2 tip = vec2(sin(a), cos(a)) * s * (0.9 + 0.2 * fract(float(i) * 0.61));
    vec2 mid = tip * 0.55 + vec2(0.0, 0.2 * s);
    d = min(d, sdBezierTaper(p, vec2(0.0), mid, tip + vec2(tip.x * 0.3, -0.25 * s), 0.035 * s, 0.004 * s));
  }
  return d;
}

float sdCycad(vec2 p, float t, float ph, float s) {
  if (abs(p.x) > 1.2 * s || p.y > 1.8 * s || p.y < -0.05) return 1.0;
  vec2 top = vec2(0.02 * sin(t * 0.7 + ph), 0.9) * s;
  float d = sdTaper(p, vec2(0.0), top, 0.12 * s, 0.09 * s);
  for (int i = 0; i < 7; i++) {
    float a = -1.3 + float(i) * 0.43 + 0.04 * sin(t * 0.8 + ph + float(i));
    vec2 tip = top + vec2(sin(a) * 0.95, cos(a) * 0.6 - 0.15) * s;
    d = min(d, sdBezierTaper(p, top, top + vec2(sin(a) * 0.4, 0.35) * s, tip, 0.04 * s, 0.005 * s));
  }
  return d;
}

float sdConifer(vec2 p, float s) {
  if (abs(p.x) > 0.5 * s || p.y > 2.2 * s || p.y < -0.05) return 1.0;
  float d = sdTaper(p, vec2(0.0), vec2(0.0, 2.0 * s), 0.05 * s, 0.01 * s);
  for (int i = 0; i < 6; i++) {
    float y = (0.45 + float(i) * 0.26) * s;
    float w = (0.42 - float(i) * 0.06) * s;
    d = min(d, sdTriangle(p, vec2(-w, y), vec2(w, y), vec2(0.0, y + 0.42 * s)));
  }
  return d;
}

float sdAcacia(vec2 p, float s) {
  if (abs(p.x) > 1.3 * s || p.y > 1.6 * s || p.y < -0.05) return 1.0;
  float d = sdBezierTaper(p, vec2(0.0), vec2(0.05, 0.6) * s, vec2(-0.1, 1.05) * s, 0.06 * s, 0.03 * s);
  d = min(d, sdBezierTaper(p, vec2(0.02, 0.5) * s, vec2(0.3, 0.8) * s, vec2(0.55, 1.05) * s, 0.035 * s, 0.018 * s));
  float crown = sdEllipse(p - vec2(0.15, 1.18) * s, vec2(1.0, 0.13) * s);
  crown += 0.02 * s * sin(p.x * 30.0 / s) * sin(p.x * 7.0 / s);
  return min(d, crown);
}

// A date palm, base at the origin, s tall: a slender trunk leaning a little, and a crown of
// arching fronds whose leaflets fray their edges. t and ph sway it in the wind.
float sdDatePalm(vec2 p, float t, float ph, float s) {
  if (abs(p.x) > 0.75 * s || p.y > 1.35 * s || p.y < -0.05 * s) return 1.0;
  float sway = 0.02 * s * sin(t * 0.9 + ph);
  vec2 top = vec2(0.07 * s + sway, s);
  float d = sdBezierTaper(p, vec2(0.0), vec2(-0.02 * s, 0.55 * s), top, 0.034 * s, 0.024 * s);
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float a = -2.5 + fi * (5.0 / 11.0) + 0.06 * sin(t * 1.3 + fi + ph);
    vec2 dir = vec2(sin(a), cos(a));
    float len = (0.36 + 0.1 * fract(fi * 0.618 + ph)) * s;
    vec2 tip = top + dir * len + vec2(0.0, -len * 0.55 * abs(dir.x) - (dir.y < 0.0 ? 0.1 * s : 0.0));
    vec2 ctrl = top + dir * len * 0.55 + vec2(0.0, 0.1 * s * (1.0 - abs(dir.x) * 0.3));
    float f = sdBezierTaper(p, top, ctrl, tip, 0.02 * s, 0.003 * s);
    // Leaflets: the frond's edge breaks up into fine points.
    f -= 0.012 * s * smoothstep(0.03 * s, 0.0, f) * (0.5 + 0.5 * sin(dot(p - top, vec2(dir.y, -dir.x)) * 0.0 + length(p - top) / s * 90.0));
    d = min(d, f);
  }
  // Clusters of dates under the crown.
  d = min(d, sdEllipse(p - top - vec2(0.03 * s, -0.06 * s), vec2(0.03, 0.045) * s));
  return d;
}

// An Italian cypress, base at the origin, s tall: a narrow flame of dark foliage.
float sdCypress(vec2 p, float s) {
  if (abs(p.x) > 0.15 * s || p.y > 1.05 * s || p.y < -0.02 * s) return 1.0;
  float d = sdTaper(p, vec2(0.0, 0.34 * s), vec2(0.0, s), 0.075 * s, 0.003 * s);
  d = smin(d, sdTaper(p, vec2(0.0, 0.02 * s), vec2(0.0, 0.34 * s), 0.045 * s, 0.075 * s), 0.02 * s);
  return d + 0.006 * s * gnoise(p * 60.0 / s);
}
