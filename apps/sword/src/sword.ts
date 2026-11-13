import * as THREE from 'three';

/**
 * Model pedang prosedural (tanpa aset). Dibangun dalam meter dengan bilah sepanjang +Y dan pusat
 * genggaman di (0,0,0). Warna mengingatkan alat aslinya: gagang biru, ujung hijau menyala.
 */
export const BLADE_START = 0.12;   // m dari genggaman
export const BLADE_LEN = 0.6;      // m

export class Sword {
  readonly group = new THREE.Group();
  private core: THREE.Mesh;
  private tipGlow: THREE.Mesh;
  private energy = 0;

  constructor(scene: THREE.Scene, scale: number) {
    const bladeShape = new THREE.Shape();
    const w = 0.03, L = BLADE_LEN - BLADE_START;
    bladeShape.moveTo(-w, 0); bladeShape.lineTo(w, 0); bladeShape.lineTo(w * 0.85, L * 0.86); bladeShape.lineTo(0, L); bladeShape.lineTo(-w * 0.85, L * 0.86); bladeShape.closePath();
    const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2 });
    bladeGeo.translate(0, BLADE_START, -0.006);
    const steel = new THREE.MeshStandardMaterial({ color: 0xdfe9ff, metalness: 1, roughness: 0.18, envMapIntensity: 1.0 });
    this.group.add(new THREE.Mesh(bladeGeo, steel));

    // inti energi di tengah bilah (dibuat menyala oleh bloom)
    this.core = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, L * 0.92, 0.03),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.0, 1.1) }),
    );
    this.core.position.set(0, BLADE_START + L * 0.47, 0);
    this.group.add(this.core);

    // ujung hijau (cermin penanda hijau di alat asli)
    this.tipGlow = new THREE.Mesh(new THREE.SphereGeometry(0.026, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 0.55) }));
    this.tipGlow.position.set(0, BLADE_LEN, 0);
    this.group.add(this.tipGlow);

    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.022, 0.05), new THREE.MeshStandardMaterial({ color: 0x1b2340, metalness: 0.9, roughness: 0.3 }));
    guard.position.y = BLADE_START - 0.004;
    this.group.add(guard);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 16), new THREE.MeshStandardMaterial({ color: 0x1f4bff, metalness: 0.2, roughness: 0.5, emissive: 0x0a1f88, emissiveIntensity: 0.9 }));
    grip.position.y = -0.04;
    this.group.add(grip);
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 12), new THREE.MeshStandardMaterial({ color: 0x1b2340, metalness: 0.9, roughness: 0.25 }));
    pommel.position.y = -0.13;
    this.group.add(pommel);

    this.group.scale.setScalar(scale);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** energi 0..1: inti dan ujung menyala lebih terang saat ayunan cepat. */
  update(position: THREE.Vector3, quat: THREE.Quaternion, speed01: number, dt: number, visible: boolean, first: boolean) {
    this.group.visible = visible;
    if (!visible) return;
    const k = first ? 1 : 1 - Math.exp(-dt * 40);
    this.group.position.lerp(position, k);
    this.group.quaternion.slerp(quat, k);
    this.energy += (speed01 - this.energy) * Math.min(1, dt * 12);
    const e = 1 + this.energy * 0.9;
    (this.core.material as THREE.MeshBasicMaterial).color.setRGB(0.25 * e, 1.0 * e, 1.1 * e);
    this.tipGlow.scale.setScalar(1 + this.energy * 1.6);
  }

  /** ruas bilah (base, tip) dalam koordinat game. */
  segment(): { a: THREE.Vector3; b: THREE.Vector3; dir: THREE.Vector3 } {
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(this.group.quaternion);
    const s = this.group.scale.x;
    const a = this.group.position.clone().addScaledVector(dir, BLADE_START * s);
    const b = this.group.position.clone().addScaledVector(dir, BLADE_LEN * s);
    return { a, b, dir };
  }
}
