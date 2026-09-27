// Space: a Saturn V at night. Searchlights pick it out on the pad beside its red umbilical tower,
// liquid-oxygen vapour streaming down its flanks; then the engines light (cue launch), fire and
// steam billow out of the flame trench and turn night into day, and the rocket rises past the
// tower as the camera tilts up after it. Metres; the rocket stands on the y axis, the camera to +z.
#define MARCH_STEPS 140
#define SHADOW_STEPS 24
#include <noise>
#include <color>
#include <camera>
#include <sdf3>
#include <march>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uT;
uniform float uIgnite;     // seconds since ignition (< 0 before)
uniform float uLift;       // metres the rocket has risen

const float BASE = 12.0;           // bottom of the first stage, on the launcher's hold-downs
const vec3 FIRE = vec3(1.0, 0.62, 0.3);

// ---------------------------------------------------------------- the rocket
// Radius of the stack at height y above its base (the Saturn V profile, metres).
float stackRadius(float y) {
  if (y < 0.0) return 0.0;
  if (y < 47.0) return 5.05;                                    // S-IC and interstage
  if (y < 72.0) return 5.05;                                    // S-II
  if (y < 78.0) return mix(5.05, 3.3, (y - 72.0) / 6.0);        // adapter
  if (y < 96.0) return 3.3;                                     // S-IVB and instrument unit
  if (y < 104.0) return mix(3.3, 1.95, (y - 96.0) / 8.0);       // spacecraft adapter
  if (y < 111.0) return 1.95;                                   // service module
  if (y < 114.5) return mix(1.95, 0.3, (y - 111.0) / 3.5);      // command module
  return 0.0;
}

float rocket(vec3 p) {
  vec3 q = p - vec3(0.0, BASE + uLift, 0.0);
  if (q.y < -8.0 || q.y > 124.0) return max(abs(q.y - 58.0) - 66.0, length(q.xz) - 12.0) + 0.5;
  // Stack: a solid of revolution (bounded: the profile's slopes are gentle).
  float r = stackRadius(clamp(q.y, 0.0, 114.5));
  float body = max(length(q.xz) - r, max(-q.y, q.y - 114.5)) * 0.9;
  // Launch escape tower: a slim rod with its motor and nose.
  float les = sdCapsule(q, vec3(0.0, 114.5, 0.0), vec3(0.0, 123.0, 0.0), 0.35);
  // Four fins at the base, between the engine fairings.
  vec3 f = q;
  f.xz = abs(f.xz);
  f.xz = vec2(f.x + f.z, f.x - f.z) * 0.7071;
  float fin = max(sdBox(f - vec3(6.2, 3.5, 0.0), vec3(1.6, 3.5, 0.15)), (f.y - 7.0) + (f.x - 5.0) * 0.9);
  // Five F-1 engine bells below.
  float bells = 1e9;
  for (int i = 0; i < 5; i++) {
    vec2 c = i == 4 ? vec2(0.0) : vec2(cos(float(i) * 1.5708 + 0.785), sin(float(i) * 1.5708 + 0.785)) * 2.9;
    vec3 b = q - vec3(c.x, -3.2, c.y);
    bells = min(bells, sdCone(b, 3.2, 1.8, 0.8));
  }
  return min(min(body, les), min(fin, bells));
}

// Black and white markings: the roll pattern at the top of the first stage, bands, and the
// checkered aft skirt of the third stage.
float marking(vec3 p) {
  vec3 q = p - vec3(0.0, BASE + uLift, 0.0);
  float quad = mod(floor((atan(q.z, q.x) + 3.1416) / 1.5708 + 0.5), 2.0);
  float y = q.y;
  if (y < 4.0) return 1.0;                                       // black base
  if (y > 36.0 && y < 42.0) return quad;                         // S-IC roll pattern
  if (y > 45.0 && y < 47.0) return 1.0;
  if (y > 70.5 && y < 72.0) return 1.0;
  if (y > 78.0 && y < 84.0) return quad;                         // S-IVB aft skirt
  return 0.0;
}

