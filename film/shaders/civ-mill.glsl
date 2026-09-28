// Industry, 1830: dusk over a mill town. The sky burns red behind a forest of chimneys, their
// smoke rolling off into a brown pall lit from below; the mills' windows are lit for the late
// shift. A steam train crosses the brick viaduct, overtaking us, its firebox lighting the plume
// that rolls back over the carriages. On the canal below, a horse still tows a narrowboat along
// the towpath: the old way beside the new.
#include <arrow-of-time/civ-common>

const float HY = -0.075;
const vec3 INK = vec3(0.018, 0.011, 0.012);
const vec3 LAMP = vec3(1.0, 0.58, 0.24);
const vec3 FURNACE = vec3(1.0, 0.36, 0.1);

// The train's position along the viaduct (layer coordinates): it runs right, faster than we do.
float trainX() { return -0.55 + 0.32 * (uT + 0.6); }

// An 1830 locomotive facing +x, rails at y = 0, s its length: a tall chimney, the boiler, a big
// driving wheel, the firebox and footplate, the tender behind. Returns distance; `fire` receives
// the firebox glow.
float locomotive(vec2 q, float s, out float fire) {
  vec2 r = q / s;
  float boiler = sdRoundBox(r - vec2(0.12, 0.3), vec2(0.28, 0.085), 0.08);
  float chim = sdTaper(r, vec2(0.36, 0.36), vec2(0.4, 0.66), 0.035, 0.05);
  chim = min(chim, sdBox(r - vec2(0.4, 0.67), vec2(0.06, 0.02)));
  float dome = sdCircle(r - vec2(0.02, 0.4), 0.05);
  float box = sdBox(r - vec2(-0.2, 0.28), vec2(0.08, 0.12));
  float wheel = abs(sdCircle(r - vec2(0.1, 0.16), 0.15)) - 0.02;
  wheel = min(wheel, sdCircle(r - vec2(0.1, 0.16), 0.035));
  float spoke = abs(dot(rot2(uGTime * 12.0) * (r - vec2(0.1, 0.16)), vec2(0.0, 1.0))) - 0.012;
  wheel = min(wheel, max(spoke, sdCircle(r - vec2(0.1, 0.16), 0.15)));
  float small = sdCircle(r - vec2(0.36, 0.08), 0.075);
  float frame = sdBox(r - vec2(0.08, 0.16), vec2(0.4, 0.025));
  float tender = sdRoundBox(r - vec2(-0.5, 0.2), vec2(0.17, 0.11), 0.02);
  tender = min(tender, min(sdCircle(r - vec2(-0.6, 0.07), 0.07), sdCircle(r - vec2(-0.4, 0.07), 0.07)));
  float d = min(min(min(boiler, chim), min(dome, box)), min(min(wheel, small), min(frame, tender)));
  fire = exp(-length((r - vec2(-0.2, 0.2)) * vec2(1.0, 1.4)) / 0.06);
  return d * s;
}

// An early passenger carriage: a coach body with lit windows, on two axles. s its length.
float carriage(vec2 q, float s, out float win) {
  vec2 r = q / s;
  float body = sdRoundBox(r - vec2(0.0, 0.3), vec2(0.45, 0.15), 0.06);
  float roof = sdBox(r - vec2(0.0, 0.47), vec2(0.4, 0.02));
  float wheels = min(sdCircle(r - vec2(-0.25, 0.08), 0.08), sdCircle(r - vec2(0.25, 0.08), 0.08));
  float d = min(min(body, roof), wheels);
  vec2 wq = vec2(fract((r.x + 0.45) / 0.3) - 0.5, r.y - 0.33);
  win = step(abs(wq.x), 0.17) * step(abs(wq.y), 0.06) * step(abs(r.x), 0.42);
  return d * s;
}

