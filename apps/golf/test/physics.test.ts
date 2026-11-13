import { describe, expect, it } from 'vitest';
import { HOLES } from '../src/holes';
import { CUP_R, DRIVER, IRON, PUTTER, WEDGE, azimuthTo, chooseClub, distTo, flightPos, planFullShot, planPutt, simulateRoll, surfaceAt, type ShotInput } from '../src/physics';

const h1 = HOLES[0], h2 = HOLES[1], h3 = HOLES[2];
const rng0 = () => 0.5; // gauss(0.5,0.5) = sqrt(-2 ln .5)*cos(pi) = -1.18; dipakai hanya bila sigma > 0
const base = (over: Partial<ShotInput> = {}): ShotInput => ({ club: DRIVER, power: 1, quality: 1, leanDeg: 0, pathAngleDeg: 0, aimDeg: 0, lie: 'fairway', wind: 0, ...over });

describe('golf surfaces', () => {
  it('classifies the key places on the holes', () => {
    expect(surfaceAt(h1, h1.pin)).toBe('green');
    expect(surfaceAt(h1, { x: 0, z: -60 })).toBe('fairway');
    expect(surfaceAt(h1, { x: 25, z: -60 })).toBe('rough');
    expect(surfaceAt(h1, { x: h1.bunkers[0].x, z: h1.bunkers[0].z })).toBe('sand');
    expect(surfaceAt(h2, { x: h2.water[0].x, z: h2.water[0].z })).toBe('water');
    expect(surfaceAt(h1, { x: 0, z: 0 })).toBe('tee');
  });
  it('picks a sensible club from the distance', () => {
    expect(chooseClub(h1, { x: 0, z: 0 }, 'tee')).toBe(IRON);        // par 3 ~128 m
    expect(chooseClub(h2, { x: 0, z: 0 }, 'tee')).toBe(DRIVER);
    expect(chooseClub(h1, { x: 0, z: -110 }, 'fairway')).toBe(WEDGE);
    expect(chooseClub(h1, { x: 3, z: -125 }, 'green')).toBe(PUTTER);
    expect(chooseClub(h1, { x: -14, z: -122 }, 'sand')).toBe(WEDGE);
  });
});

