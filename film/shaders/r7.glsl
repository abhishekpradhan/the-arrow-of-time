// The R-7 (8K71PS) that launched Sputnik, in metres, for the ray-marched ascent and orbit
// (shaders/ascent.glsl, shaders/orbit.glsl). The rocket's frame: y up its axis, the origin at the
// base of the core stage, the four boosters on +x, +z, -x, -z. The core (Block A) swells from its
// tail to the top of its oxygen tank and ends in the conical fairing over the satellite; each
// booster (Blocks B, V, G, D) is a cylinder that tapers into a long cone whose tip rests against
// the core, with a small air rudder at its tail. 29 m tall, 10 m across the boosters' tails; 20
// main combustion chambers (and 12 verniers, left out).
//
// uR7Boost[i] maps the rocket frame into booster i's frame (its base centre at the origin, its
// axis up y, its outboard side +x) so the boosters can peel away at staging; uR7BoostOff[i] is
// the booster's base in the rocket frame.
#include <sdf3>

uniform mat3 uR7Boost[4];
uniform vec3 uR7BoostOff[4];
uniform float uR7Boosters;   // 1 while the boosters are attached or in view

// One edge (a -> b) of a closed outline in the (radius, height) plane: keeps the squared
// distance to the nearest edge and flips the sign for every edge a ray towards +radius crosses
// (the polygon distance of Inigo Quilez's 2D distance article, MIT License). The edge up the
// axis is never crossed for radius > 0, so outlines leave it out.
void r7Edge(vec2 q, vec2 a, vec2 b, inout float d, inout float s) {
  vec2 e = b - a, w = q - a;
  vec2 k = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
  d = min(d, dot(k, k));
  bool c1 = q.y >= a.y, c2 = q.y < b.y, c3 = e.x * w.y > e.y * w.x;
  if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
}

// The core stage: tail, the long flare to the top of the oxygen tank, the instrument bay, and
// the fairing (or, with fairing = 1, the bare adapter the satellite sits on).
float r7Core(vec3 p, float fairing) {
  vec2 q = vec2(length(p.xz), p.y);
  if (q.y > 30.5 || q.y < -0.5 || q.x > 2.0) return max(max(q.y - 29.5, -q.y), q.x - 1.5);
  float d = 1e9, s = 1.0;
  vec2 P8 = fairing > 0.5 ? vec2(0.32, 25.0) : vec2(0.12, 29.0);
  vec2 P9 = fairing > 0.5 ? vec2(0.0, 25.05) : vec2(0.0, 29.15);
  r7Edge(q, vec2(0.0, 0.2), vec2(1.02, 0.2), d, s);
  r7Edge(q, vec2(1.02, 0.2), vec2(1.05, 1.4), d, s);
  r7Edge(q, vec2(1.05, 1.4), vec2(1.3, 9.0), d, s);
  r7Edge(q, vec2(1.3, 9.0), vec2(1.46, 17.5), d, s);
  r7Edge(q, vec2(1.46, 17.5), vec2(1.475, 22.4), d, s);
  r7Edge(q, vec2(1.475, 22.4), vec2(1.2, 24.3), d, s);
  r7Edge(q, vec2(1.2, 24.3), vec2(1.14, 24.5), d, s);
  r7Edge(q, vec2(1.14, 24.5), P8, d, s);
  r7Edge(q, P8, P9, d, s);
  return s * sqrt(d);
}

// A booster in its own frame: the tail skirt, the kerosene tank, the long oxygen cone; the air
// rudder on its outboard side.
float r7Booster(vec3 p) {
  vec2 q = vec2(length(p.xz), p.y);
  if (q.y > 20.5 || q.y < -0.5 || q.x > 2.6) return max(max(q.y - 19.8, -q.y), q.x - 2.2);
  float d = 1e9, s = 1.0;
  r7Edge(q, vec2(0.0, 0.25), vec2(1.3, 0.25), d, s);
  r7Edge(q, vec2(1.3, 0.25), vec2(1.34, 1.2), d, s);
  r7Edge(q, vec2(1.34, 1.2), vec2(1.34, 7.0), d, s);
  r7Edge(q, vec2(1.34, 7.0), vec2(0.22, 19.3), d, s);
  r7Edge(q, vec2(0.22, 19.3), vec2(0.0, 19.6), d, s);
  float body = s * sqrt(d);
  float fin = max(abs(p.z) - 0.04, sdTriangle(p.xy, vec2(1.2, 0.3), vec2(2.15, 0.3), vec2(1.2, 1.9)));
  return min(body, fin);
}

// Four bell nozzles on a square of half side a under a stage whose base is at y = 0.2.
float r7Bells(vec3 p, float a, float re, float len) {
  vec3 q = vec3(abs(p.x) - a, p.y - (0.2 - len * 0.5), abs(p.z) - a);
  return sdCone(q, len * 0.5, re, re * 0.5);
}

// The whole launcher. part: 0 core, 1..4 booster, 5 nozzle.
float r7Map(vec3 p, float fairing, out int part) {
  float d = r7Core(p, fairing);
  part = 0;
  float nz = r7Bells(p, 0.46, 0.34, 1.0);
  if (nz < d) { d = nz; part = 5; }
  if (uR7Boosters > 0.0) {
    for (int i = 0; i < 4; i++) {
      vec3 q = uR7Boost[i] * (p - uR7BoostOff[i]);
      float b = r7Booster(q);
      float bn = r7Bells(q, 0.42, 0.3, 0.9);
      if (b < d) { d = b; part = 1 + i; }
      if (bn < d) { d = bn; part = 5; }
    }
  }
  return d;
}
