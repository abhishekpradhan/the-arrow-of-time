// Placeholder for an age whose scene is not built yet.
#include <common>
in vec2 vUv; out vec4 fragColor;
uniform float uSlate;
void main() {
  fragColor = vec4(vec3(0.03, 0.035, 0.05) * (1.0 + 0.3 * vUv.y) + 0.01 * uSlate, 1.0);
}
