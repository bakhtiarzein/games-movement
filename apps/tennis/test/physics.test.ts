import { describe, expect, it } from 'vitest';
import { BALL_R, COURT, Z_HIT, Z_OPP, cloneBall, heightAtNet, inCourt, planShot, predictAtPlane, solveLaunch, stepBall, type Ball } from '../src/physics';

const from = (x = 0) => ({ x, y: 1.0, z: Z_OPP });

describe('tennis physics', () => {
  it('solveLaunch lands exactly on the target (first bounce)', () => {
    const t = { x: 2, z: 5 };
    const v = solveLaunch(from(-1), t.x, t.z, 1.4);
    const b: Ball = { ...from(-1), ...v };
    const cnt = { player: 0, opp: 0 };
    let bounce: { x: number; z: number } | null = null;
    for (let i = 0; i < 600 && !bounce; i++) for (const e of stepBall(b, 1 / 240, cnt)) if (e.type === 'bounce') bounce = e;
    expect(bounce).not.toBeNull();
    expect(bounce!.x).toBeCloseTo(t.x, 1); expect(bounce!.z).toBeCloseTo(t.z, 1);
  });

  it('planShot raises the arc until the ball clears the net', () => {
    // pukulan datar dan pendek dari baseline pemain ke dekat net lawan: harus dinaikkan
    const f = { x: 0, y: 0.8, z: Z_HIT };
    const p = planShot(f, 0, -3, 0.6);
    expect(p).not.toBeNull();
    expect(p!.netClear).toBeGreaterThanOrEqual(COURT.netH + BALL_R);
    expect(p!.T).toBeGreaterThan(0.6);
  });

  it('a ball that hits the net stops', () => {
    const b: Ball = { x: 0, y: 0.5, z: 2, vx: 0, vy: 0, vz: -10 };
    let hit = false;
    for (let i = 0; i < 100 && !hit; i++) hit = stepBall(b, 1 / 120).some(e => e.type === 'net');
    expect(hit).toBe(true);
  });

  it('serves land in the player court and reach the hitting plane at a hittable height', () => {
    // lawan melepas bola ke pemain: pantulan di z 3.5..6.5, x -3.4..3.4, waktu terbang 1.3..1.8
    const heights: number[] = [];
    for (const bz of [3.5, 4.5, 5.5, 6.5]) for (const bx of [-3.4, 0, 3.4]) for (const T of [1.3, 1.6, 1.8]) {
      const f = from(bx * -0.3);
      const v = solveLaunch(f, bx, bz, T);
      expect(heightAtNet(f, v)).toBeGreaterThan(COURT.netH + BALL_R); // melewati net
      const ball: Ball = { ...f, ...v };
      const a = predictAtPlane(ball, Z_HIT);
      expect(a, `bz=${bz} bx=${bx} T=${T}`).not.toBeNull();
      expect(a!.bounces).toBe(1);
      heights.push(a!.y);
    }
    console.log('arrival heights at Z_HIT: min %s max %s', Math.min(...heights).toFixed(2), Math.max(...heights).toFixed(2));
    expect(Math.min(...heights)).toBeGreaterThan(0.2);
    expect(Math.max(...heights)).toBeLessThan(2.8);
  });

  it('inCourt respects the lines', () => {
    expect(inCourt(0, -5, 'opp')).toBe(true);
    expect(inCourt(4.5, -5, 'opp')).toBe(false);
    expect(inCourt(0, -11, 'opp')).toBe(false);
    expect(inCourt(0, 5, 'opp')).toBe(false);
  });

  it('cloneBall is independent', () => { const a: Ball = { x: 1, y: 1, z: 1, vx: 0, vy: 0, vz: 0 }; const b = cloneBall(a); b.x = 5; expect(a.x).toBe(1); });
});