vec3 scene(vec2 p) {
  float e = uElev;
  SkyTone st = skyTone(e);
  vec3 col = paintSky(p, HY, uSun, e);
  vec4 c1 = stratus(p, uSun, e, HY, 0.1, 0.06, 0.6, uGTime, 11.0);
  col = col * (1.0 - c1.a) + c1.rgb;
  col += nightStars(p, PX, uGTime, 13.0, st.stars * smoothstep(0.1, 0.3, p.y - HY));

  // ---- far: the moors, dark against the afterglow.
  vec2 q = L(p, 0.1);
  vec3 air = airAt(q.x, HY, uSun, e);
  float moor = HY + 0.012 + 0.018 * fbm(vec2(q.x * 1.4 + 9.0, 1.0), 4);
  fill(col, q.y - moor, PX, inkIn(air, 0.55, INK));

  // ---- the mill town: long mills with rows of lit windows, a forest of chimneys, the smoke.
  q = L(p, 0.28);
  air = airAt(q.x, HY, uSun, e);
  float cw = 0.14;
  float c0 = floor(q.x / cw);
  float town = q.y - (HY - 0.01);
  float lit = 0.0;
  for (int j = -1; j <= 1; j++) {
    float c = c0 + float(j);
    vec4 h = hash42(vec2(c, 51.0));
    float x = (c + 0.5) * cw + (h.x - 0.5) * 0.04;
    float mw = cw * (0.3 + 0.12 * h.y), mh = 0.06 + 0.05 * h.z;
    float mill = sdBox(q - vec2(x, HY - 0.01 + mh * 0.5), vec2(mw, mh * 0.5));
    // Rows of tall windows, most of them lit.
    vec2 wq = vec2((q.x - x + mw) / 0.011, (q.y - HY + 0.01) / 0.012);
    vec2 f = fract(wq);
    float w = step(0.3, f.x) * step(f.x, 0.72) * step(0.25, f.y) * step(f.y, 0.75) * step(0.3, hash12(floor(wq) + c));
    if (mill < 0.0) lit = max(lit, w * step(0.6, wq.x) * step(wq.x, mw * 2.0 / 0.011 - 0.5) * step(q.y, HY - 0.01 + mh - 0.004));
    float chim = sdTaper(q, vec2(x + mw * 0.7, HY - 0.01), vec2(x + mw * 0.7, HY + mh + 0.07 + 0.06 * h.w), 0.008, 0.0055);
    float chim2 = h.x > 0.5 ? sdTaper(q, vec2(x - mw * 0.4, HY - 0.01), vec2(x - mw * 0.4, HY + mh + 0.04 + 0.04 * h.x), 0.007, 0.005) : 1e9;
    town = min(town, min(mill, min(chim, chim2)));
  }
  col = mix(col, inkIn(air, 0.3, INK) + LAMP * lit * 1.3, cover(town, PX));
  // Smoke from the chimneys: billowing columns that bend away east and spread into a brown pall,
  // lit from below by the furnaces and the afterglow.
  float smoke = 0.0, hot = 0.0;
  for (int j = -1; j <= 2; j++) {
    float c = c0 + float(j);
    vec4 h = hash42(vec2(c, 51.0));
    float x = (c + 0.5) * cw + (h.x - 0.5) * 0.04;
    float mw = cw * (0.3 + 0.12 * h.y), mh = 0.06 + 0.05 * h.z;
    vec2 top = vec2(x + mw * 0.7, HY + mh + 0.07 + 0.06 * h.w);
    vec2 r = q - top;
    float rise = r.y;
    if (rise < -0.005 || rise > 0.3) continue;
    // The column leans more the higher it gets (the wind above the roofs).
    float cx = 0.35 * rise + 1.2 * rise * rise + 0.01 * sin(rise * 30.0 - uGTime * 2.0 + c);
    float w = 0.006 + 0.1 * rise;
    float xx = (r.x - cx) / w;
    float n = fbm(vec2(q.x * 22.0 - uGTime * 0.5, q.y * 22.0 - uGTime * 0.9) + c * 3.0, 5);
    float dens = exp(-xx * xx * 1.6) * (0.55 + 0.9 * n) * smoothstep(-0.005, 0.01, rise) * exp(-rise * 5.0);
    smoke = max(smoke, saturate(dens));
    hot = max(hot, saturate(dens) * exp(-rise * 25.0));
  }
  float pall = smoothstep(HY + 0.1, HY + 0.2, q.y) * smoothstep(HY + 0.36, HY + 0.22, q.y) * smoothstep(0.35, 0.72, fbm(q * vec2(3.0, 10.0) + vec2(-uGTime * 0.03, 0.0), 5));
  smoke = max(smoke, pall * 0.55);
  vec3 smc = mix(vec3(0.2, 0.1, 0.09), vec3(0.09, 0.06, 0.08), smoothstep(HY, HY + 0.3, q.y)) + FURNACE * 0.35 * hot + st.glow * 0.12 * smoothstep(0.5, 0.0, abs(q.x - uSun.x));
  col = mix(col, smc, smoke * 0.8);

  // ---- the viaduct and the train crossing it.
  q = L(p, 0.62);
  air = airAt(q.x, HY, uSun, e);
  float deck = -0.05;
  float arches;
  {
    float id = floor(q.x / 0.14 + 0.5);
    float ax = q.x - id * 0.14;
    float opening = max(length(vec2(ax, max(q.y - (deck - 0.055), 0.0))) - 0.048, -(q.y + 0.2));
    arches = max(max(q.y - deck, -0.2 - q.y), -opening);
    arches = min(arches, sdBox(q - vec2(0.0, deck + 0.008), vec2(3.0, 0.008)));
  }
  vec3 brick = inkIn(air, 0.1, INK) + FURNACE * 0.03;
  col = mix(col, brick, cover(arches, PX));
  float tx = trainX();
  float fire;
  float d = locomotive(q - vec2(tx, deck + 0.016), 0.13, fire);
  float cwin = 0.0;
  for (int i = 0; i < 3; i++) {
    float w;
    float cd = carriage(q - vec2(tx - 0.16 - 0.1 * float(i), deck + 0.016), 0.085, w);
    if (cd < d) { d = cd; cwin = w; }
  }
  col = mix(col, INK + LAMP * cwin * 1.6, cover(d, PX));
  col += FURNACE * fire * 2.0;
  // The plume: steam and smoke rolling back from the chimney over the train, lit by the
  // firebox from below, sparks flying.
  vec2 ch = vec2(tx + 0.052, deck + 0.016 + 0.087);
  vec2 rel = q - ch;
  float along = -rel.x;
  if (along > -0.02) {
    float rise = 0.08 * sqrt(max(along, 0.0)) + 0.04 * along;
    float w = 0.016 + 0.12 * sqrt(max(along, 0.0));
    float y = (rel.y - rise) / w;
    float n = fbm(vec2(q.x * 30.0 + uGTime * 3.0, q.y * 30.0), 4);
    float dens = exp(-y * y * 1.3) * smoothstep(-0.02, 0.01, along) * exp(-along * 1.1) * (0.6 + 0.9 * n);
    vec3 pc = mix(vec3(0.35, 0.3, 0.32), vec3(0.1, 0.08, 0.1), smoothstep(-0.5, 1.0, y));
    pc += FURNACE * 0.9 * exp(-along * 6.0) * smoothstep(0.5, -1.0, y);
    col = mix(col, pc, saturate(dens * 1.4) * 0.85);
  }
  for (int i = 0; i < 18; i++) {
    float fi = float(i);
    vec3 h = hash31(fi * 4.3 + 7.0);
    float age = fract(uGTime * (0.8 + 0.4 * h.x) + h.y);
    vec2 sp = ch + vec2(-0.35 * age - 0.05 * h.z, 0.12 * age - 0.18 * age * age + 0.02 * h.x);
    col += FURNACE * exp(-length(q - sp) / (PX * 1.2)) * (1.0 - age) * 2.0;
  }

  // ---- the canal: a strip of dusk sky, a narrowboat towed by a horse on the towpath.
  q = L(p, 1.0);
  air = airAt(q.x, HY, uSun, e);
  float bankTop = -0.21, water = -0.225;
  fill(col, q.y - bankTop, PX, INK * 1.3);
  if (q.y < water && q.y > -0.29) {
    vec2 m = vec2(p.x + 0.003 * gnoise(vec2(q.x * 30.0, uGTime)), 2.0 * water - p.y + 0.12);
    col = mix(col, paintSky(m, HY, uSun, e) * 0.45, 1.0);
  }
  fill(col, q.y + 0.29, PX, INK);
  {
    float bx = -0.3 + 0.05 * uT;
    float boat = sdBox(q - vec2(bx, water + 0.004), vec2(0.13, 0.01));
    boat = min(boat, sdBox(q - vec2(bx - 0.06, water + 0.02), vec2(0.04, 0.012)));
    float hs = 0.11;
    vec2 hb = vec2(bx + 0.42, bankTop);
    float horse = sdHorse((q - hb) / hs, uGTime * 4.0) * hs;
    float rope = sdSegment(q, vec2(bx + 0.1, water + 0.03), hb + vec2(0.0, 0.08)) - 0.0008;
    Pose f = walkPose(uGTime * 4.0 + 2.0, 0.15);
    float man = sdFigure((q - hb - vec2(0.12, 0.0)) / 0.13, f, vec4(0.0, 0.0, 0.0, 1.0), 1.0) * 0.13;
    fill(col, min(min(boat, horse), min(rope, man)), PX, INK * 0.9);
  }
  // ---- close by: a gas lamp, newly lit.
  q = L(p, 2.2);
  vec2 lampAt = vec2(-0.75, 0.06);
  float post = sdTaper(q, vec2(-0.75, -0.5), lampAt, 0.012, 0.007);
  float head = sdTriangle(q, lampAt + vec2(-0.03, 0.0), lampAt + vec2(0.03, 0.0), lampAt + vec2(0.0, 0.05));
  col = mix(col, INK * 0.6, soft(min(post, head), 3.0));
  col = mix(col, LAMP * 3.0, soft(sdBox(q - lampAt - vec2(0.0, 0.015), vec2(0.018, 0.014)), 2.0));
  col += LAMP * 0.35 * exp(-length(q - lampAt - vec2(0.0, 0.015)) / 0.06);
  return col;
}
