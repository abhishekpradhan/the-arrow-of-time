// The Sun's planetary nebula (shots/future.ts): the outer layers it shed as a red giant, lit
// from within by the white dwarf that is left. A volume marched front to back in units of the
// main shell's size (it expands homologously: every feature moves straight out).
//
// The model follows the Ring and the Helix: a prolate shell with a bright equatorial belt (so
// that it reads as a ring from above), swept up by the star's fast wind and so sharp on the
// inside, soft on the outside, and laced with filaments; cometary knots along its inner rim,
// each a dense globule with a bright ionised head towards the star and a dark tail pointing
// away; a hot thin bubble inside; and outside, a faint halo combed into radial rays, with the
// thin shells of older ejections around it (traced analytically: a thin shell is brightest
// where the ray grazes it). Colour is ionisation: He II blue next to the star, O III green in
// the bubble and the inner shell, H-alpha and N II red on the outside, and the yellow of the
// two where they overlap.
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uExpand, uGain;
#include <common>
#include <noise>
#include <color>
#include <camera>

const vec3 HE2 = vec3(0.12, 0.3, 1.0);
const vec3 O3 = vec3(0.06, 0.9, 0.58);
const vec3 O3S = vec3(0.1, 0.85, 0.36);   // the same line deeper in the shell, through more dust
const vec3 HA = vec3(1.0, 0.1, 0.06);
const float R_IN = 1.04;        // the main shell lies inside this sphere (marched finely)
const float R_OUT = 1.55;       // the halo ends here

// The nearest cell in a jittered grid: x = distance to its centre, y and z = its random numbers.
vec3 nearCell(vec3 p) {
  vec3 n = floor(p), f = fract(p);
  float best = 8.0;
  vec2 id = vec2(0.0);
  for (int k = -1; k <= 1; k++)
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        vec3 g = vec3(i, j, k);
        vec3 h = hash33(n + g);
        vec3 r = g + 0.15 + 0.7 * h - f;
        float d = dot(r, r);
        if (d < best) { best = d; id = fract(h.xy * 7.13 + h.z); }
      }
  return vec3(sqrt(best), id);
}

// The main shell and the bubble inside it: light emitted per unit length at q, and the dust
// that dims what lies behind.
void gas(vec3 q, out vec3 emit, out float dust) {
  emit = vec3(0.0);
  dust = 0.0;
  float r = length(q);
  vec3 d = q / max(r, 1e-4);
  float c = d.y;                                    // cosine of the angle from the axis
  float lump = fbm(q * 2.1 + 11.0, 3);
  float belt = 0.03 + 0.97 * exp(-c * c / 0.13);
  float Rs = 0.6 * (1.0 + 0.5 * c * c) * (0.88 + 0.24 * lump);
  float x = (r - Rs) / 0.085;                       // 0 on the shell's crest, negative inside

  // The bubble: thin, hot, faintly marbled.
  float inside = smoothstep(0.2, -1.8, x);
  emit += HE2 * exp(-r * r / 0.06) * (0.3 + 0.9 * lump) * 0.8;
  emit += O3 * inside * (0.03 + 0.2 * lump * lump) * smoothstep(0.05, 0.3, r);

  float rays = fbm(d * 17.0 + 3.0, 3);
  float finger = rays * rays * rays * 6.0;           // sparse radial rays, mean about 1
  if (x > -3.0 && x < 9.0) {
    // The shell: a sharp inner rim and a soft outer flank that ends in ragged fingers, broken
    // into lacework at two scales (sparse filaments, so that they survive the line of sight).
    float g = exp(-x * x / (x < 0.0 ? 0.35 : 0.5 + 3.2 * finger));
    float l1 = 1.0 - abs(2.0 * fbm(q * 5.0 + 2.5 * lump + vec3(0.0, uGTime * 0.008, 0.0), 3) - 1.0);
    float l2 = 1.0 - abs(2.0 * fbm(q * 13.0 + 4.0 * lump + 7.0, 3) - 1.0);
    float lace = 0.08 + 3.2 * pow(l1, 6.0) + 3.0 * pow(l2, 7.0) * (0.3 + l1);
    float shell = g * belt * lace;
    // The swept-up rim on the inside glows brightest.
    float rim = exp(-(x + 0.55) * (x + 0.55) / 0.1) * belt * (0.35 + 0.8 * lace);
    emit += O3S * shell * smoothstep(2.6, -0.8, x) * 0.8 + O3 * rim * 0.5;
    emit += HA * (shell * smoothstep(-1.0, 0.8, x) * (0.4 + 0.8 * finger) * 1.6 + rim * 0.15);

    // Cometary knots along the inner rim of the belt.
    if (x < 3.0 && belt > 0.3) {
      vec3 kc = nearCell(d * 7.5);
      if (kc.y > 0.5) {
        float rk = Rs - 0.085 * (0.4 + 1.5 * kc.z);  // where this knot's head sits
        float u = r - rk;
        float ang = kc.x;
        float core = smoothstep(0.17, 0.07, ang);
        float head = core * exp(-u * u / 0.0004);
        float tail = smoothstep(0.14, 0.04, ang * (1.0 + 1.5 * max(u, 0.0))) * step(0.0, u) * exp(-u / 0.13);
        float crescent = smoothstep(0.24, 0.1, ang) * exp(-(u + 0.02) * (u + 0.02) / 0.00014);
        float on = smoothstep(0.3, 0.6, belt);
        emit += (O3S * 0.9 + HA * 0.7) * crescent * on * 30.0;
        emit += HA * tail * on * 1.4;
        dust += (head * 60.0 + tail * 14.0) * on;
      }
    }
  }
  // The halo: older, slower gas, combed into rays.
  float outside = smoothstep(0.3, 2.2, x);
  emit += HA * outside * exp(-(r - Rs) / 0.17) * (0.06 + finger) * 0.22;
}

