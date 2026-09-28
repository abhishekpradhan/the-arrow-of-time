// Space, 1957 (from cue clouds): the R-7 punches up through the cloud deck over Baikonur into a
// moonlit night, its flame lighting the clouds from inside, a gibbous Moon over the deck (the
// Moon really was ten days old that night). The camera flies alongside as it climbs and pitches
// over; the sky turns black and the Earth's curve appears. At about 45 km (cue staging, in slow
// motion) the four boosters fall away in the "Korolev cross" and the core stage flies on
// towards orbit. Kilometres for the planet, metres in the rocket's frame (shaders/r7.glsl).
#define ATMO_STEPS 14
#define MARCH_STEPS 110
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime;
#include <camera>
#include <arrow-of-time/space>
#include <arrow-of-time/r7>

uniform vec3 uRk;            // the rocket's base relative to the camera (km)
uniform mat3 uRkRot;         // site axes -> the rocket's frame
uniform float uRkBound;      // radius of a sphere round the rocket and its boosters (m)
uniform float uCore;         // core stage thrust (0..1)
uniform float uBoost;        // boosters' thrust (0..1)
uniform float uRkAlt;        // the rocket's altitude (km): the plume widens in thin air
uniform vec4 uTrail;         // flight time (s), flight direction (site x, z), trail strength
uniform vec3 uHole;          // where the rocket crossed the deck (site x, z) and the hole's radius
uniform vec3 uFlame;         // the flames' light relative to the camera (km)
uniform float uFlameI;       // and its strength
uniform float uFrost;        // frost still on the tanks (0..1)

const float CB = 2.0, CT = 3.3;     // the cloud deck's base and top (km)
const float CSIG = 40.0;            // extinction inside the cloud (per km)
const vec3 FLAME_C = vec3(1.0, 0.62, 0.3);

// ------------------------------------------------------------------ the cloud deck
// Smooth nearest-cell distance (log-sum-exp over the neighbouring cells, after Inigo Quilez's
// smooth Voronoi, MIT License): Voronoi cells without creases between them, for rounded cloud
// heads.
float smoothCells(vec2 p) {
  vec2 n = floor(p), f = fract(p);
  float s = 0.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(i, j);
      vec2 r = g + hash22(n + g) - f;
      s += exp(-3.5 * length(r));
    }
  return -log(s) / 3.5;
}

// Stratocumulus seen from above: long low rolls, rounded heads on them, lumpy tops; rafts broken
// by gaps away from the cosmodrome. Returns the height of the cloud's upper surface in the deck
// (0..1; 0 in a gap). lod fades detail far away.
float deckTop(vec2 x, float lod) {
  vec2 w = vec2(fbm(x * 0.06 + 3.1, 3), fbm(x * 0.06 + 8.3, 3)) - 0.5;
  vec2 p = x * 0.8 + w * 5.0;
  float rolls = 0.5 + 0.5 * sin(dot(x, vec2(0.55, 0.9)) + 3.0 * w.x);
  float heads = mix(1.0 - smoothstep(-0.55, 0.55, smoothCells(p)), 0.5, lod);
  float heads2 = mix(1.0 - smoothstep(-0.55, 0.55, smoothCells(p * 2.3 + 7.0)), 0.5, lod);
  float lumps = mix(fbm(p * 3.0 + 4.0, 3), 0.5, lod);
  float raft = max(smoothstep(0.38, 0.6, fbm(x * 0.04 + 17.0, 4)), smoothstep(22.0, 9.0, length(x)));
  float top = 0.18 + 0.22 * rolls + 0.38 * heads + 0.16 * heads2 + 0.12 * (lumps - 0.5);
  return top * raft;
}

float deckBase(vec2 x) { return CB + (0.1 + 0.12 * fbm(x * 1.3 + 5.0, 2)) * (CT - CB); }

float deckDensity(vec2 x, float h, float lod, out float topH) {
  topH = CB + deckTop(x, lod) * (CT - CB);
  float base = deckBase(x);
  float d = smoothstep(0.0, 0.13, topH - h) * smoothstep(-0.08, 0.08, h - base);
  if (lod < 0.7 && d > 0.0) d *= 0.55 + 0.9 * fbm(vec2(x.x * 4.0 + h * 3.0, x.y * 4.0 - h * 2.0), 3);
  return d;
}

