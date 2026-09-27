// People and animals drawn from their joints, for silhouettes. A pose places the head, the base
// of the neck, the hips, the hands and the ankles; the elbows and knees are solved (two-bone IK)
// and the limbs are tapered strokes, so any gesture is a handful of points. An adult stands about
// 1.0 tall with the feet at y = 0, facing +x: mirror p.x to face the other way, scale p for size.
#include <sdf>

// The middle joint of a two-bone limb from a to c (bone lengths l1, l2). With side = +1 it bends
// to the left of the line from a to c (a knee in front of a leg that runs down a figure facing
// +x); with -1 to the right (an elbow behind a hanging arm).
vec2 ik2(vec2 a, vec2 c, float l1, float l2, float side) {
  vec2 v = c - a;
  float len = max(length(v), 1e-4);
  float d = clamp(len, abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  vec2 dir = v / len;
  float x = (l1 * l1 - l2 * l2 + d * d) / (2.0 * d);
  float h = sqrt(max(l1 * l1 - x * x, 0.0));
  return a + dir * x + vec2(-dir.y, dir.x) * h * side;
}

struct Pose {
  vec2 head;    // centre of the head
  vec2 neck;    // base of the neck, between the shoulders
  vec2 hip;     // the hip joints
  vec2 handN;   // near hand
  vec2 handF;   // far hand
  vec2 footN;   // near ankle
  vec2 footF;   // far ankle
  float look;   // head tilt in radians: + looks up
};

// A figure in pose f. dress: x a robe to the ankles, y a tunic or kilt to the knees, z long hair,
// w headwear (1 a brimmed hat, 2 a cap or head cloth). bulk: 1 an average build.
float sdFigure(vec2 p, Pose f, vec4 dress, float bulk) {
  vec2 up = f.neck - f.hip;
  float tl = max(length(up), 1e-4);
  up /= tl;
  vec2 fw = vec2(up.y, -up.x);
  vec2 sh = f.neck - up * 0.03;
  vec2 elN = ik2(sh, f.handN, 0.19, 0.18, -1.0);
  vec2 elF = ik2(sh, f.handF, 0.19, 0.18, -1.0);
  vec2 knN = ik2(f.hip, f.footN, 0.245, 0.235, 1.0);
  vec2 knF = ik2(f.hip, f.footF, 0.245, 0.235, 1.0);
  // Torso: a deep chest over a narrower waist and the hips.
  vec2 tc = f.hip + up * (tl * 0.64) + fw * 0.01;
  vec2 tq = vec2(dot(p - tc, fw), dot(p - tc, up));
  float chest = sdEllipse(tq, vec2(0.074, 0.12) * vec2(bulk, 1.0));
  float waist = sdTaper(p, f.hip + up * 0.14, f.hip - up * 0.01, 0.064 * bulk, 0.074 * bulk);
  float torso = smin(chest, waist, 0.05);
  // Head and neck, turned by `look`.
  vec2 hup = rot2(f.look) * up, hfw = rot2(f.look) * fw;
  vec2 hq = vec2(dot(p - f.head, hfw), dot(p - f.head, hup));
  float skull = sdEllipse(hq - vec2(-0.004, 0.006), vec2(0.053, 0.062));
  float jaw = sdEllipse(hq - vec2(0.015, -0.03), vec2(0.037, 0.031));
  float nose = sdEllipse(hq - vec2(0.047, -0.002), vec2(0.011, 0.009));
  float head = min(smin(skull, jaw, 0.014), nose);
  float neck = sdTaper(p, sh + up * 0.01, f.head - hup * 0.04, 0.036, 0.029);
  // Shoulders, arms and hands.
  float delt = sdCircle(p - sh - fw * 0.005, 0.047 * bulk);
  float arms = min(min(sdTaper(p, sh, elN, 0.037, 0.03), sdTaper(p, elN, f.handN, 0.03, 0.022)),
                   min(sdTaper(p, sh, elF, 0.037, 0.03), sdTaper(p, elF, f.handF, 0.03, 0.022)));
  arms = min(arms, min(sdCircle(p - f.handN, 0.025), sdCircle(p - f.handF, 0.025)));
  // Legs with calves, and feet pointing forward along the ground.
  float legs = 1e9;
  for (int i = 0; i < 2; i++) {
    vec2 kn = i == 0 ? knN : knF, ft = i == 0 ? f.footN : f.footF;
    legs = min(legs, sdTaper(p, f.hip, kn, 0.068 * bulk, 0.046));
    legs = min(legs, sdTaper(p, kn, ft, 0.045, 0.029));
    vec2 calf = mix(kn, ft, 0.3) - fw * 0.012;
    legs = smin(legs, sdCircle(p - calf, 0.047), 0.03);
    legs = min(legs, sdEllipse(p - ft - vec2(0.034, -0.017), vec2(0.058, 0.021)));
  }
  float d = smin(torso, neck, 0.025);
  d = smin(d, delt, 0.03);
  d = min(smin(d, head, 0.012), arms);
  d = smin(d, legs, 0.025);
  // Clothes.
  if (dress.x > 0.0) {
    vec2 hem = 0.5 * (f.footN + f.footF) + vec2(0.0, 0.03);
    float spread = abs(f.footN.x - f.footF.x);
    float robe = sdTaper(p, f.hip + up * 0.2, hem, 0.08 * bulk, (0.1 + 0.3 * spread) * dress.x + 0.04);
    robe = max(robe, hem.y - 0.02 - p.y);
    d = smin(d, robe, 0.02);
  }
  if (dress.y > 0.0) {
    vec2 kc = 0.5 * (knN + knF);
    float spread = abs(knN.x - knF.x);
    float kilt = sdTaper(p, f.hip + up * 0.09, kc + vec2(0.0, 0.02), 0.074 * bulk, (0.08 + 0.4 * spread) * dress.y + 0.02);
    kilt = max(kilt, kc.y - 0.0 - p.y);
    d = smin(d, kilt, 0.015);
  }
  if (dress.z > 0.0) d = smin(d, sdTaper(hq, vec2(-0.02, 0.02), vec2(-0.05, -0.12 - 0.08 * dress.z), 0.05, 0.03), 0.01);
  if (dress.w > 1.5) {
    d = min(d, sdEllipse(hq - vec2(-0.012, 0.03), vec2(0.059, 0.045)));
    d = min(d, sdTaper(hq, vec2(-0.03, 0.01), vec2(-0.07, -0.06), 0.03, 0.012));
  } else if (dress.w > 0.5) {
    d = min(d, sdRoundBox(hq - vec2(-0.002, 0.048), vec2(0.09, 0.008), 0.004));
    d = min(d, sdRoundBox(hq - vec2(-0.006, 0.078), vec2(0.05, 0.032), 0.012));
  }
  return d;
}

// ---------------------------------------------------------------- poses
// Poses at the origin (feet on y = 0), facing +x.

Pose standPose(float breath, float look) {
  Pose f;
  f.hip = vec2(0.0, 0.5);
  f.neck = vec2(0.012, 0.815 + 0.003 * breath);
  f.head = f.neck + vec2(0.024 - 0.02 * look, 0.098);
  vec2 sh = f.neck - vec2(0.0, 0.03);
  f.handN = sh + vec2(-0.015, -0.355);
  f.handF = sh + vec2(0.035, -0.35);
  f.footN = vec2(-0.045, 0.035);
  f.footF = vec2(0.055, 0.035);
  f.look = look;
  return f;
}

// Walking: ph is the phase of the stride (radians), stride the reach of each foot.
Pose walkPose(float ph, float stride) {
  Pose f;
  f.hip = vec2(0.0, 0.49 + 0.012 * cos(2.0 * ph));
  f.neck = f.hip + vec2(0.04, 0.31);
  f.head = f.neck + vec2(0.03, 0.097);
  vec2 sh = f.neck - vec2(0.0, 0.03);
  float sN = sin(ph), sF = sin(ph + PI);
  f.footN = vec2(stride * sN + 0.02, 0.035 + 0.07 * pow(max(cos(ph), 0.0), 1.5));
  f.footF = vec2(stride * sF + 0.02, 0.035 + 0.07 * pow(max(cos(ph + PI), 0.0), 1.5));
  f.handN = sh + vec2(-0.7 * stride * sN + 0.02, -0.34 + 0.03 * abs(sN));
  f.handF = sh + vec2(-0.7 * stride * sF + 0.02, -0.34 + 0.03 * abs(sF));
  f.look = 0.0;
  return f;
}

// Running: a longer stride, a forward lean and bent arms pumping.
Pose runPose(float ph) {
  Pose f;
  f.hip = vec2(0.0, 0.47 + 0.03 * cos(2.0 * ph));
  f.neck = f.hip + vec2(0.1, 0.29);
  f.head = f.neck + vec2(0.05, 0.09);
  vec2 sh = f.neck - vec2(0.0, 0.03);
  float sN = sin(ph), sF = sin(ph + PI);
  f.footN = vec2(0.28 * sN + 0.05, 0.04 + 0.16 * pow(max(cos(ph), 0.0), 1.2));
  f.footF = vec2(0.28 * sF + 0.05, 0.04 + 0.16 * pow(max(cos(ph + PI), 0.0), 1.2));
  f.handN = sh + vec2(-0.2 * sN + 0.05, -0.2);
  f.handF = sh + vec2(-0.2 * sF + 0.05, -0.2);
  f.look = 0.1;
  return f;
}

// Sitting on the ground, knees drawn up, hands resting on them (reach 0..1 stretches the near
// hand out, towards a fire).
Pose sitPose(float breath, float reach, float look) {
  Pose f;
  f.hip = vec2(0.0, 0.07);
  f.neck = vec2(0.06, 0.4 + 0.003 * breath);
  f.head = f.neck + vec2(0.035, 0.095);
  vec2 sh = f.neck - vec2(0.0, 0.03);
  f.footN = vec2(0.33, 0.035);
  f.footF = vec2(0.3, 0.04);
  f.handN = mix(vec2(0.24, 0.24), sh + vec2(0.33, -0.05), reach);
  f.handF = vec2(0.22, 0.22);
  f.look = look;
  return f;
}

// Pointing up at the sky with the far arm (amount 0..1 raises it).
Pose pointPose(float breath, float amount) {
  Pose f = standPose(breath, 0.55 * amount);
  vec2 sh = f.neck - vec2(0.0, 0.03);
  f.handF = mix(f.handF, sh + vec2(0.16, 0.3), amount);
  return f;
}

// Bent over reaping: the near hand swings a sickle (ph), the far hand gathers the stalks.
Pose reapPose(float ph) {
  Pose f;
  f.hip = vec2(0.0, 0.47);
  f.neck = f.hip + vec2(0.24, 0.2);
  f.head = f.neck + vec2(0.08, 0.06);
  vec2 sh = f.neck - vec2(0.0, 0.03);
  float s = 0.5 + 0.5 * sin(ph);
  f.handN = sh + mix(vec2(0.06, -0.3), vec2(0.28, -0.12), s);
  f.handF = sh + vec2(0.2, -0.26);
  f.footN = vec2(-0.08, 0.035);
  f.footF = vec2(0.14, 0.035);
  f.look = -0.3;
  return f;
}

// Hauling on a rope over the shoulder: leaning hard forward, digging in with each step.
Pose haulPose(float ph) {
  Pose f;
  f.hip = vec2(0.0, 0.45 + 0.01 * cos(2.0 * ph));
  f.neck = f.hip + vec2(0.2, 0.25);
  f.head = f.neck + vec2(0.07, 0.07);
  vec2 sh = f.neck - vec2(0.0, 0.03);
  float sN = sin(ph), sF = sin(ph + PI);
  f.footN = vec2(0.12 * sN - 0.06, 0.035 + 0.05 * max(cos(ph), 0.0));
  f.footF = vec2(0.12 * sF - 0.06, 0.035 + 0.05 * max(cos(ph + PI), 0.0));
  f.handN = sh + vec2(0.1, 0.02);
  f.handF = sh + vec2(-0.06, -0.08);
  f.look = 0.0;
  return f;
}

// Carrying a load on the head with both hands up to steady it, walking.
Pose carryPose(float ph, float stride) {
  Pose f = walkPose(ph, stride);
  f.neck = f.hip + vec2(0.02, 0.315);
  f.head = f.neck + vec2(0.025, 0.098);
  f.handN = f.head + vec2(0.07, 0.07);
  f.handF = f.head + vec2(-0.05, 0.08);
  return f;
}

// Speaking to a crowd: the near arm out, the hand open, rising and falling with the words.
Pose oratePose(float t) {
  Pose f = standPose(sin(t * 1.3), 0.08);
  vec2 sh = f.neck - vec2(0.0, 0.03);
  float g = 0.5 + 0.5 * sin(t * 2.1);
  f.handN = sh + vec2(0.3, 0.02 + 0.12 * g);
  f.handF = sh + vec2(0.06, -0.33);
  return f;
}

// ---------------------------------------------------------------- animals
// The build of a four-legged animal, in units of its own size (hooves on y = 0, facing +x).
struct Build {
  float len;      // body length, chest to rump
  float depth;    // depth of the chest
  float legF;     // height of the shoulder joint
  float legH;     // height of the hip joint (lower than legF: a back that slopes, as a giraffe's)
  float neck;     // neck length
  float neckAng;  // neck angle above the horizontal (radians)
  float headLen;  // head length, poll to muzzle
  float headW;    // head thickness
  float tail;     // tail length
  float stride;   // how far each hoof reaches
};

// A four-legged animal walking with phase ph (a four-beat walk). `poll` and `hdir` receive the
// top of the head and the direction the face points, for ears and horns.
float sdBeast(vec2 p, float ph, Build b, out vec2 poll, out vec2 hdir) {
  float bob = 0.006 * b.depth * sin(2.0 * ph);
  vec2 chest = vec2(b.len * 0.26, b.legF + b.depth * 0.36 + bob);
  vec2 rump = vec2(-b.len * 0.3, b.legH + b.depth * 0.33 + bob);
  float body = sdTaper(p, rump, chest, b.depth * 0.43, b.depth * 0.5);
  body = smin(body, sdEllipse(p - mix(rump, chest, 0.5) - vec2(0.0, -b.depth * 0.08), vec2(b.len * 0.36, b.depth * 0.42)), 0.04 * b.depth);
  float d = body;
  // Legs: hind near, fore near, hind far, fore far, a quarter cycle apart.
  for (int i = 0; i < 4; i++) {
    float a = ph + float(i) * 1.5708;
    bool fore = i == 1 || i == 3;
    vec2 top = fore ? vec2(b.len * 0.3, b.legF) : vec2(-b.len * 0.31, b.legH);
    float reach = b.stride * sin(a);
    vec2 foot = vec2(top.x + reach, 0.035 * top.y + 0.1 * top.y * pow(max(cos(a), 0.0), 1.5));
    float l = top.y * 0.52;
    vec2 joint = ik2(top + vec2(0.0, 0.02 * top.y), foot, l, l, fore ? 1.0 : -1.0);
    float r0 = fore ? b.depth * 0.22 : b.depth * 0.3;
    d = smin(d, sdTaper(p, top + vec2(0.0, b.depth * 0.2), joint, r0, b.depth * 0.08 + 0.012), 0.05 * b.depth);
    d = min(d, sdTaper(p, joint, foot, b.depth * 0.065 + 0.008, b.depth * 0.05 + 0.006));
    d = min(d, sdRoundBox(p - foot - vec2(0.012, -0.018 * top.y), vec2(b.depth * 0.07 + 0.01, 0.018 * top.y + 0.005), 0.006));
  }
  // Neck: a curve from the withers, thick at the base.
  vec2 nd = vec2(cos(b.neckAng), sin(b.neckAng));
  vec2 nb = chest + vec2(b.depth * 0.18, b.depth * 0.2);
  vec2 ne = nb + nd * b.neck;
  vec2 nm = mix(nb, ne, 0.5) + vec2(-nd.y, nd.x) * b.neck * 0.06;
  d = smin(d, sdBezierTaper(p, nb, nm, ne, b.depth * 0.36, b.headW * 0.5), 0.05 * b.depth);
  // Head: the skull behind the ears, tapering to the muzzle, with the jaw below.
  float ha = b.neckAng - 1.25;
  hdir = vec2(cos(ha), sin(ha));
  vec2 hn = vec2(-hdir.y, hdir.x);
  poll = ne;
  float skull = sdEllipse(vec2(dot(p - ne - hdir * b.headLen * 0.2, hdir), dot(p - ne - hdir * b.headLen * 0.2, hn)), vec2(b.headLen * 0.3, b.headW * 0.52));
  float muzzle = sdTaper(p, ne + hdir * b.headLen * 0.3, ne + hdir * b.headLen * 0.92, b.headW * 0.44, b.headW * 0.3);
  d = smin(d, smin(skull, muzzle, 0.3 * b.headW), 0.02);
  // Tail from the top of the rump.
  vec2 tb = rump + vec2(-b.depth * 0.38, b.depth * 0.3);
  d = min(d, sdBezierTaper(p, tb, tb + vec2(-b.tail * 0.3, -b.tail * 0.15), tb + vec2(-b.tail * 0.22, -b.tail + 0.02 * sin(ph)), 0.025 * b.depth + 0.008, 0.01));
  return d;
}

// Ears (or horns) at the poll: a tapered stroke from the top of the head, `ang` radians back from
// straight up the face's normal, length len, width w.
float earAt(vec2 p, vec2 poll, vec2 hdir, float ang, float len, float w) {
  vec2 hn = vec2(-hdir.y, hdir.x);
  vec2 dir = rot2(ang) * hn;
  vec2 a = poll + hn * w;
  return sdTaper(p, a, a + dir * len, w, w * 0.25);
}

float sdOx(vec2 p, float ph) {
  if (abs(p.x) > 1.2 || p.y > 1.2 || p.y < -0.05) return 1.0;
  vec2 poll, hd;
  float d = sdBeast(p, ph, Build(1.05, 0.5, 0.42, 0.44, 0.24, 0.25, 0.4, 0.26, 0.55, 0.12), poll, hd);
  // Horns sweeping out and up from the poll; a hump and dewlap.
  vec2 hn = vec2(-hd.y, hd.x);
  d = min(d, sdBezierTaper(p, poll + hn * 0.06, poll + hn * 0.1 + hd * 0.14, poll + hn * 0.26 + hd * 0.12, 0.034, 0.008));
  d = smin(d, sdCircle(p - vec2(0.3, 1.02), 0.12), 0.06);
  d = smin(d, sdEllipse(p - vec2(0.5, 0.6), vec2(0.09, 0.12)), 0.05);
  return d;
}

float sdDonkey(vec2 p, float ph) {
  if (abs(p.x) > 1.0 || p.y > 1.3 || p.y < -0.05) return 1.0;
  vec2 poll, hd;
  float d = sdBeast(p, ph, Build(0.78, 0.36, 0.52, 0.53, 0.3, 0.85, 0.38, 0.18, 0.5, 0.11), poll, hd);
  d = min(d, earAt(p, poll, hd, 0.5, 0.22, 0.03));
  return d;
}

float sdHorse(vec2 p, float ph) {
  if (abs(p.x) > 1.3 || p.y > 1.9 || p.y < -0.05) return 1.0;
  vec2 poll, hd;
  float d = sdBeast(p, ph, Build(1.0, 0.44, 0.74, 0.74, 0.5, 0.95, 0.5, 0.2, 0.7, 0.17), poll, hd);
  d = min(d, earAt(p, poll, hd, 0.4, 0.1, 0.022));
  // Mane along the crest of the neck.
  vec2 nb = vec2(0.26 + 0.08, 0.74 + 0.16 + 0.09);
  d = smin(d, sdTaper(p, nb + vec2(0.0, 0.08), poll + vec2(-0.03, 0.02), 0.05, 0.03), 0.03);
  return d;
}

float sdGiraffe(vec2 p, float ph) {
  if (abs(p.x) > 1.2 || p.y > 3.4 || p.y < -0.05) return 1.0;
  vec2 poll, hd;
  float d = sdBeast(p, ph, Build(0.95, 0.52, 1.45, 1.2, 1.4, 1.1, 0.34, 0.16, 0.65, 0.2), poll, hd);
  d = min(d, earAt(p, poll, hd, 0.15, 0.1, 0.02));
  d = min(d, earAt(p, poll, hd, 0.8, 0.09, 0.018));
  return d;
}

float sdAntelope(vec2 p, float ph) {
  if (abs(p.x) > 0.9 || p.y > 1.5 || p.y < -0.05) return 1.0;
  vec2 poll, hd;
  float d = sdBeast(p, ph, Build(0.74, 0.3, 0.56, 0.58, 0.3, 0.95, 0.26, 0.12, 0.2, 0.13), poll, hd);
  // Lyre-shaped horns.
  vec2 hn = vec2(-hd.y, hd.x);
  d = min(d, sdBezierTaper(p, poll + hn * 0.03, poll + hn * 0.18 - hd * 0.08, poll + hn * 0.32 + hd * 0.02, 0.016, 0.005));
  d = min(d, earAt(p, poll, hd, 1.0, 0.08, 0.018));
  return d;
}

float sdGoat(vec2 p, float ph) {
  if (abs(p.x) > 0.7 || p.y > 0.95 || p.y < -0.05) return 1.0;
  vec2 poll, hd;
  float d = sdBeast(p, ph, Build(0.6, 0.3, 0.32, 0.33, 0.17, 0.8, 0.22, 0.14, 0.1, 0.07), poll, hd);
  vec2 hn = vec2(-hd.y, hd.x);
  d = min(d, sdBezierTaper(p, poll + hn * 0.02, poll + hn * 0.12 - hd * 0.06, poll + hn * 0.08 - hd * 0.16, 0.018, 0.006));
  d = min(d, sdTaper(p, poll + hd * 0.18 - hn * 0.06, poll + hd * 0.16 - hn * 0.13, 0.012, 0.004));
  return d;
}

float sdDog(vec2 p, float ph) {
  if (abs(p.x) > 0.7 || p.y > 0.8 || p.y < -0.05) return 1.0;
  vec2 poll, hd;
  float d = sdBeast(p, ph, Build(0.55, 0.24, 0.3, 0.3, 0.14, 0.9, 0.2, 0.13, 0.28, 0.1), poll, hd);
  d = min(d, earAt(p, poll, hd, 0.3, 0.08, 0.022));
  return d;
}

// A bird in flight seen from afar, wings in a shallow M; flap is the wing phase.
float sdBird(vec2 p, float flap) {
  float up = 0.35 * sin(flap);
  float body = sdEllipse(p, vec2(0.12, 0.028));
  vec2 wristL = vec2(-0.2, 0.02 + up * 0.25), wristR = vec2(0.2, 0.02 + up * 0.25);
  float w = min(sdTaper(p, vec2(-0.03, 0.0), wristL, 0.035, 0.02), sdTaper(p, wristL, wristL + vec2(-0.22, -0.08 + up * 0.6), 0.02, 0.004));
  w = min(w, min(sdTaper(p, vec2(0.03, 0.0), wristR, 0.035, 0.02), sdTaper(p, wristR, wristR + vec2(0.22, -0.08 + up * 0.6), 0.02, 0.004)));
  return min(body, w);
}
