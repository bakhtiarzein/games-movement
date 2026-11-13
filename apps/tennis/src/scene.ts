import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PostFX } from '@games/shell';
import { BALL_R, COURT, Z_HIT, Z_OPP } from './physics';

/** Ruang game: pose dunia (m) -> unit game. */
export const RACKET_SCALE = 4.2;
export const POS_GAIN_X = 5.5;
export const POS_GAIN_Y = 4.0;
export const Y_HAND = 0.9;
export const Z_DEPTH_GAIN = 0.6;

const FRAME = new THREE.Color(0.35, 1.2, 0.5); // bingkai hijau = warna ujung alat asli

export class TennisStage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
  readonly post: PostFX;
  private base = new THREE.Vector3(0, 4.3, 13.8);
  private shake = 0;
  private t = 0;
  private lights: THREE.Mesh[] = [];

  constructor(container: HTMLElement) {
    this.camera.position.copy(this.base);
    this.camera.lookAt(0, 0.7, -3);
    this.post = new PostFX(container, this.scene, this.camera, { exposure: 0.85, bloom: { strength: 0.5, radius: 0.55, threshold: 0.85 } });
    this.scene.background = new THREE.Color(0x060818);
    this.scene.fog = new THREE.FogExp2(0x070a1c, 0.016);
    const pm = new THREE.PMREMGenerator(this.post.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.2;
    this.buildSky(); this.buildCourt(); this.buildNet(); this.buildStadium(); this.buildLights();
  }

  addShake(a: number) { this.shake = Math.min(1, this.shake + a); }

  render(dt: number) {
    this.t += dt;
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const s = this.shake * this.shake * 0.18;
    this.camera.position.set(this.base.x + (Math.random() - 0.5) * s, this.base.y + (Math.random() - 0.5) * s, this.base.z);
    this.lights.forEach((m, i) => { (m.material as THREE.MeshBasicMaterial).color.setScalar(1.8 + Math.sin(this.t * 2 + i) * 0.08); });
    this.post.render(dt);
  }

  private buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x070a22) }, hor: { value: new THREE.Color(0x24336b) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 hor; void main(){ float h = max(vP.y,0.); gl_FragColor = vec4(mix(hor, top, smoothstep(0.,.6,h)),1.); }',
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(200, 24, 12), mat));
    const n = 400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2, v = Math.random() * 0.8 + 0.12, r = 180;
      pos[i * 3] = Math.cos(u) * Math.sqrt(1 - v * v) * r; pos[i * 3 + 1] = v * r; pos[i * 3 + 2] = Math.sin(u) * Math.sqrt(1 - v * v) * r;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xbfd0ff, size: 0.9, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.7 })));
  }

  private buildCourt() {
    const surround = new THREE.Mesh(new THREE.PlaneGeometry(90, 110), new THREE.MeshStandardMaterial({ color: 0x0d2a3f, roughness: 0.9, metalness: 0.05 }));
    surround.rotation.x = -Math.PI / 2; this.scene.add(surround);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry((COURT.halfW + 3.2) * 2, (COURT.halfL + 5) * 2), new THREE.MeshStandardMaterial({ color: 0x1a7a5c, roughness: 0.75, metalness: 0.05 }));
    apron.rotation.x = -Math.PI / 2; apron.position.y = 0.005; this.scene.add(apron);
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(COURT.halfW * 2, COURT.halfL * 2), new THREE.MeshStandardMaterial({ color: 0x2a5fae, roughness: 0.7, metalness: 0.05 }));
    inner.rotation.x = -Math.PI / 2; inner.position.y = 0.01; this.scene.add(inner);
    const lineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.95, 1.0) });
    const line = (w: number, l: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat);
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, z); this.scene.add(m);
    };
    const lw = 0.1, W = COURT.halfW, L = COURT.halfL, S = L * 0.54; // garis servis
    line(W * 2 + lw, lw, 0, L); line(W * 2 + lw, lw, 0, -L);   // baseline
    line(lw, L * 2, -W, 0); line(lw, L * 2, W, 0);              // sideline
    line(W * 2, lw, 0, S); line(W * 2, lw, 0, -S);              // garis servis
    line(lw, S * 2, 0, 0);                                       // garis tengah
  }

  private buildNet() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d')!; g.strokeStyle = 'rgba(235,245,255,.85)'; g.lineWidth = 2;
    for (let x = 0; x <= 256; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 64); g.stroke(); }
    for (let y = 0; y <= 64; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(2, 1);
    const half = COURT.halfW + 0.6;
    const net = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, COURT.netH), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, color: new THREE.Color(0.9, 0.95, 1) }));
    net.position.set(0, COURT.netH / 2, 0); this.scene.add(net);
    const band = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.07, 0.04), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.3, 1.3) }));
    band.position.set(0, COURT.netH, 0); this.scene.add(band);
    for (const x of [-half, half]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, COURT.netH + 0.15, 10), new THREE.MeshStandardMaterial({ color: 0x20263a, metalness: 0.8, roughness: 0.3 }));
      post.position.set(x, (COURT.netH + 0.15) / 2, 0); this.scene.add(post);
    }
  }

  private buildStadium() {
    // tribun gelap di belakang baseline dan samping, dengan "penonton" titik berwarna redup
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0b1024, roughness: 0.9 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(60, 9, 2), wallMat); back.position.set(0, 4.5, -COURT.halfL - 8); this.scene.add(back);
    const front = new THREE.Mesh(new THREE.BoxGeometry(60, 9, 2), wallMat); front.position.set(0, 4.5, COURT.halfL + 9); this.scene.add(front);
    for (const x of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(2, 9, 70), wallMat); w.position.set(x * 16, 4.5, 0); this.scene.add(w); }
    const n = 700, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const tint = [0xff3fa4, 0x2fe3ff, 0xffc24d, 0x8f5bff, 0xffffff].map(h => new THREE.Color(h));
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * 26; pos[i * 3 + 1] = 1.2 + Math.random() * 6; pos[i * 3 + 2] = -COURT.halfL - 6.9;
      const c = tint[(Math.random() * tint.length) | 0]; const k = 0.25 + Math.random() * 0.5;
      col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.28, vertexColors: true, sizeAttenuation: true })));
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x8aa4ff, 0x10182e, 0.3));
    for (const [x, z] of [[-13, -9], [13, -9], [-13, 9], [13, 9]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 13, 8), new THREE.MeshStandardMaterial({ color: 0x1c2240, metalness: 0.7, roughness: 0.4 }));
      pole.position.set(x, 6.5, z); this.scene.add(pole);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.8, 1.7) }));
      panel.position.set(x, 13.2, z); panel.lookAt(0, 0, 0); this.scene.add(panel); this.lights.push(panel);
      const s = new THREE.SpotLight(0xdbe7ff, 130, 60, 0.55, 0.6, 1.4);
      s.position.set(x, 13, z); s.target.position.set(0, 0, 0); this.scene.add(s, s.target);
    }
  }
}

