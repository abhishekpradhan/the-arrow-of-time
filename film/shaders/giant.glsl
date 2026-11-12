// The Sun as a red giant (shots/future.ts), traced in AU around the star's centre.
//
// The photosphere is convection at three scales, as in simulations of red supergiants: a handful
// of giant cells, each with its own temperature, whose wide dark downdraft lanes wander and
// merge; medium granules inside them; and fine granulation that only the close view resolves.
// Limb darkening is strong and reddens the edge. Above it lies an extended atmosphere,
// integrated along the ray with samples packed against the surface: a thin bright chromosphere,
// tongues of gas that rise where the surface is hot, and a slow wind combed into radial streamers.
// The inner planets are lit by the star, veiled by its atmosphere as the limb reaches them, and
// gone in a flare.
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes;
uniform float uAspect, uGTime, uR, uHeat, uAtmo, uDetail, uTurn;
uniform vec3 uStar;
uniform vec4 uPl[3];      // planet centre (AU) and drawn radius; 0 radius = gone
uniform float uFlash[3];  // engulfment flare, 0..1
#include <common>
#include <noise>
#include <color>
#include <camera>

const float R_TOP = 2.1;  // where the atmosphere ends, in stellar radii

// Cells whose centres wander: x = distance to the nearest centre, y = to the second nearest,
// z = a random number for the nearest cell.
vec3 cells(vec3 p, float time) {
  vec3 n = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int k = -1; k <= 1; k++)
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        vec3 g = vec3(i, j, k);
        vec3 h = hash33(n + g);
        vec3 o = 0.5 + 0.36 * sin(TAU * h + time * (0.5 + h.yzx));
        vec3 r = g + o - f;
        float d = dot(r, r);
        if (d < f1) { f2 = f1; f1 = d; id = h.x + h.y; }
        else if (d < f2) f2 = d;
      }
  return vec3(sqrt(f1), sqrt(f2), fract(id * 5.37));
}

// Display colour of gas at a (film) temperature x in 0..1: deep red embers to pale gold.
vec3 heatColor(float x) {
  return blackbody(1150.0 + 3300.0 * saturate(x));
}

// Light leaving the photosphere towards the camera. n: unit normal, mu: cosine of the viewing
// angle, px: the footprint of a pixel on the surface in stellar radii.
vec3 photosphere(vec3 n, float mu, float px) {
  float time = uGTime;
  float a = time * 0.008 + uTurn;
  vec3 q = vec3(cos(a) * n.x - sin(a) * n.z, n.y, sin(a) * n.x + cos(a) * n.z) * uDetail;
  vec3 w1 = vec3(gnoise(q * 1.4 + vec3(0.0, time * 0.02, 0.0)), gnoise(q * 1.4 + vec3(11.3, 0.0, -time * 0.02)), gnoise(q * 1.4 + 23.7));

  // Giant cells. The lanes between them are downdrafts: wide in places, pinched shut in others.
  vec3 A = cells(q * 1.2 + 0.42 * w1, time * 0.05);
  float wide = 0.2 + 0.55 * smoothstep(-0.5, 0.6, gnoise(q * 2.3 + 5.0));
  float domeA = smoothstep(0.0, wide, A.y - A.x + 0.1 * gnoise(q * 5.0 + 3.1));
  float coreA = pow(saturate(1.0 - A.x * 1.25), 2.0);
  float heat = mix(0.2, 1.0, domeA) * (0.55 + 0.6 * A.z + 0.4 * coreA * A.z);

  // Granules within granules, each scale a third the size of the last: pillows of hot gas with
  // dim lanes between them, crowded and faint in the downdrafts of the scale above. A scale
  // fades out where its cells are smaller than a few pixels (far away, or near the limb).
  float f = 4.4, rate = 0.12, contrast = 0.55;
  vec3 w = w1 * 0.7;
  for (int i = 0; i < 4; i++) {
    float vis = smoothstep(1.5, 5.0, mu / (f * uDetail * px));
    if (vis <= 0.0) break;
    vec3 wn = vec3(gnoise(q * f * 1.13 + 3.1), gnoise(q * f * 1.13 + vec3(17.9, time * rate * 0.25, 0.0)), gnoise(q * f * 1.13 + 29.3));
    vec3 C = cells(q * f + 0.55 * wn + w, time * rate);
    float e = max(C.y - C.x + 0.06 * wn.y, 0.0);
    float dome = 1.0 - exp(-e * e / 0.045);
    float g = mix(1.0 - contrast, 1.0, dome) * (0.8 + 0.4 * C.z);
    heat *= mix(1.0 - 0.4 * contrast, g, vis);
    w = w * 2.6 + 0.5 * wn;
    f *= 3.1;
    rate *= 1.8;
    contrast *= 0.86;
  }

  // Limb darkening: dimmer and redder towards the edge.
  float limb = 0.06 + 0.94 * pow(mu, 0.85);
  float x = pow(heat, 0.6) * (0.5 + 0.5 * pow(mu, 0.5));
  return heatColor(0.05 + 0.62 * x) * pow(heat, 1.3) * limb * 2.3;
}

