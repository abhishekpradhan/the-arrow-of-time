// Sputnik 1 in orbit, October 1957: a polished 58 cm sphere with four whip antennas trailing
// behind it, tumbling slowly over the night side of the Earth as the Sun comes up over the limb.
// The Earth itself is drawn beforehand by the Planet component (kilometres, its centre at
// uEarthC); this pass draws the satellite in metres around the origin and leaves the sky
// transparent, adding only the Sun's glare where the Earth does not hide it.
#include <noise>
#include <color>
#include <camera>
#include <sdf3>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uT;
uniform mat3 uSpin;        // satellite orientation (local -> world)
uniform vec3 uSun;         // direction to the Sun (world)
uniform vec3 uEarthC;      // Earth centre (km, world)
uniform float uEarthR;     // Earth radius (km)

const vec3 SUN_COL = vec3(1.0, 0.97, 0.92) * 3.4;
const float BALL = 0.29;

// Distance (metres) to the satellite; mat 0 = the sphere, 1 = an antenna.
float sat(vec3 p, out float mat) {
  vec3 q = transpose(uSpin) * p;              // world -> local: the antennas trail along -x
  float d = length(q) - BALL;
  mat = 0.0;
  float ant = 1e9;
  for (int i = 0; i < 4; i++) {
    float a = float(i) * 1.5708 + 0.785;
    float len = (i & 1) == 0 ? 2.4 : 2.9;
    // Rooted on the back of the sphere, swept 35 degrees back from its axis.
    vec3 dir = normalize(vec3(-0.82, 0.574 * cos(a), 0.574 * sin(a)));
    vec3 root = dir * (BALL - 0.02);
    ant = min(ant, sdTaper(q, root, root + dir * len, 0.011, 0.004));
  }
  if (ant < d) { d = ant; mat = 1.0; }
  return d;
}

vec3 satNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  float m;
  float e = 0.0015;
  return normalize(k.xyy * sat(p + k.xyy * e, m) + k.yyx * sat(p + k.yyx * e, m) + k.yxy * sat(p + k.yxy * e, m) + k.xxx * sat(p + k.xxx * e, m));
}

// Does a ray from the satellite (km) reach the Sun, or does the Earth stand in the way? Also
// returns how deep into the atmosphere it grazes, for the reddening of the low Sun.
float sunVisible(vec3 rd, out float graze) {
  vec3 oc = -uEarthC;                          // the satellite sits at the origin
  float b = dot(oc, rd);
  float closest = length(oc - rd * max(-b, 0.0));
  graze = closest - uEarthR;                   // km above the surface at the closest approach
  return smoothstep(-8.0, 30.0, graze);
}

// What a mirror sees: the Earth below (day side blue and white, night side dark, the limb
// glowing), black sky, and the Sun.
vec3 env(vec3 r) {
  vec3 oc = -uEarthC;
  float b = dot(oc, r);
  float h = b * b - (dot(oc, oc) - uEarthR * uEarthR);
  vec3 col = vec3(0.0);
  float graze;
  float sunUp = sunVisible(uSun, graze);
  if (h > 0.0) {
    float t = -b - sqrt(h);
    vec3 pos = r * t;
    vec3 n = normalize(pos - uEarthC);
    float ndl = dot(n, uSun);
    float day = smoothstep(-0.08, 0.25, ndl);
    float cloud = smoothstep(0.5, 0.75, fbm(n * 5.0 + 3.0, 4));
    vec3 dayCol = mix(vec3(0.08, 0.2, 0.45), vec3(0.9, 0.92, 0.95), cloud) * max(ndl, 0.0) * 1.6;
    vec3 nightCol = vec3(0.004, 0.005, 0.01);
    col = mix(nightCol, dayCol, day);
    // The rim of atmosphere brightens towards the limb, warm at the terminator.
    float mu = max(dot(n, -r), 0.0);
    float rim = pow(1.0 - mu, 2.5);
    float twilight = exp(-pow(ndl / 0.2, 2.0));
    col += (vec3(0.3, 0.55, 1.0) * smoothstep(-0.25, 0.4, ndl) * 1.2 + vec3(1.0, 0.45, 0.2) * twilight * 0.9) * rim;
  } else {
    float mu = max(dot(r, uSun), 0.0);
    col += SUN_COL * (pow(mu, 1500.0) * 12.0 + pow(mu, 40.0) * 0.12) * sunUp;
  }
  return col;
}

void main() {
  vec2 p = centered(vUv, uAspect);
  vec3 rd = camRay(p);
  vec3 ro = uCamPos * 1000.0;                  // the camera in metres (Sputnik at the origin)
  float pix = pixelAngle(uRes.y);
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  float graze;
  float sunUp = sunVisible(uSun, graze);
  vec3 sunLight = SUN_COL * sunUp * mix(vec3(1.0, 0.45, 0.2), vec3(1.0), smoothstep(-5.0, 40.0, graze));
  // March the satellite inside its bounding sphere.
  float m;
  vec2 bs = raySphere(ro, rd, vec3(0.0), 3.4);
  if (bs.y > 0.0) {
    float t = max(bs.x, 0.0);
    for (int i = 0; i < 90; i++) {
      float d = sat(ro + rd * t, m);
      if (d < pix * t * 0.6) {
        vec3 pos = ro + rd * t;
        vec3 n = satNormal(pos);
        float dif = max(dot(n, uSun), 0.0);
        // Earthshine: a soft blue fill from below.
        vec3 toEarth = normalize(uEarthC);
        vec3 earthshine = vec3(0.12, 0.2, 0.35) * max(dot(n, toEarth) * 0.5 + 0.5, 0.0) * 0.35;
        if (m < 0.5) {
          // Polished aluminium alloy: a mirror of the Earth, the sky and the Sun.
          vec3 r = reflect(rd, n);
          vec3 mirror = env(r);
          float fres = 0.75 + 0.25 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
          col = mirror * fres * vec3(0.95, 0.96, 0.98) + vec3(0.04) * (sunLight * dif + earthshine);
          // A hint of the machined seam round the equator.
          vec3 q = transpose(uSpin) * pos;
          col *= 1.0 - 0.15 * smoothstep(0.012, 0.0, abs(q.x));
        } else {
          vec3 alb = vec3(0.7, 0.72, 0.75);
          vec3 h = normalize(uSun - rd);
          col = alb * (sunLight * dif + earthshine) + sunLight * 0.5 * pow(max(dot(n, h), 0.0), 40.0);
        }
        alpha = 1.0;
        break;
      }
      t += d;
      if (t > bs.y) break;
    }
  }
  if (alpha < 1.0) {
    // The Sun's glare where the Earth does not hide it (rays from the camera, in km).
    vec3 oc = uCamPos - uEarthC;
    float b = dot(oc, rd);
    float h = b * b - (dot(oc, oc) - uEarthR * uEarthR);
    float mu = max(dot(rd, uSun), 0.0);
    float closest = length(oc - rd * max(-b, 0.0));
    float g = closest - uEarthR;
    float clear = (h > 0.0 && -b > 0.0) ? 0.0 : 1.0;
    float haze = smoothstep(-5.0, 45.0, g);
    vec3 tint = mix(vec3(1.0, 0.4, 0.15), vec3(1.0), haze);
    vec3 glare = SUN_COL * tint * (pow(mu, 4000.0) * 40.0 + pow(mu, 400.0) * 0.12 + pow(mu, 16.0) * 0.005) * clear * mix(0.15, 1.0, haze);
    col = col * alpha + glare * (1.0 - alpha);
  }
  fragColor = vec4(col, alpha);
}
