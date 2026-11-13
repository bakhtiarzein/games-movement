import type { Vec3 } from '@games/motion-core';

/** Helper tumbukan/penilaian yang netral terhadap game (tidak bergantung Three.js). */

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
export const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return mul(a, 1 / l); };
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

export interface Segment { a: Vec3; b: Vec3 }

/** jarak titik ke ruas dan titik terdekat pada ruas. */
export function closestOnSegment(s: Segment, p: Vec3): { point: Vec3; dist: number; u: number } {
  const ab = sub(s.b, s.a), l2 = dot(ab, ab);
  const u = l2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, s.a), ab) / l2)) : 0;
  const point = add(s.a, mul(ab, u));
  return { point, dist: len(sub(p, point)), u };
}

export interface SweepHit {
  /** 0..1 di dalam interval frame (kapan pertama kali kena). */
  t: number;
  /** titik terdekat pada bilah saat kena. */
  point: Vec3;
  /** kecepatan ujung (m per interval frame) saat kena, untuk arah pecahan. */
  tipDelta: Vec3;
}

/**
 * Sapuan bilah antara dua frame terhadap bola. Pada 30 fps ujung bisa melompat belasan cm, jadi kita
 * interpolasi ruas bilah (bukan hanya cek frame sekarang) agar tidak "menembus" target.
 */
export function bladeSweepVsSphere(prev: Segment, cur: Segment, center: Vec3, radius: number, maxStepM = 0.04): SweepHit | null {
  const move = Math.max(len(sub(cur.b, prev.b)), len(sub(cur.a, prev.a)));
  const steps = Math.min(64, Math.max(1, Math.ceil(move / maxStepM)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const seg: Segment = { a: lerp3(prev.a, cur.a, t), b: lerp3(prev.b, cur.b, t) };
    const c = closestOnSegment(seg, center);
    if (c.dist <= radius) return { t, point: c.point, tipDelta: sub(cur.b, prev.b) };
  }
  return null;
}

/** Normal bidang potong dari arah bilah dan arah ayunan (untuk membelah objek). */
export function cutPlaneNormal(bladeDir: Vec3, swingDir: Vec3): Vec3 {
  const n = cross(bladeDir, swingDir);
  return len(n) < 1e-5 ? { x: 0, y: 0, z: 1 } : norm(n);
}

/** Skor: kekuatan ayunan 0..1 + kombo. */
export function scoreHit(power: number, combo: number) {
  return Math.round((10 + 20 * power) * (1 + Math.min(combo, 20) * 0.1));
}
