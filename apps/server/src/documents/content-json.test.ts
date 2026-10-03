import { describe, expect, it } from 'vitest';
import { htmlFragmentToContentJson, markdownToContentJson, mergeChapterHtml, textToParagraphDoc } from './content-json.js';

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

describe('mergeChapterHtml', () => {
  it('keeps headings and drops a relative image', () => {
    const nodes = htmlFragmentToContentJson('<h1>第一章</h1><p>正文</p><img src="cover.png" alt="cover">');
    expect(nodes.some((node) => node.type === 'heading')).toBe(true);
    expect(nodes.some((node) => node.type === 'image')).toBe(false);
    expect(JSON.stringify(nodes)).toContain('正文');
  });

  it('returns no nodes for an empty chapter', () => {
    expect(htmlFragmentToContentJson('<p>   </p>')).toEqual([]);
  });

  it('inserts a thematic break between chapters and skips an empty one', () => {
    const doc = mergeChapterHtml(['<h1>第一章</h1><p>甲</p>', '<div> </div>', '<p>乙</p>']);
    const types = (doc.content ?? []).map((node) => node.type);
    expect(types).toContain('thematicBreak');
    expect(types.filter((type) => type === 'thematicBreak')).toHaveLength(1);
    expect(JSON.stringify(doc)).toContain('甲');
    expect(JSON.stringify(doc)).toContain('乙');
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