float hg(float c, float g) { float k = 1.0 + g * g - 2.0 * g * c; return (1.0 - g * g) / (4.0 * PI * k * sqrt(k)); }

// Height of the cloud tops at x, or below the deck over a gap.
float deckTopH(vec2 x, float lod) {
  float tp = CB + deckTop(x, lod) * (CT - CB);
  return tp > deckBase(x) + 0.03 ? tp : CB - 1.0;
}

// Light scattered in the cloud at P (altitude h, top of the cloud above it at topH), towards -rd.
vec3 deckLight(vec3 P, float h, float topH, vec3 rd, vec3 n, float t) {
  float cm = dot(rd, uMoonDir);
  float ph = mix(hg(cm, 0.55), hg(cm, -0.25), 0.4) * 4.0 * PI;
  vec3 moonC = uMoonE * atmoLight(P, uMoonDir);
  // Moonlight through the cloud above the sample; the tops' relief (n) shades the domes' far
  // sides; multiple scattering keeps the shadowed parts from going black.
  float depth = max(topH - h, 0.0) / max(uMoonDir.y, 0.2);
  float tm = exp(-CSIG * 0.9 * depth) + 0.3 * exp(-CSIG * 0.1 * depth);
  float relief = (0.5 + 0.5 * saturate(dot(n, uMoonDir) * 0.8 + 0.35)) * (0.75 + 0.25 * smoothstep(CB + 0.35, CT - 0.1, topH));
  // Heads seen edge-on against the Moon glow at their rims.
  float rim = pow(1.0 - saturate(dot(n, -rd)), 4.0) * saturate(cm * 0.5 + 0.5);
  vec3 S = moonC * (ph * tm * 0.55 * relief + rim * 0.6) + uMoonE * vec3(0.75, 0.9, 1.2) * (0.1 * relief + 0.05);
  // The rocket's fire: a point light, dimmed by the cloud in between.
  vec3 toF = uFlame - rd * t;
  float dF = length(toF);
  float fy = toF.y / max(dF, 1e-4);
  float fdepth = fy > 0.0 ? max(topH - h, 0.0) / max(fy, 0.15) : max(h - CB, 0.0) / max(-fy, 0.15);
  fdepth = min(fdepth, dF);
  S += FLAME_C * uFlameI * (exp(-CSIG * 0.45 * fdepth) + 0.5 * exp(-CSIG * 0.035 * fdepth)) / (1.0 + dF * dF / 0.06);
  return S;
}

// The deck over [t0, t1] (km; the ray inside the deck's shell): the ray is first marched against
// the cloud tops, a height field, then the cloud is integrated for a hundred metres or so below
// them, deeper than which it is opaque. Returns the light and multiplies trans.
vec3 marchDeck(vec3 rd, float t0, float t1, inout float trans) {
  float t = t0, tHit = -1.0;
  float tPrev = t0;
  for (int i = 0; i < 90; i++) {
    vec3 P = uCamP + rd * t;
    float h = length(P) - R_E;
    float lod = saturate(t / 90.0);
    float diff = h - deckTopH(P.xz, lod);
    if (diff < 0.0) {
      // Bisect back onto the surface.
      float a = tPrev, b = t;
      for (int k = 0; k < 5; k++) {
        float m = 0.5 * (a + b);
        vec3 Q = uCamP + rd * m;
        if (length(Q) - R_E < deckTopH(Q.xz, lod)) b = m; else a = m;
      }
      tHit = i == 0 ? t : b;
      break;
    }
    float down = max(-dot(rd, normalize(P)), 0.0);
    tPrev = t;
    t += max(diff / (down + 0.45), 0.004 + t * 0.0015);
    if (t > t1) break;
  }
  if (tHit < 0.0) return vec3(0.0);
  // The tops' relief normal at the entry point.
  vec3 P0 = uCamP + rd * tHit;
  float lod0 = saturate(tHit / 90.0);
  float e = mix(0.08, 0.5, lod0);
  float hc = deckTopH(P0.xz, lod0);
  float hr = deckTop(P0.xz, lod0) * (CT - CB);
  vec3 n = normalize(vec3(-(deckTop(P0.xz + vec2(e, 0.0), lod0) * (CT - CB) - hr) / e, 1.0, -(deckTop(P0.xz + vec2(0.0, e), lod0) * (CT - CB) - hr) / e));
  vec3 sum = vec3(0.0);
  const int N = 10;
  float span = mix(0.014, 0.05, lod0);
  for (int i = 0; i < N; i++) {
    float tt = tHit + (float(i) + 0.5) * span - 0.3 * span;
    if (tt > t1) break;
    vec3 P = uCamP + rd * tt;
    float h = length(P) - R_E;
    float topH;
    float den = deckDensity(P.xz, h, lod0, topH) * CSIG;
    if (den <= 0.0) continue;
    float st = exp(-den * span);
    sum += trans * deckLight(P, h, topH, rd, n, tt) * (1.0 - st);
    trans *= st;
    if (trans < 0.01) break;
  }
  // Whatever gets through the first hundred metres meets the rest of the cloud below.
  float down = max(-dot(rd, normalize(P0)), 0.1);
  float rest = max(hc - deckBase(P0.xz) - span * float(N) * down, 0.0) / down;
  float st = exp(-CSIG * 0.7 * rest);
  sum += trans * deckLight(uCamP + rd * (tHit + span * float(N)), hc - 0.15, hc, rd, n, tHit) * 0.6 * (1.0 - st);
  trans *= st;
  return sum;
}

