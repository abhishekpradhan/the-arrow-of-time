// Camera rays that match engine/core/camera.ts exactly.
uniform vec3 uCamPos;
uniform vec3 uCamFwd;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uTanHalfFov;
uniform float uNear;
uniform float uFar;
uniform mat4 uViewProj;
// Sub-pixel offset of the current motion-blur sample, in picture heights (set by the engine),
// so accumulating samples also anti-aliases ray-marched edges.
uniform vec2 uJitter;

// p: centered picture coordinates (y in [-0.5, 0.5]).
vec3 camRay(vec2 p) {
  p += uJitter;
  return normalize(uCamFwd + (p.x * uCamRight + p.y * uCamUp) * (2.0 * uTanHalfFov));
}

// Angular size of one pixel (radians) near the view centre.
float pixelAngle(float resY) { return 2.0 * uTanHalfFov / resY; }

// Convert a hit point to window depth, so ray-marched surfaces can occlude sprites.
float depthOf(vec3 worldPos) {
  vec4 c = uViewProj * vec4(worldPos, 1.0);
  return clamp(c.z / c.w * 0.5 + 0.5, 0.0, 1.0);
}
