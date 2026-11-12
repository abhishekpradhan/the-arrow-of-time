// A spiral galaxy as a volume: emission and dust absorption integrated through a thin disk
// whose face-on structure comes from a baked map (<galaxy-map>), plus an analytic bulge,
// nucleus and halo. The disk lies in the xz plane with a radius of about 1, centred on the
// origin; rays are given in that frame.
//
// The dust is a thinner layer than the stars, so it darkens what lies behind it and not what
// lies in front: at an angle its lanes cut across the far half of the bulge and stand out on
// the near side of the disk, as in photographs of inclined spirals.
#include <common>

uniform sampler2D uGalMap;
uniform float uGalExtent; // half-width of the map, in disk radii
uniform float uGalTexel;  // one texel of the map, in disk radii
uniform float uGalSpin;   // rotation of the pattern (radians)
uniform float uGalBar;    // bar angle in the map
uniform float uGalDust;   // dust strength (1 = as baked)
uniform vec4 uGalGain;    // brightness of: old stars, young stars, H-II regions, bulge
uniform int uGalSteps;    // steps through the disk (about 40; fewer when motion blur averages several samples)

const vec3 GAL_REDDEN = vec3(0.68, 1.0, 1.42); // extinction per channel: dust reddens what it dims
const float GAL_SLAB = 0.1;                    // half-thickness marched
const float GAL_BOUND = 1.5;

// Line integral of the emissivity (1 + m^2 / a^2)^(-5/2) of a spheroid (m is the radius in a
// space scaled by inv, so the spheroid is a sphere there), split at the ray parameter tp:
// x = in front of it, y = behind. Normalised so that the whole integral through the centre
// along a unit-scaled axis is 1.
vec2 galSpheroid(vec3 ro, vec3 rd, vec3 inv, float a, float tp) {
  vec3 o = ro * inv, d = rd * inv;
  float L = length(d);
  d /= L;
  float b = dot(o, d);
  float A2 = a * a + max(dot(o, o) - b * b, 0.0);
  float s0 = b, s1 = tp * L + b;
  float f0 = s0 * (3.0 * A2 + 2.0 * s0 * s0) / pow(A2 + s0 * s0, 1.5);
  float f1 = s1 * (3.0 * A2 + 2.0 * s1 * s1) / pow(A2 + s1 * s1, 1.5);
  float k = a * a * a * a / (4.0 * A2 * A2 * L);
  return k * vec2(f1 - f0, 2.0 - f1);
}

// Radiance (rgb) and opacity (a = 1 - transmittance, for premultiplied compositing over the
// sky) along a ray. jitter in [0, 1) decorrelates the steps between pixels; pixAngle is the
// angle one pixel subtends.
vec4 galaxyTrace(vec3 ro, vec3 rd, float jitter, float pixAngle) {
  vec3 col = vec3(0.0);
  vec3 T = vec3(1.0);
  vec2 ts = raySphere(ro, rd, vec3(0.0), GAL_BOUND);
  float t0 = max(ts.x, 0.0), t1 = ts.y;
  bool level = abs(rd.y) < 1e-5;
  if (!level) {
    float ta = (GAL_SLAB - ro.y) / rd.y, tb = (-GAL_SLAB - ro.y) / rd.y;
    t0 = max(t0, min(ta, tb));
    t1 = min(t1, max(ta, tb));
  } else if (abs(ro.y) > GAL_SLAB) t1 = t0;

  if (t1 > t0) {
    mat2 toMap = rot2(-uGalSpin);
    float hxz = length(rd.xz);
    // Steps are spaced evenly in v, where y = SLAB * v * |v|: dense near the mid-plane, where
    // the dust and the young stars are.
    float ya = ro.y + rd.y * t0, yb = ro.y + rd.y * t1;
    float va = sign(ya) * sqrt(abs(ya) / GAL_SLAB), vb = sign(yb) * sqrt(abs(yb) / GAL_SLAB);
    float tPrev = t0;
    float n = float(uGalSteps);
    for (int i = 0; i < uGalSteps; i++) {
      float u1 = float(i + 1) / n, um = (float(i) + jitter) / n;
      float tNext, tm;
      if (level) {
        tNext = mix(t0, t1, u1);
        tm = mix(t0, t1, um);
      } else {
        float v1 = mix(va, vb, u1), vm = mix(va, vb, um);
        tNext = (GAL_SLAB * v1 * abs(v1) - ro.y) / rd.y;
        tm = (GAL_SLAB * vm * abs(vm) - ro.y) / rd.y;
      }
      float dt = max(tNext - tPrev, 0.0);
      tPrev = tNext;
      vec3 pos = ro + rd * tm;
      float rr = length(pos.xz);
      vec2 uv = (toMap * pos.xz) / (2.0 * uGalExtent) + 0.5;
      float foot = max(tm * pixAngle, 0.3 * dt * hxz);
      vec4 m = textureLod(uGalMap, uv, clamp(log2(foot / uGalTexel), 0.0, 8.0));
      float ay = abs(pos.y);
      float flare = 1.0 + 0.6 * rr;
      float hOld = (0.014 + 0.03 * exp(-rr / 0.13)) * flare, hYoung = 0.0065 * flare, hDust = 0.0042 * flare, hGas = 0.0024 * flare;
      float pO = exp(-ay / hOld) / (2.0 * hOld);
      float pY = exp(-ay / hYoung) / (2.0 * hYoung);
      float pD = exp(-ay / hDust) / (2.0 * hDust);
      float pG = exp(-ay / hGas) / (2.0 * hGas); // H-II regions hug the mid-plane, or they would stand up as pillars
      vec3 oldC = mix(vec3(1.0, 0.74, 0.45), vec3(0.96, 0.88, 0.8), smoothstep(0.08, 0.85, rr));
      vec3 emis = m.r * pO * oldC * uGalGain.x
                + m.g * pY * vec3(0.43, 0.64, 1.0) * uGalGain.y
                + m.a * pG * vec3(1.0, 0.2, 0.36) * uGalGain.z;
      vec3 seg = exp(-m.b * pD * uGalDust * dt * GAL_REDDEN);
      col += T * emis * dt * (0.5 + 0.5 * seg);
      T *= seg;
    }
  }

  // Bulge, nucleus and halo, in the bar's frame (the bulge is a little elongated along it).
  // What lies beyond the mid-plane is seen through the whole dust layer.
  float tp = level ? -1.0 : -ro.y / rd.y;
  if (tp < 0.0) tp = 1e4;
  mat2 toBar = rot2(-(uGalBar + uGalSpin));
  vec3 o = vec3(toBar * ro.xz, ro.y), d = vec3(toBar * rd.xz, rd.y);
  vec2 nuc = galSpheroid(o, d, vec3(1.0, 1.0, 1.0 / 0.8), 0.016, tp);
  vec2 bul = galSpheroid(o, d, vec3(1.0 / 1.3, 1.0, 1.0 / 0.7), 0.075, tp);
  vec2 hal = galSpheroid(o, d, vec3(1.0, 1.0, 1.0 / 0.8), 0.55, tp);
  vec3 sph = vec3(1.0, 0.86, 0.64) * 1.5 * (nuc.x + nuc.y * T)
           + vec3(1.0, 0.72, 0.42) * 1.3 * (bul.x + bul.y * T)
           + vec3(0.8, 0.84, 1.0) * 0.012 * (hal.x + hal.y * T);
  col += sph * uGalGain.w;
  return vec4(col, 1.0 - dot(T, vec3(1.0 / 3.0)));
}
