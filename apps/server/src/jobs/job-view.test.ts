import { describe, expect, it } from 'vitest';
import {
  aggregateJobUsage,
  collectRelatedIds,
  computeQueueCounts,
  publicJobPayload,
  relatedForJob,
  startedElapsedSec,
  summarizeJob,
  truncateChars,
  weeklyRangeLabel,
  type JobRelatedMaps,
} from './job-view.js';

const DOC_ID = '11111111-1111-4111-8111-111111111111';
const TOPIC_ID = '22222222-2222-4222-8222-222222222222';
const CARD_ID = '33333333-3333-4333-8333-333333333333';

function atLocal(year: number, monthIndex: number, day: number, hour = 12, minute = 0): Date {
  return new Date(year, monthIndex, day, hour, minute, 0, 0);
}

describe('summarizeJob', () => {
  it('uses the document title for digest and falls back without one', () => {
    expect(summarizeJob('digest', { documentId: DOC_ID }, { documentTitle: '交叉验证入门' })).toEqual({
      summary: '消化 · 「交叉验证入门」',
      description: '提取知识卡片并更新知识地图',
    });
    expect(summarizeJob('digest', { documentId: DOC_ID })).toEqual({
      summary: '消化 · 一篇文档',
      description: '提取知识卡片并更新知识地图',
    });
  });

  it('uses payload question for chat, truncated to 30 chars, and falls back', () => {
    expect(
      summarizeJob('chat', { documentId: DOC_ID, question: 'L1 和 L2 正则化到底啥区别？' }),
    ).toEqual({
      summary: '对话 · 「L1 和 L2 正则化到底啥区别？」',
      description: '检索已有卡片后生成回答',
    });

    const long = `${'问'.repeat(35)}题`;
    const summarized = summarizeJob('chat', { question: long });
    expect(summarized.summary.startsWith('对话 · 「')).toBe(true);
    expect(summarized.summary.endsWith('」')).toBe(true);
    const inner = [...summarized.summary].slice([...'对话 · 「'].length, -1).join('');
    expect([...inner]).toHaveLength(30);
    expect(inner).toBe('问'.repeat(30));

    expect(summarizeJob('chat', { documentId: DOC_ID })).toEqual({
      summary: '对话 · 一个问题',
      description: '检索已有卡片后生成回答',
    });
    expect(
      summarizeJob('chat', { documentId: DOC_ID }, { documentTitle: '文档标题当问题' }),
    ).toEqual({
      summary: '对话 · 「文档标题当问题」',
      description: '检索已有卡片后生成回答',
    });
  });

  it('formats weekly_report range from weekStart and falls back on junk', () => {
    expect(summarizeJob('weekly_report', { weekStart: '2026-09-14' })).toEqual({
      summary: '周报 · 9/14–9/20',
      description: '生成本周学习复盘',
    });
    expect(summarizeJob('weekly_report', { weekStart: 'not-a-date' })).toEqual({
      summary: '周报 · 本周',
      description: '生成本周学习复盘',
    });
    expect(summarizeJob('weekly_report', {})).toEqual({
      summary: '周报 · 本周',
      description: '生成本周学习复盘',
    });
  });

  it('uses topic title for evolve/topic and falls back when missing', () => {
    expect(summarizeJob('evolve', { cardId: CARD_ID }, { topicTitle: '机器学习基础' })).toEqual({
      summary: '主题进化 · 「机器学习基础」',
      description: '根据今天的复习表现更新知识地图',
    });
    expect(summarizeJob('topic', { action: 'organize', topicId: TOPIC_ID }, { topicTitle: 'Rust' })).toEqual({
      summary: '主题进化 · 「Rust」',
      description: '整理或补全知识地图',
    });
    expect(summarizeJob('evolve', { action: 'analyze_patterns', date: '2026-09-14' })).toEqual({
      summary: '主题进化 · 一个主题',
      description: '根据今天的复习表现更新知识地图',
    });
    expect(summarizeJob('topic', { action: 'suggest' })).toEqual({
      summary: '主题进化 · 一个主题',
      description: '整理或补全知识地图',
    });
  });

  it('uses the document title for extract and ocr', () => {
    expect(
      summarizeJob('extract', { documentId: DOC_ID }, { documentTitle: '交叉验证入门' }),
    ).toEqual({
      summary: '提取 · 「交叉验证入门」',
      description: '从原件提取文本',
    });
    expect(summarizeJob('extract', { documentId: DOC_ID })).toEqual({
      summary: '提取 · 一篇文档',
      description: '从原件提取文本',
    });
    expect(summarizeJob('ocr', { documentId: DOC_ID }, { documentTitle: '扫描讲义' })).toEqual({
      summary: '识别 · 「扫描讲义」',
      description: '识别扫描版文档中的文字',
    });
  });

  it('uses the document title for selection with book-title marks', () => {
    expect(
      summarizeJob('selection', { documentId: DOC_ID, selectionText: '一段' }, { documentTitle: '交叉验证入门' }),
    ).toEqual({
      summary: '选段写卡 · 《交叉验证入门》',
      description: '从选中段落生成知识卡片',
    });
    expect(summarizeJob('selection', { documentId: DOC_ID })).toEqual({
      summary: '选段写卡 · 一篇文档',
      description: '从选中段落生成知识卡片',
    });
  });

  it('never throws on garbage payload', () => {
    expect(() => summarizeJob('digest', { documentId: 1 as unknown as string })).not.toThrow();
    expect(summarizeJob('digest', { documentId: 1 as unknown as string }).summary).toBe('消化 · 一篇文档');
    expect(summarizeJob('chat', { question: '   ' }).summary).toBe('对话 · 一个问题');
  });
});

