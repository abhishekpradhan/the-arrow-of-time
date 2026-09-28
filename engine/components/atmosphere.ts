// A physically based atmosphere for a planet (engine/shaders/atmosphere.glsl): the colour of the
// sky from the ground and of the limb from orbit, sunsets and the planet's shadow. The component
// bakes the transmittance table once (the first time uniforms() is called in a shot's render)
// and supplies the chunk's uniforms; the shader does the rest. Defaults are the Earth's.
import type { Vec3 } from '../core/math';
import type { ShotContext } from '../core/types';
import { RenderTarget, bindState, type UniformValue } from '../gl/gl';

export interface AtmosphereParams {
  /** Planet radius (km). */
  radius?: number;
  /** Thickness of the atmosphere (km). */
  height?: number;
  /** Rayleigh scattering at the ground (per km), and its scale height (km). */
  rayleigh?: Vec3;
  rayleighH?: number;
  /** Mie (haze) scattering at the ground (per km), extinction over scattering, scale height, asymmetry. */
  mie?: number;
  mieExt?: number;
  mieH?: number;
  mieG?: number;
  /** Ozone absorption at the layer's peak (per km), and the layer (centre altitude, half width). */
  ozone?: Vec3;
  ozoneLayer?: [number, number];
  /** Angular radius of the light source (radians): the softness of the planet's shadow. */
  sunSize?: number;
}

const EARTH: Required<AtmosphereParams> = {
  radius: 6371,
  height: 100,
  rayleigh: [5.802e-3, 13.558e-3, 33.1e-3],
  rayleighH: 8,
  mie: 3.996e-3,
  mieExt: 1.11,
  mieH: 1.2,
  mieG: 0.8,
  ozone: [0.65e-3, 1.881e-3, 0.085e-3],
  ozoneLayer: [25, 15],
  sunSize: 0.00465,
};

const LUT_W = 256;
const LUT_H = 64;

// Transmittance from radius r along cosine mu to space, for rays that reach it (the table's
// parameterization is atmoLutUv's, inverted).
const BAKE = `
#include <atmosphere>
in vec2 vUv; out vec4 fragColor;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5) / (uAtmoLutSize - 1.0);
  float H = sqrt(uAtmoTop * uAtmoTop - uAtmoR * uAtmoR);
  float rho = H * uv.y;
  float r = sqrt(rho * rho + uAtmoR * uAtmoR);
  float dMin = uAtmoTop - r, dMax = rho + H;
  float d = dMin + uv.x * (dMax - dMin);
  float mu = d < 1e-4 ? 1.0 : clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
  vec3 tau = vec3(0.0);
  const int N = 400;
  for (int i = 0; i < N; i++) {
    float s = (float(i) + 0.5) / float(N) * d;
    float ri = sqrt(r * r + s * s + 2.0 * r * mu * s);
    tau += atmoExtinction(ri - uAtmoR);
  }
  fragColor = vec4(exp(-tau * d / float(N)), 1.0);
}`;

export class Atmosphere {
  p: Required<AtmosphereParams>;
  private lut: RenderTarget | null = null;

  constructor(p: AtmosphereParams = {}) {
    this.p = { ...EARTH, ...p };
  }

  /** The chunk's uniforms (bakes the table on first use, restoring the bound target). */
  uniforms(c: ShotContext): Record<string, UniformValue> {
    const p = this.p;
    const u: Record<string, UniformValue> = {
      uAtmoR: p.radius,
      uAtmoTop: p.radius + p.height,
      uAtmoRay: p.rayleigh,
      uAtmoRayH: p.rayleighH,
      uAtmoMie: p.mie,
      uAtmoMieExt: p.mieExt,
      uAtmoMieH: p.mieH,
      uAtmoMieG: p.mieG,
      uAtmoOzone: p.ozone,
      uAtmoOzoneLayer: p.ozoneLayer,
      uAtmoSunSize: p.sunSize,
      uAtmoLutSize: [LUT_W, LUT_H],
    };
    if (!this.lut) {
      const gl = c.gl;
      const prev = bindState.target;
      const blend = gl.isEnabled(gl.BLEND);
      gl.disable(gl.BLEND);
      this.lut = new RenderTarget(gl, LUT_W, LUT_H, { format: 'rgba16f', filter: 'linear', wrap: 'clamp' });
      this.lut.bind();
      c.fullscreen(c.e.program(BAKE, 'atmosphere-lut'), u);
      (prev ?? c.target).bind();
      if (blend) gl.enable(gl.BLEND);
    }
    return { ...u, uAtmoLUT: this.lut };
  }
}
