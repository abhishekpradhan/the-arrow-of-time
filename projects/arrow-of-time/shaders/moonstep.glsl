// The Moon, 1969: the first step, painted like the civilization tableaux. The lunar module stands
// on the Sea of Tranquility in hard, low sunlight from the left: gold foil on its descent stage,
// the grey cabin above, the ladder down its front leg. The astronaut comes down the ladder and at
// cue moonStep sets his left boot on the regolith; a spray of dust flies out on clean ballistic
// arcs (no air to hold it). The sky is black and starless (the sunlit ground outshines the stars);
// the Earth, drawn beneath this pass by the Planet component, hangs above. The sky is left
// transparent (premultiplied alpha).
#include <illustration>
#include <figures>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime;
uniform float uStep;     // seconds since the boot touched down (< 0 before)
uniform vec2 uCam;       // camera drift (mid-ground units)
uniform float uZoom;

const vec3 SUNC = vec3(1.0, 0.97, 0.92) * 2.6;
const vec2 SUNDIR = normalize(vec2(-1.0, 0.35));    // towards the sun, in the picture
const vec3 REG = vec3(0.34, 0.33, 0.31);            // regolith albedo
const vec3 GOLD = vec3(0.85, 0.55, 0.18);
float PX;

vec2 Lp(vec2 p, float k) { return p / uZoom + uCam * k; }

// A crater (ellipse, seen at a grazing angle): the rim towards the sun in shadow inside, the far
// wall lit. Returns a brightness multiplier around 1.
float crater(vec2 q, vec2 c, float r) {
  vec2 d = (q - c) / vec2(r, r * 0.28);
  float l = length(d);
  float inside = smoothstep(1.0, 0.9, l);
  float farWall = smoothstep(-0.2, 0.8, -d.x * SUNDIR.x - d.y * 0.3);
  float rim = exp(-pow((l - 1.0) / 0.12, 2.0));
  return mix(1.0, mix(0.15, 1.25, farWall), inside) + 0.25 * rim * step(0.0, d.x);
}

// The lunar module (mid-ground units, origin at the foot of the front leg's pad).
// mat: 1 gold foil, 2 grey panels, 3 dark, 4 struts. Returns distance.
float lander(vec2 q, out float mat) {
  mat = 2.0;
  vec2 o = vec2(0.33, 0.0);          // the descent stage's centre line
  float d = 1e9;
  // Descent stage: an octagonal box in gold foil.
  vec2 r = q - o - vec2(0.0, 0.2);
  float oct = max(max(abs(r.x) - 0.2, abs(r.y) - 0.075), (abs(r.x) + abs(r.y)) - 0.24);
  // Ascent stage: the angular cabin, the docking tunnel, the dish on its mast.
  vec2 a = q - o - vec2(0.0, 0.34);
  float cab = max(sdBox(a, vec2(0.13, 0.07)), dot(a, normalize(vec2(-0.7, 1.0))) - 0.06);
  cab = min(cab, sdBox(a - vec2(0.09, -0.02), vec2(0.07, 0.06)));
  float tunnel = sdBox(a - vec2(0.0, 0.085), vec2(0.03, 0.02));
  float dish = max(sdCircle(q - o - vec2(0.12, 0.47), 0.035), -sdCircle(q - o - vec2(0.12, 0.49), 0.034));
  float mast = sdSegment(q, o + vec2(0.09, 0.4), o + vec2(0.12, 0.45)) - 0.003;
  // Legs splayed out to their pads; the ladder on the front leg.
  float legs = 1e9;
  for (int i = -1; i <= 1; i += 2) {
    vec2 top = o + vec2(float(i) * 0.15, 0.18), foot = o + vec2(float(i) * 0.33, 0.012);
    legs = min(legs, sdSegment(q, top, foot) - 0.006);
    legs = min(legs, sdSegment(q, o + vec2(float(i) * 0.19, 0.13), foot + vec2(0.0, 0.02)) - 0.003);
    legs = min(legs, sdEllipse(q - foot, vec2(0.03, 0.009)));
  }
  vec2 lt = o + vec2(-0.1, 0.14), lb = vec2(-0.02, 0.012);
  float rails = min(sdSegment(q, lt, lb) - 0.003, sdSegment(q, lt + vec2(0.035, 0.0), lb + vec2(0.035, 0.0)) - 0.003);
  float rungs = 1e9;
  for (int i = 1; i < 8; i++) {
    vec2 c = mix(lb, lt, float(i) / 8.0);
    rungs = min(rungs, sdSegment(q, c, c + vec2(0.035, 0.0)) - 0.0022);
  }
  float frontPad = sdEllipse(q - vec2(-0.005, 0.012), vec2(0.045, 0.012));
  float porch = sdBox(q - lt - vec2(0.02, 0.012), vec2(0.035, 0.004));
  d = min(min(oct, cab), min(tunnel, dish));
  d = min(d, min(mast, legs));
  d = min(d, min(min(rails, rungs), min(frontPad, porch)));
  if (oct <= d + 1e-5) mat = 1.0;
  else if (legs <= d + 1e-5 || rails <= d + 1e-5 || rungs <= d + 1e-5 || frontPad <= d + 1e-5 || porch <= d + 1e-5) mat = 4.0;
  else if (dish <= d + 1e-5 || mast <= d + 1e-5) mat = 2.0;
  return d;
}

