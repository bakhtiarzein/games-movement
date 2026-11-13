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

import { analyzeSwing, syntheticObservation, type SwingTrace } from '../src';

/** ayunan golf tampak depan: tongkat menggantung, backswing lambat ke kiri-atas, downswing cepat melewati dasar. */
function golfSwing(opts: { back?: number; down?: number; pitchOut?: boolean } = {}) {
  const base: StickPose = { hx: 0.5, hy: 0.3, angleDeg: 90 };
  const back = opts.back ?? 0.9, down = opts.down ?? 0.3;
  const eng = new MotionEngine();
  const traces: SwingTrace[] = [];
  eng.on('trace', t => traces.push(t));
  const c = opts.pitchOut ? 0.6 : 1;
  for (const o of poseTimeline([
    { dur: 1.0, to: base, mode: 'hold' },
    { dur: back, to: { ...base, angleDeg: 215, c }, mode: 'ease' },   // backswing: ke kiri-atas
    { dur: 0.08, to: { ...base, angleDeg: 215, c }, mode: 'hold' },
    { dur: down * 0.9, to: { ...base, angleDeg: 90, c }, mode: 'in' },   // downswing: mempercepat sampai dasar busur (90)
    { dur: down * 0.7, to: { ...base, angleDeg: -30, c: 1 }, mode: 'out' }, // follow-through: melambat
    { dur: 1.2, to: { ...base, angleDeg: -30, c: 1 }, mode: 'hold' },
  ], base)) eng.pushObservation(o);
  return traces;
}

describe('TraceRecorder + analyzeSwing', () => {
  it('records one trace for a full golf swing and finds a good tempo', () => {
    const traces = golfSwing();
    expect(traces).toHaveLength(1);
    const m = analyzeSwing(traces[0]);
    expect(m.valid).toBe(true);
    expect(m.peakSpeed).toBeGreaterThan(4);
    expect(m.tempo).toBeGreaterThan(2); expect(m.tempo).toBeLessThan(6);
    expect(m.direction).toBe(1);                  // downswing ke kanan layar
    expect(Math.abs(m.leanDeg)).toBeLessThan(40);
    expect(m.quality).toBeGreaterThan(0.6);
  });

  it('a rushed, out-of-plane swing scores lower than a smooth one', () => {
    const good = analyzeSwing(golfSwing()[0]);
    const bad = analyzeSwing(golfSwing({ back: 0.3, down: 0.3, pitchOut: true })[0]);
    expect(bad.quality).toBeLessThan(good.quality - 0.15);
    expect(bad.planeDeviationDeg).toBeGreaterThan(good.planeDeviationDeg);
  });

  it('does not record while the player keeps fidgeting (never still long enough)', () => {
    const eng = new MotionEngine(); const traces: SwingTrace[] = [];
    eng.on('trace', t => traces.push(t));
    for (const o of poseTimeline([
      { dur: 0.2, to: R0, mode: 'hold' },
      { dur: 0.4, to: { ...R0, angleDeg: -120 }, mode: 'ease' },      // gerakan iseng pelan (di bawah ambang cepat), tidak pernah diam 350 ms
      { dur: 0.6, to: { ...R0, angleDeg: -120 }, mode: 'hold' },
    ], R0)) eng.pushObservation(o);
    expect(traces).toHaveLength(0);
  });
});

