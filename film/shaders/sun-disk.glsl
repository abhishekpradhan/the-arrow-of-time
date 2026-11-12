// The Sun's protoplanetary disk, marched as a volume (shots/sun.ts, the `sunBorn` shot).
//
// The dust is a flared disk in hydrostatic balance: a surface density that falls with radius,
// rings and gaps that deepen as worlds sweep them, a Gaussian in height whose scale height grows
// faster than the radius, and an inner rim puffed up by the star's heat. It is lit by one point,
// the star. Compile with SHADOW_PASS to fill a table of the dust's optical depth along every ray
// from the star (radius across, elevation up); the picture pass reads it, so the rim shadows the
// disk behind it and the flared outer rings rise back into the light. Dust scatters forwards,
// glows where it is hot, and hides what is behind it; a jet leaves along the axis.
#include <common>
#include <color>
#include <camera>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime;
uniform sampler3D uNoise;     // tiling noise (see noiseVolume in shots/sun.ts)
uniform sampler2D uShadow;    // optical depth from the star: x = distance / R_LUT, y = elevation / TH_MAX
uniform float uStar;          // the star's light
uniform float uHeat;          // 0 = an ember of a protostar, 1 = a star
uniform float uFront;         // how far the light of ignition has travelled
uniform float uGaps;          // 0..1: how deep the worlds have carved their gaps
uniform float uSpin;          // orbital time
uniform float uJet;           // the jet's strength
uniform float uDither;
uniform vec4 uWorlds[5];      // xy = position in the midplane, z = glow, w = radius

const float R_IN = 0.13, R_OUT = 2.3, R_LUT = 2.6, TH_MAX = 0.75;
const float Y_MAX = 0.52;     // nothing above this height
const float TAU0 = 7.0;       // vertical optical depth at r = 1
const float G_R[5] = float[5](0.4, 0.62, 0.92, 1.28, 1.7);
const float G_W[5] = float[5](0.032, 0.03, 0.05, 0.045, 0.065);
const float G_D[5] = float[5](0.9, 0.72, 0.94, 0.7, 0.85);

float scaleHeight(float r) {
  float h = 0.04 * pow(r, 1.28);
  // The inner rim faces the star directly: hot, and puffed up.
  return h * (1.0 + 0.9 * exp(-pow((r - R_IN - 0.015) / 0.035, 2.0)));
}

// Vertical optical depth of the smooth disk at radius r.
float column(float r) {
  float s = TAU0 * pow(max(r, 0.05), -0.85);
  s *= smoothstep(R_IN - 0.012, R_IN + 0.02, r) * smoothstep(R_OUT, R_OUT * 0.7, r);
  for (int i = 0; i < 5; i++) {
    float x = (r - G_R[i]) / G_W[i];
    // A gap, and the ring of dust trapped at its outer edge.
    s *= 1.0 - G_D[i] * uGaps * exp(-x * x);
    s *= 1.0 + 0.55 * uGaps * exp(-pow(x - 2.1, 2.0));
  }
  // Ringlets: the dust sorts itself into ever finer bands. They are part of the smooth disk, so
  // the shadow table has them too and each casts a little shade on the next.
  float u = log(max(r, 0.05));
  float fine = sin(u * 41.0 + 1.7 * sin(u * 9.0)) * 0.5 + sin(u * 97.0 + 2.3 * sin(u * 23.0)) * 0.3 + sin(u * 173.0 + 4.0 * sin(u * 31.0)) * 0.2;
  s *= 1.0 + 0.42 * (0.35 + 0.65 * uGaps) * fine;
  return s;
}

// Extinction (per unit length) at height y.
float dustAt(float col, float h, float y) {
  float z = abs(y) / h;
  // Grains settle: above a few scale heights there is almost nothing to scatter light, which
  // gives the disk a surface rather than a fog.
  return col / (2.5066 * h) * exp(-0.5 * z * z) * smoothstep(3.5, 2.5, z);
}