// ------------------------------------------------------------------ the trail
// Inverse of the flight's altitude profile: flight time at which the rocket passed altitude h.
float tauAt(float h) { return (0.001 * h + sqrt(1e-6 * h * h + 0.0132 * h)) / 0.0066; }

// The exhaust trail along the path flown (downrange 0.02 h^2 / (1 + h/120) km), spreading with age, lit by
// the Moon and near the rocket by its flame. Over [0, tMax] (km); multiplies trans.
vec3 marchTrail(vec3 rd, float tMax, inout float trans) {
  vec2 F = uTrail.yz;
  vec2 Nf = vec2(-F.y, F.x);
  vec3 o = uCamP - vec3(0.0, R_E, 0.0);
  float on = dot(o.xz, Nf), dn = dot(rd.xz, Nf);
  // The trail lies in the vertical plane of the flight: sample round the ray's crossing of it,
  // crowded towards the crossing (the smoke is at most a few hundred metres wide).
  float tc, win;
  if (abs(dn) > 1e-3) {
    tc = -on / dn;
    win = min(0.9 / abs(dn), 25.0);
  } else {
    if (abs(on) > 1.0) return vec3(0.0);
    tc = 0.5 * tMax;
    win = 25.0;
  }
  float ta = max(tc - win, 0.0), tb = min(tc + win, tMax);
  if (tb <= ta) return vec3(0.0);
  tc = clamp(tc, ta, tb);
  float cm = dot(rd, uMoonDir);
  float ph = hg(cm, 0.5) * 4.0 * PI;
  vec3 moonC = uMoonE * 0.9;
  vec3 sum = vec3(0.0);
  const int N = 24;
  float la = tc - ta, lb = tb - tc;
  float na = floor(float(N) * la / max(la + lb, 1e-5) + 0.5), nb = float(N) - na;
  for (int i = 0; i < N; i++) {
    float fi = float(i), t, dt;
    if (fi < na) { float u = (fi + 0.5) / na; t = tc - la * (1.0 - u) * (1.0 - u); dt = la * 2.0 * (1.0 - u) / na; }
    else { float u = (fi - na + 0.5) / nb; t = tc + lb * u * u; dt = lb * 2.0 * u / nb; }
    vec3 P = uCamP + rd * t;
    float h = length(P) - R_E;
    if (h < CB || h > uRkAlt) continue;
    float along = dot(P.xz, F), across = dot(P.xz, Nf);
    // Downrange distance at altitude h (the flight profile of shots/ascent.ts) and its slope.
    float kq = 1.0 + h / 120.0;
    float g = 0.02 * h * h / kq, gp = (0.04 * h * kq - 0.02 * h * h / 120.0) / (kq * kq);
    float d = (along - g) / sqrt(1.0 + gp * gp);
    float age = uTrail.x - tauAt(h);
    if (age < 0.0) continue;
    float w = 0.012 + 0.025 * sqrt(age) + 0.003 * age;
    float den = 45.0 * (0.02 / w) * (0.02 / w) * exp(-(d * d + across * across) / (w * w));
    den *= exp(-max(h - 10.0, 0.0) / 9.0) * uTrail.w;
    if (den < 1e-4) continue;
    vec3 toF = uFlame - rd * t;
    float dF = length(toF);
    vec3 S = moonC * (ph * 0.6 + 0.15) + FLAME_C * uFlameI * 0.5 / (1.0 + dF * dF / 0.02);
    float st = exp(-den * dt);
    sum += trans * S * (1.0 - st);
    trans *= st;
  }
  return sum;
}

