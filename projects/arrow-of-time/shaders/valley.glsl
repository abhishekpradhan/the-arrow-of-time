// One river valley from the first fields (10,000 BCE) to the first rocket (1957), as a single
// time-lapse: ray-marched terrain, river and sea; a city that grows outward from the river bend
// and rebuilds itself taller with each age; landmarks of each age; a sun that races across the
// sky; clouds; and the lights of each age at night. World units are 10 m; y is up and the river
// runs away from the camera along +z to the sea.
#include <noise>
#include <color>
#include <stars>
#include <sdf>
#include <structures>
#include <camera>

in vec2 vUv;
out vec4 fragColor;
uniform vec2 uRes;
uniform float uAspect, uGTime;
uniform float uYear;    // calendar year, -10500 .. 1962
uniform float uCity;    // settlement radius (world units, elliptical, long along the river)
uniform float uFields;  // farmland radius
uniform float uPhase;   // time of day: 0 sunrise, pi/2 noon, pi sunset, 3pi/2 midnight
uniform float uSeason;  // 0..1 (spring, summer, autumn, winter)
uniform float uNight;   // index of the current night (varies which windows are lit)
uniform float uClouds;  // cloud drift
uniform float uTowers;  // 0..1 skyscrapers
uniform float uSmog;    // industrial haze 0..1
uniform float uPyramid; // 0..1 pyramid construction
uniform float uTemple;  // 0..1 temple construction
uniform float uLaunch;  // seconds since the rocket's ignition (negative before)
uniform float uPlane;   // biplane crossing 0..1

const float CELL = 2.2;
const vec2 CENTER = vec2(6.5, 88.0);
const vec2 ACROPOLIS = vec2(22.0, 58.0);
const vec2 PLATEAU = vec2(-40.0, 160.0);
const vec3 PAD = vec3(34.0, 0.45, 338.0);
const vec3 PLANT = vec3(-15.0, 0.45, 125.0);

// ---------------------------------------------------------------- land
float riverX(float z) { return 6.0 * sin(z * 0.022 + 0.4) + 2.5 * sin(z * 0.061 + 2.0); }
float riverW(float z) { return 1.5 + 0.012 * clamp(z, 0.0, 330.0); }
float coastZ(float x) { return 330.0 + 25.0 * sin(x * 0.02 + 1.0) + 8.0 * sin(x * 0.07 + 0.3); }

// Distance from the river's edge (negative in the water).
float bankDist(vec2 q) { return abs(q.x - riverX(q.y)) - riverW(q.y); }

// The terrain never changes, so the shot bakes terrainProc() once into a texture (height and
// slope) that the scene samples: one fetch per march step instead of several noise octaves.
const vec2 HMIN = vec2(-320.0, -120.0), HMAX = vec2(320.0, 520.0);

float terrainProc(vec2 q) {
  float d = abs(q.x - riverX(q.y));
  float w = riverW(q.y);
  float h = 0.4 + 0.004 * d + 0.22 * (fbm(q * 0.07, 2) - 0.5);
  float hill = smoothstep(20.0, 95.0, d);
  if (hill > 0.0) h += hill * (5.0 + 22.0 * fbm(q * 0.011 + 3.1, 3));
  float pl = smoothstep(30.0, 18.0, length((q - PLATEAU) * vec2(1.0, 0.75)));
  if (pl > 0.0) h = mix(h, 3.0 + 0.1 * fbm(q * 0.3, 2), pl);
  float ac = length((q - ACROPOLIS) * vec2(1.0, 1.3));
  if (ac < 13.0) {
    float rim = 7.0 + 1.6 * (fbm(q * 0.35, 2) - 0.5);
    h = max(h, 0.4 + 5.0 * smoothstep(rim + 2.5, rim - 1.0, ac) + 0.35 * (fbm(q * 1.3, 2) - 0.5) * smoothstep(rim + 3.0, rim, ac));
  }
  h = mix(h, -0.8, smoothstep(w + 1.0, w - 0.3, d));
  h = mix(h, -2.0, smoothstep(-8.0, 8.0, q.y - coastZ(q.x)));
  return h;
}

#ifdef VALLEY_BAKE
void main() {
  vec2 q = mix(HMIN, HMAX, vUv);
  float e = 0.08;
  float h = terrainProc(q);
  float gx = (terrainProc(q + vec2(e, 0.0)) - terrainProc(q - vec2(e, 0.0))) / (2.0 * e);
  float gz = (terrainProc(q + vec2(0.0, e)) - terrainProc(q - vec2(0.0, e))) / (2.0 * e);
  fragColor = vec4(h, gx, gz, 1.0);
}
#else

uniform sampler2D uHeight;
vec3 terrainTex(vec2 q) {
  return texture(uHeight, (q - HMIN) / (HMAX - HMIN)).xyz;
}
float terrainH(vec2 q) { return terrainTex(q).x; }
vec3 terrainNormal(vec2 q) {
  vec3 t = terrainTex(q);
  return normalize(vec3(-t.y, 1.0, -t.z));
}

// Radius of the settlement at q (elliptical: the city stretches along the river).
float cityR(vec2 q) { return length(vec2(q.x - CENTER.x, (q.y - CENTER.y) * 0.62)); }

// ---------------------------------------------------------------- buildings
float yearMix(float a, float b) { return smoothstep(a, b, uYear); }
float plantAmt() { return yearMix(1938.0, 1946.0); }

// Land kept free of houses: the acropolis, the pyramid plateau, the coast, the pad, the plant.
bool reserved(vec2 cp) {
  return length((cp - ACROPOLIS) * vec2(1.0, 1.3)) < 7.0 || length((cp - PLATEAU) * vec2(1.0, 0.75)) < 30.0 ||
         cp.y > coastZ(cp.x) - 10.0 || length(cp - PAD.xz) < 16.0 || (plantAmt() > 0.0 && length(cp - PLANT.xz) < 11.0);
}

// Tallest building near q, for skipping the city when a ray is above it.
float cityTop(vec2 q) {
  float r = cityR(q);
  float hb = mix(0.35, 1.6, yearMix(-4000.0, 1920.0));
  return terrainH(q) + 0.3 + hb * 1.6 + uTowers * (24.0 * exp(-r * r / 196.0) + 7.0 * exp(-r * r / 900.0));
}

