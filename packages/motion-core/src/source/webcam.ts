import type { FrameData } from '../types';

export interface WebcamOptions {
  /** lebar resolusi proses (px); tinggi mengikuti aspek kamera */
  processWidth?: number;
  width?: number;
  height?: number;
  fps?: number;
  deviceId?: string;
  /** cerminkan gambar (tampil seperti cermin). Default true. */
  mirror?: boolean;
}

/** Sumber frame dari webcam: getUserMedia + requestVideoFrameCallback, diperkecil dan dicerminkan. */
export class WebcamSource {
  readonly video: HTMLVideoElement;
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  private cb: ((f: FrameData) => void) | null = null;
  private running = false;
  private lastT = -1;
  private stream: MediaStream | null = null;
  settings: MediaTrackSettings = {};

  constructor(private opts: WebcamOptions = {}) {
    this.video = document.createElement('video');
    this.video.playsInline = true; this.video.muted = true;
    Object.assign(this.video.style, { position: 'absolute', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
    document.body.appendChild(this.video);
  }

  onFrame(cb: (f: FrameData) => void) { this.cb = cb; }

  async start() {
    const o = this.opts;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: o.width ?? 640 }, height: { ideal: o.height ?? 480 }, frameRate: { ideal: o.fps ?? 60 },
        ...(o.deviceId ? { deviceId: { exact: o.deviceId } } : {}),
      },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.settings = this.stream.getVideoTracks()[0].getSettings();
    const pw = o.processWidth ?? 320;
    this.canvas.width = pw;
    this.canvas.height = Math.round((pw * this.video.videoHeight) / this.video.videoWidth);
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach(t => t.stop());
  }

  get size() { return { width: this.canvas.width, height: this.canvas.height }; }

  private loop() {
    if (!this.running) return;
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: { captureTime?: number }) => void) => number;
    };
    const handle = (now: number, meta?: { captureTime?: number }) => {
      const t = meta?.captureTime ?? now;
      if (t > this.lastT) { this.lastT = t; this.grab(t); }
      this.loop();
    };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(handle);
    else requestAnimationFrame(now => handle(now));
  }

  private grab(t: number) {
    const { canvas: c, ctx } = this;
    if (this.opts.mirror === false) ctx.setTransform(1, 0, 0, 1, 0, 0); else ctx.setTransform(-1, 0, 0, 1, c.width, 0);
    ctx.drawImage(this.video, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    this.cb?.({ data: img.data, width: c.width, height: c.height, t });
  }
}
