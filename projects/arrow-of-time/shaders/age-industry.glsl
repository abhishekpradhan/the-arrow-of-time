// Industry, 1830: a night in the railway age. A steam locomotive and its train cross a brick
// viaduct, firebox glowing, smoke rolling back from the chimney; behind it a mill town of
// chimneys and furnaces lights the smoke from below. The camera, down in the valley, pans with
// the train. Metres; the viaduct runs along x, the town lies to -z; y up.
#define MARCH_STEPS 150
#define SHADOW_STEPS 1
#include <noise>
#include <color>
#include <camera>
#include <sdf3>
#include <march>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uT;
uniform float uTrainX;     // x of the locomotive's chimney

const float VZ = -55.0;        // viaduct centre line
const float DECK = 22.0;       // rail level
const vec3 GLOW = vec3(1.0, 0.42, 0.12);

// ---------------------------------------------------------------- the viaduct
float viaduct(vec3 p) {
  vec3 q = p - vec3(0.0, 0.0, VZ);
  float deck = sdBox(q - vec3(0.0, DECK - 1.2, 0.0), vec3(400.0, 1.2, 3.2));
  // Arches every 14 m: a wall with round-headed openings between tapering piers.
  float id;
  float x = repLim1(q.x, 14.0, 40.0, id);
  float wall = sdBox(q - vec3(0.0, (DECK - 2.4) * 0.5, 0.0), vec3(400.0, (DECK - 2.4) * 0.5, 2.8));
  vec2 a = vec2(x, q.y - 12.0);
  float opening = max(length(vec2(a.x, max(a.y, 0.0))) - 5.2, -a.y - 30.0);
  float d = max(wall, -max(opening, abs(q.z) - 4.0));
  float parapet = sdBox(vec3(q.x, q.y - DECK - 0.5, abs(q.z) - 3.0), vec3(400.0, 0.5, 0.2));
  return min(min(d, deck), parapet);
}

// ---------------------------------------------------------------- the train
float train(vec3 p, out float mat) {
  mat = 0.0;
  vec3 q = p - vec3(uTrainX, DECK, VZ);
  // Locomotive facing -x: boiler, smokebox and chimney at the front, dome, cab, wheels.
  float boiler = sdCylinder(q, vec3(-0.5, 2.1, 0.0), vec3(4.2, 2.1, 0.0), 0.8);
  float chimney = sdCone(q - vec3(0.2, 3.7, 0.0), 0.9, 0.28, 0.4);
  float dome = sdSphere(q - vec3(2.2, 2.95, 0.0), 0.42);
  float cab = sdBox(q - vec3(5.2, 2.4, 0.0), vec3(1.1, 1.5, 1.2));
  float roof = sdBox(q - vec3(5.2, 4.0, 0.0), vec3(1.3, 0.08, 1.35));
  float wheels = 1e9;
  for (int i = 0; i < 3; i++) {
    float wx = 0.8 + 1.8 * float(i);
    wheels = min(wheels, sdCylinder(vec3(q.x - wx, q.y - 0.9, abs(q.z) - 0.85), vec3(0.0, 0.0, -0.08), vec3(0.0, 0.0, 0.08), 0.85));
  }
  float frame = sdBox(q - vec3(2.8, 1.25, 0.0), vec3(3.8, 0.25, 1.0));
  float loco = min(min(min(boiler, chimney), min(dome, cab)), min(min(roof, wheels), frame));
  // Tender and carriages with lit windows.
  float cars = 1e9;
  for (int i = 0; i < 4; i++) {
    float cx = 8.6 + 7.5 * float(i);
    float h = i == 0 ? 1.1 : 1.6;
    cars = min(cars, sdRoundBox(q - vec3(cx, 1.2 + h, 0.0), vec3(3.3, h, 1.3), 0.2));
  }
  float d = min(loco, cars);
  if (cars < loco) mat = 1.0;
  return d;
}

