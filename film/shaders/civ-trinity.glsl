// The Atom, 1945: Trinity, before dawn in the desert of New Mexico. The film cuts in on the flash,
// which turns the night white and lights the whole valley and the mountains beyond; then the
// fireball: a boiling dome, white at its heart, cooling through yellow and orange as it swells and
// lifts off the desert on a stem of dust, a skirt of dust racing out along the ground. On a rise
// in front, the observers, black against it, one shielding his eyes.
#include <arrow-of-time/civ-common>

const float HY = -0.075;
const vec3 INK = vec3(0.01, 0.009, 0.012);
const vec2 GZ = vec2(0.2, HY - 0.004);     // ground zero (far layer)

// Fireball radius, height of its centre, and heat (0..1), t seconds after the flash.
float fbR(float t) { return 0.04 + 0.12 * (1.0 - exp(-t * 3.5)) + 0.03 * t; }
float fbH(float t) { return fbR(t) * (0.35 + 0.4 * smoothstep(0.1, 1.2, t)) + 0.03 * t; }
float fbHeat(float t) { return exp(-t * 0.9); }

vec3 heatCol(float h) { return blackbody(1600.0 + 5000.0 * h) * (0.3 + 9.0 * h * h); }

// The rise in front, the earth-covered bunker, and the observers standing on it.
float observers(vec2 q) {
  float rise = -0.23 + 0.03 * exp(-pow((q.x + 0.35) / 0.4, 2.0)) + 0.004 * gnoise(vec2(q.x * 10.0, 3.0));
  float d = q.y - rise;
  d = min(d, sdRoundBox(q - vec2(-0.72, rise + 0.015), vec2(0.12, 0.03), 0.02));
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float s = 0.14 + 0.01 * fract(fi * 0.7);
    float x = -0.45 + fi * 0.09 + 0.02 * sin(fi * 3.0);
    vec2 b = vec2(x, -0.23 + 0.03 * exp(-pow((x + 0.35) / 0.4, 2.0)) - 0.003);
    Pose f = standPose(sin(uGTime + fi), 0.25);
    if (i == 1) f.handN = f.head + vec2(0.07, 0.02);
    if (i == 3) { f.handN = f.head + vec2(0.06, 0.0); f.handF = f.head + vec2(0.05, 0.03); }
    d = min(d, sdFigure((q - b) / s, f, vec4(0.0, 0.0, 0.0, i == 2 ? 1.0 : 0.0), 1.05) * s);
  }
  return d;
}

