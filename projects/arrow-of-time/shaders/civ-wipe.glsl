// The objects that sweep past the lens between two civilization tableaux and hide the join: a
// date palm, a city wall, a stack of quarried blocks, a Doric column, a cathedral pier, a mill
// chimney, a telegraph pole, a floodlight mast. Each is opaque along its centre line uX, where the
// two tableaux meet, and out of focus. Premultiplied colour and coverage, drawn over both.
#include <illustration>
#include <sdf>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uGTime;
uniform float uX;        // the object's centre line in the picture
uniform int uKind;
uniform vec2 uSun;
uniform float uElev;
uniform float uBlur;     // defocus, in pixels

void main() {
  vec2 p = centered(vUv, uAspect);
  float px = 1.0 / uRes.y;
  vec2 q = p - vec2(uX, 0.0);
  float aa = px * uBlur;
  float d = 1e9;
  vec3 tint = vec3(0.0);          // light on the surface (texture, lit edges)
  SkyTone st = skyTone(uElev);
  vec3 ink = vec3(0.012, 0.01, 0.012);
  if (uKind == 0) {
    // Date palm: a trunk curving up through the frame, its old leaf bases in a diamond pattern,
    // fronds arching out at the top.
    float cx = 0.03 * q.y * q.y - 0.02 * q.y;
    float r = 0.075 - 0.012 * q.y;
    d = abs(q.x - cx) - r;
    float dia = abs(fract((q.y * 18.0) + (q.x - cx) * 6.0) - 0.5) + abs(fract((q.y * 18.0) - (q.x - cx) * 6.0) - 0.5);
    tint = st.glow * 0.035 * smoothstep(0.35, 0.6, dia);
    vec2 crown = vec2(cx + 0.02, 0.36);
    for (int i = 0; i < 7; i++) {
      float a = -0.3 + float(i) * 0.55;
      vec2 dir = vec2(cos(a), sin(a) * 0.5 + 0.2);
      vec2 tip = crown + dir * 0.6 + vec2(0.0, -0.25 * abs(dir.x));
      d = min(d, sdBezierTaper(q, crown, crown + dir * 0.3 + vec2(0.0, 0.08), tip, 0.03, 0.004));
    }
  } else if (uKind == 1) {
    // The city wall of mud brick, buttressed, its edge passing close.
    float w = 0.3;
    d = abs(q.x) - w;
    float course = smoothstep(0.08, 0.0, abs(fract(q.y * 26.0) - 0.5) - 0.4);
    float brick = step(0.5, fract(q.x * 9.0 + 0.5 * floor(q.y * 26.0)));
    tint = st.horizon * 0.06 * (0.6 + 0.4 * brick) * (1.0 - 0.5 * course);
    d = max(d, q.y - 0.45 + 0.05 * step(0.5, fract(q.x * 6.0)));
  } else if (uKind == 2) {
    // Blocks of quarried limestone stacked by the causeway.
    d = abs(q.x) - 0.22;
    vec2 cell = vec2(q.x * 3.2 + 0.5 * floor(q.y * 4.5), q.y * 4.5);
    vec2 f = abs(fract(cell) - 0.5);
    float joint = smoothstep(0.47, 0.5, max(f.x * 1.0, f.y));
    tint = st.horizon * 0.09 * (1.0 - joint) * (0.85 + 0.3 * hash12(floor(cell)));
    d += 0.01 * gnoise(q * 20.0);
  } else if (uKind == 3) {
    // A Doric column of Pentelic marble: fluted, with a faint sheen on its lit side.
    float r = 0.16 - 0.015 * q.y;
    d = abs(q.x) - r;
    float flute = 0.5 + 0.5 * cos(q.x / r * 3.1416 * 10.0);
    tint = st.glow * 0.06 * (0.5 + 0.5 * flute) * smoothstep(-r, r, q.x);
  } else if (uKind == 4) {
    // A pier of the cathedral: grey sandstone with a chamfered edge and a shaft set into it.
    d = abs(q.x) - 0.2;
    d = min(d, length(vec2(abs(q.x) - 0.2, 0.0)) - 0.04);
    float course = smoothstep(0.06, 0.0, abs(fract(q.y * 10.0) - 0.5) - 0.44);
    tint = st.horizon * 0.05 * (1.0 - course);
  } else if (uKind == 5) {
    // A mill chimney of sooty brick, smoke rolling from its top out of frame.
    float r = 0.11 - 0.012 * q.y;
    d = abs(q.x) - r;
    float course = smoothstep(0.1, 0.0, abs(fract(q.y * 34.0) - 0.5) - 0.4);
    tint = vec3(0.35, 0.12, 0.06) * 0.08 * (1.0 - 0.6 * course) + st.glow * 0.03 * smoothstep(0.0, r, q.x);
  } else if (uKind == 6) {
    // A telegraph pole, its crossarm and insulators high up, wires sagging away on both sides.
    d = abs(q.x) - 0.022;
    float arm = sdBox(q - vec2(0.0, 0.3), vec2(0.2, 0.012));
    d = min(d, arm);
    for (int i = -1; i <= 1; i += 2) {
      vec2 ins = vec2(float(i) * 0.15, 0.32);
      d = min(d, sdRoundBox(q - ins, vec2(0.012, 0.02), 0.006));
      float sag = ins.y + 0.012 + 0.03 * pow(abs(q.x - ins.x), 1.5) * 0.4;
      d = min(d, abs(q.y - sag) - 0.0022);
    }
    tint = st.glow * 0.02;
  } else {
    // A floodlight mast: a steel tube with a platform of lamps, blazing, at the top.
    d = abs(q.x) - 0.035;
    d = min(d, sdBox(q - vec2(0.0, 0.3), vec2(0.13, 0.02)));
    for (int i = -2; i <= 2; i++) d = min(d, sdRoundBox(q - vec2(float(i) * 0.05, 0.34), vec2(0.02, 0.022), 0.006));
    tint = vec3(0.02, 0.025, 0.035);
  }
  float a = cover(d, aa);
  // A rim of light on the edge facing the sun (the object is backlit).
  float rim = exp(-abs(d) / (aa * 1.5)) * max(dot(normalize(vec2(1.0, 0.0) * sign(uSun.x - uX + 1e-4)), vec2(sign(q.x), 0.0)), 0.0);
  vec3 col = ink + tint + st.glow * 0.08 * rim;
  if (uKind == 7) col += vec3(1.0, 0.95, 0.85) * 6.0 * cover(sdBox(q - vec2(0.0, 0.345), vec2(0.12, 0.012)), aa);
  fragColor = vec4(col * a, a);
}
