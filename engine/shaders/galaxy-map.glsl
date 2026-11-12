// Face-on structure of a barred spiral galaxy, for baking into a texture once (see
// engine/components/galaxy.ts, which marches it as a thin volume with <galaxy>). The disk lies
// in the plane of p with a radius of about 1.
//
//   galaxyMap(p) returns   r: old stars (surface brightness)   g: young blue stars and clusters
//                          b: dust (face-on optical depth)      a: H-II regions
//
// Arms are logarithmic spirals that trail from the ends of the bar. Each has an asymmetric
// profile, as in a density wave: a thin dust lane on its inner (concave) edge where the gas is
// compressed, young blue stars and pink H-II regions just downstream of it, and a broad swell of
// old stars. Everything is bent by noise first, because nothing in a real galaxy is regular.
#include <noise>

uniform vec4 uGalShape; // cot(pitch), bar angle, bar half-length, seed
uniform float uGalTexel; // one texel of the map being baked, in disk radii

float galWrap(float a) { return a - TAU * floor(a / TAU + 0.5); }

// Noise in spiral coordinates, periodic in psi (which is constant along an arm; lr = ln r runs
// along it): about fa cells per radian across the arms and fl per e-fold of radius along them.
float galSpiral(float psi, float lr, float fa, float fl, float seed) {
  return gnoise(vec3(cos(psi) * fa, sin(psi) * fa, lr * fl) + seed);
}

// Knots and clouds (star clusters, associations, H-II regions): at most one per cell, with
// radii between rmin and rmax of a cell and a steep luminosity function, so a few are bright
// and most are faint. px is one texel in cells: a knot smaller than that is widened to it and
// dimmed to keep its light, so maps of any size hold the same knots.
float galKnots(vec2 p, float seed, float keep, float rmin, float rmax, float px) {
  vec2 cell = floor(p), f = fract(p);
  float acc = 0.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(i, j);
      vec4 h = hash42(cell + g + seed);
      if (h.z > keep) continue;
      vec2 d = g + 0.2 + 0.6 * h.xy - f;
      float r0 = mix(rmin, rmax, h.w * h.w);
      float rad = max(r0, 0.75 * px);
      float lum = (0.12 + 2.6 * pow(h.z / keep, 6.0)) * (r0 * r0) / (rad * rad);
      acc += lum * exp(-dot(d, d) / (rad * rad));
    }
  return acc;
}

// Thin strands that run along the arms: the zero crossings of noise stretched in spiral
// coordinates, at three scales.
float galStrands(float psi, float lr, float seed) {
  float a = 1.0 - abs(galSpiral(psi, lr, 7.0, 10.0, seed));
  float b = 1.0 - abs(galSpiral(psi, lr, 16.0, 24.0, seed + 3.0));
  float c = 1.0 - abs(galSpiral(psi, lr, 37.0, 60.0, seed + 6.0));
  a *= a * a; b *= b * b; c *= c * c;
  return a * a + 0.6 * b * b * b + 0.35 * c * c * c;
}

