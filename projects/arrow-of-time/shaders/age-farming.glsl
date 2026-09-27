// Farming, 10,000 BCE: dawn over a field of wild wheat in the hills of the Fertile Crescent. The
// camera drifts through the ripe ears, lit from behind by the rising sun; a woman cuts wheat
// with a flint sickle, and smoke rises from the round huts of her village.
//
// The near wheat is a stack of world-fixed planes, each a row of stalks drawn in 2D and composited
// front to back (true parallax, no marching through thousands of stems); past them the field is
// a canopy over the ray-marched hills. Metres; the camera looks along -z, y up.
#define MARCH_STEPS 110
#define SHADOW_STEPS 24
#define MARCH_RELAX 0.8
#include <noise>
#include <color>
#include <camera>
#include <sdf3>
#include <march>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uT;

const vec3 SUN = vec3(0.4049, 0.0958, -0.9093);  // just above the far hills, off to the right
const vec3 SUN_COL = vec3(1.0, 0.62, 0.3) * 3.2;
const vec3 GOLD = vec3(1.0, 0.72, 0.32);
const float LAYERS = 28.0;
const float DZ = 0.3;        // spacing of the near wheat planes
const float CANOPY = 0.95;   // height of the ripe ears

float hills(vec2 xz) {
  // Flat fields near the camera; foothills rising beyond 150 m.
  float far = smoothstep(120.0, 600.0, -xz.y);
  return 0.6 * fbm(xz * 0.02, 3) + far * (60.0 * fbm(xz * 0.0025 + 2.0, 4) - 10.0);
}

// Round huts of mud brick with conical thatch, on a rise to the left.
const vec3 HUTS[5] = vec3[5](vec3(-38.0, 0.0, -70.0), vec3(-46.0, 0.0, -78.0), vec3(-31.0, 0.0, -82.0), vec3(-54.0, 0.0, -66.0), vec3(-43.0, 0.0, -92.0));

float huts(vec3 p) {
  float d = 1e9;
  for (int i = 0; i < 5; i++) {
    vec3 c = HUTS[i];
    c.y = hills(c.xz);
    vec3 q = p - c;
    float r = 2.2 + 0.6 * hash11(float(i));
    d = min(d, sdCylinder(q - vec3(0.0, 1.0, 0.0), r, 1.0));
    d = min(d, sdCone(q - vec3(0.0, 2.6, 0.0), 0.8, r + 0.3, 0.1));
  }
  return d;
}

float terrain(vec3 p) { return p.y - hills(p.xz); }

float mapD(vec3 p) { return min(terrain(p), huts(p)); }

