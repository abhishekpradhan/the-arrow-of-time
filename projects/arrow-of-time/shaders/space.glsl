// Shared by the 1957 space shots (shaders/ascent.glsl, shaders/orbit.glsl): the Earth seen from
// inside and above its atmosphere at night, from the real maps (assets/earth), lit by the Moon
// (and at dawn by the Sun) through the physically based atmosphere (engine <atmosphere>).
//
// Frames: the shots put the camera at the origin of a frame with the axes of the launch site
// (x east, y up, z south); uCamP is the camera relative to the Earth's centre in those axes, in
// kilometres, so everything planet-sized is traced from uCamP and everything small (the rocket,
// the satellite) relative to the camera itself, without float precision trouble.
#include <noise>
#include <color>
#include <atmosphere>

uniform vec3 uCamP;          // the camera relative to the Earth's centre (km)
uniform float uCamAlt;       // its altitude (km), exact
uniform mat3 uToMap;         // site axes -> the axes of the Earth maps
uniform sampler2D uAlbedo, uMasks, uRelief;
uniform vec3 uSunDir, uSunE;     // the Sun (below the horizon at night)
uniform vec3 uMoonDir, uMoonE;   // the Moon and its light
uniform vec3 uMoonLit;       // the direction sunlight falls on the Moon (its phase)
uniform float uMoonSize;     // the Moon's angular radius as drawn (radians)
uniform float uMoonBright;   // radiance of its sunlit highlands
uniform float uLights;       // city lights (1957: few)
uniform float uGlow;         // the night airglow

const float R_E = 6371.0;

// Seam-free equirectangular sampling (as in the Planet component).
vec4 sampleEq(sampler2D tex, vec3 q) {
  float lon = atan(q.x, q.z);
  float lat = asin(clamp(q.y, -1.0, 1.0));
  vec2 uv = vec2(lon / TAU + 0.5, 0.5 - lat / PI);
  float u2 = fract(uv.x + 0.5) - 0.5;
  vec2 dx = vec2(dFdx(uv.x), dFdx(uv.y)), dy = vec2(dFdy(uv.x), dFdy(uv.y));
  float dx2 = dFdx(u2), dy2 = dFdy(u2);
  if (abs(dx2) < abs(dx.x)) dx.x = dx2;
  if (abs(dy2) < abs(dy.x)) dy.x = dy2;
  return textureGrad(tex, uv, dx, dy);
}

// Distance along rd from the camera to the ground (the exact altitude keeps grazing rays clean).
float groundHit(vec3 rd, float r) {
  float b = dot(uCamP, rd);
  float c = (uCamAlt + R_E - r) * (uCamAlt + R_E + r);
  float h = b * b - c;
  if (h < 0.0 || b > 0.0 && c > 0.0) return -1.0;
  return -b - sqrt(h);
}

