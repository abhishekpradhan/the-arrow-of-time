// Space, 1957: the night of 4 October at Baikonur. The R-7 that will carry Sputnik stands in its
// "tulip", held at the waist by four arms over the flame pit, white under the searchlights whose
// beams cross in the cold air, liquid-oxygen frost smoking down its flanks. Engineers watch from
// the bunker's mound. At ignition (cue launch) fire and steam burst out of the pit and roll
// across the steppe, the tulip's arms swing open as the rocket lifts, and the camera tilts up
// after it on its column of flame. The film cuts to orbit (cue sputnik).
#include <arrow-of-time/civ-common>

const float HY = -0.12;
const vec3 INK = vec3(0.008, 0.009, 0.014);
const vec3 FIRE = vec3(1.0, 0.6, 0.25);
uniform float uIgnite;   // seconds since ignition (< 0 before)
uniform float uLift;     // how far the rocket has risen (mid-ground units)

// The R-7 seen from the side: the slender core stage with its payload fairing, and the four
// strap-on boosters, cones that flare from a point two thirds of the way up the core to a base
// three and a half times its width (two seen in profile, one in front). Feet at the origin.
float r7(vec2 r, out float front) {
  float core = max(abs(r.x) - mix(0.0125, 0.0105, smoothstep(0.24, 0.3, r.y)), max(-r.y + 0.004, r.y - 0.31));
  float nose = sdTriangle(r, vec2(-0.0105, 0.309), vec2(0.0105, 0.309), vec2(0.0, 0.352));
  float d = min(core, nose);
  front = 1e9;
  for (int i = -1; i <= 1; i += 2) {
    float side = float(i);
    // A booster in profile: its outer edge bows out a little, its inner edge runs up the core.
    vec2 top = vec2(side * 0.0125, 0.215);
    vec2 outer = vec2(side * 0.044, 0.012);
    vec2 r2 = vec2(r.x * side, r.y);
    float t = clamp((r2.y - outer.y) / (top.y - outer.y), 0.0, 1.0);
    float edge = mix(0.044, 0.0125, t) + 0.006 * sin(3.1416 * t);
    float boost = max(max(r2.x - edge, 0.004 - r2.x), max(0.004 - r2.y, r2.y - top.y));
    d = min(d, boost);
    // Its engine nozzles.
    d = min(d, sdBox(r - vec2(side * 0.028, 0.004), vec2(0.012, 0.005)));
  }
  // The booster facing us, over the core.
  float t = clamp(r.y / 0.215, 0.0, 1.0);
  front = max(abs(r.x) - mix(0.016, 0.004, t), max(-r.y + 0.004, r.y - 0.215));
  d = min(d, front);
  return d;
}

// A lattice arm of the tulip, hinged at `h` on the pad's rim, leaning in at `ang` (radians from
// vertical, towards the rocket); length len. Returns the distance to its girders.
float arm(vec2 q, vec2 h, float ang, float len, float side) {
  vec2 dir = vec2(-side * sin(ang), cos(ang));
  vec2 nrm = vec2(dir.y, -dir.x);
  vec2 r = vec2(dot(q - h, nrm), dot(q - h, dir));
  float w = 0.006;
  float girders = max(abs(abs(r.x) - w) - 0.0012, max(-r.y, r.y - len));
  float lace = max(abs(fract(r.y / 0.012 + (r.x > 0.0 ? 0.5 : 0.0)) - 0.5) * 0.012 - 0.001 * 1.0, max(abs(r.x) - w, max(-r.y, r.y - len)));
  float counter = sdBox(r - vec2(0.0, -0.012), vec2(0.012, 0.01));
  return min(min(girders, lace), counter);
}