// ---------------------------------------------------------------- one plane of wheat
// Signed distance (metres) to the stalks, ears and awns of the row in plane k, at (x, y) of
// that plane; `ear` is 1 on the ears and `awns` the distance to the awns alone.
float wheatRow(vec2 q, float k, float t, out float ear, out float awns) {
  float d = 1e9;
  ear = 0.0;
  awns = 1e9;
  float ground = 0.0;
  float cell = floor(q.x / 0.075);
  for (int j = -1; j <= 1; j++) {
    float c = cell + float(j);
    vec3 h = hash33(vec3(c, k, 7.0));
    float x0 = (c + 0.2 + 0.6 * h.x) * 0.075;
    float H = CANOPY - 0.12 + 0.24 * h.y;
    // Wind: a gust travelling through the field bends each stalk from its root.
    float gust = sin(uT * 1.7 - x0 * 0.9 + k * 0.35 + 6.0 * h.z) * 0.5 + 0.5 * sin(uT * 0.9 + x0 * 0.3);
    float bend = (0.035 + 0.05 * gust) * (0.6 + 0.8 * h.z);
    float u = clamp((q.y - ground) / H, 0.0, 1.0);
    float sx = x0 + bend * u * u;
    // Stalk (thinning upwards) and one leaf.
    float stalk = max(abs(q.x - sx) - mix(0.0028, 0.0016, u), max(-q.y, q.y - (H - 0.07)));
    float leafY = H * (0.35 + 0.2 * h.z);
    vec2 lq = q - vec2(x0 + bend * 0.1, leafY);
    float side = h.x > 0.5 ? 1.0 : -1.0;
    // (A two-segment blade: a curve drawn with fewer segments than sdBezierTaper, which is costly here.)
    float leaf = 1e9;
    if (abs(lq.y) < 0.1 && abs(lq.x) < 0.18) {
      vec2 mid = vec2(0.085 * side, 0.045);
      leaf = min(sdTaper(lq, vec2(0.0), mid, 0.004, 0.0025), sdTaper(lq, mid, vec2(0.16 * side, -0.02), 0.0025, 0.0005));
    }
    // Ear: tilted with the stalk's bend, with awns fanning upwards.
    vec2 top = vec2(x0 + bend, H);
    float ang = -2.0 * bend / H;
    vec2 eq = rot2(ang) * (q - top + vec2(0.0, 0.04));
    // Spikelets alternate up the ear, so its outline is scalloped.
    float scallop = 0.0006 * sin(eq.y * 190.0 + (eq.x > 0.0 ? 1.6 : 0.0));
    float e = sdEllipse(eq, vec2(0.0058, 0.04)) - scallop;
    float awn = 1e9;
    for (int a = -1; a <= 1; a++) {
      vec2 tip = vec2(float(a) * 0.016 + 0.01 * h.z, 0.15);
      awn = min(awn, sdSegment(eq, vec2(float(a) * 0.003, 0.015), tip) - 0.0003);
    }
    d = min(d, min(min(stalk, leaf), e));
    awns = min(awns, awn);
    if (e < 0.004) ear = max(ear, 1.0 - smoothstep(-0.004, 0.004, e));
  }
  return d;
}

// ---------------------------------------------------------------- the harvester (a silhouette)
float sdHarvester(vec2 p, float t) {
  // In profile, facing right: a head cloth, a long flared dress, one arm raising a flint sickle,
  // a sheaf of cut wheat held against her other side. About 1.6 m tall.
  if (abs(p.x) > 0.8 || p.y > 1.8 || p.y < -0.05) return 1.0;
  float lift = 0.5 + 0.5 * sin(t * 2.2);
  float head = sdEllipse(p - vec2(0.03, 1.51), vec2(0.078, 0.098));
  float cloth = sdTaper(p, vec2(-0.01, 1.57), vec2(-0.1, 1.3), 0.085, 0.06);
  float torso = sdTaper(p, vec2(0.0, 1.36), vec2(-0.02, 0.95), 0.13, 0.115);
  float dress = sdTaper(p, vec2(-0.02, 0.98), vec2(0.0, 0.08), 0.12, 0.25);
  vec2 elbow = vec2(0.22, 1.12 + 0.05 * lift), hand = vec2(0.36, 1.12 + 0.2 * lift);
  float arm = min(sdTaper(p, vec2(0.05, 1.3), elbow, 0.045, 0.038), sdTaper(p, elbow, hand, 0.038, 0.03));
  // The sickle: a short handle and a curved blade arching forward.
  vec2 b = p - hand;
  float handle = sdTaper(b, vec2(0.0), vec2(0.05, 0.08), 0.014, 0.012);
  float blade = abs(length(b - vec2(0.13, 0.08)) - 0.08) - 0.008;
  blade = max(blade, b.y - 0.08);
  // The sheaf: cut stalks fanning up from her hand, their ears above her shoulder.
  vec2 grip = vec2(-0.08, 1.02);
  float sheaf = 1e9;
  for (int i = 0; i < 7; i++) {
    float a = -0.5 + 0.12 * float(i) + 0.02 * sin(t + float(i));
    vec2 dir = vec2(sin(a), cos(a));
    sheaf = min(sheaf, sdSegment(p, grip - dir * 0.25, grip + dir * 0.45) - 0.006);
    sheaf = min(sheaf, sdEllipse(rot2(-a) * (p - grip - dir * 0.5), vec2(0.014, 0.05)));
  }
  sheaf = min(sheaf, sdEllipse(p - grip, vec2(0.05, 0.035)));
  float d = smin(torso, head, 0.03);
  d = min(min(d, cloth), smin(d, dress, 0.04));
  d = min(d, min(arm, min(handle, blade)));
  return min(d, sheaf);
}

