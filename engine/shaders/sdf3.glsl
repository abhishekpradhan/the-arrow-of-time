// 3D signed distance functions for ray-marched scenes: primitives, limited repetition and
// smooth blends. Overloads of the 2D names in <sdf> take vec3. Distances are exact unless
// marked "bound" (a lower bound: safe to march, but step more carefully near the surface).
// The primitive formulas follow Inigo Quilez's articles
// (https://iquilezles.org/articles/distfunctions/, MIT License); see THIRD_PARTY_NOTICES.md.
#include <sdf>

float sdSphere(vec3 p, float r) { return length(p) - r; }

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdRoundBox(vec3 p, vec3 b, float r) { return sdBox(p, b - r) - r; }

/** Capsule between a and b. */
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

/** Capsule between a and b whose radius goes from ra to rb (bound). */
float sdTaper(vec3 p, vec3 a, vec3 b, float ra, float rb) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}

/** Vertical cylinder around the y axis, half-height h. */
float sdCylinder(vec3 p, float r, float h) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

/** Cylinder between a and b. */
float sdCylinder(vec3 p, vec3 a, vec3 b, float r) {
  vec3 ba = b - a, pa = p - a;
  float baba = dot(ba, ba), paba = dot(pa, ba);
  float x = length(pa * baba - ba * paba) - r * baba;
  float y = abs(paba - baba * 0.5) - baba * 0.5;
  float x2 = x * x, y2 = y * y * baba;
  float d = max(x, y) < 0.0 ? -min(x2, y2) : (x > 0.0 ? x2 : 0.0) + (y > 0.0 ? y2 : 0.0);
  return sign(d) * sqrt(abs(d)) / baba;
}

/** Vertical cone frustum around the y axis: radius r1 at y = -h, r2 at y = +h. */
float sdCone(vec3 p, float h, float r1, float r2) {
  vec2 q = vec2(length(p.xz), p.y);
  vec2 k1 = vec2(r2, h), k2 = vec2(r2 - r1, 2.0 * h);
  vec2 ca = vec2(q.x - min(q.x, q.y < 0.0 ? r1 : r2), abs(q.y) - h);
  vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}

/** Torus in the xz plane: ring radius R, tube radius r. */
float sdTorus(vec3 p, float R, float r) { return length(vec2(length(p.xz) - R, p.y)) - r; }

/** Square pyramid, base 1 x 1 centred at the origin on y = 0, apex at height h. Scale p. */
float sdPyramid(vec3 p, float h) {
  float m2 = h * h + 0.25;
  p.xz = abs(p.xz);
  p.xz = (p.z > p.x) ? p.zx : p.xz;
  p.xz -= 0.5;
  vec3 q = vec3(p.z, h * p.y - 0.5 * p.x, h * p.x + 0.5 * p.y);
  float s = max(-q.x, 0.0);
  float t = clamp((q.y - 0.5 * p.z) / (m2 + 0.25), 0.0, 1.0);
  float a = m2 * (q.x + s) * (q.x + s) + q.y * q.y;
  float b = m2 * (q.x + 0.5 * t) * (q.x + 0.5 * t) + (q.y - m2 * t) * (q.y - m2 * t);
  float d2 = min(q.y, -q.x * m2 - q.y * 0.5) > 0.0 ? 0.0 : min(a, b);
  return sqrt((d2 + q.z * q.z) / m2) * sign(max(q.z, -p.y));
}

/** Ellipsoid with semi-axes r (bound). */
float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r), k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}

/** Hexagonal prism along z: apothem h.x, half-length h.y. */
float sdHexPrism(vec3 p, vec2 h) {
  const vec3 k = vec3(-0.8660254, 0.5, 0.57735);
  p = abs(p);
  p.xy -= 2.0 * min(dot(k.xy, p.xy), 0.0) * k.xy;
  vec2 d = vec2(length(p.xy - vec2(clamp(p.x, -k.z * h.x, k.z * h.x), h.x)) * sign(p.y - h.x), p.z - h.y);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

/** Repeat p every s (per axis) for cells -n..n; returns p in the cell and the cell id. */
vec3 repLim(vec3 p, vec3 s, vec3 n, out vec3 id) {
  id = clamp(floor(p / s + 0.5), -n, n);
  return p - s * id;
}

float repLim1(float x, float s, float n, out float id) {
  id = clamp(floor(x / s + 0.5), -n, n);
  return x - s * id;
}

// Smooth blends (smin / smax for floats are in <sdf>).
float opSubtract(float a, float b) { return max(a, -b); }
float opOnion(float d, float t) { return abs(d) - t; }
