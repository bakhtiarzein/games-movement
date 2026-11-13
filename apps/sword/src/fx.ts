import * as THREE from 'three';

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Partikel aditif berkolam tetap (tanpa alokasi per ledakan). */
export class Particles {
  private cap = 700;
  private pos = new Float32Array(this.cap * 3);
  private col = new Float32Array(this.cap * 3);
  private vel = new Float32Array(this.cap * 3);
  private life = new Float32Array(this.cap);
  private max = new Float32Array(this.cap);
  private base = new Float32Array(this.cap * 3);
  private head = 0;
  private geo = new THREE.BufferGeometry();

  constructor(scene: THREE.Scene) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.PointsMaterial({
      size: 0.2, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const pts = new THREE.Points(this.geo, m); pts.frustumCulled = false;
    scene.add(pts);
    for (let i = 0; i < this.cap; i++) this.pos[i * 3 + 1] = -999;
  }

  burst(p: THREE.Vector3, color: THREE.Color, count: number, speed: number, dir?: THREE.Vector3, spread = 1) {
    for (let n = 0; n < count; n++) {
      const i = this.head; this.head = (this.head + 1) % this.cap;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      let vx = Math.sin(ph) * Math.cos(th), vy = Math.sin(ph) * Math.sin(th), vz = Math.cos(ph);
      if (dir) { vx = vx * spread + dir.x; vy = vy * spread + dir.y; vz = vz * spread + dir.z; }
      const s = speed * (0.4 + Math.random() * 0.9);
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.vel[i * 3] = vx * s; this.vel[i * 3 + 1] = vy * s; this.vel[i * 3 + 2] = vz * s;
      const k = 0.6 + Math.random() * 0.8;
      this.base[i * 3] = color.r * k; this.base[i * 3 + 1] = color.g * k; this.base[i * 3 + 2] = color.b * k;
      this.life[i] = this.max[i] = 0.45 + Math.random() * 0.6;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      this.life[i] -= dt;
      const f = Math.max(0, this.life[i] / this.max[i]);
      this.vel[i * 3 + 1] -= 7 * dt;
      this.vel[i * 3] *= 1 - dt * 1.2; this.vel[i * 3 + 2] *= 1 - dt * 1.2;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.col[i * 3] = this.base[i * 3] * f; this.col[i * 3 + 1] = this.base[i * 3 + 1] * f; this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
}

/** Pita jejak bilah: dua sisi (pangkal & ujung) per sampel, memudar menurut umur. */
export class BladeTrail {
  private pts: { a: THREE.Vector3; b: THREE.Vector3; t: number }[] = [];
  private geo = new THREE.BufferGeometry();
  private maxPts = 20;
  private life = 0.28;
  private posAttr = new Float32Array(this.maxPts * 2 * 3);
  private colAttr = new Float32Array(this.maxPts * 2 * 3);
  private mesh: THREE.Mesh;
  color = new THREE.Color(0.3, 1.2, 1.5);

  constructor(scene: THREE.Scene) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.posAttr, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colAttr, 3));
    const idx: number[] = [];
    for (let i = 0; i < this.maxPts - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  push(a: THREE.Vector3, b: THREE.Vector3, now: number) {
    this.pts.push({ a: a.clone(), b: b.clone(), t: now });
    if (this.pts.length > this.maxPts) this.pts.shift();
  }

  update(now: number) {
    while (this.pts.length && now - this.pts[0].t > this.life) this.pts.shift();
    const n = this.pts.length;
    for (let i = 0; i < this.maxPts; i++) {
      const p = this.pts[Math.min(i, n - 1)] ?? null;
      const j = i * 2;
      if (!p || n < 2 || i >= n) { for (let k = 0; k < 6; k++) { this.posAttr[j * 3 + k] = 0; this.colAttr[j * 3 + k] = 0; } continue; }
      const f = Math.max(0, 1 - (now - p.t) / this.life);
      this.posAttr.set([p.a.x, p.a.y, p.a.z, p.b.x, p.b.y, p.b.z], j * 3);
      const c = this.color;
      this.colAttr.set([c.r * f * 0.05, c.g * f * 0.05, c.b * f * 0.05, c.r * f * 0.7, c.g * f * 0.7, c.b * f * 0.7], j * 3);
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
}
