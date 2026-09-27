// Writing, 3200 BCE: over a scribe's shoulder on a rooftop in Uruk in the morning. He holds a
// damp clay tablet up to the light and presses signs into it with the triangular tip of a reed:
// lines of wedges, lit by the low sun so that each impression has a bright wall and a shadowed
// one. The line being written grows as the reed moves on. Behind him the rooftops of the city
// and the White Temple on its terrace, soft in the haze.
#include <arrow-of-time/civ-common>

const float HY = -0.1;
const vec3 INK = vec3(0.03, 0.022, 0.02);
const vec3 CLAY = vec3(0.6, 0.43, 0.28);
const vec3 SKIN = vec3(0.5, 0.32, 0.21);
const vec3 L3 = normalize(vec3(-0.8, 0.5, 0.26));    // raking light onto the tablet's face

vec3 sunLight() { return vec3(1.0, 0.78, 0.52) * 2.1; }
vec3 skyLight() { return vec3(0.16, 0.2, 0.3); }

// ---------------------------------------------------------------- the tablet (sign units)
const vec2 HALF = vec2(5.4, 3.9);
const float LINE = 1.25;
const float PENLINE = 1.0;
float PEN;

float wedge(vec2 q, vec2 c, vec2 d, float len, float w) {
  vec2 r = q - c;
  float u = dot(r, d), v = abs(dot(r, vec2(-d.y, d.x)));
  float headLen = w * 0.8;
  if (u < -headLen || u > len) return 0.0;
  float halfw = u < 0.0 ? w * 0.5 * (1.0 + u / headLen) : w * 0.5 * (1.0 - u / len);
  halfw = max(halfw, 0.0);
  float axisDepth = u < 0.0 ? 0.13 * (1.0 + 0.6 * u / headLen) : 0.13 * (1.0 - 0.75 * u / len);
  float across = 1.0 - v / max(halfw, 1e-3);
  return axisDepth * smoothstep(0.0, 0.35, across) * (0.4 + 0.6 * across);
}

// Sign s on line l, built as scribes built them: horizontal wedges, a vertical or two, sometimes
// a corner wedge or a diagonal. Lines run down the tablet (w increases downwards).
float glyph(vec2 q, float l, float s, float x0) {
  vec4 h = hash43(vec3(l, s, 3.0));
  float z0 = l * LINE;
  float dep = 0.0;
  float nh = floor(h.x * 3.99), nv = floor(h.y * 2.99);
  if (nh + nv < 1.0) nh = 2.0;
  for (int i = 0; i < 3; i++) {
    if (float(i) >= nh) break;
    float z = z0 + (float(i) - 0.5 * (nh - 1.0)) * 0.24;
    dep = max(dep, wedge(q, vec2(x0 + 0.12, z), vec2(1.0, 0.0), 0.42 + 0.12 * h.z, 0.24));
  }
  for (int i = 0; i < 2; i++) {
    if (float(i) >= nv) break;
    dep = max(dep, wedge(q, vec2(x0 + 0.66 + 0.17 * float(i), z0 - 0.36), vec2(0.0, 1.0), 0.62, 0.22));
  }
  if (h.w > 0.6) dep = max(dep, wedge(q, vec2(x0 + 0.42, z0 + 0.02), normalize(vec2(0.8, -1.0)), 0.06, 0.26));
  else if (h.w < 0.2) dep = max(dep, wedge(q, vec2(x0 + 0.1, z0 - 0.3), normalize(vec2(1.0, 1.0)), 0.5, 0.2));
  return dep;
}

// Height of the tablet's face at (u, w): a gently domed pillow, ruled lines, the signs.
float surface(vec2 q) {
  vec2 a = abs(q) / HALF;
  float h = 0.3 * (1.0 - a.x * a.x) * (1.0 - a.y * a.y);
  float rule = abs(fract(q.y / LINE + 0.5) - 0.5) * LINE;
  h -= 0.03 * smoothstep(0.035, 0.0, rule - 0.55);
  float l = floor(q.y / LINE + 0.5);
  if (abs(l) <= 2.0 && abs(q.x) < HALF.x - 0.45 && l <= PENLINE) {
    float s0 = floor(q.x + 6.0);
    float dep = 0.0;
    for (int j = -1; j <= 0; j++) {
      float s = s0 + float(j);
      float x0 = s - 6.0;
      if (l == PENLINE && x0 > PEN - 0.3) continue;
      dep = max(dep, glyph(q, l, s, x0));
    }
    h -= dep;
  }
  return h + 0.003 * gnoise(q * 5.0);
}

