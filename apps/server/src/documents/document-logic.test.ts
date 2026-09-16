import { describe, expect, it } from 'vitest';
import { isBlankDocumentContent, shouldEnqueueDigest } from './document-logic.js';

function para(text: string) {
  if (text.length === 0) return { type: 'doc' as const, content: [{ type: 'paragraph' }] };
  return {
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

describe('isBlankDocumentContent', () => {
  it('treats empty, whitespace, and zero-width placeholders as blank', () => {
    expect(isBlankDocumentContent(para(''))).toBe(true);
    expect(isBlankDocumentContent(para('   \n\t'))).toBe(true);
    expect(isBlankDocumentContent(para('\u200b'))).toBe(true);
    expect(isBlankDocumentContent(para(' \u200b \n'))).toBe(true);
  });

  it('treats any visible text as content', () => {
    expect(isBlankDocumentContent(para('笔记'))).toBe(false);
    expect(isBlankDocumentContent(para('  a  '))).toBe(false);
    expect(
      isBlankDocumentContent({
        type: 'doc',
        content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] }],
      }),
    ).toBe(false);
  });
});

describe('shouldEnqueueDigest', () => {
  const blank = { contentJson: para('') };
  const zwsp = { contentJson: para('\u200b') };
  const filled = { contentJson: para('过拟合') };

  it('enqueues when blank content becomes non-empty and there are no cards or active jobs', () => {
    expect(shouldEnqueueDigest(blank, { contentJson: para('过拟合是什么') }, 0, false)).toBe(true);
    expect(shouldEnqueueDigest(zwsp, { contentJson: para('偏差与方差') }, 0)).toBe(true);
  });

  it('does not enqueue on create-equivalent blanks or title-only patches', () => {
    expect(shouldEnqueueDigest(blank, { contentJson: para('') }, 0)).toBe(false);
    expect(shouldEnqueueDigest(blank, { contentJson: para('  \n') }, 0)).toBe(false);
    expect(shouldEnqueueDigest(blank, {}, 0)).toBe(false);
    expect(shouldEnqueueDigest(blank, { contentJson: undefined }, 0)).toBe(false);
  });

  it('does not re-digest a document that already has content', () => {
    expect(shouldEnqueueDigest(filled, { contentJson: para('过拟合是什么') }, 0)).toBe(false);
    expect(shouldEnqueueDigest(filled, { contentJson: para('补充一段') }, 0, false)).toBe(false);
  });

  it('skips when cards already exist or a digest job is pending/running', () => {
    expect(shouldEnqueueDigest(blank, { contentJson: para('过拟合是什么') }, 1, false)).toBe(false);
    expect(shouldEnqueueDigest(blank, { contentJson: para('过拟合是什么') }, 0, true)).toBe(false);
  });
});
