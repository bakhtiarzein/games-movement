import { SynthAudio } from '@games/shell';

export class Sfx extends SynthAudio {
  swing(power: number) { this.noise(0.28, 400 + power * 500, 2400, 1.0, 0.15 + power * 0.2); }
  hit(power: number) { this.noise(0.07, 3200, 900, 1.2, 0.55); this.tone(900 + power * 400, 300, 0.09, 0.3, 'triangle'); this.tone(120, 60, 0.12, 0.35); }
  land() { this.noise(0.16, 500, 120, 0.8, 0.3); this.tone(110, 70, 0.14, 0.2); }
  splash() { this.noise(0.45, 2400, 300, 0.6, 0.45); this.tone(300, 120, 0.25, 0.15); }
  sand() { this.noise(0.3, 1800, 500, 0.5, 0.3); }
  cup() { [659, 784, 988, 1318].forEach((f, i) => setTimeout(() => this.tone(f, f * 1.01, 0.22, 0.18, 'triangle'), i * 90)); }
  tick() { this.tone(520, 420, 0.05, 0.1); }
  bad() { this.tone(240, 110, 0.3, 0.22, 'sawtooth'); }
}
