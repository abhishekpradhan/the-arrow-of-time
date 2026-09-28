// An Apollo 11 moonwalker in the A7L suit, for the Moon landing (shaders/moonlanding.glsl): the
// bulky white outer suit with its joint convolutes, the life-support backpack (PLSS) as tall as
// the torso with the oxygen purge unit on top, the helmet under its visor assembly with the gold
// visor down, the control box on the chest with its hoses, the lunar overshoes. About 1.95 m tall
// with the helmet. Posed from joints computed in shots/apollo.ts (world metres):
//   uJ[0] pelvis, 1 chest, 2 neck, 3 helmet centre, 4-6 left shoulder, elbow, hand,
//   7-9 right shoulder, elbow, hand, 10-12 left hip, knee, ankle, 13-15 right hip, knee, ankle
// and uTorso (world -> torso axes: x to its right, y up, z forward).
// Materials: 10 suit, 11 visor, 12 helmet shell, 13 boot, 14 backpack, 15 glove, 16 chest box.
#include <sdf3>

uniform vec3 uJ[16];
uniform mat3 uTorso;
uniform vec3 uAstroBase;   // between the feet (for bounds)
uniform vec3 uFootDirL, uFootDirR;   // the way each boot points (horizontal)
uniform float uAstroDust;            // dust on his boots and legs (0..1)

// A lunar overshoe: a tall, rounded upper up the calf, a strap over the instep, and a thick
// ribbed silicone sole; toe towards dir, the ankle joint at `ankle`. part: 0 upper, 1 sole.
float boot(vec3 p, vec3 ankle, vec3 dir, out float part) {
  vec3 f = normalize(vec3(dir.x, 0.0, dir.z));
  vec3 s = vec3(f.z, 0.0, -f.x);
  vec3 q = p - ankle;
  vec3 b = vec3(dot(q, s), q.y, dot(q, f));
  float upper = sdRoundBox(b - vec3(0.0, -0.025, 0.05), vec3(0.075, 0.07, 0.15), 0.06);
  float shin = sdTaper(b, vec3(0.0, -0.03, -0.01), vec3(0.0, 0.2, -0.015), 0.09, 0.095);
  float strap = sdRoundBox(b - vec3(0.0, 0.0, 0.07), vec3(0.085, 0.018, 0.04), 0.01);
  float sole = sdRoundBox(b - vec3(0.0, -0.088, 0.055), vec3(0.086, 0.024, 0.175), 0.012);
  // The tread: ribs across the sole.
  sole += 0.004 * smoothstep(0.3, 0.7, abs(fract(b.z * 26.0) - 0.5) * 2.0) * step(b.y, -0.095);
  float up = min(smin(upper, shin, 0.04), strap - 0.004);
  part = sole < up ? 1.0 : 0.0;
  return min(up, sole);
}