vec3 sky(vec3 rd) {
  float mu = max(dot(rd, SUN), 0.0);
  // Orange at the horizon, rose, then violet-blue within twenty degrees.
  float e = max(rd.y, 0.0);
  vec3 horizon = mix(vec3(0.55, 0.28, 0.3), vec3(1.2, 0.5, 0.16), pow(mu, 3.0));
  vec3 col = mix(horizon, vec3(0.5, 0.26, 0.3), smoothstep(0.0, 0.1, e));
  col = mix(col, vec3(0.16, 0.14, 0.3), smoothstep(0.06, 0.3, e));
  col = mix(col, vec3(0.05, 0.07, 0.2), smoothstep(0.25, 0.7, e));
  col += SUN_COL * (0.12 * pow(mu, 5.0) + 0.5 * pow(mu, 60.0) + 3.0 * pow(mu, 1500.0));
  col += SUN_COL * 12.0 * smoothstep(0.99985, 0.99993, mu);
  // A few long clouds, lit pink and gold from below.
  if (rd.y > 0.0) {
    vec2 cq = rd.xz / (rd.y + 0.05) * 0.8;
    float cl = smoothstep(0.5, 0.75, fbm(cq * vec2(0.6, 2.5) + vec2(uT * 0.02, 0.0), 5));
    vec3 lit = mix(vec3(0.9, 0.45, 0.45), vec3(1.6, 0.95, 0.5), pow(mu, 3.0));
    col = mix(col, lit * (0.6 + 0.4 * rd.y), cl * smoothstep(0.02, 0.12, rd.y) * 0.8);
  }
  return col;
}

// Distance mist, glowing where it looks towards the sun.
vec3 mist(vec3 col, float t, vec3 rd) {
  float f = 1.0 - exp(-t * 0.0022);
  float mu = max(dot(rd, SUN), 0.0);
  vec3 m = mix(vec3(0.42, 0.3, 0.32), vec3(1.4, 0.75, 0.35), pow(mu, 6.0));
  return mix(col, m, f);
}

