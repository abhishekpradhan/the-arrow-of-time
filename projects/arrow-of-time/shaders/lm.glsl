// Apollo 11's lunar module, Eagle (LM-5), in metres, for the Moon landing (shaders/moonlanding.glsl).
// Its frame: y up with the footpads on the ground at y = 0 once landed, +z the front (the forward
// hatch, the porch and the ladder down the front leg), x across.
//
// The descent stage: an octagon 4.2 m across its flats and 1.65 m tall, wrapped in crinkled
// amber-gold foil, its engine bell below; four legs at the front, back and sides, each a shock
// strut from the stage's top to a round footpad 94 cm across, braced by two struts from its
// bottom; contact probes 1.7 m long under three of the pads (not the ladder's); the porch and the
// nine-rung ladder down the front leg. The ascent stage on top: the crew cabin with its flat,
// raked front face (two triangular windows, the square hatch), the midsection with the docking
// tunnel, the aft equipment bay, the propellant tanks bulging from its flanks, four thruster
// quads at its corners, the rendezvous radar dish and the steerable S-band dish.
//
// lmMap returns the distance and a material: 1 gold foil, 2 black, 3 grey panels, 4 struts,
// 5 footpad, 6 window, 7 dish, 8 thruster quad, 9 engine bell.
#include <sdf3>

uniform float uProbes;   // contact probes: 1 hanging straight down (in flight), 0 folded (landed)

const float LM_PAD_R = 4.45;   // footpad centres from the axis (9 m across)

// A leg in its own plane: u is the outward direction.
float lmLeg(vec3 p, vec3 u, vec3 w, bool ladder, inout float mat, float dBest) {
  vec3 top = u * 2.15 + vec3(0.0, 2.95, 0.0);
  vec3 pad = u * LM_PAD_R + vec3(0.0, 0.3, 0.0);
  // The primary strut: a fat cylinder, then the thinner piston into the pad.
  vec3 mid = mix(top, pad, 0.55);
  float d = min(sdCapsule(p, top, mid, 0.095), sdCapsule(p, mid, pad + vec3(0.0, 0.12, 0.0), 0.065));
  // Secondary struts from the stage's lower corners to the lower strut.
  vec3 low = mix(pad, top, 0.3);
  d = min(d, sdCapsule(p, u * 2.0 + w * 0.95 + vec3(0.0, 1.55, 0.0), low, 0.04));
  d = min(d, sdCapsule(p, u * 2.0 - w * 0.95 + vec3(0.0, 1.55, 0.0), low, 0.04));
  // A deployment truss from the stage's side to the strut's middle.
  d = min(d, sdCapsule(p, u * 2.1 + vec3(0.0, 1.9, 0.0), mix(top, pad, 0.45), 0.03));
  float m = 4.0;
  // The footpad: a shallow dish.
  vec3 q = p - (u * LM_PAD_R + vec3(0.0, 0.1, 0.0));
  float dish = max(length(vec2(length(q.xz), 0.0)) - 0.47 + 0.25 * max(-q.y, 0.0), abs(q.y) - 0.1);
  dish = min(dish, sdCone(q - vec3(0.0, 0.16, 0.0), 0.08, 0.2, 0.08));
  if (dish < d) { d = dish; m = 5.0; }
  // The contact probe.
  if (!ladder && uProbes > 0.0) {
    float pr = sdCapsule(p, u * LM_PAD_R + vec3(0.0, 0.0, 0.0), u * LM_PAD_R - vec3(0.0, 1.7 * uProbes, 0.0), 0.012);
    if (pr < d) { d = pr; m = 4.0; }
  }
  if (ladder) {
    // The ladder: two rails along the strut, a hand's breadth in front of it, and nine rungs.
    vec3 a = mix(top, pad, 0.06) + u * 0.14, b = mix(top, pad, 0.72) + u * 0.14;
    float rails = min(sdCapsule(p, a + w * 0.27, b + w * 0.27, 0.018), sdCapsule(p, a - w * 0.27, b - w * 0.27, 0.018));
    vec3 ab = b - a;
    float s = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    float k = floor(s * 9.0 + 0.5) / 9.0;
    vec3 c = mix(a, b, k);
    float rung = sdCapsule(p, c - w * 0.27, c + w * 0.27, 0.014);
    float lad = min(rails, rung);
    if (lad < d) { d = lad; m = 4.0; }
  }
  if (d < dBest) mat = m;
  return d;
}

