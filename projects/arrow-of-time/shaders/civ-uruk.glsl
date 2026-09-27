// Cities, 4000 BCE: Uruk in the morning. The sun is up over the plain to the east; the White
// Temple on its high terrace catches it, whitewashed above a city of flat mud-brick roofs where
// the hearths are smoking and date palms stand among the houses. A canal of the Euphrates runs
// in front, mirror-still: men pole reed boats along it, and a man leads a laden donkey along the
// bank. Buildings are painted in two tones, a lit face and a shadow face, with long shadows.
#include <arrow-of-time/civ-common>

const float HY = -0.035;
const vec3 INK = vec3(0.022, 0.016, 0.014);
const vec3 BRICK = vec3(0.6, 0.46, 0.32);
const vec3 WHITE = vec3(0.92, 0.9, 0.84);

vec3 sunLight() { return mix(vec3(1.0, 0.6, 0.28), vec3(1.0, 0.85, 0.65), smoothstep(4.0, 20.0, uElev)) * 2.1; }
vec3 skyLight() { return vec3(0.1, 0.13, 0.22); }

// A flat-roofed block seen a little from the left: its front, its left side (in the sun) and
// its roof. b = (centre x, ground y, half width, height). Returns coverage; col receives the lit
// colour (unhazed).
float block(vec2 q, vec4 b, vec3 alb, out vec3 c) {
  float w = b.z, h = b.w;
  vec2 o = vec2(-0.45 * w, 0.2 * w);            // the depth of the block, drawn obliquely
  float front = sdBox(q - vec2(b.x, b.y + h * 0.5), vec2(w, h * 0.5));
  float side = sdTriangle(q, vec2(b.x - w, b.y), vec2(b.x - w, b.y + h), vec2(b.x - w, b.y + h) + o);
  side = min(side, sdTriangle(q, vec2(b.x - w, b.y), vec2(b.x - w, b.y + h) + o, vec2(b.x - w, b.y) + o));
  float roof = sdTriangle(q, vec2(b.x - w, b.y + h), vec2(b.x + w, b.y + h), vec2(b.x + w, b.y + h) + o);
  roof = min(roof, sdTriangle(q, vec2(b.x - w, b.y + h), vec2(b.x + w, b.y + h) + o, vec2(b.x - w, b.y + h) + o));
  float d = min(front, min(side, roof));
  vec3 L = sunLight(), S = skyLight();
  c = alb * (S + L * 0.42);
  if (side < front && side <= roof) c = alb * (S + L * 0.95);
  if (roof < front && roof < side) c = alb * (S * 1.2 + L * 0.3);
  // Dark doorways and small windows on the front.
  float door = sdBox(q - vec2(b.x + w * 0.35, b.y + h * 0.18), vec2(w * 0.12, h * 0.18));
  if (door < 0.0 && front < 0.0) c *= 0.25;
  return cover(d, PX);
}

// The houses of one row: a block in each cell (or a gap), `s` their scale. Composites them
// over col (hazed by fog) and returns the skyline height nearby (for smoke and shadows).
void houses(inout vec3 col, vec2 q, float y0, float s, float row, float fog, vec3 air) {
  float cellW = 0.07 * s;
  float c0 = floor(q.x / cellW);
  for (int j = 1; j >= -1; j--) {
    float c = c0 + float(j);
    vec4 h = hash42(vec2(c, row));
    if (h.w < 0.18) continue;
    vec4 b = vec4((c + 0.5) * cellW + (h.x - 0.5) * 0.3 * cellW, y0, (0.28 + 0.2 * h.y) * cellW, (0.35 + 0.45 * h.z) * cellW * 1.1);
    vec3 bc;
    float a = block(q, b, BRICK * (0.85 + 0.25 * h.x), bc);
    col = mix(col, mix(bc, air, fog), a);
  }
}

// The terrace of the White Temple: battered mud-brick walls with buttresses, and the temple on
// top, whitewashed and niched. Centre x0, foot y0, scale s. Returns coverage; c the colour.
float temple(vec2 q, float x0, float y0, float s, out vec3 c) {
  vec2 r = (q - vec2(x0, y0)) / s;
  float w = 0.5 - 0.12 * clamp(r.y / 0.22, 0.0, 1.0);
  float terr = max(abs(r.x) - w, max(-r.y, r.y - 0.22));
  float but = abs(fract(r.x * 14.0) - 0.5);
  // Stair up the front, climbing to the left.
  float stair = sdTriangle(r, vec2(0.12, 0.0), vec2(-0.12, 0.2), vec2(0.12, 0.2));
  // The temple: a long hall with niched walls.
  float hall = sdBox(r - vec2(0.02, 0.27), vec2(0.23, 0.05));
  float niche = abs(fract(r.x * 22.0) - 0.5);
  float d = min(min(terr, hall), max(stair, -r.y));
  vec3 L = sunLight(), S = skyLight();
  // The terrace's lit left face (the batter) and its front.
  if (hall < terr) {
    // The whitewashed hall: its front half-lit and striped by the shadows of its niches, its
    // east end blazing, a band of shade under the eaves.
    c = WHITE * (S * 0.9 + L * (0.36 + 0.22 * step(0.3, niche)));
    if (r.x < -0.19) c = WHITE * (S + L * 1.05);
    if (r.y > 0.305) c *= 0.7;
  } else {
    c = BRICK * (S + L * (0.38 + 0.1 * step(0.25, but)));
    if (r.x < -w + 0.03) c = BRICK * (S + L * 0.9);
    if (stair < 0.0 && r.y > 0.0) c = BRICK * (S + L * 0.6) * (0.85 + 0.15 * step(0.5, fract(r.y * 60.0)));
  }
  return cover(d * s, PX);
}