// The astronaut in his suit: a bulky figure with a big helmet and gold visor, the life-support
// pack on his back. He faces the ladder (+x), his hands on its rails, standing on the footpad; his
// left boot reaches back and down to the regolith and is planted at uStep = 0.
float astronaut(vec2 q, vec2 base, float s, out float visor, out float pack) {
  vec2 r = (q - base) / s;
  float st = smoothstep(-0.9, 0.0, uStep);
  float after = smoothstep(0.2, 2.5, uStep);
  Pose f;
  f.hip = vec2(-0.02 - 0.08 * st - 0.1 * after, 0.56 - 0.03 * st);
  f.neck = f.hip + vec2(0.06 - 0.03 * after, 0.3);
  f.head = f.neck + vec2(0.03, 0.105);
  f.footF = vec2(0.06, 0.1);                                // on the footpad
  f.footN = mix(vec2(-0.08, 0.2), vec2(-0.3, 0.035), st);    // stepping back down
  f.footF = mix(f.footF, vec2(-0.12, 0.035), after);         // and then the other foot follows
  f.handN = mix(f.neck + vec2(0.2, 0.02), f.neck + vec2(0.12, -0.25), after);
  f.handF = mix(f.neck + vec2(0.22, 0.12), f.neck + vec2(0.14, -0.22), after);
  f.look = -0.15 + 0.35 * after;
  float d = sdFigure(r, f, vec4(0.0, 0.0, 0.0, 0.0), 1.55);
  float helm = sdCircle(r - f.head - vec2(0.0, 0.01), 0.095);
  visor = max(sdCircle(r - f.head - vec2(0.012, 0.0), 0.09), -(r.x - f.head.x - 0.02)) * s;
  pack = sdRoundBox(r - f.neck - vec2(-0.15, -0.17), vec2(0.075, 0.17), 0.03) * s;
  float boots = min(sdRoundBox(r - f.footN - vec2(0.03, -0.012), vec2(0.07, 0.03), 0.02), sdRoundBox(r - f.footF - vec2(0.03, -0.012), vec2(0.07, 0.03), 0.02));
  d = min(min(d, helm), boots);
  return min(d * s, pack);
}

