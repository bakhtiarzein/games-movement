import type { SwingTrace } from '../types';

export interface SwingMetrics {
  valid: boolean;
  peakSpeed: number;
  peakIndex: number;
  /** indeks titik balik backswing (kecepatan terendah sebelum puncak). */
  topIndex: number;
  /** indeks titik terendah ujung di layar (y gambar terbesar). */
  lowestIndex: number;
  backswingMs: number;
  downswingMs: number;
  /** backswing / downswing; ideal sekitar 3. */
  tempo: number;
  /** rata-rata kemiringan tongkat keluar dari bidang gambar selama downswing (derajat). */
  planeDeviationDeg: number;
  /** kemiringan tongkat saat kena terhadap vertikal-ke-bawah; positif = ujung ke kanan layar (derajat). */
  leanDeg: number;
  /** sudut lintasan ujung saat kena; positif = naik (derajat). */
  pathAngleDeg: number;
  /** +1 bila ujung bergerak ke kanan layar saat kena, -1 ke kiri. */
  direction: 1 | -1;
  /** selisih waktu antara kecepatan puncak dan titik terendah (ms). */
  bottomMs: number;
  /** 0..1 gabungan tempo, bidang ayun, dan kebersihan titik kena. */
  quality: number;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/** Analisis jejak ayunan penuh menjadi metrik yang berguna untuk golf dan olahraga ayun lain. */
export function analyzeSwing(trace: SwingTrace): SwingMetrics {
  const s = trace.samples, n = s.length;
  let peakIndex = 0;
  for (let i = 1; i < n; i++) if (s[i].speed > s[peakIndex].speed) peakIndex = i;
  // awal gerakan sebenarnya: sampel pertama yang sudah bergerak (abaikan diam sebelum backswing)
  let startIndex = 0;
  while (startIndex < peakIndex && s[startIndex].speed < 0.5) startIndex++;

  // titik balik backswing: kecepatan terendah di antara awal dan puncak
  let topIndex = startIndex, minSp = Infinity;
  for (let i = Math.min(startIndex + 2, peakIndex); i < peakIndex; i++) if (s[i].speed < minSp) { minSp = s[i].speed; topIndex = i; }
  if (peakIndex - startIndex <= 2) topIndex = startIndex;

  // titik terendah ujung hanya dicari pada fase downswing (posisi awal menggantung juga rendah)
  let lowestIndex = topIndex;
  for (let i = topIndex; i < n; i++) if (s[i].tip.y > s[lowestIndex].tip.y) lowestIndex = i;

  const backswingMs = s[topIndex].t - s[startIndex].t;
  const downswingMs = Math.max(1, s[peakIndex].t - s[topIndex].t);
  const tempo = backswingMs > 0 ? backswingMs / downswingMs : 0;

  let pd = 0, pc = 0;
  for (let i = topIndex; i <= peakIndex; i++) { pd += s[i].pitchDeg; pc++; }
  const planeDeviationDeg = pc ? pd / pc : 0;

  const pk = s[peakIndex];
  const leanDeg = wrap180(pk.angleDeg + 90);
  // kecepatan dari selisih posisi di sekitar titik kena (kecepatan tersaring tertinggal satu frame)
  const a = s[Math.max(0, peakIndex - 1)], b = s[Math.min(n - 1, peakIndex + 1)];
  const dtp = Math.max(1, b.t - a.t);
  const vx = (b.tip.x - a.tip.x) / dtp, vy = (b.tip.y - a.tip.y) / dtp;
  const pathAngleDeg = (Math.atan2(-vy, Math.abs(vx)) * 180) / Math.PI;
  const direction: 1 | -1 = vx >= 0 ? 1 : -1;
  const bottomMs = Math.abs(s[peakIndex].t - s[lowestIndex].t);

  // skor: tempo ideal 3:1 (toleransi hingga 3x ke atas/bawah), bidang ayun, titik kena di dasar busur
  const tempoScore = tempo > 0 ? 1 - clamp(Math.abs(Math.log(tempo / 3)) / Math.log(3), 0, 1) : 0.4;
  const planeScore = 1 - clamp(planeDeviationDeg / 35, 0, 1);
  const bottomScore = 1 - clamp(bottomMs / 220, 0, 1);
  const quality = clamp(0.35 * tempoScore + 0.3 * planeScore + 0.35 * bottomScore, 0, 1);

  return {
    valid: n >= 5 && trace.peakSpeed > 0, peakSpeed: trace.peakSpeed, peakIndex, topIndex, lowestIndex,
    backswingMs, downswingMs, tempo, planeDeviationDeg, leanDeg, pathAngleDeg, direction, bottomMs, quality,
  };
}
