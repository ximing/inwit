import { describe, expect, it } from 'vitest';
import type { PmJson } from '@inwit/doc-schema';
import { locateHighlightQuote } from './mind-highlight-logic.js';

function paragraph(text: string): PmJson {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

const doc: PmJson = {
  type: 'doc',
  content: [paragraph('梯度指向上升最快的方向'), paragraph('学习率太大就会震荡')],
};

describe('locateHighlightQuote', () => {
  it('accepts an exact sentence inside the numbered block', () => {
    expect(locateHighlightQuote(doc, 1, '上升最快')).toEqual({ ok: true });
    expect(locateHighlightQuote(doc, 2, '学习率太大就会震荡')).toEqual({ ok: true });
  });

  it('accepts a whitespace-tolerant match and rejects another block', () => {
    expect(locateHighlightQuote(doc, 2, '学习率太大 就会震荡')).toEqual({ ok: true });
    expect(locateHighlightQuote(doc, 1, '学习率太大就会震荡')).toEqual({
      ok: false,
      reason: '第 1 块里找不到这句',
    });
  });

  it('rejects a paraphrase and a missing block', () => {
    expect(locateHighlightQuote(doc, 1, '梯度是上升方向')).toEqual({
      ok: false,
      reason: '第 1 块里找不到这句',
    });
    expect(locateHighlightQuote(doc, 9, '梯度')).toEqual({
      ok: false,
      reason: '第 9 块里找不到这句',
    });
  });
});
