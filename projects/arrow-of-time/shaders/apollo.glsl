// The Moon, 1969: the lunar module on the Sea of Tranquility under a low sun. An astronaut steps
// off the footpad (cue moonStep) and his boot presses its tread into the regolith; the camera
// cranes back to the lander, the flag and the Earth hanging in the black sky (the Earth itself is
// drawn beforehand by the Planet component; this pass leaves the sky transparent).
// Metres; the lander stands at the origin with its ladder facing +z; y up.
#define MARCH_STEPS 160
#define SHADOW_STEPS 64
#define SHADOW_MIN_STEP 0.012
#include <noise>
#include <color>
#include <camera>
#include <sdf3>
#include <march>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uT;
uniform float uStep;       // seconds since the boot touched down (< 0 before)
uniform vec3 uSun;

const vec3 SUN_COL = vec3(1.0, 0.98, 0.95) * 3.0;
const vec3 FOOT = vec3(0.62, 0.0, 5.55);     // where the boot comes down

// ---------------------------------------------------------------- the regolith
float crater(vec2 p, vec2 c, float r) {
  float d = length(p - c) / r;
  // Bowl, raised rim, and a gentle fade outside.
  return d < 1.0 ? -0.22 * r * (1.0 - d * d) + 0.08 * r * d * d * d * d : 0.08 * r * exp(-(d - 1.0) * 4.0);
}

float craters(vec2 p, float cell, float rMax, float seed) {
  vec2 id0 = floor(p / cell);
  float h = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = id0 + vec2(i, j);
      vec3 k = hash32(id + seed);
      if (k.z < 0.45) continue;
      vec2 c = (id + 0.2 + 0.6 * k.xy) * cell;
      h += crater(p, c, rMax * (0.3 + 0.7 * k.z * k.z));
    }
  }
  return h;
}

// The bootprint: the A7L sole's tread, pressed in once the boot has lifted away.
float bootprint(vec2 p) {
  vec2 q = p - FOOT.xz - vec2(0.0, 0.02);
  q = rot2(-0.12) * q;
  float sole = sdRoundBox(q, vec2(0.075, 0.16), 0.06);
  float tread = 0.5 + 0.5 * cos(q.y * 110.0);
  return smoothstep(0.01, -0.01, sole) * (0.03 + 0.012 * tread);
}

float ground(vec2 p) {
  float h = 0.35 * fbm(p * 0.05, 3) - 0.2;
  h += craters(p, 22.0, 7.0, 1.0) + craters(p, 6.0, 1.6, 7.0) + craters(p, 1.8, 0.45, 13.0);
  // Keep the ground level under the lander and around the step.
  float level = smoothstep(9.0, 4.0, length(p - vec2(0.0, 1.5)));
  h = mix(h, 0.0, level);
  // Fine regolith and a scatter of small rocks.
  h += 0.012 * fbm(p * 3.0, 3);
  vec2 rid = floor(p / 0.9);
  vec3 rk = hash32(rid + 31.0);
  float rr = 0.05 + 0.08 * rk.z;
  float rd2 = length(p - (rid + 0.2 + 0.6 * rk.xy) * 0.9) / rr;
  // (Irregular: the outline and the top are broken up by noise.)
  rd2 += 0.35 * gnoise(p * 9.0 + rk.xy * 20.0);
  h += rk.z > 0.9 ? rr * 0.55 * sqrt(max(1.0 - rd2 * rd2, 0.0)) * (0.8 + 0.4 * gnoise(p * 17.0)) : 0.0;
  if (uStep > 0.0) h -= bootprint(p) * smoothstep(0.0, 0.25, uStep);
  return h;
}