// A reed boat (a mashoof): long, slender, both ends curling up. Length s, facing +x.
float reedBoat(vec2 q, float s) {
  vec2 r = q / s;
  float hull = sdEllipse(r - vec2(0.0, 0.02), vec2(0.5, 0.04));
  hull = max(hull, r.y - 0.03);
  float bow = sdBezierTaper(r, vec2(0.4, 0.02), vec2(0.52, 0.03), vec2(0.56, 0.12), 0.025, 0.01);
  float stern = sdBezierTaper(r, vec2(-0.4, 0.02), vec2(-0.52, 0.03), vec2(-0.55, 0.1), 0.025, 0.01);
  return min(hull, min(bow, stern)) * s;
}

// The whole city (layer coordinates q): for the view and, mirrored, for the canal.
void city(inout vec3 col, vec2 q, vec3 air) {
  // A low mound (the tell) under the city.
  float tell = HY - 0.006 + 0.012 * exp(-pow((q.x - 0.15) / 0.6, 2.0));
  fill(col, q.y - tell, PX, mix(BRICK * (skyLight() + sunLight() * 0.35), air, 0.3));
  houses(col, q, tell, 0.7, 1.0, 0.22, air);
  vec3 tc;
  float a = temple(q, 0.2, tell, 0.5, tc);
  col = mix(col, mix(tc, air, 0.08), a);
  // Palms among the houses.
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float x = -0.7 + fi * 0.27 + 0.05 * sin(fi * 3.3);
    if (abs(x - 0.2) < 0.26) continue;
    float s = 0.07 + 0.02 * fract(fi * 0.61);
    fill(col, sdDatePalm(q - vec2(x, tell - 0.002), uGTime, fi, s), PX, mix(INK, air, 0.3));
  }
  houses(col, q, tell - 0.012, 0.95, 2.0, 0.12, air);
  // The city wall along the front, its towers every so often.
  float wallY = tell - 0.02;
  float tw = abs(fract(q.x / 0.16) - 0.5) * 0.16;
  float wall = max(q.y - wallY - 0.018 - 0.012 * step(tw, 0.018), wallY - 0.03 - q.y);
  vec3 wc = BRICK * (skyLight() + sunLight() * 0.45) * (0.9 + 0.1 * step(0.012, tw));
  fill(col, wall, PX, mix(wc, air, 0.08));
}

