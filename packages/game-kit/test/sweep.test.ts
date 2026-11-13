import { describe, expect, it } from 'vitest';
import { bladeSweepVsSphere, cutPlaneNormal, closestOnSegment } from '../src';

const seg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => ({ a: { x: ax, y: ay, z: az }, b: { x: bx, y: by, z: bz } });

describe('game-kit sweep', () => {
  it('hits a target the blade passed through between two frames (no tunneling)', () => {
    // bilah vertikal bergeser 1.2 m ke kanan dalam satu frame; target ada di tengah lintasan
    const prev = seg(-0.6, 0, 0, -0.6, 0.6, 0);
    const cur = seg(0.6, 0, 0, 0.6, 0.6, 0);
    const hit = bladeSweepVsSphere(prev, cur, { x: 0, y: 0.3, z: 0 }, 0.15);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeGreaterThan(0.3); expect(hit!.t).toBeLessThan(0.7);
  });
  it('checking only the current frame would miss it (sanity)', () => {
    const cur = seg(0.6, 0, 0, 0.6, 0.6, 0);
    expect(closestOnSegment(cur, { x: 0, y: 0.3, z: 0 }).dist).toBeGreaterThan(0.15);
  });
  it('misses a target away from the path', () => {
    const prev = seg(-0.6, 0, 0, -0.6, 0.6, 0), cur = seg(0.6, 0, 0, 0.6, 0.6, 0);
    expect(bladeSweepVsSphere(prev, cur, { x: 0, y: 0.3, z: -1 }, 0.15)).toBeNull();
  });
  it('cut plane is perpendicular to blade and swing direction', () => {
    const n = cutPlaneNormal({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(Math.abs(n.z)).toBeCloseTo(1);
  });
});
