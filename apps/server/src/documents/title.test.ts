import { describe, expect, it } from 'vitest';
import {
  agentDocumentMetaLabel,
  BLANK_DOCUMENT_LABEL,
  cardDetailSchema,
  createDocumentInputSchema,
  createSelectionCardsInputSchema,
  docCardFace,
  docCardLabel,
  docDisplayTitle,
  docOwnedTitle,
  documentIdFromJobPayload,
  documentSourceSchema,
  EMPTY_PM_DOC,
  textFromPmJson,
  titleFromDoc,
  updateDocumentInputSchema,
} from '@inwit/dto';

function para(text: string) {
  if (text.replaceAll('\u200b', '').trim().length === 0) {
    return { type: 'doc' as const, content: [{ type: 'paragraph' }] };
  }
  return {
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function paras(...texts: string[]) {
  return {
    type: 'doc' as const,
    content: texts.map((text) =>
      text.length === 0
        ? { type: 'paragraph' }
        : { type: 'paragraph', content: [{ type: 'text', text }] },
    ),
  };
}

describe('titleFromDoc', () => {
  it('uses the first non-empty top-level block, capped at 40 characters', () => {
    expect(titleFromDoc(paras('梯度消失', '反向传播'))).toBe('梯度消失');
    expect(titleFromDoc(paras('  ', '  首行标题  ', '正文'))).toBe('首行标题');
    expect(titleFromDoc(para('a'.repeat(50)))).toBe('a'.repeat(40));
  });

  it('strips ATX heading marks and reads heading nodes', () => {
    expect(
      titleFromDoc({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '过拟合笔记' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '正文' }] },
        ],
      }),
    ).toBe('过拟合笔记');
    expect(titleFromDoc(para('## 小节'))).toBe('小节');
  });

  it('falls back to 未命名文档 when content is blank', () => {
    expect(titleFromDoc(para('   \n\t'))).toBe('未命名文档');
    expect(titleFromDoc(para('#  '))).toBe('未命名文档');
    expect(titleFromDoc(EMPTY_PM_DOC)).toBe('未命名文档');
  });
});

describe('docDisplayTitle', () => {
  it('prefers a non-empty title', () => {
    expect(docDisplayTitle({ title: '过拟合', description: '讲模型记样本' })).toBe('过拟合');
  });

  it('falls back to the first description line, capped at 40 characters', () => {
    expect(docDisplayTitle({ title: null, description: '  \n讲梯度消失。\n更多' })).toBe('讲梯度消失。');
    expect(docDisplayTitle({ title: '  ', description: 'a'.repeat(50) })).toBe('a'.repeat(40));
  });

  it('falls back to 未命名文档 when both are empty', () => {
    expect(docDisplayTitle({ title: null, description: null })).toBe('未命名文档');
    expect(docDisplayTitle({ title: '', description: '   ' })).toBe('未命名文档');
  });
});

describe('textFromPmJson', () => {
  it('joins block text and skips blank / page-break nodes', () => {
    expect(textFromPmJson(paras('梯度消失', '反向传播会把它放大'))).toBe('梯度消失 反向传播会把它放大');
    expect(
      textFromPmJson({
        type: 'doc',
        content: [
          { type: 'paragraph' },
          { type: 'pageBreak' },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '过拟合' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '训练集很好，测试集不行。' }] },
        ],
      }),
    ).toBe('过拟合 训练集很好，测试集不行。');
  });

  it('clips to max Unicode characters', () => {
    expect(textFromPmJson(para('a'.repeat(50)), 12)).toBe('a'.repeat(12));
  });
});

describe('docCardFace', () => {
  it('keeps a real title and uses description as preview', () => {
    expect(
      docCardFace({ title: '过拟合', description: '讲模型记样本', contentJson: para('正文更长一些') }),
    ).toEqual({ title: '过拟合', preview: '讲模型记样本' });
  });

  it('treats empty and 未命名文档 as untitled', () => {
    expect(docOwnedTitle(null)).toBeNull();
    expect(docOwnedTitle('  ')).toBeNull();
    expect(docOwnedTitle('未命名文档')).toBeNull();
    expect(docOwnedTitle('交叉验证')).toBe('交叉验证');
  });

  it('untitled docs show body preview instead of 未命名文档', () => {
    expect(
      docCardFace({
        title: null,
        description: null,
        contentJson: paras('学习率太大时会在最优点附近震荡。', '可以把步长调小。'),
      }),
    ).toEqual({
      title: null,
      preview: '学习率太大时会在最优点附近震荡。 可以把步长调小。',
    });
    expect(docCardLabel(docCardFace({ title: null, contentJson: EMPTY_PM_DOC }))).toBe(
      BLANK_DOCUMENT_LABEL,
    );
  });

  it('untitled docs prefer content over description, then chat answer', () => {
    expect(
      docCardFace({
        title: '  未命名文档  ',
        description: '摘要一行',
        contentJson: para('正文才是卡片上该看到的。'),
      }).preview,
    ).toBe('正文才是卡片上该看到的。');
    expect(
      docCardFace({
        title: null,
        description: null,
        contentJson: EMPTY_PM_DOC,
        answer: '**偏差** 来自假设空间太窄。',
      }).preview,
    ).toBe('偏差 来自假设空间太窄。');
  });

  it('does not repeat the title inside the preview', () => {
    expect(
      docCardFace({
        title: '过拟合',
        contentJson: para('过拟合：模型把噪声也记住了。'),
      }).preview,
    ).toBe('模型把噪声也记住了。');
  });
});

