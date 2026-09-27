// Giza, 2500 BCE, on a summer afternoon: Menkaure, Khafre and Khufu in their diagonal line, seen
// through a long lens from the desert to the south-west. They still wear their casing of polished
// white Tura limestone, bright against a deep blue sky, each with a sunlit face and a shadow
// face. Metres; x east, z south, y up.
#define MARCH_STEPS 150
#define SHADOW_STEPS 40
#define MARCH_RELAX 0.9
#include <noise>
#include <color>
#include <camera>
#include <sdf3>
#include <march>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uT;

const vec3 SUN = vec3(-0.8471, 0.5000, -0.1801);   // 30 deg up, a little north of west
const vec3 SUN_COL = vec3(1.0, 0.88, 0.72) * 1.7;

// Centre (x, z), base width, height; the plateau rises gently to the south-west.
const vec4 PYR[6] = vec4[6](
  vec4(0.0, 0.0, 230.0, 146.6),
  vec4(-330.0, 355.0, 215.0, 143.5),
  vec4(-610.0, 720.0, 103.0, 65.0),
  vec4(-545.0, 860.0, 44.0, 29.0),
  vec4(-610.0, 860.0, 32.0, 21.0),
  vec4(-675.0, 860.0, 32.0, 21.0)
);

float plateau(vec2 xz) { return 0.009 * (-xz.x + xz.y); }

float dunes(vec2 xz) {
  // Long transverse ridges, sharper on their crests, over broad swells.
  vec2 q = xz + 60.0 * vec2(fbm(xz * 0.002, 3), fbm(xz * 0.002 + 7.0, 3));
  float ridge = 1.0 - abs(sin(dot(q, vec2(0.0045, 0.0062))));
  float h = 9.0 * fbm(xz * 0.0016 + 3.1, 4) + 7.0 * ridge * ridge * fbm(xz * 0.004, 2) + 1.0 * fbm(xz * 0.02, 3);
  return plateau(xz) + h;
}

float ground(vec3 p) {
  // Flatten the ground under and around each pyramid (they stand on levelled bedrock).
  float h = dunes(p.xz);
  for (int i = 0; i < 3; i++) {
    vec2 d = abs(p.xz - PYR[i].xy) - PYR[i].z * 0.5;
    float m = smoothstep(60.0, 0.0, max(d.x, d.y));
    h = mix(h, plateau(PYR[i].xy), m);
  }
  return p.y - h;
}

float pyramids(vec3 p) {
  float d = 1e9;
  for (int i = 0; i < 6; i++) {
    vec4 P = PYR[i];
    vec3 q = (p - vec3(P.x, plateau(P.xy) - 0.3, P.y)) / P.z;
    d = min(d, sdPyramid(q, P.w / P.z) * P.z);
  }
  return d;
}

float mapD(vec3 p) { return min(ground(p), pyramids(p)); }

vec3 shadeSurface(vec3 p, vec3 n, vec3 rd, float t, bool stone) {
  vec3 alb;
  if (stone) {
    // Casing courses about 1.4 m high, faint joints, and a slight warmth low down (wind-blown sand).
    // (The joints fade out once a course is under about three pixels.)
    float course = smoothstep(0.035, 0.0, abs(fract(p.y / 1.42) - 0.5) - 0.465);
    float blk = hash12(floor(vec2(p.y / 1.42, (p.x + p.z) / 2.3)));
    float visible = smoothstep(4.0, 8.0, 1.42 / (t * pixelAngle(uRes.y)));
    alb = vec3(0.80, 0.74, 0.62) * (0.93 + 0.07 * blk * visible) * (1.0 - 0.2 * course * visible);
    alb *= 0.92 + 0.08 * fbm(p.xy * 0.05 + p.zy * 0.05, 3);
    alb = mix(alb, vec3(0.74, 0.6, 0.44), smoothstep(10.0, 0.0, p.y - plateau(p.xz)) * 0.5);
  } else {
    float ripple = sin(dot(p.xz, vec2(0.62, 0.35)) * 1.9 + 3.0 * fbm(p.xz * 0.05, 2));
    alb = vec3(0.74, 0.54, 0.34) * (0.8 + 0.3 * fbm(p.xz * 0.013, 4)) * (1.0 + 0.1 * ripple * smoothstep(500.0, 40.0, t));
  }
  float sh = softShadow(p + n * (0.3 + 0.0005 * t), SUN, 0.5, 1500.0, 24.0);
  float ao = calcAO(p, n, stone ? 12.0 : 25.0);
  float dif = max(dot(n, SUN), 0.0);
  // Skylight: blue from the open sky opposite the sun, warm near it.
  vec3 sky = vec3(0.2, 0.32, 0.6) * (0.5 + 0.5 * n.y);
  vec3 bounce = vec3(0.7, 0.5, 0.3) * clamp(0.5 - 0.5 * n.y, 0.0, 1.0) * 0.55;
  vec3 col = alb * (SUN_COL * dif * sh + (sky * 0.4 + bounce) * ao);
  // Polished limestone: a soft sheen towards the sun.
  if (stone) col += SUN_COL * 0.06 * pow(max(dot(reflect(rd, n), SUN), 0.0), 12.0) * sh;
  return col;
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  float pix = pixelAngle(uRes.y);
  // A deep blue desert sky over a thin band of dusty haze at the horizon; the air shimmers
  // just above the hot sand.
  rd.y += 0.0012 * gnoise(vec2(rd.x * 300.0, uT * 3.0)) * exp(-max(rd.y, 0.0) * 200.0);
  float away = 0.5 - 0.5 * dot(normalize(rd.xz), normalize(SUN.xz));
  vec3 horizon = mix(vec3(0.3, 0.42, 0.62), vec3(0.24, 0.38, 0.62), away);
  vec3 zenith = vec3(0.03, 0.09, 0.3);
  vec3 col = skyColor(rd, SUN, zenith, horizon, SUN_COL * 0.3);
  vec3 dust = vec3(0.62, 0.55, 0.46);
  col = mix(col, dust, exp(-max(rd.y, 0.0) / 0.018));
  // High cirrus.
  if (rd.y > 0.0) {
    vec2 cq = rd.xz / (rd.y + 0.08) * 1.6 + vec2(uT * 0.01, 0.0);
    float ci = smoothstep(0.55, 0.85, fbm(cq * vec2(1.0, 4.0) + fbm(cq * 2.0, 3), 5)) * smoothstep(0.0, 0.2, rd.y);
    col = mix(col, vec3(1.25, 1.2, 1.15), ci * 0.45);
  }
  float t = march(ro, rd, 1.0, 8000.0, pix * 0.5);
  if (t > 0.0) {
    vec3 pos = ro + rd * t;
    bool stone = pyramids(pos) < ground(pos);
    vec3 n = calcNormal(pos, max(0.02, t * pix));
    vec3 c = shadeSurface(pos, n, rd, t, stone);
    col = applyFog(c, t, rd, SUN, dust * 0.95, SUN_COL * 0.05, 1.0 / 6000.0);
  }
  fragColor = vec4(col, 1.0);
}
