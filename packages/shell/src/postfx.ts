import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export interface PostFXOptions {
  exposure?: number;
  bloom?: { strength: number; radius: number; threshold: number };
}

/** Renderer + tone mapping + bloom, dipakai semua game agar tampilannya konsisten. */
export class PostFX {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  baseStrength: number;

  constructor(private container: HTMLElement, scene: THREE.Scene, private camera: THREE.PerspectiveCamera, opts: PostFXOptions = {}) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = opts.exposure ?? 0.8;
    container.appendChild(this.renderer.domElement);
    const b = opts.bloom ?? { strength: 0.55, radius: 0.5, threshold: 0.9 };
    this.baseStrength = b.strength;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), b.strength, b.radius, b.threshold);
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
    this.camera.fov = w / h < 1.4 ? 55 + (1.4 - w / h) * 22 : 55; // jaga medan pandang di layar sempit
    this.camera.updateProjectionMatrix();
  }

  /** lonjakan bloom sesaat (tebasan, pukulan). */
  kick(strength: number) { this.bloom.strength = Math.max(this.bloom.strength, strength); }

  render(dt: number) {
    this.bloom.strength += (this.baseStrength - this.bloom.strength) * Math.min(1, dt * 4);
    this.composer.render();
  }
}