describe('golf full shots', () => {
  it('a full driver swing carries ~the club maximum, straight, with no randomness at quality 1', () => {
    const p = planFullShot(h2, { x: 0, z: 0 }, base({ aimDeg: 0 }), rng0);
    expect(p.carry).toBeGreaterThan(225); expect(p.carry).toBeLessThan(240);
    expect(Math.abs(p.landing.x)).toBeLessThan(0.5);
    expect(p.landing.z).toBeLessThan(-220);
    expect(p.T).toBeGreaterThan(4); expect(p.T).toBeLessThan(9); expect(p.apex).toBeGreaterThan(15); expect(p.apex).toBeLessThan(45);
  });
  it('shot distance scales with swing power', () => {
    const d = (pw: number) => planFullShot(h2, { x: 0, z: 0 }, base({ power: pw }), rng0).carry;
    expect(d(0.5)).toBeCloseTo(115, 0);
    expect(d(0.5)).toBeLessThan(d(0.8)); expect(d(0.8)).toBeLessThan(d(1));
  });
  it('tilting the stick curves the ball; right lean goes right, left lean goes left', () => {
    const right = planFullShot(h2, { x: 0, z: 0 }, base({ leanDeg: 15 }), rng0);
    const left = planFullShot(h2, { x: 0, z: 0 }, base({ leanDeg: -15 }), rng0);
    expect(right.landing.x).toBeGreaterThan(right.carry * 0.02 + 0);
    expect(left.landing.x).toBeLessThan(-left.carry * 0.02);
  });
  it('wind pushes the ball sideways; positive wind drifts right', () => {
    const calm = planFullShot(h2, { x: 0, z: 0 }, base(), rng0), windy = planFullShot(h2, { x: 0, z: 0 }, base({ wind: 4 }), rng0);
    expect(windy.landing.x).toBeGreaterThan(calm.landing.x + 5);
  });
  it('poor swing quality widens the dispersion', () => {
    const spread = (q: number) => { const xs = Array.from({ length: 300 }, () => planFullShot(h2, { x: 0, z: 0 }, base({ quality: q })).landing.x); const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
    expect(spread(0.1)).toBeGreaterThan(spread(1) + 4);
  });
  it('over-swinging adds error and rough lies shorten the shot', () => {
    const fw = planFullShot(h2, { x: 0, z: 0 }, base({ lie: 'fairway' }), rng0).carry, rough = planFullShot(h2, { x: 0, z: 0 }, base({ lie: 'rough' }), rng0).carry;
    expect(rough).toBeLessThan(fw * 0.9);
  });
  it('a ball that lands in water is a penalty and does not roll', () => {
    const w = h3.water[0];
    const target = { x: w.x, z: w.z };
    const az = azimuthTo({ x: 0, z: 0 }, target);
    const dd = distTo({ x: 0, z: 0 }, target);
    const p = planFullShot(h3, { x: 0, z: 0 }, base({ power: dd / DRIVER.max / 1.02, aimDeg: az, lie: 'tee' }), rng0);
    expect(surfaceAt(h3, p.landing)).toBe('water');
    expect(p.penalty).toBe(true);
    expect(p.roll).toHaveLength(1);
  });
  it('flightPos starts on the ball, peaks at apex and lands at the landing point', () => {
    const p = planFullShot(h2, { x: 0, z: 0 }, base(), rng0);
    const a = flightPos(p, 0), m = flightPos(p, p.T / 2), e = flightPos(p, p.T);
    expect(a.y).toBeCloseTo(0, 5); expect(e.y).toBeCloseTo(0, 3);
    expect(m.y).toBeGreaterThan(p.apex * 0.98);
    expect(e.x).toBeCloseTo(p.landing.x, 3); expect(e.z).toBeCloseTo(p.landing.z, 3);
  });
  it('roll after a driver shot on the fairway is 15-45 m, and sand stops the ball at once', () => {
    const p = planFullShot(h3, { x: 0, z: 0 }, base({ lie: 'tee' }), rng0);   // lubang 3 lurus
    expect(surfaceAt(h3, p.landing)).toBe('fairway');
    const rolled = distTo(p.landing, p.final);
    expect(rolled).toBeGreaterThan(10); expect(rolled).toBeLessThan(50);
    // dari green bergulir ke kiri menuju bunker: berhenti begitu masuk pasir
    const s = simulateRoll(h1, { x: -2, z: -122 }, { x: -1, z: 0 }, 5);
    expect(s.surface).toBe('sand'); expect(s.final.x).toBeGreaterThan(-12);
  });
});

describe('putting', () => {
  it('a putt with the right speed drops in the cup; too hard or too soft does not', () => {
    const ball = { x: h1.pin.x, z: h1.pin.z + 6 };
    const az = azimuthTo(ball, h1.pin);
    // jarak = v^2/(2*1.6) => v = sqrt(2*1.6*6)=4.38 ; peakSpeed = v/1.7
    const ok = planPutt(h1, ball, Math.sqrt(2 * 1.6 * 6.3) / 1.7, 1, 0, az, rng0);
    expect(ok.holed).toBe(true);
    const soft = planPutt(h1, ball, 1.0, 1, 0, az, rng0);
    expect(soft.holed).toBe(false); expect(distTo(soft.final, h1.pin)).toBeGreaterThan(CUP_R);
    const hard = planPutt(h1, ball, 6, 1, 0, az, rng0);
    expect(hard.holed).toBe(false);
  });
});

describe('lean deadband', () => {
  it('ignores small tilts caused by blur/sampling and curves only beyond the dead zone', async () => {
    const { effectiveLean, LEAN_DEADBAND } = await import('../src/physics');
    expect(effectiveLean(5)).toBe(0); expect(effectiveLean(-LEAN_DEADBAND)).toBe(0);
    expect(effectiveLean(16)).toBe(16 - LEAN_DEADBAND); expect(effectiveLean(-16)).toBe(-(16 - LEAN_DEADBAND));
    const small = planFullShot(h2, { x: 0, z: 0 }, base({ leanDeg: -5 }), rng0), tilted = planFullShot(h2, { x: 0, z: 0 }, base({ leanDeg: -20 }), rng0);
    expect(small.curve).toBe(0);
    expect(tilted.curve).toBeLessThan(-20);
  });
});

describe('suggestedPower', () => {
  it('suggests a percentage of full power for full shots and a swing speed for putts', async () => {
    const { suggestedPower } = await import('../src/physics');
    const s = suggestedPower(IRON, 'fairway', 75);
    expect(s.kind).toBe('pct'); expect(s.value).toBeCloseTo(50, 0);
    const p = suggestedPower(PUTTER, 'green', 6);
    expect(p.kind).toBe('lps'); expect(p.value).toBeGreaterThan(1.5); expect(p.value).toBeLessThan(4);
    // putt yang disarankan memang masuk
    const ball = { x: h1.pin.x, z: h1.pin.z + 6 };
    const plan = planPutt(h1, ball, p.value, 1, 0, azimuthTo(ball, h1.pin), () => 0.5);
    expect(plan.holed).toBe(true);
  });
});
