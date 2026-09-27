// Flight, 1903: the Wright Flyer a few metres above the sand at Kill Devil Hills, on a cold,
// bright December morning. Canard elevator in front, twin rudders behind, two pusher propellers,
// Orville lying on the lower wing; its launching rail on the sand below, the Atlantic beyond the
// dunes, Wilbur running alongside. The camera tracks with it. Metres; it flies along +x, y up.
#define MARCH_STEPS 150
#define SHADOW_STEPS 36
#include <noise>
#include <color>
#include <camera>
#include <sdf3>
#include <march>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uT;
uniform vec3 uFlyer;      // centre of the lower wing
uniform float uPitch;

const vec3 SUN = vec3(-0.3417, 0.4556, -0.8222);   // mid-morning, behind the camera's left shoulder
const vec3 SUN_COL = vec3(1.0, 0.95, 0.86) * 2.6;

// ---------------------------------------------------------------- the Flyer (local frame)
// x forward, y up, z along the span; returns distance and a material (0 fabric, 1 wood, 2 dark).
float flyer(vec3 p, out float mat) {
  mat = 0.0;
  vec3 q = p - uFlyer;
  q.xy = rot2(-uPitch) * q.xy;
  // Wings: 12.3 m span, 2 m chord, 1.8 m apart, cambered.
  // Thin cambered sheets: distance to the curved mid-surface, bounded by chord and span.
  float camber = 0.07 * (1.0 - q.x * q.x);
  vec2 bounds = vec2(abs(q.x) - 1.0, abs(q.z) - 6.15);
  float edge = max(bounds.x, bounds.y);
  float wingL = max(abs(q.y - camber) - 0.012, edge) * 0.8;
  float wingU = max(abs(q.y - 1.8 - camber) - 0.012, edge) * 0.8;
  float wings = min(wingL, wingU);
  // Struts between the wings, front and rear spars.
  float sid;
  float sz = repLim1(q.z, 1.9, 3.0, sid);
  float struts = min(sdCapsule(vec3(q.x - 0.8, q.y, sz), vec3(0.0), vec3(0.0, 1.8, 0.0), 0.02),
                     sdCapsule(vec3(q.x + 0.8, q.y, sz), vec3(0.0), vec3(0.0, 1.8, 0.0), 0.02));
  // Canard elevator 3.3 m ahead on outriggers, and the twin rudders 2.8 m behind.
  float elev = min(sdBox(q - vec3(3.3, 0.5, 0.0), vec3(0.4, 0.015, 2.0)), sdBox(q - vec3(3.3, 1.15, 0.0), vec3(0.4, 0.015, 2.0)));
  float booms = min(sdCapsule(vec3(q.x, q.y, abs(q.z) - 0.9), vec3(0.8, 0.1, 0.0), vec3(3.4, 0.5, 0.0), 0.025),
                    sdCapsule(vec3(q.x, q.y, abs(q.z) - 0.9), vec3(0.8, 1.7, 0.0), vec3(3.4, 1.15, 0.0), 0.025));
  float rudders = sdBox(vec3(q.x + 2.9, q.y - 0.95, abs(q.z) - 0.3), vec3(0.3, 0.9, 0.012));
  float tailBooms = sdCapsule(vec3(q.x, q.y, abs(q.z) - 0.3), vec3(-0.8, 0.2, 0.0), vec3(-2.9, 0.4, 0.0), 0.025);
  // Skids under the lower wing.
  float skids = sdCapsule(vec3(q.x, q.y, abs(q.z) - 0.9), vec3(-0.6, -0.3, 0.0), vec3(3.2, -0.25, 0.0), 0.03);
  // Orville, prone on the lower wing left of centre; the engine to the right.
  float pilot = sdCapsule(q, vec3(0.9, 0.12, -0.35), vec3(-0.6, 0.12, -0.35), 0.16);
  float engine = sdBox(q - vec3(-0.1, 0.25, 0.45), vec3(0.3, 0.2, 0.25));
  float frame = min(min(struts, booms), min(tailBooms, skids));
  float surf = min(min(wings, elev), rudders);
  float dark = min(pilot, engine);
  float d = min(min(surf, frame), dark);
  if (frame <= d + 1e-4) mat = 1.0;
  if (dark <= d + 1e-4) mat = 2.0;
  return d;
}

