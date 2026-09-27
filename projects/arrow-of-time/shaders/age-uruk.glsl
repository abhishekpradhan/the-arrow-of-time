// Cities, 4000 BCE: Uruk at dusk. The whitewashed temple on its high terrace catches the last light
// of the west; below it a sea of flat mud-brick roofs where lamps are being lit, smoke rising from
// the hearths, date palms along a canal of the Euphrates. The camera glides in over the rooftops.
// Metres; the camera looks west (-z), y up.
#define MARCH_STEPS 160
#define SHADOW_STEPS 1
#include <noise>
#include <color>
#include <camera>
#include <sdf3>
#include <march>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uT;

const vec3 WEST = vec3(0.0, 0.0, -1.0);
const float CELL = 9.0;
const vec3 TEMPLE = vec3(0.0, 0.0, -150.0);   // centre of the terrace

// ---------------------------------------------------------------- the city
// One house per cell (or an open yard), with a small lit door on some.
vec4 house(vec2 id) {
  vec4 h = hash42(id + 17.0);
  // w: half width x, half depth z, height, lit
  return vec4(2.6 + 1.6 * h.x, 2.6 + 1.6 * h.y, 3.0 + 3.2 * h.z * h.z, h.w);
}

bool open(vec2 id) {
  // Streets, the canal and the temple precinct stay free of houses.
  float street = step(0.82, hash12(id * 1.7 + 3.0));
  bool canal = abs(id.x * CELL - 38.0 - 6.0 * sin(id.y * CELL * 0.02)) < 11.0;
  bool precinct = length((id * CELL - TEMPLE.xz) / vec2(1.0, 0.9)) < 48.0;
  return street > 0.5 || canal || precinct;
}

float city(vec3 p) {
  vec2 id0 = floor(p.xz / CELL);
  float d = 1e9;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = id0 + vec2(i, j);
      if (open(id)) continue;
      vec4 h = house(id);
      vec2 c = (id + 0.5) * CELL + (hash22(id) - 0.5) * (CELL - 2.0 * h.xy - 0.6);
      vec3 q = p - vec3(c.x, h.z * 0.5, c.y);
      float b = sdBox(q, vec3(h.x, h.z * 0.5, h.y));
      // A low parapet around the roof.
      b = max(b, -sdBox(q - vec3(0.0, h.z * 0.5, 0.0), vec3(h.x - 0.25, 0.35, h.y - 0.25)));
      d = min(d, b);
    }
  }
  // Only the 3 x 3 cells around p are tested; anything farther is at least a cell away.
  return min(d, CELL);
}

// The terrace: battered mud-brick walls 13 m high, and a stair on its east side.
float terrace(vec3 p) {
  vec3 q = p - TEMPLE;
  float w = 26.0 - 0.3 * q.y;
  float t = max(max(abs(q.x) - w, abs(q.z) - w * 0.85), max(q.y - 13.0, -q.y));
  // Buttresses along the walls.
  float bt = abs(fract(q.x / 4.0) - 0.5) < 0.12 || abs(fract(q.z / 4.0) - 0.5) < 0.12 ? 0.35 : 0.0;
  t -= bt * step(q.y, 12.5);
  vec3 s = q - vec3(0.0, 6.5, w * 0.85 + 6.0);
  float stair = max(sdBox(s, vec3(4.0, 6.5, 7.0)), (s.y - 6.5) + (s.z + 7.0) * 0.93 - 0.3);
  return min(t, stair);
}

// The White Temple on top: gypsum-washed walls with deep niches.
float temple(vec3 p) {
  vec3 q = p - TEMPLE - vec3(0.0, 13.0 + 3.2, -2.0);
  float b = sdBox(q, vec3(11.0, 3.2, 8.5));
  float niche = sdBox(vec3(abs(fract(q.x / 2.2 + 0.25) - 0.5) * 2.2, q.y + 0.4, abs(q.z) - 8.5), vec3(0.35, 2.4, 0.3));
  float nicheZ = sdBox(vec3(abs(q.x) - 11.0, q.y + 0.4, abs(fract(q.z / 2.2 + 0.25) - 0.5) * 2.2), vec3(0.3, 2.4, 0.35));
  return max(b, -min(niche, nicheZ));
}