// The halo beyond the fine march: the same rays, thinning out.
vec3 halo(vec3 q) {
  float r = length(q);
  vec3 d = q / r;
  float c = d.y;
  float Rs = 0.6 * (1.0 + 0.5 * c * c);
  float rays = fbm(d * 17.0 + 3.0, 3);
  return HA * exp(-(r - Rs) / 0.17) * (0.06 + rays * rays * rays * 6.0) * 0.22 * smoothstep(R_OUT, R_OUT - 0.25, r);
}

// A thin shell of radius R and half-thickness w from an earlier ejection: the light of its two
// crossings, each weighted by the length of the ray inside it (longest where the ray grazes).
vec3 oldShell(vec3 ro, vec3 rd, float R, float w, float seed) {
  ro -= 0.05 * (hash31(seed) - 0.5);                // not quite concentric
  float b = dot(ro, rd);
  float b2 = dot(ro, ro) - b * b;
  float ro2 = (R + w) * (R + w), ri2 = (R - w) * (R - w);
  if (b2 >= ro2) return vec3(0.0);
  float path = sqrt(ro2 - b2) - sqrt(max(ri2 - b2, 0.0));
  float s = sqrt(max(R * R - b2, 0.0));
  vec3 col = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    vec3 d = normalize(ro + rd * (-b + (k == 0 ? -s : s)));
    // Broken into arcs, and brighter along the rays that reach it.
    float arcs = smoothstep(0.38, 0.62, fbm(d * 2.6 + seed, 3));
    float rays = fbm(d * 17.0 + 3.0, 3);
    col += (HA + O3 * 0.12) * arcs * (0.25 + 1.6 * rays * rays);
  }
  return col * path;
}

void marchSeg(vec3 ro, vec3 rd, float ta, float tb, int n, float jit, bool fine, inout vec3 col, inout float tr) {
  if (tb <= ta) return;
  float dt = (tb - ta) / float(n);
  for (int i = 0; i < 128; i++) {
    if (i >= n) break;
    vec3 q = ro + rd * (ta + (float(i) + jit) * dt);
    if (fine) {
      vec3 emit;
      float dust;
      gas(q, emit, dust);
      col += emit * tr * dt;
      tr *= exp(-dust * dt);
    } else {
      col += halo(q) * tr * dt;
    }
  }
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos / uExpand;
  vec3 col = vec3(0.0);
  vec2 hitO = raySphere(ro, rd, vec3(0.0), R_OUT);
  if (hitO.y > 0.0) {
    float jit = hash12(gl_FragCoord.xy + fract(uGTime) * 37.0);
    vec2 hitI = raySphere(ro, rd, vec3(0.0), R_IN);
    float tr = 1.0;
    float t0 = max(hitO.x, 0.0);
    if (hitI.y > 0.0) {
      marchSeg(ro, rd, t0, max(hitI.x, 0.0), 10, jit, false, col, tr);
      marchSeg(ro, rd, max(hitI.x, 0.0), hitI.y, 128, jit, true, col, tr);
      marchSeg(ro, rd, hitI.y, hitO.y, 10, jit, false, col, tr);
    } else {
      marchSeg(ro, rd, t0, hitO.y, 20, jit, false, col, tr);
    }
    col += oldShell(ro, rd, 1.2, 0.012, 1.0) * 0.5;
    col += oldShell(ro, rd, 1.42, 0.01, 5.0) * 0.28;
  }
  fragColor = vec4(col * uGain, 1.0);
}
