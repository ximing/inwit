import { describe, expect, it } from 'vitest';
import type { DocBlock } from '@inwit/doc-schema';
import {
  conceptSourceChangeIsLarge,
  retargetEvidenceLocator,
  smallEditLimit,
} from './concept-evidence-logic.js';

function blocks(texts: string[]): DocBlock[] {
  return texts.map((text, index) => ({ index: index + 1, pageIndex: 1, text }));
}

describe('concept source change', () => {
  it('counts a short note edit as small even when the whole sentence changes', () => {
    expect(conceptSourceChangeIsLarge(blocks(['原文一段。']), blocks(['原文被修改了。']))).toBe(false);
  });

  it('ignores an inserted paragraph ahead of unchanged text', () => {
    const before = blocks(['第一段保持不变。', '第二段也保持不变。']);
    const after = blocks(['段首补了一句。', '第一段保持不变。', '第二段也保持不变。']);
    expect(conceptSourceChangeIsLarge(before, after)).toBe(false);
  });

  it('treats a few edits inside a long paragraph as small', () => {
    const body = `概念来自这段正文。${'后续保持不变。'.repeat(80)}`;
    const edited = `概念来自这段正文。${'后续保持不变。'.repeat(79)}这里改了几个字。`;
    expect(conceptSourceChangeIsLarge(blocks([body]), blocks([edited]))).toBe(false);
  });

  it('treats replacing most of a longer article as large', () => {
    const before = blocks([`原文主题。${'这是原来的句子。'.repeat(80)}`]);
    const after = blocks([`另一篇文章。${'完全不同的内容。'.repeat(80)}`]);
    expect(conceptSourceChangeIsLarge(before, after)).toBe(true);
    expect(smallEditLimit(before[0]!.text.length, after[0]!.text.length)).toBeGreaterThan(200);
  });
});

describe('retargetEvidenceLocator', () => {
  it('keeps a quote that still matches after a neighboring edit', () => {
    const current = blocks(['Task 是单位。', '后面补了一句。']);
    expect(
      retargetEvidenceLocator(current, { kind: 'quote', quote: 'Task 是单位。' }),
    ).toEqual({ kind: 'quote', quote: 'Task 是单位。' });
  });

  it('moves a block locator when a paragraph is inserted ahead of the quote', () => {
    const current = blocks(['新增的开头。', 'Task 是单位。']);
    expect(
      retargetEvidenceLocator(current, { kind: 'block', blockIndex: 1, quote: 'Task 是单位。' }),
    ).toEqual({ kind: 'block', blockIndex: 2, quote: 'Task 是单位。' });
  });

  it('drops a quote whose text is no longer in the document', () => {
    expect(
      retargetEvidenceLocator(blocks(['正文改了。']), { kind: 'quote', quote: 'Task 是单位。' }),
    ).toBeNull();
  });
});
