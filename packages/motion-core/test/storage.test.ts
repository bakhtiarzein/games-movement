import { afterEach, describe, expect, it } from 'vitest';
import { SHARED_COLORS_KEY, loadSharedColors, parseSharedColors, saveSharedColors, type SharedColors } from '../src';

const sample: SharedColors = { version: 1, tip: { h: 128, sMin: 0.4, vMin: 0.3 }, handle: { h: 226, sMin: 0.5, vMin: 0.2 }, hueTolerance: 30 };

function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}
const g = globalThis as unknown as { localStorage?: unknown };
afterEach(() => { delete g.localStorage; });

describe('shared marker colours', () => {
  it('round-trips through storage', () => {
    const st = fakeStorage(); g.localStorage = st;
    expect(loadSharedColors()).toBeNull();
    saveSharedColors(sample);
    expect(st.m.has(SHARED_COLORS_KEY)).toBe(true);
    expect(loadSharedColors()).toEqual(sample);
  });

  it('ignores corrupt, foreign or out-of-range data', () => {
    expect(parseSharedColors(null)).toBeNull();
    expect(parseSharedColors('not json')).toBeNull();
    expect(parseSharedColors('{"version":2}')).toBeNull();
    expect(parseSharedColors(JSON.stringify({ ...sample, tip: { h: 'x', sMin: 1, vMin: 1 } }))).toBeNull();
    expect(parseSharedColors(JSON.stringify({ ...sample, hueTolerance: 400 }))).toBeNull();
    expect(parseSharedColors(JSON.stringify({ ...sample, hueTolerance: 'abc' }))).toBeNull();
  });

  it('strips unknown fields', () => {
    const polluted = JSON.stringify({ ...sample, evil: 1, tip: { ...sample.tip, extra: 'x' } });
    expect(parseSharedColors(polluted)).toEqual(sample);
  });

  it('never throws when storage is missing or blocked', () => {
    expect(loadSharedColors()).toBeNull();                        // tanpa localStorage sama sekali
    expect(() => saveSharedColors(sample)).not.toThrow();
    g.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    expect(loadSharedColors()).toBeNull();
    expect(() => saveSharedColors(sample)).not.toThrow();
  });
});
