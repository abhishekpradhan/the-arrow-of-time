// Space, 1957: in orbit, about 230 km up (shots/sputnik.ts). The core stage coasts over the night
// side of the Earth, moonlit cloud below and the thin green airglow over the limb; its fairing
// splits and falls away, and at cue sputnik the satellite is pushed off, its four antennas
// springing out: a polished sphere that mirrors the Earth. Ahead the limb pales, then glows red
// and blue, until the Sun breaks over it (cue orbitalDawn): sunlight sweeps over Sputnik and turns
// it into a star, the dawn runs across the clouds below, and as it passes before the Sun the
// glare takes the frame and the film crosses to the Moon, 1969.
//
// Kilometres for the Earth (from uCamP, the camera relative to the Earth's centre, in the orbit's
// axes: x along the track, y up, z across it); metres for the hardware, relative to the camera.
#define ATMO_STEPS 22
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime;
#include <camera>
#include <arrow-of-time/space>
#include <arrow-of-time/r7>

uniform vec3 uStage;          // the core stage's frame origin (its tail) relative to the camera (m)
uniform mat3 uStageRot;       // orbit axes -> the stage's frame
uniform vec3 uFair[2];        // the fairing halves' base centres relative to the camera (m)
uniform mat3 uFairRot[2];     // orbit axes -> each half's frame
uniform vec3 uSat;            // Sputnik's centre relative to the camera (m)
uniform mat3 uSatRot;         // orbit axes -> Sputnik's frame (antennas trailing along -x)
uniform float uSweep;         // the antennas' angle from the axis (radians)
uniform float uCloudT;        // the clouds' drift
uniform float uSunSize;       // the Sun's angular radius as drawn (radians)

const float R_C = R_E + 6.0;  // cloud tops
const float BALL = 0.29;      // Sputnik's radius (m)
const vec3 SUN_L = vec3(1.0, 0.96, 0.9);

// ------------------------------------------------------------------ the Earth from orbit
// Weather over the planet (map axes, unit vector q): fronts and swirls a thousand kilometres
// across, and within them decks, bands and cells down to a few kilometres.
float cloudField(vec3 q, int oct) {
  vec3 cq = rotY(uCloudT) * q;
  vec3 w = vec3(fbm(cq * 2.6, 4), fbm(cq * 2.6 + 5.2, 4), fbm(cq * 2.6 + 9.1, 4));
  float big = fbm(cq * 4.0 + w * 2.0, 4);
  vec3 w2 = vec3(fbm(cq * 28.0 + 1.7, 3), fbm(cq * 28.0 + 4.3, 3), fbm(cq * 28.0 + 8.8, 3));
  float mid = fbm(cq * 70.0 + w2 * 3.0 + w * 8.0, oct - 2);
  return big * 0.5 + mid * 0.5;
}
float cloudCover(float n) { return smoothstep(0.43, 0.57, n); }

// Colour of the Earth where the ray meets it (clouds over land and sea), before the air in front.
// full: the cloud relief and shadows (off for mirror images).
vec3 earthSurface(vec3 rd, float tG, bool full, out float tSurf) {
  // The cloud tops first.
  vec2 cs = shellHit(rd, R_C);
  float tC = cs.x > 0.0 ? cs.x : tG;
  vec3 Pc = uCamP + rd * tC;
  vec3 nc = normalize(Pc);
  vec3 qc = normalize(uToMap * nc);
  int oct = full ? 8 : 5;
  float cn = cloudField(qc, oct);
  float cov = cloudCover(cn);
  tSurf = cov > 0.5 ? tC : tG;
  vec3 Pg = uCamP + rd * tG;
  vec3 ng = normalize(Pg);
  vec3 col = groundColor(Pg, rd);
  if (full) {
    // Cloud shadows on the ground, long when the Sun is low.
    float mu = max(dot(ng, uSunDir), 0.02);
    vec3 Ps = Pg + uSunDir * (6.0 / mu);
    float sh = cloudCover(cloudField(normalize(uToMap * normalize(Ps)), 5));
    col *= 1.0 - 0.75 * sh * smoothstep(0.0, 0.05, mu);
  }
  if (cov > 0.0) {
    // Relief of the cloud tops from the field's slope: at dawn it rakes across them.
    vec3 n = nc;
    if (full) {
      vec3 t1 = normalize(cross(nc, vec3(0.0, 1.0, 0.0)));
      vec3 t2 = cross(nc, t1);
      float e = 0.0015;
      float gx = cloudField(normalize(uToMap * normalize(nc + t1 * e)), 6) - cn;
      float gy = cloudField(normalize(uToMap * normalize(nc + t2 * e)), 6) - cn;
      n = normalize(nc - (t1 * gx + t2 * gy) * 18.0);
    }
    vec3 sunC = uSunE * atmoLight(Pc, uSunDir);
    vec3 moonC = uMoonE * atmoLight(Pc, uMoonDir);
    float ds = dot(n, uSunDir), dm = dot(n, uMoonDir);
    vec3 lit = sunC * saturate(ds * 0.8 + 0.2) * smoothstep(-0.1, 0.05, dot(nc, uSunDir));
    lit += moonC * saturate(dm * 0.8 + 0.2);
    // Moonlit cloud is seen in the eye's night colours: grey, a little blue.
    float night = 1.0 - smoothstep(-0.05, 0.1, dot(nc, uSunDir));
    vec3 cloud = mix(vec3(0.9, 0.9, 0.92), vec3(0.8, 0.86, 1.0), night) * lit * (0.75 + 0.25 * cn);
    col = mix(col, cloud, cov);
  }
  return col;
}