#ifdef SHADOW_PASS
void main() {
  float R = vUv.x * R_LUT, th = vUv.y * TH_MAX;
  float c = cos(th), sn = sin(th);
  const int N = 140;
  float tau = 0.0, ds = R / float(N);
  for (int i = 0; i < N; i++) {
    float s = (float(i) + 0.5) * ds;
    float r = s * c;
    tau += dustAt(column(r), scaleHeight(r), s * sn) * ds;
  }
  fragColor = vec4(tau, 0.0, 0.0, 1.0);
}
#else

// Turbulence that orbits with the disk: two copies of the pattern, each sheared by the
// difference in orbital speed for a few seconds, cross-faded before they wind up.
vec4 swirl(vec3 p, float r) {
  float a = atan(p.z, p.x), lr = log(max(r, 0.05));
  float omega = pow(max(r, 0.22), -1.5);
  const float P = 7.0;
  float ph = uSpin / P;
  float f0 = fract(ph), f1 = fract(ph + 0.5);
  float a0 = a + (f0 - 0.5) * P * omega * 0.3 + floor(ph) * 1.7;
  float a1 = a + (f1 - 0.5) * P * omega * 0.3 + floor(ph + 0.5) * 1.7 + 2.3;
  // Drawn out along the orbits: far finer across the rings than around them.
  vec3 q0 = vec3(cos(a0) * 0.42, sin(a0) * 0.42, lr * 1.9 + p.y * 1.5);
  vec3 q1 = vec3(cos(a1) * 0.42, sin(a1) * 0.42, lr * 1.9 + p.y * 1.5 + 0.37);
  vec3 fine = vec3(1.6, 1.6, 4.3);
  vec4 n0 = textureLod(uNoise, q0, 0.0) * 0.55 + textureLod(uNoise, q0 * fine + 0.4, 0.0) * 0.45;
  vec4 n1 = textureLod(uNoise, q1, 0.0) * 0.55 + textureLod(uNoise, q1 * fine + 0.4, 0.0) * 0.45;
  return mix(n0, n1, abs(2.0 * f0 - 1.0));
}

// The wake of a forming world: a spiral density wave that trails it outside its orbit and
// leads it inside (the shape of the linear wake of Rafikov 2002, opened up to be seen).
float wakes(vec3 p, float r) {
  float a = atan(p.z, p.x);
  float sum = 0.0;
  for (int j = 0; j < 5; j++) {
    vec2 w = uWorlds[j].xy;
    float rp = length(w), ap = atan(w.y, w.x);
    float x = r / rp;
    float lag = sign(x - 1.0) * (2.0 / (3.0 * 0.11)) * (pow(x, 1.5) - 1.5 * log(x) - 1.0);
    float da = a - ap + lag;
    da -= TAU * floor(da / TAU + 0.5);
    float wd = 0.035 + 0.06 * abs(x - 1.0);
    // It builds a little way from the world, then fades with distance and towards the rim.
    float ax = abs(x - 1.0);
    sum += exp(-pow(da * r / wd, 2.0)) * smoothstep(0.03, 0.22, ax) * exp(-ax / 0.5) * smoothstep(R_OUT * 0.86, R_OUT * 0.6, r);
  }
  return sum;
}

float phaseHG(float mu, float g) {
  float d = 1.0 + g * g - 2.0 * g * mu;
  return (1.0 - g * g) / (d * sqrt(d));
}

