// A tiling 3D noise texture for ray-marched volumes (fire, cloud, nebulae): one fetch of a baked
// volume replaces several octaves of hashed noise per march step, which is what makes a
// volumetric shot affordable on a software renderer.
//
//   const vol = noiseVolume(e.gl, { size: 64, seed: 3 });
//   // GLSL: uniform sampler3D uNoise;  vec4 n = texture(uNoise, p * 0.05);
//
// Each of the four channels holds an independent value-noise fbm in [0, 1] (mean 0.5), periodic
// over the unit cube: use rgb as a warp vector and a as a density, or sample it twice at
// different scales for more octaves.

import { volumeTexture, type GL, type Texture } from '../gl/gl';
import { rng } from '../core/math';

export interface NoiseVolumeOptions {
  /** Voxels per side (default 64). */
  size?: number;
  seed?: number;
  /** Lattice cells per side for each octave, coarse to fine; each must divide `size`. */
  lattices?: number[];
  /** Contrast stretch about 0.5 (fbm of value noise crowds the middle; default 1.7). */
  contrast?: number;
}

export function noiseVolume(gl: GL, o: NoiseVolumeOptions = {}): Texture {
  const N = o.size ?? 64;
  const lattices = o.lattices ?? [4, 8, 16, 32];
  const contrast = o.contrast ?? 1.7;
  const r = rng(o.seed ?? 1);
  const data = new Uint8Array(N * N * N * 4);
  const acc = new Float32Array(N * N * N * 4);
  let amp = 0.5, total = 0;
  for (const L of lattices) {
    const lat = new Float32Array(L * L * L * 4);
    for (let i = 0; i < lat.length; i++) lat[i] = r.next();
    // Per-axis lattice indices and smooth weights, the same for x, y and z.
    const i0 = new Int32Array(N), i1 = new Int32Array(N), w = new Float32Array(N);
    for (let x = 0; x < N; x++) {
      const u = ((x + 0.5) / N) * L;
      const f = u - Math.floor(u);
      i0[x] = Math.floor(u) % L;
      i1[x] = (i0[x] + 1) % L;
      w[x] = f * f * f * (f * (f * 6 - 15) + 10);
    }
    for (let z = 0; z < N; z++)
      for (let y = 0; y < N; y++) {
        const a00 = (i0[y] + L * i0[z]) * L, a10 = (i1[y] + L * i0[z]) * L, a01 = (i0[y] + L * i1[z]) * L, a11 = (i1[y] + L * i1[z]) * L;
        const wy = w[y], wz = w[z];
        for (let x = 0; x < N; x++) {
          const x0 = i0[x], x1 = i1[x], wx = w[x];
          const o4 = (x + N * (y + N * z)) * 4;
          for (let c = 0; c < 4; c++) {
            const v00 = lat[(a00 + x0) * 4 + c] * (1 - wx) + lat[(a00 + x1) * 4 + c] * wx;
            const v10 = lat[(a10 + x0) * 4 + c] * (1 - wx) + lat[(a10 + x1) * 4 + c] * wx;
            const v01 = lat[(a01 + x0) * 4 + c] * (1 - wx) + lat[(a01 + x1) * 4 + c] * wx;
            const v11 = lat[(a11 + x0) * 4 + c] * (1 - wx) + lat[(a11 + x1) * 4 + c] * wx;
            acc[o4 + c] += amp * ((v00 * (1 - wy) + v10 * wy) * (1 - wz) + (v01 * (1 - wy) + v11 * wy) * wz);
          }
        }
      }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < acc.length; i++) {
    const v = (acc[i] / total - 0.5) * contrast + 0.5;
    data[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return volumeTexture(gl, [N, N, N], data, { format: 'rgba8', wrap: 'repeat', filter: 'linear' });
}
