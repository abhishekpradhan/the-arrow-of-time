// Writing, 3200 BCE: a scribe's reed stylus pressing cuneiform wedges into a damp clay tablet, in
// the raking light of an oil lamp. Each wedge is the print of the stylus's triangular tip: a deep
// triangular head and a tail that thins out along the stroke. The line being written grows as the
// stylus moves on. Centimetres; the tablet lies in the xz plane, y up, lines run along +x.
//
// The tablet is a height field, intersected exactly (a fine linear search, then bisection), so the
// steep walls of the wedges stay crisp; the reed is a separate distance field.
#include <noise>
#include <color>
#include <camera>
#include <sdf3>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uT;
uniform float uPen;      // x of the stylus along the line being written

const vec3 LAMP = vec3(-18.0, 9.0, -9.0);
const vec3 LAMP_COL = vec3(1.0, 0.62, 0.3) * 600.0;
const vec2 HALF = vec2(5.4, 3.9);     // tablet half size
const float THICK = 1.6;
const float LINE = 1.2;               // line spacing
const float PENLINE = 1.0;            // index of the line being written
const float TOP = THICK + 0.32;       // highest point of the tablet

float pillow(vec2 xz) {
  // Rounded edges and a gently domed face.
  vec2 u = abs(xz) / HALF;
  float dome = 0.3 * (1.0 - u.x * u.x) * (1.0 - u.y * u.y);
  vec2 e = max(abs(xz) - (HALF - 0.6), 0.0);
  float edge = length(e);
  return THICK + dome - edge * edge * 1.6;
}

// Depth of one wedge at q: head at c, pointing along d, length L, head width w.
float wedge(vec2 q, vec2 c, vec2 d, float L, float w) {
  vec2 r = q - c;
  float u = dot(r, d), v = abs(dot(r, vec2(-d.y, d.x)));
  float headLen = w * 0.8;
  if (u < -headLen || u > L) return 0.0;
  // Half-width of the print: the triangular head widens from its back corner, then the tail
  // tapers to nothing.
  float halfw = u < 0.0 ? w * 0.5 * (1.0 + u / headLen) * 1.0 : w * 0.5 * (1.0 - u / L);
  halfw = max(halfw, 0.0);
  // V-shaped section, deepest along the axis; the head is deepest.
  float axisDepth = u < 0.0 ? 0.13 * (1.0 + 0.6 * u / headLen) : 0.13 * (1.0 - 0.75 * u / L);
  float across = 1.0 - v / max(halfw, 1e-3);
  return axisDepth * smoothstep(0.0, 0.35, across) * (0.4 + 0.6 * across);
}

// Sign s on line l, built the way scribes built signs: a stack of horizontal wedges, one or two
// verticals after them, sometimes a corner wedge (Winkelhaken) or a diagonal. The top of a line
// is towards -z (away from the reader).
float glyph(vec2 q, float l, float s, float x0) {
  vec4 h = hash43(vec3(l, s, 3.0));
  float z0 = l * LINE;
  float dep = 0.0;
  float nh = floor(h.x * 3.99);              // 0-3 horizontals
  float nv = floor(h.y * 2.99);              // 0-2 verticals
  if (nh + nv < 1.0) nh = 2.0;
  for (int i = 0; i < 3; i++) {
    if (float(i) >= nh) break;
    float z = z0 + (float(i) - 0.5 * (nh - 1.0)) * 0.24;
    dep = max(dep, wedge(q, vec2(x0 + 0.12, z), vec2(1.0, 0.0), 0.42 + 0.12 * h.z, 0.24));
  }
  for (int i = 0; i < 2; i++) {
    if (float(i) >= nv) break;
    float x = x0 + 0.66 + 0.17 * float(i);
    dep = max(dep, wedge(q, vec2(x, z0 - 0.36), vec2(0.0, 1.0), 0.62, 0.22));
  }
  if (h.w > 0.6) dep = max(dep, wedge(q, vec2(x0 + 0.42, z0 + 0.02), normalize(vec2(0.8, -1.0)), 0.06, 0.26));
  else if (h.w < 0.2) dep = max(dep, wedge(q, vec2(x0 + 0.1, z0 - 0.3), normalize(vec2(1.0, 1.0)), 0.5, 0.2));
  return dep;
}