// Date palms along the canal: a curving trunk and a crown of drooping fronds.
float palms(vec3 p, out float frond) {
  frond = 1e9;
  float d = 1e9;
  vec2 cid = floor(p.xz / 14.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = cid + vec2(i, j);
      vec3 h = hash32(id * 3.1);
      vec2 base = (id + 0.5 + (h.xy - 0.5) * 0.6) * 14.0;
      // Only near the canal and on the edge of the precinct.
      float nearCanal = abs(base.x - 38.0 - 6.0 * sin(base.y * 0.02)) - 13.0;
      if (nearCanal > 4.0 || h.z < 0.35) continue;
      float H = 11.0 + 5.0 * h.z;
      vec3 top = vec3(base.x + 1.2 * sin(h.x * 6.0), H, base.y + 1.2 * cos(h.y * 6.0));
      d = min(d, sdTaper(p, vec3(base.x, 0.0, base.y), top, 0.32, 0.22));
      vec3 q = p - top;
      float r = length(q.xz);
      float a = atan(q.z, q.x);
      // Nine fronds arching up and out, then down: the angular gap between them widens outwards.
      float blade = abs(fract(a / 6.2832 * 9.0 + h.x) - 0.5) * 6.2832 / 9.0 * r;
      float arch = q.y - (0.9 * r - 0.28 * r * r);
      float f = max(max(abs(arch) - 0.12, r - 4.6), blade - 0.3 * (1.0 - r / 5.0) - 0.04);
      frond = min(frond, f * 0.7);
    }
  }
  return min(min(d, frond), 14.0);
}

float ground(vec3 p) {
  // The canal is cut 2 m into the plain.
  float cx = p.x - 38.0 - 6.0 * sin(p.z * 0.02);
  float canal = smoothstep(9.0, 6.0, abs(cx)) * 2.0;
  return p.y + canal - 0.3 * fbm(p.xz * 0.05, 2);
}

float mapD(vec3 p) {
  float f;
  float d = min(ground(p), city(p));
  d = min(d, min(terrace(p), temple(p)));
  if (p.y < 18.0) d = min(d, palms(p, f));
  return d;
}

// ---------------------------------------------------------------- light
vec3 skyDusk(vec3 rd) {
  float e = max(rd.y, 0.0);
  float w = max(dot(normalize(vec3(rd.x, 0.0, rd.z)), WEST), 0.0);
  // The afterglow: a band of orange low in the west under a deepening blue.
  vec3 glow = mix(vec3(0.5, 0.2, 0.1), vec3(1.0, 0.48, 0.16), pow(w, 6.0)) * pow(w, 2.0);
  vec3 col = vec3(0.035, 0.05, 0.13) + glow * exp(-e / 0.05);
  col = mix(col, vec3(0.09, 0.08, 0.18), smoothstep(0.02, 0.16, e) * 0.6);
  col = mix(col, vec3(0.015, 0.03, 0.09), smoothstep(0.12, 0.6, e));
  // The first stars.
  vec3 sd = rd * 300.0;
  float star = smoothstep(0.985, 1.0, hash13(floor(sd))) * smoothstep(0.2, 0.5, e);
  return col + vec3(0.6, 0.7, 1.0) * star * 0.6;
}

vec3 skyLight(vec3 n) {
  // Light from the dusk sky: warm from the west, blue from above and the east.
  float w = max(dot(n, WEST), 0.0);
  return vec3(0.045, 0.06, 0.13) * (0.6 + 0.4 * n.y) + vec3(0.4, 0.18, 0.07) * w * w * 0.5;
}

// Lamps: a warm door or window glowing on the lit houses, and the pool of light it casts.
vec3 lamps(vec3 p, vec3 n) {
  vec2 id0 = floor(p.xz / CELL);
  vec3 L = vec3(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = id0 + vec2(i, j);
      if (open(id)) continue;
      vec4 h = house(id);
      if (h.w < 0.45) continue;
      vec2 c = (id + 0.5) * CELL + (hash22(id) - 0.5) * (CELL - 2.0 * h.xy - 0.6);
      vec3 lp = vec3(c.x, 1.1, c.y + h.y + 0.9);
      vec3 dl = lp - p;
      float r2 = dot(dl, dl);
      L += vec3(1.0, 0.55, 0.22) * 5.0 * max(dot(n, normalize(dl)), 0.0) / (r2 + 1.0);
    }
  }
  return L;
}