/* ---------- raket (bingkai hijau, gagang biru) ---------- */
export const RACKET_HEAD_Y = 0.46;
export class Racket {
  readonly group = new THREE.Group();
  private frame: THREE.Mesh;
  private energy = 0;

  constructor(scene: THREE.Scene, scale: number) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.27, 14), new THREE.MeshStandardMaterial({ color: 0x1f4bff, emissive: 0x0a1f88, emissiveIntensity: 0.9, roughness: 0.5 }));
    handle.position.y = 0.04; this.group.add(handle);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.02), new THREE.MeshStandardMaterial({ color: 0xcfd8ee, metalness: 1, roughness: 0.25 }));
    shaft.position.y = 0.26; this.group.add(shaft);
    this.frame = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.014, 8, 48), new THREE.MeshBasicMaterial({ color: FRAME }));
    this.frame.scale.set(0.82, 1, 1); this.frame.position.y = RACKET_HEAD_Y; this.group.add(this.frame);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!; g.strokeStyle = 'rgba(190,255,230,.9)'; g.lineWidth = 2;
    for (let i = 0; i <= 128; i += 14) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
    const strings = new THREE.Mesh(new THREE.CircleGeometry(0.155, 32), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    strings.scale.set(0.82, 1, 1); strings.position.y = RACKET_HEAD_Y; this.group.add(strings);
    this.group.scale.setScalar(scale);
    this.group.visible = false;
    scene.add(this.group);
  }

  update(pos: THREE.Vector3, quat: THREE.Quaternion, speed01: number, dt: number, visible: boolean, snap: boolean) {
    this.group.visible = visible;
    if (!visible) return;
    const k = snap ? 1 : 1 - Math.exp(-dt * 40);
    this.group.position.lerp(pos, k); this.group.quaternion.slerp(quat, k);
    this.energy += (speed01 - this.energy) * Math.min(1, dt * 10);
    (this.frame.material as THREE.MeshBasicMaterial).color.setRGB(FRAME.r * (1 + this.energy * 0.8), FRAME.g * (1 + this.energy * 0.8), FRAME.b * (1 + this.energy * 0.8));
  }

  /** ruas kepala raket (pangkal kepala -> puncak) dalam koordinat game. */
  headSegment(): { a: THREE.Vector3; b: THREE.Vector3 } {
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(this.group.quaternion);
    const s = this.group.scale.x;
    return { a: this.group.position.clone().addScaledVector(dir, 0.3 * s), b: this.group.position.clone().addScaledVector(dir, 0.62 * s) };
  }
}

