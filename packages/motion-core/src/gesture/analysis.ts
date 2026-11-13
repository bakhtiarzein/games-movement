import type { SwingTrace, TraceSample } from '../types';

export interface SwingMetrics {
  valid: boolean;
  /** kecepatan ujung pada titik kena (L/s) */
  peakSpeed: number;
  /** kecepatan tertinggi di seluruh jejak (bisa berasal dari backswing) */
  globalPeak: number;
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
const lerpAngle = (a: number, b: number, t: number) => a + wrap180(b - a) * t;

/**
 * Titik kena = puncak tertinggi pada "gelombang" kecepatan TERAKHIR. Gelombang dipisahkan lembah dalam
 * (kecepatan jatuh < 50%, mis. berbalik di puncak backswing); tonjolan kecil di follow-through
 * (akibat penyampelan 30 fps) tetap satu gelombang dengan puncaknya. Downswing selalu setelah backswing,
 * jadi ayunan yang melambat ke arah bola (kesalahan umum pemula) tidak salah dibaca dari backswing.
 */
function pickImpact(s: TraceSample[], globalIndex: number): number {
  const n = s.length, floor = s[globalIndex].speed * 0.6;
  const cands: number[] = [];
  for (let i = 1; i < n - 1; i++) if (s[i].speed >= floor && s[i].speed >= s[i - 1].speed && s[i].speed >= s[i + 1].speed) cands.push(i);
  if (!cands.length) return globalIndex;
  let best = cands[0];
  for (let k = 1; k < cands.length; k++) {
    const a = cands[k - 1], b = cands[k];
    let valley = Infinity;
    for (let j = a; j <= b; j++) valley = Math.min(valley, s[j].speed);
    if (valley <= 0.5 * Math.min(s[a].speed, s[b].speed)) best = b;          // gelombang baru
    else if (s[b].speed > s[best].speed) best = b;                           // gelombang yang sama: ambil puncaknya
  }
  return best;
}

/** Analisis jejak ayunan penuh menjadi metrik yang berguna untuk golf dan olahraga ayun lain. */
export function analyzeSwing(trace: SwingTrace): SwingMetrics {
  const s = trace.samples, n = s.length;
  let peakIndex = 0;
  for (let i = 1; i < n; i++) if (s[i].speed > s[peakIndex].speed) peakIndex = i;
  peakIndex = pickImpact(s, peakIndex);
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
  // Sudut tongkat saat kena dibaca di titik terendah busur dengan interpolasi sub-sampel (parabola pada y ujung).
  // Pada 30 fps dan ayunan cepat tongkat berputar ~28° antar frame, jadi sampel kecepatan puncak bisa meleset
  // hingga setengah frame (~±15°) — tanpa ini "kemiringan" hanya derau penyampelan.
  let leanAngle = pk.angleDeg;
  if (lowestIndex > 0 && lowestIndex < n - 1 && Math.abs(s[lowestIndex].t - pk.t) <= 150) {
    const y0 = s[lowestIndex - 1].tip.y, y1 = s[lowestIndex].tip.y, y2 = s[lowestIndex + 1].tip.y;
    const den = y0 - 2 * y1 + y2;
    const d = clamp(den !== 0 ? (0.5 * (y0 - y2)) / den : 0, -1, 1);
    const j = d >= 0 ? lowestIndex + 1 : lowestIndex - 1;
    leanAngle = lerpAngle(s[lowestIndex].angleDeg, s[j].angleDeg, Math.abs(d));
  }
  const leanDeg = wrap180(leanAngle + 90);
  // kecepatan dari selisih posisi di sekitar titik kena (kecepatan tersaring tertinggal satu frame)
  const a = s[Math.max(0, peakIndex - 1)], b = s[Math.min(n - 1, peakIndex + 1)];
  const dtp = Math.max(1, b.t - a.t);
  const vx = (b.tip.x - a.tip.x) / dtp, vy = (b.tip.y - a.tip.y) / dtp;
  const pathAngleDeg = (Math.atan2(-vy, Math.abs(vx)) * 180) / Math.PI;
  const direction: 1 | -1 = vx >= 0 ? 1 : -1;
  const bottomMs = Math.abs(s[peakIndex].t - s[lowestIndex].t);

  // skor: tempo ideal 3:1 (toleransi hingga 3x ke atas/bawah), bidang ayun, titik kena di dasar busur
  const tempoScore = tempo > 0 ? 1 - clamp(Math.abs(Math.log(tempo / 3)) / Math.log(3), 0, 1) : 0.4;
  // 10° pertama dimaafkan: blur gerak membuat panjang tampak sedikit menyusut walau ayunan sebidang
  const planeScore = 1 - clamp((planeDeviationDeg - 10) / 30, 0, 1);
  const bottomScore = 1 - clamp(bottomMs / 220, 0, 1);
  const quality = clamp(0.35 * tempoScore + 0.3 * planeScore + 0.35 * bottomScore, 0, 1);

  return {
    valid: n >= 5 && trace.peakSpeed > 0, peakSpeed: s[peakIndex].speed, globalPeak: trace.peakSpeed, peakIndex, topIndex, lowestIndex,
    backswingMs, downswingMs, tempo, planeDeviationDeg, leanDeg, pathAngleDeg, direction, bottomMs, quality,
  };
}
