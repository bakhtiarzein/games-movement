/** Efek suara sintetis (tanpa aset). AudioContext dibuat setelah interaksi pengguna pertama. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  muted = false;

  init() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  private noise(dur: number, f0: number, f1: number, q: number, gain: number) {
    const c = this.ctx; if (!c || this.muted) return;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, c.currentTime); bp.frequency.exponentialRampToValueAtTime(f1, c.currentTime + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(); src.stop(c.currentTime + dur + 0.05);
  }

  private tone(f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine') {
    const c = this.ctx; if (!c || this.muted) return;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, c.currentTime); o.frequency.exponentialRampToValueAtTime(f1, c.currentTime + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g); g.connect(this.master); o.start(); o.stop(c.currentTime + dur + 0.05);
  }

  whoosh(power: number) { this.noise(0.22, 500 + power * 600, 2200 + power * 1500, 1.2, 0.18 + power * 0.25); }
  slice(power: number, combo: number) {
    this.noise(0.14, 4200, 900, 0.9, 0.5);
    this.tone(520 * Math.pow(1.0595, Math.min(combo, 12)), 1100, 0.18, 0.18, 'triangle');
    if (power > 0.6) this.tone(180, 60, 0.2, 0.25);
  }
  bomb() { this.noise(0.5, 900, 60, 0.6, 0.9); this.tone(120, 30, 0.5, 0.5, 'sawtooth'); }
  thrust() { this.tone(90, 520, 0.35, 0.35, 'sawtooth'); this.noise(0.4, 300, 3000, 0.7, 0.4); }
  miss() { this.tone(220, 110, 0.15, 0.08); }
}