/* ---------- bola ---------- */
export class BallMesh {
  readonly mesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 20, 14),
    new THREE.MeshStandardMaterial({ color: 0xd8ff3a, emissive: 0xb6ff1a, emissiveIntensity: 0.7, roughness: 0.55 }),
  );
  readonly shadow = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
  constructor(scene: THREE.Scene) {
    this.mesh.visible = false; this.shadow.rotation.x = -Math.PI / 2; this.shadow.visible = false;
    scene.add(this.mesh, this.shadow);
  }
  set(x: number, y: number, z: number, visible = true) {
    this.mesh.visible = visible; this.shadow.visible = visible;
    this.mesh.position.set(x, y, z);
    this.shadow.position.set(x, 0.03, z);
    const s = Math.max(0.35, 1 - y * 0.12); this.shadow.scale.setScalar(s);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.5 * s;
  }
}

/* ---------- lawan ---------- */
export class Opponent {
  readonly group = new THREE.Group();
  x = 0;
  targetX = 0;
  private arm = new THREE.Group();
  private swing = 0;
  private body: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff3fa4, emissive: 0xff3fa4, emissiveIntensity: 0.25, roughness: 0.5 });
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.75, 6, 14), bodyMat); this.body.position.y = 1.15; this.group.add(this.body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), new THREE.MeshStandardMaterial({ color: 0xf2c6a0, roughness: 0.6 })); head.position.y = 1.95; this.group.add(head);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.235, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2fe3ff, emissive: 0x2fe3ff, emissiveIntensity: 0.4 })); cap.position.y = 1.98; this.group.add(cap);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x1b2340, roughness: 0.6 });
    for (const sx of [-0.14, 0.14]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.7, 10), legMat); l.position.set(sx, 0.35, 0); this.group.add(l); }
    this.arm.position.set(0.34, 1.5, 0);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.55, 8), bodyMat); upper.position.y = -0.2; this.arm.add(upper);
    const racket = new Racket(new THREE.Scene(), 1.25);
    racket.group.visible = true; racket.group.position.set(0, -0.55, 0); racket.group.rotation.x = Math.PI; // kepala ke bawah-depan saat siap
    this.arm.add(racket.group);
    this.group.add(this.arm);
    this.group.position.z = Z_OPP - 1.1;
    this.group.rotation.y = 0;
    scene.add(this.group);
  }

  hit() { this.swing = 1; }

  update(dt: number, speed: number) {
    const d = this.targetX - this.x;
    const m = Math.sign(d) * Math.min(Math.abs(d), speed * dt);
    this.x += m;
    this.group.position.x = this.x;
    this.group.rotation.z = -m / dt * 0.02;       // condong ke arah lari
    this.swing = Math.max(0, this.swing - dt * 3.2);
    this.arm.rotation.z = -0.4 + Math.sin(this.swing * Math.PI) * 2.2;
    this.arm.rotation.x = Math.sin(this.swing * Math.PI) * 0.8;
    this.body.scale.y = 1 - Math.sin(this.swing * Math.PI) * 0.06;
  }
}

export const HIT_PLANE = Z_HIT;