float surface(vec2 xz) {
  float h = pillow(xz);
  // Ruled guide lines between the lines of text.
  float rule = abs(fract(xz.y / LINE + 0.5) - 0.5) * LINE;
  h -= 0.03 * smoothstep(0.035, 0.0, rule - 0.52);
  float l = floor(xz.y / LINE + 0.5);
  if (abs(l) <= 2.0 && abs(xz.x) < HALF.x - 0.45 && l <= PENLINE) {
    float s0 = floor(xz.x + 6.0);
    float dep = 0.0;
    for (int j = -1; j <= 0; j++) {
      float s = s0 + float(j);
      float x0 = s - 6.0;
      // Signs to the right of the stylus on the current line are not written yet.
      if (l == PENLINE && x0 > uPen - 0.3) continue;
      dep = max(dep, glyph(xz, l, s, x0));
    }
    h -= dep;
  }
  // The damp clay: smooth, with faint smears.
  h += 0.003 * gnoise(xz * 5.0) + 0.0006 * gnoise(xz * 20.0);
  return h;
}

// The reed stylus: a slim triangular reed coming in from the right, its tip pressing and lifting.
float stylus(vec3 p) {
  float press = 0.5 + 0.5 * cos(uT * 10.0);
  vec3 tip = vec3(uPen + 0.12, pillow(vec2(uPen, PENLINE * LINE)) - 0.08 + 0.3 * press, PENLINE * LINE - 0.25);
  vec3 axis = normalize(vec3(0.55, 0.72, -0.42));
  vec3 q = p - tip;
  float along = dot(q, axis);
  vec3 side = normalize(cross(axis, vec3(0.0, 1.0, 0.0)));
  vec3 up2 = cross(side, axis);
  vec2 cs = vec2(dot(q, side), dot(q, up2));
  float radius = 0.05 + 0.2 * clamp(along / 0.8, 0.0, 1.0);
  float tri = max(max(-cs.y, dot(cs, vec2(0.866, 0.5))), dot(cs, vec2(-0.866, 0.5))) - radius * 0.5;
  return max(tri - 0.02, max(-along, along - 25.0));
}

// Exact hit on the height field: step the ray through the relief band, then bisect.
float hitTablet(vec3 ro, vec3 rd) {
  if (rd.y >= 0.0) return -1.0;
  float t0 = max((TOP - ro.y) / rd.y, 0.0);
  float t1 = (-0.2 - ro.y) / rd.y;
  float dt = 0.012;
  float t = t0;
  float prev = t0;
  for (int i = 0; i < 260; i++) {
    vec3 p = ro + rd * t;
    float h = abs(p.x) < HALF.x + 0.2 && abs(p.z) < HALF.y + 0.2 ? surface(p.xz) : 0.0;
    if (p.y < h) {
      float a = prev, b = t;
      for (int k = 0; k < 7; k++) {
        float m = 0.5 * (a + b);
        vec3 q = ro + rd * m;
        float hm = abs(q.x) < HALF.x + 0.2 && abs(q.z) < HALF.y + 0.2 ? surface(q.xz) : 0.0;
        if (q.y < hm) b = m; else a = m;
      }
      return 0.5 * (a + b);
    }
    prev = t;
    // Far from the tablet (over the board) the steps can be long.
    t += (abs(p.x) > HALF.x + 0.3 || abs(p.z) > HALF.y + 0.3) ? max(dt, p.y * 0.5) : dt * (1.0 + t * 0.02);
    if (t > t1) break;
  }
  return -1.0;
}

float hitStylus(vec3 ro, vec3 rd, float tmax, float pix) {
  float t = 0.0;
  for (int i = 0; i < 80; i++) {
    float d = stylus(ro + rd * t);
    if (d < pix * t) return t;
    t += d;
    if (t > tmax) break;
  }
  return -1.0;
}

vec3 tabletNormal(vec2 xz) {
  float e = 0.006;
  float hx = surface(xz + vec2(e, 0.0)) - surface(xz - vec2(e, 0.0));
  float hz = surface(xz + vec2(0.0, e)) - surface(xz - vec2(0.0, e));
  return normalize(vec3(-hx, 2.0 * e, -hz));
}