// The atmosphere at altitude h (stellar radii) above the direction d: rgb = what it emits per
// unit length, a = what it absorbs per unit length (so rgb / a is the glow of a thick layer).
vec4 air(vec3 d, float h) {
  float time = uGTime;
  float region = fbm(d * 4.5 + vec3(0.0, time * 0.012, 0.0), 3);
  // A thin chromosphere hugging the surface: transparent from above, a bright rim at the limb.
  float k = exp(-h / 0.011) * 7.0;
  vec4 c = vec4(heatColor(0.3) * (0.2 + 0.7 * region), 1.0) * k;
  // Tongues of gas thrown up over the active regions: they taper as they climb and drift
  // upwards, and a few sites throw them several times higher. Thin gas: faint seen from above,
  // bright along the long paths at the limb.
  float site = smoothstep(0.48, 0.7, fbm(d * 1.6 + 7.0, 2));
  float fil = fbm(d * 13.0 + vec3(0.0, 0.0, h * 7.0 - time * 0.09), 3);
  float rise = (2.5 - 1.9 * site) * h;
  float flame = smoothstep(0.58 + rise, 0.8 + rise, 0.72 * region + 0.42 * fil);
  k = flame * exp(-h / (0.1 + 0.14 * site)) * 2.2;
  // Bright where it leaves the surface, cooling to a dull red as it climbs.
  c += vec4(heatColor(0.45 - 1.3 * h + 0.2 * fil) * (0.35 + 1.2 * exp(-h / 0.09)), 1.0) * k;
  // The wind: thin, slow, combed into radial streamers, fading out by the top of the atmosphere.
  float comb = fbm(d * 16.0 + vec3(time * 0.01), 2);
  float fade = saturate(1.0 - h / (R_TOP - 1.0));
  k = exp(-h / 0.4) * fade * fade * (0.25 + 1.5 * comb * comb) * (0.4 + region) * 0.42;
  c += vec4(heatColor(0.08) * 0.55, 1.0) * k;
  return c;
}