vec3 shade(vec3 pos, vec3 rd, float t) {
  vec3 n = calcNormal(pos, max(0.005, t * 0.0015));
  float ao = calcAO(pos, n, 3.0);
  float fr;
  float dPalm = pos.y < 18.0 ? palms(pos, fr) : 1e9;
  float dTemple = temple(pos), dTerr = terrace(pos), dCity = city(pos), dGround = ground(pos);
  float m = min(min(dPalm, dTemple), min(dTerr, min(dCity, dGround)));
  vec3 alb;
  vec3 emit = vec3(0.0);
  if (m == dTemple) {
    alb = vec3(0.92, 0.9, 0.84);     // gypsum whitewash
  } else if (m == dTerr) {
    alb = vec3(0.55, 0.42, 0.3) * (0.85 + 0.15 * fbm(pos.xy * 0.8, 3));
  } else if (m == dPalm) {
    alb = fr < 0.2 ? vec3(0.1, 0.14, 0.06) : vec3(0.22, 0.17, 0.12);
  } else if (m == dCity) {
    vec2 id = floor(pos.xz / CELL);
    alb = vec3(0.6, 0.47, 0.34) * (0.8 + 0.3 * hash12(id));
    // Lit doorways: a warm rectangle low on the house's south wall.
    vec4 h = house(id);
    vec2 c = (id + 0.5) * CELL + (hash22(id) - 0.5) * (CELL - 2.0 * h.xy - 0.6);
    vec3 q = pos - vec3(c.x, 0.0, c.y);
    if (h.w > 0.45 && n.z > 0.5) emit = vec3(1.0, 0.5, 0.18) * 2.5 * step(abs(q.x), 0.5) * step(q.y, 1.9) * (0.8 + 0.2 * sin(uT * 9.0 + h.w * 40.0));
  } else {
    float cx = pos.x - 38.0 - 6.0 * sin(pos.z * 0.02);
    alb = abs(cx) < 7.0 ? vec3(0.03, 0.05, 0.07) : vec3(0.42, 0.34, 0.25);
  }
  vec3 col = alb * (skyLight(n) * ao + lamps(pos, n)) + emit;
  // The canal mirrors the dusk sky.
  float cx = pos.x - 38.0 - 6.0 * sin(pos.z * 0.02);
  if (m == dGround && abs(cx) < 7.0) {
    vec3 rr = reflect(rd, vec3(0.0, 1.0, 0.0));
    rr.xz += 0.02 * vec2(gnoise(pos.xz * 0.3 + uT), gnoise(pos.zx * 0.3 - uT));
    col = mix(col, skyDusk(normalize(rr)) * 0.8, 0.85);
  }
  // A sacred fire on the terrace lights the temple front.
  vec3 fire = TEMPLE + vec3(0.0, 13.8, 10.0);
  vec3 df = fire - pos;
  col += alb * vec3(1.0, 0.5, 0.2) * 120.0 * max(dot(n, normalize(df)), 0.0) / (dot(df, df) + 4.0) * (0.85 + 0.15 * sin(uT * 13.0));
  return col;
}

// Hearth smoke drifting up from a few roofs.
float smoke(vec3 ro, vec3 rd, float tmax) {
  float acc = 0.0;
  for (int i = 0; i < 6; i++) {
    vec2 id = vec2(float(i) * 3.0 - 8.0, -6.0 - float(i) * 1.7);
    vec3 h = hash32(id);
    vec3 base = vec3((id.x + 0.5) * CELL, 5.0, (id.y + 0.5) * CELL);
    // The column bends with the breeze; sample it where the ray passes closest.
    vec3 axis = normalize(vec3(0.35, 1.0, 0.1));
    vec3 w = base - ro;
    vec3 c = cross(rd, axis);
    float s = dot(cross(w, axis), c) / max(dot(c, c), 1e-4);
    if (s < 0.0 || s > tmax) continue;
    vec3 pt = ro + rd * s;
    float along = dot(pt - base, axis);
    float r = length(pt - base - axis * along);
    float width = 0.6 + 0.12 * along;
    float n = fbm(vec2(along * 0.25 - uT * 0.8, r * 0.4 + h.x * 10.0), 3);
    acc += exp(-r * r / (width * width)) * smoothstep(0.0, 3.0, along) * smoothstep(40.0, 15.0, along) * n * 0.35;
  }
  return clamp(acc, 0.0, 0.6);
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  float pix = pixelAngle(uRes.y);
  vec3 col = skyDusk(rd);
  float t = march(ro, rd, 0.5, 900.0, pix * 0.6);
  float tm = 900.0;
  if (t > 0.0) {
    tm = t;
    vec3 c = shade(ro + rd * t, rd, t);
    // Evening haze, the colour of the sky just above the horizon.
    float f = 1.0 - exp(-t * 0.0022);
    col = mix(c, skyDusk(normalize(vec3(rd.x, 0.015, rd.z))), f);
  }
  float sm = smoke(ro, rd, tm);
  col = mix(col, vec3(0.05, 0.05, 0.08), sm);
  fragColor = vec4(col, 1.0);
}