void main() {
  vec2 p = centered(vUv, uAspect);
  PX = 1.0 / uRes.y / uZoom;
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  // ---- the ground, rolling to a close, curved horizon.
  vec2 q = Lp(p, 0.4);
  float hz = 0.02 - 0.12 * q.x * q.x + 0.01 * fbm(vec2(q.x * 3.0, 1.0), 3);
  if (q.y < hz + 0.003) {
    float depth = hz - q.y;
    float b = 0.8 + 0.25 * fbm(q * vec2(8.0, 40.0), 4);
    b *= crater(q, vec2(-0.55, hz - 0.03), 0.08) * crater(q, vec2(0.45, hz - 0.012), 0.05) * crater(q, vec2(0.05, hz - 0.05), 0.12);
    vec3 g = REG * SUNC * 0.42 * b * (0.9 + 0.2 * smoothstep(0.0, 0.1, depth));
    float a = cover(q.y - hz, PX);
    col = mix(col, g, a);
    alpha = max(alpha, a);
  }
  // ---- close by the lander's front leg: its footpad, the ladder, the gold underside of the
  // descent stage above, and the astronaut stepping off the pad.
  q = Lp(p, 1.0);
  float gy = -0.3;
  float ground = gy + 0.004 * fbm(vec2(q.x * 10.0, 2.0), 3);
  const float LS = 1.4;                          // the lander's scale here
  vec2 padAt = vec2(-0.02, ground);
  vec2 lq = (q - padAt) / LS;
  if (q.y < ground + 0.003) {
    float depth = ground - q.y;
    float b = 0.85 + 0.25 * fbm(q * vec2(14.0, 70.0), 4) + 0.08 * hash12(floor(q * 300.0));
    b *= crater(q, vec2(-0.62, ground - 0.035), 0.1) * crater(q, vec2(0.62, ground - 0.05), 0.08);
    // The shadows run away from the sun to the right: the lander's legs and body, the astronaut.
    vec2 sq = vec2(q.x - (ground - q.y) * 2.5 - 0.02, ground + (ground - q.y) * 5.0);
    float m0;
    float lsh = lander((sq - padAt) / LS, m0) * LS;
    float ash = sdEllipse(q - vec2(0.06, ground - 0.012), vec2(0.13, 0.01));
    float shadow = cover(min(lsh, ash), PX * 2.0);
    vec2 bp = vec2(-0.13, ground - 0.008);
    float print = cover(sdRoundBox(q - bp, vec2(0.03, 0.008), 0.005), PX) * step(0.0, uStep);
    vec3 g = REG * SUNC * 0.46 * b * (1.0 - 0.92 * shadow) * (1.0 - 0.5 * print);
    float a = cover(q.y - ground, PX);
    col = mix(col, g, a);
    alpha = max(alpha, a);
  }
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    vec3 h = hash31(fi * 9.1 + 4.0);
    vec2 c = vec2(-0.85 + 1.7 * h.x, ground - 0.012 - 0.06 * h.y * h.y);
    float r = 0.004 + 0.01 * h.z * (1.0 - h.y * 0.5);
    float rock = sdEllipse(q - c - vec2(0.0, r * 0.4), vec2(r, r * 0.7)) + 0.002 * gnoise(q * 400.0);
    float sh = sdEllipse(q - c - vec2(r * 1.8, 0.0), vec2(r * 1.6, r * 0.35));
    col *= 1.0 - 0.85 * cover(sh, PX);
    vec3 rc = REG * SUNC * 0.4 * (0.4 + 0.8 * smoothstep(r, -r, q.x - c.x));
    col = mix(col, rc, cover(rock, PX));
  }
  float mat;
  float ld = lander(lq, mat) * LS;
  if (ld < 0.006) {
    vec2 e = vec2(0.0015, 0.0);
    float m2;
    vec2 g = normalize(vec2(lander((q + e.xy - padAt) / LS, m2), lander((q + e.yx - padAt) / LS, m2)) * LS - ld + 1e-7);
    float lit = max(dot(g, SUNDIR), 0.0);
    float k = clamp(-ld / 0.03, 0.0, 1.0);
    vec3 c;
    if (mat == 1.0) {
      // Crumpled Kapton foil: Voronoi facets at random angles, each catching the sun
      // differently; the octagon's panels turn away from the light to the right.
      vec2 fq = lq * vec2(46.0, 58.0);
      vec2 w = worley(fq);
      vec2 cell = floor(fq + 0.5);
      float facet = 0.0;
      {
        // The facet's own brightness: a hash of its nearest seed, found again cheaply.
        vec2 n = floor(fq), f = fract(fq);
        float best = 9.0;
        for (int j = -1; j <= 1; j++)
          for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(i, j);
            vec2 r = g + hash22(n + g) - f;
            float dd = dot(r, r);
            if (dd < best) { best = dd; facet = hash12(n + g + 17.0); }
          }
      }
      float crease = smoothstep(0.1, 0.0, w.y - w.x);
      float panel = clamp((lq.x - 0.33) / 0.2, -1.0, 1.0);
      float turn = smoothstep(0.6, -0.4, panel);
      float glint = pow(facet, 14.0) * 3.5;
      c = GOLD * SUNC * (0.06 + turn * (0.22 + 0.55 * facet) + glint * turn) * (1.0 - 0.4 * crease);
    } else if (mat == 4.0) {
      c = vec3(0.62, 0.6, 0.56) * SUNC * (0.06 + 0.55 * max(lit, 0.2 * (1.0 - k)));
    } else {
      // The ascent stage: grey and black panels, the dark hatch and the two triangular windows,
      // lit on its left facets.
      float turn = smoothstep(0.08, -0.06, lq.x - 0.33 - (lq.y - 0.34) * 0.3);
      float panel = step(0.5, fract(lq.x * 7.0 + 0.3)) * step(0.3, fract(lq.y * 9.0));
      c = mix(vec3(0.66, 0.67, 0.68), vec3(0.56, 0.57, 0.58), panel) * SUNC * (0.06 + 0.5 * turn);
      vec2 a = lq - vec2(0.33, 0.34);
      if (sdBox(a - vec2(0.0, -0.025), vec2(0.028, 0.03)) < 0.0) c = vec3(0.03);
      for (int i = -1; i <= 1; i += 2) {
        vec2 wq = a - vec2(float(i) * 0.06, 0.03);
        if (wq.y > -0.018 && wq.y < 0.02 - 1.2 * abs(wq.x)) c = vec3(0.01);
      }
    }
    col = mix(col, c, cover(ld, PX));
    alpha = max(alpha, cover(ld, PX));
  }
  {
    vec2 base = vec2(-0.045, ground + 0.006);
    float s = 0.235;
    float visor, pack;
    float d = astronaut(q, base, s, visor, pack);
    if (d < 0.006) {
      vec2 e = vec2(0.0012, 0.0);
      float v2, p2;
      vec2 g = normalize(vec2(astronaut(q + e.xy, base, s, v2, p2), astronaut(q + e.yx, base, s, v2, p2)) - d + 1e-7);
      float k = clamp(-d / 0.03, 0.0, 1.0);
      vec3 n = normalize(vec3(g * (1.0 - k * k), 0.35 + k));
      float dif = max(dot(n, normalize(vec3(SUNDIR, 0.45))), 0.0);
      // White suit: bright on the sunlit side, grey-blue where only the ground lights it.
      vec3 c = vec3(0.88, 0.88, 0.86) * (SUNC * 0.6 * dif) + vec3(0.1, 0.105, 0.12) * (0.5 + 0.5 * max(-n.y, 0.0));
      // Faint seams and folds.
      c *= 0.94 + 0.06 * sin(dot(q, vec2(0.0, 1.0)) * 900.0 * s);
      if (visor < 0.0) {
        vec2 vc = q - base - vec2(0.02, 0.9) * s;
        c = vec3(0.45, 0.28, 0.06) * 0.35 + vec3(1.0, 0.85, 0.45) * 0.3 * smoothstep(0.03, -0.01, vc.y + vc.x * 0.5);
        c += vec3(1.0, 0.95, 0.8) * 8.0 * exp(-length(vc - vec2(-0.006, 0.01)) / 0.0035);
      }
      if (pack < 0.0 && pack <= d + 1e-4) c = vec3(0.8, 0.8, 0.78) * (SUNC * 0.45 * dif + vec3(0.07));
      col = mix(col, c, cover(d, PX));
      alpha = max(alpha, cover(d, PX));
    }
  }
  // Dust kicked up by the boot: grains on ballistic arcs under a sixth of Earth's gravity.
  if (uStep > 0.0 && uStep < 1.8) {
    vec2 foot = vec2(-0.13, ground);
    for (int i = 0; i < 50; i++) {
      float fi = float(i);
      vec3 h = hash31(fi * 7.13);
      float ang = mix(0.25, 2.9, h.x);
      float v = 0.1 + 0.22 * h.y;
      vec2 pos = foot + vec2(cos(ang), sin(ang) * 0.6) * v * uStep - vec2(0.0, 0.2 * uStep * uStep);
      if (pos.y < ground - 0.005) continue;
      float a = exp(-dot(q - pos, q - pos) / (PX * PX * 2.0)) * smoothstep(1.8, 0.9, uStep);
      col += REG * SUNC * 0.6 * a;
      alpha = max(alpha, a);
    }
  }
  fragColor = vec4(col * 1.0, alpha);
}
