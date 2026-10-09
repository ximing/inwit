import { describe, expect, it } from 'vitest';
import { wheelZoomFactor } from './canvas-zoom';

describe('wheelZoomFactor', () => {
  it('ignores empty or non-finite deltas', () => {
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(Number.NaN)).toBe(1);
    expect(wheelZoomFactor(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('turns a small pinch frame into a small zoom, not a fixed 8% step', () => {
    const frame = -100 * Math.log(1.02);
    const factor = wheelZoomFactor(frame);
    expect(factor).toBeGreaterThan(1.005);
    expect(factor).toBeLessThan(1.012);
  });

  it('slows a full trackpad pinch so it does not cover the whole zoom range', () => {
    const pinchIn = -100 * Math.log(2);
    const factor = wheelZoomFactor(pinchIn);
    expect(factor).toBeCloseTo(Math.pow(2, 0.4), 5);
    expect(factor).toBeGreaterThan(1.25);
    expect(factor).toBeLessThan(1.4);
  });

  it('zooms out by the inverse of the same pinch', () => {
    const pinchIn = -100 * Math.log(1.5);
    const inward = wheelZoomFactor(pinchIn);
    const outward = wheelZoomFactor(-pinchIn);
    expect(inward * outward).toBeCloseTo(1, 8);
    expect(outward).toBeLessThan(1);
  });

  it('accumulates small frames the same way as one combined pinch', () => {
    const frame = -100 * Math.log(1.02);
    let stepped = 1;
    for (let i = 0; i < 24; i += 1) stepped *= wheelZoomFactor(frame);
    expect(stepped).toBeCloseTo(wheelZoomFactor(frame * 24), 8);
    expect(stepped).toBeGreaterThan(1.15);
    expect(stepped).toBeLessThan(1.3);
  });

  it('treats a Firefox wheel line as a modest step', () => {
    const factor = wheelZoomFactor(1, 1);
    expect(factor).toBeGreaterThan(0.92);
    expect(factor).toBeLessThan(0.96);
  });
});
