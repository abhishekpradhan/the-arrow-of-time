// Architectural silhouettes for the march of civilization. Base at y = 0, units ~ building heights.
#include <sdf>

float sdHut(vec2 p) {
  float wall = sdBox(p - vec2(0.0, 0.12), vec2(0.16, 0.12));
  float roof = sdTriangle(p, vec2(-0.22, 0.22), vec2(0.22, 0.22), vec2(0.0, 0.5));
  return min(wall, roof);
}

float sdZiggurat(vec2 p) {
  float d = sdBox(p - vec2(0.0, 0.1), vec2(0.7, 0.1));
  d = min(d, sdBox(p - vec2(0.0, 0.28), vec2(0.5, 0.09)));
  d = min(d, sdBox(p - vec2(0.0, 0.44), vec2(0.3, 0.08)));
  d = min(d, sdBox(p - vec2(0.0, 0.58), vec2(0.12, 0.07)));
  return d;
}

// Flat-roofed mud-brick houses behind a crenellated wall.
float sdOldCity(vec2 p, float seed) {
  if (abs(p.x) > 1.6 || p.y > 0.8 || p.y < -0.05) return 1.0;
  float d = sdBox(p - vec2(0.0, 0.1), vec2(1.5, 0.1));
  float cren = sdBox(vec2(mod(p.x, 0.12) - 0.06, p.y - 0.22), vec2(0.03, 0.03));
  d = min(d, max(cren, abs(p.x) - 1.5));
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float x = -1.35 + fi * 0.245;
    float h = 0.2 + 0.25 * fract(sin(fi * 12.9898 + seed) * 43758.5453);
    d = min(d, sdBox(p - vec2(x, h * 0.5 + 0.1), vec2(0.1, h * 0.5)));
  }
  return d;
}

float sdObelisk(vec2 p) {
  float shaft = max(abs(p.x) - mix(0.07, 0.045, saturate(p.y / 1.2)), max(-p.y, p.y - 1.2));
  float tip = sdTriangle(p, vec2(-0.045, 1.2), vec2(0.045, 1.2), vec2(0.0, 1.3));
  return min(shaft, tip);
}

float sdPyramid(vec2 p, float w, float h) {
  return sdTriangle(p, vec2(-w, 0.0), vec2(w, 0.0), vec2(0.0, h));
}

// Greek temple: stepped base, columns, entablature and pediment.
float sdTemple(vec2 p) {
  if (abs(p.x) > 0.8 || p.y > 0.9 || p.y < -0.05) return 1.0;
  float d = sdBox(p - vec2(0.0, 0.03), vec2(0.72, 0.03));
  d = min(d, sdBox(p - vec2(0.0, 0.08), vec2(0.66, 0.025)));
  for (int i = 0; i < 8; i++) {
    float x = -0.56 + float(i) * 0.16;
    d = min(d, sdBox(p - vec2(x, 0.3), vec2(0.028, 0.2)));
  }
  d = min(d, sdBox(p - vec2(0.0, 0.54), vec2(0.66, 0.04)));
  d = min(d, sdTriangle(p, vec2(-0.68, 0.58), vec2(0.68, 0.58), vec2(0.0, 0.76)));
  return d;
}

float sdCathedral(vec2 p) {
  if (abs(p.x) > 0.9 || p.y > 2.0 || p.y < -0.05) return 1.0;
  float d = sdBox(p - vec2(0.15, 0.3), vec2(0.55, 0.3));
  d = min(d, sdTriangle(p, vec2(-0.4, 0.6), vec2(0.7, 0.6), vec2(0.15, 0.85)));
  for (int i = 0; i < 2; i++) {
    float x = -0.48 + float(i) * 0.26;
    d = min(d, sdBox(p - vec2(x, 0.6), vec2(0.09, 0.6)));
    d = min(d, sdTriangle(p, vec2(x - 0.09, 1.2), vec2(x + 0.09, 1.2), vec2(x, 1.75)));
  }
  return d;
}

float sdWindmill(vec2 p, float t) {
  float tower = max(abs(p.x) - mix(0.12, 0.07, saturate(p.y / 0.7)), max(-p.y, p.y - 0.7));
  float cap = sdTriangle(p, vec2(-0.1, 0.7), vec2(0.1, 0.7), vec2(0.0, 0.82));
  vec2 hub = vec2(0.0, 0.72);
  float d = min(tower, cap);
  for (int i = 0; i < 4; i++) {
    float a = t * 1.2 + float(i) * 1.5708;
    vec2 dir = vec2(cos(a), sin(a));
    d = min(d, sdSegment(p, hub, hub + dir * 0.5) - 0.012);
    d = min(d, sdBox(rot2(-a) * (p - hub - dir * 0.3), vec2(0.18, 0.04)));
  }
  return d;
}

