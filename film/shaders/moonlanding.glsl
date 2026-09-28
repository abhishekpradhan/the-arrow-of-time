// The Moon, 1969 (shots/apollo.ts): Eagle comes down on the Sea of Tranquility in the low
// morning Sun, its exhaust tearing a sheet of dust off the surface that streams away in straight
// lines (no air to hold it up); at cue eagleLands the engine stops and the dust is simply gone,
// and the lander stands alone on the plain, the Earth in the black sky above. The Earth is drawn
// beforehand (the Planet component); this pass leaves the sky transparent.
// Metres, the landing site at the origin, y up.
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime;
#include <camera>
#include <color>
#include <arrow-of-time/lunar>
#include <arrow-of-time/lm>

uniform vec3 uLmPos;        // the lander's frame origin in the world
uniform mat3 uLmRot;        // world -> the lander's frame
uniform vec4 uDust;         // the dust sheet: centre (x, z), strength, film seconds since it began
uniform float uSunE;        // sunlight (irradiance)

const vec3 SUN_C = vec3(1.0, 0.97, 0.92);

// ------------------------------------------------------------------ the scene's solid parts
float objects(vec3 p, out float mat, out int id) {
  float m;
  float d = lmMap(uLmRot * (p - uLmPos), m);
  mat = m;
  id = 1;
  return d;
}
float objectsD(vec3 p) { float m; int id; return objects(p, m, id); }

vec3 objNormal(vec3 p, float e) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * objectsD(p + k.xyy * e) + k.yyx * objectsD(p + k.yyx * e) + k.yxy * objectsD(p + k.yxy * e) + k.xxx * objectsD(p + k.xxx * e));
}

// Shadow of the lander on anything (a hard-edged sun, a narrow penumbra), with Inigo Quilez's
// improved soft shadow (MIT License), free of the simple estimate's terraces.
float objShadow(vec3 p, vec3 l) {
  // Only rays that pass near the lander need marching.
  vec2 b = raySphere(p, l, uLmPos + vec3(0.0, 3.2, 0.0), 7.0);
  if (b.y < 0.0) return 1.0;
  float res = 1.0, t = 0.02, ph = 1e10;
  float tmax = b.y;
  for (int i = 0; i < 64; i++) {
    float h = objectsD(p + l * t);
    float y = h * h / (2.0 * ph);
    float d = sqrt(max(h * h - y * y, 0.0));
    res = min(res, 40.0 * d / max(0.0, t - y));
    ph = h;
    t += clamp(h, 0.01, 0.8);
    if (res < 0.001 || t > tmax) break;
  }
  res = saturate(res);
  return res * res * (3.0 - 2.0 * res);
}

// ------------------------------------------------------------------ the ground
// March the height field: steps from the height above the ground's local tangent plane, with a
// safety factor for slopes; hits are bisected back onto the surface; a ray that runs out of steps
// has crept along the ground at a grazing angle and counts as a hit.
float marchGround(vec3 ro, vec3 rd, float tmax, float pix) {
  float t = 0.0, tPrev = 0.0;
  float rock;
  // Start where the ray comes down to the highest the ground can be.
  if (ro.y > 30.0 && rd.y < 0.0) t = max((ro.y - 30.0) / -rd.y, 0.0);
  else if (ro.y > 30.0) return -1.0;
  for (int i = 0; i < 170; i++) {
    vec3 p = ro + rd * t;
    // The baked ground first; the stones and small craters (under 0.35 m) only close to it.
    float hb = bakedGround(p.xz).x - dot(p.xz, p.xz) / (2.0 * R_MOON);
    float dy = p.y - hb;
    float step = (dy - 0.35) * 0.6;
    if (dy < 0.45) {
      float fade = smoothstep(30.0, 8.0, t);
      dy = p.y - hb - groundFine(p.xz, fade, rock);
      if (dy < 0.0) {
        float a = tPrev, b = t;
        for (int k = 0; k < 6; k++) {
          float m = 0.5 * (a + b);
          vec3 q = ro + rd * m;
          if (q.y < groundAt(q.xz, m, rock)) b = m; else a = m;
        }
        return b;
      }
      if (dy < pix * t * 0.3) return t;
      step = dy * 0.5;
    }
    tPrev = t;
    t += max(step, 0.003 + t * 0.004);
    if (t > tmax) return -1.0;
  }
  return t;
}