// Shadow of the relief (and the reed) towards the lamp.
float lampShadow(vec3 p) {
  vec3 dir = normalize(LAMP - p);
  float res = 1.0;
  for (int i = 1; i <= 24; i++) {
    float t = 0.02 * float(i) * float(i) * 0.25 + 0.01;
    vec3 q = p + dir * t;
    float h = abs(q.x) < HALF.x + 0.2 && abs(q.z) < HALF.y + 0.2 ? surface(q.xz) : 0.0;
    res = min(res, clamp((q.y - h) / (0.03 * t + 0.004), 0.0, 1.0));
    res = min(res, clamp(stylus(q) / (0.05 * t + 0.01), 0.0, 1.0));
    if (res < 0.01 || q.y > TOP) break;
  }
  return res;
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  float pix = pixelAngle(uRes.y);
  vec3 col = vec3(0.01, 0.008, 0.006);
  float tT = hitTablet(ro, rd);
  float tS = hitStylus(ro, rd, tT > 0.0 ? tT : 60.0, pix);
  vec3 pos, n, alb;
  float spec = 0.0, gloss = 30.0;
  bool hit = true;
  if (tS > 0.0) {
    pos = ro + rd * tS;
    const vec2 k = vec2(1.0, -1.0);
    float e = 0.004;
    n = normalize(k.xyy * stylus(pos + k.xyy * e) + k.yyx * stylus(pos + k.yyx * e) + k.yxy * stylus(pos + k.yxy * e) + k.xxx * stylus(pos + k.xxx * e));
    // Dry reed: straw coloured, with fine fibres along its length.
    float fib = sin(dot(pos, vec3(40.0, -20.0, 40.0)) + 3.0 * gnoise(pos.xz * 5.0));
    alb = vec3(0.55, 0.44, 0.24) * (0.85 + 0.15 * fib);
    spec = 0.15;
  } else if (tT > 0.0) {
    pos = ro + rd * tT;
    bool onTablet = abs(pos.x) < HALF.x && abs(pos.z) < HALF.y && pos.y > 0.05;
    if (onTablet) {
      n = tabletNormal(pos.xz);
      // Damp clay: darker and glossier inside the fresh impressions.
      float fresh = smoothstep(0.0, 0.06, pillow(pos.xz) - surface(pos.xz));
      alb = mix(vec3(0.5, 0.36, 0.24), vec3(0.34, 0.23, 0.15), fresh) * (0.9 + 0.1 * fbm(pos.xz * 3.0, 3));
      spec = 0.18 + 0.35 * fresh;
      gloss = 24.0;
    } else {
      n = vec3(0.0, 1.0, 0.0);
      float grain = fbm(vec2(pos.x * 0.3, pos.z * 5.0), 4);
      alb = vec3(0.16, 0.09, 0.045) * (0.6 + 0.7 * grain);
      spec = 0.05;
    }
  } else {
    hit = false;
  }
  if (hit) {
    vec3 l = LAMP - pos;
    float r2 = dot(l, l);
    l *= inversesqrt(r2);
    float sh = lampShadow(pos + n * 0.004);
    float dif = max(dot(n, l), 0.0);
    vec3 h = normalize(l - rd);
    col = LAMP_COL / r2 * (alb * dif + spec * pow(max(dot(n, h), 0.0), gloss)) * sh;
    col += alb * vec3(0.03, 0.035, 0.05) * (0.5 + 0.5 * n.y);
    // Shallow focus on the pen: light and detail fall away from it.
    float focus = exp(-pow(length(pos.xz - vec2(uPen + 0.5, PENLINE * LINE - 0.3)) / 6.0, 2.0));
    col *= 0.45 + 0.55 * focus;
  }
  // The lamp flame, out of focus at the top left.
  vec2 fl = p - vec2(-0.7, 0.33);
  col += vec3(1.0, 0.55, 0.2) * 0.25 * exp(-dot(fl, fl) / 0.03) + vec3(1.0, 0.72, 0.4) * 0.6 * exp(-dot(fl, fl) / 0.003);
  fragColor = vec4(col, 1.0);
}