// Building of cell c: xy = half footprint, z = height, w = base height; off = centre offset.
vec4 cellBuilding(vec2 c, out vec2 off, out vec3 h) {
  vec2 cp = (c + 0.5) * CELL;
  h = hash32(c + 17.0);
  vec3 h2 = hash32(c + 71.0);
  off = (h2.xy - 0.5) * 0.14 * CELL;
  float bank = bankDist(cp);
  float r = cityR(cp);
  float rb = uCity * (0.7 + 0.6 * h.x);
  float grow = smoothstep(rb, rb - 3.0, r);
  // Scattered farmsteads beyond the town.
  float farm = step(0.965, h2.z) * step(r, uFields * 0.9) * yearMix(-9000.0, -6000.0);
  grow = max(grow, farm * 0.6);
  float reach = mix(24.0, 44.0, yearMix(1880.0, 1960.0));
  if (grow <= 0.0 || bank < 1.4 || bank > reach || h.y < 0.1) return vec4(0.0);
  if (reserved(cp)) return vec4(0.0);
  float hb = mix(0.28, 0.5, yearMix(-6000.0, -3000.0));
  hb = mix(hb, 0.8, yearMix(-1000.0, 1400.0));
  hb = mix(hb, 1.15, yearMix(1700.0, 1900.0));
  hb = mix(hb, 1.5, yearMix(1920.0, 1960.0));
  hb *= 0.65 + 0.8 * h.z;
  float tower = uTowers * (24.0 * exp(-r * r / 196.0) * pow(h.z, 2.5) + 7.0 * exp(-r * r / 900.0) * h.z * h.z);
  float height = (hb + tower) * grow;
  vec2 fs = CELL * 0.5 * mix(vec2(0.3, 0.34), vec2(0.64, 0.74), h.yx) * mix(0.85, 1.0, yearMix(1700.0, 1950.0));
  fs *= mix(1.0, 0.85, smoothstep(4.0, 12.0, tower));
  return vec4(fs, height, terrainH(cp));
}

