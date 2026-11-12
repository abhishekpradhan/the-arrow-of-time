// The solar nebula: a star-forming cloud marched as a volume (shots/sun.ts, the `nebula` shot).
//
// The dense dust is a signed distance field (a cloud bank and pillars that point at the stars
// eroding them) displaced by noise from a tiling 3D texture. Thin gas boils off its surface and
// fills the cavity the stars have blown. One light direction (the cluster of hot stars, up and
// behind the cloud) is marched for shadows: gas the ultraviolet reaches glows (teal near the
// stars, rose further out, white gold in the thin layer hugging the dust) and the dust facing us
// stays dark. A supernova's blast wave is a shell that heats the gas it crosses, and the head of
// the tallest pillar then falls in on itself around an ember: the Sun to be.
#include <common>
#include <color>
#include <camera>
#include <stars>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime;
uniform sampler3D uNoise;   // tiling noise: r, g = large shapes, b = detail, a = ridged filaments
uniform float uNoiseRes;
uniform vec3 uSn;           // the massive star that dies
uniform vec2 uSnScreen;     // where it is in the picture
uniform vec3 uCore;         // the head of the pillar that collapses
uniform float uSnT;         // seconds since the supernova (negative before it)
uniform float uShock;       // radius of the blast wave
uniform float uCollapse;    // 0..1
uniform float uEmber;       // the protostar's glow
uniform float uDither;

const vec3 LDIR = normalize(vec3(-0.5, 0.52, -0.69));    // towards the cluster: up, left, behind
const vec3 PDIR = normalize(vec3(-0.4, 0.9, -0.14));     // the pillars' axis
const vec3 WALL_N = normalize(vec3(-0.08, 0.95, 0.2));
const mat3 NROT = mat3(0.80, 0.36, -0.48, -0.60, 0.48, -0.64, 0.0, 0.80, 0.60);
const mat3 NROT2 = mat3(0.36, 0.80, 0.48, 0.48, -0.60, 0.64, 0.80, 0.0, -0.60);

const float K_DENSE = 46.0;   // extinction of the dust, per unit length
const float K_THIN = 0.5;
const float K_SHADOW = 70.0;
const float SH0 = 0.028;      // first shadow sample
// Directions of the cluster's stars, and their brightness.
const vec4 YOUNG[6] = vec4[6](
  vec4(-0.33, 0.27, -0.9, 1.3), vec4(-0.6, 0.06, -0.78, 0.8), vec4(-0.12, 0.3, -0.94, 0.9),
  vec4(-0.43, 0.34, -0.84, 0.5), vec4(0.3, 0.27, -0.92, 0.7), vec4(-0.24, 0.13, -0.96, 0.45));

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// Trilinear filtering with smoothed weights: no creases where the noise is magnified.
vec4 noiseC1(vec3 q) {
  q = q * uNoiseRes + 0.5;
  vec3 i = floor(q), f = q - i;
  f = f * f * (3.0 - 2.0 * f);
  return textureLod(uNoise, (i + f - 0.5) / uNoiseRes, 0.0);
}

// A pillar: a column that ends in a rounded head at `tip` and widens back into the cloud.
float pillar(vec3 p, vec3 tip, float len, float rTip, float rBase) {
  vec3 pa = p - tip;
  float h = clamp(-dot(pa, PDIR) / len, 0.0, 1.0);
  // A slight neck behind the head, as the real ones have.
  float r = mix(rTip, rBase, h * h) - 0.2 * rTip * exp(-pow((h - 0.22) / 0.1, 2.0));
  return length(pa + PDIR * (h * len)) - r;
}

// Distance (roughly) to the dense dust, from the large shapes and low-frequency noise only.
float shape(vec3 p, out vec4 n) {
  n = noiseC1(NROT * p * 0.26 + vec3(0.37, 0.11, 0.73));
  float d = dot(p - vec3(0.0, -0.78, 0.0), WALL_N) - (n.r - 0.5) * 0.9;
  // It heaps up towards the left, away from the caption.
  d -= 0.42 * smoothstep(0.2, -2.2, p.x);
  float shrink = 1.0 - 0.3 * uCollapse;
  // The tallest pillar, with two fingers off its head; then its neighbours.
  d = smin(d, pillar(p, uCore, 2.1, 0.165 * shrink, 0.38), 0.3);
  d = smin(d, pillar(p, uCore + vec3(0.17, -0.2, 0.06), 0.9, 0.055, 0.16), 0.12);
  d = smin(d, pillar(p, uCore + vec3(-0.1, -0.33, 0.12), 0.7, 0.04, 0.13), 0.1);
  d = smin(d, pillar(p, vec3(0.5, -0.02, -0.8), 1.3, 0.085, 0.26), 0.24);
  d = smin(d, pillar(p, vec3(-1.02, -0.2, 0.42), 1.2, 0.075, 0.24), 0.22);
  d = smin(d, pillar(p, vec3(-1.75, 0.02, -0.9), 1.3, 0.1, 0.3), 0.26);
  d = smin(d, pillar(p, vec3(1.35, -0.42, -1.3), 0.9, 0.07, 0.2), 0.2);
  // The bank rounds off and ends before it reaches the camera.
  float nearCam = smoothstep(0.6, 1.8, p.z);
  d += 1.6 * nearCam * nearCam;
  return d - (n.g - 0.5) * 0.24;
}

