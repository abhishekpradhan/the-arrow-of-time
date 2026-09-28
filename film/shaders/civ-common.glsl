// Shared by the civilization tableaux (shaders/civ-<id>.glsl, shots/civilization.ts): twelve
// thousand years painted as one day, dawn over the first fields to night at the launch pad. Each
// tableau defines `vec3 scene(vec2 p)` for picture coordinates p and draws its layers with
// parallax: L(p, k) is the position in a layer that moves k times as far as the mid-ground
// (k = 0 for the sky, 1 for the mid-ground, more for things close to the lens).
#include <illustration>
#include <figures>
#include <creatures>
#include <structures>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uT;
uniform vec2 uCam;     // the tableau's camera, in mid-ground units
uniform vec2 uSun;     // the sun's position in the picture
uniform float uElev;   // and its elevation in degrees
uniform vec2 uClip;    // draw only uClip.x <= x < uClip.y (the two sides of a wipe)

float PX;              // one pixel, in picture units

vec3 scene(vec2 p);

void main() {
  vec2 p = centered(vUv, uAspect);
  if (p.x < uClip.x || p.x >= uClip.y) discard;
  PX = 1.0 / uRes.y;
  fragColor = vec4(scene(p), 1.0);
}

// Position in a layer with parallax k.
vec2 L(vec2 p, float k) { return p + uCam * k; }

// Coverage with an edge softened for layers out of focus (blur in pixels).
float soft(float d, float blur) { return cover(d, PX * max(blur, 1.0)); }

// A backlit silhouette: dark ink, with a rim of light where its edge faces the sun.
// `grad` is the outward gradient of the shape's distance field (finite differences).
vec3 backlit(vec3 ink, float d, vec2 grad, vec2 p, vec3 light, float width) {
  vec2 l = normalize(uSun - p);
  return ink + light * rimLight(d, grad, l, width);
}

// Wheat in one row (a layer's own coordinates): stalks every `gap`, about `h` tall, bent by gusts
// of wind travelling through the field. Returns the distance to the stalks and ears; `earD`
// receives the distance to the ears alone and `awnD` to their bristles, which catch the light
// when the sun is behind them.
float wheatRow(vec2 q, float gap, float h, float row, float t, out float earD, out float awnD) {
  float d = 1e9;
  earD = 1e9;
  awnD = 1e9;
  float cell = floor(q.x / gap);
  for (int j = -2; j <= 2; j++) {
    float c = cell + float(j);
    vec3 r = hash33(vec3(c, row, 5.0));
    float x0 = (c + 0.1 + 0.8 * r.x) * gap;
    float H = h * (0.75 + 0.45 * r.y);
    float gust = 0.5 + 0.5 * sin(t * 1.5 - x0 * 1.6 / h + row * 0.7 + 4.0 * r.z);
    float bend = h * (0.04 + 0.1 * gust) * (0.5 + r.z);
    float u = clamp(q.y / H, 0.0, 1.0);
    float sx = x0 + bend * u * u;
    float stalk = max(abs(q.x - sx) - mix(0.011, 0.006, u) * h, max(-q.y, q.y - H * 0.94));
    vec2 top = vec2(x0 + bend, H);
    float ang = -1.8 * bend / H - 0.15 * (r.x - 0.5);
    vec2 eq = rot2(ang) * (q - top + vec2(0.0, 0.05 * h));
    float e = sdEllipse(eq, vec2(0.024, 0.095) * h) - 0.0025 * h * sin(eq.y / h * 170.0);
    float a = 1e9;
    for (int k = -1; k <= 1; k++) a = min(a, sdSegment(eq, vec2(float(k) * 0.01, 0.02) * h, vec2(float(k) * 0.045 + 0.02 * (r.z - 0.5), 0.26) * h));
    d = min(d, min(stalk, e));
    earD = min(earD, e);
    awnD = min(awnD, a);
  }
  return d;
}
