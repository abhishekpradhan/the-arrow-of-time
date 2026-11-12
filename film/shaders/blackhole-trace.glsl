// A Schwarzschild black hole with a thin accretion disk, ray traced along null geodesics.
//
// Every photon path lies in the plane through the hole's centre that contains the camera and
// the ray. In that plane, with u = 1/r and the angle phi swept around the hole, the path obeys
// the Binet equation of the Schwarzschild metric,
//
//     u'' + u = (3/2) rs u^2,
//
// which is integrated here with RK4 steps in phi. The disk lies in the plane y = 0, which cuts
// the orbital plane along a line through the centre: the path can only cross it at
// phi = phi0 + k pi, so each crossing is found exactly (a Hermite interpolation of u inside the
// step that spans it) instead of by testing positions. The first crossing draws the disk
// itself, the second its far side lifted over (or under) the shadow, the third and later ones
// the photon ring. Rays that reach u = 1/rs are captured; the rest leave along the direction
// where u falls to zero, which is where the sky is looked up.
//
// The disk's light is shifted by g = sqrt(1 - 3 rs / 2r) / (1 - Omega l), the redshift of an
// emitter on a circular orbit (Omega = sqrt(rs / 2 r^3)) for a photon whose angular momentum
// about the disk's axis is l per unit energy: the approaching side is brighter and bluer.
#include <noise>
#include <color>
#include <camera>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime;
uniform float uRs;        // Schwarzschild radius in world units (0: the hole is gone)
uniform float uDisk;      // disk brightness
uniform float uDiskOut;   // outer edge, in rs
uniform float uDiskHeat;  // temperature scale (1 = white-hot inside)
uniform float uDiskT;     // angle the innermost stable orbit has turned through (radians)
uniform float uDoppler;   // 0 = no beaming, 1 = the full relativistic factor
uniform float uHawking;   // radiance of the evaporating horizon
uniform float uHawkT;     // its colour temperature (K)
uniform float uHawkFill;  // how far the light reaches into the shadow from its rim (0..1)
uniform float uSky;       // brightness of the last embers behind the hole
uniform float uFlash;     // final flash amount (decays after the hole is gone)
uniform float uFlashR;    // radius of the flash's shell of light (world units)

const float RIN = 3.0;          // innermost stable circular orbit, in rs
const float BCRIT = 2.5980762;  // critical impact parameter (3 sqrt(3) / 2), in rs
const float HMAX = 0.05;        // RK4 step in phi
const int STEPS = 260;

// ---------------------------------------------------------------- the disk's texture
// Value noise around a circle: n cells per turn, a different pattern for every ring.
float arcNoise(float a, float n, float ring) {
  float x = a / TAU * n;
  float i = floor(x), f = x - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash12(vec2(mod(i, n), ring)), hash12(vec2(mod(i + 1.0, n), ring)), f);
}

// One octave of streaks: kr rings per rs, each turning rigidly at the Keplerian rate of its
// own radius, so the pattern shears for ever without winding up. cells = streaks per radian
// per rs of radius (so their length stays the same at every radius).
float streaks(float rr, float th, float kr, float cells, float seed) {
  float x = rr * kr;
  float i = floor(x), f = x - i;
  f = f * f * (3.0 - 2.0 * f);
  float r0 = max(i, 1.0) / kr, r1 = (i + 1.0) / kr;
  float a0 = th + pow(r0 / RIN, -1.5) * uDiskT;
  float a1 = th + pow(r1 / RIN, -1.5) * uDiskT;
  float n0 = max(floor(cells * r0 * TAU), 3.0), n1 = max(floor(cells * r1 * TAU), 3.0);
  return mix(arcNoise(a0, n0, i + seed), arcNoise(a1, n1, i + 1.0 + seed), f);
}

