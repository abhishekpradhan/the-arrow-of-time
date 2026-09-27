// The Atom, 1945: the Trinity test, before dawn on the Jornada del Muerto. A flash that lights the
// whole desert and the mountains beyond, then the fireball: a swelling, boiling sphere, white at
// first, cooling through yellow and orange as it rises on a stem of dust, with a skirt of dust
// racing across the ground. Real time is compressed about tenfold. Metres; the fireball rises
// from ground zero (0, 0, 0), the camera stands 9 km to the south (+z).
#include <noise>
#include <color>
#include <camera>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uT;
uniform float uAge;        // seconds of (compressed) real time since detonation; < 0 before

// Fireball radius, height and temperature (0..1) against time.
float radiusAt(float a) { return 30.0 + 170.0 * pow(clamp(a / 0.3, 0.0, 1.0), 0.4) + 25.0 * max(a - 0.3, 0.0); }
float heightAt(float a) { return radiusAt(a) * 0.55 + 45.0 * max(a - 0.2, 0.0) + 8.0 * a * a; }
float heatAt(float a) { return exp(-a * 0.12); }

float terrain(vec2 xz) {
  // A flat desert basin; the Oscura Mountains rise beyond ground zero.
  float mtn = smoothstep(-2000.0, -9000.0, xz.y) * (700.0 * fbm(xz * vec2(0.00035, 0.0006) + 4.0, 5) - 150.0);
  return max(mtn, 0.0) + 2.0 * fbm(xz * 0.004, 3);
}

// The fireball's density at p, with the temperature of the gas there (0..1): a boiling ball that
// rolls up its sides as it rises, a stem of dust drawn up beneath it, a skirt of dust along the
// ground. `kind` is 0 in the fireball, 1 in dust.
float fireball(vec3 p, float a, out float heat, out float kind) {
  float R = radiusAt(a), H = heightAt(a);
  vec3 q = p - vec3(0.0, H, 0.0);
  float r = length(q);
  // Turbulence rolling up and over the surface: rotate the noise about the horizontal axis
  // through the centre, faster at the edge (a vortex ring in the making).
  float roll = a * 0.9 * clamp(length(q.xz) / R, 0.0, 1.2);
  vec3 nq = q / R * 3.0;
  nq.yz = rot2(roll) * nq.yz;
  float n = fbm(nq + 0.9 * vec3(fbm(nq * 1.9 + 3.0, 3), fbm(nq * 1.9 + 7.0, 3), fbm(nq * 1.9 + 11.0, 3)), 5);
  float ball = smoothstep(0.12, -0.06, r / R - 1.0 + 0.45 * (n - 0.5));
  // Hot folds glow; cooler gas between them darkens, more so as the fireball ages.
  heat = heatAt(a) * clamp(0.45 + 1.5 * (n - 0.4), 0.0, 1.0);
  kind = 0.0;
  // The stem: a column of dust drawn up under the fireball once it lifts off.
  float stemR = 0.22 * R * (0.8 + 0.5 * fbm(vec3(p.xz * 0.02, p.y * 0.01 - a), 3));
  float stem = smoothstep(stemR, stemR * 0.5, length(p.xz)) * step(p.y, H - R * 0.5) * smoothstep(0.3, 1.2, a) * 0.8;
  if (stem > ball) kind = 1.0;
  return max(ball, stem);
}

float skirtRadius(float a) { return 150.0 + 420.0 * sqrt(max(a, 0.0)); }

// Dust skirt racing out along the ground, low and billowing.
float skirt(vec3 p, float a) {
  // A low dome of dust, thickest where the blast front has just passed, billowing at its top.
  float r = length(p.xz) / skirtRadius(a);
  float sn = fbm(vec3(p.xz * 0.01, p.y * 0.02 - a * 0.4), 4);
  float top = max(70.0 * (1.0 - r * r) * (0.5 + sn), 1.0);
  return clamp((top - p.y) / (0.7 * top), 0.0, 1.0) * smoothstep(1.0, 0.8, r) * smoothstep(0.05, 0.4, a) * smoothstep(0.35, 0.6, sn) * 0.7;
}