// ---------------------------------------------------------------- the lunar module
// Materials: 1 gold foil, 2 aluminium and grey panels, 3 black, 4 struts.
float lander(vec3 p, out float mat) {
  mat = 2.0;
  if (length(p - vec3(0.0, 3.0, 0.0)) > 7.5) return length(p - vec3(0.0, 3.0, 0.0)) - 7.0;
  // Descent stage: an octagonal box wrapped in crinkled gold foil.
  vec3 q = p - vec3(0.0, 2.1, 0.0);
  vec2 o = abs(q.xz);
  float oct = max(max(o.x, o.y), (o.x + o.y) * 0.7071) - 2.05;
  float descent = max(oct, abs(q.y) - 0.85);
  // Ascent stage: a faceted cabin with its front face angled, on top.
  vec3 a = p - vec3(0.0, 3.85, 0.25);
  float cabin = sdBox(a, vec3(1.45, 0.9, 1.1));
  cabin = max(cabin, dot(a, normalize(vec3(0.0, 0.55, 1.0))) - 0.95);     // sloped front
  cabin = max(cabin, dot(vec3(abs(a.x), a.y, a.z), normalize(vec3(1.0, 0.0, 0.45))) - 1.45);
  float tank = sdCylinder(p - vec3(-1.55, 3.7, -0.2), vec3(-0.4, 0.0, 0.0), vec3(0.4, 0.0, 0.0), 0.6);
  float rear = sdBox(p - vec3(0.0, 3.9, -1.25), vec3(1.2, 0.8, 0.4));
  // Docking tunnel, antennas, the S-band dish on its boom, the rendezvous radar.
  float tunnel = sdCylinder(p - vec3(0.0, 4.75, 0.0), 0.42, 0.2);
  float mast = sdCapsule(p, vec3(0.9, 4.6, -0.8), vec3(1.4, 5.5, -1.2), 0.04);
  float dish = max(sdSphere(p - vec3(1.4, 5.65, -1.2), 0.45), -sdSphere(p - vec3(1.4, 5.85, -1.1), 0.42));
  float radar = sdSphere(p - vec3(0.0, 4.65, 1.25), 0.3);
  // RCS thruster quads on short booms at the cabin's corners.
  float rcs = 1e9;
  for (int i = 0; i < 4; i++) {
    vec2 c = vec2(i < 2 ? 1.7 : -1.7, (i == 0 || i == 3) ? 1.25 : -0.95);
    vec3 r = p - vec3(c.x, 4.35, c.y);
    rcs = min(rcs, sdBox(r, vec3(0.16)));
    rcs = min(rcs, sdCapsule(r, vec3(0.0, -0.32, 0.0), vec3(0.0, 0.32, 0.0), 0.05));
  }
  float ascent = min(min(cabin, tank), min(rear, tunnel));
  // The porch and the hatch in the front face.
  float porch = sdBox(p - vec3(0.0, 2.95, 2.25), vec3(0.45, 0.04, 0.35));
  // Landing legs: primary struts out to the footpads, secondary struts, pads dug in a little.
  float legs = 1e9, pads = 1e9;
  for (int i = 0; i < 4; i++) {
    float ang = float(i) * 1.5708;
    vec2 dir = vec2(sin(ang), cos(ang));
    vec3 foot = vec3(dir.x * 4.6, 0.12, dir.y * 4.6);
    vec3 top = vec3(dir.x * 2.0, 2.7, dir.y * 2.0);
    legs = min(legs, sdCapsule(p, top, foot + vec3(0.0, 0.25, 0.0), 0.1));
    vec2 side = vec2(dir.y, -dir.x) * 1.2;
    legs = min(legs, sdCapsule(p, vec3(dir.x * 2.0 + side.x, 1.35, dir.y * 2.0 + side.y), foot + vec3(0.0, 0.5, 0.0), 0.04));
    legs = min(legs, sdCapsule(p, vec3(dir.x * 2.0 - side.x, 1.35, dir.y * 2.0 - side.y), foot + vec3(0.0, 0.5, 0.0), 0.04));
    pads = min(pads, sdCone(p - foot, 0.12, 0.47, 0.33));
  }
  // The ladder down the front leg: two rails and rungs.
  vec3 top = vec3(0.0, 2.9, 2.0), foot = vec3(0.0, 0.4, 4.4);
  float rails = min(sdCapsule(p, top + vec3(0.33, 0.0, 0.0), foot + vec3(0.33, 0.0, 0.0), 0.025), sdCapsule(p, top - vec3(0.33, 0.0, 0.0), foot - vec3(0.33, 0.0, 0.0), 0.025));
  float rungs = 1e9;
  if (abs(p.x) < 0.5 && p.z > 1.8 && p.z < 4.6) {
    for (int i = 1; i < 10; i++) {
      vec3 c = mix(top, foot, float(i) / 10.0);
      rungs = min(rungs, sdCapsule(p, c - vec3(0.33, 0.0, 0.0), c + vec3(0.33, 0.0, 0.0), 0.018));
    }
  }
  float ladder = min(rails, rungs);
  float d = min(min(descent, ascent), min(min(legs, pads), min(ladder, porch)));
  d = min(d, min(min(mast, dish), min(radar, rcs)));
  if (descent <= d) mat = 1.0;
  else if (legs <= d || ladder <= d || pads <= d) mat = 4.0;
  else if (rcs <= d || mast <= d) mat = 3.0;
  return d;
}

