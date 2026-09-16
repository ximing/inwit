import { describe, expect, it } from 'vitest';
import type { PmJson } from '@inwit/doc-schema';
import { isPdfOcrPending, pageIndexFromAnchor, pageTextsFromContent } from './page-logic';

function doc(...content: PmJson[]): PmJson {
  return { type: 'doc', content };
}

function p(text: string): PmJson {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function pageBreak(pageIndex: number): PmJson {
  return { type: 'pageBreak', attrs: { pageIndex } };
}

const threePages = doc(
  p('第一页正文'),
  pageBreak(1),
  p('第二页正文'),
  pageBreak(2),
  p('第三页正文'),
);

describe('pageTextsFromContent', () => {
  it('groups top-level block text by pageIndex', () => {
    expect(pageTextsFromContent(threePages)).toEqual(['第一页正文', '第二页正文', '第三页正文']);
    expect(pageTextsFromContent({ type: 'doc', content: [{ type: 'paragraph' }] })).toEqual(['']);
  });
});

describe('pageIndexFromAnchor', () => {
  it('prefers an explicit 0-based pageIndex', () => {
    expect(
      pageIndexFromAnchor({ contentJson: threePages, pageIndex: 2, anchorBlockIndex: 1 }),
    ).toBe(2);
  });

  it('maps 1-based anchorBlockIndex through pageBreaks', () => {
    expect(pageIndexFromAnchor({ contentJson: threePages, anchorBlockIndex: 1 })).toBe(0);
    expect(pageIndexFromAnchor({ contentJson: threePages, anchorBlockIndex: 3 })).toBe(1);
    expect(pageIndexFromAnchor({ contentJson: threePages, anchorBlockIndex: 5 })).toBe(2);
  });

  it('finds the page that contains quote when pageIndex is absent', () => {
    expect(pageIndexFromAnchor({ contentJson: threePages, quote: '第二页正文' })).toBe(1);
  });

  it('clamps out-of-range blocks to the last page', () => {
    expect(pageIndexFromAnchor({ contentJson: threePages, anchorBlockIndex: 99 })).toBe(2);
  });
});

describe('isPdfOcrPending', () => {
  it('treats empty docs as pending', () => {
    expect(isPdfOcrPending({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(true);
    expect(isPdfOcrPending(threePages)).toBe(false);
  });
});