describe('publicJobPayload', () => {
  it('strips pageTexts from ocr jobs even if the row still has them', () => {
    expect(
      publicJobPayload('ocr', {
        documentId: DOC_ID,
        totalPages: 2,
        donePages: [0],
        pageTexts: ['secret page'],
      }),
    ).toEqual({
      documentId: DOC_ID,
      totalPages: 2,
      donePages: [0],
    });
  });

  it('leaves non-ocr payloads untouched', () => {
    const payload = { documentId: DOC_ID, pageTexts: ['keep'] };
    expect(publicJobPayload('digest', payload)).toBe(payload);
  });
});

describe('truncateChars / weeklyRangeLabel', () => {
  it('keeps short strings and slices long ones', () => {
    expect(truncateChars('短', 30)).toBe('短');
    expect([...truncateChars('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十超出', 30)]).toHaveLength(
      30,
    );
  });

  it('rejects impossible calendar days', () => {
    expect(weeklyRangeLabel('2026-02-30')).toBeUndefined();
    expect(weeklyRangeLabel('2026-09-14')).toBe('9/14–9/20');
  });
});

describe('related lookups', () => {
  it('collects document / topic / card ids and skips non-uuids', () => {
    const ids = collectRelatedIds([
      { type: 'digest', payload: { documentId: DOC_ID } },
      { type: 'chat', payload: { captureId: DOC_ID, question: 'hi' } },
      { type: 'selection', payload: { documentId: DOC_ID, selectionText: '一段' } },
      { type: 'extract', payload: { documentId: DOC_ID } },
      { type: 'ocr', payload: { documentId: DOC_ID, totalPages: 4 } },
      { type: 'topic', payload: { action: 'organize', topicId: TOPIC_ID } },
      { type: 'evolve', payload: { cardId: CARD_ID, reason: 'fuzzy' } },
      { type: 'digest', payload: { documentId: 'not-a-uuid' } },
      { type: 'weekly_report', payload: { weekStart: '2026-09-14' } },
    ]);
    expect(ids.documentIds).toEqual([DOC_ID]);
    expect(ids.topicIds).toEqual([TOPIC_ID]);
    expect(ids.cardIds).toEqual([CARD_ID]);
  });

  it('resolves evolve topic via card.topicId', () => {
    const maps: JobRelatedMaps = {
      documentsById: new Map(),
      cardsById: new Map([[CARD_ID, { topicId: TOPIC_ID }]]),
      topicsById: new Map([[TOPIC_ID, '机器学习基础']]),
    };
    const related = relatedForJob(
      { type: 'evolve', payload: { cardId: CARD_ID, reason: 'fuzzy' } },
      maps,
    );
    expect(related.topicTitle).toBe('机器学习基础');
    expect(
      summarizeJob('evolve', { cardId: CARD_ID, reason: 'fuzzy' }, related).summary,
    ).toBe('主题进化 · 「机器学习基础」');
  });
});

