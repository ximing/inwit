import { describe, expect, it } from 'vitest';
import {
  agentDocumentMetaLabel,
  cardDetailSchema,
  createDocumentInputSchema,
  docDisplayTitle,
  documentIdFromJobPayload,
  documentSourceSchema,
  titleFromContent,
  updateDocumentInputSchema,
} from '@inwit/dto';

describe('titleFromContent', () => {
  it('uses the first non-empty line, capped at 40 characters', () => {
    expect(titleFromContent('梯度消失\n反向传播')).toBe('梯度消失');
    expect(titleFromContent('  \n  首行标题  \n正文')).toBe('首行标题');
    expect(titleFromContent('a'.repeat(50))).toBe('a'.repeat(40));
  });

  it('strips ATX heading marks from the first line', () => {
    expect(titleFromContent('# 过拟合笔记\n正文')).toBe('过拟合笔记');
    expect(titleFromContent('## 小节')).toBe('小节');
  });

  it('falls back to 未命名文档 when content is blank', () => {
    expect(titleFromContent('   \n\t')).toBe('未命名文档');
    expect(titleFromContent('#  ')).toBe('未命名文档');
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

describe('document write schemas', () => {
  it('accepts empty contentMd on create (blank document, no digest)', () => {
    expect(createDocumentInputSchema.safeParse({ contentMd: '' }).success).toBe(true);
    expect(createDocumentInputSchema.safeParse({ contentMd: '   ' }).success).toBe(true);
    const parsed = createDocumentInputSchema.parse({ contentMd: '   ' });
    expect(parsed.contentMd).toBe('');
  });

  it('accepts editor source and rejects chat/agent on POST /documents', () => {
    expect(createDocumentInputSchema.safeParse({ contentMd: '笔记', source: 'editor' }).success).toBe(
      true,
    );
    expect(createDocumentInputSchema.safeParse({ contentMd: '笔记', source: 'chat' }).success).toBe(
      false,
    );
    expect(createDocumentInputSchema.safeParse({ contentMd: '笔记', source: 'agent' }).success).toBe(
      false,
    );
    expect(createDocumentInputSchema.safeParse({ contentMd: '笔记', source: 'import' }).success).toBe(
      false,
    );
  });

  it('includes agent in the document source enum', () => {
    expect(documentSourceSchema.safeParse('agent').success).toBe(true);
    expect(documentSourceSchema.options).toContain('agent');
  });

  it('includes import in the document source enum', () => {
    expect(documentSourceSchema.safeParse('import').success).toBe(true);
    expect(documentSourceSchema.options).toContain('import');
  });

  it('labels weekly recap vs contrast agent documents', () => {
    expect(agentDocumentMetaLabel('agent', '9/14–9/20 学习复盘')).toBe('AI 复盘');
    expect(agentDocumentMetaLabel('agent', '对比专题：偏差 vs 方差')).toBe('对比专题');
    expect(agentDocumentMetaLabel('editor', '入门：正则化')).toBeNull();
    expect(agentDocumentMetaLabel('agent', null)).toBe('对比专题');
  });

  it('requires title, contentMd, or topicId on PUT', () => {
    expect(updateDocumentInputSchema.safeParse({}).success).toBe(false);
    expect(updateDocumentInputSchema.safeParse({ contentMd: '' }).success).toBe(true);
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
      anchorBlock: '2',
      hasImage: false,
      createdAt: '2026-09-14T00:00:00.000Z',
      updatedAt: '2026-09-14T00:00:00.000Z',
      questions: [],
      documentTitle: '梯度消失',
      review: { dueAt: '2026-09-15T00:00:00.000Z', intervalDays: 1 },
    });
    expect(parsed.success).toBe(true);
  });
});
