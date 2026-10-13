import { describe, expect, it } from 'vitest';
import { highlightPlaceLabel, highlightSelection } from './assistant-selection';

const DOC = '11111111-1111-4111-8111-111111111111';

describe('highlightSelection', () => {
  it('keeps a complete range and drops a half-open one', () => {
    expect(
      highlightSelection({ documentId: DOC, quote: ' 原文 ', blockIndex: 3, from: 4, to: 9 }),
    ).toEqual({ documentId: DOC, quote: '原文', blockIndex: 3, from: 4, to: 9 });
    expect(highlightSelection({ documentId: DOC, quote: '原文', from: 4 })).toEqual({
      documentId: DOC,
      quote: '原文',
    });
  });

  it('keeps a zero-based PDF page', () => {
    expect(highlightSelection({ documentId: DOC, quote: '原文', pageIndex: 0, blockIndex: 2 })).toEqual({
      documentId: DOC,
      quote: '原文',
      pageIndex: 0,
      blockIndex: 2,
    });
  });
});

describe('highlightPlaceLabel', () => {
  it('numbers the PDF page from one and keeps the block', () => {
    expect(highlightPlaceLabel({ pageIndex: 0, blockIndex: 2 })).toBe('第 1 页 · 第 2 块');
    expect(highlightPlaceLabel({})).toBe('划线');
  });
});