// Emission and opacity of the disk where a ray crosses it.
//   hp: crossing point, tdir: unit tangent of the photon path there, ly: the photon's angular
//   momentum about +y per unit energy, grav: sqrt(1 - rs / R) at the camera, order: 0 for the
//   direct image, 1+ for the lensed ones (which are compressed, so their detail is averaged).
vec4 diskAt(vec3 hp, vec3 tdir, float ly, float grav, float camR, int order) {
  float rr = length(hp.xz) / uRs;
  if (rr < 1.75 || rr > uDiskOut * 1.05) return vec4(0.0);
  float th = atan(hp.z, hp.x);
  // Footprint of a pixel on the disk along the radius, in rs: one pixel across the view,
  // stretched along the ray where it grazes the plane.
  float pix = 2.0 * uTanHalfFov / uRes.y * camR / uRs;
  vec3 radial = vec3(hp.x, 0.0, hp.z) / max(length(hp.xz), 1e-4);
  vec3 tp = vec3(tdir.x, 0.0, tdir.z);
  float along = abs(dot(tp, radial)) / max(length(tp), 1e-4);
  float fw = pix * mix(1.0, 1.0 / max(abs(tdir.y), 0.04), along);
  fw *= order == 0 ? 1.0 : order == 1 ? 1.6 : 25.0;

  // Large arcs push the rings in and out, so they are never perfect circles.
  float warp = streaks(rr, th, 0.45, 0.22, 91.0) - 0.5;
  // ... and a faint two-armed trailing spiral winds them, so the gas reads as falling in.
  float spiral = sin(2.0 * (th + 0.09 * uDiskT) - 6.5 * log(rr));
  float rw = rr + 0.6 * warp + 0.22 * spiral * smoothstep(3.0, 5.0, rr);
  float n = 0.0, wsum = 0.0, w, o;
  w = 0.42 * smoothstep(1.0, 0.45, fw * 1.1);  n += w * streaks(rw, th, 1.1, 0.3, 11.0);  wsum += w;
  w = 0.34 * smoothstep(1.0, 0.45, fw * 3.1);  n += w * streaks(rw, th, 3.1, 0.5, 37.0);  wsum += w;
  // The finer octaves are ridged: thin bright filaments rather than soft bands.
  w = 0.30 * smoothstep(1.0, 0.45, fw * 8.0);
  o = streaks(rw, th, 8.0, 0.5, 53.0);   n += w * (1.0 - abs(2.0 * o - 1.0)); wsum += w;
  w = 0.24 * smoothstep(1.0, 0.45, fw * 19.0);
  o = streaks(rw, th, 19.0, 0.8, 71.0);  n += w * (1.0 - abs(2.0 * o - 1.0)); wsum += w;
  n = wsum > 1e-3 ? mix(0.5, n / wsum, saturate(wsum * 2.2)) : 0.5;
  // Dark lanes between bright bands.
  float lanes = mix(0.5, vnoise(vec2(rw * 1.9, 7.3)), smoothstep(1.0, 0.4, fw * 1.9));
  float dens = saturate(0.5 + 2.1 * (n - 0.5) + 0.5 * (lanes - 0.5));

  // Thin-disk flux (Shakura-Sunyaev): zero at the innermost stable orbit, peaking at 1.36 RIN,
  // plus the faint gas that plunges from there to the horizon.
  float x = RIN / rr;
  float flux = rr > RIN ? pow(x, 3.0) * (1.0 - sqrt(x)) / 0.0567 : 0.0;
  flux += 0.16 * smoothstep(1.75, 2.9, rr) * (1.0 - smoothstep(3.0, 5.0, rr));
  float outer = smoothstep(uDiskOut * (1.0 + 0.12 * (n - 0.5)), uDiskOut * 0.6, rr);
  // Redshift: gravity and the orbital motion, for a photon of angular momentum ly.
  float om = sqrt(0.5 / (rr * rr * rr));
  float g = sqrt(max(1.0 - 1.5 / rr, 0.02)) / (max(1.0 - om * ly / uRs, 0.05) * grav);
  g = mix(1.0, g, uDoppler);
  // The plunging gas is on no circular orbit: it only reddens as it falls.
  g = mix(g, min(g, 0.8), smoothstep(3.3, 2.6, rr));
  // Bright filaments are hotter than the gas between them.
  float T = min(5200.0 * uDiskHeat * pow(max(flux, 1e-4), 0.36) * g * (0.86 + 0.3 * dens), 8400.0);
  float I = pow(max(flux, 0.0), 0.7) * outer * (0.1 + 2.5 * dens * dens * (0.6 + 0.4 * dens)) * pow(g, 3.4);
  float a = saturate(pow(max(flux, 0.0), 0.25) * outer * (0.5 + 0.7 * dens) * 1.25);
  return vec4(blackbody(T) * I * uDisk, a * saturate(uDisk * 3.0));
}

