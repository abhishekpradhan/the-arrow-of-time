import type { Vec3 } from './math';

export function srgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** '#rrggbb' -> linear RGB. */
export function hex(h: string): Vec3 {
  const n = parseInt(h.replace('#', ''), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

/**
 * Approximate blackbody colour (linear RGB, max component ~1). Mirrors blackbody() in color.glsl:
 * Tanner Helland's curve fit (2012) to Mitchell Charity's blackbody colour table.
 */
export function blackbody(T: number): Vec3 {
  const t = Math.min(Math.max(T, 1000), 40000) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (x: number) => srgbToLinear(Math.min(Math.max(x, 0), 255) / 255);
  return [c(r), c(g), c(b)];
}

export function scaleColor(c: Vec3, s: number): Vec3 {
  return [c[0] * s, c[1] * s, c[2] * s];
}