// ---------------------------------------------------------------- the hands
float hands(vec2 q, vec2 C, float rot, vec2 tip, vec2 back) {
  vec2 bl = C + rot2(rot) * vec2(-0.12, -0.165);
  float d = sdTaper(q, bl + vec2(0.02, -0.02), bl + vec2(-0.12, -0.3), 0.045, 0.062);
  d = smin(d, sdEllipse(q - bl - vec2(0.045, -0.03), vec2(0.07, 0.04)), 0.02);
  for (int i = 0; i < 4; i++) {
    vec2 f0 = bl + rot2(rot) * vec2(0.035 * float(i), 0.0);
    d = smin(d, sdTaper(q, f0 + vec2(0.0, -0.025), f0 + vec2(0.004, 0.022), 0.0135, 0.011), 0.008);
  }
  d = min(d, sdTaper(q, C + rot2(rot) * vec2(-0.25, -0.12), C + rot2(rot) * vec2(-0.237, -0.03), 0.014, 0.011));
  vec2 rh = mix(tip, back, 0.6);
  float fist = sdEllipse(rot2(-0.6) * (q - rh - vec2(0.012, -0.018)), vec2(0.044, 0.031));
  fist = smin(fist, sdTaper(q, rh + vec2(-0.022, 0.012), rh + vec2(0.02, 0.022), 0.012, 0.011), 0.01);
  fist = smin(fist, sdTaper(q, rh + vec2(0.03, -0.035), rh + vec2(0.25, -0.26), 0.036, 0.056), 0.02);
  return min(d, fist);
}

