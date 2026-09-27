// The Printing Press, 1450: a Mainz print shop in the early morning. Light from a window falls
// in shafts across a wooden screw press; fresh sheets of a Bible (two columns of blackletter, a red
// initial) hang drying on lines overhead, a stack waits on the bench, a candle burns. The press's
// bar swings as the platen comes down on the next sheet. Metres; the camera looks along -z, y up.
#define MARCH_STEPS 130
#define SHADOW_STEPS 28
#include <noise>
#include <color>
#include <camera>
#include <sdf3>
#include <march>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uT;
uniform sampler2D uPage;   // a printed page: black text (low red), red rubrics (red, low green)

const vec3 WIN_DIR = vec3(-0.9368, 0.3289, 0.1196);   // towards the low morning sun, through the window
const vec3 WIN_COL = vec3(1.0, 0.93, 0.82) * 4.5;
const vec3 CANDLE = vec3(0.62, 1.0, -2.5);   // top of the candle on the bench

// ---------------------------------------------------------------- the press
float pull() { return 0.5 - 0.5 * cos(min(uT * 1.3, 3.1416)); }   // 0 -> 1: the bar is pulled

float press(vec3 p, out float mat) {
  mat = 0.0;
  // Cheeks (uprights), head, winter and feet.
  vec3 q = p - vec3(0.0, 0.0, -1.6);
  float cheeks = sdBox(vec3(abs(q.x) - 0.52, q.y - 1.05, q.z), vec3(0.09, 1.05, 0.13));
  float head = sdBox(q - vec3(0.0, 1.78, 0.0), vec3(0.62, 0.11, 0.15));
  float winter = sdBox(q - vec3(0.0, 0.62, 0.0), vec3(0.6, 0.07, 0.15));
  float feet = sdBox(vec3(abs(q.x) - 0.52, q.y - 0.05, q.z), vec3(0.12, 0.05, 0.5));
  float frame = min(min(cheeks, head), min(winter, feet));
  // The screw: threaded, turning as the bar is pulled; the hose and platen below it.
  float turn = pull() * 1.6;
  float drop = 0.06 * pull();
  vec3 s = q - vec3(0.0, 1.45, 0.0);
  float ang = atan(s.z, s.x) + turn;
  float thread = 0.012 * sin(ang + s.y * 90.0);
  float screw = max(length(s.xz) - 0.055 - thread, abs(s.y) - 0.28);
  float hose = sdBox(q - vec3(0.0, 1.08 - drop, 0.0), vec3(0.12, 0.1, 0.12));
  float platen = sdBox(q - vec3(0.0, 0.93 - drop, 0.0), vec3(0.3, 0.035, 0.22));
  // The bar: an iron rod from the screw, swinging round towards the pressman.
  vec3 b = s - vec3(0.0, -0.18, 0.0);
  b.xz = rot2(turn * 0.6 - 0.5) * b.xz;
  float bar = sdCapsule(b, vec3(0.0), vec3(0.75, 0.05, 0.0), 0.018);
  float handle = sdCapsule(b, vec3(0.75, 0.05, 0.0), vec3(0.75, 0.2, 0.0), 0.025);
  // The carriage on its rails, the tympan with the sheet on it.
  float rails = sdBox(vec3(abs(q.x) - 0.3, q.y - 0.72, q.z - 0.45), vec3(0.03, 0.03, 0.75));
  float bed = sdBox(q - vec3(0.0, 0.8, 0.1), vec3(0.34, 0.05, 0.3));
  float tympan = sdBox(q - vec3(0.0, 0.86, 0.1), vec3(0.3, 0.008, 0.26));
  float d = min(min(frame, screw), min(hose, platen));
  d = min(d, min(min(rails, bed), tympan));
  float iron = min(min(bar, handle), screw);
  if (iron <= d) mat = 1.0;
  if (tympan <= d) mat = 2.0;
  return min(d, iron);
}