struct Gas {
  float sd0;     // distance to the dust's large shapes
  float sd;      // and with its fine structure
  float dense;   // dust, 0..1
  float thin;    // glowing gas
  vec4 n, m;     // the noise it was built from
};

Gas gasAt(vec3 p) {
  Gas g;
  g.sd0 = shape(p, g.n);
  float sd = g.sd0;
  // Structure drawn out along the pillars, the way the wind off the stars combs them.
  vec3 pc = p - PDIR * dot(p, PDIR) * 0.55;
  g.m = textureLod(uNoise, NROT2 * pc * 0.95 + g.n.gbr * 0.16, 0.0);
  sd -= (g.m.b - 0.5) * 0.15 + (g.m.a - 0.35) * 0.05;
  vec4 lump = textureLod(uNoise, NROT * p * 1.35 + 0.61, 0.0);
  sd -= (lump.r - 0.5) * 0.11;
  vec3 toCore = p - uCore;
  float rc = length(toCore);
  if (sd < 0.3) {
    // Fine crinkles, only where they can be seen.
    vec4 f = textureLod(uNoise, NROT * pc * 3.1 + 0.31, 0.0);
    sd -= (f.b - 0.5) * 0.045 + (f.a - 0.35) * 0.022;
  }
  g.sd = sd;
  g.dense = smoothstep(0.01, -0.028, sd);
  // Gas boiling off the surface streams away in striations; around the collapsing head it
  // turns and falls inwards instead.
  vec3 ps = p - PDIR * dot(p, PDIR) * 0.86;
  float streak = textureLod(uNoise, NROT * ps * 1.9 + 0.5, 0.0).a;
  float fall = uCollapse * exp(-rc * rc / 0.3);
  if (fall > 0.01) {
    vec3 dir = toCore / max(rc, 1e-3);
    float inward = textureLod(uNoise, dir * 0.9 + vec3(0.2, 0.7, 0.4) * (rc * 1.6 + uCollapse * 0.9), 0.0).a;
    streak = mix(streak, inward, fall);
  }
  float off = max(sd, 0.0);
  float halo = exp(-off / 0.09) * (0.12 + 1.9 * streak) + 0.3 * exp(-off / 0.34) * streak;
  // The cavity is not empty: slow billows of thin gas.
  float cavity = 0.02 + 0.5 * pow(g.n.b, 3.0) + 0.25 * g.m.r * g.n.b * g.n.b;
  g.thin = halo + cavity * 0.6;
  return g;
}

// Optical depth of dust between `p` and the cluster; `d1` is the distance field a short way
// towards the light (its change tells which way the surface faces).
float shadowDepth(vec3 p, float jit, out float d1) {
  float tau = 0.0;
  vec4 n;
  d1 = shape(p + LDIR * SH0, n);
  tau += smoothstep(0.03, -0.06, d1) * 0.04;
  // The further samples are wider apart and softer (the cluster is not a point), and a little
  // jitter turns what is left of their spacing into grain.
  float s = SH0 + 0.05 * (0.85 + 0.3 * jit), ds = 0.07;
  for (int k = 0; k < 5; k++) {
    float d = shape(p + LDIR * s, n);
    tau += smoothstep(0.45 * ds, -0.55 * ds, d) * ds;
    s += ds * (1.35 + 0.3 * jit);
    ds *= 1.9;
  }
  return tau;
}