// The two pusher propellers, blurred into discs: returns coverage along the ray.
float propellers(vec3 ro, vec3 rd) {
  float cover = 0.0;
  for (int i = 0; i < 2; i++) {
    vec3 c = uFlyer + vec3(-1.15, 0.95, i == 0 ? -1.6 : 1.6);
    // Disc in the plane x = c.x (tilted with the pitch, ignored).
    float t = (c.x - ro.x) / rd.x;
    if (t <= 0.0) continue;
    vec3 p = ro + rd * t - c;
    float r = length(p.yz);
    float ang = atan(p.z, p.y) + uT * (i == 0 ? 40.0 : -40.0);
    float blades = 0.25 + 0.35 * pow(abs(cos(ang)), 8.0);
    cover = max(cover, smoothstep(1.3, 1.25, r) * smoothstep(0.05, 0.08, r) * blades);
  }
  return cover;
}

// ---------------------------------------------------------------- the dunes and the sea
float dunes(vec2 xz) {
  float h = 6.0 * fbm(xz * 0.012 + 3.0, 4) + 3.0 * smoothstep(-20.0, 60.0, xz.y);
  // Level sand along the flight path.
  h = mix(h, 1.0 + 0.3 * fbm(xz * 0.05, 2), smoothstep(48.0, 28.0, abs(xz.y)));
  // The sea to -z beyond the beach.
  h -= 10.0 * smoothstep(-70.0, -120.0, xz.y);
  return h;
}

float figureRun(vec3 p) {
  // Wilbur, running alongside a little behind the wing tip.
  vec3 c = vec3(uFlyer.x - 4.5, dunes(vec2(uFlyer.x - 4.5, 7.0)), 7.0);
  vec3 q = p - c;
  float stride = sin(uT * 9.0);
  float body = sdCapsule(q, vec3(0.0, 0.9, 0.0), vec3(0.1, 1.45, 0.0), 0.17);
  float head = sdSphere(q - vec3(0.14, 1.72, 0.0), 0.11);
  float legA = sdCapsule(q, vec3(0.0, 0.9, 0.08), vec3(0.35 * stride, 0.05, 0.08), 0.07);
  float legB = sdCapsule(q, vec3(0.0, 0.9, -0.08), vec3(-0.35 * stride, 0.05, -0.08), 0.07);
  float arm = sdCapsule(q, vec3(0.1, 1.4, 0.2), vec3(0.4, 1.1, 0.25), 0.05);
  return min(min(body, head), min(min(legA, legB), arm));
}

float rail(vec3 p) {
  // The 18 m launching rail the Flyer has just left, on the sand behind it.
  vec3 q = p - vec3(uFlyer.x - 30.0, dunes(vec2(uFlyer.x - 30.0, 0.0)) + 0.05, 0.0);
  return sdBox(q, vec3(9.0, 0.06, 0.05));
}

float mapD(vec3 p) {
  float m;
  float d = min(p.y - dunes(p.xz), flyer(p, m));
  d = min(d, min(figureRun(p), rail(p)));
  return d;
}