// ---------------------------------------------------------------- the astronaut
// Standing on the footpad of the front leg, right hand on the ladder rail, left boot stepping down.
float astronaut(vec3 p, out float mat) {
  mat = 0.0;   // 0 suit, 1 visor, 2 boots and gloves, 3 backpack
  vec3 base = vec3(0.22, 0.24, 4.95);
  vec3 q = p - base;
  if (length(q - vec3(0.0, 0.9, 0.0)) > 1.6) return length(q - vec3(0.0, 0.9, 0.0)) - 1.4;
  q.xz = rot2(3.1416) * q.xz;                           // facing +z, away from the lander
  // Legs: the right on the pad, the left reaching down until the boot meets the ground.
  vec3 hipR = vec3(-0.12, 0.92, 0.0), hipL = vec3(0.12, 0.92, 0.0);
  vec3 down = FOOT - base + vec3(0.0, 0.08, 0.0);
  down.xz = rot2(3.1416) * down.xz;
  vec3 footL = mix(vec3(0.2, 0.3, -0.35), down, smoothstep(-0.9, 0.0, uStep));
  vec3 kneeL = mix(hipL, footL, 0.5) + vec3(0.0, 0.12, -0.12);
  vec3 kneeR = vec3(-0.13, 0.5, -0.05);
  float legs = min(min(sdTaper(q, hipR, kneeR, 0.12, 0.1), sdTaper(q, kneeR, vec3(-0.13, 0.1, 0.0), 0.1, 0.085)),
                   min(sdTaper(q, hipL, kneeL, 0.12, 0.1), sdTaper(q, kneeL, footL + vec3(0.0, 0.1, 0.0), 0.1, 0.085)));
  float boots = min(sdRoundBox(q - vec3(-0.13, 0.06, -0.05), vec3(0.09, 0.07, 0.16), 0.04),
                    sdRoundBox(q - footL - vec3(0.0, 0.06, -0.05), vec3(0.09, 0.07, 0.16), 0.04));
  // Torso, chest controls, backpack.
  // Torso: broad at the shoulders, narrowing to the waist; the chest control box; the life-support
  // backpack, as tall as the torso.
  float torso = smin(sdEllipsoid(q - vec3(0.0, 1.3, 0.0), vec3(0.25, 0.26, 0.17)), sdEllipsoid(q - vec3(0.0, 1.0, 0.0), vec3(0.19, 0.2, 0.15)), 0.08);
  float chest = sdRoundBox(q - vec3(0.0, 1.18, -0.17), vec3(0.1, 0.06, 0.04), 0.015);
  float pack = sdRoundBox(q - vec3(0.0, 1.3, 0.27), vec3(0.24, 0.33, 0.12), 0.05);
  // Helmet with its gold visor facing forward.
  vec3 h = q - vec3(0.0, 1.73, -0.03);
  float helmet = sdSphere(h, 0.2);
  // The gold visor covers the face; the white shell shows around it.
  float visor = max(sdSphere(h, 0.207), 0.62 - dot(normalize(h), normalize(vec3(0.0, -0.12, -1.0))));
  // Arms: right up to the ladder rail, left out for balance.
  vec3 shR = vec3(-0.3, 1.45, 0.0), shL = vec3(0.3, 1.45, 0.0);
  vec3 handR = vec3(-0.34, 1.35, 0.42), handL = vec3(0.52, 1.0, -0.2);
  float arms = min(min(sdTaper(q, shR, vec3(-0.4, 1.15, 0.2), 0.085, 0.07), sdTaper(q, vec3(-0.4, 1.15, 0.2), handR, 0.07, 0.06)),
                   min(sdTaper(q, shL, vec3(0.48, 1.18, 0.0), 0.085, 0.07), sdTaper(q, vec3(0.48, 1.18, 0.0), handL, 0.07, 0.06)));
  float gloves = min(sdSphere(q - handR, 0.07), sdSphere(q - handL, 0.07));
  float suit = smin(min(legs, torso), min(arms, sdSphere(q - vec3(0.0, 1.56, 0.0), 0.13)), 0.04);
  float d = min(min(suit, helmet), min(min(boots, gloves), min(pack, chest)));
  d = min(d, visor);
  if (visor <= d + 1e-4) mat = 1.0;
  else if (boots <= d + 1e-4 || gloves <= d + 1e-4) mat = 2.0;
  else if (pack <= d + 1e-4 || chest <= d + 1e-4) mat = 3.0;
  return d;
}