float lmMap(vec3 p, out float mat) {
  mat = 0.0;
  // Bound the whole lander.
  float bound = length(p - vec3(0.0, 3.2, 0.0)) - 6.6;
  if (bound > 0.5) return bound;
  float d = 1e9;

  // ---- the descent stage
  vec3 q = p - vec3(0.0, 2.3, 0.0);
  vec2 a = abs(q.xz);
  float oct = max(max(a.x, a.y) - 2.1, (a.x + a.y) * 0.7071 - 2.0);
  float ds = max(oct, abs(q.y) - 0.83);
  d = ds;
  mat = 1.0;
  // The top deck (black) is a thin plate over the foil.
  float deck = max(oct + 0.02, abs(q.y - 0.84) - 0.02);
  if (deck < d) { d = deck; mat = 2.0; }
  // The engine bell under the stage.
  float bell = max(sdCone(p - vec3(0.0, 1.27, 0.0), 0.22, 0.74, 0.58), -sdCone(p - vec3(0.0, 1.24, 0.0), 0.22, 0.7, 0.54));
  if (bell < d) { d = bell; mat = 9.0; }
  // The porch in front of the hatch, with its handrails.
  float porch = sdBox(p - vec3(0.0, 3.1, 2.35), vec3(0.45, 0.025, 0.28));
  porch = min(porch, sdCapsule(p, vec3(0.45, 3.1, 2.1), vec3(0.45, 3.8, 2.1), 0.012));
  porch = min(porch, sdCapsule(p, vec3(-0.45, 3.1, 2.1), vec3(-0.45, 3.8, 2.1), 0.012));
  if (porch < d) { d = porch; mat = 4.0; }

  // ---- the legs (each only near its own sector: a cheap bound first)
  if (p.z > abs(p.x) - 1.2) {
    float b = length(p - vec3(0.0, 1.6, 3.4)) - 2.2;
    d = min(d, b > d ? b : lmLeg(p, vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0), true, mat, d));
  }
  if (-p.z > abs(p.x) - 1.2) {
    float b = length(p - vec3(0.0, 1.6, -3.4)) - 2.2;
    d = min(d, b > d ? b : lmLeg(p, vec3(0.0, 0.0, -1.0), vec3(1.0, 0.0, 0.0), false, mat, d));
  }
  if (p.x > abs(p.z) - 1.2) {
    float b = length(p - vec3(3.4, 1.6, 0.0)) - 2.2;
    d = min(d, b > d ? b : lmLeg(p, vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0), false, mat, d));
  }
  if (-p.x > abs(p.z) - 1.2) {
    float b = length(p - vec3(-3.4, 1.6, 0.0)) - 2.2;
    d = min(d, b > d ? b : lmLeg(p, vec3(-1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0), false, mat, d));
  }
  // The ascent stage and its antennas lie above the descent stage.
  float upper = max(3.0 - p.y, length(p - vec3(0.0, 4.9, -0.2)) - 2.6);
  if (upper > d) return d;

  // ---- the ascent stage
  vec3 c = p - vec3(0.0, 4.45, 0.3);
  // Crew cabin: an angular box along z (its corners chamfered), the flat front face raked back
  // at the top.
  vec2 cc = abs(c.xy);
  float cab = max(max(cc.x - 1.12, cc.y - 0.95), (cc.x + cc.y) * 0.7071 - 1.3);
  cab = max(cab, abs(c.z - 0.3) - 0.95);
  cab = max(cab, dot(c - vec3(0.0, 0.0, 0.95), normalize(vec3(0.0, 0.33, 1.0))));
  // The lower cabin is boxed in down to the descent stage.
  cab = min(cab, sdBox(p - vec3(0.0, 3.6, 0.55), vec3(1.05, 0.45, 0.7)));
  // Midsection and aft equipment bay.
  float mid = sdBox(p - vec3(0.0, 4.35, -0.75), vec3(1.2, 1.05, 0.55));
  mid = max(mid, dot(p - vec3(0.0, 5.4, -0.75), normalize(vec3(0.0, 1.0, -0.35))));
  float aft = sdBox(p - vec3(0.0, 4.45, -1.65), vec3(0.95, 0.5, 0.4));
  // Propellant tanks bulging from the flanks.
  // (Flattened, faceted by their blankets.)
  float tanks = min(sdEllipsoid(p - vec3(1.15, 3.8, -0.55), vec3(0.42, 0.5, 0.62)), sdEllipsoid(p - vec3(-1.15, 3.8, -0.55), vec3(0.42, 0.5, 0.62)));
  float as = min(min(cab, mid), min(aft, tanks));
  if (as < d) {
    d = as;
    mat = 3.0;
    // Black: the front face round the windows and hatch, the lower flanks, the tank blankets.
    if (cab <= as + 1e-4 && (p.z > 1.0 || p.y < 3.9)) mat = 2.0;
    if (tanks <= as + 1e-4 || (p.y < 3.6 && abs(p.x) > 0.9)) mat = 2.0;
  }
  // Windows (dark glass), inset triangles in the front face.
  vec3 f = p - vec3(0.0, 4.72, 1.28);
  vec2 wq = vec2(abs(f.x) - 0.5, f.y);
  float win = max(sdTriangle(wq, vec2(-0.3, -0.2), vec2(0.28, -0.2), vec2(0.28, 0.25)), abs(f.z + 0.03 * f.y) - 0.06);
  if (win < d + 0.004 && win < 0.01) { mat = 6.0; }
  // The forward hatch, a square outline below the windows.
  // Docking tunnel on top.
  float tun = sdCylinder(p - vec3(0.0, 5.7, -0.25), 0.42, 0.28);
  if (tun < d) { d = tun; mat = 3.0; }
  // Rendezvous radar: a dish on a post over the front; S-band: a dish on a boom at the back.
  vec3 rr = p - vec3(0.0, 6.05, 0.75);
  float radar = max(sdSphere(rr, 0.32), -sdSphere(rr - vec3(0.0, 0.05, 0.15), 0.3));
  radar = min(radar, sdCapsule(p, vec3(0.0, 5.35, 0.7), vec3(0.0, 5.95, 0.75), 0.05));
  vec3 sb = p - vec3(-1.05, 6.25, -1.0);
  float sband = max(sdSphere(sb, 0.34), -sdSphere(sb - vec3(0.12, 0.1, 0.0), 0.32));
  sband = min(sband, sdCapsule(p, vec3(-0.7, 5.3, -0.9), vec3(-1.0, 6.2, -1.0), 0.035));
  float dishes = min(radar, sband);
  if (dishes < d) { d = dishes; mat = 7.0; }
  // Thruster quads on short booms at the four corners.
  float rcs = 1e9;
  for (int i = 0; i < 4; i++) {
    vec2 s = vec2(i == 0 || i == 3 ? 1.0 : -1.0, i < 2 ? 1.0 : -1.0);
    vec3 cq = p - vec3(s.x * 1.55, 5.05, s.y * 1.05 - 0.2);
    float quad = sdBox(cq, vec3(0.13, 0.16, 0.13));
    quad = min(quad, sdCapsule(cq, vec3(0.0, -0.36, 0.0), vec3(0.0, 0.36, 0.0), 0.045));
    quad = min(quad, sdCapsule(cq, vec3(-0.3 * s.x, 0.0, 0.0), vec3(0.3 * s.x, 0.0, 0.0), 0.045));
    quad = min(quad, sdCapsule(cq, vec3(-0.45 * s.x, 0.0, 0.0), vec3(0.0), 0.03));
    rcs = min(rcs, quad);
  }
  if (rcs < d) { d = rcs; mat = 8.0; }
  return d;
}
