import type { EngineConfig } from '../config';
import type { PoseSample, SwingTrace, TraceSample } from '../types';

const toSample = (p: PoseSample): TraceSample => ({
  t: p.t, tip: { ...p.tip }, handle: { ...p.handle }, speed: p.speed, velocity: { ...p.velocity },
  angleDeg: p.angleDeg, pitchDeg: p.pitchDeg, length: p.length,
});

/**
 * Merekam SATU gerakan utuh: pemain diam (siap) -> mulai bergerak (mis. backswing golf, lambat) ->
 * ... -> diam lagi. Berbeda dari SwingRecognizer yang hanya melihat fase cepat.
 */
export class TraceRecorder {
  private ring: TraceSample[] = [];
  private stillSince: number | null = null;
  private armed = false;
  private rec: TraceSample[] | null = null;
  private slowSince: number | null = null;

  constructor(private cfg: EngineConfig['trace']) {}
  setConfig(cfg: EngineConfig['trace']) { this.cfg = cfg; }
  reset() { this.ring.length = 0; this.stillSince = null; this.armed = false; this.rec = null; this.slowSince = null; }
  /** true saat pemain sudah diam cukup lama dan siap memulai ayunan. */
  get ready() { return this.armed && !this.rec; }
  get recording() { return !!this.rec; }

  push(p: PoseSample): SwingTrace | null {
    const c = this.cfg, s = toSample(p);
    this.ring.push(s); if (this.ring.length > 8) this.ring.shift();

    if (!this.rec) {
      if (p.speed < c.stillSpeed) {
        this.stillSince ??= p.t;
        if (p.t - this.stillSince >= c.stillMs) this.armed = true;
      } else {
        this.stillSince = null;
        if ((this.armed && p.speed > c.startSpeed) || p.speed > c.fastStart) {
          this.rec = this.ring.filter(r => p.t - r.t <= 150);
          this.slowSince = null; this.armed = false;
        }
      }
      return null;
    }

    this.rec.push(s);
    if (p.speed < c.endSpeed) this.slowSince ??= p.t; else this.slowSince = null;
    const done = (this.slowSince !== null && p.t - this.slowSince >= c.endMs) || p.t - this.rec[0].t > c.maxMs;
    if (!done) return null;
    const samples = this.rec; this.rec = null; this.slowSince = null; this.stillSince = null;
    const peak = Math.max(...samples.map(x => x.speed));
    if (peak < c.minPeak || samples.length < 5) return null;
    return { samples, t0: samples[0].t, t1: samples[samples.length - 1].t, peakSpeed: peak };
  }
}