vec3 groundNormal(vec2 p, float dist, out float rock, out float sunlit) {
  vec4 g = bakedGround(p);
  sunlit = g.w;
  float e = clamp(dist * 0.002, 0.004, 0.3);
  float fade = smoothstep(30.0, 8.0, dist);
  float f0 = groundFine(p, fade, rock);
  float r1;
  float fx = groundFine(p + vec2(e, 0.0), fade, r1), fz = groundFine(p + vec2(0.0, e), fade, r1);
  vec2 slope = g.yz + vec2(fx - f0, fz - f0) / e;
  return normalize(vec3(-slope.x, 1.0, -slope.y));
}

// Shadows of the small stones and craters near the camera (the bake holds the large ones).
float fineShadow(vec3 p, vec3 l, float dist) {
  if (dist > 28.0) return 1.0;
  float res = 1.0, t = 0.03;
  float rock;
  for (int i = 0; i < 16; i++) {
    vec3 q = p + l * t;
    float h = groundAt(q.xz, dist, rock);
    res = min(res, 18.0 * (q.y - h) / t);
    t += 0.05 + t * 0.2;
    if (res < 0.0 || t > 6.0) break;
  }
  return saturate(res);
}

vec3 shadeGround(vec3 p, vec3 rd, float dist) {
  float rock, sunlit;
  vec3 n = groundNormal(p.xz, dist, rock, sunlit);
  vec3 l = uSunDir;
  // Mare regolith: dark grey with a hint of brown; stones a little lighter and bluer.
  float v = fbm(p.xz * 0.8, 4) * 0.5 + fbm(p.xz * 7.0, 3) * 0.5;
  vec3 alb = vec3(0.125, 0.118, 0.108) * (0.82 + 0.36 * v);
  alb = mix(alb, vec3(0.16, 0.158, 0.155) * (0.8 + 0.4 * hash12(floor(p.xz * 11.0))), rock);
  float sh = sunlit * fineShadow(p + n * 0.01, l, dist) * objShadow(p + n * 0.02, l);
  vec3 col = alb * SUN_C * uSunE * regolith(n, l, -rd) * sh;
  // Light from the sunlit ground all round (a faint fill in the shadows) and from the Earth.
  col += alb * vec3(0.06, 0.06, 0.062) * uSunE * (0.35 + 0.65 * saturate(n.y));
  return col;
}

// ------------------------------------------------------------------ the lander
// Crinkled foil: flat facets a few centimetres across, each tilted its own way (Voronoi cells in
// the surface), so the sunlight breaks into glints; broad soft wrinkles over them.
vec3 foilNormal(vec3 n, vec3 p, float scale) {
  vec3 a = abs(n);
  vec2 uv = a.x > a.y && a.x > a.z ? p.yz : a.y > a.z ? p.xz : p.xy;
  vec2 g = floor(uv * scale), f = fract(uv * scale);
  float best = 8.0;
  vec2 id = g;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(i, j);
      vec2 r = o + hash22(g + o) - f;
      float dd = dot(r, r);
      if (dd < best) { best = dd; id = g + o; }
    }
  vec3 tilt = hash33(vec3(id, 3.0)) * 2.0 - 1.0;
  vec3 wr = vec3(gnoise(uv * 2.0), gnoise(uv * 2.0 + 5.0), gnoise(uv * 2.0 + 9.0));
  return normalize(n + 0.16 * tilt + 0.14 * wr);
}

