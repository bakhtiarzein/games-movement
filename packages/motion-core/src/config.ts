import type { ColorProfile } from './types';

export interface EngineConfig {
  tracker: {
    tip: ColorProfile;
    handle: ColorProfile;
    /** toleransi hue (derajat) */
    hueTolerance: number;
    /** area minimum blob (piksel pada resolusi proses) */
    minArea: number;
  };
  pose: {
    /** panjang tongkat sebenarnya (m), dipakai untuk m/s dan posisi ujung di dunia. */
    stickLengthM: number;
    /** lebar medan pandang kamera setinggi tangan (m) -> skala x/y dunia. */
    worldWidthM: number;
    /** meter dunia per e-fold perubahan ketebalan gagang (kedalaman). */
    depthGainM: number;
    /** jeda tanpa ujung sebelum pelacakan dianggap hilang (ms) */
    lostTimeoutMs: number;
    /** peluruhan panjang acuan per detik (relatif) */
    refLengthDecay: number;
  };
  gesture: {
    /** ambang mulai ayunan (L/s) */
    startThreshold: number;
    /** ayunan berakhir saat kecepatan < startThreshold * endRatio */
    endRatio: number;
    /** ambang tusuk ke kamera: laju ln(ketebalan)/s */
    thrustThreshold: number;
    /** lintasan minimum (kali panjang tongkat) agar dihitung ayunan */
    minPathLengths: number;
    cooldownMs: number;
    thrustCooldownMs: number;
    /** kecepatan puncak (L/s) yang dipetakan ke power = 1 */
    fullPowerSpeed: number;
  };
}

export const defaultConfig = (): EngineConfig => ({
  tracker: {
    tip: { h: 140, sMin: 0.35, vMin: 0.3 },
    handle: { h: 225, sMin: 0.4, vMin: 0.2 },
    hueTolerance: 28,
    minArea: 14,
  },
  pose: { stickLengthM: 0.6, worldWidthM: 1.6, depthGainM: 1.0, lostTimeoutMs: 180, refLengthDecay: 0.02 },
  gesture: {
    startThreshold: 3.5,
    endRatio: 0.4,
    thrustThreshold: 1.4,
    minPathLengths: 0.8,
    cooldownMs: 220,
    thrustCooldownMs: 400,
    fullPowerSpeed: 12,
  },
});

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function mergeConfig<T extends object>(base: T, patch?: DeepPartial<T>): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  if (!patch) return out;
  for (const k of Object.keys(patch) as (keyof T)[]) {
    const v: any = (patch as any)[k];
    if (v === undefined) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? mergeConfig((base as any)[k] ?? {}, v) : v;
  }
  return out;
}