float sdBox3(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float dCity(vec3 p) {
  vec2 c = floor(p.xz / CELL);
  vec2 lc = p.xz - (c + 0.5) * CELL;
  vec2 off; vec3 h;
  vec4 b = cellBuilding(c, off, h);
  if (b.z <= 0.0) return 1e3;
  float top = b.w + b.z;
  // Old towns are irregular; modern blocks follow the street grid.
  vec2 lq = rot2((h.x - 0.5) * 0.55 * (1.0 - yearMix(1850.0, 1920.0))) * (lc - off);
  float d = sdBox3(vec3(lq.x, p.y - (b.w - 0.3 + top) * 0.5, lq.y), vec3(b.x, (top - b.w + 0.3) * 0.5, b.y));
  // Pitched roofs before the modern era.
  float pitch = (1.0 - yearMix(1880.0, 1930.0)) * step(b.z, 3.0);
  if (pitch > 0.0) {
    vec3 q = vec3(lq.x, p.y - top, lq.y);
    float ridge = b.x * 0.55;
    float roof = max(abs(q.z) - b.y, ((abs(q.x) * 0.8 + q.y) - ridge) / 1.2806);
    roof = max(roof, -q.y);
    d = min(d, roof);
  }
  return d;
}

// A march inside the city layer must not step across a cell boundary without looking at the
// next cell's building: this caps the step (it is not a surface).
float cityStep(vec3 p) {
  if (p.y > cityTop(p.xz) + 0.3) return 1e3;
  vec2 lc = p.xz - (floor(p.xz / CELL) + 0.5) * CELL;
  return min(CELL * 0.5 - abs(lc.x), CELL * 0.5 - abs(lc.y)) + 0.03;
}

// ---------------------------------------------------------------- landmarks
float sdPyr(vec3 p, float h, float b) {
  // Square pyramid, apex at (0, h, 0), base half-width b (a bound, fine for marching).
  vec3 q = vec3(abs(p.x), p.y, abs(p.z));
  vec2 n = normalize(vec2(h, b));
  float d = max(dot(vec2(q.x, q.y - h), n), dot(vec2(q.z, q.y - h), n));
  return max(d, -p.y);
}

float dPyramids(vec3 p) {
  if (uPyramid <= 0.0 || length(p.xz - PLATEAU) > 40.0) return 1e3;
  float base = 3.0;
  float d = 1e3;
  // Giza's three, in a diagonal line, largest first. Built from the base up.
  vec3 c0 = vec3(PLATEAU.x + 6.0, base, PLATEAU.y - 8.0);
  vec3 c1 = vec3(PLATEAU.x - 6.0, base, PLATEAU.y + 6.0);
  vec3 c2 = vec3(PLATEAU.x - 14.0, base, PLATEAU.y + 17.0);
  float build = uPyramid * 15.0;
  d = min(d, max(sdPyr(p - c0, 14.6, 11.5), p.y - base - build));
  d = min(d, max(sdPyr(p - c1, 13.6, 10.7), p.y - base - build * 0.93));
  d = min(d, max(sdPyr(p - c2, 6.5, 5.3), p.y - base - build * 0.45));
  return d;
}

float dTemple(vec3 p) {
  if (uTemple <= 0.0 || length(p.xz - ACROPOLIS) > 9.0) return 1e3;
  float base = 5.4;
  vec3 q = p - vec3(ACROPOLIS.x, base, ACROPOLIS.y);
  float rise = uTemple * 2.4;
  float stylobate = sdBox3(q - vec3(0.0, 0.15, 0.0), vec3(3.6, 0.2, 1.6));
  // Colonnade: columns around a 7 x 3 rectangle.
  vec3 cq = q - vec3(0.0, 0.35 + 0.55, 0.0);
  float col = 1e3;
  vec2 rep = vec2(0.45, 0.45);
  vec2 cell = clamp(floor(cq.xz / rep + 0.5), vec2(-7.0, -3.0), vec2(7.0, 3.0));
  vec2 lc = cq.xz - cell * rep;
  bool ring = abs(cell.x) > 6.5 || abs(cell.y) > 2.5;
  if (ring) col = max(length(lc) - 0.11, abs(cq.y) - 0.55);
  float cella = sdBox3(cq - vec3(0.0, 0.0, 0.0), vec3(2.3, 0.55, 0.8));
  vec3 rq = q - vec3(0.0, 1.45, 0.0);
  float roof = max(sdBox3(rq, vec3(3.5, 0.12, 1.55)), 0.0);
  float ped = max(max(abs(rq.x) - 3.5, abs(rq.z) * 0.35 + rq.y - 0.5), -rq.y);
  float d = min(min(stylobate, min(col, cella)), min(roof, ped));
  return max(d, q.y - rise);
}

float dZiggurat(vec3 p) {
  float a = yearMix(-4200.0, -3600.0) * (1.0 - yearMix(-200.0, 600.0));
  if (a <= 0.0) return 1e3;
  vec3 q = p - vec3(CENTER.x + 9.0, 0.45, CENTER.y - 6.0);
  if (length(q.xz) > 9.0) return 1e3;
  float d = sdBox3(q - vec3(0.0, 0.6, 0.0), vec3(5.0, 0.6, 3.6));
  d = min(d, sdBox3(q - vec3(0.0, 1.7, 0.0), vec3(3.6, 0.55, 2.6)));
  d = min(d, sdBox3(q - vec3(0.0, 2.7, 0.0), vec3(2.2, 0.5, 1.6)));
  return max(d, q.y - 3.3 * a);
}

float dCathedral(vec3 p) {
  float a = yearMix(900.0, 1400.0);
  if (a <= 0.0) return 1e3;
  vec3 q = p - vec3(CENTER.x - 10.0, 0.45, CENTER.y + 4.0);
  if (length(q.xz) > 9.0) return 1e3;
  float nave = sdBox3(q - vec3(0.0, 1.3, 0.0), vec3(0.9, 1.3, 3.6));
  float transept = sdBox3(q - vec3(0.0, 1.1, 1.2), vec3(2.2, 1.1, 0.7));
  vec3 tq = vec3(abs(q.x) - 0.65, q.y, q.z + 3.6);
  float towers = sdBox3(tq - vec3(0.0, 2.3, 0.0), vec3(0.35, 2.3, 0.35));
  // Spire over the crossing.
  vec3 sq = q - vec3(0.0, 2.6, 1.2);
  float spire = max(length(sq.xz) - 0.4 * (1.0 - sq.y / 4.2), abs(sq.y - 2.1) - 2.1);
  float d = min(min(nave, transept), min(towers, spire * 0.8));
  return max(d, q.y - 7.0 * a);
}

// Factory chimneys along the downstream bank.
vec3 chimneyPos(int i) {
  vec3 hh = hash31(float(i) * 5.3 + 2.0);
  float z = 70.0 + float(i) * 13.0 + hh.x * 6.0;
  float x = riverX(z) + (i % 2 == 0 ? 1.0 : -1.0) * (riverW(z) + 3.0 + hh.y * 5.0);
  return vec3(x, 0.45, z);
}
float chimneyAmt() { return yearMix(1720.0, 1795.0) * (1.0 - 0.6 * yearMix(1950.0, 1990.0)); }

float dChimneys(vec3 p) {
  float a = chimneyAmt();
  if (a <= 0.0 || p.z < 60.0 || p.z > 175.0) return 1e3;
  float d = 1e3;
  for (int i = 0; i < 7; i++) {
    vec3 c = chimneyPos(i);
    vec3 q = p - c;
    if (abs(q.x) > 6.0 || abs(q.z) > 6.0) continue;
    float h = 5.5 * a;
    float stack = max(length(q.xz) - (0.2 - 0.02 * q.y / 5.5), abs(q.y - h * 0.5) - h * 0.5);
    float shed = sdBox3(q - vec3(0.0, 0.7, 2.0), vec3(1.6, 0.7 * a, 1.4));
    d = min(d, min(stack, shed));
  }
  return d;
}

// Power station with two cooling towers, the atomic age.

float dPlant(vec3 p) {
  float a = plantAmt();
  if (a <= 0.0 || length(p.xz - PLANT.xz) > 14.0) return 1e3;
  float d = 1e3;
  for (int i = 0; i < 2; i++) {
    vec3 q = p - PLANT - vec3(float(i) * 6.0 - 3.0, 0.0, float(i) * 2.0);
    float y = clamp(q.y / 7.0, 0.0, 1.0);
    float rr = 2.6 - 1.6 * y + 1.2 * y * y;   // hyperboloid-ish profile
    float shell = max(abs(length(q.xz) - rr) - 0.12, abs(q.y - 3.5) - 3.5);
    d = min(d, max(shell, q.y - 7.0 * a));
  }
  return d;
}

// The rocket: 3 units tall; climbs with growing acceleration after ignition.
vec3 rocketPos() {
  float t = max(uLaunch - 1.2, 0.0);
  return PAD + vec3(0.07 * t * t, 0.2 + 3.0 * t * t + 3.2 * t * t * t, 0.0);
}
float dLaunch(vec3 p) {
  float a = yearMix(1950.0, 1956.0);
  if (a <= 0.0 || length(p.xz - PAD.xz) > 12.0) return 1e3;
  vec3 q = p - PAD;
  float gantry = sdBox3(q - vec3(-0.9, 2.2, 0.0), vec3(0.3, 2.2, 0.3));
  float pad = sdBox3(q - vec3(0.0, 0.1, 0.0), vec3(2.5, 0.12, 2.5));
  vec3 rq = p - rocketPos();
  float body = max(length(rq.xz) - 0.17, abs(rq.y - 1.3) - 1.3);
  float nose = max(length(rq.xz) - 0.17 * (1.0 - (rq.y - 2.6) / 0.6), abs(rq.y - 2.9) - 0.3);
  return min(min(gantry, pad), min(body, nose));
}

// ---------------------------------------------------------------- scene
float mapLand(vec3 p) {
  vec3 t = terrainTex(p.xz);
  // Distance to the local tangent plane, scaled down so rays don't tunnel through convex ridges.
  return (p.y - t.x) * inversesqrt(1.0 + t.y * t.y + t.z * t.z) * 0.6;
}

float map(vec3 p) {
  float d = mapLand(p);
  float top = cityTop(p.xz);
  d = min(d, p.y < top + 0.3 ? dCity(p) : p.y - top);
  d = min(d, dPyramids(p));
  d = min(d, dTemple(p));
  d = min(d, dZiggurat(p));
  d = min(d, dCathedral(p));
  d = min(d, dChimneys(p));
  d = min(d, dPlant(p));
  d = min(d, dLaunch(p));
  return d;
}

// Material at a hit: 0 land, 1 building, 2 pyramid, 3 marble, 4 mudbrick, 5 stone, 6 brick,
// 7 concrete, 8 rocket and pad.
int material(vec3 p) {
  float best = mapLand(p);
  int m = 0;
  float d = p.y < cityTop(p.xz) + 0.3 ? dCity(p) : 1e3;
  if (d < best) { best = d; m = 1; }
  d = dPyramids(p); if (d < best) { best = d; m = 2; }
  d = dTemple(p); if (d < best) { best = d; m = 3; }
  d = dZiggurat(p); if (d < best) { best = d; m = 4; }
  d = dCathedral(p); if (d < best) { best = d; m = 5; }
  d = dChimneys(p); if (d < best) { best = d; m = 6; }
  d = dPlant(p); if (d < best) { best = d; m = 7; }
  d = dLaunch(p); if (d < best) { best = d; m = 8; }
  return m;
}

vec3 normalAt(vec3 p, float t) {
  float e = 0.0015 * t + 0.002;
  vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) + k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
}