describe('document write schemas', () => {
  it('accepts an empty PM doc on create (blank document, no digest)', () => {
    expect(createDocumentInputSchema.safeParse({ contentJson: EMPTY_PM_DOC }).success).toBe(true);
    expect(createDocumentInputSchema.safeParse({ contentJson: para('') }).success).toBe(true);
    const parsed = createDocumentInputSchema.parse({ contentJson: EMPTY_PM_DOC });
    expect(parsed.contentJson.type).toBe('doc');
  });

  it('rejects a missing or non-doc contentJson', () => {
    expect(createDocumentInputSchema.safeParse({}).success).toBe(false);
    expect(createDocumentInputSchema.safeParse({ contentJson: { type: 'paragraph' } }).success).toBe(
      false,
    );
  });

  it('accepts editor source and rejects chat/agent on POST /documents', () => {
    expect(
      createDocumentInputSchema.safeParse({ contentJson: para('笔记'), source: 'editor' }).success,
    ).toBe(true);
    expect(
      createDocumentInputSchema.safeParse({ contentJson: para('笔记'), source: 'chat' }).success,
    ).toBe(false);
    expect(
      createDocumentInputSchema.safeParse({ contentJson: para('笔记'), source: 'agent' }).success,
    ).toBe(false);
    expect(
      createDocumentInputSchema.safeParse({ contentJson: para('笔记'), source: 'import' }).success,
    ).toBe(false);
  });

  it('includes agent in the document source enum', () => {
    expect(documentSourceSchema.safeParse('agent').success).toBe(true);
    expect(documentSourceSchema.options).toContain('agent');
  });

  it('includes import in the document source enum', () => {
    expect(documentSourceSchema.safeParse('import').success).toBe(true);
    expect(documentSourceSchema.options).toContain('import');
  });

  it('includes screenshot in the document source enum', () => {
    expect(documentSourceSchema.safeParse('screenshot').success).toBe(true);
    expect(documentSourceSchema.options).toContain('screenshot');
  });

  it('labels weekly recap vs contrast agent documents', () => {
    expect(agentDocumentMetaLabel('agent', '9/14–9/20 学习复盘')).toBe('AI 复盘');
    expect(agentDocumentMetaLabel('agent', '对比专题：偏差 vs 方差')).toBe('对比专题');
    expect(agentDocumentMetaLabel('editor', '入门：正则化')).toBeNull();
    expect(agentDocumentMetaLabel('agent', null)).toBe('对比专题');
  });

  it('requires title, contentJson, or topicId on PUT', () => {
    expect(updateDocumentInputSchema.safeParse({}).success).toBe(false);
    expect(updateDocumentInputSchema.safeParse({ contentJson: EMPTY_PM_DOC }).success).toBe(true);
    expect(updateDocumentInputSchema.safeParse({ title: '过拟合' }).success).toBe(true);
    expect(updateDocumentInputSchema.safeParse({ title: null }).success).toBe(true);
    expect(updateDocumentInputSchema.safeParse({ title: '' }).success).toBe(false);
    expect(updateDocumentInputSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(
      updateDocumentInputSchema.safeParse({ topicId: '11111111-1111-4111-8111-111111111111' })
        .success,
    ).toBe(true);
    expect(updateDocumentInputSchema.safeParse({ topicId: null }).success).toBe(true);
  });

  it('requires blockIndex on selection-cards input', () => {
    expect(
      createSelectionCardsInputSchema.safeParse({ text: '划词' }).success,
    ).toBe(false);
    expect(
      createSelectionCardsInputSchema.safeParse({ text: '划词', blockIndex: 2 }).success,
    ).toBe(true);
    expect(
      createSelectionCardsInputSchema.safeParse({ text: '划词', blockIndex: 0 }).success,
    ).toBe(false);
  });
});

describe('documentIdFromJobPayload', () => {
  it('prefers documentId and falls back to legacy captureId', () => {
    expect(documentIdFromJobPayload({ documentId: 'doc-1', captureId: 'cap-1' })).toBe('doc-1');
    expect(documentIdFromJobPayload({ captureId: 'cap-1' })).toBe('cap-1');
    expect(documentIdFromJobPayload({})).toBeUndefined();
  });
});

describe('cardDetailSchema', () => {
  it('accepts a card with document title and review summary', () => {
    const parsed = cardDetailSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '11111111-1111-4111-8111-111111111112',
      documentId: '11111111-1111-4111-8111-111111111113',
      topicId: null,
      mapNodeId: null,
      concept: '梯度消失',
      example: '深层网络里梯度接近 0',
      confusionPoint: '和梯度爆炸相对',
      tags: ['反向传播'],
      source: 'agent',
      anchorText: '梯度在反向传播中逐层变小',
      anchorBlockIndex: 2,
      hasImage: false,
      createdAt: '2026-09-14T00:00:00.000Z',
      updatedAt: '2026-09-14T00:00:00.000Z',
      questions: [],
      documentTitle: '梯度消失',
      deletedAt: null,
      review: { dueAt: '2026-09-15T00:00:00.000Z', intervalDays: 1, suspendedAt: null },
    });
    expect(parsed.success).toBe(true);
  });
});