// The whole view of the planet and sky along rd (no hardware): the Earth with its air, the limb,
// the airglow, the Sun and the Moon. trans is the transmittance to space (for the stars).
vec3 skyAndEarth(vec3 rd, bool full, float pix, out vec3 trans) {
  float tG = groundHit(rd, R_E);
  vec3 T = vec3(1.0);
  vec3 col;
  if (tG > 0.0) {
    float tS;
    vec3 surf = earthSurface(rd, tG, full, tS);
    col = atmoSegment(uCamP, rd, 0.0, tS, uSunDir, uSunE, uMoonDir, uMoonE, T);
    col += T * surf;
    T = vec3(0.0);
  } else {
    col = atmoSegment(uCamP, rd, 0.0, 1e5, uSunDir, uSunE, uMoonDir, uMoonE, T);
    // The Sun: a limb-darkened disc, and the Moon.
    float c = dot(rd, uSunDir);
    float ang = acos(clamp(c, -1.0, 1.0));
    float disc = 1.0 - smoothstep(uSunSize - pix, uSunSize + pix, ang);
    float r = saturate(ang / uSunSize);
    // (The first light through the limb is deep red; film it a warmer gold, as a camera would.)
    vec3 tSun = mix(T, vec3(dot(T, vec3(0.3, 0.5, 0.2))) * vec3(1.25, 0.95, 0.6), 0.55);
    col += tSun * SUN_L * uSunE * 120.0 * disc * (0.4 + 0.6 * sqrt(max(1.0 - r * r, 0.0)));
    float cover;
    vec3 moon = moonDisc(rd, pix, cover);
    col += T * (moon + moonHalo(rd) * (1.0 - cover));
    if (cover > 0.5 || disc > 0.5) T = vec3(0.0);
  }
  col += vec3(0.35, 1.0, 0.45) * uGlow * atmoGlow(uCamP, rd, tG > 0.0 ? tG : 1e7);
  trans = T;
  return col;
}

// ------------------------------------------------------------------ the hardware
// A fairing half in its own frame: a thin conical shell on the core's top ring (y = 0 at the
// ring, the tip 4.6 m up), the half with z > 0.
float fairingHalf(vec3 p) {
  vec2 q = vec2(length(p.xz), p.y);
  vec2 a = vec2(1.14, 0.0), b = vec2(0.1, 4.6);
  vec2 e = b - a, w = q - a;
  vec2 k = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
  float shell = length(k) - 0.035;
  return max(shell, -p.z);
}

// Sputnik: the sphere (with the seam of its two halves and the antenna mounts) and the four
// whip antennas, 2.4 and 2.9 m, swept back from the front. mat: 0 sphere, 1 antenna.
float sputnikD(vec3 q, out float mat) {
  float d = length(q) - BALL;
  mat = 0.0;
  if (length(q) > 3.4) return length(q) - 3.3;
  float ant = 1e9;
  for (int i = 0; i < 4; i++) {
    float a = float(i) * 1.5708 + 0.785;
    float len = (i & 1) == 0 ? 2.4 : 2.9;
    vec3 root = normalize(vec3(0.55, 0.59 * cos(a), 0.59 * sin(a))) * (BALL - 0.01);
    vec3 dir = normalize(vec3(-cos(uSweep), sin(uSweep) * cos(a), sin(uSweep) * sin(a)));
    ant = min(ant, sdTaper(q, root, root + dir * len, 0.012, 0.004));
    ant = min(ant, sdCapsule(q, root - root * 0.02, root + normalize(root) * 0.05, 0.022));
  }
  if (ant < d) { d = ant; mat = 1.0; }
  return d;
}