float astroMap(vec3 p, out float mat) {
  mat = 10.0;
  float bound = length(p - uAstroBase - vec3(0.0, 1.0, 0.0)) - 1.3;
  if (bound > 0.3) return bound;
  vec3 tq = uTorso * (p - uJ[1]);
  vec3 pq = uTorso * (p - uJ[0]);
  // Torso: a barrel chest over the waist and hips, the shoulders broad.
  float chest = sdEllipsoid(tq - vec3(0.0, 0.02, 0.0), vec3(0.27, 0.28, 0.19));
  float waist = sdEllipsoid(tq - vec3(0.0, -0.25, 0.0), vec3(0.21, 0.2, 0.16));
  float hips = sdEllipsoid(pq - vec3(0.0, 0.0, 0.0), vec3(0.22, 0.15, 0.16));
  float torso = smin(smin(chest, waist, 0.1), hips, 0.08);
  // Shoulder bulges, then the arms, puffed at the elbows.
  float arms = min(sdTaper(p, uJ[4], uJ[5], 0.1, 0.085), sdTaper(p, uJ[5], uJ[6], 0.083, 0.068));
  arms = min(arms, min(sdTaper(p, uJ[7], uJ[8], 0.1, 0.085), sdTaper(p, uJ[8], uJ[9], 0.083, 0.068)));
  arms = min(arms, min(sdSphere(p - uJ[5], 0.095), sdSphere(p - uJ[8], 0.095)));
  torso = smin(torso, min(sdSphere(p - uJ[4], 0.13), sdSphere(p - uJ[7], 0.13)), 0.08);
  // Legs: thick thighs, puffed knees, calves into the boots.
  float legs = min(sdTaper(p, uJ[10], uJ[11], 0.13, 0.105), sdTaper(p, uJ[11], uJ[12], 0.1, 0.088));
  legs = min(legs, min(sdTaper(p, uJ[13], uJ[14], 0.13, 0.105), sdTaper(p, uJ[14], uJ[15], 0.1, 0.088)));
  legs = min(legs, min(sdSphere(p - uJ[11], 0.11), sdSphere(p - uJ[14], 0.11)));
  float suit = smin(smin(torso, arms, 0.05), legs, 0.07);
  // The neck ring the helmet locks onto.
  suit = smin(suit, sdCapsule(p, uJ[2] - (uJ[2] - uJ[1]) * 0.25, uJ[2], 0.12), 0.04);
  float d = suit;
  // The backpack (PLSS), riding high on the back, and the oxygen purge unit on it.
  float pack = sdRoundBox(tq - vec3(0.0, -0.02, -0.33), vec3(0.23, 0.33, 0.125), 0.04);
  pack = min(pack, sdRoundBox(tq - vec3(0.0, 0.41, -0.3), vec3(0.2, 0.085, 0.11), 0.035));
  if (pack < d) { d = pack; mat = 14.0; }
  // The chest control box and its hoses.
  float rcu = sdRoundBox(tq - vec3(0.0, -0.1, 0.22), vec3(0.12, 0.065, 0.055), 0.015);
  rcu = min(rcu, sdCapsule(tq, vec3(0.1, -0.2, 0.18), vec3(0.2, -0.35, -0.05), 0.022));
  rcu = min(rcu, sdCapsule(tq, vec3(-0.1, -0.2, 0.18), vec3(-0.2, -0.35, -0.05), 0.022));
  if (rcu < d) { d = rcu; mat = 16.0; }
  // Helmet: the visor assembly's white shell over the back and top, the gold visor in front.
  vec3 hq = uTorso * (p - uJ[3]);
  float shell = sdSphere(hq, 0.195);
  float visor = max(sdSphere(hq, 0.2), 0.3 - dot(normalize(hq), normalize(vec3(0.0, -0.1, 1.0))));
  if (shell < d) { d = shell; mat = 12.0; }
  if (visor < d + 0.002 && visor < shell + 0.006) { d = min(d, visor); mat = 11.0; }
  // Gloves: a mitten of a hand with a thumb.
  float gl = min(sdSphere(p - uJ[6], 0.07), sdSphere(p - uJ[9], 0.07));
  if (gl < d) { d = gl; mat = 15.0; }
  float pl, pr;
  float bl = boot(p, uJ[12], uFootDirL, pl), br = boot(p, uJ[15], uFootDirR, pr);
  if (min(bl, br) < d) { d = min(bl, br); mat = (bl < br ? pl : pr) > 0.5 ? 13.6 : 13.0; }
  // The backpack's radio antenna.
  float ant = sdCapsule(tq, vec3(0.13, 0.5, -0.3), vec3(0.15, 0.78, -0.33), 0.006);
  if (ant < d) { d = ant; mat = 16.0; }
  return d;
}
float astroD(vec3 p) { float m; return astroMap(p, m); }

// Ambient occlusion of the suit's folds and crevices.
float astroAO(vec3 p, vec3 n) {
  float occ = 0.0, w = 1.0;
  for (int i = 1; i <= 4; i++) {
    float h = 0.03 * float(i);
    occ += (h - astroD(p + n * h)) * w;
    w *= 0.6;
  }
  return clamp(1.0 - occ * 5.0, 0.3, 1.0);
}

