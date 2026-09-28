// A planet's atmosphere: light from a sun (and a moon) scattered by air molecules (Rayleigh) and
// haze (Mie), absorbed by ozone and cut off by the planet's shadow, integrated along each view
// ray; and the colour of that light where it falls on a surface. Single scattering, with the
// transmittance through the atmosphere baked once into a small table, following the
// parameterization of Bruneton & Neyret, "Precomputed Atmospheric Scattering" (2008); this
// implementation is original. The Atmosphere component (engine/components/atmosphere.ts) bakes
// the table and supplies every uniform declared here through its uniforms(c).
//
// Kilometres, and positions relative to the planet's centre. A light is a direction `l` and an
// irradiance `e` in the engine's convention (a white surface facing it shines with radiance e).
//
//   vec3 atmoLight(p, l)       transmittance of the light reaching p from direction l: reddened
//                              near the horizon, zero in the planet's shadow (soft across the
//                              disc of the sun)
//   vec3 atmoSegment(ro, rd, t0, t1, l0, e0, l1, e1, trans)
//                              light scattered towards ro along ro + rd t, t0 <= t < t1, from two
//                              lights (pass e1 = 0 for one); multiplies `trans` by the segment's
//                              transmittance, so a segment in front of a cloud and the one behind
//                              it can be composited in order
//   float atmoGlow(ro, rd, tMax)  column of the night airglow layer along the ray (about 95 km
//                              up; seen edge-on from orbit it is a thin line over the limb)
// Define ATMO_STEPS before the include to change the number of samples per segment.
#include <common>

uniform sampler2D uAtmoLUT;     // transmittance to space, baked by the Atmosphere component
uniform float uAtmoR;           // planet radius
uniform float uAtmoTop;         // radius of the top of the atmosphere
uniform vec3 uAtmoRay;          // Rayleigh scattering at the ground (per km)
uniform float uAtmoRayH;        // and its scale height
uniform float uAtmoMie;         // Mie scattering at the ground (per km)
uniform float uAtmoMieExt;      // Mie extinction over scattering
uniform float uAtmoMieH;
uniform float uAtmoMieG;        // Mie asymmetry (forward scattering)
uniform vec3 uAtmoOzone;        // ozone absorption at the layer's peak (per km)
uniform vec2 uAtmoOzoneLayer;   // the layer's centre altitude and half width
uniform float uAtmoSunSize;     // angular radius of the light's disc (radians)
uniform vec2 uAtmoLutSize;

#ifndef ATMO_STEPS
#define ATMO_STEPS 24
#endif

vec3 atmoExtinction(float h) {
  float o = max(0.0, 1.0 - abs(h - uAtmoOzoneLayer.x) / uAtmoOzoneLayer.y);
  return uAtmoRay * exp(-h / uAtmoRayH) + vec3(uAtmoMie * uAtmoMieExt * exp(-h / uAtmoMieH)) + uAtmoOzone * o;
}

// Table coordinates of the ray leaving radius r at cosine mu to the zenith (a ray that reaches
// space): u from the distance to the top of the atmosphere, v from the altitude.
vec2 atmoLutUv(float r, float mu) {
  float H = sqrt(uAtmoTop * uAtmoTop - uAtmoR * uAtmoR);
  float rho = sqrt(max(r * r - uAtmoR * uAtmoR, 0.0));
  float d = max(-r * mu + sqrt(max(r * r * (mu * mu - 1.0) + uAtmoTop * uAtmoTop, 0.0)), 0.0);
  float dMin = uAtmoTop - r, dMax = rho + H;
  vec2 uv = saturate(vec2((d - dMin) / max(dMax - dMin, 1e-5), rho / H));
  // Texel centres: the table's first and last texels hold the ends of the range.
  return (uv * (uAtmoLutSize - 1.0) + 0.5) / uAtmoLutSize;
}

vec3 atmoLight(vec3 p, vec3 l) {
  float r = length(p);
  float mu = dot(p, l) / r;
  if (r > uAtmoTop) {
    // Above the atmosphere: the light crosses it only if its ray dips into the shell.
    float b = dot(p, l);
    float c = r * r - uAtmoTop * uAtmoTop;
    float disc = b * b - c;
    if (b > 0.0 || disc <= 0.0) return vec3(1.0);
    p += l * (-b - sqrt(disc));
    r = uAtmoTop;
    mu = dot(p, l) / r;
  }
  // The planet hides the light below the horizon; the edge is softened across the light's disc
  // (d mu = sin(zenith angle) d angle).
  float sinH = min(uAtmoR / r, 1.0);
  float muH = -sqrt(max(1.0 - sinH * sinH, 0.0));
  float vis = smoothstep(muH - uAtmoSunSize * sinH, muH + uAtmoSunSize * sinH, mu);
  return texture(uAtmoLUT, atmoLutUv(r, max(mu, muH))).rgb * vis;
}

