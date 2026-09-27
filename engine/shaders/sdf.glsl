// 2D signed distance functions and anti-aliased shape helpers.
// sdBox, sdSegment, sdEllipse (bound), sdTriangle and the polynomial smin follow Inigo Quilez
// (https://iquilezles.org/articles/distfunctions2d/, MIT License); see THIRD_PARTY_NOTICES.md.
#include <common>

float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdRoundBox(vec2 p, vec2 b, float r) { return sdBox(p, b - r) - r; }
float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
// Segment with radius interpolated from ra (at a) to rb (at b): limbs, necks, tails.
float sdTaper(vec2 p, vec2 a, vec2 b, float ra, float rb) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}
// Quadratic Bezier "tube" approximated with 8 tapered segments.
float sdBezierTaper(vec2 p, vec2 a, vec2 c, vec2 b, float ra, float rb) {
  float d = 1e9;
  vec2 prev = a;
  for (int i = 1; i <= 8; i++) {
    float t = float(i) / 8.0;
    vec2 q = mix(mix(a, c, t), mix(c, b, t), t);
    float t0 = float(i - 1) / 8.0;
    d = min(d, sdTaper(p, prev, q, mix(ra, rb, t0), mix(ra, rb, t)));
    prev = q;
  }
  return d;
}
float sdEllipse(vec2 p, vec2 r) {
  float k0 = length(p / r), k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}
float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
               vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
// Polynomial smooth min/max (k = blend radius).
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float smax(float a, float b, float k) { return -smin(-a, -b, k); }

// Anti-aliased fill coverage of a distance field; `px` = size of one pixel in the same units.
float fillAA(float d, float px) { return 1.0 - smoothstep(-px, px, d); }
float strokeAA(float d, float w, float px) { return 1.0 - smoothstep(w - px, w + px, abs(d)); }