// Surface of the suit at p (normal n): colour, highlight, and anything it reflects (extra).
void astroMaterial(vec3 p, inout vec3 n, vec3 rd, float mat, out vec3 alb, out float spec, out float rough, out vec3 specC, out vec3 extra) {
  extra = vec3(0.0);
  specC = vec3(1.0);
  spec = 0.05;
  rough = 8.0;
  vec3 tq = uTorso * (p - uJ[1]);
  if (mat < 10.5 || mat > 13.9 && mat < 14.5) {
    // Beta cloth: off-white, creased where the suit bends (knees, elbows, hips, shoulders),
    // with the ringed convolutes at the knees and elbows and loose folds elsewhere.
    alb = vec3(0.8, 0.79, 0.76);
    float knee = min(length(p - uJ[11]), length(p - uJ[14]));
    float elbow = min(length(p - uJ[5]), length(p - uJ[8]));
    float hip = min(length(p - uJ[10]), length(p - uJ[13]));
    float shoulder = min(length(p - uJ[4]), length(p - uJ[7]));
    float joint = min(knee, elbow);
    float rings = smoothstep(0.14, 0.05, joint) * (0.5 + 0.5 * sin(dot(p - uJ[0], vec3(0.2, 1.0, 0.2)) * 95.0));
    alb *= 1.0 - 0.18 * rings;
    float crease = smoothstep(0.2, 0.06, min(min(knee, elbow), min(hip, shoulder) * 1.3));
    vec3 w1 = vec3(gnoise(p * 14.0), gnoise(p * 14.0 + 3.1), gnoise(p * 14.0 + 7.7));
    vec3 w2 = vec3(gnoise(p * 38.0), gnoise(p * 38.0 + 5.3), gnoise(p * 38.0 + 1.9));
    n = normalize(n + (0.1 + 0.25 * crease) * w1 + 0.05 * w2 + 0.12 * rings * vec3(0.0, 1.0, 0.0));
    // Grey dust on the boots' tops and lower legs once he has stepped off.
    float dusty = smoothstep(0.35, 0.1, p.y - min(uJ[12].y, uJ[15].y)) * uAstroDust;
    alb = mix(alb, vec3(0.42, 0.4, 0.37), dusty * (0.5 + 0.5 * gnoise(p * 30.0)));
    if (mat < 10.5) {
      // The red and blue hose connectors, the flag on the left shoulder.
      vec3 c = tq - vec3(0.0, -0.23, 0.18);
      if (length(c - vec3(0.12, 0.0, 0.0)) < 0.03) alb = vec3(0.1, 0.2, 0.55);
      if (length(c + vec3(0.12, 0.0, 0.0)) < 0.03) alb = vec3(0.55, 0.1, 0.1);
      vec3 fq = p - uJ[4] - vec3(0.0, -0.06, 0.0);
      if (abs(fq.y) < 0.035 && length(fq.xz) < 0.13 && dot(normalize(fq), -transpose(uTorso)[0]) > 0.4) alb = mod(floor(fq.y * 80.0), 2.0) < 1.0 ? vec3(0.6, 0.1, 0.1) : vec3(0.85);
    }
    spec = 0.04;
    rough = 6.0;
  } else if (mat < 11.5) {
    // The gold visor: a curved mirror of the grey plain, the black sky and the Sun.
    vec3 r = reflect(rd, n);
    vec3 env = r.y < 0.0 ? vec3(0.13, 0.125, 0.115) * 0.55 : vec3(0.0);
    extra = (env + vec3(40.0) * pow(max(dot(r, uSunDir), 0.0), 700.0)) * vec3(1.0, 0.72, 0.3);
    alb = vec3(0.02);
    spec = 1.0;
    rough = 300.0;
    specC = vec3(1.0, 0.75, 0.35);
  } else if (mat < 12.5) {
    alb = vec3(0.85, 0.85, 0.83);
    spec = 0.3;
    rough = 40.0;
  } else if (mat < 13.3) {
    // Overshoe uppers: white, dusted grey once he is on the ground.
    alb = mix(vec3(0.8, 0.8, 0.78), vec3(0.45, 0.43, 0.4), 0.7 * uAstroDust * (0.6 + 0.4 * gnoise(p * 25.0)));
    n = normalize(n + 0.1 * vec3(gnoise(p * 20.0), gnoise(p * 20.0 + 3.0), gnoise(p * 20.0 + 6.0)));
  } else if (mat < 13.9) {
    // The soles: blue-grey ribbed silicone.
    alb = vec3(0.2, 0.22, 0.26);
    spec = 0.15;
    rough = 20.0;
  } else if (mat < 15.5) {
    alb = vec3(0.78, 0.79, 0.8);
  } else {
    alb = vec3(0.3, 0.3, 0.3);
    spec = 0.2;
  }
}