float atmoPhaseRayleigh(float nu) { return 3.0 / (16.0 * PI) * (1.0 + nu * nu); }
float atmoPhaseMie(float nu) {
  float g = uAtmoMieG;
  float k = 1.0 + g * g - 2.0 * g * nu;
  return (1.0 - g * g) / (4.0 * PI * k * sqrt(k));
}

vec3 atmoSegment(vec3 ro, vec3 rd, float t0, float t1, vec3 l0, vec3 e0, vec3 l1, vec3 e1, inout vec3 trans) {
  vec2 shell = raySphere(ro, rd, vec3(0.0), uAtmoTop);
  t0 = max(t0, shell.x);
  t1 = min(t1, shell.y);
  if (shell.y < 0.0 || t1 <= t0) return vec3(0.0);
  float nu0 = dot(rd, l0), nu1 = dot(rd, l1);
  vec3 kr = PI * (e0 * atmoPhaseRayleigh(nu0)), km = PI * (e0 * atmoPhaseMie(nu0));
  vec3 kr1 = PI * (e1 * atmoPhaseRayleigh(nu1)), km1 = PI * (e1 * atmoPhaseMie(nu1));
  bool two = dot(e1, e1) > 0.0;
  // Samples crowd towards the ray's closest approach to the planet, where the air is densest:
  // a share of them on each side of it, in proportion to the lengths.
  float tc = clamp(-dot(ro, rd), t0, t1);
  float la = tc - t0, lb = t1 - tc;
  float na = floor(float(ATMO_STEPS) * la / max(la + lb, 1e-6) + 0.5);
  float nb = float(ATMO_STEPS) - na;
  const float P = 1.7;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ATMO_STEPS; i++) {
    float fi = float(i);
    float t, dt;
    if (fi < na) {
      float u = (fi + 0.5) / na;
      t = tc - la * pow(1.0 - u, P);
      dt = la * P * pow(1.0 - u, P - 1.0) / na;
    } else {
      float u = (fi - na + 0.5) / nb;
      t = tc + lb * pow(u, P);
      dt = lb * P * pow(u, P - 1.0) / nb;
    }
    vec3 p = ro + rd * t;
    float h = length(p) - uAtmoR;
    float dr = exp(-h / uAtmoRayH), dm = exp(-h / uAtmoMieH);
    vec3 ext = atmoExtinction(h);
    vec3 s = (uAtmoRay * dr * kr + uAtmoMie * dm * km) * atmoLight(p, l0);
    if (two) s += (uAtmoRay * dr * kr1 + uAtmoMie * dm * km1) * atmoLight(p, l1);
    vec3 stepT = exp(-ext * dt);
    // The step's in-scattering integrated exactly for constant density (energy conserving).
    sum += trans * (s - s * stepT) / max(ext, vec3(1e-7));
    trans *= stepT;
  }
  return sum;
}

// Length of ray [0, tMax) inside the spherical shell between radii a < b.
float atmoShellPath(vec3 ro, vec3 rd, float tMax, float a, float b) {
  vec2 o = raySphere(ro, rd, vec3(0.0), b);
  if (o.y <= 0.0) return 0.0;
  float len = max(min(o.y, tMax) - max(o.x, 0.0), 0.0);
  vec2 i = raySphere(ro, rd, vec3(0.0), a);
  if (i.y > 0.0) len -= max(min(i.y, tMax) - max(i.x, 0.0), 0.0);
  return max(len, 0.0);
}

float atmoGlow(vec3 ro, vec3 rd, float tMax) {
  float r = uAtmoR + 95.0;
  // Three nested shells: a soft-edged layer about ten kilometres deep.
  return (atmoShellPath(ro, rd, tMax, r - 2.0, r + 2.0) * 0.5 + atmoShellPath(ro, rd, tMax, r - 5.0, r + 5.0) * 0.3 +
          atmoShellPath(ro, rd, tMax, r - 9.0, r + 7.0) * 0.2) / 100.0;
}
