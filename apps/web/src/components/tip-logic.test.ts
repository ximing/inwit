import { describe, expect, it } from 'vitest';
import { placeTip, type TipRect } from './tip-logic';

const viewport = { width: 800, height: 600 };
const tip = { width: 40, height: 16 };

describe('placeTip', () => {
  it('centers a tip above the anchor when there is room', () => {
    const anchor: TipRect = { top: 100, left: 100, width: 20, height: 20 };
    expect(placeTip(anchor, tip, 'top', viewport)).toEqual({ top: 78, left: 90, side: 'top' });
  });

  it('shifts a top tip sideways instead of flipping when it would leave the viewport', () => {
    const anchor: TipRect = { top: 100, left: 2, width: 20, height: 20 };
    const wide = { width: 100, height: 16 };
    const placed = placeTip(anchor, wide, 'top', viewport);
    expect(placed.side).toBe('top');
    expect(placed.left).toBe(8);
    expect(placed.top).toBe(78);
  });

  it('flips below when the anchor sits against the top edge', () => {
    const anchor: TipRect = { top: 4, left: 100, width: 20, height: 20 };
    expect(placeTip(anchor, tip, 'top', viewport).side).toBe('bottom');
  });

  it('flips to the left when the right side does not fit', () => {
    const anchor: TipRect = { top: 100, left: 770, width: 20, height: 20 };
    const placed = placeTip(anchor, tip, 'right', viewport);
    expect(placed.side).toBe('left');
    expect(placed.left).toBe(724);
  });

  it('clamps into the viewport when no side fits', () => {
    const anchor: TipRect = { top: 10, left: 10, width: 20, height: 20 };
    const huge = { width: 900, height: 700 };
    const placed = placeTip(anchor, huge, 'top', viewport);
    expect(placed.top).toBe(8);
    expect(placed.left).toBe(8);
    expect(placed.side).toBe('top');
  });
});
