// The plasma that fills the young universe, seen from inside it, from the Big Bang to the
// moment it turns transparent. There is no outside to watch the bang from: the instant after
// the point lets go the camera is in the fireball, and space carries the plasma past it (a
// flight through a volume of fire, towards the place everything came from). Clouds of denser
// plasma, threaded with hot filaments, hang against the glow of everything behind them. The
// shots (film/shots/universe.ts) animate the flight, the temperature and the density: the
// first rush and the title, inflation, the nuclear age, and the clearing at first light, when
// the fog thins away in front of a great light and what is left is the sky.
#include <noise>
#include <color>
in vec2 vUv; out vec4 fragColor;
uniform sampler3D uNoise;
uniform vec2 uRes;
uniform float uAspect;
uniform float uTravel;   // distance flown
uniform float uSpeed;    // speed now: the plasma smears along the flight
uniform float uSeed;     // decorrelates the march jitter between motion-blur samples
uniform float uHeat;     // temperature of the clouds on the fire ramp (0..1)
uniform float uPower;    // how much light there is
uniform float uGlowHeat; // temperature of the glow behind the clouds
uniform vec3 uGlowDir;   // where the glow is brightest (dead ahead in the first second)
uniform float uAhead;    // how much brighter it is there, and how wide (radians squared)
uniform float uAheadW;
uniform float uCalm;     // thins the plasma across the middle of the frame, where the title sits
uniform float uDens;     // cloud density
uniform float uMottle;   // contrast of the hot and cold spots of the sky behind it all
uniform float uYaw;      // the camera pans (radians)
uniform float uRoll;

const int STEPS = 96;

void main() {
  vec2 p = centered(vUv, uAspect);
  // (x is negated to match the engine's right-handed Camera, which draws the sprites.)
  vec3 rd = rotY(uYaw) * normalize(vec3(-p.x, p.y, 1.0));

  // At speed, structures stretch into filaments that converge on the centre: what speed looks
  // like from inside.
  float stretch = 1.0 / (1.0 + 0.55 * uSpeed);
  mat2 roll = rot2(uRoll);

  float jitter = hash12(gl_FragCoord.xy + uSeed * 61.7);
  float t = 0.1 + 0.035 * jitter;
  // What is dead centre is far away and still small: the middle of the frame is calmer.
  float calm = uCalm * exp(-pow(p.x / 0.8, 2.0) - pow(p.y / 0.2, 2.0));
  vec3 acc = vec3(0.0);
  float trans = 1.0;
  if (uDens > 0.001) {
    for (int i = 0; i < STEPS; i++) {
      float dt = 0.03 + 0.04 * t;
      vec3 pos = vec3(roll * (rd.xy * t), (uTravel + rd.z * t) * stretch);
      vec4 big = texture(uNoise, pos * 0.043 + vec3(0.13, 0.57, 0.31));
      vec4 fine = texture(uNoise, pos * 0.16 + (big.xyz - 0.5) * 0.42);
      // Far away the steps outgrow the fine detail: let it go rather than alias it into grit.
      float lod = smoothstep(0.3, 0.9, dt);
      float n = big.a * 0.6 + mix(fine.a, 0.5, lod) * 0.4;
      // Clouds with clear lanes between them, a little wider along the axis of the flight.
      float lane = smoothstep(0.0, 2.2, length(pos.xy * vec2(0.6, 1.0)));
      float dens = smoothstep(0.47, 0.8, n - 0.1 * (1.0 - lane)) * smoothstep(0.1, 0.9, t) * (1.0 - 0.6 * calm) * uDens;
      if (dens > 0.001) {
        // Hot filaments thread the cooler body of each cloud.
        float fil = pow(max(1.0 - abs(2.0 * fine.r - 1.0), 0.0), 5.0) * (1.0 - lod) * (1.0 - 0.5 * calm);
        // Near the camera the filaments fray into finer threads.
        float near = 1.0 - smoothstep(0.1, 0.32, dt);
        if (near > 0.0) {
          float micro = texture(uNoise, pos * 0.43 + (fine.xyz - 0.5) * 0.25).g;
          fil = mix(fil, max(fil, pow(max(1.0 - abs(2.0 * micro - 1.0), 0.0), 7.0) * (0.5 + fil)), near);
        }
        float heat = max(uHeat - 0.15 + 0.32 * fil + 0.2 * (big.b - 0.5) - 0.006 * t, uHeat - 0.26);
        vec3 e = fireRamp(heat) * (0.28 + 1.5 * heat * heat) * (0.6 + 2.0 * fil) * uPower;
        float a = 1.0 - exp(-dens * dt * 1.2);
        acc += trans * e * a;
        trans *= 1.0 - a;
        if (trans < 0.015) break;
      }
      t += dt;
    }
  }

  // Behind the clouds, the glow of all the plasma beyond them: hottest dead ahead in the first
  // seconds, then a deep, even amber. Once the fog has cleared this is the whole sky, and it is
  // not quite even: slightly hotter and cooler spots a degree or so across, the seeds of
  // everything to come.
  float ahead = uAhead * exp(-2.0 * (1.0 - dot(rd, uGlowDir)) / uAheadW);
  float spots = 0.0;
  if (uMottle > 0.0) {
    // (Hashed noise here, not the tiling volume: at this scale its period would show.)
    spots = uMottle * clamp(0.75 * gfbm(rd * 26.0, 4) + 0.3 * gnoise(rd * 6.0 + 3.0), -0.8, 0.8);
  }
  float gh = max(uGlowHeat + 0.25 * ahead + 0.1 * spots, 0.06);
  vec3 glow = fireRamp(gh) * (0.42 + 0.75 * gh * gh) * uPower * (0.8 + 1.2 * ahead) * (1.0 + (0.5 + 0.5 * uMottle * (1.0 - uGlowHeat)) * spots);
  fragColor = vec4(acc + trans * max(glow, 0.0), trans);
}