vec3 scene(vec2 p) {
  float t = max(uT + 0.04, 0.0);
  float flash = exp(-t * 7.0);
  float heat = fbHeat(t);
  vec2 fc = GZ + vec2(0.0, fbH(t));
  float R = fbR(t);
  // The night sky, lit up by the flash and then by the fire.
  SkyTone st = skyTone(uElev);
  vec3 col = paintSky(p, HY, uSun, uElev);
  col += nightStars(p, PX, uGTime, 19.0, 0.9 * (1.0 - flash));
  float dc = length((p - fc) * vec2(0.8, 1.0));
  col += vec3(0.85, 0.9, 1.0) * flash * 3.0 * (0.4 + 0.6 * exp(-dc * 2.0));
  col += vec3(1.0, 0.45, 0.15) * heat * (0.25 * exp(-dc * 3.0) + 0.6 * exp(-dc * 9.0));

  // ---- the Oscura mountains, lit from in front by the fireball.
  vec2 q = L(p, 0.08);
  float mtn = HY + 0.02 + 0.06 * fbm(vec2(q.x * 1.5 + 2.0, 1.0), 5) * smoothstep(-0.9, 0.3, q.x);
  if (q.y < mtn + 0.002) {
    float ridge = fbm(q * vec2(20.0, 40.0), 4);
    float face = 0.35 + 0.65 * ridge;
    vec3 lit = vec3(1.0, 0.5, 0.22) * heat * 0.7 * face * exp(-abs(q.x - GZ.x) * 0.8) + vec3(0.8, 0.85, 1.0) * flash * 1.2 * face;
    col = mix(col, INK * 2.0 + lit, cover(q.y - mtn, PX));
  }
  // ---- the desert floor, catching the light out to the horizon.
  q = L(p, 0.3);
  float floorY = HY - 0.002;
  if (q.y < floorY) {
    float dist = floorY - q.y;
    vec3 lit = vec3(1.0, 0.5, 0.2) * heat * 1.2 * exp(-abs(q.x - GZ.x) * 1.2) + vec3(0.8, 0.85, 1.0) * flash;
    vec3 g = vec3(0.07, 0.055, 0.045) * (0.8 + 0.3 * fbm(q * vec2(10.0, 80.0), 3)) * lit * 3.0 * exp(-dist * 6.0) + INK;
    col = mix(col, g, cover(q.y - floorY, PX));
  }

  // ---- the fireball, its stem and the dust skirt.
  q = L(p, 0.08);
  {
    vec2 r = (q - fc) / R;
    float rr = length(r);
    // A boiling surface: warped noise, rolling up round the sides as the ball rises.
    vec2 np = r * 2.2 + vec2(0.0, -t * 0.9);
    vec2 w = vec2(fbm(np * 1.3 + 3.0 + t * 0.4, 4), fbm(np * 1.3 + 7.0 - t * 0.3, 4));
    float n = fbm(np + 1.6 * w, 5);
    float edge = 1.0 + 0.12 * (n - 0.5) + 0.05 * gnoise(r * 6.0 + t);
    float ball = smoothstep(edge + 0.03, edge - 0.05, rr) * step(HY - 0.004, q.y);
    // Hottest at its heart and on the rising crown; the limb is cooler and redder; sooty folds
    // darken as it cools.
    float limb = smoothstep(1.0, 0.35, rr);
    float h = saturate(heat * (0.3 + 0.9 * (n - 0.3) + 0.45 * limb) + flash * 0.8);
    vec3 fire = heatCol(h) * (0.55 + 0.45 * limb);
    fire *= 1.0 - 0.6 * smoothstep(0.52, 0.75, n) * (1.0 - heat * 0.8);
    col = mix(col, fire, ball);
    col += heatCol(heat * 0.8) * 0.15 * exp(-max(rr - 1.0, 0.0) * 6.0) * (1.0 - ball);
    // The stem of dust drawn up under it once it has lifted off.
    float lift = smoothstep(0.25, 1.0, t);
    float stemW = R * 0.25 * (0.8 + 0.4 * fbm(vec2(q.y * 30.0 - t, 2.0), 3));
    float stem = smoothstep(stemW, stemW * 0.4, abs(q.x - fc.x)) * step(q.y, fc.y - R * 0.6) * step(HY - 0.004, q.y) * lift;
    vec3 dust = vec3(0.5, 0.3, 0.18) * (0.15 + 1.4 * heat) * (0.7 + 0.5 * fbm(q * 60.0, 3));
    col = mix(col, dust, stem * 0.85 * (1.0 - ball));
    // The skirt: a low wall of dust racing outwards along the ground, lit on top.
    float sr = 0.05 + 0.35 * sqrt(t);
    float sx = abs(q.x - GZ.x) / sr;
    float sh = 0.014 * (1.0 - sx * sx) * (0.6 + 0.8 * fbm(vec2(q.x * 40.0, t), 3));
    float skirt = step(sx, 1.0) * smoothstep(sh, sh * 0.3, q.y - (HY - 0.004)) * step(HY - 0.006, q.y) * smoothstep(0.03, 0.15, t);
    col = mix(col, vec3(0.55, 0.32, 0.18) * (0.3 + 1.6 * heat) * (0.6 + 0.4 * exp(-sx * 2.0)), skirt * 0.9 * (1.0 - ball));
  }

  // ---- the observers' rise, black against the light, one shielding his eyes; the fireball rims
  // the edges turned towards it.
  q = L(p, 1.0);
  float d = observers(q);
  if (d < 0.01) {
    vec2 e2 = vec2(0.0015, 0.0);
    vec2 g = vec2(observers(q + e2.xy), observers(q + e2.yx)) - d;
    float rim = rimLight(d, g, normalize(vec2(0.75, 0.35)), 0.0022);
    col = mix(col, INK + vec3(1.0, 0.55, 0.25) * heat * 0.8 * rim, cover(d, PX));
  }
  return col;
}
