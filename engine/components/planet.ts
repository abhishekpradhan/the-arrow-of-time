// A general planet renderer: molten crust, oceans, ice lines, real present-day Earth geography
// (assets/earth), city lights, clouds, atmosphere and twilight, impact scars, Mars and terraforming,
// the Moon. One full-screen shader per planet; composite several with depth or draw order.
import type { Camera } from '../core/camera';
import type { Engine } from '../core/engine';
import { m4, type Mat4, type Vec3 } from '../core/math';
import type { ShotContext } from '../core/types';
import type { Program, Texture } from '../gl/gl';

const PLANET = `
#include <noise>
#include <color>
#include <camera>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime;
uniform vec3 uCenter; uniform float uRadius;
uniform mat4 uRotInv;            // world -> planet-local
uniform vec3 uSunDir, uSunColor;
uniform float uSeed;
// Surface state (all 0..1 blends)
uniform float uLava, uCrust, uOcean, uIce, uEarth, uDesert, uCity, uMars, uTerraform, uMoon, uVeg;
uniform float uClouds, uCloudT, uStorm, uAtmo, uHaze, uSeaLevel, uRetreat, uGlint, uNightGlow;
uniform float uReliefAmt, uAtmoHeight, uCloudZones;
uniform vec3 uAtmoColor, uHazeColor, uOceanColor;
uniform vec4 uImpacts[8];        // xyz = local direction, w = age in seconds (<0 = inactive)
uniform vec3 uDustDir;           // local direction of a spreading dust/soot cloud (asteroid impact)
uniform float uDustR, uDust;     // angular radius (radians) and strength
uniform float uBloom;            // cyanobacteria blooms in shallow seas
uniform vec4 uShock;             // xyz = local direction of a blast, w = its radius (radians)
uniform float uShockAmt;
uniform sampler2D uAlbedo, uMasks, uClimate, uRelief;
uniform float uHasEarth;
uniform float uDepthWrite;
uniform float uOpacity;

// Seam-free equirectangular sampling (Tarini): pick derivatives from the continuous longitude.
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

float procHeight(vec3 q) {
  vec3 s = q * 1.6 + uSeed;
  float h = gfbm(s + 0.5 * vec3(gnoise(s * 1.3), gnoise(s * 1.3 + 7.1), gnoise(s * 1.3 + 3.3)), 6);
  return h;
}

// Two unit tangents at q (east and north, any consistent pair away from the poles).
void tangents(vec3 q, out vec3 t1, out vec3 t2) {
  t1 = normalize(cross(abs(q.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), q));
  t2 = cross(q, t1);
}

// ---------------------------------------------------------------- the air
// A thin shell of scattering air, in closed form. uAtmoColor * uAtmo is its optical depth per
// unit air mass in red, green and blue: whatever it scatters most colours the sky by day, and
// is what the low Sun loses, so blue air gives orange terminators and dusty air blue ones.
const float AIR_GRAZE = 24.0;    // air masses along a ray that grazes the surface, space to space
vec3 airBeta() { return uAtmoColor * 0.22 * uAtmo; }
float airMass(float mu) { return 1.0 / (max(mu, 0.0) + 2.0 / AIR_GRAZE); }
// Sunlight left at the bottom of the air where the Sun stands at cosine ndl.
vec3 sunThrough(float ndl, float depth) { return exp(-airBeta() * airMass(ndl) * depth); }
// Light scattered towards the eye by a column of optical depth tau, where the Sun stands at ndl:
// the high air stays lit a little past the terminator (twilight), reddened by its long path.
vec3 airGlow(vec3 tau, float ndl) {
  vec3 sunAir = sunThrough(ndl, 0.55) * smoothstep(-0.22, 0.06, ndl);
  return uSunColor * 0.42 * (1.0 - exp(-tau)) * sunAir;
}

// ---------------------------------------------------------------- clouds
// Weather systems: the point is turned about nearby storm centres by an angle that falls off
// with distance, so the cloud noise read there is wound into spiral bands and comma-shaped
// fronts, the way wind shear draws out real cyclones.
vec3 stormWarp(vec3 p) {
  vec3 o = p;
  for (int i = 0; i < 12; i++) {
    vec3 h = hash31(float(i) * 7.31 + uSeed * 3.7 + 1.0);
    float sgn = (i % 2 == 0) ? 1.0 : -1.0;
    // Storm tracks follow the mid-latitudes of each hemisphere.
    float lat = (0.48 + 0.5 * h.y) * sgn;
    float lon = TAU * h.x;
    vec3 c = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
    float r = 0.15 + 0.2 * h.z;
    float d = distance(p, c) / r;
    if (d > 2.4) continue;
    // (Wound no tighter at the eye than the noise can show, or it rings.)
    float a = sgn * 2.6 * exp(-0.8 * d * d) / (0.62 + d);
    o = rotAxis(c, a) * o;
  }
  return o;
}

// Cloud amount at a point of the cloud layer (unit sphere): x = opacity, y = thickness.
vec2 cloudAt(vec3 cq, int oct) {
  vec3 s = stormWarp(cq);
  vec3 w = vec3(gnoise(s * 2.1 + 11.0), gnoise(s * 2.1 + 17.0), gnoise(s * 2.1 + 23.0));
  float n = fbm(s * 4.3 + 0.85 * w + uSeed, oct);
  // Climate zones: a cloudy belt on the equator, clear subtropics, storm tracks beyond.
  float lat = asin(clamp(cq.y, -1.0, 1.0));
  float al = abs(lat);
  n += uCloudZones * (0.07 * exp(-pow(lat / 0.13, 2.0)) - 0.075 * exp(-pow((al - 0.42) / 0.17, 2.0)) + 0.06 * exp(-pow((al - 0.95) / 0.3, 2.0)));
  float thr = 1.0 - uClouds * 0.85;
  // Fine structure eats into the edges so banks break up into cells and wisps.
  float fine = fbm(s * 21.0 + w * 2.0 + 3.0, 4);
  float m = n - 0.15 * (1.0 - fine) * smoothstep(thr + 0.34, thr - 0.05, n);
  float dense = smoothstep(thr, thr + 0.16, m);
  // High, thin cloud drawn out along the wind.
  float streak = fbm(vec3(s.x * 9.0, s.y * 17.0, s.z * 9.0) + w * 0.8 + uSeed, 4);
  float veil = smoothstep(thr - 0.1, thr + 0.08, n) * smoothstep(0.45, 0.8, streak) * 0.2;
  return vec2(max(dense, veil), smoothstep(thr, thr + 0.34, m));
}

vec3 surface(vec3 q, float h, float daylight, out float spec, out vec3 emit, out float landOut) {
  emit = vec3(0.0);
  spec = 0.0;
  // ---------------- procedural rock / young Earth
  vec3 rock = mix(vec3(0.05, 0.045, 0.04), vec3(0.18, 0.15, 0.12), smoothstep(-0.3, 0.5, h));
  rock *= 0.8 + 0.4 * fbm(q * 14.0 + uSeed, 4);
  vec3 col = rock;
  // ---------------- molten world: a magma ocean under a broken, drifting crust
  if (uLava > 0.0) {
    vec3 w1 = vec3(gnoise(q * 2.1 + uSeed), gnoise(q * 2.1 + uSeed + 5.0), gnoise(q * 2.1 + uSeed + 9.0));
    // Rifts follow the zero lines of two smooth noise fields: they meander, branch and cross
    // like real fractures, and gape into pools wherever a field is nearly flat. (Cell patterns
    // give a net of straight-edged polygons, which reads as a football.)
    float f1 = gfbm(q * 2.3 + uSeed + 0.45 * w1, 5);
    float f2 = gfbm(q * 2.3 + uSeed + 19.0 + 0.45 * w1.zxy, 5);
    vec3 w2 = vec3(gnoise(q * 8.0 + 3.0), gnoise(q * 8.0 + 7.0), gnoise(q * 8.0 + 13.0));
    // Fine cooling joints inside the plates: a small, strongly warped cell pattern, faint.
    vec2 wb = worley(q * 9.1 + uSeed * 1.7 + 1.1 * w1 + 0.45 * w2);
    float e1 = min(abs(f1), abs(f2) * 1.25), e2 = wb.y - wb.x;
    // Where the crust is pulled apart the rifts gape; elsewhere they are welded hairlines or
    // closed altogether.
    float tension = fbm(q * 2.4 + uSeed + 7.0, 4);
    float open = smoothstep(0.34, 0.66, tension);
    float thin = 1.45 - 0.95 * uCrust;
    float rift = 1.0 - smoothstep(0.0, mix(0.006, 0.075, open * open) * thin, e1);
    float vein = (1.0 - smoothstep(0.0, mix(0.002, 0.03, open) * thin, e2)) * smoothstep(0.35, 0.65, tension) * 0.6;
    // Basins where no crust has formed yet: open magma, slowly churning.
    float sea = smoothstep(-0.1, -0.36, h + (uCrust - 0.5) * 0.42);
    float churn = fbm(q * 10.0 + 1.6 * w1 + vec3(0.0, uGTime * 0.04, 0.0), 4);
    float skin = smoothstep(0.35, 0.7, fbm(q * 26.0 + w2 + uSeed, 3));
    float seaHeat = sea * (0.42 + 0.75 * churn) * (1.0 - 0.45 * skin);
    float flick = 0.75 + 0.5 * fbm(q * 9.0 + uGTime * 0.05, 3);
    float heat = saturate(max(max(rift, vein * 0.55), seaHeat) * flick);
    // Heat soaks into the plates beside the rifts, and hot spots glow through thin crust.
    float nearRift = exp(-e1 / (0.03 + 0.09 * open)) * (0.2 + 0.8 * open);
    float spot = smoothstep(0.62, 0.9, fbm(q * 5.5 + uSeed + 31.0, 4)) * (1.0 - uCrust * 0.6);
    vec3 crust = mix(vec3(0.02, 0.016, 0.014), vec3(0.09, 0.066, 0.052), fbm(q * 22.0 + uSeed, 4));
    crust *= 0.7 + 0.6 * smoothstep(0.0, 0.25, e2);
    col = mix(col, crust, uLava);
    vec3 glow = fireRamp(0.14 + 0.64 * heat) * heat * heat * 1.2;
    glow += vec3(0.55, 0.085, 0.02) * (nearRift * nearRift * 0.4 + spot * 0.5) * (1.0 - heat);
    emit += glow * uLava;
  }
  // ---------------- real present-day Earth from Natural Earth textures
  float land = 1.0;
  float depth = 0.0;
  if (uHasEarth > 0.5 && uEarth > 0.0) {
    vec4 m = sampleEq(uMasks, q);
    vec3 alb = sampleEq(uAlbedo, q).rgb;
    vec4 cl = sampleEq(uClimate, q);
    land = m.r;
    depth = m.g;
    // Future Earth: vegetation dies back to desert, seas retreat into the deepest basins.
    vec3 desert = mix(vec3(0.62, 0.42, 0.25), vec3(0.45, 0.28, 0.17), cl.b + 0.3 * fbm(q * 30.0, 3));
    alb = mix(alb, desert, uDesert * (1.0 - m.b));
    float seaLeft = uRetreat > 0.001 ? smoothstep(uRetreat, uRetreat + 0.03, depth) : 1.0;
    float isLand = max(land, (1.0 - land) * (1.0 - seaLeft));
    // Exposed old sea floor: pale salt flats.
    vec3 seabed = mix(vec3(0.75, 0.7, 0.62), vec3(0.4, 0.33, 0.27), smoothstep(0.0, 0.5, depth));
    alb = mix(seabed, alb, land);
    // Fine variation the maps are too coarse to carry.
    alb *= 0.88 + 0.24 * fbm(q * 60.0, 4);
    col = mix(col, alb, uEarth);
    land = mix(1.0, isLand, uEarth);
    emit += vec3(1.0, 0.72, 0.38) * pow(sampleEq(uRelief, q).g, 1.4) * 3.2 * uCity * (1.0 - daylight) * land;
  } else if (uOcean > 0.0) {
    land = smoothstep(uSeaLevel - 0.02, uSeaLevel + 0.02, h);
    depth = saturate((uSeaLevel - h) * 2.0);
  }
  // ---------------- Mars (and terraformed Mars)
  if (uMars > 0.0) {
    float mh = h + 0.35 * smoothstep(0.2, -0.6, q.y);             // northern lowlands
    vec3 dust = mix(vec3(0.55, 0.24, 0.12), vec3(0.72, 0.38, 0.2), fbm(q * 6.0 + 3.0, 5));
    dust = mix(dust, vec3(0.22, 0.12, 0.08), smoothstep(0.25, 0.6, fbm(q * 3.0 + 9.0, 4)) * 0.8);
    dust *= 0.85 + 0.3 * fbm(q * 40.0 + 5.0, 4);
    // Polar caps of water and dry ice.
    float cap = smoothstep(0.9, 0.95, abs(q.y) + 0.03 * gfbm(q * 9.0, 3));
    dust = mix(dust, vec3(0.86, 0.84, 0.82), cap);
    col = mix(col, dust, uMars);
    float mland = smoothstep(-0.02, 0.02, mh + 0.25 - uTerraform * 0.45);
    land = mix(land, mland, uMars * uTerraform);
    depth = mix(depth, saturate((0.45 * uTerraform - 0.25 - mh) * 2.0), uMars * uTerraform);
    vec3 green = mix(vec3(0.12, 0.2, 0.08), vec3(0.3, 0.3, 0.14), fbm(q * 8.0, 4));
    col = mix(col, green, uMars * uTerraform * uVeg * smoothstep(0.5, 0.0, abs(q.y)) * 0.8);
  }
  // ---------------- the Moon
  if (uMoon > 0.0) {
    vec2 c1 = worley(q * 7.0 + uSeed), c2 = worley(q * 19.0 + uSeed);
    float craters = smoothstep(0.35, 0.1, c1.x) * 0.25 + smoothstep(0.3, 0.12, c2.x) * 0.15;
    float maria = smoothstep(0.45, 0.6, fbm(q * 2.2 + 5.0, 5));
    vec3 moon = mix(vec3(0.42, 0.41, 0.4), vec3(0.2, 0.2, 0.21), maria) * (0.85 + craters);
    col = mix(col, moon, uMoon);
  }
  // ---------------- oceans
  float water = (1.0 - land) * max(uOcean, uEarth);
  if (water > 0.0) {
    vec3 deep = uOceanColor * 0.32;
    vec3 shallow = uOceanColor * vec3(0.9, 1.5, 1.4) + vec3(0.0, 0.012, 0.012);
    vec3 ocean = mix(shallow, deep, smoothstep(0.0, 0.3, depth));
    col = mix(col, ocean, water);
    spec = water;
  }
  // ---------------- microbial blooms colour the shallow seas green
  if (uBloom > 0.0) {
    float bl = smoothstep(0.45, 0.75, fbm(q * 7.0 + 2.0, 5)) * (1.0 - land) * smoothstep(0.35, 0.0, depth);
    col = mix(col, vec3(0.06, 0.22, 0.12), bl * uBloom);
  }
  // ---------------- ice (caps grow towards the equator as uIce -> 1)
  if (uIce > 0.0) {
    float lat = abs(q.y);
    float edge = 1.0 - uIce * 1.12;
    // Near the end the last open water breaks into leads and polynyas instead of closing
    // along one clean line, and fresh ice at the front is thin and grey.
    float breakup = smoothstep(0.3, 0.0, edge);
    float n = 0.08 * (fbm(q * 6.0, 4) - 0.5) + breakup * 0.14 * (fbm(q * 15.0 + 3.0, 3) - 0.5);
    float ice = smoothstep(edge - 0.04, edge + 0.04, lat + n);
    float age = smoothstep(0.0, 0.14, lat + n - edge);
    // Old ice: wind-packed snow over blue glacier ice, in long drifts; young ice is thin and grey.
    float drift = fbm(q * 9.0 + vec3(gnoise(q * 3.0), 0.0, gnoise(q * 3.0 + 5.0)) * 0.8, 5);
    vec3 old = mix(vec3(0.5, 0.63, 0.74), vec3(0.86, 0.9, 0.95), smoothstep(0.3, 0.7, drift));
    old = mix(old, vec3(0.74, 0.79, 0.84), land * 0.5);          // buried continents show through, greyer
    vec3 iceC = mix(vec3(0.36, 0.47, 0.56), old, age);
    // Fracture lines: long curving leads where the pack pulls apart (the zero lines of a
    // smooth field, as on Europa), healed over with thin dark ice.
    float lf = gfbm(q * 3.3 + uSeed + 0.5 * vec3(gnoise(q * 2.0), gnoise(q * 2.0 + 3.0), gnoise(q * 2.0 + 6.0)), 5);
    float lf2 = gfbm(q * 6.1 + uSeed + 41.0, 4);
    float lead = (1.0 - smoothstep(0.0, 0.016, abs(lf))) * smoothstep(0.4, 0.62, fbm(q * 2.6 + 13.0, 3));
    lead = max(lead, (1.0 - smoothstep(0.0, 0.012, abs(lf2))) * 0.5 * smoothstep(0.5, 0.7, fbm(q * 4.0 + 29.0, 3)));
    iceC = mix(iceC, vec3(0.22, 0.34, 0.45), lead * 0.6 * age);
    col = mix(col, iceC, ice);
    spec = mix(spec, 0.35, ice);
  }
  // ---------------- impacts (molten Earth bombardment)
  for (int i = 0; i < 8; i++) {
    vec4 im = uImpacts[i];
    if (im.w < 0.0) continue;
    float sc = max(length(im.xyz), 1e-3);   // scar scale: 1 = crater
    float d = acos(clamp(dot(q, im.xyz / sc), -1.0, 1.0));
    float age = im.w;
    float slow = inversesqrt(sc);
    float ring = exp(-pow((d - age * 0.05 * sc) / (0.012 * sc), 2.0)) * exp(-age * 1.2 * slow);
    float core = exp(-d * d / (0.0015 * sc * sc)) * exp(-age * 0.6 * slow);
    // Big impacts: the heated region churns (convective magma).
    float churn = sc > 1.5 ? 0.55 + 0.9 * fbm(q * 14.0 + vec3(0.0, uGTime * 0.3, 0.0), 3) : 1.0;
    emit += fireRamp(0.85) * (core * 2.5 * churn + ring * 1.5);
  }
  // ---------------- impact winter: soot and dust spreading from the impact site
  if (uDust > 0.0) {
    float ang = acos(clamp(dot(q, normalize(uDustDir)), -1.0, 1.0));
    float edge = uDustR * (0.85 + 0.3 * fbm(q * 5.0, 4));
    float cover = smoothstep(edge, edge * 0.6, ang) * uDust;
    col = mix(col, vec3(0.09, 0.075, 0.065), cover);
    spec *= 1.0 - cover;
    float fires = smoothstep(0.7, 0.85, fbm(q * 25.0, 3)) * smoothstep(edge * 0.7, edge * 0.1, ang) * uDust;
    emit += fireRamp(0.5) * fires * 0.35;
  }
  landOut = land;
  return col;
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  vec3 sun = normalize(uSunDir);
  vec3 oc = ro - uCenter;
  float b = dot(oc, rd);
  float c2 = dot(oc, oc) - uRadius * uRadius;
  float hdisc = b * b - c2;
  // Closest approach of the ray to the planet centre (for the atmosphere halo and AA).
  float tc = max(-b, 0.0);
  float dmin = length(oc + rd * tc);
  float pixelWorld = 2.0 * uTanHalfFov / uRes.y * max(tc, 1e-4);
  float cover = saturate((uRadius - dmin) / pixelWorld + 0.5);
  vec3 beta = airBeta();

  vec3 col = vec3(0.0);
  float alpha = 0.0;
  if (hdisc > 0.0 || cover > 0.0) {
    // Front-surface hit; rays that only graze (anti-aliased fringe) use the closest approach.
    float t = hdisc > 0.0 ? -b - sqrt(hdisc) : tc;
    vec3 pos = ro + rd * t;
    vec3 n = normalize(pos - uCenter);
    mat3 toLocal = mat3(uRotInv);
    vec3 q = normalize(toLocal * n);
    vec3 sunL = normalize(toLocal * sun);
    vec3 viewL = normalize(toLocal * -rd);
    float ndl = dot(n, sun);
    float mu = max(dot(n, -rd), 0.0);
    float daylight = smoothstep(-0.12, 0.25, ndl);
    float spec, land;
    vec3 emit;
    float h = procHeight(q);
    vec3 alb = surface(q, h, daylight, spec, emit, land);

    // Relief: the surface normal leans with the terrain, so mountains and crater rims catch
    // the light and throw shade where the Sun is low.
    vec3 nb = q;
    if (uReliefAmt > 0.0 && land > 0.01) {
      vec3 t1, t2;
      tangents(q, t1, t2);
      vec2 g;
      float k;
      if (uHasEarth > 0.5 && uEarth > 0.5) {
        const float e = 0.0035;
        float r0 = sampleEq(uRelief, q).r;
        g = vec2(sampleEq(uRelief, normalize(q + t1 * e)).r - r0, sampleEq(uRelief, normalize(q + t2 * e)).r - r0) / e;
        k = 0.012;
      } else {
        const float e = 0.012;
        g = vec2(procHeight(normalize(q + t1 * e)) - h, procHeight(normalize(q + t2 * e)) - h) / e;
        k = 0.05;
      }
      nb = normalize(q - (t1 * g.x + t2 * g.y) * k * uReliefAmt * land * (1.0 - uIce * 0.5));
    }
    float ndlB = mix(ndl, dot(nb, sunL), smoothstep(-0.05, 0.1, ndl));

    // Sunlight at the surface: dimmed and reddened by the long slant through the air when low,
    // plus the blue of the sky itself filling the shade.
    vec3 sunHere = uSunColor * sunThrough(ndl, 1.0);
    vec3 skyFill = uSunColor * (1.0 - exp(-beta * 3.0)) * 0.16 * smoothstep(-0.1, 0.3, ndl);
    vec3 lit = alb * (sunHere * max(ndlB, 0.0) + skyFill);
    // Sun glint: a wide sheen off wind-roughened water (and a duller one off ice), brightest
    // at grazing angles where the Fresnel reflection climbs.
    if (spec > 0.0 && ndl > 0.0) {
      vec3 hv = normalize(sunL + viewL);
      float ndh = max(dot(q, hv), 1e-3);
      float a2 = 0.02;
      float t2 = (1.0 - ndh * ndh) / (ndh * ndh);
      float D = exp(-t2 / a2) / (PI * a2 * ndh * ndh * ndh * ndh);
      float F = 0.02 + 0.98 * pow(1.0 - max(dot(viewL, hv), 0.0), 5.0);
      lit += sunHere * min(D * F * 0.25 / max(mu, 0.2), 6.0) * spec * uGlint * smoothstep(0.0, 0.15, ndl);
    }
    // The sea mirrors the sky towards the limb.
    float fres = 0.02 + 0.98 * pow(1.0 - mu, 5.0);
    lit += spec * fres * uSunColor * (1.0 - exp(-beta * 6.0)) * 0.3 * daylight;

    // A blast wave racing out through the air: it tears the cloud deck away behind it and
    // rides on a ring of compressed, condensing air.
    float shockClear = 1.0, shockFront = 0.0;
    if (uShockAmt > 0.0) {
      float ang = acos(clamp(dot(q, normalize(uShock.xyz)), -1.0, 1.0));
      float R = uShock.w * (1.0 + 0.05 * gfbm(q * 7.0, 3));
      shockClear = 1.0 - 0.92 * uShockAmt * smoothstep(R, R * 0.8, ang);
      shockFront = uShockAmt * exp(-pow((ang - R) / (0.005 + 0.022 * R), 2.0));
    }
    // Clouds: a layer above the surface, lit from the Sun's side, shading the ground beyond.
    float cov = 0.0;
    if (uClouds > 0.0) {
      vec3 cq = rotY(uCloudT) * q;
      vec3 sunC = rotY(uCloudT) * sunL;
      vec2 cl = cloudAt(cq, 6);
      // One more reading a little way towards the Sun: denser there means this point sits in
      // that cloud's shade; thinner means it is a sunward edge. Shadows stretch as the Sun sinks.
      vec3 sunT = sunC - cq * dot(sunC, cq);
      vec2 cs = cloudAt(normalize(cq + sunT * (0.011 / max(ndl, 0.16))), 5);
      cl *= shockClear;
      cs *= shockClear;
      cov = cl.x;
      lit *= 1.0 - 0.6 * cs.x * (1.0 - cov) * smoothstep(0.0, 0.2, ndl);
      float relief = clamp((cl.y - cs.y) * 2.2, -1.0, 1.0);
      float body = mix(0.62, 1.0, cl.y) * (1.0 + 0.3 * relief) * mix(1.0, 0.45, uStorm);
      // Cloud tops sit above half the air: the low Sun reddens them less than the ground.
      vec3 sunCloud = uSunColor * sunThrough(ndl, 0.5) * smoothstep(-0.1, 0.22, ndl);
      vec3 cloud = vec3(0.92, 0.94, 0.97) * body * sunCloud;
      lit = mix(lit, cloud, cov);
      emit *= 1.0 - cov * 0.8;
    }
    if (shockFront > 0.0) {
      vec3 ringLight = uSunColor * sunThrough(ndl, 0.5) * smoothstep(-0.1, 0.22, ndl) + fireRamp(0.72) * 1.6 * exp(-uShock.w * 3.5);
      lit = mix(lit, vec3(0.95, 0.96, 1.0) * ringLight, saturate(shockFront * 0.85));
      cov = max(cov, shockFront * 0.5);
    }
    // Stratospheric soot and dust (impact winter) veil the clouds too.
    if (uDust > 0.0) {
      float dAng = acos(clamp(dot(q, normalize(uDustDir)), -1.0, 1.0));
      float dEdge = uDustR * (0.85 + 0.3 * fbm(q * 5.0, 4));
      float veil = smoothstep(dEdge, dEdge * 0.6, dAng) * uDust;
      // Swirled, uneven cover: thick soot, thinner brown dust, glimpses of the surface.
      vec3 sq = q * 6.0 + vec3(2.0 * fbm(q * 3.0, 3), 0.0, uGTime * 0.02);
      float swirl = fbm(sq, 4);
      vec3 soot = mix(vec3(0.03, 0.026, 0.024), vec3(0.14, 0.105, 0.08), smoothstep(0.3, 0.75, swirl));
      lit = mix(lit, soot * uSunColor * max(ndl, 0.0), veil * (0.5 + 0.42 * smoothstep(0.25, 0.7, swirl)));
    }
    // Night-side airglow / thermal glow of a hot planet.
    lit += uNightGlow * vec3(0.9, 0.3, 0.08) * (1.0 - daylight) * 0.2;
    col = lit + emit;
    // A thick haze layer (an early methane smog, steam): flat, and thicker towards the limb.
    float rim = pow(1.0 - mu, 2.2);
    col = mix(col, uHazeColor * (0.2 + 0.8 * smoothstep(-0.3, 0.5, ndl)) * uSunColor, uHaze * (0.35 + 0.65 * rim));
    // The air in front of it all: it takes its colour out of the surface behind and adds its own
    // glow, thin at the centre of the disc and deep at the limb.
    vec3 tau = beta * airMass(mu) * mix(1.0, 0.5, cov);
    col = col * exp(-tau) + airGlow(tau, ndl);
    alpha = cover;
    col *= cover;
    if (uDepthWrite > 0.5) gl_FragDepth = cover * uOpacity > 0.5 ? depthOf(pos) : 1.0;
  } else if (uDepthWrite > 0.5) {
    gl_FragDepth = 1.0;
  }
  // The air beyond the limb: a thin bright line that falls away with height.
  if (uAtmo > 0.0 && dmin > uRadius * 0.98) {
    float hgt = max(dmin - uRadius, 0.0) / (uRadius * uAtmoHeight);
    vec3 nh = normalize(oc + rd * tc);
    vec3 tau = beta * AIR_GRAZE * exp(-hgt);
    col += airGlow(tau, dot(nh, sun)) * (1.0 - alpha);
  }
  fragColor = vec4(col, alpha) * uOpacity;
}`;

