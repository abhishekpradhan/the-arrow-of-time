import { m4, v3, type Mat4, type Vec3, DEG } from './math';

export interface CameraOptions {
  pos?: Vec3;
  target?: Vec3;
  up?: Vec3;
  fov?: number; // vertical field of view, degrees
  near?: number;
  far?: number;
  aspect?: number;
  roll?: number; // radians
}

/**
 * A look-at perspective camera shared by rasterised geometry (sprites, meshes)
 * and ray-marched shaders (via `uniforms()` + <camera> GLSL chunk), so both
 * line up exactly in the same shot.
 */
export class Camera {
  pos: Vec3 = [0, 0, 5];
  target: Vec3 = [0, 0, 0];
  up: Vec3 = [0, 1, 0];
  fov = 45;
  near = 0.01;
  far = 1e5;
  aspect = 16 / 9;
  roll = 0;

  constructor(o: CameraOptions = {}) {
    Object.assign(this, o);
  }

  set(o: CameraOptions) {
    Object.assign(this, o);
    return this;
  }

  basis() {
    const fwd = v3.norm(v3.sub(this.target, this.pos));
    let right = v3.cross(fwd, this.up);
    if (v3.len(right) < 1e-6) right = v3.cross(fwd, [0, 0, 1]);
    right = v3.norm(right);
    let up = v3.cross(right, fwd);
    if (this.roll) {
      const c = Math.cos(this.roll), s = Math.sin(this.roll);
      const r2 = v3.add(v3.scale(right, c), v3.scale(up, s));
      const u2 = v3.add(v3.scale(up, c), v3.scale(right, -s));
      right = r2;
      up = u2;
    }
    return { fwd, right, up };
  }

  view(): Mat4 {
    const { up } = this.basis();
    return m4.lookAt(this.pos, this.target, up);
  }

  proj(): Mat4 {
    return m4.perspective(this.fov * DEG, this.aspect, this.near, this.far);
  }

  viewProj(): Mat4 {
    return m4.mul(this.proj(), this.view());
  }

  /** Uniforms understood by the <camera> GLSL chunk and the sprite/mesh shaders. */
  uniforms() {
    const { fwd, right, up } = this.basis();
    const view = m4.lookAt(this.pos, this.target, up);
    const proj = this.proj();
    return {
      uCamPos: this.pos,
      uCamFwd: fwd,
      uCamRight: right,
      uCamUp: up,
      uTanHalfFov: Math.tan((this.fov * DEG) / 2),
      uView: view,
      uProj: proj,
      uViewProj: m4.mul(proj, view),
      uNear: this.near,
      uFar: this.far,
    };
  }

  /** Project a world point to picture coordinates (x,y in [0,1], y up) and view depth. */
  project(p: Vec3): { x: number; y: number; depth: number; visible: boolean } {
    const vp = this.viewProj();
    const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
    const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
    const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
    return { x: (x / w) * 0.5 + 0.5, y: (y / w) * 0.5 + 0.5, depth: w, visible: w > 0 };
  }
}

/** Orbit helper: position on a sphere around `target`. az/el in degrees. */
export function orbit(target: Vec3, dist: number, azDeg: number, elDeg: number): Vec3 {
  const d = v3.fromAngles(azDeg * DEG, elDeg * DEG);
  return v3.add(target, v3.scale(d, dist));
}
