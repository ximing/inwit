import { describe, expect, it } from 'vitest';
import { isPdfPageIndex, pdfSelectionFrom } from './reader-pdf-logic.js';

describe('isPdfPageIndex', () => {
  it('accepts zero and positive integers', () => {
    expect(isPdfPageIndex(0)).toBe(true);
    expect(isPdfPageIndex(3)).toBe(true);
  });

  it('rejects fractions, negatives, and non-numbers', () => {
    expect(isPdfPageIndex(-1)).toBe(false);
    expect(isPdfPageIndex(1.5)).toBe(false);
    expect(isPdfPageIndex(Number.NaN)).toBe(false);
    expect(isPdfPageIndex(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('pdfSelectionFrom', () => {
  it('trims text and keeps the page and quads', () => {
    const quads = [[0, 1, 2, 3]];
    expect(pdfSelectionFrom('  引用  ', 2, quads)).toEqual({
      text: '引用',
      pageIndex: 2,
      quads,
    });
  });

  it('clears a blank selection and defaults missing quads to an empty array', () => {
    expect(pdfSelectionFrom('   ', 0)).toBeNull();
    expect(pdfSelectionFrom('', 1, [[1]])).toBeNull();
    expect(pdfSelectionFrom('留下', 4)).toEqual({ text: '留下', pageIndex: 4, quads: [] });
  });
});