float sdFactory(vec2 p) {
  if (abs(p.x) > 1.0 || p.y > 1.5 || p.y < -0.05) return 1.0;
  float d = sdBox(p - vec2(0.0, 0.18), vec2(0.8, 0.18));
  // Saw-tooth roof.
  float tooth = sdTriangle(vec2(mod(p.x + 0.8, 0.2) - 0.1, p.y), vec2(-0.1, 0.36), vec2(0.1, 0.36), vec2(0.1, 0.48));
  d = min(d, max(tooth, abs(p.x) - 0.8));
  d = min(d, sdBox(p - vec2(-0.5, 0.7), vec2(0.045, 0.7)));
  d = min(d, sdBox(p - vec2(-0.25, 0.6), vec2(0.04, 0.6)));
  d = min(d, sdBox(p - vec2(0.55, 0.55), vec2(0.04, 0.55)));
  return d;
}

float sdCoolingTower(vec2 p) {
  float h = 1.0;
  float y = saturate(p.y / h);
  float w = 0.45 - 0.18 * sin(3.14159 * pow(y, 0.8)) - 0.05 * y;
  return max(abs(p.x) - w, max(-p.y, p.y - h));
}

// A modern skyline; `win` receives a window-light mask for night scenes.
float sdSkyline(vec2 p, float seed, out float win) {
  win = 0.0;
  if (abs(p.x) > 2.0 || p.y > 2.2 || p.y < -0.05) return 1.0;
  float d = 1e9;
  for (int i = 0; i < 22; i++) {
    float fi = float(i);
    float r1 = fract(sin(fi * 91.3 + seed) * 43758.5453);
    float r2 = fract(sin(fi * 17.1 + seed * 3.0) * 24634.6345);
    float x = -1.9 + fi * 0.18 + (r1 - 0.5) * 0.08;
    float h = 0.3 + 1.5 * r2 * r2;
    float w = 0.05 + 0.06 * r1;
    float b = sdBox(p - vec2(x, h * 0.5), vec2(w, h * 0.5));
    if (r1 > 0.7) b = min(b, sdSegment(p, vec2(x, h), vec2(x, h + 0.25)) - 0.006);
    if (b < d) {
      d = b;
      vec2 cell = floor(vec2((p.x - x) / 0.025, p.y / 0.035));
      float lit = step(0.55, fract(sin(dot(cell + fi, vec2(12.9898, 78.233))) * 43758.5453));
      vec2 f = fract(vec2((p.x - x) / 0.025, p.y / 0.035));
      win = lit * step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.75);
    }
  }
  return d;
}

float sdBiplane(vec2 p) {
  if (abs(p.x) > 0.6 || abs(p.y) > 0.3) return 1.0;
  float d = sdEllipse(p, vec2(0.4, 0.05));
  d = min(d, sdBox(p - vec2(0.05, 0.12), vec2(0.06, 0.012)));
  d = min(d, sdBox(p - vec2(0.05, -0.06), vec2(0.06, 0.012)));
  d = min(d, sdSegment(p, vec2(0.02, -0.06), vec2(0.02, 0.12)) - 0.006);
  d = min(d, sdTriangle(p, vec2(-0.42, 0.0), vec2(-0.3, 0.02), vec2(-0.42, 0.14)));
  return d;
}

float sdRocket(vec2 p) {
  if (abs(p.x) > 0.3 || p.y > 1.3 || p.y < -0.1) return 1.0;
  float body = sdBox(p - vec2(0.0, 0.5), vec2(0.06, 0.5));
  float nose = sdTriangle(p, vec2(-0.06, 1.0), vec2(0.06, 1.0), vec2(0.0, 1.22));
  float fins = min(sdTriangle(p, vec2(-0.06, 0.0), vec2(-0.06, 0.22), vec2(-0.16, 0.0)), sdTriangle(p, vec2(0.06, 0.0), vec2(0.06, 0.22), vec2(0.16, 0.0)));
  return min(min(body, nose), fins);
}