// Core and diffraction spikes of a bright star at offset `d` (picture units) from the pixel.
float spikes(vec2 d, float px, float len) {
  d = rot2(0.42) * d;
  float r = length(d);
  float core = exp(-r * r / (2.2 * px * px));
  float halo = px * px / (r * r + 3.0 * px * px);
  vec2 a = abs(d);
  float sp = exp(-a.y / (1.1 * px)) * exp(-a.x / len) + exp(-a.x / (1.1 * px)) * exp(-a.y / len);
  return core + 0.12 * halo + 0.2 * sp;
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  float px = 1.0 / uRes.y;
  vec3 teal = vec3(0.08, 0.4, 0.5), rose = vec3(0.6, 0.1, 0.15), gold = vec3(1.0, 0.62, 0.3);

  // ---------------------------------------------------------------- behind the cloud
  // Distant glowing gas, brightest on the cluster's side of the sky, with dark lanes across it.
  vec3 sd3 = rd * vec3(1.2, 1.2, 0.5);
  vec4 b1 = noiseC1(sd3 * 0.5 + 0.21);
  vec4 b2 = textureLod(uNoise, sd3 * 1.9 + b1.rgb * 0.3, 0.0);
  float toStars = saturate(dot(rd, normalize(uSn - ro)) * 0.5 + 0.5);
  vec4 b3 = textureLod(uNoise, NROT * sd3 * 4.3 + b2.rgb * 0.2, 0.0);
  float glowAmt = pow(saturate(b1.r * 1.25), 2.4) * (0.3 + 0.9 * b2.b + 0.5 * b3.a * b2.r) * (0.07 + 2.0 * pow(toStars, 7.0));
  glowAmt *= smoothstep(0.25, 0.6, b1.b + 0.25 * b2.r) * (0.75 + 0.5 * b3.b);
  vec3 bg = mix(rose, teal * 1.3, smoothstep(0.3, 0.7, b1.g * 0.6 + 0.75 * pow(toStars, 9.0))) * glowAmt * 0.55;
  // Stars: the far ones redden and vanish behind the dust.
  vec2 sp = rd.xy / max(-rd.z, 0.25);
  float spx = 2.0 * uTanHalfFov * px;
  vec3 stars = starLayer(sp * 26.0, spx * 26.0, 0.55, 80.0, uGTime, 0.0) * 0.6
             + starLayer(sp * 61.0 + 7.0, spx * 61.0, 0.5, 81.0, uGTime, 0.0) * 0.4
             + starLayer(sp * 131.0 + 3.0, spx * 131.0, 0.5, 82.0, uGTime, 0.0) * 0.3
             + starLayer(sp * 257.0 + 5.0, spx * 257.0, 0.5, 84.0, uGTime, 0.0) * 0.22;
  bg += stars;

  // ---------------------------------------------------------------- the march
  float tA = max((1.9 - ro.z) / rd.z, 0.0), tB = (-2.4 - ro.z) / rd.z;
  float dith = hash12(gl_FragCoord.xy + uDither);
  float t = tA + dith * 0.07;
  vec3 T = vec3(1.0);
  vec3 col = vec3(0.0);
  float emberAcc = 0.0;
  float flashI = uSnT >= 0.0 ? 5.0 * exp(-uSnT * 1.5) + 0.25 : 0.0;
  float shockW = 0.03 + 0.012 * max(uSnT, 0.0);
  float shockA = uSnT >= 0.0 ? (0.5 + 1.2 * exp(-uSnT * 0.5)) * smoothstep(0.0, 0.25, uShock) : 0.0;
  // Dust scatters forwards: its thin edges glow when the light is behind them.
  float fwd = 1.0 + 2.2 * pow(saturate(dot(rd, LDIR)), 3.0);
  bool spent = true;
  for (int i = 0; i < 170; i++) {
    if (t > tB || max(T.r, T.g) < 0.006) { spent = false; break; }
    vec3 pos = ro + rd * t;
    Gas g = gasAt(pos);
    float dt = clamp(g.sd * 0.5, 0.006 + 0.003 * (t - tA), 0.11) * (0.85 + 0.3 * dith);
    float d1;
    float tau = shadowDepth(pos, fract(dith * 7.31 + float(i) * 0.618), d1);
    float lit = exp(-tau * K_SHADOW);
    // Which way the surface faces, from the change of the distance field towards the light.
    float facing = smoothstep(-0.25, 0.85, (d1 - g.sd0) / SH0);
    vec3 toSn = pos - uSn;
    float rs = length(toSn);
    float light = lit * (1.0 + flashI * exp(-rs * 0.45));
    // Ionised gas: oxygen's teal where the radiation is hard (thin gas near the stars),
    // hydrogen's rose further off, and white gold in the dense layer boiling off the dust.
    float hard = exp(-rs / 2.1) * (0.3 + 1.0 * g.n.g);
    vec3 gasCol = mix(rose * 1.2, teal * 1.5, saturate(hard * 1.2));
    float off = max(g.sd, 0.0);
    float frontGas = exp(-off / 0.016) * (1.0 - g.dense);
    vec3 em = gasCol * g.thin * light * 0.6 + mix(gold, vec3(1.0, 0.86, 0.7), 0.5) * frontGas * light * 2.2;
    // The dust itself: lit where it faces the stars, a faint brown where it does not.
    vec3 skin = mix(vec3(0.85, 0.4, 0.17), vec3(1.0, 0.66, 0.38), g.m.b) * light * facing * fwd * (0.4 + 1.2 * g.m.a);
    vec3 dark = vec3(0.026, 0.015, 0.012) * (0.3 + 1.6 * g.m.b);
    em += (skin * 0.22 + dark) * g.dense * K_DENSE;
    // The blast wave: a ragged shell that lags where the gas is thick. Its leading edge is
    // sharp and blue-white; the gas it has crossed glows on behind it, brightest along
    // filaments and in the layer boiling off the dust.
    if (shockA > 0.0) {
      float front = uShock * (1.0 + 0.16 * (g.n.b - 0.5) + 0.05 * (g.m.r - 0.5)) - 0.25 * g.dense;
      float x = rs - front;
      float edge = x > 0.0 ? exp(-x / (0.35 * shockW)) : exp(x / (1.2 * shockW));
      float wake = x > 0.0 ? 0.0 : exp(x / (0.5 + 0.25 * uShock)) * (1.0 - exp(x / 0.05));
      float fil = smoothstep(0.25, 0.9, g.m.a);
      vec3 hot = mix(vec3(0.55, 0.74, 1.0), vec3(1.0, 0.74, 0.5), saturate(g.dense * 2.0 + frontGas * 2.0));
      // Gas in the lee of the dust is sheltered from it, as it is from the light.
      float open = 0.12 + 0.88 * lit * facing;
      // Seen face on, the shell is a veil across the picture; seen along its surface, a bright
      // line. Keep the line.
      float limb = 1.0 - abs(dot(rd, toSn)) / max(rs, 1e-3);
      float along = 0.12 + 0.88 * limb * limb;
      em += hot * edge * ((0.04 + 1.3 * g.thin + 2.2 * fil) * along + (9.0 * frontGas + 20.0 * g.dense) * open) * shockA;
      // Step finely through the front: it is thinner than the march's stride.
      dt = min(dt, max(abs(x) * 0.5, 0.25 * shockW));
      em += (rose * 0.8 * g.thin * fil * open + gold * 3.2 * frontGas * open) * wake * shockA * 0.9;
    }
    // The ember inside the collapsing head (infrared: the dust hides little of it).
    if (uEmber > 0.0) {
      float rc = length(pos - uCore);
      emberAcc += uEmber * (exp(-rc * rc / 0.0012) * 30.0 + exp(-rc * rc / 0.012) * 4.0 + exp(-rc * rc / 0.07) * 0.5) * dt * pow(max(T.r, 0.0), 0.1);
    }
    float sigma = g.dense * K_DENSE + g.thin * K_THIN;
    col += T * em * dt;
    // Dust reddens what it lets through.
    T *= exp(-sigma * dt * vec3(0.8, 1.0, 1.3));
    t += dt;
  }
  // A ray that ran out of steps was creeping along the dust: nothing shows through.
  if (!spent) col += T * bg;
  col += vec3(1.0, 0.36, 0.1) * emberAcc;

  // The cluster: a handful of hot young stars in the cavity, far behind the dust.
  if (!spent) {
    for (int i = 0; i < 6; i++) {
      vec3 d = normalize(YOUNG[i].xyz);
      float z = dot(d, uCamFwd);
      if (z < 0.2) continue;
      vec2 q = vec2(dot(d, uCamRight), dot(d, uCamUp)) / (z * 2.0 * uTanHalfFov);
      col += T * mix(vec3(0.62, 0.78, 1.0), vec3(1.0, 0.86, 0.7), float(i == 4)) * YOUNG[i].w * spikes(p - q, px * 1.25, 0.016);
    }
  }

  // ---------------------------------------------------------------- in front of everything
  // A few near stars, and the giant that is about to die.
  vec3 fgStars = starLayer(sp * 9.0 + 31.0, spx * 9.0, 0.3, 83.0, uGTime, 0.0);
  col += fgStars * 0.6;
  float snB = uSnT < 0.0 ? 2.4 : 2.4 * exp(-uSnT * 3.0) + 40.0 * exp(-uSnT * 2.4) + 0.3 * exp(-uSnT * 0.35);
  float snLen = uSnT < 0.0 ? 0.03 : 0.03 + 0.07 * exp(-uSnT * 1.8);
  vec2 dS = p - uSnScreen;
  col += vec3(0.72, 0.84, 1.0) * snB * spikes(dS, px * 1.4, snLen);
  // The explosion itself: a fireball too bright to have an edge.
  if (uSnT >= 0.0) col += vec3(0.8, 0.88, 1.0) * 26.0 * exp(-uSnT * 3.4) * exp(-dot(dS, dS) / (0.0004 + 0.0016 * uSnT));
  fragColor = vec4(max(col, 0.0), 1.0);
}