vec3 shadeObject(vec3 p, vec3 rd, float mat, int id, float dist, float pix) {
  vec3 n = objNormal(p, max(0.0015, dist * pix * 0.5));
  vec3 l = uSunDir;
  float sh = objShadow(p + n * 0.02, l);
  vec3 v = -rd;
  vec3 alb = vec3(0.5);
  float spec = 0.08, rough = 20.0;
  vec3 specC = vec3(1.0);
  vec3 lq = uLmRot * (p - uLmPos);
  if (id == 1) {
    if (mat < 1.5) {
      // Descent stage: amber-gold Kapton, crinkled, with a few black and silver patches.
      n = foilNormal(n, lq, 17.0);
      float patchy = smoothstep(0.64, 0.68, fbm(lq.xy * 0.7 + lq.z, 3));
      alb = mix(vec3(0.46, 0.3, 0.08), vec3(0.42, 0.42, 0.41), patchy * 0.7);
      spec = 1.6;
      rough = 120.0;
      specC = mix(vec3(1.0, 0.7, 0.28), vec3(1.0), patchy);
    } else if (mat < 2.5) {
      alb = vec3(0.045);
      spec = 0.25;
      rough = 30.0;
      // The front face: the windows and the forward hatch.
      vec3 fq = lq - vec3(0.0, 4.45, 1.25);
      float up = dot(fq, vec3(0.0, 0.9496, -0.3134));
      vec2 w = vec2(abs(lq.x) - 0.52, up - 0.28);
      float win = sdTriangle(w, vec2(-0.3, -0.2), vec2(0.26, -0.2), vec2(0.26, 0.24));
      if (lq.z > 0.9 && win < 0.0) { alb = vec3(0.012); spec = 0.35; rough = 300.0; }
      float hatch = sdBox(vec2(lq.x, lq.y - 3.55), vec2(0.4, 0.4));
      if (lq.z > 1.1 && abs(hatch) < 0.025) alb = vec3(0.35, 0.35, 0.34);
    } else if (mat < 3.5) {
      // Ascent stage: grey and aluminised panels, faceted, a few of them black.
      vec2 cell = floor(vec2(lq.x * 1.4 + lq.z * 0.6, lq.y * 1.8));
      float k = hash12(cell);
      alb = mix(vec3(0.3, 0.31, 0.32), vec3(0.5, 0.5, 0.5), k);
      if (k > 0.84) alb = vec3(0.05);
      // Aluminised blankets, a softer sheen with wrinkles.
      n = normalize(n + 0.05 * vec3(gnoise(lq.xy * 6.0), gnoise(lq.yz * 6.0 + 2.0), gnoise(lq.zx * 6.0 + 4.0)));
      spec = 0.7;
      rough = 35.0;
    } else if (mat < 4.5) {
      alb = vec3(0.45, 0.38, 0.26);
      n = foilNormal(n, lq, 14.0);
      spec = 0.6; rough = 60.0; specC = vec3(1.0, 0.85, 0.6);
    } else if (mat < 5.5) {
      alb = vec3(0.5, 0.42, 0.25);
      n = foilNormal(n, lq, 16.0);
      spec = 0.7; rough = 60.0; specC = vec3(1.0, 0.8, 0.45);
    } else if (mat < 7.5) {
      alb = vec3(0.75, 0.75, 0.73);
      spec = 0.2;
    } else if (mat < 8.5) {
      alb = vec3(0.12, 0.12, 0.12);
      spec = 0.5;
    } else {
      alb = vec3(0.08, 0.075, 0.07);
      spec = 0.4;
    }
  }
  float ndl = max(dot(n, l), 0.0);
  vec3 h = normalize(l + v);
  vec3 col = alb * SUN_C * uSunE * ndl * sh;
  col += specC * SUN_C * uSunE * sh * spec * pow(max(dot(n, h), 0.0), rough) * (rough + 8.0) / 60.0;
  // Fill from the sunlit ground below (the Moon reflects about an eighth of the light), and
  // from nothing above (the sky is black).
  col += alb * vec3(0.1, 0.098, 0.094) * uSunE * saturate(-n.y * 0.6 + 0.45);
  return col;
}

