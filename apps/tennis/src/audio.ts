import { SynthAudio } from '@games/shell';

export class Sfx extends SynthAudio {
  hit(power: number) { this.noise(0.09, 2600, 700, 1.1, 0.5); this.tone(180 + power * 120, 90, 0.12, 0.35); }
  oppHit() { this.noise(0.08, 2200, 600, 1.1, 0.35); this.tone(150, 80, 0.1, 0.25); }
  bounce() { this.tone(210, 120, 0.07, 0.22); }
  net() { this.noise(0.2, 900, 200, 0.7, 0.4); }
  winner() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, f * 1.01, 0.2, 0.18, 'triangle'), i * 70)); }
  miss() { this.tone(260, 90, 0.4, 0.3, 'sawtooth'); }
  serve() { this.tone(330, 440, 0.08, 0.12, 'triangle'); }
}
