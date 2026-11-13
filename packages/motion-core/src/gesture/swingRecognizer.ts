import type { EngineConfig } from '../config';
import type { Direction8, GestureEvent, GestureKind, PoseSample, Vec2 } from '../types';

interface Sample { t: number; x: number; y: number; hx: number; hy: number; len: number; speed: number; vx: number; vy: number }

const DIRS: Direction8[] = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];

/**
 * PoseSample -> GestureEvent. Dua detektor:
 *  - ayunan 2D: kecepatan ujung (L/s) melewati ambang -> kumpulkan lintasan -> klasifikasi arah.
 *  - tusuk ke kamera: ujung hampir diam di layar tetapi gagang membesar (depthRate).
 */
export class SwingRecognizer {
  private ring: Sample[] = [];
  private active = false;
  private samples: Sample[] = [];
  private below = 0;
  private lost = 0;
  private cooldownUntil = 0;
  private thrust = { active: false, peak: 0, t0: 0, cooldownUntil: 0 };

  constructor(private cfg: EngineConfig['gesture'], private stickLengthM: number) {}
  setConfig(cfg: EngineConfig['gesture'], stickLengthM: number) { this.cfg = cfg; this.stickLengthM = stickLengthM; }
  reset() { this.ring.length = 0; this.active = false; this.thrust.active = false; }

  /** dipanggil saat ujung tidak terlihat (mis. motion blur). */
  missing(_t: number) { if (this.active) this.lost++; }

  push(p: PoseSample): GestureEvent[] {
    const out: GestureEvent[] = [];
    const s: Sample = { t: p.t, x: p.tip.x, y: p.tip.y, hx: p.handle.x, hy: p.handle.y, len: p.length, speed: p.speed, vx: p.velocity.x, vy: p.velocity.y };
    this.ring.push(s); if (this.ring.length > 12) this.ring.shift();
    const swing = this.detectSwing(s, p);
    if (swing) out.push(swing);
    const thrust = this.detectThrust(s, p);
    if (thrust) out.push(thrust);
    return out;
  }

  private detectSwing(s: Sample, p: PoseSample): GestureEvent | null {
    const c = this.cfg;
    if (!this.active) {
      if (s.speed > c.startThreshold && s.t > this.cooldownUntil) {
        this.active = true; this.below = 0; this.lost = 0;
        this.samples = this.ring.filter(r => s.t - r.t <= 110);
      }
      return null;
    }
    this.samples.push(s);
    this.below = s.speed < c.startThreshold * c.endRatio ? this.below + 1 : 0;
    if (this.below >= 2 || s.t - this.samples[0].t > 1500) return this.finishSwing(p);
    return null;
  }

  private finishSwing(p: PoseSample): GestureEvent | null {
    const c = this.cfg;
    this.active = false; this.cooldownUntil = p.t + c.cooldownMs;
    const sm = this.samples.slice(0, this.samples.length - this.below);
    if (sm.length < 3) return null;
    const peak = Math.max(...sm.map(s => s.speed));
    let P = 0;
    for (let i = 1; i < sm.length; i++) P += Math.hypot(sm[i].x - sm[i - 1].x, sm[i].y - sm[i - 1].y);
    const first = sm[0], last = sm[sm.length - 1];
    const D = Math.hypot(last.x - first.x, last.y - first.y);
    const L = Math.max(p.refLength, 0.05);
    if (peak < c.startThreshold || P < c.minPathLengths * L) return null;

    const fast = sm.filter(s => s.speed >= 0.7 * peak);
    let vx = 0, vy = 0; for (const s of fast) { vx += s.vx; vy += s.vy; } vx /= fast.length; vy /= fast.length;
    const vm = Math.hypot(vx, vy) || 1;
    const angleScreen = (Math.atan2(vy, vx) * 180) / Math.PI;             // y ke bawah
    const di = ((Math.round(angleScreen / 45) % 8) + 8) % 8;
    const pk = sm.reduce((a, b) => (b.speed > a.speed ? b : a));
    const ux = pk.x - pk.hx, uy = pk.y - pk.hy, um = Math.hypot(ux, uy) || 1;
    const axial = Math.abs((vx * ux + vy * uy) / (vm * um));
    const straightness = P ? D / P : 0;

    let kind: GestureKind;
    if (axial > 0.85 && straightness > 0.75) kind = 'thrust';
    else if (di === 0 || di === 4) kind = 'slice';
    else if (di === 2) kind = 'chop';
    else if (di === 6) kind = 'uppercut';
    else kind = 'diagonal';

    const step = Math.max(1, Math.floor(sm.length / 24));
    const path: Vec2[] = sm.filter((_, i) => i % step === 0).map(s => ({ x: s.x, y: s.y }));
    return {
      type: 'gesture', kind, direction: DIRS[di],
      dir: { x: vx / vm, y: -vy / vm },
      angleDeg: -angleScreen,
      peak, speedMps: peak * this.stickLengthM, power: Math.min(1, peak / c.fullPowerSpeed),
      durationMs: last.t - first.t, straightness, arc: straightness < 0.6, depth: false,
      path, lostFrames: this.lost, t0: first.t, t1: last.t,
    };
  }

  private detectThrust(s: Sample, p: PoseSample): GestureEvent | null {
    const c = this.cfg, th = this.thrust, z = p.depthRate;
    if (!th.active) {
      if (z > c.thrustThreshold && s.t > th.cooldownUntil && s.speed < c.startThreshold) { th.active = true; th.peak = z; th.t0 = s.t; }
      return null;
    }
    th.peak = Math.max(th.peak, z);
    if (z < c.thrustThreshold * 0.4 || s.t - th.t0 > 900) {
      th.active = false; th.cooldownUntil = s.t + c.thrustCooldownMs;
      if (s.t - th.t0 > 60) {
        return {
          type: 'gesture', kind: 'thrust', direction: 'up', dir: { x: 0, y: 0 }, angleDeg: 0,
          peak: th.peak, speedMps: 0, power: Math.min(1, th.peak / (c.thrustThreshold * 2.5)),
          durationMs: s.t - th.t0, straightness: 1, arc: false, depth: true, path: [], lostFrames: 0, t0: th.t0, t1: s.t,
        };
      }
    }
    return null;
  }
}