// ------------------------------------------------------------------ the dust sheet
// Blasted off by the engine and streaming out in straight lines just above the ground, thin
// near the centre and dense in a ring round it; lit by the Sun and seen from above as streaks.
vec4 dustSheet(vec3 ro, vec3 rd, float tmax) {
  if (uDust.z <= 0.0) return vec4(0.0);
  vec2 c = uDust.xy;
  float top = 3.5;
  // The slab 0 < y < top over the ground (the plain is nearly level here).
  float t0 = 0.0, t1 = tmax;
  if (abs(rd.y) > 1e-4) {
    float ta = (top - ro.y) / rd.y, tb = (-0.5 - ro.y) / rd.y;
    t0 = max(min(ta, tb), 0.0);
    t1 = min(max(ta, tb), tmax);
  }
  if (t1 <= t0) return vec4(0.0);
  vec3 sum = vec3(0.0);
  float trans = 1.0;
  const int N = 20;
  float dt = (t1 - t0) / float(N);
  for (int i = 0; i < N; i++) {
    float t = t0 + (float(i) + 0.5) * dt;
    vec3 p = ro + rd * t;
    vec2 q = p.xz - c;
    float r = length(q);
    float y = p.y - bakedGround(p.xz).x;
    // The sheet rises a few degrees as it spreads; densest in a ring a few metres out.
    float thick = 0.1 + r * 0.025;
    float den = exp(-max(y, 0.0) / thick) * step(-0.05, y);
    den *= smoothstep(0.8, 5.0, r) * exp(-r / 34.0);
    // Radial streaks racing outward: long thin rays of dust, softly edged.
    float ang = atan(q.y, q.x);
    float streak = fbm(vec2(ang * 40.0, r * 0.05 - uDust.w * 6.0), 3);
    float fine = fbm(vec2(ang * 160.0, r * 0.25 - uDust.w * 20.0), 3);
    // (The streaks soften far out and close to the camera, where they would draw spokes.)
    float crisp = smoothstep(4.0, 14.0, t) * (1.0 - smoothstep(25.0, 60.0, r));
    den *= mix(0.9, 0.5 + 1.0 * smoothstep(0.4, 0.72, streak) + 0.35 * smoothstep(0.45, 0.8, fine), crisp);
    den *= uDust.z * 0.45;
    if (den < 1e-4) continue;
    float st = exp(-den * dt);
    // Fine dust scatters sunlight back towards its source (seen with the Sun behind the camera)
    // and forwards (against it): bright either way against the darker ground.
    float cs = dot(rd, uSunDir);
    vec3 light = SUN_C * uSunE * vec3(0.3, 0.29, 0.27) * (0.8 + 1.2 * pow(max(cs, 0.0), 4.0) + 0.8 * pow(max(-cs, 0.0), 6.0));
    sum += trans * light * (1.0 - st);
    trans *= st;
  }
  return vec4(sum, 1.0 - trans);
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos;
  float pix = pixelAngle(uRes.y);

  // The lander: march within its bounds.
  float tObj = -1.0, mat = 0.0;
  int id = 0;
  vec2 bl = raySphere(ro, rd, uLmPos + vec3(0.0, 3.2, 0.0), 6.8);
  float ob = bl.y;
  if (ob > 0.0) {
    float t = max(bl.x, 0.0);
    for (int i = 0; i < 140; i++) {
      float m; int k;
      float d = objects(ro + rd * t, m, k);
      if (d < max(0.0008, pix * t * 0.35)) { tObj = t; mat = m; id = k; break; }
      t += d;
      if (t > ob) break;
    }
  }
  float tG = marchGround(ro, rd, 60000.0, pix);
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  float tHit = 1e9;
  if (tObj > 0.0 && (tG < 0.0 || tObj < tG)) {
    col = shadeObject(ro + rd * tObj, rd, mat, id, tObj, pix);
    alpha = 1.0;
    tHit = tObj;
  } else if (tG > 0.0) {
    col = shadeGround(ro + rd * tG, rd, tG);
    alpha = 1.0;
    tHit = tG;
  }
  vec4 dust = dustSheet(ro, rd, tHit);
  col = col * (1.0 - dust.a) + dust.rgb;
  alpha = max(alpha, dust.a);
  fragColor = vec4(col, alpha);
}
