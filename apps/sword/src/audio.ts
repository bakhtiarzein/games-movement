import { SynthAudio } from '@games/shell';

export class Sfx extends SynthAudio {
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