// ---------------------------------------------------------------- tower, launcher, pad
float tower(vec3 p) {
  vec3 q = p - vec3(20.0, 0.0, 0.0);
  if (q.y > 130.0 || abs(q.x) > 26.0 || abs(q.z) > 9.0) return max(max(q.y - 130.0, abs(q.x) - 25.0), abs(q.z) - 8.0) + 0.3;
  // A square lattice 12 m on a side: corner posts, a floor every 6 m, cross bracing.
  vec3 a = abs(q) - vec3(6.0, 0.0, 6.0);
  float posts = length(max(abs(vec2(a.x, a.z)), 0.0) - vec2(0.0)) - 0.5;
  posts = max(min(length(vec2(abs(q.x) - 6.0, abs(q.z) - 6.0)) - 0.45, 1e9), q.y - 124.0);
  float floors = max(max(abs(fract(q.y / 6.0) - 0.5) * 6.0 - 2.75, max(abs(q.x), abs(q.z)) - 6.3), -(max(abs(q.x), abs(q.z)) - 5.7));
  float faceX = abs(abs(q.x) - 6.0) - 0.15;
  float faceZ = abs(abs(q.z) - 6.0) - 0.15;
  float diag = abs(fract((q.y + q.z) / 6.0) - 0.5) * 4.24 - 0.12;
  float diag2 = abs(fract((q.y - q.x) / 6.0) - 0.5) * 4.24 - 0.12;
  float brace = min(max(max(faceX, diag), abs(q.z) - 6.0), max(max(faceZ, diag2), abs(q.x) - 6.0));
  float lattice = min(posts, max(min(floors, brace), q.y - 124.0));
  // Swing arms reaching across to the rocket (they swing clear at liftoff).
  float arms = 1e9;
  float swing = clamp(uIgnite * 1.5, 0.0, 1.0) * 1.2;
  for (int i = 0; i < 5; i++) {
    float y = 20.0 + 18.0 * float(i);
    vec3 s = q - vec3(-6.0, y, 0.0);
    s.xz = rot2(swing) * s.xz;
    arms = min(arms, sdBox(s - vec3(-4.5, 0.0, 0.0), vec3(4.5, 1.1, 1.3)));
  }
  // The hammerhead crane on top.
  float crane = sdBox(q - vec3(-4.0, 126.0, 0.0), vec3(12.0, 1.2, 1.5));
  return min(min(lattice, arms), crane) ;
}

float launcher(vec3 p) {
  // The mobile launcher's deck, with the square exhaust hole under the engines.
  float deck = sdBox(p - vec3(10.0, 4.0, 0.0), vec3(25.0, 4.0, 22.0));
  float hole = sdBox(p - vec3(0.0, 4.0, 0.0), vec3(8.0, 5.0, 8.0));
  float holds = sdBox(vec3(abs(p.x) - 6.0, p.y - 10.0, abs(p.z) - 6.0), vec3(0.8, 2.0, 0.8));
  return min(max(deck, -hole), holds);
}

float ground(vec3 p) { return p.y + 0.2 * fbm(p.xz * 0.02, 2); }

float mapD(vec3 p) {
  float d = min(rocket(p), min(tower(p), launcher(p)));
  return min(d, ground(p));
}

// ---------------------------------------------------------------- volumes
// Searchlights on the ground, aimed at the rocket.
const vec3 LIGHTS[3] = vec3[3](vec3(-75.0, 1.0, 55.0), vec3(85.0, 1.0, 70.0), vec3(-25.0, 1.0, 120.0));

// Steam and exhaust from the flame trench: two banks rolling out along the ground to either
// side, and a column rising round the pad once the rocket climbs. The density thresholds shape
// plus noise, so the billows have edges; the noise swells with the cloud, so lobes grow as they
// roll out. `oct` trades detail for speed (the lighting taps need little).
float clouds(vec3 p, float tau, int oct) {
  if (tau <= 0.0) return 0.0;
  float shape = -1.0;
  for (int s = -1; s <= 1; s += 2) {
    float reach = 30.0 + 120.0 * sqrt(tau);
    vec3 c = vec3(float(s) * reach * 0.6, 10.0 + 9.0 * tau, -10.0);
    vec3 q = (p - c) / vec3(reach * 0.6, 16.0 + 20.0 * tau, 40.0 + 20.0 * tau);
    shape = max(shape, 1.0 - length(q));
  }
  // (Signed like the banks: negative outside, so it is absent above its top and before it forms.)
  float colTop = 20.0 + 25.0 * tau;
  float column = min(1.0 - length(p.xz) / (24.0 + 10.0 * tau), (colTop - p.y) / colTop);
  shape = max(shape, column - 1.5 * (1.0 - smoothstep(0.5, 2.0, tau)));
  // (It pours out of the trench in the first moments rather than appearing whole.)
  shape -= 0.6 * (1.0 - smoothstep(0.0, 0.8, tau));
  if (shape < -0.4) return 0.0;
  vec3 np = p * (0.035 / (1.0 + 0.25 * tau)) + vec3(0.0, -0.15 * tau, 0.0);
  return smoothstep(0.0, 0.3, shape + 1.4 * (fbm(np, oct) - 0.5));
}

