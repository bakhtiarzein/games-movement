import {
  MotionEngine, WebcamSource, syntheticObservation, poseTimeline, loadSharedColors, saveSharedColors,
  type DeepPartial, type EngineConfig, type Observation,
} from '@games/motion-core';
import { SHELL_CSS } from './ui';

export interface MotionInputOptions {
  /** kunci localStorage untuk profil kalibrasi (satu per game). */
  profileKey: string;
  engine?: DeepPartial<EngineConfig>;
  /** mode mouse: sudut tongkat saat diam (derajat, y ke bawah; -90 = tegak ke atas, 90 = menggantung ke bawah). */
  mouse?: {
    restAngleDeg?: number; leanGain?: number;
    /** bila diisi: gagang tetap di sini (satuan lebar gambar) dan ujung mengikuti arah mouse (ayunan melingkar, untuk golf). */
    anchor?: { hx: number; hy: number };
  };
  /** umpan balik singkat ke pemain (mis. "KALIBRASI"). */
  onNotice?: (title: string, sub: string) => void;
}

type Gen = Generator<Observation>;

/**
 * Sumber gerakan siap pakai untuk game: webcam (dengan layar kalibrasi) atau mouse/sentuh (mode demo).
 * Keduanya mengalir ke `engine`, sehingga game tidak peduli dari mana gerakan berasal.
 */
export class MotionInput {
  readonly engine: MotionEngine;
  mode: 'camera' | 'mouse' | null = null;
  readonly pointer = { nx: 0.5, ny: 0.5, inside: false };

  private webcam: WebcamSource | null = null;
  private playing = false;
  private pip: HTMLCanvasElement;
  private pctx: CanvasRenderingContext2D;
  private calib: HTMLElement;
  private chip: HTMLElement;
  private pick: 'tip' | 'handle' | null = null;
  private script: Gen | null = null;
  private scriptT0 = 0;
  private scriptFirstT: number | null = null;
  private pending: Observation | null = null;
  private lastMouseT = 0;
  private vx = 0; private lastNx = 0.5; private lean = 0; private anchorAngle = 90;
  private onReady: (() => void) | null = null;

  constructor(private opts: MotionInputOptions) {
    this.engine = new MotionEngine(opts.engine);
    try { const p = localStorage.getItem(opts.profileKey); if (p) this.engine.importProfile(JSON.parse(p)); } catch { /* abaikan */ }
    // warna penanda dibagi antar game (kalibrasi sekali di game/lab mana pun); menimpa warna per-game yang lebih lama
    const sc = loadSharedColors();
    if (sc) this.engine.setConfig({ tracker: { tip: sc.tip, handle: sc.handle, hueTolerance: sc.hueTolerance } });

    if (!document.getElementById('mi-style')) {
      const st = document.createElement('style'); st.id = 'mi-style'; st.textContent = SHELL_CSS; document.head.appendChild(st);
    }
    this.pip = document.createElement('canvas'); this.pip.id = 'mi-pip'; this.pip.width = 320; this.pip.height = 240;
    this.pctx = this.pip.getContext('2d')!;
    this.chip = document.createElement('div'); this.chip.id = 'mi-chip';
    this.chip.textContent = 'Tongkat tidak terdeteksi — tampilkan ujung hijau & gagang biru ke kamera';
    this.calib = document.createElement('div'); this.calib.id = 'mi-calib';
    this.calib.innerHTML = `<p id="mi-help"></p><div class="row">
      <button id="mi-tip">1 · Pilih ujung</button><button id="mi-handle">2 · Pilih gagang</button>
      <button id="mi-len">3 · Kalibrasi panjang</button><button id="mi-go" class="primary">Main ▶</button></div>`;
    document.body.append(this.pip, this.chip, this.calib);

    const $ = (id: string) => document.getElementById(id)!;
    $('mi-tip').onclick = () => this.setPick(this.pick === 'tip' ? null : 'tip');
    $('mi-handle').onclick = () => this.setPick(this.pick === 'handle' ? null : 'handle');
    $('mi-len').onclick = () => this.calibrate();
    $('mi-go').onclick = () => { this.save(); this.calib.style.display = 'none'; this.pip.classList.remove('large'); this.onReady?.(); };
    this.pip.addEventListener('click', e => {
      if (!this.pick) return;
      const r = this.pip.getBoundingClientRect();
      if (this.engine.pickColor(this.pick, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)) { this.save(); this.setPick(null); }
    });
    addEventListener('keydown', e => {
      if (e.key === 'c' || e.key === 'C') this.calibrate();
      if (e.key === '3' && this.calib.style.display === 'block') this.calibrate();
      if (e.code === 'Space' && this.mode === 'mouse') { e.preventDefault(); this.demoThrust(); }
    });
    const move = (e: PointerEvent) => { this.pointer.nx = e.clientX / innerWidth; this.pointer.ny = e.clientY / innerHeight; this.pointer.inside = true; };
    addEventListener('pointermove', move); addEventListener('pointerdown', move);
    document.addEventListener('pointerleave', () => { this.pointer.inside = false; });
  }

