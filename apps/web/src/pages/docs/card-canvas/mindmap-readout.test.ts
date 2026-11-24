import { describe, expect, it } from 'vitest';
import { cardHidesBody, elementIsClamped, readoutPanelSize, type ReadoutCard } from './mindmap-readout';

const card = (patch: Partial<ReadoutCard> = {}): ReadoutCard => ({
  concept: '概念',
  example: '',
  confusionPoint: '',
  questions: [{ question: '概念', answer: '' }],
  ...patch,
});

describe('cardHidesBody', () => {
  it('题面就是概念、没有答案和例子时，不靠全文', () => {
    expect(cardHidesBody(card(), false)).toBe(false);
  });

  it('没展开时，答案算藏起来；展开后这一道答案已经在节点上', () => {
    const withAnswer = card({ questions: [{ question: '概念', answer: '答案' }] });
    expect(cardHidesBody(withAnswer, false)).toBe(true);
    expect(cardHidesBody(withAnswer, true)).toBe(false);
  });

  it('展开后，其余题目、不同的例子、易混点和不同的概念仍然藏着', () => {
    expect(
      cardHidesBody(
        card({
          questions: [
            { question: '概念', answer: '答案' },
            { question: '第二问', answer: '二' },
          ],
        }),
        true,
      ),
    ).toBe(true);
    expect(cardHidesBody(card({ example: '另外的例子', questions: [{ question: '概念', answer: '答案' }] }), true)).toBe(
      true,
    );
    expect(cardHidesBody(card({ confusionPoint: '容易和别的概念混' }), true)).toBe(true);
    expect(cardHidesBody(card({ concept: '另一句', questions: [{ question: '题面', answer: '' }] }), true)).toBe(
      true,
    );
  });

  it('例子和唯一答案是同一句时，展开后不再因为例子重复要全文', () => {
    expect(cardHidesBody(card({ example: '答案', questions: [{ question: '概念', answer: '答案' }] }), true)).toBe(
      false,
    );
  });
});

describe('elementIsClamped', () => {
  it('高出 1px 以内不算截断', () => {
    expect(elementIsClamped({ scrollHeight: 40, clientHeight: 40 })).toBe(false);
    expect(elementIsClamped({ scrollHeight: 41, clientHeight: 40 })).toBe(false);
    expect(elementIsClamped({ scrollHeight: 42, clientHeight: 40 })).toBe(true);
  });
});

describe('readoutPanelSize', () => {
  it('宽不超过 360，高不超过舞台的 70% 和 480', () => {
    expect(readoutPanelSize({ width: 800, height: 900 })).toEqual({ width: 360, height: 480 });
    expect(readoutPanelSize({ width: 300, height: 400 })).toEqual({ width: 284, height: 280 });
    expect(readoutPanelSize({ width: 200, height: 200 })).toEqual({ width: 184, height: 140 });
  });
});