// ---------------------------------------------------------------- the sky
// The last embers on the celestial sphere: one star per cell of a 3D grid, kept where the
// cell lies in the thin shell around the sphere of radius sc, so there are no seams or poles.
vec3 emberSky(vec3 d, float pxAng) {
  vec3 col = vec3(0.0);
  for (int L = 0; L < 2; L++) {
    float sc = L == 0 ? 30.0 : 74.0;
    float sig = min(pxAng * (L == 0 ? 0.85 : 0.62), 0.14 / sc);
    vec3 p = d * sc, c0 = floor(p);
    for (int k = -1; k <= 1; k++)
      for (int j = -1; j <= 1; j++)
        for (int i = -1; i <= 1; i++) {
          vec3 c = c0 + vec3(float(i), float(j), float(k));
          vec4 h = hash43(c + 19.0 * float(L) + 5.0);
          vec3 sp = c + 0.5 + (h.xyz - 0.5) * 0.8;
          float rad = length(sp);
          if (abs(rad - sc) > 0.5 || h.w > (L == 0 ? 0.1 : 0.34)) continue;
          vec3 h2 = hash33(c + 41.0 + 7.0 * float(L));
          float dist = length(d - sp / rad);
          float mag = L == 0 ? 0.35 + 5.0 * pow(h2.x, 6.0) : 0.07 + 0.6 * pow(h2.x, 3.0);
          // Red dwarfs, and a few cooling white dwarfs.
          vec3 tint = blackbody(h2.z < 0.18 ? mix(6500.0, 9500.0, h2.y) : mix(2400.0, 4000.0, h2.y));
          col += tint * mag * exp(-0.5 * dist * dist / (sig * sig));
        }
  }
  return col;
}

