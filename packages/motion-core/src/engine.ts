import { defaultConfig, mergeConfig, type DeepPartial, type EngineConfig } from './config';
import { ColorTracker } from './tracker/colorTracker';
import { PoseEstimator } from './pose/poseEstimator';
import { SwingRecognizer } from './gesture/swingRecognizer';
import type { ColorProfile, EngineEvents, FrameData, Observation, PoseSample, Recording } from './types';

type Listener<K extends keyof EngineEvents> = (e: EngineEvents[K]) => void;

export interface CalibrationProfile {
  version: 1;
  tip: ColorProfile;
  handle: ColorProfile;
  hueTolerance: number;
  refLength?: number;
  thickRef?: number;
}

/**
 * Fasad: Frame -> Tracker -> Observation -> PoseEstimator -> PoseSample -> SwingRecognizer -> GestureEvent.
 * Game hanya perlu `on('pose')` / `on('gesture')` atau membaca `engine.pose`.
 */
export class MotionEngine {
  cfg: EngineConfig;
  readonly tracker: ColorTracker;
  private poseEst: PoseEstimator;
  private recognizer: SwingRecognizer;
  private listeners = new Map<keyof EngineEvents, Set<(e: any) => void>>();
  private recording: Observation[] | null = null;
  private tracking = false;
  private lastFrame: FrameData | null = null;

  /** pose terbaru (null bila belum ada/hilang). */
  pose: PoseSample | null = null;
  lastObservation: Observation | null = null;

  constructor(config?: DeepPartial<EngineConfig>) {
    this.cfg = mergeConfig(defaultConfig(), config);
    this.tracker = new ColorTracker(this.cfg.tracker);
    this.poseEst = new PoseEstimator(this.cfg.pose);
    this.recognizer = new SwingRecognizer(this.cfg.gesture, this.cfg.pose.stickLengthM);
  }

  on<K extends keyof EngineEvents>(ev: K, cb: Listener<K>): () => void {
    let set = this.listeners.get(ev);
    if (!set) this.listeners.set(ev, (set = new Set()));
    set.add(cb);
    return () => { set!.delete(cb); };
  }
  private emit<K extends keyof EngineEvents>(ev: K, e: EngineEvents[K]) {
    this.listeners.get(ev)?.forEach(cb => cb(e));
  }

  setConfig(patch: DeepPartial<EngineConfig>) {
    this.cfg = mergeConfig(this.cfg, patch);
    this.tracker.setConfig(this.cfg.tracker);
    this.poseEst.setConfig(this.cfg.pose);
    this.recognizer.setConfig(this.cfg.gesture, this.cfg.pose.stickLengthM);
  }

  /** Masukkan frame kamera (diperkecil, dicerminkan). Menjalankan tracker. */
  pushFrame(frame: FrameData): PoseSample | null {
    this.lastFrame = frame;
    return this.pushObservation(this.tracker.process(frame));
  }

  /** Masukkan observasi langsung (replay, tracker lain, atau input sintetis seperti mouse). */
  pushObservation(obs: Observation): PoseSample | null {
    this.lastObservation = obs;
    this.recording?.push(obs);
    const pose = this.poseEst.update(obs);
    if (pose) {
      this.pose = pose;
      this.setTracking(true, obs.t);
      this.emit('pose', pose);
      for (const g of this.recognizer.push(pose)) this.emit('gesture', g);
    } else {
      this.recognizer.missing(obs.t);
      if (obs.t - this.poseEst.lastSeen > this.cfg.pose.lostTimeoutMs) { this.pose = null; this.setTracking(false, obs.t); }
    }
    return pose;
  }

  private setTracking(v: boolean, t: number) {
    if (v === this.tracking) return;
    this.tracking = v;
    if (!v) this.recognizer.reset();
    this.emit('trackingChanged', { tracking: v, t });
  }
  get isTracking() { return this.tracking; }

  /** Panjang tongkat penuh dan kedalaman nol = pose sekarang. Panggil saat tongkat tegak lurus ke kamera. */
  calibrate() { this.poseEst.calibrate(); }

  /** Pilih warna dari frame terakhir pada posisi normalisasi (0..1). */
  pickColor(which: 'tip' | 'handle', nx: number, ny: number): ColorProfile | null {
    if (!this.lastFrame) return null;
    const p = ColorTracker.sampleProfile(this.lastFrame, nx, ny);
    if (p) this.setConfig({ tracker: which === 'tip' ? { tip: p } : { handle: p } });
    return p;
  }

  exportProfile(): CalibrationProfile {
    const c = this.poseEst.getCalibration();
    return { version: 1, tip: { ...this.cfg.tracker.tip }, handle: { ...this.cfg.tracker.handle }, hueTolerance: this.cfg.tracker.hueTolerance, ...c };
  }
  importProfile(p: CalibrationProfile) {
    this.setConfig({ tracker: { tip: p.tip, handle: p.handle, hueTolerance: p.hueTolerance } });
    this.poseEst.setCalibration(p);
  }

  startRecording() { this.recording = []; }
  stopRecording(): Recording { const r: Recording = { version: 1, observations: this.recording ?? [] }; this.recording = null; return r; }

  /** Putar ulang rekaman (sinkron, memakai stempel waktu rekaman). Berguna untuk tes deterministik. */
  replay(rec: Recording) { for (const o of rec.observations) this.pushObservation(o); }

  get lastFrameData() { return this.lastFrame; }
}