// ---------------------------------------------------------------- the scene
vec3 scene(vec2 p) {
  float e = uElev;
  SkyTone st = skyTone(e);
  vec3 col = paintSky(p, HY, uSun, e);
  vec4 c1 = stratus(p, uSun, e, HY, 0.26, 0.08, 0.4, uGTime, 5.0);
  col = col * (1.0 - c1.a) + c1.rgb;
  vec3 SL = sunLight(), SK = skyLight();

  // ---- the city beyond the roof, soft in the haze: rooftops, palms, the White Temple.
  vec2 q = L(p, 0.3);
  vec3 air = airAt(q.x, HY, uSun, e);
  float far = HY + 0.006 * smoothstep(0.4, 0.8, fbm(vec2(q.x * 25.0, 3.0), 3));
  fill(col, q.y - far, PX, inkIn(air, 0.75, INK));
  float roofs = 1e9;
  float cw = 0.06;
  float c0 = floor(q.x / cw);
  vec3 rc = vec3(0.0);
  for (int j = -1; j <= 1; j++) {
    float c = c0 + float(j);
    vec4 h = hash42(vec2(c, 11.0));
    if (h.w < 0.15) continue;
    vec2 b = vec2((c + 0.5) * cw + (h.x - 0.5) * 0.02, HY - 0.05);
    float w = cw * (0.3 + 0.18 * h.y), hh = 0.03 + 0.05 * h.z;
    float d = sdBox(q - b - vec2(0.0, hh * 0.5), vec2(w, hh * 0.5));
    if (d < roofs) { roofs = d; rc = CLAY * (SK + SL * (q.x - b.x < -w * 0.5 ? 0.8 : 0.4)); }
  }
  col = mix(col, mix(rc, air, 0.55), cover(roofs, PX * 2.0));
  {
    vec2 tq = (q - vec2(-0.5, HY - 0.02)) / 0.2;
    float w = 0.5 - 0.12 * clamp(tq.y / 0.22, 0.0, 1.0);
    float terr = max(abs(tq.x) - w, max(-tq.y, tq.y - 0.22));
    float hall = sdBox(tq - vec2(0.02, 0.27), vec2(0.23, 0.05));
    vec3 tcol = hall < terr ? vec3(0.92, 0.9, 0.84) * (SK + SL * 0.55) : CLAY * (SK + SL * 0.45);
    col = mix(col, mix(tcol, air, 0.5), cover(min(terr, hall) * 0.2, PX * 2.0));
  }
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float x = -0.2 + fi * 0.33 + 0.06 * sin(fi * 4.0);
    fill(col, sdDatePalm(q - vec2(x, HY - 0.03), uGTime, fi, 0.09 + 0.02 * fract(fi * 0.7)), PX * 2.0, mix(INK, air, 0.5));
  }

  // ---- the parapet of the roof, sunlit on top; tablets drying in a row on a reed mat.
  q = L(p, 0.9);
  float par = q.y - (-0.2);
  vec3 pc = CLAY * (SK + SL * 0.32) * (0.9 + 0.1 * fbm(q * 40.0, 3));
  pc = mix(pc, CLAY * (SK + SL * 0.95), smoothstep(-0.012, -0.004, par));
  fill(col, par, PX, pc);
  // Brick courses along the parapet's face.
  float course = smoothstep(0.1, 0.0, abs(fract(q.y * 38.0) - 0.5) - 0.42) * step(par, -0.012);
  col *= 1.0 - 0.12 * course * step(par, 0.0);

  // ---- the tablet, held up to the light, the reed pressing the next wedge.
  q = L(p, 1.6);
  vec2 C = vec2(-0.04, -0.03);
  float ts = 0.235 / HALF.x;              // picture units per sign unit
  float rot = 0.05;
  vec2 tq = rot2(-rot) * (q - C) / ts;
  tq.y = -tq.y;
  PEN = -4.4 + 2.6 * (uT + 0.7);
  float edgeD = sdRoundBox(tq, HALF, 0.9) * ts;
  float ta = cover(edgeD, PX);
  if (ta > 0.0) {
    float h = surface(tq);
    float ep = 0.03;
    float hx = surface(tq + vec2(ep, 0.0)) - surface(tq - vec2(ep, 0.0));
    float hy = surface(tq + vec2(0.0, ep)) - surface(tq - vec2(0.0, ep));
    // (Tablet w runs down the picture, so its slope flips for the light.)
    vec3 n = normalize(vec3(-hx, hy, 2.0 * ep));
    float rim = smoothstep(-0.03, 0.0, edgeD);
    n = normalize(mix(n, vec3(normalize(q - C) * 0.8, 0.4), rim));
    float dif = max(dot(n, L3), 0.0);
    float fresh = smoothstep(0.0, 0.06, 0.3 * (1.0 - pow(abs(tq.x) / HALF.x, 2.0)) * (1.0 - pow(abs(tq.y) / HALF.y, 2.0)) - h);
    vec3 alb = mix(CLAY, CLAY * 0.7, fresh) * (0.92 + 0.08 * fbm(tq * 2.0, 3));
    vec3 tcol = alb * (SK * 0.7 + SL * dif * 0.95) + vec3(1.0, 0.9, 0.75) * 0.1 * pow(max(dot(reflect(-L3, n), vec3(0.0, 0.0, 1.0)), 0.0), 20.0);
    col = mix(col, tcol, ta);
  }
  // His hands: the left under the tablet, fingertips curled over its bottom edge and the thumb
  // along its side; the right holding the reed in a loose fist, its tip on the tablet at the pen.
  float press = 0.5 + 0.5 * cos(uGTime * 13.0);
  vec2 tip = C + rot2(rot) * (vec2(PEN + 0.1, -(PENLINE * LINE - 0.1)) * ts) + vec2(0.004, 0.006) * press;
  vec2 back = tip + vec2(0.2, -0.16);
  float reed = sdTaper(q, tip, back, 0.0025, 0.009);
  col = mix(col, vec3(0.55, 0.45, 0.25) * (SK + SL * 0.6), cover(reed, PX));
  float hd = hands(q, C, rot, tip, back);
  if (hd < 0.01) {
    // Rounded shading: the normal tilts towards the edges, so the side facing the light is lit.
    vec2 e = vec2(0.0015, 0.0);
    vec2 g = normalize(vec2(hands(q + e.xy, C, rot, tip, back), hands(q + e.yx, C, rot, tip, back)) - hd + 1e-7);
    float k = clamp(-hd / 0.03, 0.0, 1.0);
    vec3 n = normalize(vec3(g * (1.0 - k * k), 0.4 + k));
    float dif = max(dot(n, L3), 0.0);
    vec3 sk = SKIN * (SK * 0.55 + SL * dif * 0.75) + SKIN * vec3(0.25, 0.08, 0.05) * (1.0 - k) * 0.4;
    col = mix(col, sk, cover(hd, PX * 1.2));
  }

  // ---- over his shoulder: the back of his shaved head, and his shoulder, out of focus.
  q = L(p, 2.6);
  vec2 hc = vec2(0.72, 0.05);
  float head = sdEllipse(q - hc, vec2(0.13, 0.15));
  head = min(head, sdEllipse(q - hc - vec2(-0.115, -0.01), vec2(0.022, 0.04)));
  float body = sdTaper(q, hc + vec2(0.05, -0.2), hc + vec2(0.1, -0.6), 0.2, 0.3);
  body = smin(body, sdTaper(q, hc + vec2(-0.02, -0.25), hc + vec2(-0.25, -0.5), 0.09, 0.11), 0.04);
  float sd = smin(head, body, 0.05);
  vec2 g = normalize(q - hc + vec2(0.0, 0.2));
  float lit = max(dot(g, normalize(vec2(-0.8, 0.6))), 0.0);
  vec3 sc = SKIN * (SK * 0.6 + SL * 0.08) + SKIN * SL * 0.5 * pow(lit, 3.0) * smoothstep(-0.04, 0.0, sd);
  col = mix(col, sc, soft(sd, 8.0));
  return col;
}