vec3 sky(vec3 rd) {
  float e = max(rd.y, 0.0);
  vec3 col = mix(vec3(0.62, 0.72, 0.84), vec3(0.14, 0.3, 0.62), pow(e, 0.45));
  col += SUN_COL * 0.3 * pow(max(dot(rd, SUN), 0.0), 16.0);
  // Fair-weather cumulus.
  if (rd.y > 0.0) {
    vec2 cq = rd.xz / (rd.y + 0.1) * 2.0 + vec2(uT * 0.03, 0.0);
    float c = smoothstep(0.45, 0.7, fbm(cq, 5));
    col = mix(col, vec3(1.0, 0.99, 0.97) * (0.8 + 0.3 * fbm(cq * 3.0, 3)), c * smoothstep(0.02, 0.15, rd.y) * 0.85);
  }
  return col;
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  float pix = pixelAngle(uRes.y);
  vec3 col = sky(rd);
  float t = march(ro, rd, 0.3, 2000.0, pix * 0.5);
  if (t > 0.0) {
    vec3 pos = ro + rd * t;
    vec3 n = calcNormal(pos, max(0.002, t * pix));
    float mF;
    float dF = flyer(pos, mF), dG = pos.y - dunes(pos.xz), dP = figureRun(pos), dR = rail(pos);
    float m = min(min(dF, dG), min(dP, dR));
    vec3 alb;
    float trans = 0.0;
    if (m == dF) {
      alb = mF == 0.0 ? vec3(0.86, 0.82, 0.72) : mF == 1.0 ? vec3(0.6, 0.48, 0.3) : vec3(0.12, 0.1, 0.09);
      trans = mF == 0.0 ? 0.35 : 0.0;   // thin muslin lets the sun through
    } else if (m == dP) {
      alb = vec3(0.12, 0.11, 0.1);
    } else if (m == dR) {
      alb = vec3(0.35, 0.26, 0.16);
    } else {
      // Sand, with wind ripples and tufts of beach grass; wet and dark at the shore.
      float ripple = sin(dot(pos.xz, vec2(1.8, 0.6)) + 2.0 * fbm(pos.xz * 0.2, 2));
      alb = vec3(0.8, 0.68, 0.5) * (0.92 + 0.08 * ripple) * (0.85 + 0.2 * fbm(pos.xz * 0.05, 3));
      float grass = smoothstep(0.62, 0.72, fbm(pos.xz * 0.6, 3)) * smoothstep(-30.0, 10.0, pos.z);
      alb = mix(alb, vec3(0.42, 0.4, 0.28), grass);
      if (pos.y < -3.5) {
        // The Atlantic: grey-blue, with lines of surf.
        vec3 wn = normalize(vec3(0.1 * gnoise(pos.xz * 0.3 + uT * 0.5), 1.0, 0.1 * gnoise(pos.zx * 0.3)));
        vec3 r = reflect(rd, wn);
        alb = vec3(0.06, 0.1, 0.13);
        float surf = smoothstep(0.7, 0.9, sin(pos.z * 0.35 + uT * 1.5 + gnoise(pos.xz * 0.05) * 3.0)) * smoothstep(-4.0, -9.0, pos.y);
        col = alb * 0.5 + sky(r) * 0.25 + vec3(0.9) * surf * 0.5;
      }
    }
    if (pos.y >= -3.5 || m != dG) {
      float sh = softShadow(pos + n * 0.02, SUN, 0.05, 80.0, 16.0);
      float dif = max(dot(n, SUN), 0.0) + trans * max(-dot(n, SUN), 0.0);
      float ao = calcAO(pos, n, 1.0);
      vec3 amb = vec3(0.22, 0.3, 0.45) * (0.6 + 0.4 * n.y) + vec3(0.3, 0.25, 0.18) * max(-n.y, 0.0);
      col = alb * (SUN_COL * dif * sh + amb * ao);
    }
    col = mix(col, sky(normalize(vec3(rd.x, 0.03, rd.z))), 1.0 - exp(-t * 0.0008));
  }
  // The propeller discs, over whatever lies behind them.
  float pc = propellers(ro, rd);
  col = mix(col, vec3(0.25, 0.22, 0.18), pc * 0.6);
  fragColor = vec4(col, 1.0);
}
