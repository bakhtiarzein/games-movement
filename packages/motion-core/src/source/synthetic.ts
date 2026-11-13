import type { Blob2D, Observation } from '../types';

/**
 * Pembangkit observasi sintetis. Dipakai untuk: tes otomatis, mode demo dengan mouse, dan sumber
 * input pengganti saat tidak ada webcam. Jangkar = gagang; ujung = gagang + panjang * (cos, sin).
 */
export interface StickPose {
  /** posisi gagang, satuan lebar gambar */
  hx: number; hy: number;
  /** sudut tongkat di layar (derajat, y ke bawah) */
  angleDeg: number;
  /** skala jarak (1 = acuan; >1 mendekat) */
  k?: number;
  /** foreshortening 0..1 (1 = sejajar bidang gambar) */
  c?: number;
}

const BASE_LEN = 0.27;     // panjang pusat ujung-gagang (lebar gambar) pada k=1,c=1
const HANDLE_THICK = 0.034; // ketebalan gagang pada k=1 (lebar gambar)

export function syntheticObservation(t: number, p: StickPose, aspect = 0.75): Observation {
  const k = p.k ?? 1, c = p.c ?? 1;
  const a = (p.angleDeg * Math.PI) / 180;
  const L = BASE_LEN * k * c;
  const tipPos = { x: p.hx + Math.cos(a) * L, y: p.hy + Math.sin(a) * L };
  const tip: Blob2D = { x: tipPos.x, y: tipPos.y, area: 420 * k * k, minor: 0.05 * k, major: 0.05 * k };
  const handle: Blob2D = { x: p.hx, y: p.hy, area: 1400 * k * k * c, minor: HANDLE_THICK * k, major: HANDLE_THICK * k * 3 * c };
  return { t, aspect, tip, handle };
}

/** Interpolasi pose dengan easing; membangun deret observasi 30 fps. */
export function* poseTimeline(
  segments: { dur: number; to: StickPose; mode?: 'hold' | 'lin' | 'ease' | 'in' | 'out' }[],
  start: StickPose,
  opts: { fps?: number; t0?: number; aspect?: number } = {},
): Generator<Observation> {
  const fps = opts.fps ?? 30, aspect = opts.aspect ?? 0.75;
  let t = opts.t0 ?? 0;
  let cur = { k: 1, c: 1, ...start };
  const dt = 1000 / fps;
  for (const seg of segments) {
    const n = Math.max(1, Math.round((seg.dur * 1000) / dt));
    const to = { k: 1, c: 1, ...seg.to };
    for (let i = 1; i <= n; i++) {
      let f = i / n;
      if (seg.mode === 'ease') f = f * f * (3 - 2 * f);
      if (seg.mode === 'in') f = f * f;               // mempercepat
      if (seg.mode === 'out') f = 1 - (1 - f) * (1 - f); // memperlambat
      if (seg.mode === 'hold') f = 0;
      const lerp = (a: number, b: number) => a + (b - a) * f;
      yield syntheticObservation(t, {
        hx: lerp(cur.hx, to.hx), hy: lerp(cur.hy, to.hy), angleDeg: lerp(cur.angleDeg, to.angleDeg), k: lerp(cur.k, to.k), c: lerp(cur.c, to.c),
      }, aspect);
      t += dt;
    }
    if (seg.mode !== 'hold') cur = to;
  }
}