vec4 galaxyMap(vec2 p) {
  float cotp = uGalShape.x, barA = uGalShape.y, BAR = uGalShape.z, seed = uGalShape.w;
  float sinp = inversesqrt(1.0 + cotp * cotp);

  vec2 q = p + 0.1 * vec2(gfbm(p * 1.4 + seed, 3), gfbm(p * 1.4 + seed + 31.7, 3));
  float r = length(q) + 1e-5;
  float th = atan(q.y, q.x);
  float lr = log(max(r, 0.3 * BAR) / BAR);
  float psi = th - cotp * lr;

  // The dust lanes meander about the arm's line.
  float meander = 0.6 * galSpiral(psi, lr, 4.0, 7.0, seed + 1.0) + 0.3 * galSpiral(psi, lr, 11.0, 19.0, seed + 2.0);

  float armOld = 0.0, armYoung = 0.0, armDust = 0.0, armSpur = 0.0, armNear = 0.0;
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    // Two major arms from the ends of the bar, two weaker ones between them.
    float phi = barA + (k < 2 ? fk * PI : (fk - 2.0) * PI + 1.7 + 0.35 * (fk - 2.0));
    float along = lr * 1.7 + fk * 13.7 + seed;
    float wander = (0.34 * gnoise(vec2(along, 3.1)) + 0.1 * gnoise(vec2(along * 3.1, 9.4))) * smoothstep(0.0, 0.5, lr);
    float d = galWrap(psi - phi - wander) * sinp; // across the arm in units of r; > 0 is the inner side
    float w = k < 2
      ? smoothstep(0.8 * BAR, 1.15 * BAR, r) * (1.0 - smoothstep(0.88, 1.25, r))
      : 0.8 * smoothstep(1.1 * BAR, 1.6 * BAR, r) * (1.0 - smoothstep(0.74, 1.05, r));
    w *= clamp(0.62 + 0.75 * gnoise(vec2(along * 1.5 + 40.0, 5.7)), 0.06, 1.3); // strength varies along the arm
    float wd = 1.0 + 0.3 * gnoise(vec2(along * 1.9 + 80.0, 1.3)); // and so does its width
    armOld += w * exp(-pow(d / (0.16 * wd), 2.0));
    armYoung += w * (d > 0.0 ? exp(-pow(d / (0.036 * wd), 2.0)) : exp(d / (0.11 * wd)));
    float dd = d + 0.014 * meander;
    armDust += w * exp(-pow((dd - 0.055 * wd) / (0.034 * wd), 2.0));
    armSpur += w * exp(-pow((d + 0.1) / 0.12, 2.0));
    armNear = max(armNear, w * exp(-pow(d / 0.16, 2.0)));
  }

  // ---------------------------------------------------------------- dust
  // Lanes are bundles of strands along the inner edge of each arm; fainter strands thread the
  // whole disk, and feathers shear off the lanes into the gaps at a steeper pitch.
  float strands = galStrands(psi, lr, seed + 3.0);
  float psi2 = th - 1.15 * lr;
  float sp = 1.0 - abs(galSpiral(psi2, lr, 15.0, 3.0, seed + 6.0));
  float spurs = armSpur * pow(sp, 9.0);
  // Patchy, flocculent dust everywhere there is gas.
  vec2 fq = q * 11.0 + 1.5 * vec2(gnoise(q * 5.0 + seed), gnoise(q * 5.0 + seed + 9.0));
  float floc = smoothstep(0.52, 0.8, fbm(fq, 5));
  // Fine wisps.
  float fine = fbm(q * 46.0 + 3.0 * vec2(gnoise(q * 17.0 + seed), gnoise(q * 17.0 + seed + 4.0)), 5);
  float envD = smoothstep(0.05, 0.16, r) * (1.0 - smoothstep(0.85, 1.2, r));
  float dust = envD * (armDust * (0.3 + 2.6 * strands) + (0.3 + 0.45 * armNear) * strands + 1.1 * spurs + 0.35 * floc * (0.25 + armNear)) * (0.45 + 1.1 * fine);

  // The bar: a boxy ridge of old stars, with a straight dust lane down the leading edge of
  // each half that curls into the nucleus.
  vec2 bq = rot2(-barA) * q;
  float bx = abs(bq.x) / BAR, bz = bq.y / (0.3 * BAR);
  float bar = exp(-pow(bx, 4.0) - bz * bz) * (0.45 + 0.55 * exp(-2.2 * bx));
  // Offset to the leading side, further from the axis towards the end of the bar.
  float yc = -tanh(bq.x / (0.1 * BAR)) * BAR * (0.06 + 0.1 * bx);
  float bl = exp(-pow((bq.y - yc + 0.012 * meander) / (0.035 * BAR), 2.0));
  bl *= smoothstep(1.2, 0.8, bx) * smoothstep(0.2, 0.45, bx) * (0.35 + 1.1 * fbm(vec2(bq.x * 16.0, bq.y * 60.0) + seed, 3));
  dust += 1.1 * bl * (0.5 + 1.0 * fine);

  // ---------------------------------------------------------------- stars
  float disk = 0.8 * exp(-r / 0.32) * (0.62 + 1.15 * armOld) * (1.0 - smoothstep(0.9, 1.38, r));
  float old = (disk + 1.1 * bar) * (0.9 + 0.2 * fbm(q * 30.0, 3)) * (0.78 + 0.44 * fbm(q * 7.0 + seed, 4));

  // Young stars gather into clouds and associations along the arms; larger gaps and bright
  // stretches break the arms into segments.
  float seg = 0.45 + 0.9 * smoothstep(0.3, 0.7, fbm(q * 5.5 + seed + 13.0, 3));
  float cloud = 0.5 * galKnots(q * 13.0, seed + 61.0, 0.85, 0.18, 0.42, uGalTexel * 13.0) + 0.45 * galKnots(q * 31.0, seed + 67.0, 0.8, 0.15, 0.4, uGalTexel * 31.0);
  float grain = fbm(q * 60.0 + seed, 4);
  float envY = smoothstep(0.75 * BAR, 1.3 * BAR, r) * (1.0 - smoothstep(0.8, 1.25, r));
  // Feathers of young stars shear off the arms too.
  float sp2 = 1.0 - abs(galSpiral(psi2, lr, 9.0, 2.0, seed + 16.0));
  float young = envY * ((armYoung + 0.35 * armSpur * sp2 * sp2 * sp2 * sp2) * seg * (0.3 + cloud) * (0.5 + grain) + 0.03 * armNear) * 1.35;
  float kn = galKnots(q * 70.0, seed + 11.0, 0.5, 0.06, 0.2, uGalTexel * 70.0) + 0.6 * galKnots(q * 160.0, seed + 23.0, 0.6, 0.06, 0.2, uGalTexel * 160.0);
  young += envY * armYoung * seg * (0.3 + cloud) * kn * 1.1;
  // Beyond the bright arms the disk carries on, faint, blue and ragged.
  float outer = 1.0 - abs(galSpiral(psi, lr, 3.0, 2.5, seed + 71.0));
  young += 0.14 * smoothstep(0.7, 1.0, r) * (1.0 - smoothstep(1.0, 1.34, r)) * outer * outer * outer * (0.25 + cloud) * (0.5 + grain);

  float hk = galKnots(q * 40.0, seed + 37.0, 0.3, 0.08, 0.3, uGalTexel * 40.0) + 0.7 * galKnots(q * 105.0, seed + 51.0, 0.22, 0.08, 0.26, uGalTexel * 105.0);
  float hii = envY * (pow(armYoung, 1.3) * seg + 0.25 * armDust) * hk * 2.0;

  return vec4(old, young, dust, hii);
}