// ---------------------------------------------------------------- the town
// Mills and chimneys on the far side of the valley.
float town(vec3 p, out float win) {
  win = 0.0;   // 1 on a mill (windows), 0 on a chimney
  float d = 1e9;
  vec2 cid = floor(p.xz / vec2(30.0, 40.0));
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = cid + vec2(i, j);
      if (id.y > -3.0 || id.y < -12.0) continue;
      // Everything stays inside its own 30 x 40 m cell, so the 3 x 3 search is exact.
      vec4 h = hash42(id + 5.0);
      vec2 c = (id + 0.5) * vec2(30.0, 40.0) + (h.xy - 0.5) * vec2(5.0, 8.0);
      float H = 8.0 + 14.0 * h.z;
      float mill = sdBox(p - vec3(c.x - 2.0, H * 0.5 + 6.0, c.y), vec3(7.0 + 3.0 * h.w, H * 0.5, 7.0));
      // A tall chimney beside each mill.
      float CH = 30.0 + 25.0 * h.w;
      float chim = sdCone(p - vec3(c.x + 9.0, 6.0 + CH * 0.5, c.y + 3.0), CH * 0.5, 1.6, 0.9);
      if (mill < d) { d = mill; win = 1.0; }
      if (chim < d) { d = chim; win = 0.0; }
    }
  }
  // Anything outside the 3 x 3 cells is at least a cell width away.
  return min(d, 30.0);
}

float ground(vec3 p) {
  // A valley: low under the viaduct, rising to the town's terrace and the near slope.
  float h = 6.0 * smoothstep(-80.0, -140.0, p.z) + 2.0 * smoothstep(-20.0, 20.0, p.z) + 1.5 * fbm(p.xz * 0.02, 3);
  return p.y - h;
}

float mapD(vec3 p) {
  float m, w;
  float d = min(viaduct(p), ground(p));
  d = min(d, train(p, m));
  d = min(d, town(p, w));
  return d;
}

// ---------------------------------------------------------------- smoke
// The smoke of the town and the locomotive, lit from below by furnace glow.
float plume(vec3 p, vec3 src, vec3 drift, float age) {
  // A column from src bending along `drift`, widening as it rises.
  float s = clamp(dot(p - src, drift) / dot(drift, drift), 0.0, 1.0);
  vec3 axis = src + drift * s;
  float r = 0.6 + 10.0 * s;
  float dd = length(p - axis);
  float n = fbm(p * 0.12 + vec3(0.0, -uT * 0.6, uT * 0.3), 3);
  return smoothstep(r, r * 0.3, dd) * smoothstep(0.0, 0.05, s) * (0.4 + 0.8 * n) * (1.0 - s * 0.7);
}

vec4 smoke(vec3 ro, vec3 rd, float tmax) {
  vec3 acc = vec3(0.0);
  float T = 1.0;
  float jitter = hash12(gl_FragCoord.xy);
  vec3 chimney = vec3(uTrainX + 0.2, DECK + 4.6, VZ);
  for (int i = 0; i < 40; i++) {
    float t = 25.0 + (float(i) + jitter) / 40.0 * (min(tmax, 450.0) - 25.0);
    vec3 p = ro + rd * t;
    float dens = 0.0;
    // The locomotive's smoke rolls back along the train and upwards.
    float pl = plume(p, chimney, vec3(30.0, 10.0, -5.0), 0.0) * 3.5;
    dens += pl;
    // A low pall over the town.
    dens += 0.25 * smoothstep(20.0, 60.0, p.y) * smoothstep(110.0, 70.0, p.y) * smoothstep(-100.0, -160.0, p.z) * fbm(p.xz * 0.02 + vec2(uT * 0.05, 0.0), 3);
    if (dens > 0.001) {
      float step = (min(tmax, 450.0) - 25.0) / 40.0;
      float a = 1.0 - exp(-dens * step * 0.08);
      // Lit orange from below by furnaces and firebox, faintly blue from the night sky above.
      float below = smoothstep(90.0, 20.0, p.y);
      // Near the chimney the smoke glows with the firebox; farther back it is lit by the town.
      float nearFire = exp(-length(p - chimney) / 5.0);
      vec3 c = GLOW * (0.1 + 0.3 * below + 2.5 * nearFire) + vec3(0.03, 0.035, 0.05);
      acc += T * a * c;
      T *= 1.0 - a;
      if (T < 0.02) break;
    }
  }
  return vec4(acc, T);
}