// ---------------------------------------------------------------- sheets drying on lines
// Sheets hang from two lines across the room, each gently sagging and swaying.
float sheets(vec3 p, out vec2 uv, out float front) {
  float d = 1e9;
  uv = vec2(0.0);
  front = 1.0;
  for (int line = 0; line < 2; line++) {
    float z0 = -0.2 - 1.1 * float(line);
    float y0 = 2.2 + 0.05 * float(line);
    float id;
    float x = repLim1(p.x + 0.2 * float(line), 0.42, 5.0, id);
    float sway = 0.03 * sin(uT * 0.9 + id * 1.7 + float(line));
    // Sheet folded over the line: 0.29 x 0.4 m, hanging down from y0.
    vec3 q = vec3(x, p.y - (y0 - 0.2), p.z - z0 - sway * (y0 - p.y));
    float s = sdBox(q, vec3(0.145, 0.2, 0.001));
    if (s < d) {
      d = s;
      uv = vec2(x / 0.29 + 0.5, (y0 - p.y) / 0.4);
      front = step(0.0, q.z);
    }
  }
  float cord = 1e9;
  for (int line = 0; line < 2; line++) cord = min(cord, length(p.yz - vec2(2.21 + 0.05 * float(line), -0.2 - 1.1 * float(line))) - 0.004);
  return min(d, cord);
}

// ---------------------------------------------------------------- the room
float room(vec3 p, out float mat) {
  mat = 0.0;
  // Floor, back wall, ceiling, and the left wall with a window cut through it.
  // (The left wall is a slab 0.5 m thick; outside it is the morning.)
  vec3 w = p - vec3(-2.65, 1.7, -1.2);
  float hole = sdBox(w, vec3(0.4, 0.55, 0.42));
  float wallL = max(abs(p.x + 2.65) - 0.25, -hole);
  float d = min(min(p.y, p.z + 3.2), min(wallL, 3.1 - p.y));
  // Bench along the back wall with a stack of blank paper and printed sheets.
  float bench = sdBox(p - vec3(1.3, 0.8, -2.7), vec3(0.8, 0.04, 0.35));
  float legs = sdBox(vec3(abs(p.x - 1.3) - 0.7, p.y - 0.4, p.z + 2.7), vec3(0.04, 0.4, 0.3));
  float stack = sdBox(p - vec3(1.1, 0.9, -2.7), vec3(0.16, 0.06, 0.21));
  float candle = sdCylinder(p - CANDLE - vec3(0.0, -0.08, 0.0), 0.022, 0.08);
  float furn = min(min(bench, legs), stack);
  if (furn < d) mat = 1.0;
  if (stack < d && stack <= furn) mat = 2.0;
  if (candle < min(d, furn)) mat = 3.0;
  return min(min(d, furn), candle);
}

float mapD(vec3 p) {
  float m;
  vec2 uv;
  float f;
  return min(min(press(p, m), room(p, m)), sheets(p, uv, f));
}

vec3 inkPage(vec2 uv) {
  vec3 t = texture(uPage, uv).rgb;
  vec3 paper = vec3(0.86, 0.8, 0.66);
  float black = 1.0 - t.r;
  float red = clamp(t.r - t.g, 0.0, 1.0);
  return paper * (1.0 - black * 0.92) * (1.0 - red * vec3(0.2, 0.85, 0.85));
}