// One step of the atmosphere in front of what is already there: absorb, then glow.
vec3 through(vec3 col, vec4 a, float ds) {
  float tr = exp(-a.a * ds);
  return col * tr + a.rgb / max(a.a, 1e-5) * (1.0 - tr);
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p), ro = uCamPos;
  vec3 oc = (ro - uStar) / uR;                 // everything below in stellar radii
  float b = dot(oc, rd), c2 = dot(oc, oc);
  float h = b * b - c2 + 1.0;
  float tc = max(-b, 0.0);
  float b2 = max(c2 - b * b, 0.0);             // squared impact parameter
  float dr = length(oc + rd * tc);
  float pix = 2.0 * uTanHalfFov / uRes.y;
  vec3 col = vec3(0.0);
  float tHit = 1e9;
  if (h > 0.0 && -b - sqrt(h) > 0.0) {
    tHit = -b - sqrt(h);
    vec3 n = normalize(oc + rd * tHit);
    col = photosphere(n, max(dot(n, -rd), 0.0), pix * tHit);
  }

  // The atmosphere, from the far end of the ray towards the camera: from the surface, or along
  // the whole chord for a ray that misses. Samples are packed against the surface (or the
  // tangent point), where the gas is dense.
  float top2 = R_TOP * R_TOP;
  if (b2 < top2 && (tHit < 1e8 || -b + sqrt(top2 - b2) > 0.0) && uAtmo > 0.0) {
    float jit = hash12(gl_FragCoord.xy + fract(uGTime) * 61.0);
    float S = sqrt(top2 - b2);
    if (tHit < 1e8) {
      float len = min(tHit, S - sqrt(max(1.0 - b2, 0.0)));
      const int N = 14;
      for (int i = 0; i < N; i++) {
        float u = (float(i) + jit) / float(N);
        vec3 q = oc + rd * (tHit - len * u * u * u);
        float r = length(q);
        col = through(col, air(q / r, max(r - 1.0, 0.0)) * uAtmo, len * 3.0 * u * u / float(N));
      }
    } else {
      const int N = 24;
      for (int i = 0; i < N; i++) {
        float u = 1.0 - 2.0 * (float(i) + jit) / float(N);
        float t = -b + S * u * abs(u);
        if (t < 0.0) break;
        vec3 q = oc + rd * t;
        float r = length(q);
        col = through(col, air(q / r, max(r - 1.0, 0.0)) * uAtmo, S * 4.0 * abs(u) / float(N));
      }
    }
  }
  // A faint corona far beyond the gas.
  col += heatColor(0.12) * exp(-max(dr - 1.0, 0.0) / 0.55) * 0.03 * uAtmo * smoothstep(0.0, 0.4, dot(rd, normalize(-oc)));

  // The inner planets.
  for (int i = 0; i < 3; i++) {
    vec4 pl = uPl[i];
    vec3 d = (pl.xyz - uStar) / uR - oc;       // from the camera, in stellar radii
    float t = dot(d, rd);
    if (t <= 0.0) continue;
    float dist = length(d - rd * t);
    float ppx = pix * t;
    float rp = pl.w / uR;
    if (rp > 0.0 && t < tHit) {
      float cover = smoothstep(rp + ppx, rp - ppx, dist);
      if (cover > 0.0) {
        // Shade the sphere under the pixel: sunlit on the side of the star, dark behind.
        vec3 pc = (pl.xyz - uStar) / uR;
        float alt = length(pc) - 1.0;
        vec3 off = (rd * t - d);
        float z = sqrt(max(rp * rp - dot(off, off), 0.0));
        vec3 n = normalize(off - rd * z);
        float ndl = dot(n, normalize(-pc));
        float glare = 1.0 / (1.0 + alt) / (1.0 + alt);
        vec3 lit = heatColor(0.6) * (1.6 * smoothstep(-0.15, 0.5, ndl) * glare + 0.004);
        // The surface melts on the side facing the star as it closes in.
        lit += heatColor(0.75) * smoothstep(0.25, 0.0, alt) * smoothstep(-0.2, 0.7, ndl) * 1.5;
        // The atmosphere swallows the planet before the surface does.
        col = mix(col, lit, cover * smoothstep(0.0, 0.05, alt));
      }
    }
    float f = uFlash[i];
    if (f > 0.0) col += vec3(1.0, 0.8, 0.5) * f * (exp(-dist / (ppx * 2.5 + 0.004 / uR)) * 9.0 + exp(-dist / (0.05 / uR)) * 0.7);
  }
  // The disk is opaque (hides the sky behind it); the atmosphere adds light.
  float px = pix * max(tc, 1e-3);
  fragColor = vec4(col * uHeat, smoothstep(1.0 + px, 1.0 - px, dr));
}