vec3 sky(vec3 rd) {
  float e = max(rd.y, 0.0);
  vec3 col = mix(vec3(0.12, 0.06, 0.04), vec3(0.015, 0.02, 0.045), smoothstep(0.0, 0.35, e));
  // Stars, and a bright moon behind thin cloud.
  float star = smoothstep(0.992, 1.0, hash13(floor(rd * 400.0))) * smoothstep(0.15, 0.4, e);
  vec3 moon = normalize(vec3(0.62, 0.3, -0.72));
  float mu = dot(rd, moon);
  col += vec3(0.8, 0.85, 1.0) * (smoothstep(0.99985, 0.99992, mu) * 2.0 + 0.04 * pow(max(mu, 0.0), 60.0));
  return col + vec3(0.7, 0.75, 1.0) * star * 0.5;
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  float pix = pixelAngle(uRes.y);
  vec3 col = sky(rd);
  float t = march(ro, rd, 0.5, 1200.0, pix * 0.5);
  if (t > 0.0) {
    vec3 pos = ro + rd * t;
    vec3 n = calcNormal(pos, max(0.005, t * pix));
    float mT, win;
    float dT = train(pos, mT), dV = viaduct(pos), dG = ground(pos);
    win = 0.0;
    float dW = town(pos, win);
    float m = min(min(dT, dV), min(dG, dW));
    vec3 alb = vec3(0.25, 0.14, 0.1);
    vec3 emit = vec3(0.0);
    if (m == dT) {
      alb = mT > 0.5 ? vec3(0.2, 0.1, 0.07) : vec3(0.06, 0.07, 0.06);
      vec3 q = pos - vec3(uTrainX, DECK, VZ);
      // Carriage windows, and the firebox's glow spilling out of the cab.
      if (mT > 0.5 && q.x > 12.0) {
        float wx = abs(fract(q.x / 1.2) - 0.5);
        emit += vec3(1.0, 0.7, 0.35) * 1.4 * step(wx, 0.3) * step(abs(q.y - 2.9), 0.45) * step(0.5, abs(n.z));
      }
      emit += GLOW * 3.0 * exp(-length(q - vec3(4.2, 1.8, 0.0)) * 1.2);
    } else if (m == dV) {
      // Brick, dimly lit by the town's glow from the far side and the moon.
      alb = vec3(0.3, 0.14, 0.09) * (0.7 + 0.3 * fbm(pos.xy * vec2(2.0, 5.0), 3));
    } else if (m == dW) {
      alb = vec3(0.15, 0.1, 0.08);
      // Rows of lit windows on the mills; furnace mouths at their feet.
      vec2 wq = vec2(pos.x + pos.z, pos.y);
      vec2 cell = floor(wq / vec2(3.0, 3.5));
      float on = hash12(cell);
      float pane = step(abs(fract(wq.x / 3.0) - 0.5) * 2.0, 0.5) * step(abs(fract(wq.y / 3.5) - 0.5) * 2.0, 0.62);
      float lit = step(0.55, on) * (0.35 + 0.65 * hash12(cell + 7.0)) * pane * win;
      emit += vec3(1.0, 0.55, 0.22) * 0.8 * lit * step(pos.y, 26.0) * step(7.0, pos.y);
      emit += GLOW * 2.0 * smoothstep(9.0, 6.0, pos.y) * step(0.75, hash12(floor(wq / 6.0))) * win;
    } else {
      alb = vec3(0.1, 0.09, 0.07);
    }
    // Light: the furnace glow from the town (warm, from behind), the moon (cool), and the
    // locomotive's firebox close by.
    vec3 moonDir = normalize(vec3(0.62, 0.3, -0.72));
    vec3 l = alb * (vec3(0.05, 0.06, 0.1) * max(dot(n, moonDir), 0.0) * 1.5 + GLOW * 0.07 * max(-n.z * 0.5 + 0.5 * n.y, 0.0) + vec3(0.015, 0.012, 0.012));
    vec3 fb = vec3(uTrainX + 4.2, DECK + 1.5, VZ) - pos;
    l += alb * GLOW * 25.0 * max(dot(n, normalize(fb)), 0.0) / (dot(fb, fb) + 4.0);
    col = l + emit;
    col = mix(col, vec3(0.07, 0.035, 0.025), 1.0 - exp(-t * 0.002));
  }
  vec4 sm = smoke(ro, rd, t > 0.0 ? t : 1200.0);
  col = col * sm.a + sm.rgb;
  fragColor = vec4(col, 1.0);
}