describe('computeQueueCounts', () => {
  const now = atLocal(2026, 8, 14, 18);

  it('counts running, pending, local-today done, and currently failed', () => {
    const counts = computeQueueCounts(
      [
        { status: 'running', finishedAt: null },
        { status: 'pending', finishedAt: null },
        { status: 'pending', finishedAt: null },
        { status: 'done', finishedAt: atLocal(2026, 8, 14, 1) },
        { status: 'done', finishedAt: atLocal(2026, 8, 13, 23) },
        { status: 'done', finishedAt: null },
        { status: 'failed', finishedAt: atLocal(2026, 8, 14, 11) },
      ],
      now,
    );
    expect(counts).toEqual({ running: 1, pending: 2, doneToday: 1, failed: 1 });
  });

  it('does not count a retried job (status is pending again) as failed', () => {
    const counts = computeQueueCounts(
      [
        { status: 'pending', finishedAt: null },
        { status: 'done', finishedAt: atLocal(2026, 8, 14, 10) },
      ],
      now,
    );
    expect(counts.failed).toBe(0);
    expect(counts.pending).toBe(1);
  });
});

describe('startedElapsedSec', () => {
  it('floors milliseconds to seconds and never goes negative', () => {
    const updatedAt = new Date('2026-09-14T10:00:00.000Z');
    expect(startedElapsedSec(updatedAt, new Date('2026-09-14T10:00:12.800Z'))).toBe(12);
    expect(startedElapsedSec(updatedAt, new Date('2026-09-14T09:59:59.000Z'))).toBe(0);
  });
});

describe('aggregateJobUsage', () => {
  const now = atLocal(2026, 8, 14, 16);

  it('fills 7 local days with zeros, groups by type desc, and totals', () => {
    const result = aggregateJobUsage(
      [
        { createdAt: atLocal(2026, 8, 14, 10), tokens: 100, type: 'digest' },
        { createdAt: atLocal(2026, 8, 14, 11), tokens: 40, type: 'digest' },
        { createdAt: atLocal(2026, 8, 12, 9), tokens: 80, type: 'chat' },
        { createdAt: atLocal(2026, 8, 10, 8), tokens: 10, type: 'evolve' },
        { createdAt: atLocal(2026, 8, 7, 8), tokens: 999, type: 'digest' },
        { createdAt: atLocal(2026, 8, 14, 12), tokens: 5, type: null },
      ],
      now,
      7,
    );

    expect(result.daily.map((row) => row.date)).toEqual([
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
    ]);
    expect(result.daily.find((row) => row.date === '2026-09-14')?.tokens).toBe(145);
    expect(result.daily.find((row) => row.date === '2026-09-08')?.tokens).toBe(0);
    expect(result.daily.find((row) => row.date === '2026-09-12')?.tokens).toBe(80);
    expect(result.byType).toEqual([
      { type: 'digest', tokens: 140 },
      { type: 'chat', tokens: 80 },
      { type: 'evolve', tokens: 10 },
    ]);
    expect(result.total).toBe(235);
  });

  it('returns a zero series when there are no logs', () => {
    const result = aggregateJobUsage([], now, 7);
    expect(result.daily).toHaveLength(7);
    expect(result.daily.every((row) => row.tokens === 0)).toBe(true);
    expect(result.byType).toEqual([]);
    expect(result.total).toBe(0);
  });
});