// ------------------------------------------------------------------ the rocket and its fire
vec3 boostAxis(int i) { mat3 m = uR7Boost[i]; return vec3(m[0][1], m[1][1], m[2][1]); }

float rkMap(vec3 p, out int part) { return r7Map(p, 0.0, part); }
float rkD(vec3 p) { int k; return rkMap(p, k); }

vec3 rkNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.01;
  return normalize(k.xyy * rkD(p + k.xyy * e) + k.yyx * rkD(p + k.yyx * e) + k.yxy * rkD(p + k.yxy * e) + k.xxx * rkD(p + k.xxx * e));
}

float rkShadow(vec3 p, vec3 l) {
  float res = 1.0, t = 0.05;
  for (int i = 0; i < 28; i++) {
    float h = rkD(p + l * t);
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.05, 2.0);
    if (res < 0.01 || t > 40.0) break;
  }
  return saturate(res);
}

// One flame: emission at a point s metres downstream of a nozzle cluster, r metres off its axis.
vec3 flameAt(float s, float r, float w0, float power) {
  if (s < -0.5 || power <= 0.0) return vec3(0.0);
  s = max(s, 0.0);
  float thin = smoothstep(4.0, 45.0, uRkAlt);
  float w = w0 + s * mix(0.05, 0.4, thin);
  float L = mix(35.0, 45.0, thin);
  float core = exp(-r * r / (w * w * 0.2)) * exp(-s / (L * 0.45));
  float body = exp(-r * r / (w * w)) * exp(-s / L);
  float flick = 0.85 + 0.3 * gnoise(vec2(s * 0.05 - uGTime * 3.0, r * 0.1 + w0 * 7.0));
  vec3 hot = vec3(1.0, 0.93, 0.8), warm = vec3(1.0, 0.5, 0.18);
  float k = (w0 * w0) / (w * w);
  return power * (hot * core * 20.0 + mix(warm, vec3(1.0, 0.7, 0.45), 0.3) * body * mix(4.5, 0.9, thin) * flick) * k;
}

// The five flames and, further down, the plume they merge into; in the rocket's frame.
vec3 flames(vec3 p) {
  vec3 e = vec3(0.0);
  // Core stage.
  vec3 q = p - vec3(0.0, -0.8, 0.0);
  e += flameAt(-q.y, length(q.xz), 1.15, uCore);
  // Boosters.
  for (int i = 0; i < 4; i++) {
    vec3 ax = boostAxis(i);
    vec3 o = uR7BoostOff[i] - ax * 0.7;
    vec3 v = p - o;
    float s = -dot(v, ax);
    float r = length(v + ax * s);
    e += flameAt(s, r, 1.1, uBoost);
  }
  // The merged exhaust plume below: widening, and in thin air blooming into a vast faint glow.
  float s = -p.y - 6.0;
  if (s > 0.0) {
    float thin = smoothstep(8.0, 50.0, uRkAlt);
    float w = 4.0 + s * mix(0.06, 0.45, thin);
    float r = length(p.xz);
    float pw = max(uCore, uBoost);
    e += pw * mix(vec3(1.0, 0.55, 0.22), vec3(1.0, 0.45, 0.3), thin) * exp(-r * r / (w * w)) * exp(-s / mix(160.0, 300.0, thin)) * 1.4 * (16.0 / (w * w)) * mix(1.0, 0.1, thin);
  }
  return e;
}

