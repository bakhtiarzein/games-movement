import { HOLES, type Hole } from './holes';

export const G = 9.81;
export type Surface = 'tee' | 'fairway' | 'rough' | 'green' | 'sand' | 'water' | 'tree';
export interface Pt { x: number; z: number }

export interface Club { name: string; max: number; loft: number; rollK: number }
/** loft = sudut luncur efektif (sudah memperhitungkan lift dari spin), bukan loft kepala stik */
export const DRIVER: Club = { name: 'Driver', max: 230, loft: 24, rollK: 1 };
export const IRON: Club = { name: 'Iron', max: 150, loft: 32, rollK: 0.7 };
export const WEDGE: Club = { name: 'Wedge', max: 85, loft: 50, rollK: 0.3 };
export const PUTTER: Club = { name: 'Putter', max: 0, loft: 0, rollK: 0 };
export const FULL_SWING_SPEED = 11; // L/s untuk "ayunan penuh"
export const CUP_R = 0.55;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z);

function distToPolyline(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const abx = b.x - a.x, abz = b.z - a.z, l2 = abx * abx + abz * abz;
    const u = l2 ? Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + abx * u), p.z - (a.z + abz * u)));
  }
  return best;
}

/** Jenis permukaan di titik (x, z). Prioritas: air > pohon > green > pasir > tee > fairway > rough. */
export function surfaceAt(h: Hole, p: Pt): Surface {
  for (const w of h.water) { const dx = (p.x - w.x) / w.rx, dz = (p.z - w.z) / w.rz; if (dx * dx + dz * dz <= 1) return 'water'; }
  for (const t of h.trees) if (dist(p, t) <= t.r) return 'tree';
  if (dist(p, h.green) <= h.green.r) return 'green';
  for (const b of h.bunkers) if (dist(p, b) <= b.r) return 'sand';
  if (Math.abs(p.x - h.tee.x) <= 4 && p.z <= h.tee.z + 4 && p.z >= h.tee.z - 4) return 'tee';
  if (distToPolyline(p, h.fairway.pts) <= h.fairway.width / 2) return 'fairway';
  return 'rough';
}

const DECEL: Record<Surface, number> = { tee: 2.2, fairway: 2.2, rough: 7, green: 1.6, sand: 30, water: 999, tree: 999 };
const CARRY_FACTOR: Record<Surface, number> = { tee: 1.02, fairway: 1, rough: 0.85, green: 1, sand: 0.6, water: 1, tree: 0.8 };

export function chooseClub(h: Hole, ball: Pt, lie: Surface): Club {
  if (lie === 'green') return PUTTER;
  if (lie === 'sand') return WEDGE;
  const d = dist(ball, h.pin);
  if (d <= h.green.r + 4 && lie !== 'rough') return WEDGE;
  if (d <= WEDGE.max * 0.98) return WEDGE;
  if (d <= IRON.max * 0.98) return IRON;
  return DRIVER;
}

