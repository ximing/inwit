import { describe, expect, it } from 'vitest';
import { pageIndexFromAnchor, splitPdfPages } from './page-logic';

const md = ['第一页正文', '第二页正文', '第三页正文'].join('\n\n---\n\n');

describe('splitPdfPages', () => {
  it('splits contentMd on the PDF page separator', () => {
    expect(splitPdfPages(md)).toEqual(['第一页正文', '第二页正文', '第三页正文']);
    expect(splitPdfPages('')).toEqual([]);
  });
});

describe('pageIndexFromAnchor', () => {
  it('prefers an explicit 0-based pageIndex', () => {
    expect(pageIndexFromAnchor({ contentMd: md, pageIndex: 2, anchorBlock: '1' })).toBe(2);
  });

  it('maps 1-based anchorBlock through page separators', () => {
    expect(pageIndexFromAnchor({ contentMd: md, anchorBlock: '1' })).toBe(0);
    expect(pageIndexFromAnchor({ contentMd: md, anchorBlock: '3' })).toBe(2);
  });

  it('finds the page that contains quote when pageIndex is absent', () => {
    expect(pageIndexFromAnchor({ contentMd: md, quote: '第二页正文' })).toBe(1);
  });

  it('clamps out-of-range blocks to the last page', () => {
    expect(pageIndexFromAnchor({ contentMd: md, anchorBlock: '99' })).toBe(2);
  });
});