// Both crossings of the sphere of radius r (the camera may be inside it).
vec2 shellHit(vec3 rd, float r) {
  float b = dot(uCamP, rd);
  float c = (uCamAlt + R_E - r) * (uCamAlt + R_E + r);
  float h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

// Light of the Sun and the Moon arriving at P (planet-centred), coloured by the air it crossed.
vec3 lightAt(vec3 P, vec3 n, out vec3 moon) {
  moon = uMoonE * atmoLight(P, uMoonDir);
  return uSunE * atmoLight(P, uSunDir);
}

// The land and sea at night: moonlit, a moon glint on water, a few lights.
vec3 groundColor(vec3 P, vec3 rd) {
  vec3 n = normalize(P);
  vec3 q = normalize(uToMap * n);
  vec3 alb = sampleEq(uAlbedo, q).rgb;
  float land = sampleEq(uMasks, q).r;
  // The steppe's own texture below the maps' resolution.
  vec2 w = P.xz;
  alb *= 0.7 + 0.6 * fbm(w * 0.35, 4);
  alb = mix(vec3(0.012, 0.016, 0.02), alb, land);
  // By moonlight colours fade (the eye's night vision): the land goes grey, lit only by the Sun
  // it keeps them.
  float night = 1.0 - smoothstep(-0.1, 0.1, dot(n, uSunDir));
  alb = mix(alb, vec3(dot(alb, vec3(0.3, 0.5, 0.2))) * vec3(0.8, 0.9, 1.1), 0.9 * night);
  vec3 moon;
  vec3 sun = lightAt(P, n, moon);
  vec3 col = alb * (moon * max(dot(n, uMoonDir), 0.0) + sun * max(dot(n, uSunDir), 0.0));
  vec3 hm = normalize(uMoonDir - rd), hs = normalize(uSunDir - rd);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
  col += (1.0 - land) * (moon * pow(max(dot(n, hm), 0.0), 250.0) * 4.0 + sun * pow(max(dot(n, hs), 0.0), 400.0) * 3.0) * (0.3 + fres);
  float lights = pow(sampleEq(uRelief, q).g, 1.4) * land;
  col += vec3(1.0, 0.72, 0.4) * lights * uLights * (1.0 - smoothstep(-0.1, 0.1, dot(n, uSunDir)));
  return col;
}

// The Moon's disc: a sphere lit from uMoonLit, dark seas and bright highlands, a few rayed
// craters. Returns radiance (0 off the disc) and its coverage in cover; pix is a pixel's angle.
vec3 moonDisc(vec3 rd, float pix, out float cover) {
  float c = dot(rd, uMoonDir);
  float ang = acos(clamp(c, -1.0, 1.0));
  float px = 0.75 * pix;
  cover = 1.0 - smoothstep(uMoonSize - px, uMoonSize + px, ang);
  if (cover <= 0.0) return vec3(0.0);
  // Local disc coordinates.
  vec3 ax = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
  vec3 ay = cross(ax, uMoonDir);
  vec2 d = vec2(dot(rd, ax), dot(rd, ay)) / sin(uMoonSize);
  float z = sqrt(max(1.0 - dot(d, d), 0.0));
  vec3 n = normalize(d.x * ax + d.y * ay - z * uMoonDir);
  // Seas: large soft blobs, placed like the near side's.
  vec2 s = d;
  float mare = 0.0;
  mare += smoothstep(0.34, 0.1, length(s - vec2(-0.2, 0.36)));   // Imbrium
  mare += smoothstep(0.22, 0.05, length(s - vec2(0.2, 0.33)));   // Serenitatis
  mare += smoothstep(0.26, 0.06, length(s - vec2(0.32, 0.08)));  // Tranquillitatis
  mare += smoothstep(0.14, 0.03, length(s - vec2(0.66, 0.24)));  // Crisium
  mare += smoothstep(0.48, 0.18, length((s - vec2(-0.55, 0.05)) * vec2(1.0, 0.8)));  // Procellarum
  mare += smoothstep(0.2, 0.05, length(s - vec2(0.45, -0.15)));  // Fecunditatis
  mare += smoothstep(0.16, 0.04, length(s - vec2(0.22, -0.2)));  // Nectaris
  mare += smoothstep(0.22, 0.06, length(s - vec2(-0.2, -0.3)));  // Nubium
  mare = saturate(mare * (0.75 + 0.5 * fbm(s * 9.0, 3)));
  float alb = mix(0.36, 0.17, mare) * (0.85 + 0.3 * fbm(s * 24.0, 3));
  // Tycho's rays in the south.
  vec2 ty = s - vec2(-0.12, -0.72);
  alb += 0.12 * exp(-dot(ty, ty) * 60.0) + 0.05 * smoothstep(0.8, 1.0, sin(atan(ty.y, ty.x) * 13.0)) * exp(-length(ty) * 3.0);
  // Lommel-Seeliger shading: the full Moon is bright right to its edge.
  float mu0 = max(dot(n, uMoonLit), 0.0), mu = max(dot(n, -rd), 0.0);
  float lit = mu0 / (mu0 + mu + 1e-4) * 2.0 * smoothstep(0.0, 0.05, mu0);
  return vec3(1.0, 0.97, 0.92) * alb / 0.36 * lit * uMoonBright;
}

// The glow round the Moon: haze in the air and in the lens.
vec3 moonHalo(vec3 rd) {
  float ang = acos(clamp(dot(rd, uMoonDir), -1.0, 1.0));
  float x = max(ang - uMoonSize, 0.0) / uMoonSize;
  return vec3(0.75, 0.8, 0.9) * uMoonBright * (0.05 * exp(-x * 2.0) + 0.012 * exp(-x * 0.35));
}
