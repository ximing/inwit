import { describe, expect, it } from 'vitest';
import { selectionJobPayloadFrom } from '@inwit/dto';
import {
  parseSelectionCards,
  selectionResultSummary,
  selectionUserPrompt,
  SELECTION_SYSTEM_PROMPT,
} from './selection-logic.js';

const SELECTION = '梯度消失：深层网络反向传播时，靠前的层梯度会指数衰减，参数几乎不更新。常见缓解：ReLU、残差连接。';
const DOC_ID = '11111111-1111-4111-8111-111111111111';

describe('selectionJobPayloadFrom', () => {
  it('requires documentId and non-empty selectionText', () => {
    expect(
      selectionJobPayloadFrom({ documentId: DOC_ID, selectionText: '一段原文' }),
    ).toEqual({ documentId: DOC_ID, selectionText: '一段原文' });
    expect(
      selectionJobPayloadFrom({ documentId: DOC_ID, selectionText: '一段原文', blockIndex: 2 }),
    ).toEqual({ documentId: DOC_ID, selectionText: '一段原文', blockIndex: 2 });
    expect(selectionJobPayloadFrom({ documentId: DOC_ID })).toBeUndefined();
    expect(selectionJobPayloadFrom({ selectionText: '一段原文' })).toBeUndefined();
    expect(selectionJobPayloadFrom({ documentId: DOC_ID, selectionText: '' })).toBeUndefined();
  });
});

describe('selectionUserPrompt / system prompt', () => {
  it('embeds title and selection, and asks for JSON cards without locating', () => {
    const prompt = selectionUserPrompt({ title: '反向传播', selectionText: SELECTION });
    expect(prompt).toContain('反向传播');
    expect(prompt).toContain(SELECTION);
    expect(SELECTION_SYSTEM_PROMPT).toContain('不必给出原文位置');
    expect(SELECTION_SYSTEM_PROMPT).toContain('1 到 3');
    expect(SELECTION_SYSTEM_PROMPT).not.toContain('anchor_text');
  });
});

describe('parseSelectionCards', () => {
  it('reads a cards array, snake_case fields, and caps at 3', () => {
    const raw = JSON.stringify({
      cards: [
        {
          concept: '梯度消失',
          example: '深层网络靠前的层几乎不更新',
          confusion_point: '和梯度爆炸相反',
          tags: ['反向传播', '训练'],
        },
        {
          concept: 'ReLU 缓解梯度消失',
          example: '用 ReLU 代替饱和激活',
          confusion_point: '',
          tags: ['ReLU'],
        },
        {
          concept: '残差连接',
          example: '跨层直连',
          confusion_point: '',
          tags: [],
        },
        {
          concept: '第四张应被丢掉',
          example: '超出上限',
          confusion_point: '',
          tags: [],
        },
      ],
    });
    const drafts = parseSelectionCards(raw);
    expect(drafts).toHaveLength(3);
    expect(drafts[0]?.concept).toBe('梯度消失');
    expect(drafts[0]?.confusionPoint).toBe('和梯度爆炸相反');
    expect(drafts[1]?.example).toBe('用 ReLU 代替饱和激活');
  });

  it('accepts a fenced JSON array and camelCase keys', () => {
    const raw = `说明如下：
\`\`\`json
[
  {
    "concept": "梯度消失",
    "example": "指数衰减",
    "confusionPoint": "",
    "tags": ["训练"]
  }
]
\`\`\``;
    expect(parseSelectionCards(raw)).toEqual([
      {
        concept: '梯度消失',
        example: '指数衰减',
        confusionPoint: '',
        tags: ['训练'],
      },
    ]);
  });

  it('keeps drafts even if they still include a leftover agent quote field', () => {
    const raw = JSON.stringify([
      {
        concept: '有效',
        example: '有效例子',
        confusion_point: '',
        tags: [],
        quote: '原文没有这句话',
      },
    ]);
    const drafts = parseSelectionCards(raw);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.concept).toBe('有效');
  });

  it('returns empty on garbage or missing concept/example', () => {
    expect(parseSelectionCards('not json')).toEqual([]);
    expect(parseSelectionCards('{"cards":[{"concept":"只有概念"}]}')).toEqual([]);
    expect(parseSelectionCards('')).toEqual([]);
  });
});

describe('selectionResultSummary', () => {
  it('formats card count', () => {
    expect(selectionResultSummary(0)).toBe('cards=0');
    expect(selectionResultSummary(2)).toBe('cards=2');
  });
});
