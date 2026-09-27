// Ray marching for signed-distance scenes, plus a sky and fog to light them with.
//
// The scene defines, anywhere in the shader (it is declared here):
//   float mapD(vec3 p);          signed distance to the whole scene (keep it cheap)
// and then calls:
//   march(ro, rd, tmin, tmax, pix)   distance to the first hit, or -1.0 past tmax (a ray that
//                                    runs out of steps counts as a hit). pix is the angular
//                                    size of a pixel (pixelAngle() in <camera>): the hit
//                                    tolerance grows with distance, like the pixel footprint.
//   calcNormal(p, eps)               surface normal (tetrahedron of four samples)
//   softShadow(p, dir, tmin, tmax, k)  0..1, with penumbrae (k: larger is sharper)
//   calcAO(p, n, scale)              0..1 ambient occlusion over `scale` world units
//   skyColor(rd, sun, zenith, horizon, sunCol)  a clear sky with a sun disc and its glow
//   applyFog(col, t, rd, sun, fogCol, sunCol, density)  distance fog, lit towards the sun
// Define MARCH_STEPS / SHADOW_STEPS before the include to change the loop counts, and
// MARCH_RELAX (< 1) to under-step bound (not exact) distances. The soft shadow, normal and
// AO techniques follow Inigo Quilez's articles (https://iquilezles.org/articles/, MIT License);
// see THIRD_PARTY_NOTICES.md.
#include <common>

float mapD(vec3 p);

#ifndef MARCH_STEPS
#define MARCH_STEPS 160
#endif
#ifndef SHADOW_STEPS
#define SHADOW_STEPS 48
#endif
#ifndef MARCH_RELAX
#define MARCH_RELAX 1.0
#endif

float march(vec3 ro, vec3 rd, float tmin, float tmax, float pix) {
  float t = tmin;
  for (int i = 0; i < MARCH_STEPS; i++) {
    float d = mapD(ro + rd * t);
    if (abs(d) < pix * t) return t;
    t += d * MARCH_RELAX;
    if (t > tmax) return -1.0;
  }
  // Out of steps before tmax: a ray creeping along a surface (terrain near the horizon).
  return t;
}

vec3 calcNormal(vec3 p, float eps) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * mapD(p + k.xyy * eps) + k.yyx * mapD(p + k.yyx * eps) +
                   k.yxy * mapD(p + k.yxy * eps) + k.xxx * mapD(p + k.xxx * eps));
}

// Penumbra from the closest miss along the ray: the narrowest angle h / t it passes by.
float softShadow(vec3 ro, vec3 rd, float tmin, float tmax, float k) {
  float res = 1.0, t = tmin;
  for (int i = 0; i < SHADOW_STEPS; i++) {
    float h = mapD(ro + rd * t);
    res = min(res, k * h / t);
    t += clamp(h, (tmax - tmin) / float(SHADOW_STEPS * 4), (tmax - tmin) / 6.0);
    if (res < 0.002 || t > tmax) break;
  }
  res = clamp(res, 0.0, 1.0);
  return res * res * (3.0 - 2.0 * res);
}

float calcAO(vec3 p, vec3 n, float scale) {
  float occ = 0.0, w = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = scale * (0.02 + 0.98 * float(i) / 4.0);
    occ += (h - mapD(p + n * h)) * w;
    w *= 0.7;
  }
  return clamp(1.0 - 1.5 * occ / scale, 0.0, 1.0);
}

vec3 skyColor(vec3 rd, vec3 sun, vec3 zenith, vec3 horizon, vec3 sunCol) {
  float y = max(rd.y, 0.0);
  vec3 col = mix(horizon, zenith, pow(y, 0.45));
  float mu = max(dot(rd, sun), 0.0);
  col += sunCol * (0.08 * pow(mu, 6.0) + 0.35 * pow(mu, 48.0) + 1.5 * pow(mu, 900.0));
  col += sunCol * 40.0 * smoothstep(0.99975, 0.99988, mu);
  return col;
}

vec3 applyFog(vec3 col, float t, vec3 rd, vec3 sun, vec3 fogCol, vec3 sunCol, float density) {
  float f = 1.0 - exp(-t * density);
  float s = pow(max(dot(rd, sun), 0.0), 6.0);
  return mix(col, fogCol + sunCol * s * 0.5, f);
}