// Liquid-oxygen boil-off streaming from vents and drifting down the flanks.
float vapour(vec3 p) {
  float v = 0.0;
  for (int i = 0; i < 3; i++) {
    vec3 src = vec3(4.0 + 1.0 * float(i), BASE + uLift + 44.0 + 26.0 * float(i) * 0.6, 3.0 - 2.0 * float(i));
    vec3 dir = normalize(vec3(0.6, -1.0, 0.25));
    float s = clamp(dot(p - src, dir), 0.0, 60.0);
    vec3 ax = src + dir * s;
    float r = 1.0 + 0.25 * s;
    float n = fbm(p * 0.25 + vec3(0.0, uT * 1.2, 0.0), 3);
    v += smoothstep(r, 0.0, length(p - ax)) * smoothstep(60.0, 5.0, s) * n;
  }
  return v * step(uIgnite, 1.0);
}

vec3 sky(vec3 rd) {
  float e = max(rd.y, 0.0);
  vec3 col = mix(vec3(0.03, 0.04, 0.08), vec3(0.005, 0.008, 0.02), smoothstep(0.0, 0.5, e));
  float star = smoothstep(0.993, 1.0, hash13(floor(rd * 600.0))) * smoothstep(0.05, 0.3, e);
  return col + vec3(0.7, 0.75, 1.0) * star * 0.4;
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  float pix = pixelAngle(uRes.y);
  float tau = max(uIgnite, 0.0);
  bool lit = uIgnite > 0.0;
  // The fire at the base: its light floods everything once the engines run.
  vec3 firePos = vec3(0.0, BASE + uLift - 12.0, 0.0);
  float firePower = lit ? 3.5e5 * smoothstep(0.0, 0.6, tau) : 0.0;
  vec3 col = sky(rd) + FIRE * firePower * 2e-8 * exp(-max(rd.y, 0.0) * 4.0);
  float t = march(ro, rd, 1.0, 3000.0, pix * 0.5);
  float tEnd = t > 0.0 ? t : 3000.0;
  if (t > 0.0) {
    vec3 pos = ro + rd * t;
    vec3 n = calcNormal(pos, max(0.005, t * pix));
    float dR = rocket(pos), dT = tower(pos), dL = launcher(pos), dG = ground(pos);
    float m = min(min(dR, dT), min(dL, dG));
    vec3 alb;
    if (m == dR) alb = marking(pos) > 0.5 ? vec3(0.05) : vec3(0.85);
    else if (m == dT) alb = vec3(0.45, 0.1, 0.07);
    else if (m == dL) alb = vec3(0.25, 0.25, 0.26);
    else alb = vec3(0.2, 0.2, 0.18) * (0.8 + 0.3 * fbm(pos.xz * 0.05, 3));
    // Searchlights (cool xenon white), each with its own shadows.
    vec3 c = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      vec3 l = LIGHTS[i] - pos;
      float r2 = dot(l, l);
      vec3 ld = l * inversesqrt(r2);
      // (Stop short of the lamp: it stands on the ground.)
      float sh = softShadow(pos + n * 0.05, ld, 0.2, sqrt(r2) - 6.0, 20.0);
      c += alb * vec3(0.85, 0.9, 1.0) * 9e3 * max(dot(n, ld), 0.0) / r2 * sh;
    }
    // Fire from below.
    vec3 lf = firePos - pos;
    float rf2 = dot(lf, lf) + 100.0;
    c += alb * FIRE * firePower * max(dot(n, normalize(lf)), 0.0) / rf2;
    c += alb * vec3(0.01, 0.012, 0.02);
    col = c;
    col = mix(col, vec3(0.02, 0.025, 0.04) + FIRE * firePower * 1e-8, 1.0 - exp(-t * 0.0012));
  }
  // Participating media, front to back: searchlight beams in the humid air, vapour, the flame,
  // exhaust clouds. One march, jittered, through the box around the pad that holds them all
  // (it grows upwards with the flame).
  float jit = hash12(gl_FragCoord.xy);
  vec3 rdn = mix(rd, vec3(1e-6), step(abs(rd), vec3(1e-6)));
  vec3 ba = (vec3(-360.0, -5.0, -170.0) - ro) / rdn, bb = (vec3(360.0, max(230.0, BASE + uLift + 10.0), 130.0) - ro) / rdn;
  vec3 bmin = min(ba, bb), bmax = max(ba, bb);
  float m0 = clamp(max(max(bmin.x, bmin.y), bmin.z), 0.0, tEnd);
  float m1 = clamp(min(min(bmax.x, bmax.y), bmax.z), m0, tEnd);
  const int N = 56;
  float dt = (m1 - m0) / float(N);
  vec3 acc = vec3(0.0);
  float T = 1.0;
  for (int i = 0; i < N; i++) {
    if (dt <= 0.0) break;
    vec3 q = ro + rd * (m0 + (float(i) + jit) * dt);
    // Beams: narrow cones from each light towards the rocket's middle.
    float beam = 0.0;
    for (int k = 0; k < 3; k++) {
      vec3 axis = normalize(vec3(0.0, 55.0 + uLift * 0.5, 0.0) - LIGHTS[k]);
      vec3 v = q - LIGHTS[k];
      float along = dot(v, axis);
      float off = length(v - axis * along);
      beam += along > 0.0 ? exp(-pow(off / (0.9 + 0.035 * along), 2.0)) * 0.0016 * smoothstep(4.0, 40.0, along) * smoothstep(420.0, 200.0, along) : 0.0;
    }
    acc += T * vec3(0.8, 0.85, 1.0) * beam * dt * (1.0 - smoothstep(0.0, 1.5, tau));
    // The engines' flame: a blinding column below the bells, longer once the rocket is up.
    float flame = 0.0;
    if (lit) {
      float below = BASE + uLift - 6.0 - q.y;
      float L = 40.0 + 60.0 * smoothstep(0.0, 1.0, tau) + uLift * 0.45;
      float u = clamp(below / L, 0.0, 1.0);
      float width = 3.0 + 7.0 * u;
      flame = step(0.0, below) * exp(-dot(q.xz, q.xz) / (width * width)) * (1.0 - u) * (1.0 - u) * smoothstep(0.0, 0.4, tau);
      // White-hot at the nozzles, yellow, then orange down the plume.
      vec3 fc = mix(vec3(1.0, 0.92, 0.75), vec3(1.0, 0.5, 0.18), smoothstep(0.0, 0.6, u));
      acc += T * fc * flame * 1.6 * dt;
    }
    float vp = vapour(q);
    float cl = clouds(q, tau, 5);
    float dens = vp * 0.03 + cl * 0.045 + flame * 0.02;
    if (dens > 0.001) {
      float a = 1.0 - exp(-dens * dt);
      vec3 cc = vec3(0.5, 0.52, 0.55) * 0.25;
      if (cl > vp) {
        // Steam lit by the fire at its foot: two taps towards the fire estimate how much cloud
        // shadows this point, so faces turned to the fire blaze and the far sides and tops fall
        // into shadow. Where the fire is brightest the light turns from orange to white.
        vec3 lf = firePos - q;
        float r2 = dot(lf, lf);
        vec3 ld = lf * inversesqrt(r2);
        float occ = clouds(q + ld * 10.0, tau, 3) * 10.0 + clouds(q + ld * 28.0, tau, 3) * 18.0;
        float lit = exp(-occ * 0.09);
        float fireLight = firePower / (r2 + 400.0) * 0.018;
        vec3 hot = mix(vec3(1.0, 0.5, 0.2), vec3(1.0, 0.86, 0.66), smoothstep(0.3, 2.5, fireLight));
        // (Light scattered deep inside comes out redder; the night fills the shadows with blue.)
        cc = vec3(0.8, 0.78, 0.76) * (fireLight * (hot * lit + vec3(0.9, 0.35, 0.12) * 0.1 * (1.0 - lit)) + vec3(0.025, 0.032, 0.055));
      }
      acc += T * a * cc;
      T *= 1.0 - a;
      if (T < 0.01) break;
    }
  }
  col = col * T + acc;
  fragColor = vec4(col, 1.0);
}