vec3 scene(vec2 p) {
  float e = uElev;
  float ig = uIgnite;
  float burn = smoothstep(0.0, 0.5, ig);
  vec3 col = paintSky(p, HY, uSun, e);
  col += nightStars(p, PX, uGTime, 23.0, 1.0);
  vec2 q = L(p, 1.0);
  vec2 rb = vec2(0.12, HY + 0.035 + uLift);   // the rocket's feet (mid-ground)
  // The glow of the fire in the sky over the pad.
  col += FIRE * burn * 0.35 * exp(-length((q - vec2(rb.x, HY)) * vec2(0.6, 1.0)) * 3.0);

  // ---- far: the steppe, flat to the horizon, a few lights of the cosmodrome.
  vec2 f = L(p, 0.06);
  vec3 air = airAt(f.x, HY, uSun, e);
  fill(col, f.y - HY, PX, inkIn(air, 0.4, INK) + FIRE * burn * 0.06);
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    vec2 lp = vec2(-0.9 + fi * 0.23 + 0.05 * sin(fi * 4.0), HY - 0.002);
    col += vec3(1.0, 0.8, 0.55) * exp(-dot(f - lp, f - lp) / (PX * PX * 2.0)) * 1.2;
  }

  // ---- the launch pad: the rocket in its tulip, the cable mast, searchlights, frost, fire.
  air = airAt(q.x, HY, uSun, e);
  float pad = max(abs(q.x - rb.x) - 0.1, abs(q.y - (HY + 0.02)) - 0.02);
  float padTop = HY + 0.04;
  // Searchlight beams through the cold air, converging on the rocket (fading once it burns).
  vec3 beams = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    vec2 src = k == 0 ? vec2(-0.55, HY) : k == 1 ? vec2(0.85, HY) : vec2(-0.2, HY - 0.05);
    vec2 aim = vec2(rb.x, HY + 0.2);
    vec2 dir = normalize(aim - src);
    vec2 v = q - src;
    float along = dot(v, dir);
    float off = abs(dot(v, vec2(-dir.y, dir.x)));
    float bw = 0.004 + 0.05 * along;
    beams += vec3(0.75, 0.85, 1.0) * exp(-off * off / (bw * bw)) * smoothstep(0.0, 0.1, along) * exp(-along * 1.2) * 0.25;
  }
  col += beams * (1.0 - burn * 0.8);
  // The cable mast beside the rocket: it tips back as the rocket rises.
  float tip = smoothstep(0.05, 0.4, uLift);
  vec2 mb = vec2(rb.x + 0.075, padTop);
  vec2 mq = rot2(-0.35 * tip * tip) * (q - mb);
  float mast = max(abs(mq.x) - 0.005, max(-mq.y, mq.y - 0.26));
  mast = min(mast, max(abs(fract(mq.y / 0.02) - 0.5) * 0.02 - 0.0015, max(abs(mq.x) - 0.012, max(-mq.y, mq.y - 0.26))));
  // The tulip: four arms leaning in to the rocket's waist, swinging open as it lifts.
  float open = smoothstep(0.0, 0.15, uLift) * 0.6;
  float tul = min(arm(q, vec2(rb.x - 0.07, padTop), 0.33 - open, 0.21, -1.0), arm(q, vec2(rb.x + 0.07, padTop), 0.33 - open, 0.21, 1.0));
  float frame = min(min(pad, mast), tul);
  vec3 steel = INK * 2.0 + vec3(0.55, 0.6, 0.7) * 0.06 * (1.0 - burn) + FIRE * 0.25 * burn;
  col = mix(col, steel, cover(frame, PX));
  // The rocket, lit by the searchlights (a cool side and a bright side), frosted, then by its fire.
  float fr;
  vec2 rr = q - rb;
  float rd = r7(rr, fr);
  if (rd < 0.004) {
    float side = smoothstep(-0.014, 0.014, rr.x);
    float frost = 0.8 + 0.2 * fbm(rr * vec2(300.0, 60.0), 3);
    vec3 body = vec3(0.7, 0.72, 0.76) * frost * (0.12 + 0.55 * side) + vec3(0.12, 0.14, 0.2) * (1.0 - side);
    body += FIRE * burn * 0.4 * smoothstep(0.15, 0.0, rr.y);
    if (fr <= rd + 1e-4) body *= 0.9;
    col = mix(col, body, cover(rd, PX));
  }
  // Frost smoking off the tanks and sliding down the flanks (before ignition).
  float vap = 0.0;
  for (int i = -1; i <= 1; i += 2) {
    vec2 v0 = rb + vec2(float(i) * 0.018, 0.15);
    vec2 vq = q - v0;
    float drop = -vq.y;
    float wv = 0.004 + 0.06 * max(drop, 0.0);
    float n = fbm(vec2(q.x * 70.0, q.y * 40.0 + uGTime * 1.5), 4);
    vap += exp(-pow((vq.x - float(i) * 0.3 * max(drop, 0.0)) / wv, 2.0)) * smoothstep(-0.01, 0.02, drop) * exp(-drop * 7.0) * n;
  }
  col = mix(col, vec3(0.65, 0.7, 0.8) * 0.5, saturate(vap) * 0.55 * (1.0 - burn));
  // The flame: a blinding column under the engines, lengthening as the rocket climbs.
  if (ig > 0.0) {
    vec2 fq = q - rb;
    float below = -fq.y;
    float len = 0.06 + 0.1 * burn + uLift * 0.9;
    float u = clamp(below / len, 0.0, 1.0);
    float width = 0.02 + 0.03 * u;
    float flame = step(0.0, below) * exp(-fq.x * fq.x / (width * width)) * pow(1.0 - u, 1.5) * burn;
    col += mix(vec3(1.0, 0.95, 0.85), FIRE, smoothstep(0.0, 0.5, u)) * flame * 5.0;
    // Fire and steam bursting from the pit and rolling out across the steppe to both sides.
    float spread = 0.08 + 0.55 * sqrt(max(ig, 0.0));
    float cx = abs(q.x - rb.x) / spread;
    float cy = (q.y - HY) / (0.03 + 0.08 * sqrt(max(ig, 0.0)));
    float n = fbm(vec2(q.x * 12.0 - sign(q.x - rb.x) * ig * 0.8, q.y * 14.0 - ig * 0.3), 5);
    float cloud = smoothstep(1.0, 0.4, length(vec2(cx, cy)) - 0.35 * (n - 0.5)) * step(HY - 0.02, q.y);
    vec3 cc = mix(vec3(1.0, 0.85, 0.6) * 2.5, vec3(0.6, 0.35, 0.2), smoothstep(0.0, 0.8, cx)) * (0.5 + 0.7 * n);
    col = mix(col, cc, cloud * smoothstep(0.0, 0.3, ig) * 0.95);
  }

  // ---- the bunker's mound and the engineers watching.
  q = L(p, 1.4);
  float mound = -0.26 + 0.05 * exp(-pow((q.x + 0.55) / 0.35, 2.0)) + 0.004 * gnoise(vec2(q.x * 12.0, 3.0));
  float d = q.y - mound;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float s = 0.16;
    vec2 b = vec2(-0.72 + fi * 0.085, -0.26 + 0.05 * exp(-pow((-0.72 + fi * 0.085 + 0.55) / 0.35, 2.0)) - 0.003);
    Pose fp = standPose(sin(uGTime + fi), 0.15 + 0.3 * smoothstep(0.3, 1.5, uLift));
    if (i == 2) fp.handN = fp.neck + vec2(0.1, -0.2);
    d = min(d, sdFigure((q - b) / s, fp, vec4(0.6, 0.0, 0.0, 1.0), 1.1) * s);
  }
  col = mix(col, INK + FIRE * burn * 0.03, cover(d, PX));
  return col;
}