vec3 scene(vec2 p) {
  float e = uElev;
  SkyTone st = skyTone(e);
  vec3 col = paintSky(p, HY, uSun, e);
  // A clearer morning than the dawn: deepen the sky away from the sun.
  col = mix(col, col * vec3(0.72, 0.8, 1.05), smoothstep(0.02, 0.35, p.y - HY) * smoothstep(0.2, 0.9, abs(p.x - uSun.x)));
  vec4 c1 = stratus(p, uSun, e, HY, 0.22, 0.07, 0.45, uGTime, 2.0);
  col = col * (1.0 - c1.a) + c1.rgb;
  col += sunDisc(p, uSun, 0.03, e);
  // A far line of palm groves on the flat plain.
  vec2 q = L(p, 0.05);
  vec3 air = airAt(q.x, HY, uSun, e);
  float grove = HY + 0.004 + 0.006 * smoothstep(0.4, 0.8, fbm(vec2(q.x * 30.0, 1.0), 3));
  fill(col, q.y - grove, PX, inkIn(air, 0.8, INK));

  // ---- the city, with the smoke of its hearths drifting east.
  q = L(p, 0.3);
  air = airAt(q.x, HY, uSun, e);
  city(col, q, air);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float hh;
    float sm = smokeColumn(q, vec2(-0.55 + fi * 0.37 + 0.05 * sin(fi * 2.0), HY + 0.02), 0.5, 0.12, 0.009, uGTime, fi * 3.0, hh);
    col = mix(col, air * 1.05, sm * 0.3 * (1.0 - hh));
  }

  // ---- the canal: still water mirroring the sky and the city, with reed boats on it.
  float bank = -0.075;
  vec2 qc = L(p, 0.6);
  if (qc.y < bank) {
    float depth = bank - qc.y;
    float rip = 0.002 * gnoise(vec2(qc.x * 40.0, qc.y * 220.0 - uGTime * 0.8)) * smoothstep(0.0, 0.05, depth);
    vec2 m = vec2(p.x + rip, 2.0 * (bank + (p.y - qc.y)) - p.y);
    vec3 refl = paintSky(m, HY, uSun, e);
    vec2 mq = L(m, 0.3);
    city(refl, mq, airAt(mq.x, HY, uSun, e));
    col = refl * vec3(0.55, 0.58, 0.62) + vec3(0.01, 0.015, 0.02);
    col += sunLight() * 0.4 * exp(-abs(p.x - uSun.x + rip * 20.0) / 0.02) * smoothstep(0.0, 0.01, depth) * step(depth, 0.06);
  }
  // Boats on the canal.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float dir = i == 1 ? -1.0 : 1.0;
    float s = 0.09 - 0.015 * fi;
    vec2 base = vec2(-0.55 + fi * 0.62 + dir * 0.025 * uT, bank - 0.018 - 0.01 * fi);
    vec2 bq = qc - base;
    bq.x *= dir;
    float d = reedBoat(bq, s);
    Pose f = standPose(0.0, 0.0);
    float push = sin(uGTime * 1.6 + fi * 2.0);
    f.handN = f.neck + vec2(0.12 + 0.05 * push, 0.05);
    f.handF = f.neck + vec2(0.05 + 0.05 * push, -0.12);
    float fs = s * 0.45;
    vec2 fq = (bq - vec2(-0.1 * s, 0.03 * s)) / fs;
    d = min(d, sdFigure(fq, f, vec4(0.0, 0.8, 0.0, 0.0), 1.0) * fs);
    vec2 pole0 = vec2(-0.1 * s, 0.03 * s) + (f.neck + vec2(0.12 + 0.05 * push, 0.05)) * fs;
    d = min(d, sdSegment(bq, pole0 + vec2(0.05, 0.25) * s, pole0 + vec2(-0.03, -0.3) * s) - 0.0015);
    fill(col, d, PX, INK * 1.4);
  }

  // ---- the near bank: a path where a man leads a donkey laden with bales, a woman with a jar.
  q = L(p, 1.0);
  air = airAt(q.x, HY, uSun, e);
  float nb = -0.2 + 0.01 * gnoise(vec2(q.x * 3.0, 3.0));
  fill(col, q.y - nb, PX, mix(INK, BRICK * skyLight(), 0.3));
  {
    float s = 0.08;
    vec2 base = vec2(-0.2 + 0.07 * uT, nb - 0.005);
    float d = sdDonkey((q - base) / s, uGTime * 5.0) * s;
    d = min(d, sdRoundBox(q - base - vec2(-0.004, 0.07), vec2(0.026, 0.016), 0.008));
    float ms = 0.16;
    vec2 mb = base + vec2(0.085, 0.0);
    Pose f = walkPose(uGTime * 5.0 + 1.0, 0.17);
    f.handF = f.neck + vec2(-0.2, -0.22);
    d = min(d, sdFigure((q - mb) / ms, f, vec4(0.0, 0.9, 0.0, 2.0), 1.0) * ms);
    d = min(d, sdSegment(q, mb + (f.neck + vec2(-0.2, -0.22)) * ms, base + vec2(0.05, 0.09)) - 0.0008);
    fill(col, d, PX, INK * 1.2);
    float ws = 0.155;
    vec2 wb = vec2(0.42 + 0.06 * uT, nb - 0.004);
    Pose w = carryPose(uGTime * 4.8, 0.14);
    float dw = sdFigure((q - wb) / ws, w, vec4(0.8, 0.0, 0.0, 2.0), 1.0) * ws;
    dw = min(dw, sdEllipse(q - wb - (w.head + vec2(0.0, 0.1)) * ws, vec2(0.012, 0.017)));
    fill(col, dw, PX, INK * 1.2);
  }

  // ---- reeds close by, swaying, their plumes lit from behind.
  q = L(p, 2.2);
  float reed = 1e9, plume = 1e9;
  float cell = floor(q.x / 0.035);
  for (int j = -2; j <= 2; j++) {
    float c = cell + float(j);
    vec3 h = hash31(c * 2.3 + 1.0);
    float x = (c + h.x) * 0.035;
    float edge = smoothstep(0.62, 0.9, abs(x - uCam.x * 2.2));
    if (edge < 0.05 || h.z > 0.2 + 0.7 * edge) continue;
    float H = (0.1 + 0.22 * h.y) * (0.4 + 0.8 * edge);
    float sway = 0.02 * sin(uGTime * 1.4 + c * 0.9) + 0.03 * (h.z - 0.6);
    vec2 a = vec2(x, -0.42), b = vec2(x + sway, -0.42 + H);
    reed = min(reed, sdBezierTaper(q, a, a + vec2(sway * 0.2, H * 0.6), b, 0.0035, 0.0015));
    vec2 pq = rot2(-sway * 3.0) * (q - b - vec2(0.0, 0.03));
    plume = min(plume, sdEllipse(pq, vec2(0.009, 0.035)) + 0.004 * gnoise(q * 400.0));
  }
  float thr = 0.1 + 1.2 * exp(-length((p - uSun) * vec2(0.8, 1.4)) * 2.5);
  col = mix(col, INK * 0.7, soft(reed, 4.0));
  col = mix(col, INK * 0.8 + vec3(1.0, 0.75, 0.45) * thr * 0.15, soft(plume, 5.0));
  return col;
}