// Light through the window: is p lit (not blocked by the wall around the opening)?
float windowLight(vec3 p) {
  vec3 L = normalize(WIN_DIR);
  // Carry p along the light to the inner face of the left wall.
  float s = (-2.4 - p.x) / L.x;
  vec3 w = p + L * s - vec3(-2.4, 1.7, -1.2);
  vec2 open = vec2(0.42, 0.55) - abs(w.zy);
  float lit = smoothstep(-0.03, 0.03, min(open.x, open.y));
  // The mullion in the middle of the window.
  lit *= smoothstep(0.02, 0.05, abs(w.z));
  return s > 0.0 ? lit : 0.0;
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  float pix = pixelAngle(uRes.y);
  vec3 L = normalize(WIN_DIR);
  vec3 col = vec3(0.0);
  float t = march(ro, rd, 0.05, 30.0, pix * 0.5);
  float tEnd = t > 0.0 ? t : 30.0;
  // Out through the window: bright morning haze.
  if (t < 0.0 && rd.x < 0.0) col = WIN_COL * 0.35 * (0.8 + 0.2 * rd.y);
  if (t > 0.0) {
    vec3 pos = ro + rd * t;
    vec3 n = calcNormal(pos, max(0.0008, t * pix));
    float mP, mR;
    vec2 uv;
    float front;
    float dP = press(pos, mP), dR = room(pos, mR), dS = sheets(pos, uv, front);
    float m = min(dP, min(dR, dS));
    vec3 alb;
    vec3 emit = vec3(0.0);
    float spec = 0.0;
    if (m == dS) {
      alb = front > 0.5 ? inkPage(uv) : vec3(0.8, 0.75, 0.62) * (0.85 + 0.15 * texture(uPage, vec2(1.0 - uv.x, uv.y)).r);
      if (length(pos.yz - vec2(2.21, -0.2)) < 0.01 || length(pos.yz - vec2(2.26, -1.3)) < 0.01) alb = vec3(0.3, 0.25, 0.18);
    } else if (m == dP) {
      if (mP == 1.0) { alb = vec3(0.12, 0.11, 0.1); spec = 0.4; }
      else if (mP == 2.0) alb = vec3(0.8, 0.74, 0.6);
      else alb = vec3(0.3, 0.19, 0.1) * (0.7 + 0.5 * fbm(vec2(pos.y * 3.0, (pos.x + pos.z) * 40.0), 4));
    } else {
      if (mR == 1.0) alb = vec3(0.25, 0.15, 0.08) * (0.7 + 0.4 * fbm(pos.xz * vec2(30.0, 3.0), 3));
      else if (mR == 2.0) alb = vec3(0.85, 0.8, 0.68);
      else if (mR == 3.0) { alb = vec3(0.9, 0.85, 0.7); emit = vec3(0.4, 0.3, 0.2); }
      else if (pos.y < 0.01) alb = vec3(0.22, 0.14, 0.08) * (0.7 + 0.5 * fbm(vec2(pos.x * 2.0, pos.z * 12.0), 4));
      else alb = vec3(0.42, 0.38, 0.32) * (0.75 + 0.35 * fbm(pos.xy * 4.0 + pos.zy * 4.0, 4));
    }
    // Window light (with shadows of everything in the room), a candle, and dim bounce.
    float win = windowLight(pos) * softShadow(pos + n * 0.01, L, 0.02, 5.0, 20.0);
    vec3 c = alb * WIN_COL * max(dot(n, L), 0.0) * win;
    vec3 dc = CANDLE + vec3(0.0, 0.05, 0.0) - pos;
    float r2 = dot(dc, dc);
    float flick = 0.9 + 0.1 * sin(uT * 17.0) * sin(uT * 7.3);
    c += alb * vec3(1.0, 0.55, 0.22) * 0.22 * flick * max(dot(n, normalize(dc)), 0.0) / (r2 + 0.02);
    float ao = calcAO(pos, n, 0.4);
    c += alb * (vec3(0.05, 0.05, 0.06) + vec3(0.05, 0.035, 0.02)) * ao;
    c += spec * WIN_COL * pow(max(dot(reflect(rd, n), L), 0.0), 30.0) * win;
    col = c + emit;
  }
  // The candle flame.
  vec3 fc = CANDLE + vec3(0.0, 0.04, 0.0);
  vec2 cp = rayPointDist(ro, rd, fc);
  if (cp.x < tEnd + 0.05) col += vec3(1.0, 0.6, 0.25) * (0.00004 / (cp.y * cp.y + 0.00002)) * 0.9;
  // Shafts of window light in the dusty air.
  float shaft = 0.0;
  float jitter = hash12(gl_FragCoord.xy);
  for (int i = 0; i < 32; i++) {
    float ti = (float(i) + jitter) / 32.0 * min(tEnd, 8.0);
    shaft += windowLight(ro + rd * ti);
  }
  shaft *= min(tEnd, 8.0) / 32.0;
  col += WIN_COL * shaft * 0.05 * (0.4 + 2.5 * pow(max(dot(rd, L), 0.0), 8.0));
  fragColor = vec4(col, 1.0);
}
