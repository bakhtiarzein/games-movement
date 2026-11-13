import * as THREE from 'three';
import { FLOOR_Y, Z_BASE } from './stage';
import type { Particles } from './fx';

export type TargetKind = 'orb' | 'bomb';

export interface Target {
  kind: TargetKind;
  group: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  color: THREE.Color;
  spin: THREE.Vector3;
  alive: boolean;
  age: number;
}

interface Half { mesh: THREE.Group; vel: THREE.Vector3; spin: THREE.Vector3; life: number }

const PALETTE = [0xff3fa4, 0x2fe3ff, 0x8f5bff, 0xffc24d, 0x46e07a];
const G = 9.5;

export class Targets {
  readonly items: Target[] = [];
  private halves: Half[] = [];
  private timer = 0.8;
  elapsed = 0;
  private halfGeo = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  private capGeo = new THREE.CircleGeometry(1, 28);
  private orbGeo = new THREE.IcosahedronGeometry(1, 2);
  private bombGeo = new THREE.IcosahedronGeometry(1, 1);
  private ringGeo = new THREE.TorusGeometry(1.35, 0.035, 8, 40);

  constructor(private scene: THREE.Scene, private fx: Particles) {}

  reset() {
    for (const t of this.items) this.scene.remove(t.group);
    for (const h of this.halves) this.scene.remove(h.mesh);
    this.items.length = 0; this.halves.length = 0; this.timer = 0.8; this.elapsed = 0;
  }

  /** peluang bom naik pelan seiring waktu. */
  private spawn() {
    const bomb = Math.random() < Math.min(0.28, 0.1 + this.elapsed * 0.002);
    const r = bomb ? 0.5 : 0.42 + Math.random() * 0.14;
    const x0 = (Math.random() * 2 - 1) * 3.4;
    const pos = new THREE.Vector3(x0, FLOOR_Y - 0.8, Z_BASE + (Math.random() * 0.9 - 0.6));
    const apex = 1.6 + Math.random() * 2.4 + 1.2;
    const vy = Math.sqrt(2 * G * (apex - pos.y));
    const vel = new THREE.Vector3(-x0 * (0.06 + Math.random() * 0.16) + (Math.random() - 0.5) * 0.8, vy, 0);
    const color = new THREE.Color(bomb ? 0xff2b2b : PALETTE[(Math.random() * PALETTE.length) | 0]);
    const group = new THREE.Group();
    if (bomb) {
      const m = new THREE.Mesh(this.bombGeo, new THREE.MeshStandardMaterial({ color: 0x1a0a0a, emissive: 0xff1a1a, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.6, flatShading: true }));
      group.add(m);
    } else {
      const m = new THREE.Mesh(this.orbGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.1, envMapIntensity: 0.4 }));
      group.add(m);
      const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.2), transparent: true, opacity: 0.5 }));
      ring.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.8;
      group.add(ring);
    }
    group.scale.setScalar(r);
    group.position.copy(pos);
    this.scene.add(group);
    this.items.push({ kind: bomb ? 'bomb' : 'orb', group, pos, vel, radius: r, color, spin: new THREE.Vector3(Math.random() * 3, Math.random() * 3, Math.random() * 3), alive: true, age: 0 });
  }

  /** @returns jumlah orb yang jatuh tanpa terpotong pada frame ini. */
  update(dt: number, playing: boolean): number {
    let missed = 0;
    this.elapsed += dt;
    if (playing) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.spawn();
        if (Math.random() < 0.25) this.spawn();
        this.timer = Math.max(0.45, 1.05 - this.elapsed * 0.008) * (0.7 + Math.random() * 0.6);
      }
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const t = this.items[i];
      t.age += dt;
      t.vel.y -= G * dt;
      t.pos.addScaledVector(t.vel, dt);
      t.group.position.copy(t.pos);
      t.group.rotation.x += t.spin.x * dt; t.group.rotation.y += t.spin.y * dt;
      if (t.kind === 'bomb') (t.group.children[0] as THREE.Mesh).scale.setScalar(1 + Math.sin(t.age * 14) * 0.05);
      if (t.pos.y < FLOOR_Y - 1.4 && t.vel.y < 0) {
        if (t.kind === 'orb' && t.alive) missed++;
        this.remove(i);
      }
    }
    for (let i = this.halves.length - 1; i >= 0; i--) {
      const h = this.halves[i];
      h.life -= dt; h.vel.y -= G * dt;
      h.mesh.position.addScaledVector(h.vel, dt);
      h.mesh.rotation.x += h.spin.x * dt; h.mesh.rotation.z += h.spin.z * dt;
      const s = Math.min(1, Math.max(0, h.life / 0.4));
      h.mesh.scale.setScalar(h.mesh.userData.r * (0.4 + 0.6 * s));
      if (h.life <= 0) { this.scene.remove(h.mesh); this.halves.splice(i, 1); }
    }
    return missed;
  }

  private remove(i: number) { this.scene.remove(this.items[i].group); this.items.splice(i, 1); }
  removeTarget(t: Target) { const i = this.items.indexOf(t); if (i >= 0) this.remove(i); }

  /** Belah orb menjadi dua belahan bercahaya di sepanjang garis tebasan (n = normal bidang potong). */
  slice(t: Target, n: THREE.Vector3, swing: THREE.Vector3, power: number) {
    t.alive = false;
    this.removeTarget(t);
    for (const sgn of [1, -1]) {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: t.color, emissive: t.color, emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.1, envMapIntensity: 0.4, side: THREE.DoubleSide });
      g.add(new THREE.Mesh(this.halfGeo, mat));
      const cap = new THREE.Mesh(this.capGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.15, 1.15, 1.15).lerp(t.color, 0.4), side: THREE.DoubleSide }));
      cap.rotation.x = -Math.PI / 2;
      g.add(cap);
      const dir = n.clone().multiplyScalar(sgn);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.position.copy(t.pos);
      g.userData.r = t.radius;
      g.scale.setScalar(t.radius);
      this.scene.add(g);
      const vel = t.vel.clone().multiplyScalar(0.5).addScaledVector(dir, 1.6 + 2.2 * power).addScaledVector(swing, 1.2 + 2 * power);
      this.halves.push({ mesh: g, vel, spin: new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6), life: 1.3 });
    }
    this.fx.burst(t.pos, t.color.clone().multiplyScalar(1.1), 26 + Math.round(power * 20), 4 + power * 3, swing.clone().multiplyScalar(0.8), 1);
    this.fx.burst(t.pos, new THREE.Color(1.2, 1.2, 1.2), 8, 2.2);
  }

  explodeBomb(t: Target) {
    this.removeTarget(t);
    this.fx.burst(t.pos, new THREE.Color(1.5, 0.35, 0.2), 60, 7);
    this.fx.burst(t.pos, new THREE.Color(1.2, 0.9, 0.5), 20, 3);
  }
}