export interface PlanetParams {
  center: Vec3;
  radius: number;
  /** Rotation of the planet (radians around its tilted axis). */
  spin?: number;
  tilt?: number;
  /** Extra orientation (yaw) so a chosen longitude faces the camera. */
  yaw?: number;
  sunDir: Vec3;
  sunColor?: Vec3;
  seed?: number;
  lava?: number;
  crust?: number;
  ocean?: number;
  seaLevel?: number;
  /** Earth mode: fraction of ocean depth (0..1) that has evaporated. */
  retreat?: number;
  oceanColor?: Vec3;
  ice?: number;
  earth?: number;
  desert?: number;
  city?: number;
  mars?: number;
  terraform?: number;
  veg?: number;
  moon?: number;
  clouds?: number;
  cloudT?: number;
  storm?: number;
  atmo?: number;
  atmoColor?: Vec3;
  haze?: number;
  hazeColor?: Vec3;
  glint?: number;
  nightGlow?: number;
  /** Relief shading of land from its height field (default 1; 0 = smooth). */
  relief?: number;
  /** Scale height of the air as a fraction of the radius (default 0.014: exaggerated, as films do). */
  atmoHeight?: number;
  /** Earth-like climate zones in the cloud cover: a cloudy equator, clear subtropics, storm tracks (default 1). */
  cloudZones?: number;
  /**
   * Up to 8 glowing impact sites: [x, y, z, ageSeconds] in planet-local coordinates. The
   * vector's length scales the scar (1 = a crater, ~10 = a planet-scale shock-heated region).
   */
  impacts?: [number, number, number, number][];
  dustDir?: Vec3;
  dustR?: number;
  dust?: number;
  bloom?: number;
  /**
   * A blast wave in the air: a ring of condensation at `radius` (radians) from the planet-local
   * direction `dir`, with the cloud deck torn away behind it. `amount` 0..1.
   */
  shock?: { dir: Vec3; radius: number; amount: number };
  /** Fades the whole planet (0..1), e.g. to hand it over to a particle simulation. */
  opacity?: number;
  /** Write depth unconditionally (sprites drawn later can depth-test against the planet). */
  depthWrite?: boolean;
  /**
   * Depth-test against what is already drawn, and write depth: planets that overlap or
   * intersect (a collision) then occlude each other per pixel, in any draw order.
   */
  depthTest?: boolean;
}