// ---------------------------------------------------------------- one camera ray
vec3 trace(vec2 p) {
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  float pxAng = 2.0 * uTanHalfFov / uRes.y;
  float R = length(ro);
  vec3 e1 = ro / R;
  float ca = dot(rd, e1);
  vec3 perp = rd - ca * e1;
  float sa = max(length(perp), 1e-5);
  vec3 e2 = perp / sa;
  vec3 col = vec3(0.0);
  float trans = 1.0;
  vec3 dInf = rd;
  bool captured = false;
  float bImp = 1e9;   // impact parameter in rs (rays heading inwards)

  if (uRs > 1e-3) {
    float rs = uRs;
    float grav = sqrt(max(1.0 - rs / R, 1e-3));
    float ly = cross(ro, -rd).y / grav;
    if (ca < 0.0) bImp = R * sa / (grav * rs);
    float u = 1.0 / R, du = -u * ca / sa;
    // The disk plane crosses this orbital plane at phi0 + k pi.
    float nextC = mod(atan(-e1.y, e2.y), PI);
    if (nextC < 1e-4) nextC += PI;
    float phi = 0.0;
    int order = 0;
    bool done = false;
    for (int i = 0; i < STEPS; i++) {
      // Heading inwards almost radially, u grows fast in phi: bound its growth per step.
      float h = du > 0.0 ? min(HMAX, 0.2 * u / du) : HMAX;
      float k1 = du,                l1 = u * (1.5 * rs * u - 1.0);
      float ua = u + 0.5 * h * k1;
      float k2 = du + 0.5 * h * l1, l2 = ua * (1.5 * rs * ua - 1.0);
      float ub = u + 0.5 * h * k2;
      float k3 = du + 0.5 * h * l2, l3 = ub * (1.5 * rs * ub - 1.0);
      float uc = u + h * k3;
      float k4 = du + h * l3,       l4 = uc * (1.5 * rs * uc - 1.0);
      float u1 = u + h * (k1 + 2.0 * k2 + 2.0 * k3 + k4) / 6.0;
      float du1 = du + h * (l1 + 2.0 * l2 + 2.0 * l3 + l4) / 6.0;
      float phi1 = phi + h;
      if (phi1 >= nextC) {
        float s = (nextC - phi) / h, s2 = s * s, s3 = s2 * s;
        float ux = (2.0 * s3 - 3.0 * s2 + 1.0) * u + (s3 - 2.0 * s2 + s) * h * du
                 + (3.0 * s2 - 2.0 * s3) * u1 + (s3 - s2) * h * du1;
        if (ux > 0.0 && ux * rs < 1.0 && uDisk > 0.0) {
          float rc = 1.0 / ux;
          float dux = mix(du, du1, s);
          float cp = cos(nextC), sp = sin(nextC);
          vec3 er = cp * e1 + sp * e2, ep = -sp * e1 + cp * e2;
          vec3 tdir = normalize(-dux / (ux * ux) * er + rc * ep);
          vec4 d = diskAt(rc * er, tdir, ly, grav, R, order);
          col += trans * d.rgb;
          trans *= 1.0 - d.a;
        }
        order++;
        nextC += PI;
      }
      if (u1 <= 0.0) {
        float pe = phi + h * u / max(u - u1, 1e-9);
        dInf = cos(pe) * e1 + sin(pe) * e2;
        done = true;
        break;
      }
      if (u1 * rs >= 1.0) { captured = true; done = true; break; }
      if (trans < 0.003) { captured = true; done = true; break; }
      u = u1; du = du1; phi = phi1;
    }
    // Still circling the photon sphere after all those steps: as good as captured.
    if (!done) captured = true;

    // Hawking radiation: the quanta that escape leave from inside the critical impact
    // parameter, so the hole's own image glows, brightest at its rim.
    if (uHawking > 0.0 && ca < 0.0) {
      float x = bImp - BCRIT;
      float w = 0.16 + 2.5 * pxAng * R / rs;
      // Late on, when the hole is small and fiercely hot, the light spreads in from the rim
      // until its whole image is filled.
      float wIn = 0.5 * w + uHawkFill * BCRIT;
      float rim = x > 0.0 ? exp(-x / w) + 0.35 * exp(-x / (6.0 * w)) : exp(x / wIn);
      col += blackbody(uHawkT) * uHawking * rim;
    }
  }
  if (!captured && uSky > 0.0) col += trans * uSky * emberSky(normalize(dInf), pxAng);

  // The last flash: a point of light, and a thin shell of photons leaving at the speed of
  // light (a soap bubble seen from outside: brightest at its limb).
  if (uFlash > 0.0) {
    vec2 cp = rayPointDist(ro, rd, vec3(0.0));
    float dc = cp.x;
    float px = pxAng * R;
    float core = exp(-dc / (1.6 * px)) * 60.0 * uFlash + exp(-dc / (0.05 * R)) * 1.4 + exp(-dc / (0.2 * R)) * 0.2 * uFlash;
    float wS = 0.045 * uFlashR + 2.0 * px;
    float shell = dc < uFlashR
      ? wS / max(sqrt(max(uFlashR * uFlashR - dc * dc, 0.0)), wS)
      : exp(-(dc - uFlashR) / (0.4 * wS));
    col += vec3(0.86, 0.91, 1.0) * uFlash * (core + shell * 2.4 / (1.0 + uFlashR * uFlashR / (R * R) * 30.0));
  }
  return col;
}

void main() {
  vec2 p = centered(vUv, uAspect);
  // Four samples per pixel on a rotated grid: the filaments of the disk, its lensed images
  // and the photon ring are all finer than a pixel somewhere. Once the hole is gone the
  // picture is smooth and one sample is enough.
  vec3 col = vec3(0.0);
  if (uRs > 1e-3) {
    const vec2 OFFS[4] = vec2[4](vec2(0.125, 0.375), vec2(-0.375, 0.125), vec2(0.375, -0.125), vec2(-0.125, -0.375));
    for (int k = 0; k < 4; k++) col += trace(p + OFFS[k] / uRes.y);
    col *= 0.25;
  } else {
    col = trace(p);
  }
  fragColor = vec4(max(col, 0.0), 1.0);
}
