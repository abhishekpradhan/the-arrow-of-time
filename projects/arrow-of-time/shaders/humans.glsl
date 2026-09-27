// Homo sapiens, 300,000 years ago: dusk on the savanna. The sun has just set behind the wall of
// the rift, giraffes cross the plain under the acacias, and on a granite kopje a band sits round
// a fire. One of them has climbed the rocks; a child beside them points as a meteor crosses the
// first stars, and they look up. Painted like the film's other life scenes: a glowing sky and
// silhouettes that fade into the air with distance. Picture coordinates; the camera drifts right
// (uPan), nearer layers moving further.
#include <illustration>
#include <figures>
#include <creatures>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime, uT;
uniform float uPan, uElev;

const float HY = -0.11;                        // the horizon
const vec3 INK = vec3(0.011, 0.009, 0.014);
const vec3 FIRE = vec3(1.0, 0.46, 0.14);
const vec2 FIREPOS = vec2(0.14, -0.215);       // near layer

float flick(float t) { return 0.82 + 0.1 * sin(t * 13.0) * sin(t * 7.7) + 0.08 * sin(t * 23.0 + 1.3); }

// A granite kopje: rounded boulders heaped on the right of the frame.
float kopje(vec2 p) {
  float d = sdEllipse(p - vec2(0.62, -0.2), vec2(0.36, 0.17));
  d = smin(d, sdEllipse(p - vec2(0.52, -0.1), vec2(0.13, 0.085)), 0.02);
  d = smin(d, sdEllipse(p - vec2(0.72, -0.07), vec2(0.16, 0.12)), 0.025);
  d = smin(d, sdEllipse(p - vec2(0.9, -0.02), vec2(0.14, 0.2)), 0.03);
  d = min(d, sdEllipse(p - vec2(0.36, -0.215), vec2(0.075, 0.045)));
  // Weathered, a little irregular.
  return d + 0.006 * gnoise(p * 30.0) + 0.003 * gnoise(p * 90.0);
}

// Height of the top of the kopje at x (where the standing figures put their feet).
float kopjeTop(float x) {
  float y = 0.2;
  for (int i = 0; i < 24; i++) {
    if (kopje(vec2(x, y)) < 0.0) break;
    y -= 0.02;
  }
  float lo = y, hi = y + 0.02;
  for (int i = 0; i < 8; i++) {
    float m = 0.5 * (lo + hi);
    if (kopje(vec2(x, m)) < 0.0) lo = m; else hi = m;
  }
  return lo;
}