// ---------------------------------------------------------------- the flag
float flag(vec3 p, out vec2 uv) {
  vec3 base = vec3(-3.2, 0.0, 3.6);
  vec3 q = p - base;
  uv = vec2(0.0);
  q.xz = rot2(0.35) * q.xz;
  float pole = sdCapsule(q, vec3(0.0), vec3(0.0, 2.45, 0.0), 0.02);
  float bar = sdCapsule(q, vec3(0.0, 2.4, 0.0), vec3(1.3, 2.4, 0.0), 0.012);
  // The cloth hangs from the crossbar with the ripples it was folded into.
  vec3 c = q - vec3(0.65, 2.4 - 0.4, 0.0);
  float wave = 0.04 * sin(q.x * 9.0) * smoothstep(0.0, 0.3, q.x);
  float cloth = sdBox(vec3(c.x, c.y, c.z - wave), vec3(0.65, 0.4, 0.008)) * 0.7;
  uv = vec2(q.x / 1.3, (2.4 - q.y) / 0.8);
  return min(min(pole, bar), cloth);
}

vec3 flagColor(vec2 uv) {
  float stripe = mod(floor(uv.y * 13.0), 2.0);
  vec3 c = stripe < 0.5 ? vec3(0.55, 0.06, 0.07) : vec3(0.9);
  if (uv.x < 0.4 && uv.y < 7.0 / 13.0) {
    c = vec3(0.07, 0.1, 0.3);
    vec2 s = fract(uv * vec2(15.0, 12.0)) - 0.5;
    c = mix(c, vec3(0.9), smoothstep(0.2, 0.1, length(s)));
  }
  return c;
}

// ---------------------------------------------------------------- the scene
float mapD(vec3 p) {
  float m;
  vec2 uv;
  float d = p.y - ground(p.xz);
  d *= 0.8;
  d = min(d, lander(p, m));
  d = min(d, astronaut(p, m));
  d = min(d, flag(p, uv));
  return d;
}

