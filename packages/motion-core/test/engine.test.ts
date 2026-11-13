import { describe, expect, it } from 'vitest';
import { MotionEngine, ColorTracker, poseTimeline, defaultConfig, type FrameData, type GestureEvent, type StickPose } from '../src';

const R0: StickPose = { hx: 0.5, hy: 0.62, angleDeg: -90 };

function run(segments: Parameters<typeof poseTimeline>[0], start: StickPose = R0) {
  const eng = new MotionEngine();
  const events: GestureEvent[] = [];
  eng.on('gesture', e => events.push(e));
  for (const o of poseTimeline(segments, start)) eng.pushObservation(o);
  return { eng, events };
}

describe('MotionEngine gestures (synthetic observations)', () => {
  it('slice: stick sweeps over the top, screen-left to screen-right', () => {
    // sudut -45 (kanan-atas) -> -135 (kiri-atas) di gambar; sudah tercermin: ujung bergerak ke kiri layar
    const { events } = run([
      { dur: 1, to: R0, mode: 'hold' },
      { dur: 1, to: { ...R0, angleDeg: -45 }, mode: 'lin' },
      { dur: 0.5, to: { ...R0, angleDeg: -45 }, mode: 'hold' },
      { dur: 0.25, to: { ...R0, angleDeg: -135 }, mode: 'ease' },
      { dur: 1, to: { ...R0, angleDeg: -135 }, mode: 'hold' },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'slice', direction: 'left' });
    expect(events[0].power).toBeGreaterThan(0.5);
  });

  it('chop: tip travels down', () => {
    const base: StickPose = { hx: 0.3, hy: 0.4, angleDeg: -20 };
    const { events } = run([
      { dur: 1, to: base, mode: 'hold' },
      { dur: 0.25, to: { ...base, angleDeg: 50 }, mode: 'ease' },
      { dur: 1, to: { ...base, angleDeg: 50 }, mode: 'hold' },
    ], base);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'chop', direction: 'down' });
  });

  it('diagonal: quarter turn from up to right gives a diagonal', () => {
    const base: StickPose = { hx: 0.4, hy: 0.55, angleDeg: -90 };
    const { events } = run([
      { dur: 1, to: base, mode: 'hold' },
      { dur: 0.25, to: { ...base, angleDeg: 0 }, mode: 'ease' },
      { dur: 1, to: { ...base, angleDeg: 0 }, mode: 'hold' },
    ], base);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('diagonal');
    expect(events[0].direction).toBe('down-right');
  });

  it('thrust toward the camera is detected through handle thickness', () => {
    const { events } = run([
      { dur: 1, to: R0, mode: 'hold' },
      { dur: 0.25, to: { ...R0, hy: 0.6, k: 1.5, c: 0.5 }, mode: 'ease' },
      { dur: 1, to: { ...R0, hy: 0.6, k: 1.5, c: 0.5 }, mode: 'hold' },
    ]);
    expect(events.filter(e => e.depth)).toHaveLength(1);
    expect(events.filter(e => !e.depth)).toHaveLength(0);
  });

  it('slow repositioning does not trigger any gesture', () => {
    const { events } = run([
      { dur: 1, to: R0, mode: 'hold' },
      { dur: 2, to: { hx: 0.3, hy: 0.45, angleDeg: -45 }, mode: 'lin' },
      { dur: 2, to: R0, mode: 'lin' },
    ]);
    expect(events).toHaveLength(0);
  });

  it('record + replay reproduces the same gestures deterministically', () => {
    const a = new MotionEngine();
    a.startRecording();
    const got: string[] = [];
    a.on('gesture', e => got.push(e.kind + ':' + e.direction));
    for (const o of poseTimeline([{ dur: 1, to: R0, mode: 'hold' }, { dur: 0.25, to: { ...R0, angleDeg: -180 }, mode: 'ease' }, { dur: 1, to: R0, mode: 'hold' }], { ...R0, angleDeg: -45 })) a.pushObservation(o);
    const rec = JSON.parse(JSON.stringify(a.stopRecording()));
    const b = new MotionEngine();
    const got2: string[] = [];
    b.on('gesture', e => got2.push(e.kind + ':' + e.direction));
    b.replay(rec);
    expect(got2).toEqual(got);
    expect(got.length).toBeGreaterThan(0);
  });

  it('reports world pose: pointing up gives a +Y direction and identity-ish quaternion', () => {
    const eng = new MotionEngine();
    let last = eng.pose;
    for (const o of poseTimeline([{ dur: 0.5, to: R0, mode: 'hold' }], R0)) last = eng.pushObservation(o) ?? last;
    expect(last).not.toBeNull();
    expect(last!.world.direction.y).toBeGreaterThan(0.95);
    expect(last!.world.quaternion[3]).toBeGreaterThan(0.99);
  });
});

describe('ColorTracker', () => {
  const W = 160, H = 120;
  function frameWith(rects: { x: number; y: number; w: number; h: number; rgb: [number, number, number] }[]): FrameData {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { data[i * 4] = 150; data[i * 4 + 1] = 90; data[i * 4 + 2] = 70; data[i * 4 + 3] = 255; } // meja kayu
    for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const p = (y * W + x) * 4; data[p] = r.rgb[0]; data[p + 1] = r.rgb[1]; data[p + 2] = r.rgb[2];
    }
    return { data, width: W, height: H, t: 0 };
  }

  it('finds green tip and blue handle on a wooden background', () => {
    const t = new ColorTracker(defaultConfig().tracker);
    const o = t.process(frameWith([
      { x: 20, y: 20, w: 12, h: 10, rgb: [70, 225, 90] },
      { x: 100, y: 70, w: 8, h: 30, rgb: [30, 70, 220] },
    ]));
    expect(o.tip).not.toBeNull(); expect(o.handle).not.toBeNull();
    expect(o.tip!.x * W).toBeCloseTo(26, 0); expect(o.tip!.y * W).toBeCloseTo(25, 0);
    expect(o.handle!.x * W).toBeCloseTo(104, 0); expect(o.handle!.y * W).toBeCloseTo(85, 0);
    expect(o.handle!.minor).toBeLessThan(o.handle!.major);
  });

  it('returns null when markers are absent', () => {
    const t = new ColorTracker(defaultConfig().tracker);
    const o = t.process(frameWith([]));
    expect(o.tip).toBeNull(); expect(o.handle).toBeNull();
  });

  it('samples a color profile from a click', () => {
    const f = frameWith([{ x: 10, y: 10, w: 20, h: 20, rgb: [220, 60, 40] }]);
    const p = ColorTracker.sampleProfile(f, 20 / (W - 1), 20 / (H - 1));
    expect(p).not.toBeNull();
    expect(p!.h).toBeLessThan(15);
  });
});