// The star's light arriving at distance s, with the front of ignition sweeping outwards.
float starlight(float s) {
  float lit = smoothstep(uFront, uFront - 0.5, s);
  float flash = exp(-pow((s - uFront + 0.1) / 0.16, 2.0)) * step(0.0, uFront) * smoothstep(3.6, 2.2, uFront);
  float I = uStar * (0.14 + 0.86 * lit + 1.4 * flash);
  // (Far brighter than life: a real disk is a thousandth of its star.)
  return 9.0 * I / (0.03 + pow(s, 1.6));
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  vec3 col = vec3(0.0);
  float T = 1.0;
  vec3 starCol = mix(vec3(1.0, 0.42, 0.16), vec3(1.0, 0.9, 0.76), uHeat);

  // ---------------------------------------------------------------- the disk
  // Bounds: a slab around the midplane, inside a cylinder.
  float ry = abs(rd.y) < 1e-5 ? 1e-5 : rd.y;
  float ty0 = (-Y_MAX - ro.y) / ry, ty1 = (Y_MAX - ro.y) / ry;
  float tA = max(min(ty0, ty1), 0.0), tB = max(ty0, ty1);
  float qa = dot(rd.xz, rd.xz), qb = dot(ro.xz, rd.xz), qc = dot(ro.xz, ro.xz) - (R_OUT + 0.1) * (R_OUT + 0.1);
  float disc = qb * qb - qa * qc;
  // What the dust in front of the star and of the jet lets through, for this ray.
  float tStarRay = max(dot(-ro, rd), 0.0);
  float jb = rd.y, jdd = dot(rd, ro), je = ro.y;
  float jden = max(1.0 - jb * jb, 1e-4);
  float tJet = (jb * je - jdd) / jden;
  float seenStar = 1.0, seenJet = 1.0;
  float tWorld[5], seenWorld[5];
  for (int j = 0; j < 5; j++) {
    tWorld[j] = dot(vec3(uWorlds[j].x, 0.0, uWorlds[j].y) - ro, rd);
    seenWorld[j] = 1.0;
  }
  if (disc > 0.0 && tB > 0.0) {
    float sq = sqrt(disc);
    tA = max(tA, (-qb - sq) / qa);
    tB = min(tB, (-qb + sq) / qa);
    float dith = hash12(gl_FragCoord.xy + uDither);
    float t = tA;
    bool first = true;
    for (int i = 0; i < 220; i++) {
      if (t >= tB || T < 0.005) break;
      vec3 pos = ro + rd * t;
      float r = length(pos.xz);
      float h = scaleHeight(r);
      float ay = abs(pos.y);
      // Big strides above the dust, a fraction of a scale height inside it.
      float above = ay - 4.6 * h;
      float dt = clamp(max(above, 0.0) * 0.7 + 0.2 * h, 0.003, 0.12);
      if (above > 0.0) { t += dt; continue; }
      if (first) { t -= dt * dith; first = false; pos = ro + rd * t; r = length(pos.xz); h = scaleHeight(r); ay = abs(pos.y); }
      vec4 n = swirl(pos, r);
      // The turbulence wrinkles the surface and gathers the dust into clumps as time goes on.
      float wk = wakes(pos, r) * uGaps;
      float hh = h * (0.82 + 0.4 * n.g) * (1.0 + 0.2 * wk);
      float cd = column(r) * (0.5 + 1.0 * n.r) * (1.0 + 1.2 * uGaps * smoothstep(0.55, 0.9, n.b)) * (1.0 + 0.9 * wk);
      // A ragged outer edge.
      cd *= smoothstep(R_OUT * (0.84 + 0.2 * n.g), R_OUT * (0.6 + 0.2 * n.g), r);
      float k = dustAt(cd, hh, pos.y);
      if (k > 1e-3) {
        float s = length(pos);
        float th = asin(clamp(ay / max(s, 1e-3), 0.0, 1.0));
        float tau = texture(uShadow, vec2(s / R_LUT, th / TH_MAX)).r;
        // The ripples shade themselves a little: thicker dust on the star's side means less light.
        // Light that has grazed through dust arrives redder.
        vec3 tStar = exp(-tau * (0.7 + 0.6 * n.r) * vec3(0.72, 1.0, 1.45));
        float mu = dot(pos / max(s, 1e-3), -rd);
        float I = starlight(s);
        // Fine grains ride high and scatter bluer; the body of the disk is warm.
        vec3 albedo = mix(vec3(1.0, 0.64, 0.38), vec3(0.8, 0.86, 1.0), smoothstep(1.4, 3.6, ay / h) * 0.32);
        vec3 sc = albedo * starCol * I * (tStar * phaseHG(mu, 0.42) + vec3(0.05, 0.028, 0.016) * exp(-tau * 0.12));
        // Heat: the rim glows like a coal, the disk behind it a dull red.
        float temp = 1750.0 * pow(max(r, R_IN) / R_IN, -0.62) * (0.75 + 0.25 * uHeat + 0.25 * n.b);
        vec3 th3 = blackbody(temp) * pow(temp / 1750.0, 4.0) * 5.5;
        col += T * (sc + th3) * k * dt;
        T *= exp(-k * dt);
      }
      t += dt;
      if (t < tStarRay) seenStar = T;
      if (t < tJet) seenJet = T;
      for (int j = 0; j < 5; j++) if (t < tWorld[j]) seenWorld[j] = T;
    }
  }

  // ---------------------------------------------------------------- the jet
  // Gas flung out along the axis in bursts: knots that travel outwards, widening as they go.
  {
    float tr = tJet;                          // along the ray
    float ta = (je - jb * jdd) / jden;        // along the axis
    vec3 pr = ro + rd * max(tr, 0.0);
    float along = abs(ta);
    float sgn = sign(ta);
    // It precesses a little, so it is not a ruled line.
    vec2 sway = 0.03 * along * vec2(sin(along * 7.0 - uSpin * 1.3), cos(along * 5.3 - uSpin * 0.9));
    float dj = length(pr - vec3(sway.x, ta, sway.y));
    float wj = 0.007 + 0.034 * along;
    float beam = exp(-dj * dj / (wj * wj)) * 0.012 / wj;
    float trav = along - uSpin * 0.42;
    float knots = 0.12 + 2.2 * pow(textureLod(uNoise, vec3(0.13, 0.31 + 0.2 * sgn, trav * 0.5), 0.0).a, 1.3)
                + 1.3 * pow(0.5 + 0.5 * sin(trav * 15.0 + 2.0 * sgn), 8.0);
    // The far jet is short: it would otherwise run on below the disk.
    float len = sgn > 0.0 ? 1.0 : 0.3;
    float reach = smoothstep(0.02, 0.1, along) * exp(-along * 1.2 / len) * smoothstep(2.4 * len, 1.2 * len, along);
    vec3 jc = mix(vec3(0.62, 0.78, 1.0), vec3(1.0, 0.5, 0.42), smoothstep(0.3, 1.5, along));
    // The far jet is seen through the disk.
    col += jc * beam * knots * reach * uJet * seenJet;
  }

  // ---------------------------------------------------------------- worlds in the making
  // Each gap has the body that swept it: an ember in the midplane, glowing with the heat of
  // what falls on it, seen through the dust that is left above.
  for (int j = 0; j < 5; j++) {
    vec4 w = uWorlds[j];
    float d = length(ro + rd * tWorld[j] - vec3(w.x, 0.0, w.y));
    float px = 2.0 * uTanHalfFov / uRes.y * tWorld[j];
    float rr = max(w.w, 1.2 * px);
    float e = exp(-d * d / (2.0 * rr * rr)) * 14.0 * (w.w * w.w) / (rr * rr) + exp(-d / (3.0 * w.w)) * 0.3;
    // Their glow is mostly infrared, which the dust hides less.
    col += vec3(1.0, 0.52, 0.22) * w.z * e * pow(seenWorld[j], 0.4);
  }

  // ---------------------------------------------------------------- the star
  {
    float tc = tStarRay;
    float d = length(ro + rd * tc);
    float px = 2.0 * uTanHalfFov / uRes.y * tc;
    float rr = max(0.016, 1.2 * px);
    float core = exp(-d * d / (2.0 * rr * rr)) * 70.0 * (0.016 * 0.016) / (rr * rr);
    float halo = exp(-d / 0.045) * 1.6 + exp(-d / 0.2) * 0.14;
    col += starCol * uStar * (core * seenStar + halo * (0.4 + 0.6 * seenStar));
  }
  fragColor = vec4(max(col, 0.0), 1.0 - T);
}
#endif
