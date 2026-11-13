/**
 * Fisika bola tenis (murni, tanpa Three.js agar bisa diuji). Satuan meter; net di z = 0,
 * pemain di sisi z > 0, lawan di sisi z < 0. Sumbu y ke atas.
 */
export const G = 9.8;
export const COURT = { halfW: 4.1, halfL: 10.5, netH: 0.95 } as const;
export const BALL_R = 0.2;
export const RESTITUTION = 0.72;
export const FRICTION = 0.9;
/** bidang tempat pemain memukul dan tempat lawan memukul */
export const Z_HIT = 7.5;
export const Z_OPP = -9.0;

export interface Ball { x: number; y: number; z: number; vx: number; vy: number; vz: number }
export type BallEvent =
  | { type: 'bounce'; x: number; z: number; count: number }
  | { type: 'net' };

export const cloneBall = (b: Ball): Ball => ({ ...b });

/** maju satu langkah kecil (dt <= 1/120). Mengembalikan peristiwa yang terjadi. */
export function stepBall(b: Ball, dt: number, bounceCount = { player: 0, opp: 0 }): BallEvent[] {
  const ev: BallEvent[] = [];
  const pz = b.z;
  b.vy -= G * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  // menyentuh net
  if ((pz > 0 && b.z <= 0) || (pz < 0 && b.z >= 0)) {
    if (b.y < COURT.netH + BALL_R * 0.5) {
      const f = Math.abs(pz) / (Math.abs(pz) + Math.abs(b.z) || 1);
      b.z = 0; b.x -= b.vx * dt * (1 - f); ev.push({ type: 'net' });
      return ev;
    }
  }
  if (b.y <= BALL_R && b.vy < 0) {
    b.y = BALL_R; b.vy = -b.vy * RESTITUTION; b.vx *= FRICTION; b.vz *= FRICTION;
    const side = b.z >= 0 ? 'player' : 'opp';
    bounceCount[side]++;
    ev.push({ type: 'bounce', x: b.x, z: b.z, count: bounceCount[side] });
  }
  return ev;
}

/** Kecepatan awal agar bola dari `from` mendarat (pantulan pertama) di (tx, tz) setelah T detik. */
export function solveLaunch(from: { x: number; y: number; z: number }, tx: number, tz: number, T: number) {
  return {
    vx: (tx - from.x) / T,
    vz: (tz - from.z) / T,
    vy: (BALL_R - from.y + 0.5 * G * T * T) / T,
  };
}

/** Tinggi bola saat melewati net (z = 0) untuk lintasan tanpa pantulan; NaN bila tidak melewati net. */
export function heightAtNet(from: { x: number; y: number; z: number }, v: { vy: number; vz: number }): number {
  if (v.vz === 0) return NaN;
  const t = -from.z / v.vz;
  if (t <= 0) return NaN;
  return from.y + v.vy * t - 0.5 * G * t * t;
}

export interface ShotPlan { vx: number; vy: number; vz: number; T: number; netClear: number }

/** Rencanakan pukulan: menambah waktu terbang (lengkung lebih tinggi) sampai melewati net dengan aman. */
export function planShot(from: { x: number; y: number; z: number }, tx: number, tz: number, T0: number, margin = 0.25, Tmax = 3): ShotPlan | null {
  for (let T = T0; T <= Tmax; T += 0.06) {
    const v = solveLaunch(from, tx, tz, T);
    const h = heightAtNet(from, v);
    if (Number.isNaN(h) || h >= COURT.netH + BALL_R + margin) return { ...v, T, netClear: h };
  }
  return null;
}

/** Simulasikan bola ke depan sampai melewati bidang z = zPlane searah geraknya. */
export function predictAtPlane(ball: Ball, zPlane: number, maxT = 5): { t: number; x: number; y: number; bounces: number; vy: number } | null {
  const b = cloneBall(ball), cnt = { player: 0, opp: 0 };
  const dir = Math.sign(b.vz) || 1;
  let t = 0, bounces = 0;
  const dt = 1 / 240;
  while (t < maxT) {
    const before = b.z;
    const ev = stepBall(b, dt, cnt);
    t += dt;
    for (const e of ev) { if (e.type === 'net') return null; if (e.type === 'bounce') bounces++; }
    if ((before - zPlane) * dir < 0 && (b.z - zPlane) * dir >= 0) return { t, x: b.x, y: b.y, bounces, vy: b.vy };
    if (b.y < 0 || Math.abs(b.x) > 40 || Math.abs(b.z) > 60) return null;
  }
  return null;
}

/** Apakah titik pendaratan berada di dalam lapangan sisi `side`? (toleransi radius bola) */
export function inCourt(x: number, z: number, side: 'player' | 'opp'): boolean {
  const okZ = side === 'player' ? z >= 0 && z <= COURT.halfL : z <= 0 && z >= -COURT.halfL;
  return okZ && Math.abs(x) <= COURT.halfW + BALL_R * 0.5;
}
