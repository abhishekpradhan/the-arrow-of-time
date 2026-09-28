// The Printing Press, 1450: Mainz at sunset. The sun goes down behind the town, the cathedral's
// towers and the steep roofs black against it, the first windows lit. In the street, Gutenberg's
// shop glows through its big window: the pressman heaves on the bar of the press while another
// inks the type, printed sheets drying on lines overhead. From the window above, pages stream
// out over the town on the evening wind, the low sun shining through the paper.
#include <arrow-of-time/civ-common>

const float HY = -0.055;
const vec3 INK = vec3(0.022, 0.013, 0.016);
const vec3 LAMP = vec3(1.0, 0.56, 0.22);
uniform sampler2D uPage;

// Steep-gabled town houses along a row (layer coordinates), with chimneys and the odd dormer;
// `win` receives a lit window here and there (0..1).
float roofs(vec2 q, float y0, float s, float row, out float win) {
  win = 0.0;
  float cw = 0.055 * s;
  float c0 = floor(q.x / cw);
  float d = 1e9;
  for (int j = -1; j <= 1; j++) {
    float c = c0 + float(j);
    vec4 h = hash42(vec2(c, row));
    float x = (c + 0.5) * cw + (h.x - 0.5) * 0.2 * cw;
    float w = cw * (0.36 + 0.2 * h.x), H = cw * (0.6 + 1.1 * h.y * h.y);
    float body = sdBox(q - vec2(x, y0 + H * 0.5), vec2(w, H * 0.5));
    float pitch = 1.2 + 0.8 * h.z;
    float gable = sdTriangle(q, vec2(x - w * 1.1, y0 + H), vec2(x + w * 1.1, y0 + H), vec2(x, y0 + H + w * pitch));
    float chim = h.w > 0.45 ? sdBox(q - vec2(x + w * (h.w - 0.7), y0 + H + w * 0.7 * pitch), vec2(w * 0.09, w * 0.4)) : 1e9;
    float dorm = h.z > 0.7 ? sdBox(q - vec2(x - w * 0.3, y0 + H + w * 0.35), vec2(w * 0.15, w * 0.14)) : 1e9;
    float hd = min(min(body, gable), min(chim, dorm));
    if (hd < d) {
      d = hd;
      // One or two small windows, lit in some houses.
      vec2 wq = vec2((q.x - x) / w, (q.y - y0) / H);
      float lit = step(0.55, h.w) * step(0.3, h.y);
      float w1 = sdBox(wq - vec2(-0.35 + 0.7 * step(0.5, h.x), 0.62), vec2(0.13, 0.12));
      float w2 = sdBox(wq - vec2(0.25, 0.25), vec2(0.13, 0.12)) + step(0.35, h.z) * 9.0;
      win = lit * cover(min(w1, w2) * w, PX);
      if (dorm < body && dorm < gable) win = step(0.8, h.x) * cover(sdBox(q - vec2(x - w * 0.3, y0 + H + w * 0.33), vec2(w * 0.08, w * 0.07)), PX);
    }
  }
  return d;
}

// The cathedral: a long nave, a crossing tower and two west towers with spires.
float cathedral(vec2 q, vec2 o, float s) {
  vec2 r = (q - o) / s;
  float nave = sdBox(r - vec2(0.0, 0.2), vec2(0.5, 0.2));
  nave = min(nave, sdTriangle(r, vec2(-0.52, 0.4), vec2(0.52, 0.4), vec2(0.0, 0.58)));
  float d = nave;
  for (int i = 0; i < 2; i++) {
    float x = -0.55 + float(i) * 0.14;
    d = min(d, sdBox(r - vec2(x, 0.45), vec2(0.05, 0.45)));
    d = min(d, sdTriangle(r, vec2(x - 0.055, 0.9), vec2(x + 0.055, 0.9), vec2(x, 1.35)));
  }
  d = min(d, sdBox(r - vec2(0.25, 0.55), vec2(0.08, 0.2)));
  d = min(d, sdTriangle(r, vec2(0.16, 0.75), vec2(0.34, 0.75), vec2(0.25, 1.0)));
  // Pinnacles along the nave roof.
  float pin = abs(fract(r.x * 6.0) - 0.5) / 6.0;
  d = min(d, max(sdTriangle(vec2(pin, r.y), vec2(-0.02, 0.4), vec2(0.02, 0.4), vec2(0.0, 0.47)), abs(r.x) - 0.45));
  return d * s;
}

// A printed sheet in flight: its centre, turn, flip (the sheet's width shrinks with cos(flip)),
// size. Returns coverage; uv the point on the page; front whether the printed side faces us.
float sheet(vec2 q, vec2 c, float turn, float flip, float size, out vec2 uv, out float front) {
  vec2 r = rot2(-turn) * (q - c);
  float cf = cos(flip);
  float w = size * 0.7 * max(abs(cf), 0.06);
  float d = sdBox(r, vec2(w, size));
  uv = vec2(r.x / w * sign(cf) * 0.5 + 0.5, 0.5 - r.y / size * 0.5);
  front = step(0.0, cf);
  return cover(d, PX);
}