void main() {
  vec2 p0 = centered(vUv, uAspect);
  float px = 1.0 / uRes.y;
  float t = uT;
  vec2 sun = vec2(-0.3, HY - 0.07);
  SkyTone st = skyTone(uElev);
  vec3 col = paintSky(p0, HY, sun, uElev);
  // Wisps of high cloud, lit pink from below on the sun's side.
  {
    float h = p0.y - HY;
    float cn = fbm(vec2(p0.x * 1.4 + uGTime * 0.004, p0.y * 6.5), 5);
    float wisp = smoothstep(0.55, 0.78, cn) * smoothstep(0.06, 0.16, h) * (1.0 - smoothstep(0.3, 0.42, h));
    vec3 lit = st.glow * 0.45 * exp(-abs(p0.x - sun.x) * 0.9) + st.mid * 0.5;
    col = mix(col, lit, wisp * 0.55);
  }
  // The first stars and the Milky Way, high up where the sky has darkened.
  float dark = smoothstep(0.05, 0.3, p0.y - HY);
  vec2 bd = normalize(vec2(-0.8, 0.6));
  float across = dot(p0 - vec2(0.55, 0.05), vec2(-bd.y, bd.x));
  float along = dot(p0 - vec2(0.55, 0.05), bd);
  float band = exp(-pow(across / 0.12, 2.0)) * smoothstep(-0.1, 0.4, along);
  float mw = fbm(vec2(along * 5.0, across * 12.0), 5);
  float rift = smoothstep(0.45, 0.7, fbm(vec2(along * 8.0 + 3.0, across * 26.0), 4)) * exp(-pow(across / 0.045, 2.0));
  col += vec3(0.5, 0.5, 0.75) * band * (0.15 + 0.5 * mw) * (1.0 - 0.8 * rift) * dark * 0.1;
  col += nightStars(p0, px, uGTime, 7.0, (0.25 + 0.5 * band) * dark) * 0.9;
  // Venus low in the glow.
  col += vec3(1.0, 0.95, 0.85) * exp(-dot(p0 - vec2(-0.52, HY + 0.11), p0 - vec2(-0.52, HY + 0.11)) / (px * px * 2.2)) * 3.0;

  // The meteor: its head is drawn as the streak it covers during the shutter (so it cannot
  // strobe), and it leaves a glowing train that widens and fades.
  {
    const float M0 = 3.2, MDUR = 1.05;
    vec2 ma = vec2(0.04, 0.35), mb = vec2(0.74, 0.17);
    vec2 md = mb - ma;
    float len = length(md);
    md /= len;
    float u = (t - M0) / MDUR;
    if (u > 0.0 && u < 1.8) {
      vec2 rel = p0 - ma;
      float v = dot(rel, md) / len;
      float off = abs(dot(rel, vec2(-md.y, md.x)));
      float B = smoothstep(0.0, 0.2, v) * smoothstep(1.0, 0.75, v);
      float age = (u - v) * MDUR;
      if (v > 0.0 && v < min(u, 1.0) && age >= 0.0) {
        float sig = px * (1.4 + 20.0 * age);
        float train = B * exp(-age / 0.35) * exp(-off * off / (2.0 * sig * sig)) * (1.4 / (1.4 + 20.0 * age));
        col += vec3(0.7, 0.88, 1.0) * train * 1.3 + vec3(0.45, 0.65, 1.0) * B * exp(-age / 0.6) * exp(-off * off / (2.0 * pow(px * 16.0, 2.0))) * 0.07;
      }
      if (u < 1.0) {
        float du = 0.5 / 24.0 / MDUR;
        vec2 h0 = mix(ma, mb, max(u - du, 0.0)), h1 = mix(ma, mb, u);
        vec2 pa = p0 - h0, ba = h1 - h0;
        float hh = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
        float dh = length(pa - ba * hh);
        col += vec3(0.92, 0.96, 1.0) * B * smoothstep(1.0, 0.85, u) * (exp(-dh * dh / (2.0 * px * px * 1.8)) * 5.0 + exp(-dh / (px * 10.0)) * 0.4);
      }
    }
  }

  // ---- far: the wall of the rift, a long flat-topped escarpment, lost in the haze.
  vec2 pf = p0 + vec2(uPan * 0.12, 0.0);
  vec3 air = airAt(pf.x, HY, sun, uElev);
  float esc = HY + 0.012 + 0.03 * smoothstep(-0.9, -0.2, pf.x) * smoothstep(0.75, 0.2, pf.x) + 0.006 * fbm(vec2(pf.x * 9.0, 1.0), 4);
  esc = max(esc, HY + 0.05 - 3.0 * abs(pf.x - 0.95) + 0.004 * gnoise(vec2(pf.x * 40.0, 2.0)));
  fill(col, pf.y - esc, px, inkIn(air, 0.62, INK));
  // Nearer rolling ground.
  vec2 pm = p0 + vec2(uPan * 0.35, 0.0);
  air = airAt(pm.x, HY, sun, uElev);
  float plain = HY - 0.012 + 0.012 * fbm(vec2(pm.x * 3.0, 4.0), 3);
  // The plain darkens towards us, with low scrub scattered across it.
  float depthK = smoothstep(plain, plain - 0.11, pm.y);
  vec3 plainCol = inkIn(air, mix(0.3, 0.07, depthK), INK) * (0.9 + 0.2 * fbm(vec2(pm.x * 14.0, pm.y * 60.0), 3));
  fill(col, pm.y - plain, px, plainCol);
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    vec3 h = hash31(fi * 5.3 + 2.0);
    float y = plain - 0.01 - 0.09 * h.x * h.x;
    vec2 c = vec2(-0.95 + 1.9 * h.y, y);
    float r = 0.006 + 0.012 * h.z * (1.0 - h.x * 0.5);
    vec2 bq = pm - c;
    float bush = sdEllipse(bq - vec2(0.0, r * 0.45), vec2(r * 2.0, r * 0.9)) + r * 0.5 * (fbm(bq / r * 1.5 + fi, 3) - 0.5) + 0.25 * r * smoothstep(0.0, -r, bq.y);
    fill(col, bush, px, inkIn(air, mix(0.25, 0.04, smoothstep(0.0, 0.8, h.x)), INK));
  }
  // Acacias across the plain: umbrella crowns on their trunks, dark against the afterglow.
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float x = i == 0 ? -0.78 : i == 1 ? -0.27 : i == 2 ? 0.1 : 0.98;
    float s = 0.1 + 0.05 * fract(fi * 0.61);
    vec2 q = (pm - vec2(x, plain - 0.004)) / s;
    fill(col, sdAcacia(q, 1.0) * s, px, inkIn(air, 0.34, INK));
  }
  // Giraffes crossing the plain, left to right.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float s = 0.034 - 0.005 * fi;
    vec2 base = vec2(-0.6 + fi * 0.1 + t * 0.008, plain - 0.004 - 0.003 * fi);
    vec2 q = (pm - base) / s;
    fill(col, sdGiraffe(q, uGTime * 1.6 + fi * 1.9) * s, px, inkIn(air, 0.3, INK));
  }
  // Mist over the plain, catching the last light.
  col += st.glow * 0.02 * mistBand(pm, plain - 0.02, 0.015, uGTime, 2.0);

  // ---- near: the ground, the kopje, the fire and the people.
  vec2 pn = p0 + vec2(uPan * 1.0, 0.0);
  air = airAt(pn.x, HY, sun, uElev);
  float ground = -0.24 + 0.012 * gnoise(vec2(pn.x * 3.0, 7.0));
  float fl = flick(uGTime);
  vec2 fp = FIREPOS;
  float dF = length((pn - fp) * vec2(1.0, 1.6));
  vec3 fireLight = FIRE * fl * (0.55 * exp(-dF * 7.0) + 0.12 * exp(-dF * 2.2));
  // Ground: dark, warmed round the fire.
  if (pn.y < ground + 0.002) {
    vec3 g = inkIn(air, 0.03, INK) + fireLight * vec3(0.45, 0.3, 0.2) * smoothstep(0.06, -0.01, ground - pn.y);
    col = mix(col, g, cover(pn.y - ground, px));
  }
  // The kopje, lit by the fire on the faces turned to it, and faintly by the sky on top.
  float dk = kopje(pn);
  if (dk < 0.01) {
    vec2 e = vec2(0.002, 0.0);
    vec2 g = vec2(kopje(pn + e.xy) - dk, kopje(pn + e.yx) - dk);
    vec2 nrm = normalize(g + 1e-6);
    float toFire = max(dot(nrm, normalize(fp + vec2(0.0, 0.03) - pn)), 0.0);
    vec3 rock = inkIn(air, 0.035, INK) * (1.0 + 0.25 * fbm(pn * 25.0, 3));
    rock += vec3(0.5, 0.36, 0.28) * fireLight * (0.1 + 0.9 * toFire * toFire) * 0.9;
    rock += st.mid * 0.06 * max(nrm.y, 0.0) * exp(-max(-dk, 0.0) / 0.004);
    col = mix(col, rock, cover(dk, px));
  }
  // People round the fire: two sitting facing it, one leaning in with a stick.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float dir = i == 1 ? -1.0 : 1.0;
    vec2 base = fp + vec2(i == 0 ? -0.2 : i == 1 ? 0.19 : -0.36, -0.018);
    float s = i == 2 ? 0.15 : 0.165;
    vec2 q = (pn - base) / s;
    q.x *= dir;
    Pose f = sitPose(sin(uGTime * 1.1 + fi * 2.0), i == 0 ? 0.6 + 0.25 * sin(uGTime * 0.7) : 0.15, 0.1);
    float d = sdFigure(q, f, vec4(0.0, 0.5, i == 1 ? 0.6 : 0.0, 0.0), 1.05) * s;
    vec2 e = vec2(0.002, 0.0);
    vec2 g = vec2(sdFigure((pn + e.xy - base) / s * vec2(dir, 1.0), f, vec4(0.0, 0.5, 0.0, 0.0), 1.05) * s - d,
                  sdFigure((pn + e.yx - base) / s * vec2(dir, 1.0), f, vec4(0.0, 0.5, 0.0, 0.0), 1.05) * s - d);
    float rim = rimLight(d, g, normalize(fp + vec2(0.0, 0.035) - pn), 0.0022);
    vec3 c = INK + FIRE * fl * rim * 1.1 * exp(-length(pn - fp) * 3.0);
    col = mix(col, c, cover(d, px));
  }
  // The one who climbed the rocks, looking up; a child beside them, pointing at the meteor.
  {
    float look = 0.2 + 0.6 * smoothstep(3.1, 3.9, t);
    float x0 = 0.56;
    vec2 base = vec2(x0, kopjeTop(x0) - 0.004);
    float s = 0.17;
    vec2 q = (pn - base) / s;
    Pose f = standPose(sin(uGTime * 1.2), look);
    f.handF = f.neck + vec2(0.05, -0.36);
    float d = sdFigure(q, f, vec4(0.0, 0.55, 0.0, 0.0), 1.0) * s;
    col = mix(col, INK, cover(d, px));
    float x1 = 0.46;
    vec2 base1 = vec2(x1, kopjeTop(x1) - 0.003);
    float s1 = 0.11;
    vec2 q1 = (pn - base1) / s1;
    Pose c = pointPose(sin(uGTime * 1.5), smoothstep(3.0, 3.5, t) * (1.0 - 0.15 * smoothstep(4.5, 6.0, t)));
    float d1 = sdFigure(q1, c, vec4(0.0, 0.4, 0.0, 0.0), 1.05) * s1;
    col = mix(col, INK, cover(d1, px));
  }
  // The fire: tongues of flame over the embers, and sparks rising.
  {
    // Logs, crossed, glowing where they burn.
    float logs = min(sdTaper(pn, fp + vec2(-0.05, -0.008), fp + vec2(0.04, 0.006), 0.007, 0.006), sdTaper(pn, fp + vec2(0.05, -0.008), fp + vec2(-0.035, 0.008), 0.007, 0.006));
    col = mix(col, INK + FIRE * 0.6 * fl * smoothstep(0.04, 0.0, length(pn - fp)), cover(logs, px));
    vec2 fq = (pn - fp) / 0.06;
    float n = fbm(vec2(fq.x * 2.6, fq.y * 1.8 - uGTime * 4.2), 4);
    float shape = smoothstep(0.95, 0.15, length(vec2(fq.x * (1.3 + fq.y * 0.9), fq.y * 0.5 - 0.42))) * step(-0.05, fq.y);
    float flame = saturate(shape * (n * 1.7 - 0.25) * (0.7 + 0.3 * fl));
    col += fireRamp(0.35 + 0.65 * flame) * flame * 3.2;
    col += FIRE * exp(-length((pn - fp - vec2(0.0, 0.012)) * vec2(1.0, 1.4)) / 0.035) * 0.5 * fl;
    col += vec3(1.0, 0.4, 0.1) * smoothstep(0.03, 0.0, length((pn - fp) * vec2(1.0, 4.0))) * 1.5;
    for (int i = 0; i < 16; i++) {
      float fi = float(i);
      vec3 h = hash31(fi * 13.1);
      float life = fract(uGTime * (0.3 + 0.25 * h.x) + h.y);
      vec2 ep = fp + vec2((h.z - 0.5) * 0.05 + 0.03 * sin(life * 5.0 + fi) + life * 0.02, 0.01 + life * 0.3);
      col += vec3(1.0, 0.55, 0.2) * exp(-length(pn - ep) / (px * 1.6)) * (1.0 - life) * 1.8;
    }
  }
  // ---- foreground: dry grass, out of focus, swaying.
  vec2 pg = p0 + vec2(uPan * 2.2, 0.0);
  float grass = 1e9;
  float cell = floor(pg.x / 0.03);
  for (int j = -3; j <= 3; j++) {
    float c = cell + float(j);
    vec3 h = hash31(c * 1.7 + 11.0);
    float x = (c + h.x) * 0.03;
    float tall = 0.03 + 0.11 * h.y * h.y + 0.05 * smoothstep(0.3, 0.9, sin(c * 0.37) * 0.5 + 0.5);
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      vec3 hk = hash31(c * 3.1 + fk * 7.7);
      float len = tall * (0.5 + 0.6 * hk.x);
      float lean = (hk.y - 0.5) * 0.05 + 0.01 * sin(uGTime * 1.2 + c * 0.5 + fk);
      vec2 a = vec2(x + (hk.z - 0.5) * 0.015, -0.41);
      vec2 b = a + vec2(lean, len);
      grass = min(grass, sdBezierTaper(pg, a, a + vec2(lean * 0.2, len * 0.6), b, 0.0045, 0.0008));
    }
  }
  col = mix(col, INK * 0.5, cover(grass, px * 3.5));
  fragColor = vec4(col, 1.0);
}
