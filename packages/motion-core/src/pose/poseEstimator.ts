import type { EngineConfig } from '../config';
import type { Observation, PoseSample, WorldPose } from '../types';
import { OneEuro } from './oneEuro';
import { clamp, quatFromYTo } from './math';

/**
 * Observation (2D, piksel) -> PoseSample (tersaring, satuan L/s, pose dunia 2.5D).
 *
 * Kedalaman: ketebalan gagang (silinder) ~ 1/jarak, tidak terpengaruh foreshortening.
 * Arah di kedalaman: panjang tampak / panjang acuan = cos(pitch). Tanda pitch ambigu dari satu kamera;
 * dipilih "ujung lebih dekat ke kamera daripada tangan" (maju dari tubuh pemain) -> -z di dunia game.
 */
export class PoseEstimator {
  private fTx = new OneEuro(); private fTy = new OneEuro();
  private fHx = new OneEuro(); private fHy = new OneEuro();
  private t: number | null = null;
  private tipX = 0; private tipY = 0; private hx = 0; private hy = 0; private hasHandle = false;
  private vx = 0; private vy = 0;
  private refLength = 0; private length = 0;
  private thick = 0; private thickRef = 0;
  private lnHist: { t: number; v: number }[] = [];
  private depthRate = 0;
  lastSeen = -1e9;

  constructor(private cfg: EngineConfig['pose']) {}
  setConfig(cfg: EngineConfig['pose']) { this.cfg = cfg; }

  get refLen() { return this.refLength; }
  get thickRefValue() { return this.thickRef; }
  /** nilai kalibrasi untuk disimpan/dipulihkan. */
  getCalibration() { return { refLength: this.refLength, thickRef: this.thickRef }; }
  setCalibration(c: { refLength?: number; thickRef?: number }) {
    if (c.refLength) this.refLength = c.refLength;
    if (c.thickRef) this.thickRef = c.thickRef;
  }

  /** Jadikan keadaan sekarang sebagai acuan: panjang penuh dan kedalaman nol. */
  calibrate() {
    if (this.length > 0) this.refLength = this.length;
    if (this.thick > 0) this.thickRef = this.thick;
  }

  reset() {
    this.t = null; this.vx = this.vy = 0; this.depthRate = 0; this.lnHist.length = 0;
    this.fTx.reset(); this.fTy.reset(); this.fHx.reset(); this.fHy.reset(); this.hasHandle = false;
  }

  /** @returns null bila ujung tidak terlihat. */
  update(obs: Observation): PoseSample | null {
    const { tip, handle, t } = obs;
    if (!tip) {
      if (t - this.lastSeen > this.cfg.lostTimeoutMs) this.reset();
      return null;
    }
    this.lastSeen = t;
    const Tx = this.fTx.filter(tip.x, t), Ty = this.fTy.filter(tip.y, t);
    if (handle) { this.hx = this.fHx.filter(handle.x, t); this.hy = this.fHy.filter(handle.y, t); this.hasHandle = true; }
    if (this.t == null) { this.tipX = Tx; this.tipY = Ty; this.t = t; return null; }
    const dt = (t - this.t) / 1000;
    if (dt < 0.004) return null;

    const rvx = (Tx - this.tipX) / dt, rvy = (Ty - this.tipY) / dt;
    this.vx = this.vx * 0.35 + rvx * 0.65; this.vy = this.vy * 0.35 + rvy * 0.65;
    this.tipX = Tx; this.tipY = Ty; this.t = t;

    if (this.hasHandle) {
      this.length = Math.hypot(this.tipX - this.hx, this.tipY - this.hy);
      this.refLength = Math.max(this.length, this.refLength * (1 - this.cfg.refLengthDecay * dt));
    }
    const L = Math.max(this.refLength, 0.05);
    const speed = Math.hypot(this.vx, this.vy) / L;

    if (handle) {
      const lnT = Math.log(handle.minor);
      this.thick = this.thick ? Math.exp(0.5 * Math.log(this.thick) + 0.5 * lnT) : handle.minor;
      if (!this.thickRef) this.thickRef = this.thick;
      this.lnHist.push({ t, v: Math.log(this.thick) }); if (this.lnHist.length > 8) this.lnHist.shift();
      const ref = this.lnHist.find(h => t - h.t <= 140 && t - h.t >= 60) ?? this.lnHist[0];
      const z = ref && t - ref.t > 30 ? (Math.log(this.thick) - ref.v) / ((t - ref.t) / 1000) : 0;
      this.depthRate = this.depthRate * 0.5 + z * 0.5;
    }

    const world = this.toWorld(obs.aspect);
    const l2 = this.refLength > 0 ? clamp(this.length / this.refLength, 0, 1) : 1;
    return {
      t,
      tip: { x: this.tipX, y: this.tipY },
      handle: { x: this.hx, y: this.hy },
      length: this.length,
      refLength: this.refLength,
      speed,
      velocity: { x: this.vx / L, y: this.vy / L },
      depthRate: this.depthRate,
      pitchDeg: (Math.acos(l2) * 180) / Math.PI,
      angleDeg: (Math.atan2(-(this.tipY - this.hy), this.tipX - this.hx) * 180) / Math.PI,
      world,
      handleStale: !handle,
    };
  }

  private toWorld(aspect: number): WorldPose {
    const s = this.cfg.worldWidthM;
    const depth = this.thickRef > 0 && this.thick > 0 ? clamp(Math.log(this.thick / this.thickRef), -0.7, 0.7) : 0;
    const position = { x: (this.hx - 0.5) * s, y: (aspect / 2 - this.hy) * s, z: -depth * this.cfg.depthGainM };
    const len = this.length || 1;
    const l2 = this.refLength > 0 ? clamp(this.length / this.refLength, 0, 1) : 1;
    const dx = (this.tipX - this.hx) / len, dy = -(this.tipY - this.hy) / len;
    const dz = -Math.sqrt(Math.max(0, 1 - l2 * l2));
    const direction = { x: dx * l2, y: dy * l2, z: dz };
    const L = this.cfg.stickLengthM;
    return {
      position,
      direction,
      quaternion: quatFromYTo(direction),
      tip: { x: position.x + direction.x * L, y: position.y + direction.y * L, z: position.z + direction.z * L },
    };
  }
}
