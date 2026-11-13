import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Konstanta ruang game. Pose dunia (meter) dipetakan ke sini oleh `toGame` di main.ts. */
export const SCALE = 5.5;          // 1 m pemain = 5.5 unit game
export const Z_BASE = -2.2;        // bidang tempat pedang dan target bermain
export const Z_DEPTH_GAIN = 0.6;   // seberapa kuat kedalaman pemain tampak di game
export const FLOOR_Y = -2.1;
export const Y_CENTER = 1.2;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private baseCam = new THREE.Vector3(0, 1.2, 4);
  private shake = 0;
  private lights: THREE.PointLight[] = [];
  private t = 0;
  private moon: THREE.Sprite;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    this.camera.position.copy(this.baseCam);
    this.camera.lookAt(0, Y_CENTER, Z_BASE);

    this.scene.background = new THREE.Color(0x070914);
    this.scene.fog = new THREE.FogExp2(0x0a0c1e, 0.02);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.22;

    this.buildSky();
    this.buildFloor();
    this.buildLights();
    this.moon = this.buildMoon();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || innerWidth, h = this.container.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // jaga medan pandang horizontal tetap terlihat di layar sempit
    this.camera.fov = w / h < 1.4 ? 55 + (1.4 - w / h) * 22 : 55;
    this.camera.updateProjectionMatrix();
  }

  addShake(a: number) { this.shake = Math.min(1, this.shake + a); }

  private buildSky() {
    const geo = new THREE.SphereGeometry(120, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x0b0724) }, mid: { value: new THREE.Color(0x3b1259) }, bot: { value: new THREE.Color(0x070914) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
        void main(){ float h = vP.y; vec3 c = h > 0. ? mix(mid, top, smoothstep(0., .75, h)) : mix(mid, bot, smoothstep(0., -.25, h)); gl_FragColor = vec4(c, 1.); }`,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
    // bintang
    const n = 500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2, v = Math.random() * 0.9 + 0.05, r = 110;
      pos[i * 3] = Math.cos(u) * Math.sqrt(1 - v * v) * r; pos[i * 3 + 1] = v * r; pos[i * 3 + 2] = Math.sin(u) * Math.sqrt(1 - v * v) * r - 20;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xbfd0ff, size: 0.6, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.8 })));
  }

  /** matahari ala synthwave: cakram gradasi dengan garis-garis horizontal di separuh bawah. */
  private buildMoon() {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d')!;
    const halo = g.createRadialGradient(256, 256, 120, 256, 256, 256);
    halo.addColorStop(0, 'rgba(255,80,170,.35)'); halo.addColorStop(1, 'rgba(255,80,170,0)');
    g.fillStyle = halo; g.fillRect(0, 0, 512, 512);
    const sun = g.createLinearGradient(0, 106, 0, 406);
    sun.addColorStop(0, '#ffd54d'); sun.addColorStop(0.55, '#ff4fa8'); sun.addColorStop(1, '#8f3bff');
    g.save(); g.beginPath(); g.arc(256, 256, 150, 0, Math.PI * 2); g.clip();
    g.fillStyle = sun; g.fillRect(0, 0, 512, 512);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) { const y = 270 + i * 20; g.fillRect(0, y, 512, 3 + i * 1.6); }
    g.restore();
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), fog: false, transparent: true, depthWrite: false, color: new THREE.Color(1.05, 1.05, 1.05) }));
    m.position.set(0, 9, -75); m.scale.set(70, 70, 1);
    this.scene.add(m);
    return m;
  }

  private buildFloor() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshStandardMaterial({ color: 0x080a1a, roughness: 0.5, metalness: 0.5 }),
    );
    floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR_Y;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(120, 60, 0x6a9dff, 0x2a3f8a);
    grid.position.y = FLOOR_Y + 0.01;
    (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.9;
    this.scene.add(grid);
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x7c96ff, 0x1a0b2a, 0.35));
    const key = new THREE.DirectionalLight(0xcfdcff, 0.9); key.position.set(3, 7, 5); this.scene.add(key);
    const a = new THREE.PointLight(0xff3fa4, 28, 20, 1.6); a.position.set(-5, 1.5, Z_BASE + 1); this.scene.add(a);
    const b = new THREE.PointLight(0x2fe3ff, 28, 20, 1.6); b.position.set(5, 1.5, Z_BASE + 1); this.scene.add(b);
    this.lights.push(a, b);
  }

  /** Cahaya warna ikut berkedip kecil saat ada tebasan. */
  pulse(color: number) { this.lights.forEach(l => l.color.lerp(new THREE.Color(color), 0.5)); this.bloom.strength = 0.95; }

  render(dt: number) {
    this.t += dt;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const s = this.shake * this.shake * 0.12;
    this.camera.position.set(this.baseCam.x + (Math.random() - 0.5) * s, this.baseCam.y + (Math.random() - 0.5) * s, this.baseCam.z);
    this.bloom.strength += (0.55 - this.bloom.strength) * Math.min(1, dt * 4);
    const l0 = this.lights[0], l1 = this.lights[1];
    l0.color.lerp(new THREE.Color(0xff3fa4), dt * 2); l1.color.lerp(new THREE.Color(0x2fe3ff), dt * 2);
    l0.position.x = -5 + Math.sin(this.t * 0.6) * 0.8; l1.position.x = 5 + Math.cos(this.t * 0.5) * 0.8;
    this.moon.scale.setScalar(70 * (1 + Math.sin(this.t * 0.4) * 0.015));
    this.composer.render();
  }
}