  private save() {
    try { localStorage.setItem(this.opts.profileKey, JSON.stringify(this.engine.exportProfile())); } catch { /* abaikan */ }
    const t = this.engine.cfg.tracker;
    saveSharedColors({ version: 1, tip: { ...t.tip }, handle: { ...t.handle }, hueTolerance: t.hueTolerance });
  }
  private calibrate() { this.engine.calibrate(); this.save(); this.opts.onNotice?.('KALIBRASI', 'panjang & kedalaman direset'); }
  private setPick(m: 'tip' | 'handle' | null) {
    this.pick = m;
    document.getElementById('mi-tip')!.classList.toggle('on', m === 'tip');
    document.getElementById('mi-handle')!.classList.toggle('on', m === 'handle');
    document.getElementById('mi-help')!.innerHTML = m
      ? `Klik warna <b>${m === 'tip' ? 'ujung (hijau)' : 'gagang (biru)'}</b> tongkat pada gambar kamera.`
      : 'Pilih warna ujung &amp; gagang bila deteksi kurang pas, lalu pegang tongkat <b>mendatar</b> menghadap kamera dan tekan <b>3</b>.';
  }

  /** Buka kamera dan tampilkan layar kalibrasi; `onReady` dipanggil saat pemain menekan "Main". @returns pesan galat atau null. */
  async startCamera(onReady: () => void): Promise<string | null> {
    try {
      this.webcam = new WebcamSource({ processWidth: 320 });
      this.webcam.onFrame(f => this.engine.pushFrame(f));
      await this.webcam.start();
    } catch (e) {
      return 'Kamera tidak bisa dibuka: ' + (e as Error).message + '. Coba mode demo, atau izinkan akses kamera.';
    }
    this.mode = 'camera'; this.onReady = onReady;
    this.pip.style.display = 'block'; this.pip.classList.add('large');
    this.calib.style.display = 'block'; this.setPick(null);
    return null;
  }

  startMouse() { this.mode = 'mouse'; this.lastMouseT = performance.now(); }

  /** PIP kecil + peringatan "tongkat tidak terdeteksi" hanya saat sedang bermain dengan kamera. */
  setPlaying(b: boolean) {
    this.playing = b;
    if (this.mode === 'camera') { this.pip.style.display = b || this.calib.style.display === 'block' ? 'block' : 'none'; }
  }
  get isCameraCalibrating() { return this.calib.style.display === 'block'; }

  /** Panggil setiap frame render. */
  step(now: number) {
    if (this.mode === 'mouse') this.mouseStep(now);
    if (this.mode === 'camera') this.drawPip();
    this.chip.style.display = this.playing && this.mode === 'camera' && !this.engine.isTracking ? 'block' : 'none';
  }