vec3 shadeFar(vec3 pos, vec3 rd, float t) {
  bool hut = huts(pos) < terrain(pos);
  vec3 n = calcNormal(pos, max(0.01, t * 0.002));
  float dif = max(dot(n, SUN), 0.0);
  float sh = softShadow(pos + n * 0.1, SUN, 0.2, 200.0, 16.0);
  vec3 amb = vec3(0.3, 0.3, 0.42) * (0.6 + 0.4 * n.y);
  vec3 alb;
  if (hut) {
    alb = pos.y - hills(pos.xz) > 2.0 ? vec3(0.5, 0.42, 0.25) : vec3(0.55, 0.42, 0.3);
  } else {
    // Ripe wheat out to the village, pasture and scrub on the hills. Seen against the light the
    // field is a dark mass whose ears shine where they line up with the sun.
    float field = smoothstep(160.0, 110.0, -pos.z);
    alb = mix(vec3(0.16, 0.15, 0.09), vec3(0.2, 0.14, 0.06), field);
    alb *= 0.75 + 0.5 * fbm(pos.xz * vec2(0.4, 0.08), 3);
    float mu = max(dot(rd, SUN), 0.0);
    float sheen = field * (0.15 + 3.0 * pow(mu, 16.0)) * (0.6 + 0.8 * fbm(pos.xz * vec2(2.0, 0.5), 3));
    return alb * (SUN_COL * dif * sh * 0.4 + amb * 0.4) + GOLD * sheen * 0.6;
  }
  return alb * (SUN_COL * dif * sh * 0.4 + amb * 0.4);
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  float pix = pixelAngle(uRes.y);
  float mu = max(dot(rd, SUN), 0.0);
  // Front to back: the near wheat planes, the harvester among them, then the far field.
  vec3 acc = vec3(0.0);
  float A = 0.0;
  float tFar = 1e9;
  float k0 = floor(-ro.z / DZ) + 1.0;
  for (float i = 0.0; i < LAYERS; i++) {
    if (A > 0.995) break;
    float k = k0 + i;
    float zk = -k * DZ;
    float t = (zk - ro.z) / rd.z;
    if (t <= 0.05) continue;
    vec3 q = ro + rd * t;
    // The harvester stands in her own plane among the rows.
    float hz = -4.6;
    if (zk < hz && zk + DZ >= hz) {
      float th = (hz - ro.z) / rd.z;
      vec3 hq = ro + rd * th;
      vec2 hp = hq.xy - vec2(0.55, -0.02);
      float dh = sdHarvester(hp, uT);
      float a = 1.0 - smoothstep(-th * pix, th * pix, dh);
      // Dark against the sky; a thin rim of light on the edges turned towards the sun.
      vec2 g = normalize(vec2(sdHarvester(hp + vec2(0.004, 0.0), uT) - dh, sdHarvester(hp + vec2(0.0, 0.004), uT) - dh) + 1e-6);
      float rim = smoothstep(0.012, 0.0, abs(dh + 0.004)) * max(dot(g, normalize(vec2(1.0, 0.25))), 0.0);
      vec3 c = vec3(0.01, 0.008, 0.01) + GOLD * rim * (0.6 + 2.5 * pow(mu, 6.0));
      acc += (1.0 - A) * a * c;
      A += (1.0 - A) * a;
    }
    if (q.y > CANOPY + 0.35 && rd.y >= 0.0 && zk < hz) break;
    float ear = 0.0, awns = 1e9;
    float d = q.y > CANOPY + 0.35 ? 1e9 : wheatRow(q.xy, k, uT, ear, awns);
    // Defocus close to the lens: a wider, softer edge.
    float aa = t * pix + 0.012 * smoothstep(1.3, 0.3, t);
    // Backlit plant: the ears and awns let light through and glow, most of all in line with the
    // sun; stalks and leaves stay dark.
    float through = 0.06 + 2.6 * pow(mu, 10.0) + 0.3 * pow(mu, 3.0);
    // The awns are finer than a pixel: they add a glowing haze rather than cover.
    float wa = (1.0 - smoothstep(-aa, aa, awns)) * 0.45;
    if (wa > 0.001) {
      acc += (1.0 - A) * wa * GOLD * through * 0.9;
      A += (1.0 - A) * wa * 0.5;
    }
    float a = 1.0 - smoothstep(-aa, aa, d);
    if (a > 0.001) {
      vec3 body = vec3(0.022, 0.018, 0.008);
      vec3 c = body + GOLD * through * ear * (0.35 + 0.25 * hash12(floor(q.xy * 400.0)));
      acc += (1.0 - A) * a * c;
      A += (1.0 - A) * a;
    }
    // The ground between the rows.
    if (rd.y < 0.0) {
      float tg = (0.0 - ro.y) / rd.y;
      if (tg < t) { tFar = min(tFar, tg); break; }
    }
  }
  vec3 col;
  if (tFar < 1e8) {
    vec3 g = ro + rd * tFar;
    col = vec3(0.025, 0.018, 0.01) * (0.6 + 0.4 * fbm(g.xz * 3.0, 3));
  } else {
    float t0 = ((k0 + LAYERS) * DZ + ro.z) / -rd.z;
    // (Rays climbing above the highest hills can only meet the sky.)
    float t = rd.y > 0.12 ? -1.0 : march(ro, rd, max(t0, 1.0), 3000.0, pix);
    if (t > 0.0) col = mist(shadeFar(ro + rd * t, rd, t), t, rd);
    else col = sky(rd);
  }
  col = acc + (1.0 - A) * col;
  fragColor = vec4(col, 1.0);
}
