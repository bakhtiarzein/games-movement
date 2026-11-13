/** One-Euro filter: halus saat pelan, responsif saat cepat. */
export class OneEuro {
  private t: number | null = null;
  private x = 0;
  private dx = 0;
  constructor(private minCut = 2.5, private beta = 12, private dCut = 1.5) {}
  private a(c: number, dt: number) { const tau = 1 / (2 * Math.PI * c); return 1 / (1 + tau / dt); }
  reset() { this.t = null; }
  filter(x: number, tMs: number): number {
    if (this.t == null) { this.x = x; this.dx = 0; this.t = tMs; return x; }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    const dx = (x - this.x) / dt;
    this.dx += this.a(this.dCut, dt) * (dx - this.dx);
    const cut = this.minCut + this.beta * Math.abs(this.dx);
    this.x += this.a(cut, dt) * (x - this.x);
    this.t = tMs;
    return this.x;
  }
}