/** sudut azimut (derajat; 0 = lurus ke -z, + = ke kanan) dari titik a ke b */
export const azimuthTo = (a: Pt, b: Pt) => (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI;
const dirVec = (azDeg: number): Pt => ({ x: Math.sin((azDeg * Math.PI) / 180), z: -Math.cos((azDeg * Math.PI) / 180) });

export interface ShotInput {
  club: Club;
  /** 0..1.3 (1 = ayunan penuh) */
  power: number;
  /** 0..1 dari analyzeSwing */
  quality: number;
  /** kemiringan tongkat saat kena (derajat, + = ujung ke kanan layar) */
  leanDeg: number;
  /** sudut lintasan saat kena (derajat, + = naik) */
  pathAngleDeg: number;
  aimDeg: number;
  lie: Surface;
  wind: number;
}

export interface ShotPlan {
  kind: 'full' | 'putt';
  start: Pt;
  /** waktu terbang (s), puncak (m), kemiringan peluncuran (derajat) */
  T: number; apex: number; launchDeg: number;
  carry: number; azimuthDeg: number; curve: number; drift: number;
  landing: Pt;
  /** titik-titik gulir setelah mendarat (dari landing sampai berhenti) */
  roll: Pt[];
  final: Pt;
  finalSurface: Surface;
  holed: boolean;
  /** air: bola kembali ke posisi awal + 1 stroke */
  penalty: boolean;
  /** ringkasan untuk HUD */
  distance: number;
}

const gauss = (rng: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * Math.cos(2 * Math.PI * rng());

/** Simulasi gulir di permukaan: kecepatan berkurang menurut jenis permukaan; berhenti di air/pohon/pasir; masuk cup bila pelan. */
export function simulateRoll(h: Hole, from: Pt, dir: Pt, v0: number, opts: { maxSteps?: number } = {}): { pts: Pt[]; final: Pt; surface: Surface; holed: boolean } {
  const pts: Pt[] = [{ ...from }];
  let p = { ...from }, v = v0, holed = false;
  const ds = 0.25;
  for (let i = 0; i < (opts.maxSteps ?? 4000) && v > 0.05; i++) {
    const nx = p.x + dir.x * ds, nz = p.z + dir.z * ds;
    const s = surfaceAt(h, { x: nx, z: nz });
    const a = DECEL[s];
    v = Math.sqrt(Math.max(0, v * v - 2 * a * ds));
    p = { x: nx, z: nz };
    if (i % 4 === 0) pts.push(p);
    if (s === 'water' || s === 'tree') { pts.push(p); return { pts, final: p, surface: s, holed: false }; }
    if (dist(p, h.pin) <= CUP_R && v < 3.0) { pts.push({ ...h.pin }); return { pts, final: { ...h.pin }, surface: 'green', holed: true }; }
  }
  pts.push(p);
  return { pts, final: p, surface: surfaceAt(h, p), holed };
}

/** Rencana pukulan penuh (driver/iron/wedge). */
export function planFullShot(h: Hole, ball: Pt, inp: ShotInput, rng: () => number = Math.random): ShotPlan {
  const c = inp.club;
  const power = Math.min(1.25, Math.max(0.08, inp.power));
  const over = Math.max(0, power - 1);
  const carry = c.max * power * CARRY_FACTOR[inp.lie];
  const launchDeg = Math.max(8, c.loft + Math.max(-6, Math.min(8, inp.pathAngleDeg)) * 0.5);
  const th = (launchDeg * Math.PI) / 180;
  const v = Math.sqrt((carry * G) / Math.sin(2 * th));
  const T = (2 * v * Math.sin(th)) / G;
  const apex = (v * Math.sin(th)) ** 2 / (2 * G);

  const sigma = (1 - inp.quality) * 5 + over * 8;
  const azimuthDeg = inp.aimDeg + gauss(rng) * sigma + inp.leanDeg * 0.12;
  const curve = inp.leanDeg * 0.015 * carry;
  const drift = inp.wind * T * 0.5;
  const F = dirVec(azimuthDeg), R = { x: F.z * -1, z: F.x };            // kanan = F diputar 90° searah jarum jam
  const lateral = curve + drift;
  const landing = { x: ball.x + F.x * carry + R.x * lateral, z: ball.z + F.z * carry + R.z * lateral };

  // arah singgung saat mendarat (turunan lintasan di s = 1)
  const tx = F.x * carry + R.x * 2 * lateral, tz = F.z * carry + R.z * 2 * lateral, tm = Math.hypot(tx, tz) || 1;
  const rollDir = { x: tx / tm, z: tz / tm };

  const landSurface = surfaceAt(h, landing);
  let roll: Pt[] = [landing], final = landing, finalSurface = landSurface, holed = false, penalty = false;
  if (landSurface === 'water') penalty = true;
  else if (landSurface !== 'tree' && landSurface !== 'sand') {
    const vr0 = 0.2 * (carry / T) * c.rollK;
    const r = simulateRoll(h, landing, rollDir, vr0);
    roll = r.pts; final = r.final; finalSurface = r.surface; holed = r.holed;
    if (finalSurface === 'water') penalty = true;
  }
  return {
    kind: 'full', start: { ...ball }, T, apex, launchDeg, carry, azimuthDeg, curve, drift, landing, roll, final, finalSurface, holed, penalty,
    distance: dist(ball, final),
  };
}

/** Rencana putt: kecepatan ayunan -> kecepatan gulir awal; arah ke lubang + galat kecil. */
export function planPutt(h: Hole, ball: Pt, peakSpeed: number, quality: number, leanDeg: number, aimDeg: number, rng: () => number = Math.random): ShotPlan {
  const v0 = Math.min(11, Math.max(0.4, peakSpeed * 1.7));
  const az = aimDeg + gauss(rng) * (1 - quality) * 2.2 + leanDeg * 0.05;
  const d = dirVec(az);
  const r = simulateRoll(h, ball, d, v0);
  const penalty = r.surface === 'water';
  return {
    kind: 'putt', start: { ...ball }, T: 0, apex: 0, launchDeg: 0, carry: 0, azimuthDeg: az, curve: 0, drift: 0,
    landing: { ...ball }, roll: r.pts, final: r.final, finalSurface: r.surface, holed: r.holed, penalty, distance: dist(ball, r.final),
  };
}

/** Posisi bola di udara pada waktu t (0..T): koordinat tanah + tinggi. */
export function flightPos(p: ShotPlan, t: number): { x: number; y: number; z: number } {
  const s = Math.min(1, Math.max(0, t / p.T));
  const F = dirVec(p.azimuthDeg), R = { x: -F.z, z: F.x };
  const lateral = p.curve + p.drift;
  const v = (p.apex * 2 * G) ** 0.5;      // v*sin(theta)
  return {
    x: p.start.x + F.x * p.carry * s + R.x * lateral * s * s,
    z: p.start.z + F.z * p.carry * s + R.z * lateral * s * s,
    y: v * t - 0.5 * G * t * t,
  };
}

export const holeAt = (i: number) => HOLES[i];
export const distTo = dist;
