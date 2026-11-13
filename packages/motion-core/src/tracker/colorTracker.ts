import type { Blob2D, ColorProfile, FrameData, Observation } from '../types';
import type { EngineConfig } from '../config';

/**
 * Tracker dua-penanda berbasis warna (HSV). Murni CPU, tanpa DOM, sehingga bisa dijalankan di
 * Web Worker atau Node (tes). Mengganti tracker lain cukup menghasilkan `Observation` yang sama.
 */
export class ColorTracker {
  private w = 0;
  private h = 0;
  private n = 0;
  maskTip = new Uint8Array(0);
  maskHandle = new Uint8Array(0);
  private dilTip = new Uint8Array(0);
  private dilHandle = new Uint8Array(0);
  private tmp = new Uint8Array(0);
  private vis = new Uint8Array(0);
  private stack = new Int32Array(0);

  constructor(private cfg: EngineConfig['tracker']) {}

  setConfig(cfg: EngineConfig['tracker']) { this.cfg = cfg; }
  get size() { return { width: this.w, height: this.h }; }

  private alloc(w: number, h: number) {
    this.w = w; this.h = h; this.n = w * h;
    this.maskTip = new Uint8Array(this.n); this.maskHandle = new Uint8Array(this.n);
    this.dilTip = new Uint8Array(this.n); this.dilHandle = new Uint8Array(this.n);
    this.tmp = new Uint8Array(this.n); this.vis = new Uint8Array(this.n);
    this.stack = new Int32Array(this.n);
  }

  process(frame: FrameData): Observation {
    if (frame.width !== this.w || frame.height !== this.h) this.alloc(frame.width, frame.height);
    this.buildMasks(frame.data);
    this.dilate(this.maskTip, this.dilTip);
    this.dilate(this.maskHandle, this.dilHandle);
    return {
      t: frame.t,
      aspect: this.h / this.w,
      tip: this.largestBlob(this.maskTip, this.dilTip),
      handle: this.largestBlob(this.maskHandle, this.dilHandle),
    };
  }

  /** Rata-rata warna 5x5 di sekitar (nx, ny) (0..1 pada lebar/tinggi frame) -> profil warna. */
  static sampleProfile(frame: FrameData, nx: number, ny: number): ColorProfile | null {
    const x = Math.round(nx * (frame.width - 1)), y = Math.round(ny * (frame.height - 1));
    let R = 0, G = 0, B = 0, c = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= frame.width || yy >= frame.height) continue;
      const p = (yy * frame.width + xx) * 4;
      R += frame.data[p]; G += frame.data[p + 1]; B += frame.data[p + 2]; c++;
    }
    if (!c) return null;
    R /= c; G /= c; B /= c;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B), df = mx - mn;
    if (!df) return null;
    let h: number;
    if (mx === R) h = ((G - B) / df + 6) % 6; else if (mx === G) h = (B - R) / df + 2; else h = (R - G) / df + 4;
    h *= 60;
    const s = df / mx, v = mx / 255;
    return { h: Math.round(h), sMin: Math.max(0.2, +(s * 0.55).toFixed(2)), vMin: Math.max(0.15, +(v * 0.45).toFixed(2)) };
  }

  private buildMasks(d: Uint8ClampedArray) {
    const T = this.cfg.tip, H = this.cfg.handle, tol = this.cfg.hueTolerance;
    const { maskTip, maskHandle } = this;
    for (let i = 0, p = 0; i < this.n; i++, p += 4) {
      const r = d[p], g = d[p + 1], b = d[p + 2];
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const df = mx - mn;
      maskTip[i] = 0; maskHandle[i] = 0;
      if (!df || mx < 40) continue;
      const s = df / mx, v = mx / 255;
      let h: number;
      if (mx === r) h = ((g - b) / df + 6) % 6; else if (mx === g) h = (b - r) / df + 2; else h = (r - g) / df + 4;
      h *= 60;
      if (s >= T.sMin && v >= T.vMin) { let dh = Math.abs(h - T.h); if (dh > 180) dh = 360 - dh; if (dh <= tol) maskTip[i] = 1; }
      if (s >= H.sMin && v >= H.vMin) { let dh = Math.abs(h - H.h); if (dh > 180) dh = 360 - dh; if (dh <= tol) maskHandle[i] = 1; }
    }
  }

  /** dilasi 3x3 (terpisah) agar gumpalan yang terpecah tersambung. */
  private dilate(src: Uint8Array, dst: Uint8Array) {
    const { w, h, tmp } = this;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      tmp[i] = src[i] | (x > 0 ? src[i - 1] : 0) | (x < w - 1 ? src[i + 1] : 0);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      dst[i] = tmp[i] | (y > 0 ? tmp[i - w] : 0) | (y < h - 1 ? tmp[i + w] : 0);
    }
  }

  private largestBlob(m: Uint8Array, dil: Uint8Array): Blob2D | null {
    const { w, h, n, vis, stack } = this;
    vis.fill(0);
    let best: Blob2D | null = null;
    for (let i = 0; i < n; i++) {
      if (!dil[i] || vis[i]) continue;
      let sp = 0, area = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      stack[sp++] = i; vis[i] = 1;
      while (sp) {
        const k = stack[--sp], x = k % w, y = (k / w) | 0;
        if (m[k]) { area++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
        if (x > 0 && dil[k - 1] && !vis[k - 1]) { vis[k - 1] = 1; stack[sp++] = k - 1; }
        if (x < w - 1 && dil[k + 1] && !vis[k + 1]) { vis[k + 1] = 1; stack[sp++] = k + 1; }
        if (y > 0 && dil[k - w] && !vis[k - w]) { vis[k - w] = 1; stack[sp++] = k - w; }
        if (y < h - 1 && dil[k + w] && !vis[k + w]) { vis[k + w] = 1; stack[sp++] = k + w; }
      }
      if (area >= this.cfg.minArea && (!best || area > best.area)) {
        const mx = sx / area, my = sy / area;
        const cxx = sxx / area - mx * mx + 1 / 12, cyy = syy / area - my * my + 1 / 12, cxy = sxy / area - mx * my;
        const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
        best = {
          area,
          x: (mx + 0.5) / w,
          y: (my + 0.5) / w, // satuan lebar gambar (isotropik)
          minor: (Math.sqrt(Math.max(0.05, tr / 2 - disc)) * 2) / w,
          major: (Math.sqrt(tr / 2 + disc) * 2) / w,
        };
      }
    }
    return best;
  }
}
