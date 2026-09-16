import { describe, expect, it } from 'vitest';
import type { PmJson } from '@inwit/doc-schema';
import {
  inheritSelectionAnchor,
  numberedBlocksFromDoc,
  resolveQuoteAnchor,
} from './card-anchor-logic.js';

function doc(...content: PmJson[]): PmJson {
  return { type: 'doc', content };
}

function p(text: string): PmJson {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

const SOURCE = doc(
  p('梯度消失是深层网络反向传播时的典型问题。'),
  { type: 'pageBreak', attrs: { pageIndex: 1 } },
  p('靠前的层梯度会指数衰减，参数几乎不再更新。'),
);

describe('numberedBlocksFromDoc', () => {
  it('formats the numbered block view used in agent prompts', () => {
    const { blocks, numberedView } = numberedBlocksFromDoc(SOURCE);
    expect(blocks).toEqual([
      { index: 1, pageIndex: 1, text: '梯度消失是深层网络反向传播时的典型问题。' },
      { index: 2, pageIndex: 1, text: '' },
      { index: 3, pageIndex: 2, text: '靠前的层梯度会指数衰减，参数几乎不再更新。' },
    ]);
    expect(numberedView).toBe(
      [
        '[块 1 | 第 1 页] 梯度消失是深层网络反向传播时的典型问题。',
        '[块 2 | 第 1 页] （分页）',
        '[块 3 | 第 2 页] 靠前的层梯度会指数衰减，参数几乎不再更新。',
      ].join('\n'),
    );
  });
});

describe('resolveQuoteAnchor (write_cards → 卡片行锚字段)', () => {
  it('locate 成功：anchorText = quote，anchorBlockIndex = blockIndex', () => {
    const quote = '参数几乎不再更新';
    expect(resolveQuoteAnchor(SOURCE, 3, quote)).toEqual({
      anchorText: quote,
      anchorBlockIndex: 3,
    });
  });

  it('空白容错仍算成功，快照保留模型给出的 quote', () => {
    const quote = '参数几乎  不再更新';
    expect(resolveQuoteAnchor(SOURCE, 3, `  ${quote}  `)).toEqual({
      anchorText: quote,
      anchorBlockIndex: 3,
    });
  });

  it('locate 失败：卡片照建，anchorText = quote，anchorBlockIndex = null', () => {
    const paraphrased = '这是改写过的一句话，原文里没有。';
    expect(resolveQuoteAnchor(SOURCE, 3, paraphrased)).toEqual({
      anchorText: paraphrased,
      anchorBlockIndex: null,
    });
    expect(resolveQuoteAnchor(SOURCE, 1, '参数几乎不再更新')).toEqual({
      anchorText: '参数几乎不再更新',
      anchorBlockIndex: null,
    });
    expect(resolveQuoteAnchor(SOURCE, 9, '梯度消失')).toEqual({
      anchorText: '梯度消失',
      anchorBlockIndex: null,
    });
  });
});

describe('inheritSelectionAnchor (划词产卡锚继承)', () => {
  it('每张卡继承用户划词的 (blockIndex, quote)，不采用 agent 自拟引用', () => {
    const user = {
      blockIndex: 1,
      quote: '梯度消失是深层网络反向传播时的典型问题。',
    };
    const inherited = inheritSelectionAnchor(SOURCE, user);
    expect(inherited).toEqual({
      anchorText: user.quote,
      anchorBlockIndex: 1,
    });
    expect(inherited.anchorText).not.toBe('编造的引用');
  });

  it('校验失败仍建卡、无锚：快照为用户划词，blockIndex 为空', () => {
    expect(
      inheritSelectionAnchor(SOURCE, { blockIndex: 2, quote: '梯度消失是深层网络反向传播时的典型问题。' }),
    ).toEqual({
      anchorText: '梯度消失是深层网络反向传播时的典型问题。',
      anchorBlockIndex: null,
    });
    expect(inheritSelectionAnchor(SOURCE, { blockIndex: undefined, quote: '梯度消失' })).toEqual({
      anchorText: '梯度消失',
      anchorBlockIndex: null,
    });
  });
});