// Dust kicked up by the boot: grains flying out on ballistic arcs (no air to hold them up).
vec4 dust(vec3 ro, vec3 rd, float tmax) {
  if (uStep < 0.0 || uStep > 1.6) return vec4(0.0);
  vec3 acc = vec3(0.0);
  float cover = 0.0;
  for (int i = 0; i < 70; i++) {
    vec3 h = hash31(float(i) * 7.13);
    float ang = h.x * 6.2832;
    float v = 0.6 + 0.9 * h.y;
    float el = 0.25 + 0.5 * h.z;
    vec3 vel = vec3(cos(ang) * cos(el), sin(el), sin(ang) * cos(el)) * v;
    float t = uStep;
    vec3 pos = FOOT + vec3(0.0, 0.02, 0.0) + vel * t - vec3(0.0, 0.81 * t * t, 0.0);   // lunar gravity 1.62/2
    if (pos.y < 0.0) continue;
    vec2 cp = rayPointDist(ro, rd, pos);
    if (cp.x > tmax) continue;
    float r = 0.012 + 0.008 * h.x;
    float a = exp(-cp.y * cp.y / (r * r)) * 0.9 * smoothstep(1.6, 0.8, uStep);
    acc += (1.0 - cover) * a * vec3(0.6, 0.57, 0.52) * SUN_COL * 0.35;
    cover += (1.0 - cover) * a;
  }
  return vec4(acc, cover);
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  float pix = pixelAngle(uRes.y);
  vec3 sun = normalize(uSun);
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  float t = march(ro, rd, 0.05, 400.0, pix * 0.5);
  if (t > 0.0) {
    alpha = 1.0;
    vec3 pos = ro + rd * t;
    vec3 n = calcNormal(pos, max(0.0008, t * pix));
    float mL, mA;
    vec2 uv;
    float dL = lander(pos, mL), dA = astronaut(pos, mA), dF = flag(pos, uv), dG = pos.y - ground(pos.xz);
    float m = min(min(dL, dA), min(dF, dG));
    vec3 alb;
    float spec = 0.0, gloss = 20.0;
    vec3 refl = vec3(0.0);
    if (m == dL) {
      if (mL == 1.0) {
        // Crinkled Kapton foil: amber gold, glinting from a thousand facets.
        vec3 cn = normalize(n + 0.12 * vec3(gnoise(pos.xy * 14.0), gnoise(pos.yz * 14.0), gnoise(pos.zx * 14.0)));
        alb = vec3(0.5, 0.33, 0.1) * (0.8 + 0.4 * fbm(pos.xy * 6.0 + pos.zy * 6.0, 3));
        n = cn;
        spec = 0.6;
        gloss = 22.0;
      } else if (mL == 3.0) alb = vec3(0.06);
      else if (mL == 4.0) alb = vec3(0.55, 0.52, 0.45);
      else {
        // Ascent stage: grey and black panels, the two triangular windows.
        float panel = step(0.5, fract(pos.x * 1.1 + floor(pos.y * 1.6) * 0.37));
        alb = mix(vec3(0.62, 0.63, 0.64), vec3(0.45, 0.46, 0.47), panel);
        alb = mix(alb, vec3(0.08), step(pos.y, 3.1) * step(abs(pos.x), 1.5));
        vec3 w = pos - vec3(0.0, 4.2, 1.1);
        if (abs(abs(w.x) - 0.55) < 0.22 && w.y > -0.15 && w.y < 0.2 - 0.9 * (abs(abs(w.x) - 0.55))) alb = vec3(0.02);
        spec = 0.3;
      }
    } else if (m == dA) {
      if (mA == 1.0) {
        // Gold visor: a mirror of the grey plain and the black sky.
        // Gold visor: a curved mirror of the grey plain, the black sky and the Sun.
        vec3 r = reflect(rd, n);
        vec3 env = mix(vec3(0.16, 0.155, 0.145) * SUN_COL * 0.35, vec3(0.0), smoothstep(-0.08, 0.02, r.y));
        refl = (env + SUN_COL * 8.0 * pow(max(dot(r, sun), 0.0), 600.0)) * vec3(1.0, 0.75, 0.35) * 0.9;
        refl += vec3(1.0, 0.78, 0.4) * 0.05;
        alb = vec3(0.02);
      } else if (mA == 2.0) alb = vec3(0.35, 0.36, 0.38);
      else if (mA == 3.0) alb = vec3(0.8, 0.8, 0.78);
      else {
        alb = vec3(0.86, 0.86, 0.84) * (0.9 + 0.1 * fbm(pos.xy * 12.0, 3));
        // Convolute rings at knees and elbows, and the red and blue hose connectors on the chest.
        vec3 lq = pos - vec3(0.22, 0.24, 4.95);
        float ring = 0.5 + 0.5 * sin(pos.y * 90.0);
        float joint = smoothstep(0.12, 0.0, abs(lq.y - 0.5)) + smoothstep(0.1, 0.0, abs(lq.y - 1.15)) * step(0.3, abs(lq.x));
        alb *= 1.0 - 0.25 * ring * min(joint, 1.0);
        vec3 cq = lq - vec3(0.0, 1.08, 0.2);
        if (length(cq - vec3(0.08, 0.0, 0.0)) < 0.035) alb = vec3(0.1, 0.2, 0.6);
        if (length(cq + vec3(0.08, 0.0, 0.0)) < 0.035) alb = vec3(0.6, 0.1, 0.1);
      }
    } else if (m == dF) {
      alb = uv.y > 0.0 && uv.y < 1.0 && uv.x > 0.0 && uv.x < 1.0 ? flagColor(uv) : vec3(0.7);
    } else {
      // Regolith: dark grey-brown, speckled.
      alb = vec3(0.16, 0.155, 0.145) * (0.8 + 0.4 * fbm(pos.xz * 1.5, 4)) * (0.9 + 0.2 * hash12(floor(pos.xz * 60.0)));
    }
    float sh = softShadow(pos + n * 0.01, sun, 0.02, 60.0, 30.0);
    float dif = max(dot(n, sun), 0.0);
    // The lunar surface scatters light back towards the Sun (opposition surge), so it looks
    // flat-lit rather than shaded like a sphere.
    if (m == dG) dif = mix(dif, sqrt(dif), 0.5) * (1.0 + 0.3 * pow(max(dot(-rd, sun), 0.0), 8.0));
    vec3 h = normalize(sun - rd);
    col = SUN_COL * sh * (alb * dif + spec * pow(max(dot(n, h), 0.0), gloss) * vec3(1.0, 0.8, 0.45));
    // Fill light reflected from the sunlit plain; no sky.
    float ao = calcAO(pos, n, 0.5);
    col += alb * vec3(0.05, 0.05, 0.048) * max(0.3 - 0.7 * n.y + 0.4, 0.0) * ao;
    col += refl;
  }
  vec4 dd = dust(ro, rd, t > 0.0 ? t : 1e9);
  col = col * (1.0 - dd.a) + dd.rgb;
  alpha = max(alpha, dd.a);
  fragColor = vec4(col, alpha);
}
