import { describe, expect, it } from 'vitest';
import { isMarqueeLargeEnough, rectsFromFormattedSelection } from './selection-logic';

const a = { origin: { x: 10, y: 20 }, size: { width: 30, height: 8 } };
const b = { origin: { x: 10, y: 32 }, size: { width: 18, height: 8 } };

describe('rectsFromFormattedSelection', () => {
  it('reads segmentRects from plugin-selection@2.15.0', () => {
    expect(rectsFromFormattedSelection({ pageIndex: 0, segmentRects: [a, b], rect: a })).toEqual([
      a,
      b,
    ]);
  });

  it('falls back to the bounding rect when segmentRects is missing', () => {
    expect(rectsFromFormattedSelection({ pageIndex: 0, rect: a })).toEqual([a]);
  });

  it('returns empty for null or empty payloads', () => {
    expect(rectsFromFormattedSelection(null)).toEqual([]);
    expect(rectsFromFormattedSelection({})).toEqual([]);
    expect(rectsFromFormattedSelection({ segmentRects: [] })).toEqual([]);
  });
});

describe('isMarqueeLargeEnough', () => {
  it('rejects a tiny drag below the pixel threshold', () => {
    expect(
      isMarqueeLargeEnough({ origin: { x: 0, y: 0 }, size: { width: 2, height: 2 } }, 1),
    ).toBe(false);
  });

  it('accepts a drag that exceeds minDragPx after scale', () => {
    expect(
      isMarqueeLargeEnough({ origin: { x: 0, y: 0 }, size: { width: 4, height: 1 } }, 2),
    ).toBe(true);
  });
});
