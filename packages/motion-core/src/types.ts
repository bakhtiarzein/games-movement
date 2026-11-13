/**
 * Tipe bersama untuk motion-core.
 *
 * Konvensi koordinat:
 *  - Koordinat gambar: satuan = "lebar gambar" (x 0..1, y 0..aspect), y ke bawah, SUDAH dicerminkan
 *    (kanan layar = kanan pemain).
 *  - Koordinat dunia (game): x kanan, y atas, z ke arah pemain (maju = -z), satuan meter.
 *  - Kecepatan dinormalisasi dalam "L/s": panjang tongkat per detik, jadi tidak tergantung jarak kamera.
 */

export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }
export type Quat = [number, number, number, number]; // x, y, z, w

/** Frame kamera yang sudah diperkecil dan dicerminkan (RGBA). */
export interface FrameData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** stempel waktu capture, milidetik (monoton naik). */
  t: number;
}

/** Hasil segmentasi satu penanda warna. */
export interface Blob2D {
  x: number;
  y: number;
  area: number;
  /** ketebalan (sumbu minor, 2σ) dalam satuan lebar gambar; tidak terpengaruh foreshortening. */
  minor: number;
  major: number;
}

/** Keluaran Tracker; masukan PoseEstimator. Bisa direkam dan diputar ulang. */
export interface Observation {
  t: number;
  aspect: number;
  tip: Blob2D | null;
  handle: Blob2D | null;
}

export interface ColorProfile {
  /** hue pusat, derajat 0..360 */
  h: number;
  sMin: number;
  vMin: number;
}

export interface PoseSample {
  t: number;
  /** posisi ujung & gagang dalam koordinat gambar (tersaring). */
  tip: Vec2;
  handle: Vec2;
  /** jarak pusat ujung-gagang (satuan lebar gambar) dan panjang acuan. */
  length: number;
  refLength: number;
  /** kecepatan ujung: skalar dan vektor (L/s, y gambar ke bawah). */
  speed: number;
  velocity: Vec2;
  /** laju perubahan ln(ketebalan gagang) per detik; positif = mendekat ke kamera. */
  depthRate: number;
  /** kemiringan terhadap bidang gambar (0 = sejajar, 90 = menghadap kamera). */
  pitchDeg: number;
  /** sudut tongkat di layar, derajat, y-atas, 0 = kanan. */
  angleDeg: number;
  /** pose 3D dunia (2.5D: kedalaman diperkirakan). */
  world: WorldPose;
  /** true bila gagang sedang tidak terlihat dan nilainya diambil dari frame sebelumnya. */
  handleStale: boolean;
}

export interface WorldPose {
  /** posisi genggaman. */
  position: Vec3;
  /** vektor satuan dari gagang ke ujung. */
  direction: Vec3;
  /** quaternion yang memutar sumbu +Y model (bilah) ke `direction`. */
  quaternion: Quat;
  /** posisi ujung = position + direction * stickLengthM. */
  tip: Vec3;
}

export type Direction8 =
  | 'right' | 'down-right' | 'down' | 'down-left'
  | 'left' | 'up-left' | 'up' | 'up-right';

export type GestureKind = 'slice' | 'chop' | 'uppercut' | 'diagonal' | 'thrust';

export interface GestureEvent {
  type: 'gesture';
  kind: GestureKind;
  /** arah gerak ujung di layar dari sudut pandang pemain. */
  direction: Direction8;
  /** vektor satuan arah gerak (y-atas). Untuk thrust ke kamera: (0,0) dan depth=true. */
  dir: Vec2;
  angleDeg: number;
  /** kecepatan puncak (L/s), kecepatan perkiraan (m/s), dan kekuatan 0..1. */
  peak: number;
  speedMps: number;
  power: number;
  durationMs: number;
  /** D/P: 1 = lurus, kecil = melengkung. */
  straightness: number;
  arc: boolean;
  /** true bila gerakan terutama maju/mundur terhadap kamera. */
  depth: boolean;
  /** cuplikan lintasan ujung (koordinat gambar). */
  path: Vec2[];
  lostFrames: number;
  t0: number;
  t1: number;
}

/** satu cuplikan pose dalam jejak ayunan. y gambar ke bawah. */
export interface TraceSample {
  t: number;
  tip: Vec2;
  handle: Vec2;
  speed: number;
  velocity: Vec2;
  angleDeg: number;
  pitchDeg: number;
  length: number;
}

/** Rekaman satu gerakan utuh, dari mulai bergerak sampai diam lagi (termasuk ayunan balik/backswing). */
export interface SwingTrace {
  samples: TraceSample[];
  t0: number;
  t1: number;
  peakSpeed: number;
}

export interface EngineEvents {
  pose: PoseSample;
  trace: SwingTrace;
  gesture: GestureEvent;
  trackingChanged: { tracking: boolean; t: number };
}

export interface Recording {
  version: 1;
  observations: Observation[];
}
