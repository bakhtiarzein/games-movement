import type { Quat, Vec3 } from '../types';

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Quaternion terpendek yang memutar sumbu +Y ke vektor satuan `to`. */
export function quatFromYTo(to: Vec3): Quat {
  // dari (0,1,0) ke to: sumbu = (0,1,0) x to = (to.z, 0, -to.x); cos = to.y
  const w = 1 + to.y;
  if (w < 1e-6) return [1, 0, 0, 0]; // berlawanan arah: putar 180° terhadap X
  const q: Quat = [to.z, 0, -to.x, w];
  const m = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / m, q[1] / m, q[2] / m, q[3] / m];
}
