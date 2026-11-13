import type { ColorProfile } from './types';

/**
 * Warna penanda dipakai bersama semua game. Saat game dilayani dari satu origin (halaman depan),
 * pemain cukup mengkalibrasi warna sekali (mis. di Lab) dan semua game ikut memakainya.
 * Panjang tongkat/kedalaman tetap per game karena bergantung cara memegang tongkat.
 */
export const SHARED_COLORS_KEY = 'games-shared-colors';

export interface SharedColors { version: 1; tip: ColorProfile; handle: ColorProfile; hueTolerance: number }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isProfile = (p: unknown): p is ColorProfile => {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return isNum(o.h) && isNum(o.sMin) && isNum(o.vMin);
};

/** Validasi ketat: data rusak atau berformat lain diabaikan (kembali ke pengaturan bawaan game). */
export function parseSharedColors(raw: string | null | undefined): SharedColors | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (j && j.version === 1 && isProfile(j.tip) && isProfile(j.handle) && isNum(j.hueTolerance) && j.hueTolerance >= 5 && j.hueTolerance <= 90) {
      const { tip, handle } = j as unknown as { tip: ColorProfile; handle: ColorProfile };
      return {
        version: 1,
        tip: { h: tip.h, sMin: tip.sMin, vMin: tip.vMin },
        handle: { h: handle.h, sMin: handle.sMin, vMin: handle.vMin },
        hueTolerance: j.hueTolerance,
      };
    }
  } catch { /* JSON rusak */ }
  return null;
}

function store(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } // diblokir di mode privat tertentu
}

export function loadSharedColors(): SharedColors | null {
  try { return parseSharedColors(store()?.getItem(SHARED_COLORS_KEY)); } catch { return null; }
}

export function saveSharedColors(c: SharedColors): void {
  try { store()?.setItem(SHARED_COLORS_KEY, JSON.stringify(c)); } catch { /* penyimpanan penuh/diblokir: abaikan */ }
}
