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
uniform vec3 uAtmoColor, uHazeColor, uOceanColor;
uniform vec4 uImpacts[8];        // xyz = local direction, w = age in seconds (<0 = inactive)
uniform vec3 uDustDir;           // local direction of a spreading dust/soot cloud (asteroid impact)
uniform float uDustR, uDust;     // angular radius (radians) and strength
uniform float uBloom;            // cyanobacteria blooms in shallow seas
uniform sampler2D uAlbedo, uMasks, uClimate, uRelief;
uniform float uHasEarth;
uniform float uDepthWrite;

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

vec3 surface(vec3 q, vec3 n, vec3 sun, float daylight, out float spec, out vec3 emit) {
  emit = vec3(0.0);
  spec = 0.0;
  float h = procHeight(q);
  // ---------------- procedural rock / young Earth
  vec3 rock = mix(vec3(0.05, 0.045, 0.04), vec3(0.18, 0.15, 0.12), smoothstep(-0.3, 0.5, h));
  vec3 col = rock;
  // ---------------- molten world: glowing cracks between dark crust plates, lava seas
  if (uLava > 0.0) {
    vec3 wq = q * 4.0 + uSeed + 0.35 * vec3(gnoise(q * 3.0), gnoise(q * 3.0 + 5.0), gnoise(q * 3.0 + 9.0));
    vec2 w = worley(wq);
    float crack = 1.0 - smoothstep(0.0, 0.03 + 0.05 * (1.0 - uCrust), w.y - w.x);
    vec2 w2 = worley(wq * 2.7 + 11.0);
    float crack2 = 1.0 - smoothstep(0.0, 0.025, w2.y - w2.x);
    float sea = smoothstep(-0.16, -0.34, h + (uCrust - 0.5) * 0.35);
    float flick = 0.45 + 0.8 * fbm(q * 9.0 + uGTime * 0.05, 3);
    float heat = saturate(max(max(crack, crack2 * 0.45), sea) * flick);
    vec3 crust = mix(vec3(0.03, 0.025, 0.022), vec3(0.1, 0.075, 0.06), fbm(q * 20.0, 3));
    col = mix(col, crust, uLava);
    emit += fireRamp(0.18 + 0.6 * heat) * heat * heat * 1.25 * uLava;
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
    vec3 deep = uOceanColor * 0.35;
    vec3 shallow = uOceanColor * vec3(0.8, 1.3, 1.25);
    vec3 ocean = mix(shallow, deep, smoothstep(0.0, 0.25, depth));
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
    float ice = smoothstep(edge - 0.04, edge + 0.04, lat + 0.08 * (fbm(q * 6.0, 4) - 0.5));
    col = mix(col, vec3(0.82, 0.88, 0.95), ice);
    spec *= 1.0 - ice;
  }
  // ---------------- impacts (molten Earth bombardment)
  for (int i = 0; i < 8; i++) {
    vec4 im = uImpacts[i];
    if (im.w < 0.0) continue;
    float d = acos(clamp(dot(q, normalize(im.xyz)), -1.0, 1.0));
    float age = im.w;
    float ring = exp(-pow((d - age * 0.05) / 0.012, 2.0)) * exp(-age * 1.2);
    float core = exp(-d * d / 0.0015) * exp(-age * 0.6);
    emit += fireRamp(0.85) * (core * 2.5 + ring * 1.5);
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

  vec3 col = vec3(0.0);
  float alpha = 0.0;
  if (hdisc > 0.0 || cover > 0.0) {
    // Front-surface hit; rays that only graze (anti-aliased fringe) use the closest approach.
    float t = hdisc > 0.0 ? -b - sqrt(hdisc) : tc;
    vec3 pos = ro + rd * t;
    vec3 n = normalize(pos - uCenter);
    vec3 q = normalize((uRotInv * vec4(n, 0.0)).xyz);
    float ndl = dot(n, sun);
    float daylight = smoothstep(-0.12, 0.25, ndl);
    float spec;
    vec3 emit;
    vec3 alb = surface(q, n, sun, daylight, spec, emit);
    vec3 lit = alb * uSunColor * max(ndl, 0.0) * smoothstep(-0.05, 0.2, ndl);
    // Sun glint on water.
    vec3 hv = normalize(sun - rd);
    float g = pow(max(dot(n, hv), 0.0), 420.0) * spec * uGlint;
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
    lit += uSunColor * g * 3.0 * max(ndl, 0.0);
    lit += spec * fres * uAtmoColor * 0.25 * daylight;
    // Clouds: domain-warped fbm drifting over the surface, lit with a soft terminator.
    if (uClouds > 0.0) {
      vec3 cq = rotY(uCloudT) * q;
      vec3 w = vec3(fbm(cq * 3.0, 4), fbm(cq * 3.0 + 5.2, 4), fbm(cq * 3.0 + 9.1, 4));
      float cn = fbm(cq * 4.5 + w * 1.8, 6);
      float cov = smoothstep(1.0 - uClouds * 0.85, 1.0 - uClouds * 0.85 + 0.22, cn);
      float cshade = mix(1.0, 0.45, uStorm) * (0.75 + 0.25 * fbm(cq * 18.0, 3));
      vec3 cloud = vec3(0.95, 0.96, 1.0) * cshade * uSunColor * smoothstep(-0.15, 0.35, ndl);
      lit = mix(lit, cloud, cov);
      emit *= 1.0 - cov * 0.8;
    }
    // Night-side airglow / thermal glow of a hot planet.
    lit += uNightGlow * vec3(0.9, 0.3, 0.08) * (1.0 - daylight) * 0.2;
    // Atmosphere on the disc: brighter towards the limb, blue by day, warm at the terminator.
    float mu = max(dot(n, -rd), 0.0);
    float rim = pow(1.0 - mu, 2.2);
    float twilight = exp(-pow(ndl / 0.18, 2.0));
    vec3 atm = uAtmoColor * rim * (smoothstep(-0.25, 0.4, ndl) * 1.6) + vec3(1.0, 0.45, 0.2) * rim * twilight * 0.6;
    col = lit + emit + atm * uAtmo;
    col = mix(col, uHazeColor * (0.2 + 0.8 * smoothstep(-0.3, 0.5, ndl)) * uSunColor, uHaze * (0.35 + 0.65 * rim));
    alpha = cover;
    col *= cover;
    if (uDepthWrite > 0.5) gl_FragDepth = cover > 0.5 ? depthOf(pos) : 1.0;
  } else if (uDepthWrite > 0.5) {
    gl_FragDepth = 1.0;
  }
  // Atmosphere halo just beyond the limb.
  if (uAtmo > 0.0 && dmin > uRadius * 0.98) {
    float hgt = (dmin - uRadius) / (uRadius * 0.035);
    vec3 nh = normalize(oc + rd * tc);
    float lit = smoothstep(-0.35, 0.3, dot(nh, sun));
    float twilight = exp(-pow(dot(nh, sun) / 0.2, 2.0));
    vec3 halo = (uAtmoColor * lit * 1.4 + vec3(1.0, 0.5, 0.25) * twilight * 0.5) * exp(-max(hgt, 0.0) * 1.3) * uAtmo;
    col += halo * (1.0 - alpha);
  }
  fragColor = vec4(col, alpha);
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
  impacts?: [number, number, number, number][];
  dustDir?: Vec3;
  dustR?: number;
  dust?: number;
  bloom?: number;
  depthWrite?: boolean;
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
    if (p.depthWrite) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.ALWAYS);
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
      uImpacts: imp,
      uDustDir: p.dustDir ?? [0, 0, 1],
      uDustR: p.dustR ?? 0,
      uDust: p.dust ?? 0,
      uBloom: p.bloom ?? 0,
      uHasEarth: this.maps ? 1 : 0,
      uAlbedo: this.maps?.albedo ?? this.e.blankTexture,
      uMasks: this.maps?.masks ?? this.e.blankTexture,
      uClimate: this.maps?.climate ?? this.e.blankTexture,
      uRelief: this.maps?.relief ?? this.e.blankTexture,
      uDepthWrite: p.depthWrite ? 1 : 0,
    });
    gl.disable(gl.BLEND);
    if (p.depthWrite) {
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.DEPTH_TEST);
    }
  }
}
