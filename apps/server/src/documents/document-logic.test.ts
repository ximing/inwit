import { describe, expect, it } from 'vitest';
import { isBlankDocumentContent, shouldEnqueueDigest } from './document-logic.js';

describe('isBlankDocumentContent', () => {
  it('treats empty, whitespace, and zero-width placeholders as blank', () => {
    expect(isBlankDocumentContent('')).toBe(true);
    expect(isBlankDocumentContent('   \n\t')).toBe(true);
    expect(isBlankDocumentContent('\u200b')).toBe(true);
    expect(isBlankDocumentContent(' \u200b \n')).toBe(true);
  });

  it('treats any visible text as content', () => {
    expect(isBlankDocumentContent('笔记')).toBe(false);
    expect(isBlankDocumentContent('  a  ')).toBe(false);
    expect(isBlankDocumentContent('# 标题')).toBe(false);
  });
});

describe('shouldEnqueueDigest', () => {
  const blank = { contentMd: '' };
  const zwsp = { contentMd: '\u200b' };
  const filled = { contentMd: '过拟合' };

  it('enqueues when blank content becomes non-empty and there are no cards or active jobs', () => {
    expect(shouldEnqueueDigest(blank, { contentMd: '过拟合是什么' }, 0, false)).toBe(true);
    expect(shouldEnqueueDigest(zwsp, { contentMd: '偏差与方差' }, 0)).toBe(true);
  });

  it('does not enqueue on create-equivalent blanks or title-only patches', () => {
    expect(shouldEnqueueDigest(blank, { contentMd: '' }, 0)).toBe(false);
    expect(shouldEnqueueDigest(blank, { contentMd: '  \n' }, 0)).toBe(false);
    expect(shouldEnqueueDigest(blank, {}, 0)).toBe(false);
    expect(shouldEnqueueDigest(blank, { contentMd: undefined }, 0)).toBe(false);
  });

  it('does not re-digest a document that already has content', () => {
    expect(shouldEnqueueDigest(filled, { contentMd: '过拟合是什么' }, 0)).toBe(false);
    expect(shouldEnqueueDigest(filled, { contentMd: '补充一段' }, 0, false)).toBe(false);
  });

  it('skips when cards already exist or a digest job is pending/running', () => {
    expect(shouldEnqueueDigest(blank, { contentMd: '过拟合是什么' }, 1, false)).toBe(false);
    expect(shouldEnqueueDigest(blank, { contentMd: '过拟合是什么' }, 0, true)).toBe(false);
  });
});
