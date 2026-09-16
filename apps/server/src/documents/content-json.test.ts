import { describe, expect, it } from 'vitest';
import { markdownToContentJson, textToParagraphDoc } from './content-json.js';

describe('markdownToContentJson', () => {
  it('turns markdown --- into numbered pageBreak nodes', () => {
    const doc = markdownToContentJson('第一页\n\n---\n\n第二页\n\n---\n\n第三页');
    const types = (doc.content ?? []).map((node) => node.type);
    expect(types).toContain('pageBreak');
    const breaks = (doc.content ?? []).filter((node) => node.type === 'pageBreak');
    expect(breaks.map((node) => node.attrs?.pageIndex)).toEqual([1, 2]);
  });

  it('keeps ordinary markdown as a doc without pageBreaks', () => {
    const doc = markdownToContentJson('# 过拟合\n\n高偏差来自模型太简单。');
    expect(doc.type).toBe('doc');
    expect((doc.content ?? []).some((node) => node.type === 'pageBreak')).toBe(false);
    expect((doc.content ?? []).some((node) => node.type === 'heading')).toBe(true);
  });
});

describe('textToParagraphDoc', () => {
  it('wraps a chat question in a single paragraph', () => {
    const doc = textToParagraphDoc('过拟合是什么？');
    expect(doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '过拟合是什么？' }] }],
    });
  });

  it('uses an empty paragraph for blank input', () => {
    expect(textToParagraphDoc('  \n')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});
