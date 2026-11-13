import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PostFX } from '@games/shell';
import { holeBounds, type Hole } from './holes';

const GREEN = new THREE.Color(0.35, 1.2, 0.5); // kepala stik = warna ujung alat asli

export class GolfStage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.3, 2500);
  readonly post: PostFX;
  private holeGroup = new THREE.Group();
  private flag!: THREE.Mesh;
  private water: THREE.Mesh[] = [];
  private t = 0;
  private shake = 0;
  private want = { pos: new THREE.Vector3(0, 4, 10), look: new THREE.Vector3(0, 2, -30), rate: 3 };
  private look = new THREE.Vector3(0, 2, -30);
  readonly ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.4 }));
  private halo: THREE.Sprite;
  private shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
  private aim: THREE.Line;
  private aimRing: THREE.Mesh;
  readonly club = new THREE.Group();
  private clubHead!: THREE.Mesh;
  private clubEnergy = 0;

  constructor(container: HTMLElement) {
    this.camera.position.copy(this.want.pos);
    this.post = new PostFX(container, this.scene, this.camera, { exposure: 0.9, bloom: { strength: 0.4, radius: 0.5, threshold: 0.9 } });
    this.scene.background = new THREE.Color(0x9fb7d8);
    this.scene.fog = new THREE.Fog(0xc9b8b0, 120, 1300);
    const pm = new THREE.PMREMGenerator(this.post.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    this.buildSky(); this.buildLights(); this.buildHills();
    this.scene.add(this.holeGroup);

    this.ball.castShadow = false; this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ball, this.shadow);
    const hc = document.createElement('canvas'); hc.width = hc.height = 64;
    const g = hc.getContext('2d')!; const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.3, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(hc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.scene.add(this.halo);

    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
    this.aim = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: new THREE.Color(1.4, 1.6, 0.6), dashSize: 2, gapSize: 1.5, transparent: true, opacity: 0.85 }));
    this.scene.add(this.aim);
    this.aimRing = new THREE.Mesh(new THREE.RingGeometry(1.4, 2, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.7, 0.6), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    this.aimRing.rotation.x = -Math.PI / 2; this.scene.add(this.aimRing);

    this.buildClub();
    this.camera.add(this.club); this.scene.add(this.camera);
  }

  /* ---------- kamera ---------- */
  moveCamera(pos: THREE.Vector3, look: THREE.Vector3, rate = 3, snap = false) {
    this.want.pos.copy(pos); this.want.look.copy(look); this.want.rate = rate;
    if (snap) { this.camera.position.copy(pos); this.look.copy(look); }
  }
  addShake(a: number) { this.shake = Math.min(1, this.shake + a); }

  render(dt: number) {
    this.t += dt;
    const k = 1 - Math.exp(-dt * this.want.rate);
    this.camera.position.lerp(this.want.pos, k); this.look.lerp(this.want.look, k);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const s = this.shake * this.shake * 0.25;
    const p = this.camera.position;
    const jit = new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, 0);
    p.add(jit); this.camera.lookAt(this.look); p.sub(jit);
    if (this.flag) { this.flag.rotation.y = Math.sin(this.t * 3) * 0.25; this.flag.scale.x = 1 + Math.sin(this.t * 5) * 0.06; }
    for (const w of this.water) (w.material as THREE.MeshStandardMaterial).opacity = 0.72 + Math.sin(this.t * 1.5 + w.position.x) * 0.06;
    // halo bola: ukuran mengikuti jarak agar bola tetap terlihat saat jauh
    const d = this.camera.position.distanceTo(this.ball.position);
    this.halo.position.copy(this.ball.position); this.halo.scale.setScalar(Math.max(0.9, d * 0.035));
    this.post.render(dt);
  }

  /* ---------- bola, garis bidik ---------- */
  setBall(x: number, y: number, z: number, visible = true) {
    this.ball.visible = visible; this.halo.visible = visible; this.shadow.visible = visible;
    this.ball.position.set(x, y + 0.3, z);
    this.shadow.position.set(x, 0.06, z);
    const s = Math.max(0.3, 1 - y * 0.025); this.shadow.scale.setScalar(s);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.5 * s;
  }
  setAim(from: THREE.Vector3, azDeg: number, len: number, visible: boolean) {
    this.aim.visible = this.aimRing.visible = visible;
    if (!visible) return;
    const a = (azDeg * Math.PI) / 180, dx = Math.sin(a), dz = -Math.cos(a);
    const end = new THREE.Vector3(from.x + dx * len, 0.2, from.z + dz * len);
    const start = new THREE.Vector3(from.x, 0.2, from.z);
    this.aim.geometry.setFromPoints([start, end]); this.aim.computeLineDistances();
    this.aimRing.position.set(end.x, 0.25, end.z);
    this.aimRing.scale.setScalar(1 + len * 0.004);
  }

  /* ---------- klub (anak kamera) ---------- */
  private buildClub() {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.5, 10), new THREE.MeshStandardMaterial({ color: 0xcfd8ee, metalness: 1, roughness: 0.25 }));
    shaft.position.y = 0.25; this.club.add(shaft);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0x1f4bff, emissive: 0x0a1f88, emissiveIntensity: 0.9 }));
    grip.position.y = -0.04; this.club.add(grip);
    this.clubHead = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.09), new THREE.MeshBasicMaterial({ color: GREEN }));
    this.clubHead.position.set(0.05, 0.53, 0); this.club.add(this.clubHead);
    this.club.visible = false;
  }
  /** pose klub: posisi di ruang kamera. direction dari engine (gagang -> ujung). */
  updateClub(px: number, py: number, quat: THREE.Quaternion, speed01: number, visible: boolean, dt: number) {
    this.club.visible = visible;
    if (!visible) return;
    const k = 1 - Math.exp(-dt * 35);
    this.club.position.lerp(new THREE.Vector3(px * 3.2, py * 3.2 + 0.9, -5.5), k);
    this.club.quaternion.slerp(quat, k);
    this.club.scale.setScalar(3.4);
    this.clubEnergy += (speed01 - this.clubEnergy) * Math.min(1, dt * 10);
    const e = 1 + this.clubEnergy * 1.2;
    (this.clubHead.material as THREE.MeshBasicMaterial).color.setRGB(GREEN.r * e, GREEN.g * e, GREEN.b * e);
  }

  /* ---------- lubang ---------- */
  setHole(h: Hole) {
    this.scene.remove(this.holeGroup);
    this.holeGroup.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); });
    this.holeGroup = new THREE.Group(); this.scene.add(this.holeGroup); this.water = [];
    const b = holeBounds(h), W = b.xmax - b.xmin, L = b.zmax - b.zmin;
    const ppm = Math.min(5, 4096 / L, 2048 / W);
    const c = document.createElement('canvas'); c.width = Math.round(W * ppm); c.height = Math.round(L * ppm);
    const g = c.getContext('2d')!;
    const X = (x: number) => (x - b.xmin) * ppm, Z = (z: number) => (z - b.zmin) * ppm;
    g.fillStyle = '#2f6b34'; g.fillRect(0, 0, c.width, c.height);
    // rumput kasar bertekstur
    for (let i = 0; i < 9000; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(20,70,30,.18)' : 'rgba(80,140,60,.14)'; g.fillRect(Math.random() * c.width, Math.random() * c.height, 3 + Math.random() * 6, 2); }
    // fairway: jalur dengan garis potong
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = '#4c9a3d'; g.lineWidth = h.fairway.width * ppm;
    g.beginPath(); h.fairway.pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z)))); g.stroke();
    g.save(); g.globalCompositeOperation = 'source-atop';
    g.restore();
    for (let z = b.zmin; z < b.zmax; z += 10) { g.fillStyle = ((z / 10) | 0) % 2 ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.045)'; g.fillRect(0, Z(z), c.width, 10 * ppm); }
    // tee
    g.fillStyle = '#5fb04a'; g.fillRect(X(h.tee.x - 4), Z(h.tee.z - 4), 8 * ppm, 8 * ppm);
    // green dengan fringe
    g.fillStyle = '#3f8f3a'; g.beginPath(); g.arc(X(h.green.x), Z(h.green.z), (h.green.r + 2.2) * ppm, 0, 6.2832); g.fill();
    g.fillStyle = '#6cc450'; g.beginPath(); g.arc(X(h.green.x), Z(h.green.z), h.green.r * ppm, 0, 6.2832); g.fill();
    for (let r = h.green.r; r > 1; r -= 2.2) { g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1.1 * ppm; g.beginPath(); g.arc(X(h.green.x), Z(h.green.z), r * ppm, 0, 6.2832); g.stroke(); }
    // bunker
    for (const k of h.bunkers) {
      g.fillStyle = '#c9ae75'; g.beginPath(); g.arc(X(k.x), Z(k.z), (k.r + 0.8) * ppm, 0, 6.2832); g.fill();
      g.fillStyle = '#ecd9a6'; g.beginPath(); g.arc(X(k.x), Z(k.z), k.r * ppm, 0, 6.2832); g.fill();
    }
    // air
    for (const w of h.water) { g.fillStyle = '#1d4f8c'; g.beginPath(); g.ellipse(X(w.x), Z(w.z), (w.rx + 1) * ppm, (w.rz + 1) * ppm, 0, 0, 6.2832); g.fill(); }
    // lubang
    g.fillStyle = '#10130f'; g.beginPath(); g.arc(X(h.pin.x), Z(h.pin.z), 0.55 * ppm, 0, 6.2832); g.fill();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, L), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set((b.xmin + b.xmax) / 2, 0, (b.zmin + b.zmax) / 2);
    this.holeGroup.add(ground);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x2a5e30, roughness: 1 }));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.05; this.holeGroup.add(outer);

    for (const w of h.water) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: 0x2f86d6, roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.75, emissive: 0x0a3a7a, emissiveIntensity: 0.4 }));
      m.rotation.x = -Math.PI / 2; m.scale.set(w.rx, w.rz, 1); m.position.set(w.x, 0.07, w.z); this.holeGroup.add(m); this.water.push(m);
    }
    // pohon (instanced)
    if (h.trees.length) {
      const foliage = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), h.trees.length);
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 1, 6), new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 1 }), h.trees.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
      h.trees.forEach((t, i) => {
        const hgt = t.r * 3.4;
        m.compose(new THREE.Vector3(t.x, hgt * 0.5 + 1, t.z), q, new THREE.Vector3(t.r * 0.55, hgt * 0.5, t.r * 0.55)); foliage.setMatrixAt(i, m);
        col.setHSL(0.3 + (Math.sin(i * 7.1) * 0.04), 0.5, 0.2 + (Math.abs(Math.sin(i * 3.3)) * 0.08)); foliage.setColorAt(i, col);
        m.compose(new THREE.Vector3(t.x, 0.6, t.z), q, new THREE.Vector3(1, 2, 1)); trunk.setMatrixAt(i, m);
      });
      foliage.instanceMatrix.needsUpdate = true; if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
      this.holeGroup.add(foliage, trunk);
    }
    // bendera + suar agar lubang terlihat dari jauh
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.6, 8), new THREE.MeshStandardMaterial({ color: 0xf1f1f1, roughness: 0.4 }));
    pole.position.set(h.pin.x, 1.8, h.pin.z); this.holeGroup.add(pole);
    const tri = new THREE.Shape(); tri.moveTo(0, 0); tri.lineTo(1.5, 0.35); tri.lineTo(0, 0.7); tri.closePath();
    this.flag = new THREE.Mesh(new THREE.ShapeGeometry(tri), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 0.5, 0.9), side: THREE.DoubleSide }));
    this.flag.position.set(h.pin.x, 3.0, h.pin.z); this.holeGroup.add(this.flag);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 60, 12, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.35, 0.8), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.set(h.pin.x, 30, h.pin.z); this.holeGroup.add(beam);
  }

  private buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x2c5aa8) }, mid: { value: new THREE.Color(0xf0a96a) }, hor: { value: new THREE.Color(0xffd9a0) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 hor; void main(){ float h = max(vP.y,0.); vec3 c = mix(hor, mid, smoothstep(0.,.12,h)); c = mix(c, top, smoothstep(.1,.7,h)); gl_FragColor = vec4(c,1.); }',
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(2200, 24, 12), mat));
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.25, 'rgba(255,220,150,.7)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sun.position.set(-500, 220, -1500); sun.scale.set(900, 900, 1); this.scene.add(sun);
  }

  private buildHills() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x23513a, roughness: 1, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2, r = 900 + (i % 3) * 120;
      const h = new THREE.Mesh(new THREE.ConeGeometry(160 + (i % 5) * 40, 90 + (i % 4) * 40, 7), mat);
      h.position.set(Math.cos(a) * r, 40, Math.sin(a) * r - 100); this.scene.add(h);
    }
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xbcd2ff, 0x3a5a38, 0.65));
    const sun = new THREE.DirectionalLight(0xffd9a8, 2.2); sun.position.set(-60, 90, -40); this.scene.add(sun);
  }
}
