import { describe, it, expect } from 'vitest';
import type { PdfPageGeometry } from '@inwit/dto';
import {
  fromEnginePoint,
  toEnginePoint,
  quadBounds,
  floatingPosition,
} from './translation-geometry-logic.js';
const g: PdfPageGeometry = {
  coordinateVersion: 'crop-local-points-v1',
  cropBox: [30, 40, 580, 750],
  userUnit: 2,
  intrinsicRotation: 90,
  width: 1100,
  height: 1420,
};
describe('PDFium normalized geometry', () => {
  it('applies actual SDK size and does not double-rotate UserUnit2 coordinates', () => {
    const size = { width: 550, height: 710 };
    expect(toEnginePoint({ x: 100, y: 1200 }, g, size)).toEqual({ x: 50, y: 110 });
    expect(fromEnginePoint({ x: 50, y: 110 }, g, size)).toEqual({ x: 100, y: 1200 });
  });
  it('uses each line quad at current scale', () => {
    expect(
      quadBounds(
        [
          { x: 100, y: 1200 },
          { x: 300, y: 1200 },
          { x: 300, y: 1180 },
          { x: 100, y: 1180 },
        ],
        g,
        { width: 550, height: 710 },
        2,
      ),
    ).toEqual({ left: 100, top: 220, width: 200, height: 20 });
  });
  it('docks within a narrow reader and leaves close controls reachable', () => {
    const p = floatingPosition(
      { left: 0, right: 300, top: 60, bottom: 580 },
      { left: 0, right: 320, top: 50, bottom: 600 },
    );
    expect(p.docked).toBe(true);
    expect(p.left + p.width).toBeLessThanOrEqual(320);
    expect(p.top).toBeLessThan(600);
  });
});
describe('translation panel avoids the original', () => {
  const reader = { left: 0, right: 1200, top: 40, bottom: 800 };
  it('uses outside page space on either side before covering a page', () => {
    const anchor = { left: 450, right: 700, top: 200, bottom: 450 };
    const p = floatingPosition(anchor, reader, {
      page: { left: 400, right: 900, top: 50, bottom: 900 },
      height: 300,
    });
    expect(p.left + p.width).toBeLessThan(400);
    expect(p.docked).toBe(false);
  });
  it('places below the full paragraph rather than its first line', () => {
    const anchor = { left: 100, right: 600, top: 100, bottom: 330 };
    const p = floatingPosition(
      anchor,
      { left: 0, right: 700, top: 40, bottom: 800 },
      { height: 300 },
    );
    expect(p.top).toBeGreaterThan(anchor.bottom);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(800);
  });
  it('uses available scrolling space above a lower paragraph', () => {
    const p = floatingPosition(
      { left: 20, right: 600, top: 350, bottom: 760 },
      { left: 0, right: 640, top: 40, bottom: 800 },
      { height: 480 },
    );
    expect(p.top + p.maxHeight).toBeLessThan(350);
    expect(p.maxHeight).toBeGreaterThanOrEqual(180);
    expect(p.docked).toBe(false);
  });
});
