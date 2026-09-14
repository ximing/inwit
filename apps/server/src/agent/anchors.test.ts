import { describe, expect, it } from 'vitest';
import {
  buildAssociationHint,
  parseAnchorBlock,
  resolveAnchor,
  splitMarkdownBlocks,
} from './anchors.js';

describe('splitMarkdownBlocks', () => {
  it('splits on blank lines and numbers from 1', () => {
    const blocks = splitMarkdownBlocks('第一段\n\n第二段\n\n第三段');
    expect(blocks.map((b) => b.index)).toEqual([1, 2, 3]);
    expect(blocks.map((b) => b.text)).toEqual(['第一段', '第二段', '第三段']);
  });

  it('keeps a single paragraph as block 1', () => {
    const blocks = splitMarkdownBlocks('只有一段，没有空行。');
    expect(blocks).toEqual([{ index: 1, text: '只有一段，没有空行。' }]);
  });
});

describe('parseAnchorBlock', () => {
  it('accepts numbers and numeric strings', () => {
    expect(parseAnchorBlock(3)).toBe(3);
    expect(parseAnchorBlock('2')).toBe(2);
    expect(parseAnchorBlock(' 4 ')).toBe(4);
    expect(parseAnchorBlock(0)).toBe(1);
    expect(parseAnchorBlock(null)).toBe(1);
  });
});

describe('resolveAnchor', () => {
  const doc = [
    '梯度消失是深层网络反向传播时的典型问题。',
    '',
    '靠前的层梯度会指数衰减，参数几乎不再更新。常见缓解办法包括 ReLU、残差连接和 BatchNorm。',
    '',
    '它和梯度爆炸是一对方向相反的数值病。',
  ].join('\n');

  it('keeps a verbatim quote and infers the block', () => {
    const resolved = resolveAnchor(doc, '靠前的层梯度会指数衰减，参数几乎不再更新。', 2);
    expect(resolved.matched).toBe('exact');
    expect(resolved.anchorText).toBe('靠前的层梯度会指数衰减，参数几乎不再更新。');
    expect(resolved.anchorBlock).toBe('2');
  });

  it('collapses whitespace to recover a slightly messy quote', () => {
    const resolved = resolveAnchor(doc, '靠前的层梯度会指数衰减，  参数几乎不再更新。', 9);
    expect(resolved.matched).toBe('normalized');
    expect(doc.includes(resolved.anchorText)).toBe(true);
    expect(resolved.anchorBlock).toBe('2');
  });

  it('falls back to a sentence in the requested block when the quote is paraphrased', () => {
    const resolved = resolveAnchor(doc, '这是改写过的一句话，原文里没有。', 3);
    expect(resolved.matched).toBe('block');
    expect(doc.includes(resolved.anchorText)).toBe(true);
    expect(resolved.anchorBlock).toBe('3');
  });
});

describe('buildAssociationHint', () => {
  it('returns null when there are no concepts', () => {
    expect(buildAssociationHint([])).toBeNull();
    expect(buildAssociationHint(['  '])).toBeNull();
  });

  it('writes the PRD-style same_concept sentence', () => {
    expect(buildAssociationHint(['反向传播'])).toBe(
      '这和你学过的「反向传播」是一回事的两种说法。',
    );
    expect(buildAssociationHint(['反向传播', 'sigmoid', '反向传播'])).toBe(
      '这和你学过的「反向传播」、「sigmoid」是一回事的两种说法。',
    );
  });
});