vec3 heatColor(float h) {
  // White-hot to yellow, orange and dull red.
  return blackbody(1500.0 + 6000.0 * h) * (0.12 + 8.0 * h * h);
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  float a = uAge;
  bool fired = a >= 0.0;
  // Pre-dawn sky: deep blue, a faint glow in the east.
  float e = max(rd.y, 0.0);
  vec3 sky = mix(vec3(0.05, 0.06, 0.12), vec3(0.008, 0.012, 0.035), smoothstep(0.0, 0.4, e));
  sky += vec3(0.12, 0.08, 0.1) * exp(-e / 0.05) * max(rd.x, 0.0);
  float star = smoothstep(0.994, 1.0, hash13(floor(rd * 500.0))) * smoothstep(0.05, 0.3, e);
  sky += vec3(0.6, 0.7, 1.0) * star * 0.5;
  // The light of the fireball on everything: a point light, fading as it cools and grows.
  vec3 fbPos = vec3(0.0, fired ? heightAt(a) : 0.0, 0.0);
  float power = fired ? (6e7 * exp(-a * 6.0) + 6e6 * heatAt(a)) : 0.0;
  // The sky itself lights up with the flash.
  sky += vec3(0.75, 0.8, 1.0) * power * 1.0e-8 * exp(-e * 3.0);
  vec3 col = sky;
  // Terrain: march the height field.
  float t = 1.0;
  bool hit = false;
  for (int i = 0; i < 160; i++) {
    vec3 q = ro + rd * t;
    float h = q.y - terrain(q.xz);
    if (h < 0.002 * t) { hit = true; break; }
    t += max(h * 0.6, 0.5 + t * 0.004);
    if (t > 30000.0) break;
  }
  // A ray still creeping along the ground when the steps run out has met it.
  if (!hit && t <= 30000.0 && rd.y < 0.0) hit = true;
  if (hit) {
    vec3 pos = ro + rd * t;
    vec2 e2 = vec2(2.0 + t * 0.002, 0.0);
    vec3 n = normalize(vec3(terrain(pos.xz - e2.xy) - terrain(pos.xz + e2.xy), 2.0 * e2.x, terrain(pos.xz - e2.yx) - terrain(pos.xz + e2.yx)));
    vec3 alb = vec3(0.35, 0.3, 0.24) * (0.8 + 0.4 * fbm(pos.xz * 0.02, 3));
    // Creosote bushes dot the basin.
    alb *= 1.0 - 0.5 * smoothstep(0.7, 0.8, fbm(pos.xz * 0.2, 3)) * smoothstep(3000.0, 500.0, t);
    vec3 l = fbPos - pos;
    // (Distance floored at the fireball's radius: nothing is lit more than its surface.)
    float r2 = max(dot(l, l), pow(radiusAt(max(a, 0.0)) * 1.5, 2.0));
    col = alb * (vec3(0.02, 0.025, 0.05) * (0.5 + 0.5 * n.y) + vec3(1.0, 0.75, 0.5) * power * max(dot(n, normalize(l)), 0.0) / r2);
    col = mix(col, sky * 0.9, 1.0 - exp(-t * 0.00012));
  }
  // The fireball and its stem, marched through a sphere around both.
  if (fired) {
    float R = radiusAt(a) * 1.25 + heightAt(a) * 0.5;
    vec3 c = vec3(0.0, heightAt(a) * 0.55, 0.0);
    vec3 oc = ro - c;
    float b = dot(oc, rd);
    float disc = b * b - (dot(oc, oc) - R * R);
    if (disc > 0.0) {
      float t0 = max(-b - sqrt(disc), 0.0), t1 = -b + sqrt(disc);
      if (hit) t1 = max(min(t1, t), t0);
      vec3 acc = vec3(0.0);
      float T = 1.0;
      float jit = hash12(gl_FragCoord.xy);
      const int N = 48;
      float dt = (t1 - t0) / float(N);
      for (int i = 0; i < N; i++) {
        vec3 q = ro + rd * (t0 + (float(i) + jit) * dt);
        float heat, kind;
        float dens = fireball(q, a, heat, kind);
        if (dens < 0.01) continue;
        // The fireball is nearly opaque, so we see its surface; the dust is thinner.
        float alpha = 1.0 - exp(-dens * dt * (kind > 0.5 ? 0.02 : 0.08));
        vec3 c;
        if (kind > 0.5) {
          // Dust lit from above by the fireball.
          float lit = heatAt(a) * smoothstep(0.0, heightAt(a), q.y + 100.0);
          c = vec3(0.35, 0.24, 0.16) * (0.04 + 2.5 * lit);
        } else {
          c = heatColor(heat) + vec3(0.12, 0.05, 0.02) * heatAt(a);
        }
        acc += T * alpha * c;
        T *= 1.0 - alpha;
        if (T < 0.01) break;
      }
      col = col * T + acc;
    }
    // The dust skirt in front of it, marched through its flat cylinder.
    float Rs = skirtRadius(a) * 1.05;
    vec2 o2 = ro.xz, d2 = rd.xz;
    float qa = dot(d2, d2), qb = dot(o2, d2), qc = dot(o2, o2) - Rs * Rs;
    float qd = qb * qb - qa * qc;
    if (qd > 0.0 && a > 0.05) {
      float s0 = max((-qb - sqrt(qd)) / qa, 0.0), s1 = (-qb + sqrt(qd)) / qa;
      if (hit) s1 = min(s1, t);
      // (Rays that meet the ground first never reach the dust.)
      if (s1 <= s0) s1 = s0;
      vec3 acc = vec3(0.0);
      float T = 1.0;
      float jit = hash12(gl_FragCoord.xy + 17.0);
      const int NS = 24;
      float ds = (s1 - s0) / float(NS);
      for (int i = 0; i < NS; i++) {
        vec3 q = ro + rd * (s0 + (float(i) + jit) * ds);
        if (q.y > 120.0 || q.y < 0.0) continue;
        float dens = skirt(q, a);
        if (dens < 0.01) continue;
        float alpha = 1.0 - exp(-dens * ds * 0.01);
        // Lit from above by the fireball, its top edge bright.
        acc += T * alpha * vec3(0.4, 0.26, 0.16) * (0.05 + 2.2 * heatAt(a) * smoothstep(0.0, 70.0, q.y));
        T *= 1.0 - alpha;
      }
      col = col * T + acc;
    }
  }
  fragColor = vec4(col, 1.0);
}