export interface EarthMaps {
  albedo: Texture;
  masks: Texture;
  climate: Texture;
  relief: Texture;
}

/** Load the Natural Earth derived maps (see tools/assets/build_earth.py). */
export async function loadEarth(e: Engine): Promise<EarthMaps> {
  const o = { filter: 'mipmap' as const, wrapS: 'repeat' as const, wrapT: 'clamp' as const, anisotropy: 8 };
  const [albedo, masks, climate, relief] = await Promise.all([
    e.texture('/assets/earth/albedo.png', { ...o, format: 'srgba8' }),
    e.texture('/assets/earth/masks.png', o),
    e.texture('/assets/earth/climate.png', o),
    e.texture('/assets/earth/relief.png', o),
  ]);
  return { albedo, masks, climate, relief };
}

/**
 * Planet-local direction of a world-space direction, for surface features such as `impacts`
 * (pass the same spin/tilt/yaw as the draw call they belong to).
 */
export function planetLocal(p: Pick<PlanetParams, 'spin' | 'tilt' | 'yaw'>, dir: Vec3): Vec3 {
  const m = m4.invert(rotation(p as PlanetParams));
  const [x, y, z] = dir;
  return [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
}

function rotation(p: PlanetParams): Mat4 {
  // local -> world: yaw, then axial tilt, then spin about the tilted axis.
  const m = m4.mul(m4.rotateZ(p.tilt ?? 0.41), m4.mul(m4.rotateY((p.spin ?? 0) + (p.yaw ?? 0)), m4.identity()));
  return m;
}

export class Planet {
  prog: Program;
  constructor(private e: Engine, private maps?: EarthMaps) {
    this.prog = e.program(PLANET, 'planet');
  }

  draw(c: ShotContext, cam: Camera, p: PlanetParams) {
    const gl = c.gl;
    const rot = rotation(p);
    const inv = m4.invert(rot);
    const imp = new Float32Array(32).fill(-1);
    (p.impacts ?? []).slice(0, 8).forEach((v, i) => imp.set(v, i * 4));
    cam.aspect = c.aspect;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const depth = p.depthWrite || p.depthTest;
    if (depth) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(p.depthTest ? gl.LEQUAL : gl.ALWAYS);
      gl.depthMask(true);
    }
    c.fullscreen(this.prog, {
      ...cam.uniforms(),
      uCenter: p.center,
      uRadius: p.radius,
      uRotInv: inv,
      uSunDir: p.sunDir,
      uSunColor: p.sunColor ?? [1.6, 1.55, 1.45],
      uSeed: p.seed ?? 0,
      uLava: p.lava ?? 0,
      uCrust: p.crust ?? 0.5,
      uOcean: p.ocean ?? 0,
      uSeaLevel: p.seaLevel ?? 0,
      uRetreat: p.retreat ?? 0,
      uOceanColor: p.oceanColor ?? [0.02, 0.09, 0.2],
      uIce: p.ice ?? 0,
      uEarth: p.earth ?? 0,
      uDesert: p.desert ?? 0,
      uCity: p.city ?? 0,
      uMars: p.mars ?? 0,
      uTerraform: p.terraform ?? 0,
      uVeg: p.veg ?? 0,
      uMoon: p.moon ?? 0,
      uClouds: p.clouds ?? 0,
      uCloudT: p.cloudT ?? 0,
      uStorm: p.storm ?? 0,
      uAtmo: p.atmo ?? 0,
      uAtmoColor: p.atmoColor ?? [0.25, 0.5, 1.0],
      uHaze: p.haze ?? 0,
      uHazeColor: p.hazeColor ?? [0.8, 0.5, 0.3],
      uGlint: p.glint ?? 1,
      uNightGlow: p.nightGlow ?? 0,
      uReliefAmt: p.relief ?? 1,
      uAtmoHeight: p.atmoHeight ?? 0.014,
      uCloudZones: p.cloudZones ?? 1,
      uImpacts: imp,
      uDustDir: p.dustDir ?? [0, 0, 1],
      uDustR: p.dustR ?? 0,
      uDust: p.dust ?? 0,
      uBloom: p.bloom ?? 0,
      uShock: p.shock ? [...p.shock.dir, p.shock.radius] : [0, 0, 1, 0],
      uShockAmt: p.shock?.amount ?? 0,
      uHasEarth: this.maps ? 1 : 0,
      uAlbedo: this.maps?.albedo ?? this.e.blankTexture,
      uMasks: this.maps?.masks ?? this.e.blankTexture,
      uClimate: this.maps?.climate ?? this.e.blankTexture,
      uRelief: this.maps?.relief ?? this.e.blankTexture,
      uDepthWrite: depth ? 1 : 0,
      uOpacity: p.opacity ?? 1,
    });
    gl.disable(gl.BLEND);
    if (depth) {
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.DEPTH_TEST);
    }
  }
}