describe('swing analysis robustness', () => {
  /** pemula: backswing cepat, downswing melambat ke arah bola. Titik kena harus tetap di downswing. */
  it('picks the downswing as impact even when the backswing peaks higher', () => {
    const base: StickPose = { hx: 0.5, hy: 0.3, angleDeg: 90 };
    const eng = new MotionEngine(); const traces: SwingTrace[] = [];
    eng.on('trace', t => traces.push(t));
    for (const o of poseTimeline([
      { dur: 1.0, to: base, mode: 'hold' },
      { dur: 0.45, to: { ...base, angleDeg: 215 }, mode: 'ease' },   // backswing cepat
      { dur: 0.1, to: { ...base, angleDeg: 215 }, mode: 'hold' },
      { dur: 0.90, to: { ...base, angleDeg: 90 }, mode: 'in' },       // downswing lebih lambat dari backswing
      { dur: 0.6, to: { ...base, angleDeg: 20 }, mode: 'out' },
      { dur: 1.2, to: { ...base, angleDeg: 20 }, mode: 'hold' },
    ], base, { fps: 60 })) eng.pushObservation(o);
    expect(traces).toHaveLength(1);
    const m = analyzeSwing(traces[0]);
    expect(m.globalPeak).toBeGreaterThan(m.peakSpeed);             // puncak global ada di backswing
    expect(m.direction).toBe(1);                                    // tetapi titik kena dibaca dari downswing (ke kanan)
    expect(Math.abs(m.leanDeg)).toBeLessThan(25);
    expect(m.peakIndex).toBeGreaterThan(m.topIndex);
  });

  it('a very fast swing is still recorded when the player never held still', () => {
    const base: StickPose = { hx: 0.5, hy: 0.3, angleDeg: 90 };
    const eng = new MotionEngine(); const traces: SwingTrace[] = [];
    eng.on('trace', t => traces.push(t));
    for (const o of poseTimeline([
      { dur: 0.1, to: { ...base, angleDeg: 100 }, mode: 'lin' },      // selalu bergerak pelan, tidak pernah diam 350 ms
      { dur: 0.3, to: { ...base, angleDeg: 90 }, mode: 'lin' },
      { dur: 0.2, to: { ...base, angleDeg: -30 }, mode: 'in' },       // lalu ayunan sangat cepat
      { dur: 0.3, to: { ...base, angleDeg: -60 }, mode: 'out' },
      { dur: 1.0, to: { ...base, angleDeg: -60 }, mode: 'hold' },
    ], { ...base, angleDeg: 85 }, { fps: 60 })) eng.pushObservation(o);
    expect(traces.length).toBeGreaterThanOrEqual(1);
    expect(traces[0].peakSpeed).toBeGreaterThan(4);
  });
});

describe('impact lean is robust to frame phase', () => {
  /** pose kontinu dari ayunan golf tampak depan; disampel dengan fase frame yang berbeda-beda */
  const swingAt = (t: number): StickPose => {
    const e = (f: number) => f * f * (3 - 2 * f);
    const base = { hx: 0.5, hy: 0.3 };
    if (t < 1.0) return { ...base, angleDeg: 90 };
    if (t < 1.9) return { ...base, angleDeg: 90 + 125 * e((t - 1.0) / 0.9) };
    if (t < 1.98) return { ...base, angleDeg: 215 };
    if (t < 2.25) { const f = (t - 1.98) / 0.27; return { ...base, angleDeg: 215 - 125 * f * f }; }     // 'in'
    if (t < 2.5) { const f = (t - 2.25) / 0.25; return { ...base, angleDeg: 90 - 120 * (1 - (1 - f) * (1 - f)) }; } // 'out'
    return { ...base, angleDeg: -30 };
  };
  it('reports near-zero lean for a swing around a fixed pivot, whatever the sampling phase', () => {
    for (const phase of [0, 0.25, 0.5, 0.75]) {
      const eng = new MotionEngine(); const traces: SwingTrace[] = [];
      eng.on('trace', t => traces.push(t));
      const dt = 1000 / 30;
      for (let k = 0; k < 140; k++) { const t = (k + phase) * dt; eng.pushObservation(syntheticObservation(t, swingAt(t / 1000))); }
      expect(traces, `phase ${phase}`).toHaveLength(1);
      const m = analyzeSwing(traces[0]);
      expect(Math.abs(m.leanDeg), `phase ${phase}: lean ${m.leanDeg.toFixed(1)}`).toBeLessThan(9);
    }
  });
});