float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.2;
  for (int i = 0; i < 22; i++) {
    vec3 p = ro + rd * t;
    float h = map(p);
    res = min(res, 10.0 * h / t);
    t += clamp(min(h, cityStep(p)), 0.12, 4.0);
    if (res < 0.02 || t > 60.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

float ambientOcc(vec3 p, vec3 n) {
  float o = 0.0, s = 1.0;
  for (int i = 1; i <= 3; i++) {
    float h = 0.25 * float(i);
    o += (h - map(p + n * h)) * s;
    s *= 0.6;
  }
  return clamp(1.0 - 1.4 * o, 0.0, 1.0);
}

// ---------------------------------------------------------------- sky
vec3 sunDir() { return normalize(vec3(-0.92 * cos(uPhase), 0.8 * sin(uPhase), 0.25 - 0.45 * sin(uPhase))); }

float dayAmt(vec3 sd) { return smoothstep(-0.14, 0.12, sd.y); }

vec3 skyBase(vec3 rd, vec3 sd) {
  float day = dayAmt(sd);
  float golden = exp(-sd.y * sd.y / 0.025);
  float h = max(rd.y, 0.0);
  vec3 dayC = mix(vec3(0.6, 0.7, 0.84), vec3(0.14, 0.3, 0.62), pow(h, 0.45));
  vec3 nightC = mix(vec3(0.03, 0.045, 0.08), vec3(0.006, 0.012, 0.03), pow(h, 0.5));
  vec3 col = mix(nightC, dayC, day);
  vec2 a = rd.xz / max(length(rd.xz), 1e-4), b = sd.xz / max(length(sd.xz), 1e-4);
  float toward = 0.5 + 0.5 * dot(a, b);
  col += vec3(1.0, 0.42, 0.16) * golden * exp(-h * 5.0) * (0.25 + 0.95 * toward * toward) * 1.1;
  col += vec3(0.5, 0.25, 0.4) * golden * exp(-h * 2.0) * 0.15;
  // Industrial haze browns the horizon.
  col = mix(col, vec3(0.42, 0.36, 0.28) * (0.15 + 0.85 * day), uSmog * 0.35 * exp(-h * 4.0));
  // City skyglow at night.
  float glow = uTowers * 0.8 + 0.2 * yearMix(1880.0, 1930.0);
  col += vec3(1.0, 0.5, 0.2) * 0.05 * glow * exp(-h * 9.0) * (1.0 - day);
  float cosA = dot(rd, sd);
  col += vec3(1.0, 0.72, 0.42) * pow(max(cosA, 0.0), 14.0) * (0.25 + 0.8 * golden) * smoothstep(-0.12, 0.04, sd.y);
  return col;
}

vec3 skyCol(vec3 rd, vec3 sd) {
  float up = smoothstep(-0.03, 0.02, sd.y);
  return skyBase(rd, sd) + vec3(1.0, 0.86, 0.62) * smoothstep(0.99985, 0.99993, dot(rd, sd)) * 60.0 * up;
}

vec3 stars(vec3 rd, vec3 sd) {
  float night = 1.0 - dayAmt(sd);
  if (night <= 0.0 || rd.y < -0.02) return vec3(0.0);
  vec2 uv = vec2(atan(rd.x, rd.z), asin(clamp(rd.y, -1.0, 1.0)));
  vec3 s = starField(uv * 0.5, pixelAngle(uRes.y) * 0.5, uGTime, 7.0, 0.9);
  return s * night * smoothstep(0.0, 0.15, rd.y) * (1.0 - 0.7 * uTowers);
}

// Cloud cover at a point on the cloud deck (0..1).
float cloudCover(vec2 q) {
  float n = fbm(vec3(q * 0.0055 + vec2(uClouds, uClouds * 0.35), uClouds * 0.04), 4);
  float weather = 0.56 + 0.08 * sin(uClouds * 0.23);
  return smoothstep(weather, weather + 0.2, n);
}
const float CLOUD_Y = 115.0;

vec4 clouds(vec3 ro, vec3 rd, vec3 sd) {
  if (rd.y <= 0.004) return vec4(0.0);
  float t = (CLOUD_Y - ro.y) / rd.y;
  vec2 q = ro.xz + rd.xz * t;
  float c = cloudCover(q);
  if (c <= 0.0) return vec4(0.0);
  float c2 = cloudCover(q + sd.xz * 6.0);
  float day = dayAmt(sd);
  float golden = exp(-sd.y * sd.y / 0.025);
  vec3 lit = mix(vec3(0.03, 0.035, 0.05), vec3(1.0, 0.98, 0.95), day);
  lit = mix(lit, vec3(1.0, 0.55, 0.3), golden * 0.7);
  vec3 shade = lit * mix(0.45, 0.8, 1.0 - c2);
  // Lit from below by the city at night.
  shade += vec3(1.0, 0.5, 0.22) * 0.06 * (uTowers + 0.2 * yearMix(1880.0, 1930.0)) * (1.0 - day) * exp(-length(q - CENTER) / 250.0);
  float a = c * smoothstep(0.004, 0.08, rd.y) * exp(-t / 2600.0);
  return vec4(shade, a);
}

vec3 fog(vec3 col, float t, vec3 rd, vec3 sd) {
  float dens = 0.0017 + 0.0009 * uSmog;
  float f = 1.0 - exp(-t * dens);
  vec3 fc = skyBase(normalize(vec3(rd.x, 0.05, rd.z)), sd) * 0.7;
  fc = mix(fc, vec3(0.3, 0.26, 0.2) * (0.1 + 0.9 * dayAmt(sd)), 0.35 * uSmog);
  return mix(col, fc, f);
}

// ---------------------------------------------------------------- lights at night
float nightLights() { return 1.0 - dayAmt(sunDir()); }

// Warm points on the ground: street lights (later ages) and fires or lamps (earlier ones).
vec3 groundLights(vec2 q, float t) {
  float r = cityR(q);
  float inCity = smoothstep(uCity + 2.0, uCity - 6.0, r);
  float bank = bankDist(q);
  if (bank < 0.8) return vec3(0.0);
  vec3 col = vec3(0.0);
  // Street lights on the grid, from the gas age on; brighter and denser with electricity.
  float streets = yearMix(1820.0, 1900.0);
  if (streets > 0.0 && inCity > 0.0) {
    vec2 g = q / (CELL * 0.5);
    vec3 hh = hash32(floor(g) + 3.0);
    vec2 f = fract(g) - (0.25 + 0.5 * hh.xy);
    float district = smoothstep(0.35, 0.7, fbm(q * 0.05 + 11.0, 2));
    float on = step(0.75 - 0.45 * yearMix(1900.0, 1950.0) - 0.25 * district, hh.z);
    float pt = exp(-dot(f, f) / 0.003) * (0.5 + district);
    vec3 lamp = mix(vec3(1.0, 0.7, 0.35), vec3(1.0, 0.5, 0.16), yearMix(1930.0, 1960.0));
    col += lamp * pt * on * streets * inCity * mix(1.5, 3.2, yearMix(1900.0, 1950.0));
  }
  // Suburbs and roads beyond the city, modern age.
  float sprawl = yearMix(1920.0, 1965.0);
  if (sprawl > 0.0) {
    float band = smoothstep(uCity * 1.6, uCity * 0.9, r) * (1.0 - inCity);
    vec2 g = q * vec2(1.4, 1.1);
    vec3 hh = hash32(floor(g) + 9.0);
    vec2 f = fract(g) - hh.xy;
    col += vec3(1.0, 0.7, 0.4) * step(0.72, hh.z) * exp(-dot(f, f) / 0.006) * band * sprawl * 2.0;
  }
  // Cars along the riverside roads.
  float cars = yearMix(1925.0, 1960.0);
  if (cars > 0.0 && abs(bank - 2.0) < 0.5) {
    float lane = sign(q.x - riverX(q.y));
    float s = q.y * 0.9 + lane * uGTime * 12.0;
    float fs = fract(s) - 0.5;
    float blob = step(0.6, hash11(floor(s))) * exp(-fs * fs / 0.01);
    vec3 cc = lane > 0.0 ? vec3(1.0, 0.95, 0.85) : vec3(1.0, 0.15, 0.08);
    col += cc * blob * exp(-pow(abs(bank - 2.0) / 0.2, 2.0)) * cars * 2.5 * smoothstep(uCity * 1.3, uCity * 0.5, r);
  }
  return col;
}

// ---------------------------------------------------------------- shading
vec3 vegetation(float season) {
  vec3 spring = vec3(0.1, 0.16, 0.045), summer = vec3(0.075, 0.12, 0.035);
  vec3 autumn = vec3(0.14, 0.13, 0.05), winter = vec3(0.1, 0.12, 0.06);
  float s = season * 4.0;
  vec3 a = s < 1.0 ? spring : s < 2.0 ? summer : s < 3.0 ? autumn : winter;
  vec3 b = s < 1.0 ? summer : s < 2.0 ? autumn : s < 3.0 ? winter : spring;
  return mix(a, b, smoothstep(0.6, 1.0, fract(s)));
}

vec3 groundAlbedo(vec3 p, vec3 n) {
  vec2 q = p.xz;
  float r = cityR(q);
  float bank = bankDist(q);
  vec3 veg = vegetation(uSeason);
  vec3 col = veg * (0.55 + 0.9 * fbm(q * 0.12, 3)) * (0.85 + 0.3 * fbm(q * 1.1, 2));
  // Forests on the hills, cleared as the valley fills.
  float forest = smoothstep(0.52, 0.6, fbm(q * 0.045 + 7.0, 3)) * smoothstep(10.0, 30.0, bank);
  forest *= 1.0 - smoothstep(uFields * 1.1, uFields * 0.6, r) * 0.9;
  col = mix(col, vec3(0.04, 0.08, 0.03) * (0.7 + 0.6 * fbm(q * 0.6, 2)), forest);
  // Rock on steep slopes (limestone cliffs on the acropolis); sand on the plateau and the beach.
  float lime = smoothstep(12.0, 8.0, length((q - ACROPOLIS) * vec2(1.0, 1.3)));
  col = mix(col, mix(vec3(0.32, 0.29, 0.25), vec3(0.5, 0.46, 0.38), lime) * (0.8 + 0.4 * fbm(q * 2.0, 2)), smoothstep(0.75, 0.45, n.y));
  float pl = smoothstep(30.0, 20.0, length((q - PLATEAU) * vec2(1.0, 0.75)));
  col = mix(col, vec3(0.62, 0.52, 0.36), pl);
  col = mix(col, vec3(0.6, 0.55, 0.42), smoothstep(-14.0, -4.0, q.y - coastZ(q.x)));
  // Farmland: a patchwork of plots along the valley floor.
  float farm = smoothstep(uFields, uFields * 0.8, r * (0.9 + 0.2 * hash12(floor(q / 9.0)))) * smoothstep(26.0, 18.0, bank);
  vec3 tt = terrainTex(q);
  float flatness = 1.0 - smoothstep(0.03, 0.12, length(tt.yz));
  farm *= flatness * smoothstep(8.0, 11.0, length((q - ACROPOLIS) * vec2(1.0, 1.3)));
  if (farm > 0.0) {
    vec2 fq = q / vec2(3.2, 5.0);
    vec2 id = floor(fq);
    vec3 hh = hash32(id + 5.0);
    vec2 f = fract(fq);
    float edge = smoothstep(0.0, 0.06, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    float ripe = fract(uSeason + hh.x * 0.3);
    vec3 crop = hh.y < 0.33 ? mix(vec3(0.12, 0.2, 0.04), vec3(0.38, 0.3, 0.11), smoothstep(0.3, 0.7, ripe))
              : hh.y < 0.66 ? mix(vec3(0.09, 0.16, 0.035), vec3(0.28, 0.26, 0.09), smoothstep(0.4, 0.8, ripe))
                            : vec3(0.2, 0.14, 0.085);
    crop *= 0.85 + 0.3 * hh.z;
    col = mix(col, mix(vec3(0.12, 0.1, 0.06), crop, edge), farm);
  }
  // Town ground: packed earth and roads, later paving and asphalt.
  float reach = mix(24.0, 44.0, yearMix(1880.0, 1960.0));
  float town = smoothstep(uCity + 2.0, uCity - 4.0, r) * step(0.8, bank) * smoothstep(reach + 2.0, reach - 2.0, bank);
  town *= (1.0 - smoothstep(0.08, 0.3, length(tt.yz))) * (reserved((floor(q / CELL) + 0.5) * CELL) ? 0.0 : 1.0);
  if (town > 0.0) {
    vec3 paved = mix(vec3(0.34, 0.29, 0.22), vec3(0.2, 0.2, 0.21), yearMix(1850.0, 1950.0));
    vec2 f = fract(q / CELL);
    float street = 1.0 - smoothstep(0.03, 0.07, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    vec3 ground = mix(paved, paved * 0.6, street);
    // Empty lots are gardens and parks.
    float park = step(hash32(floor(q / CELL) + 17.0).y, 0.1);
    vec3 trees = veg * (0.7 + 0.8 * step(0.55, fbm(q * 3.0, 2)));
    ground = mix(ground, trees, park * (1.0 - street * 0.7));
    col = mix(col, ground, town * 0.92);
  }
  return col;
}

vec3 buildingAlbedo(vec3 p, vec3 n, out vec3 emit) {
  vec2 c = floor(p.xz / CELL);
  vec2 off; vec3 h;
  vec4 b = cellBuilding(c, off, h);
  float modern = yearMix(1890.0, 1950.0);
  vec3 ancient = mix(vec3(0.55, 0.45, 0.32), vec3(0.62, 0.56, 0.47), yearMix(-1500.0, 800.0));
  vec3 brick = vec3(0.42, 0.24, 0.17);
  vec3 concrete = mix(vec3(0.52, 0.53, 0.55), vec3(0.26, 0.34, 0.42), step(0.55, h.y) * uTowers);
  vec3 wall = mix(ancient, brick, yearMix(1700.0, 1850.0) * step(0.4, h.x));
  wall = mix(wall, concrete, modern);
  wall *= 0.8 + 0.4 * h.z;
  wall = mix(wall, wall * vec3(1.08, 0.97, 0.9), step(0.5, fract(h.x * 7.0)));
  vec3 roof = mix(vec3(0.4, 0.33, 0.22), vec3(0.44, 0.24, 0.16), yearMix(-800.0, 400.0));
  vec3 flatRoof = h.z < 0.3 ? vec3(0.22, 0.3, 0.2) : h.z < 0.7 ? vec3(0.3, 0.29, 0.28) : vec3(0.36, 0.3, 0.26);
  roof = mix(roof, flatRoof, modern);
  emit = vec3(0.0);
  float nl = nightLights();
  bool vertical = abs(n.y) < 0.5;
  if (!vertical) return roof * (0.85 + 0.3 * h.y);
  // Windows: floors of 3.5 m, bays of 3.2 m.
  float u = abs(n.x) > abs(n.z) ? p.z : p.x;
  float v = p.y - b.w;
  vec2 cellW = vec2(u / 0.32, v / 0.35);
  vec2 f = fract(cellW);
  float win = step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.8) * step(0.35, v);
  vec3 hw = hash33(vec3(floor(cellW), dot(c, vec2(1.0, 57.0)) + uNight * 13.0));
  float pLit = mix(0.07, 0.1, yearMix(-1000.0, 1500.0));
  pLit = mix(pLit, 0.14, yearMix(1800.0, 1900.0));
  pLit = mix(pLit, 0.26, yearMix(1910.0, 1960.0));
  vec3 lampC = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.62, 0.3), yearMix(1850.0, 1920.0));
  lampC = mix(lampC, vec3(0.78, 0.86, 1.0), step(0.75, hw.y) * step(6.0, b.z) * uTowers);
  float bright = mix(2.0, 2.4, yearMix(1880.0, 1950.0));
  emit = lampC * win * step(hw.x, pLit) * nl * bright * (0.6 + 0.8 * hw.z);
  // By day, glass reads darker (and mirrors the sky on towers).
  return mix(wall, wall * 0.45, win * (0.4 + 0.5 * modern));
}

vec3 shadeHit(vec3 p, vec3 rd, float t, int mat, vec3 sd) {
  vec3 n = mat == 0 ? terrainNormal(p.xz) : normalAt(p, t);
  float day = dayAmt(sd);
  float golden = exp(-sd.y * sd.y / 0.025);
  vec3 emit = vec3(0.0);
  vec3 alb;
  if (mat == 1) alb = buildingAlbedo(p, n, emit);
  else if (mat == 2) alb = vec3(0.86, 0.8, 0.66);                      // limestone casing
  else if (mat == 3) alb = vec3(0.86, 0.84, 0.8);                      // marble
  else if (mat == 4) alb = vec3(0.6, 0.47, 0.32);                      // mudbrick
  else if (mat == 5) alb = vec3(0.55, 0.52, 0.47);                     // stone
  else if (mat == 6) alb = vec3(0.35, 0.2, 0.15);                      // soot-stained brick
  else if (mat == 7) alb = vec3(0.62, 0.62, 0.6);                      // concrete
  else if (mat == 8) alb = vec3(0.8, 0.8, 0.82);
  else alb = groundAlbedo(p, n);
  // Sun, sky, a little bounce; moonlight at night.
  vec3 sunC = mix(vec3(1.0, 0.5, 0.25), vec3(1.0, 0.93, 0.82), smoothstep(0.02, 0.35, sd.y)) * 4.4;
  float diff = max(dot(n, sd), 0.0);
  float sh = diff > 0.0 && sd.y > -0.02 ? (t < 240.0 ? softShadow(p + n * 0.12, sd) : 1.0) : 0.0;
  // Clouds shade the ground.
  float cs = 1.0;
  if (sd.y > 0.02) cs = 1.0 - 0.55 * cloudCover(p.xz + sd.xz / sd.y * (CLOUD_Y - p.y));
  float ao = mat != 0 && t < 160.0 ? ambientOcc(p, n) : 1.0;
  vec3 skyAmb = mix(vec3(0.035, 0.05, 0.09), vec3(0.19, 0.26, 0.38), day) + vec3(0.3, 0.15, 0.1) * golden * 0.3;
  vec3 moon = normalize(vec3(0.4, 0.55, 0.7));
  vec3 moonC = vec3(0.15, 0.19, 0.28) * (1.0 - day) * max(dot(n, moon), 0.0);
  vec3 col = alb * (sunC * diff * sh * cs * smoothstep(-0.03, 0.05, sd.y) + skyAmb * (0.55 + 0.45 * n.y) * ao + moonC);
  col += alb * vec3(0.3, 0.25, 0.2) * day * 0.15 * max(-n.y, 0.0);
  // The city's own glow at night.
  col += alb * vec3(1.0, 0.55, 0.25) * 0.04 * (uTowers + 0.3 * yearMix(1880.0, 1930.0)) * (1.0 - day) * exp(-cityR(p.xz) / 60.0) * ao;
  col += emit;
  if (mat == 0) col += groundLights(p.xz, t) * nightLights();
  // Aircraft warning lights on the tallest towers.
  if (mat == 1 && uTowers > 0.5) {
    vec2 c = floor(p.xz / CELL);
    vec2 off; vec3 h;
    vec4 b = cellBuilding(c, off, h);
    float blink = step(0.5, fract(uGTime * 0.8 + h.x));
    col += vec3(1.0, 0.05, 0.02) * 30.0 * step(12.0, b.z) * blink * nightLights() * exp(-pow(length(vec3(p.x - (c.x + 0.5) * CELL - off.x, p.y - b.w - b.z, p.z - (c.y + 0.5) * CELL - off.y)) / 0.15, 2.0));
  }
  return col;
}

vec3 shadeWater(vec3 p, vec3 rd, float t, vec3 sd) {
  vec2 q = p.xz;
  float e = 0.05;
  float w0 = gnoise(vec3(q * 1.3, uGTime * 0.6));
  float wx = gnoise(vec3((q + vec2(e, 0.0)) * 1.3, uGTime * 0.6));
  float wz = gnoise(vec3((q + vec2(0.0, e)) * 1.3, uGTime * 0.6));
  vec3 n = normalize(vec3(-(wx - w0) / e * 0.012, 1.0, -(wz - w0) / e * 0.012));
  vec3 rr = reflect(rd, n);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
  vec3 refl = skyCol(rr, sd);
  vec4 cl = clouds(p, rr, sd);
  refl = mix(refl, cl.rgb, cl.a);
  float day = dayAmt(sd);
  vec3 body = mix(vec3(0.004, 0.012, 0.016), vec3(0.03, 0.08, 0.09), day);
  vec3 col = mix(body, refl, fres);
  // The city's lights shimmer on the river at night.
  float nl = nightLights();
  if (nl > 0.0) {
    float shimmer = 0.5 + 0.5 * gnoise(vec3(q.x * 3.0, q.y * 0.4, uGTime * 2.0));
    float town = smoothstep(uCity + 6.0, uCity - 6.0, cityR(q));
    vec3 lampC = mix(vec3(1.0, 0.5, 0.15), vec3(1.0, 0.7, 0.4), yearMix(1850.0, 1920.0));
    float amt = mix(0.08, 0.6, yearMix(1850.0, 1960.0));
    col += lampC * town * shimmer * shimmer * amt * nl * 0.5;
  }
  return col;
}

// ---------------------------------------------------------------- smoke, steam, exhaust
// Density of a plume rising from `base` and drifting with the wind, seen along a ray.
float plume(vec3 ro, vec3 rd, float tHit, vec3 base, float height, float width, float seed) {
  vec3 mid = base + vec3(0.45, 0.5, 0.125) * height;
  vec3 om = mid - ro;
  float am = dot(om, rd);
  if (length(om - rd * am) > height * 0.75 + width * 2.5) return 0.0;
  float acc = 0.0;
  for (int k = 0; k < 9; k++) {
    float s = (float(k) + 0.5) / 9.0;
    vec3 c = base + vec3(s * height * 0.9, s * height, s * height * 0.25);
    vec3 oc = c - ro;
    float along = dot(oc, rd);
    if (along < 0.0 || along > tHit) continue;
    float dist = length(oc - rd * along);
    float r = width * (0.5 + 1.8 * s);
    float n = fbm(vec3(c.xz * 0.3 + seed, uGTime * 0.4 + s * 3.0), 3);
    acc += exp(-dist * dist / (r * r)) * (0.5 + n) * (1.0 - s);
  }
  return acc;
}

void main() {
  vec2 pp = centered(vUv, uAspect);
  vec3 ro = uCamPos;
  vec3 rd = camRay(pp);
  vec3 sd = sunDir();
  float day = dayAmt(sd);

  // March.
  float t = 0.5, tPrev = 0.5;
  float tMax = 900.0;
  bool hit = false;
  for (int i = 0; i < 280; i++) {
    vec3 p = ro + rd * t;
    if (p.y > 60.0 && rd.y > 0.0) break;
    float d = map(p);
    if (d < 0.0012 * t) { hit = true; break; }
    tPrev = t;
    t += min(d, cityStep(p));
    if (t > tMax) break;
  }
  // On curved, steep ground a step can overshoot below the surface; bisect back onto it so the
  // shading (shadow rays especially) starts outside.
  if (hit) {
    float a = tPrev, b = t;
    for (int k = 0; k < 6; k++) {
      float m = 0.5 * (a + b);
      if (map(ro + rd * m) < 0.0) b = m; else a = m;
    }
    t = 0.5 * (a + b);
  }
  // Water plane (river and sea).
  float tw = rd.y < 0.0 ? (0.0 - ro.y) / rd.y : 1e9;
  vec3 col;
  float tScene = hit ? t : 1e9;
  if (tw < tScene && tw < tMax) {
    vec3 p = ro + rd * tw;
    col = shadeWater(p, rd, tw, sd);
    col = fog(col, tw, rd, sd);
    tScene = tw;
  } else if (hit) {
    vec3 p = ro + rd * t;
    col = shadeHit(p, rd, t, material(p), sd);
    col = fog(col, t, rd, sd);
  } else {
    col = skyCol(rd, sd) + stars(rd, sd);
    vec4 cl = clouds(ro, rd, sd);
    col = mix(col, cl.rgb, cl.a);
  }

  // Industrial smoke and power-station steam, in front of whatever the ray hit.
  float ch = chimneyAmt();
  if (ch > 0.0) {
    float sm = 0.0;
    for (int i = 0; i < 7; i++) sm += plume(ro, rd, tScene, chimneyPos(i) + vec3(0.0, 5.5 * ch, 0.0), 22.0, 1.7, float(i));
    vec3 smokeC = mix(vec3(0.02, 0.02, 0.025), vec3(0.2, 0.185, 0.175), day);
    col = mix(col, smokeC, clamp(sm * 1.1 * ch, 0.0, 0.82));
  }
  float pa = plantAmt();
  if (pa > 0.0) {
    float st = 0.0;
    for (int i = 0; i < 2; i++) st += plume(ro, rd, tScene, PLANT + vec3(float(i) * 6.0 - 3.0, 7.0 * pa, float(i) * 2.0), 12.0, 1.8, float(i) + 11.0);
    vec3 steamC = mix(vec3(0.05, 0.05, 0.07), vec3(0.85, 0.86, 0.88), day) + vec3(1.0, 0.5, 0.2) * 0.04 * (1.0 - day);
    col = mix(col, steamC, clamp(st * 0.3 * pa, 0.0, 0.8));
  }

  // Launch: exhaust flame, smoke column lit from within, and the glow it throws around.
  if (uLaunch > 0.0) {
    vec3 rp = rocketPos();
    float ign = smoothstep(0.0, 0.4, uLaunch);
    // Flame just below the rocket.
    vec3 fc = rp - vec3(0.0, 0.6 + 0.4 * sin(uGTime * 40.0) * 0.1, 0.0);
    vec3 oc = fc - ro;
    float along = dot(oc, rd);
    float dist = length(oc - rd * along);
    float px = pixelAngle(uRes.y) * along;
    float flame = exp(-dist * dist / (0.09 + px * px * 4.0)) * step(0.0, along);
    col += vec3(1.0, 0.75, 0.4) * flame * 60.0 * ign;
    col += vec3(1.0, 0.6, 0.3) * exp(-dist / (3.0 + 0.02 * along)) * 0.6 * ign;
    // Exhaust trail: a glowing line from the pad to the rocket, fading with age.
    vec3 a = PAD + vec3(0.0, 0.3, 0.0), b = rp;
    vec3 ba = b - a;
    float trailLen = length(ba);
    if (trailLen > 0.1) {
      // Closest points between the view ray and the trail segment.
      vec3 w0 = ro - a;
      float bb = dot(ba, ba), bd = dot(ba, rd), be = dot(ba, w0), de = dot(rd, w0);
      float den = bb - bd * bd;
      float s = clamp((be - bd * de) / max(den, 1e-6), 0.0, 1.0);
      float tr = max(dot(a + ba * s - ro, rd), 0.0);
      float dd = length(ro + rd * tr - (a + ba * s));
      float width = 0.25 + 1.6 * (1.0 - s) * min(uLaunch * 0.4, 1.0);
      float smoke = exp(-dd * dd / (width * width)) * step(tr, tScene + 5.0);
      vec3 smokeC = mix(vec3(1.0, 0.6, 0.3) * 2.0, vec3(0.5, 0.45, 0.42), smoothstep(0.7, 0.2, s));
      col = mix(col, smokeC * (0.35 + 0.65 * smoothstep(0.0, 0.9, s)), clamp(smoke * 0.8, 0.0, 0.9));
      col += vec3(1.0, 0.7, 0.4) * exp(-dd * dd / (0.05 + 0.002 * tr)) * smoothstep(0.75, 1.0, s) * 8.0;
    }
    // The launch cloud billows out from the pad and glows from within.
    vec3 lc = PAD + vec3(0.0, 1.2 + 0.7 * uLaunch, 0.0);
    float lr = 1.5 + 6.5 * (1.0 - exp(-uLaunch * 0.7));
    vec3 lo = lc - ro;
    float la = dot(lo, rd);
    float ld = length(lo - rd * la);
    if (la > 0.0 && la < tScene + lr && ld < lr) {
      vec3 lp = ro + rd * la;
      float dens = smoothstep(lr, lr * 0.35, ld) * (0.55 + 0.9 * fbm(vec3(lp.xy * 0.5, uGTime * 0.4 + uLaunch), 3));
      float low = smoothstep(lr, -lr * 0.5, lp.y - PAD.y);
      vec3 cloudC = mix(vec3(0.22, 0.2, 0.2), vec3(1.0, 0.55, 0.25) * 2.5, low * exp(-uLaunch * 0.25));
      col = mix(col, cloudC, clamp(dens * 0.85, 0.0, 0.92) * ign);
    }
    // Clouds and ground near the pad catch the light.
    col += vec3(1.0, 0.55, 0.25) * 0.4 * ign * exp(-length(ro + rd * min(tScene, 800.0) - rp) / 25.0);
  }

  // The first aeroplanes.
  if (uPlane > 0.0 && uPlane < 1.0) {
    vec3 P = vec3(55.0 - uPlane * 110.0, 21.0 + 1.5 * sin(uPlane * 5.0), 8.0);
    vec4 cl = uViewProj * vec4(P, 1.0);
    if (cl.w > 0.0) {
      vec2 sp = cl.xy / cl.w;
      vec2 q = (pp - vec2(sp.x * 0.5 * uAspect, sp.y * 0.5));
      float s = 0.9 / cl.w;
      float d = sdBiplane(q / s) * s;
      col = mix(col, vec3(0.02) + skyCol(rd, sd) * 0.15, 1.0 - smoothstep(-0.0008, 0.0008, d));
    }
  }

  fragColor = vec4(col, 1.0);
}
#endif