  /* ---------- mode mouse ---------- */
  private mouseStep(now: number) {
    const dt = Math.max(0.001, (now - this.lastMouseT) / 1000); this.lastMouseT = now;
    if (this.script) {
      // skrip diputar menurut waktu nyata (bukan satu observasi per frame) agar tidak melar saat FPS rendah
      if (this.scriptFirstT === null) this.scriptT0 = now;
      const el = now - this.scriptT0;
      for (;;) {
        if (!this.pending) { const r = this.script.next(); if (r.done) { this.script = null; this.scriptFirstT = null; break; } this.pending = r.value; }
        this.scriptFirstT ??= this.pending.t;
        if (this.pending.t - this.scriptFirstT > el) break;
        this.engine.pushObservation({ ...this.pending, t: this.scriptT0 + (this.pending.t - this.scriptFirstT) });
        this.pending = null;
      }
      return;
    }
    const p = this.pointer;
    if (!p.inside) { this.engine.pushObservation({ t: now, aspect: 0.75, tip: null, handle: null }); return; }
    const anchor = this.opts.mouse?.anchor;
    if (anchor) {
      const dx = p.nx - anchor.hx, dy = p.ny * 0.75 - anchor.hy;
      if (Math.hypot(dx, dy) > 0.02) this.anchorAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
      this.engine.pushObservation(syntheticObservation(now, { hx: anchor.hx, hy: anchor.hy, angleDeg: this.anchorAngle }));
      return;
    }
    const rest = this.opts.mouse?.restAngleDeg ?? -90, gain = this.opts.mouse?.leanGain ?? 14;
    this.vx = this.vx * 0.8 + ((p.nx - this.lastNx) / dt) * 0.2; this.lastNx = p.nx;
    this.lean += (Math.max(-30, Math.min(30, this.vx * gain)) - this.lean) * 0.2;
    this.engine.pushObservation(syntheticObservation(now, { hx: p.nx, hy: p.ny * 0.75, angleDeg: rest + this.lean }));
  }

  /** Spasi di mode mouse = tusuk ke kamera (mendekat + memendek). */
  demoThrust() {
    if (this.mode !== 'mouse' || this.script) return;
    const rest = this.opts.mouse?.restAngleDeg ?? -90;
    const base = { hx: this.pointer.nx, hy: this.pointer.ny * 0.75, angleDeg: rest };
    this.script = poseTimeline([
      { dur: 0.25, to: { ...base, k: 1.5, c: 0.5 }, mode: 'ease' },
      { dur: 0.5, to: { ...base, k: 1.5, c: 0.5 }, mode: 'hold' },
      { dur: 0.3, to: { ...base, k: 1, c: 1 }, mode: 'lin' },
    ], base, { fps: 60 });
    this.scriptFirstT = null; this.pending = null;
  }

  /** Putar skrip gerakan sintetis (untuk demo/tes): tiap panggilan step() mengambil satu observasi. */
  playScript(gen: Gen) { this.script = gen; this.scriptFirstT = null; this.pending = null; }

  /* ---------- PIP kamera ---------- */
  private drawPip() {
    const w = this.webcam; if (!w || this.pip.style.display === 'none') return;
    const cw = this.pip.width, ch = (this.pip.height = Math.round(cw * (w.video.videoHeight / w.video.videoWidth || 0.75)));
    const c = this.pctx;
    c.save(); c.setTransform(-1, 0, 0, 1, cw, 0); c.drawImage(w.video, 0, 0, cw, ch); c.restore();
    const o = this.engine.lastObservation; if (!o) return;
    const ring = (b: { x: number; y: number } | null, col: string) => { if (!b) return; c.strokeStyle = col; c.lineWidth = 3; c.beginPath(); c.arc(b.x * cw, b.y * cw, 12, 0, 6.2832); c.stroke(); };
    ring(o.tip, '#46e07a'); ring(o.handle, '#4c8dff');
    if (o.tip && o.handle) { c.strokeStyle = '#ffe14d'; c.lineWidth = 2; c.beginPath(); c.moveTo(o.handle.x * cw, o.handle.y * cw); c.lineTo(o.tip.x * cw, o.tip.y * cw); c.stroke(); }
    else { c.fillStyle = '#ffb84d'; c.font = '600 14px system-ui'; c.fillText(!o.tip && !o.handle ? 'Tongkat tidak terdeteksi' : !o.tip ? 'Ujung hijau tidak terlihat' : 'Gagang biru tidak terlihat', 10, 22); }
  }
}