vec3 scene(vec2 p) {
  float e = uElev;
  SkyTone st = skyTone(e);
  vec3 col = paintSky(p, HY, uSun, e);
  vec4 c1 = stratus(p, uSun, e, HY, 0.14, 0.07, 0.6, uGTime, 3.0);
  col = col * (1.0 - c1.a) + c1.rgb;
  vec4 c2 = stratus(p, uSun, e, HY, 0.3, 0.06, 0.5, uGTime, 8.0);
  col = col * (1.0 - c2.a) + c2.rgb;
  col += sunDisc(p, uSun, 0.034, e);
  // Swifts wheeling over the roofs.
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    vec3 h = hash31(fi * 5.1 + 3.0);
    float a = uGTime * (0.6 + 0.4 * h.x) + fi * 1.9;
    vec2 b = vec2(-0.45 + 0.9 * h.y + 0.12 * cos(a), 0.06 + 0.1 * h.z + 0.05 * sin(a * 1.3));
    fill(col, sdBird((p - b) / 0.008, uGTime * 16.0 + fi) * 0.008, PX, INK * 2.0);
  }

  // ---- far: the hills across the Rhine.
  vec2 q = L(p, 0.1);
  vec3 air = airAt(q.x, HY, uSun, e);
  float hills = HY + 0.01 + 0.02 * fbm(vec2(q.x * 1.6 + 4.0, 1.0), 4);
  fill(col, q.y - hills, PX, inkIn(air, 0.62, INK));

  // ---- the town stepping down towards us: the cathedral and a church spire on the skyline,
  // rows of steep roofs, the nearer ones darker, a lit window here and there, chimney smoke.
  q = L(p, 0.3);
  air = airAt(q.x, HY, uSun, e);
  float win;
  float d = roofs(q, HY - 0.012, 0.9, 1.0, win);
  d = min(d, cathedral(q, vec2(-0.3, HY - 0.012), 0.22));
  d = min(d, min(sdBox(q - vec2(0.45, HY + 0.06), vec2(0.012, 0.075)), sdTriangle(q, vec2(0.438, HY + 0.135), vec2(0.462, HY + 0.135), vec2(0.45, HY + 0.23))));
  col = mix(col, inkIn(air, 0.42, INK) + LAMP * win * 0.6, cover(d, PX));
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float hh;
    float sm = smokeColumn(q, vec2(-0.7 + fi * 0.45, HY + 0.045), -0.5, 0.1, 0.008, uGTime, fi * 2.0, hh);
    col = mix(col, air * 0.95, sm * 0.3 * (1.0 - hh));
  }
  q = L(p, 0.5);
  air = airAt(q.x, HY, uSun, e);
  d = roofs(q, HY - 0.075, 1.25, 2.0, win);
  d = min(d, q.y - (HY - 0.075));
  col = mix(col, inkIn(air, 0.22, INK) + LAMP * win * 1.2, cover(d, PX));
  q = L(p, 0.7);
  air = airAt(q.x, HY, uSun, e);
  d = roofs(q, -0.19, 1.7, 3.0, win);
  d = min(d, q.y + 0.19);
  col = mix(col, inkIn(air, 0.1, INK) + LAMP * win * 1.6, cover(d, PX));

  // ---- the street and Gutenberg's shop, its window glowing.
  q = L(p, 1.0);
  air = airAt(q.x, HY, uSun, e);
  float street = -0.25;
  fill(col, q.y - street, PX, INK * 1.2);
  vec2 sp = vec2(0.52, street);            // the shop's front, left end
  float W = 0.44, H = 0.36;
  float front = sdBox(q - sp - vec2(W * 0.5, H * 0.5), vec2(W * 0.5, H * 0.5));
  float gable = sdTriangle(q, sp + vec2(-0.02, H), sp + vec2(W + 0.02, H), sp + vec2(W * 0.5, H + 0.2));
  float house = min(front, gable);
  // Half-timbering picked out by the last of the sky light.
  vec2 hq = q - sp;
  float beams = min(abs(fract(hq.x / 0.055) - 0.5) * 0.055 - 0.004, abs(fract(hq.y / 0.12) - 0.5) * 0.12 - 0.004);
  vec3 hc = mix(vec3(0.07, 0.05, 0.05), vec3(0.03, 0.02, 0.02), cover(beams, PX));
  col = mix(col, hc, cover(house, PX));
  // The big window on the ground floor, and what the lamplight shows inside.
  vec2 wc = sp + vec2(0.2, 0.12);
  float window = sdBox(q - wc, vec2(0.15, 0.085));
  if (window < 0.004) {
    vec3 inside = LAMP * (0.55 + 0.45 * smoothstep(0.1, -0.08, q.y - wc.y)) * (0.9 + 0.1 * sin(uGTime * 9.0));
    vec2 iq = q - wc;
    // The press: two cheeks, head, the screw, the platen coming down, the bar swinging.
    float pull = 0.5 - 0.5 * cos(uGTime * 2.2);
    float pr = min(abs(abs(iq.x - 0.02) - 0.045) - 0.008, 1e9);
    pr = max(pr, abs(iq.y + 0.01) - 0.075);
    pr = min(pr, sdBox(iq - vec2(0.02, 0.058), vec2(0.056, 0.01)));
    pr = min(pr, sdBox(iq - vec2(0.02, 0.03 - 0.012 * pull), vec2(0.008, 0.02)));
    pr = min(pr, sdBox(iq - vec2(0.02, 0.005 - 0.012 * pull), vec2(0.035, 0.006)));
    pr = min(pr, sdBox(iq - vec2(0.02, -0.035), vec2(0.06, 0.01)));
    vec2 bar = vec2(0.02, 0.025) + rot2(-0.9 + 1.1 * pull) * vec2(0.07, 0.0);
    pr = min(pr, sdSegment(iq, vec2(0.02, 0.025), bar) - 0.003);
    // The pressman heaving on the bar, the inker with his two ink balls.
    Pose f = standPose(0.0, 0.0);
    f.hip = vec2(0.0, 0.47);
    f.neck = vec2(-0.08 * pull + 0.05, 0.78);
    f.head = f.neck + vec2(0.03, 0.1);
    f.handN = (bar - vec2(0.12, -0.075)) / 0.15;
    f.handF = f.handN + vec2(-0.02, -0.02);
    float man = sdFigure((iq - vec2(0.12, -0.075)) / 0.15 * vec2(-1.0, 1.0), f, vec4(0.0, 0.6, 0.0, 2.0), 1.0) * 0.15;
    Pose g2 = standPose(sin(uGTime), -0.2);
    float dab = 0.5 + 0.5 * sin(uGTime * 5.0);
    g2.handN = g2.neck + vec2(0.18, -0.12 - 0.05 * dab);
    g2.handF = g2.neck + vec2(0.14, -0.1 - 0.05 * (1.0 - dab));
    float inker = sdFigure((iq - vec2(-0.1, -0.075)) / 0.14, g2, vec4(0.0, 0.6, 0.0, 1.0), 1.0) * 0.14;
    inker = min(inker, min(sdCircle(iq - vec2(-0.1, -0.075) - (g2.handN + vec2(0.02, 0.0)) * 0.14, 0.009), sdCircle(iq - vec2(-0.1, -0.075) - (g2.handF + vec2(0.02, 0.0)) * 0.14, 0.009)));
    // Sheets drying on a line across the window, glowing with the lamp behind them.
    float sheets = 1e9;
    for (int i = 0; i < 6; i++) sheets = min(sheets, sdBox(iq - vec2(-0.12 + 0.05 * float(i), 0.05), vec2(0.016, 0.022)));
    inside = mix(inside, vec3(1.0, 0.8, 0.55) * 1.6, cover(sheets, PX) * 0.8);
    inside = mix(inside, INK, cover(min(min(pr, man), inker), PX));
    // Mullions.
    float mull = min(abs(iq.x - 0.05) - 0.004, abs(iq.y) - 0.003);
    inside = mix(inside, INK, cover(mull, PX));
    col = mix(col, inside, cover(window, PX));
    col += LAMP * 0.25 * exp(-max(window, 0.0) / 0.02);
  }
  // Light spilling onto the street below the window.
  col += LAMP * 0.25 * exp(-length((q - vec2(wc.x, street)) * vec2(1.0, 4.0)) / 0.08) * step(q.y, street);
  // The window above, open, where the pages come from.
  vec2 uw = sp + vec2(0.3, 0.27);
  float upper = sdBox(q - uw, vec2(0.05, 0.04));
  col = mix(col, LAMP * 0.5, cover(upper, PX));

  // ---- pages streaming out over the town on the wind, lit through by the setting sun.
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    vec3 h = hash31(fi * 7.3 + 2.0);
    float age = uT + 1.2 - fi * 0.2;
    if (age < 0.0) continue;
    vec2 c = uw + vec2(-0.02, 0.0) + vec2(-0.42 * age - 0.1 * age * age * h.x, 0.12 * age + 0.05 * sin(age * 2.0 + fi) + 0.08 * h.y * age);
    // (Farther pages drift into the distance: smaller and hazier.)
    float size = 0.03 * (1.0 - 0.3 * h.z);
    vec2 uv;
    float fr;
    float a = sheet(q, c, age * (1.5 + h.x) + fi, age * (3.0 + 2.0 * h.y) + fi * 1.3, size, uv, fr);
    if (a > 0.0) {
      vec3 t = texture(uPage, clamp(uv, 0.0, 1.0)).rgb;
      float inkMark = (1.0 - t.r) * 0.7 + clamp(t.r - t.g, 0.0, 1.0) * 0.4;
      float glowThrough = 0.5 + 1.1 * exp(-length(c - uSun) * 2.5);
      vec3 paper = vec3(1.0, 0.86, 0.62) * glowThrough * (1.0 - inkMark * (fr > 0.5 ? 0.75 : 0.3));
      col = mix(col, paper, a);
    }
  }
  return col;
}