float hardware(vec3 p, out int id, out float mat) {
  mat = 0.0;
  float ms;
  float d = sputnikD(uSatRot * (p - uSat), ms);
  id = 0;
  mat = ms;
  int k;
  float st = r7Core(uStageRot * (p - uStage), 1.0);
  if (st < d) { d = st; id = 1; }
  for (int i = 0; i < 2; i++) {
    float f = fairingHalf(uFairRot[i] * (p - uFair[i]));
    if (f < d) { d = f; id = 2 + i; }
  }
  return d;
}
float hardwareD(vec3 p) { int id; float m; return hardware(p, id, m); }

vec3 hwNormal(vec3 p, float e) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * hardwareD(p + k.xyy * e) + k.yyx * hardwareD(p + k.yyx * e) + k.yxy * hardwareD(p + k.yxy * e) + k.xxx * hardwareD(p + k.xxx * e));
}

// Shadows of the hardware on itself. Space light is hard (the Sun and Moon are small), so the
// penumbra is narrow; the estimate uses the closest approach between successive steps
// (Inigo Quilez's improved soft shadow, MIT License), which keeps curved surfaces free of the
// terraced bands the simple estimate draws.
float hwShadow(vec3 p, vec3 l) {
  float res = 1.0, t = 0.04, ph = 1e10;
  for (int i = 0; i < 48; i++) {
    float h = hardwareD(p + l * t);
    float y = h * h / (2.0 * ph);
    float d = sqrt(max(h * h - y * y, 0.0));
    res = min(res, 30.0 * d / max(0.0, t - y));
    ph = h;
    t += clamp(h, 0.004, 1.5);
    if (res < 0.001 || t > 40.0) break;
  }
  res = saturate(res);
  return res * res * (3.0 - 2.0 * res);
}

// The Sun's mirror image in a curved surface: its light spread over the angle a pixel sees
// (sigma), so the tiny image does not flicker.
vec3 sunGlint(vec3 r, float sigma, vec3 sunC) {
  float c = dot(r, uSunDir);
  float th2 = 2.0 * max(1.0 - c, 0.0);
  float s2 = max(sigma * sigma, uSunSize * uSunSize);
  // Sun radiance x its solid angle, over the lobe's solid angle.
  float omega = PI * uSunSize * uSunSize;
  return sunC * SUN_L * 120.0 * omega / (PI * s2) * exp(-th2 / s2);
}