// Emission integrated along the ray through the flames' bounding cylinder, up to tMax (m).
vec3 marchFlames(vec3 ro, vec3 rd, float tMax) {
  if (uCore <= 0.0 && uBoost <= 0.0) return vec3(0.0);
  float thin = smoothstep(8.0, 50.0, uRkAlt);
  float Lm = mix(500.0, 1600.0, thin);
  float Rm = mix(40.0, 400.0, thin);
  // Ray against the cylinder |xz| < Rm, -Lm < y < 8.
  float a = dot(rd.xz, rd.xz), b = dot(ro.xz, rd.xz), c = dot(ro.xz, ro.xz) - Rm * Rm;
  float h = b * b - a * c;
  if (h < 0.0) return vec3(0.0);
  h = sqrt(h);
  float t0 = (-b - h) / max(a, 1e-8), t1 = (-b + h) / max(a, 1e-8);
  if (abs(rd.y) > 1e-6) {
    float y0 = (-Lm - ro.y) / rd.y, y1 = (8.0 - ro.y) / rd.y;
    t0 = max(t0, min(y0, y1));
    t1 = min(t1, max(y0, y1));
  }
  t0 = max(t0, 0.0);
  t1 = min(t1, tMax);
  if (t1 <= t0) return vec3(0.0);
  // Samples crowd towards the ray's closest approach to the nozzles, where the fire is.
  float tc = clamp(-dot(ro - vec3(0.0, -8.0, 0.0), rd), t0, t1);
  vec3 sum = vec3(0.0);
  const int N = 48;
  float la = tc - t0, lb = t1 - tc;
  float na = floor(float(N) * la / max(la + lb, 1e-4) + 0.5), nb = float(N) - na;
  for (int i = 0; i < N; i++) {
    float fi = float(i), t, dt;
    if (fi < na) { float u = (fi + 0.5) / na; t = tc - la * (1.0 - u) * (1.0 - u); dt = la * 2.0 * (1.0 - u) / na; }
    else { float u = (fi - na + 0.5) / nb; t = tc + lb * u * u; dt = lb * 2.0 * u / nb; }
    sum += flames(ro + rd * t) * dt;
  }
  return sum;
}

vec3 shadeRocket(vec3 p, vec3 rd, int part, float dist) {
  vec3 n = rkNormal(p);
  vec3 lm = uRkRot * uMoonDir;
  vec3 up = uRkRot * normalize(uCamP + uRk);   // local vertical at the rocket
  // Paint: light grey, the tails and the tank joints darker; frost on the oxygen tanks while
  // the rocket is still cold.
  float y = p.y;
  vec3 alb = vec3(0.55, 0.56, 0.57);
  if (part == 5) alb = vec3(0.08, 0.075, 0.07);
  // Tank joints every few metres, faded out once they are finer than a pixel or two.
  float seam = part == 0 ? smoothstep(0.03, 0.0, abs(fract(y / 2.9) - 0.5) - 0.47) : 0.0;
  alb *= 1.0 - 0.25 * seam * smoothstep(0.02, 0.006, dist * 2.0 * uTanHalfFov / uRes.y);
  float frostZone = part == 0 ? smoothstep(9.0, 11.0, y) * smoothstep(23.0, 21.0, y) : (part >= 1 && part <= 4 ? smoothstep(6.0, 8.0, length(p - uR7BoostOff[part - 1])) : 0.0);
  alb = mix(alb, vec3(0.82, 0.85, 0.88) * (0.8 + 0.2 * fbm(p.xy * 3.0 + p.z, 3)), frostZone * uFrost);
  // Moonlight with the rocket's own shadow (boosters on the core and the reverse).
  float nl = dot(n, lm);
  vec3 moon = uMoonE * atmoLight(uCamP + uRk, uMoonDir);
  vec3 col = alb * moon * max(nl, 0.0) * (nl > 0.0 ? rkShadow(p + n * 0.05, lm) : 0.0);
  // The fire below: the tails glow orange, the flanks catch it at a grazing angle.
  vec3 f = vec3(0.0, -10.0, 0.0) - p;
  float df = length(f);
  float nf = max(dot(n, f / df), 0.0);
  float fire = max(uCore, uBoost);
  col += alb * FLAME_C * fire * 14.0 * nf / (1.0 + df * df / 30.0);
  // Moonlit cloud and ground below give a faint fill; the sky above a fainter one.
  col += alb * moon * (0.22 * saturate(-dot(n, up) * 0.6 + 0.4) + 0.03);
  // Nozzle throats glow while they burn.
  if (part == 5) col += vec3(1.0, 0.7, 0.4) * 6.0 * fire * smoothstep(-0.2, -0.8, n.y);
  // A hint of sheen on the paint.
  vec3 hv = normalize(lm - rd);
  col += moon * 0.15 * pow(max(dot(n, hv), 0.0), 40.0) * (1.0 - frostZone * uFrost);
  return col;
}

// ------------------------------------------------------------------ the picture
void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  float pix = pixelAngle(uRes.y);

  // The rocket, in its own frame (metres).
  vec3 ro_r = uRkRot * (-uRk * 1000.0), rd_r = uRkRot * rd;
  float tRk = -1.0;
  int part = 0;
  vec2 bs = raySphere(ro_r, rd_r, vec3(0.0, 12.0, 0.0), uRkBound);
  if (bs.y > 0.0) {
    float t = max(bs.x, 0.0);
    for (int i = 0; i < MARCH_STEPS; i++) {
      int k;
      float d = rkMap(ro_r + rd_r * t, k);
      if (d < max(0.002, pix * t * 0.5)) { tRk = t; part = k; break; }
      t += d;
      if (t > bs.y) break;
    }
  }
  float tHit = tRk > 0.0 ? tRk / 1000.0 : 1e9;

  // The ground, the deck and the sky beyond.
  float tG = groundHit(rd, R_E);
  float tEnd = min(tG > 0.0 ? tG : 1e7, tHit);
  vec2 sTop = shellHit(rd, R_E + CT), sBase = shellHit(rd, R_E + CB);
  float d0 = uCamAlt > CT ? sTop.x : 0.0;
  float d1 = sBase.x > 0.0 ? sBase.x : sTop.y;
  bool deck = sTop.y > 0.0 && d0 >= 0.0 && d1 > d0;
  d0 = min(max(d0, 0.0), tEnd);
  d1 = min(d1, tEnd);
  if (d1 <= d0) deck = false;

  vec3 far, halo = vec3(0.0);
  float farA = 1.0;
  if (tRk > 0.0) far = shadeRocket(ro_r + rd_r * tRk, rd_r, part, tRk);
  else if (tG > 0.0) far = groundColor(uCamP + rd * tG, rd);
  else {
    float cover;
    far = moonDisc(rd, pix, cover);
    farA = cover;
    halo = moonHalo(rd) * (1.0 - cover);
  }

  vec3 ro = uCamP;
  vec3 col, T = vec3(1.0);
  vec3 noE = vec3(0.0);
  if (deck) {
    vec3 L1 = atmoSegment(ro, rd, 0.0, d0, uMoonDir, uMoonE, uSunDir, uSunE, T);
    vec3 T1 = T;
    float dt = 1.0;
    vec3 D = marchDeck(rd, d0, d1, dt);
    vec3 T2 = vec3(1.0);
    vec3 L2 = dt > 0.01 ? atmoSegment(ro, rd, d1, tEnd, uMoonDir, uMoonE, uSunDir, uSunE, T2) : vec3(0.0);
    col = L1 + T1 * (D + dt * (L2 + T2 * far * farA));
    T = T1 * dt * T2;
  } else {
    col = atmoSegment(ro, rd, 0.0, tEnd, uMoonDir, uMoonE, uSunDir, uSunE, T);
    col += T * far * farA;
  }
  col += T * halo;
  // The night airglow over the limb.
  col += vec3(0.35, 1.0, 0.45) * uGlow * atmoGlow(ro, rd, tG > 0.0 ? tG : 1e7) * (tRk > 0.0 ? 0.0 : 1.0);

  // The exhaust trail in front, and the fire.
  float tt = 1.0;
  vec3 tr = marchTrail(rd, min(deck ? d0 : tEnd, tHit), tt);
  col = tr + tt * col;
  T *= tt;
  col += marchFlames(ro_r, rd_r, tRk > 0.0 ? tRk : 1e7);
  // The glow of the fire in the air around the rocket (thick air only).
  {
    vec3 f = uFlame;
    float tc = max(dot(f, rd), 0.0);
    float dm = length(f - rd * tc);
    float a = 0.08;
    float air = exp(-uRkAlt / 8.0);
    float glow = (atan((min(tEnd, 1e3) - tc) / sqrt(dm * dm + a * a)) + atan(tc / sqrt(dm * dm + a * a))) / sqrt(dm * dm + a * a);
    col += FLAME_C * uFlameI * air * glow * 0.004;
  }

  // Alpha lets the stars (drawn first) shine through clear sky.
  float hit = (tRk > 0.0 || tG > 0.0) ? 1.0 : max(farA, 1.0 - dot(T, vec3(0.2126, 0.7152, 0.0722)));
  fragColor = vec4(col, hit);
}