vec3 shadeHardware(vec3 p, vec3 rd, int id, float mat, float dist, float pix) {
  vec3 n = hwNormal(p, 0.002 + dist * pix * 0.5);
  vec3 P = uCamP + p * 0.001;
  vec3 sunC = uSunE * atmoLight(P, uSunDir);
  vec3 moonC = uMoonE * atmoLight(P, uMoonDir);
  float shS = dot(n, uSunDir) > 0.0 && dot(sunC, sunC) > 1e-6 ? hwShadow(p + n * 0.03, uSunDir) : 0.0;
  float shM = dot(n, uMoonDir) > 0.0 ? hwShadow(p + n * 0.03, uMoonDir) : 0.0;
  // Light from the Earth below: moonlit cloud at night, and at dawn a little sunlit haze.
  vec3 down = -normalize(uCamP);
  float fromEarth = saturate(dot(n, down) * 0.5 + 0.5);
  vec3 earthshine = (uMoonE * 0.35 + uSunE * 0.04 * smoothstep(-0.3, -0.2, dot(normalize(uCamP), uSunDir))) * fromEarth;
  if (id == 0 && mat < 0.5) {
    // Polished aluminium: a mirror of the Earth and the sky, with a little haze from the
    // machining (a broad lobe round the reflection) that lights a crescent on the side facing a
    // low Sun, where a perfect mirror would show a glint too small to see.
    vec3 r = reflect(rd, n);
    vec3 tr;
    vec3 env = skyAndEarth(r, false, pix, tr);
    float fres = 0.88 + 0.12 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
    float sigma = 2.0 * dist * pix / BALL;
    float rs = max(dot(r, uSunDir), 0.0);
    vec3 col = env * fres * vec3(0.93, 0.94, 0.96);
    col += (sunGlint(r, sigma, sunC) + sunC * (18.0 * pow(rs, 900.0) + 1.6 * pow(rs, 60.0) + 0.25 * pow(rs, 8.0))) * shS * fres;
    // The Moon's glint.
    float cmn = dot(r, uMoonDir);
    float s2m = max(sigma * sigma, uMoonSize * uMoonSize);
    col += vec3(1.0, 0.97, 0.92) * uMoonBright * 0.6 * (uMoonSize * uMoonSize) / s2m * exp(-2.0 * max(1.0 - cmn, 0.0) / s2m) * shM * fres;
    // The haze also spreads the Earth below over the lower half, and keeps the half that mirrors
    // black space from vanishing entirely.
    float upness = dot(n, normalize(uCamP));
    col += vec3(0.05, 0.06, 0.09) * (uMoonE.b * 0.6 + 0.05 * uSunE.g * smoothstep(-0.3, -0.2, dot(normalize(uCamP), uSunDir))) * (0.6 - 0.4 * upness);
    // The seam between the hemispheres, a slightly duller band.
    vec3 q = uSatRot * (p - uSat);
    col *= 1.0 - 0.35 * smoothstep(0.008, 0.0, abs(q.x - 0.02));
    return col + vec3(0.04) * (sunC * max(dot(n, uSunDir), 0.0) * shS + moonC * max(dot(n, uMoonDir), 0.0) * shM + earthshine);
  }
  if (id == 0) {
    // The antennas: steel whips lit along their length (a hair-like highlight).
    vec3 q = uSatRot * (p - uSat);
    vec3 tng = normalize(transpose(uSatRot) * normalize(vec3(-cos(uSweep), sin(uSweep) * sign(q.y) * 0.7, sin(uSweep) * sign(q.z) * 0.7)));
    vec3 hs = normalize(uSunDir - rd), hm = normalize(uMoonDir - rd);
    float ks = pow(sqrt(max(1.0 - pow(dot(tng, hs), 2.0), 0.0)), 120.0);
    float km = pow(sqrt(max(1.0 - pow(dot(tng, hm), 2.0), 0.0)), 120.0);
    vec3 alb = vec3(0.55, 0.56, 0.58);
    vec3 col = alb * (sunC * max(dot(n, uSunDir), 0.0) * shS + moonC * max(dot(n, uMoonDir), 0.0) * shM + earthshine);
    col += sunC * shS * ks * 3.0 + moonC * shM * km * 1.5;
    return col;
  }
  vec3 alb = id == 0 ? vec3(0.6, 0.61, 0.63) : id == 1 ? vec3(0.5, 0.51, 0.52) : vec3(0.55, 0.56, 0.57);
  float spec = id == 0 ? 0.6 : 0.12;
  float rough = id == 0 ? 60.0 : 20.0;
  vec3 col = alb * (sunC * max(dot(n, uSunDir), 0.0) * shS + moonC * max(dot(n, uMoonDir), 0.0) * shM + earthshine);
  vec3 hs = normalize(uSunDir - rd), hm = normalize(uMoonDir - rd);
  col += spec * (sunC * shS * pow(max(dot(n, hs), 0.0), rough) + moonC * shM * pow(max(dot(n, hm), 0.0), rough));
  return col;
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  float pix = pixelAngle(uRes.y);

  // The hardware: march within spheres round Sputnik, the stage and the fairing halves (metres).
  float tH = -1.0;
  int id = 0;
  float mat = 0.0;
  float t0 = 1e9, t1 = -1e9;
  vec2 b0 = raySphere(vec3(0.0), rd, uSat, 3.4);
  if (b0.y > 0.0) { t0 = min(t0, b0.x); t1 = max(t1, b0.y); }
  vec2 b1 = raySphere(vec3(0.0), rd, uStage + transpose(uStageRot) * vec3(0.0, 14.0, 0.0), 16.0);
  if (b1.y > 0.0) { t0 = min(t0, b1.x); t1 = max(t1, b1.y); }
  for (int i = 0; i < 2; i++) {
    vec2 bf = raySphere(vec3(0.0), rd, uFair[i] + transpose(uFairRot[i]) * vec3(0.0, 2.3, 0.0), 3.2);
    if (bf.y > 0.0) { t0 = min(t0, bf.x); t1 = max(t1, bf.y); }
  }
  if (t1 > 0.0) {
    float t = max(t0, 0.0);
    for (int i = 0; i < 160; i++) {
      float d = hardware(rd * t, id, mat);
      if (d < max(0.0006, pix * t * 0.4)) { tH = t; break; }
      t += d * 0.9;
      if (t > t1) break;
    }
  }

  vec3 col;
  float alpha;
  if (tH > 0.0) {
    col = shadeHardware(rd * tH, rd, id, mat, tH, pix);
    alpha = 1.0;
  } else {
    vec3 T;
    col = skyAndEarth(rd, true, pix, T);
    alpha = 1.0 - dot(T, vec3(0.2126, 0.7152, 0.0722));
  }
  fragColor = vec4(col, alpha);
}
