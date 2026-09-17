import { agentDocumentMetaLabel, weeklyReportBannerText, weeklyReportJobPayloadFrom } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import {
  annotationDeepLink,
  annotationsMarkdown,
  coveragePct,
  dataSummaryMarkdown,
  ensureAnnotationLinks,
  ensureRelearnMarkdownLinks,
  ensureWeeklyReportBody,
  mentionsDistribution,
  shouldAutoEnqueueWeeklyReport,
  startOfWeekMonday,
  successRateFromCounts,
  weekStartKey,
  weeklyReportMemoryKey,
  weeklyReportTitle,
  weeklyResultSummary,
  type WeekStats,
} from './weekly-logic.js';

const CARD_A = '11111111-1111-4111-8111-111111111111';
const CARD_B = '22222222-2222-4222-8222-222222222222';
const CARD_C = '33333333-3333-4333-8333-333333333333';

function sampleStats(overrides: Partial<WeekStats> = {}): WeekStats {
  return {
    weekStart: '2026-09-14',
    weekEnd: '2026-09-20',
    reviews: { remembered: 7, fuzzy: 2, forgot: 1, total: 10 },
    successRate: 70,
    newCards: 4,
    newLinks: 2,
    topicCoverage: [
      { topicId: CARD_A, title: '机器学习基础', totalNodes: 9, uncoveredNodes: 4, coveragePct: 56 },
    ],
    relearn: [
      { cardId: CARD_A, concept: '偏差', lapses: 3, lastFeedback: 'forgot' },
      { cardId: CARD_B, concept: '方差', lapses: 2, lastFeedback: 'fuzzy' },
      { cardId: CARD_C, concept: '过拟合', lapses: 2, lastFeedback: 'forgot' },
    ],
    annotations: [],
    annotationCount: 0,
    ...overrides,
  };
}

describe('weeklyReportJobPayloadFrom', () => {
  it('requires weekStart as YYYY-MM-DD', () => {
    expect(weeklyReportJobPayloadFrom({ weekStart: '2026-09-14' })).toEqual({
      weekStart: '2026-09-14',
    });
    expect(weeklyReportJobPayloadFrom({})).toBeUndefined();
    expect(weeklyReportJobPayloadFrom({ weekStart: '09/14' })).toBeUndefined();
  });
});

describe('week bounds / title', () => {
  it('starts the week on Monday local time', () => {
    expect(weekStartKey(new Date(2026, 8, 14, 8, 0))).toBe('2026-09-14');
    expect(weekStartKey(new Date(2026, 8, 16, 23, 0))).toBe('2026-09-14');
    expect(weekStartKey(new Date(2026, 8, 13, 1, 0))).toBe('2026-09-07');
    expect(startOfWeekMonday(new Date(2026, 8, 14)).getDay()).toBe(1);
  });

  it('builds 「M/D–M/D 学习复盘」', () => {
    expect(weeklyReportTitle(new Date(2026, 8, 14))).toBe('9/14–9/20 学习复盘');
    expect(weeklyReportTitle(new Date(2026, 11, 28))).toBe('12/28–1/3 学习复盘');
  });

  it('builds a stable memory key', () => {
    expect(weeklyReportMemoryKey('2026-09-14')).toBe('weekly_report:2026-09-14');
  });
});

describe('rates / enqueue / summary', () => {
  it('rounds remembered/total to a percent', () => {
    expect(successRateFromCounts(0, 0)).toBe(0);
    expect(successRateFromCounts(7, 9)).toBe(78);
    expect(successRateFromCounts(1, 3)).toBe(33);
  });

  it('computes map coverage as non-uncovered / total', () => {
    expect(coveragePct(0, 0)).toBe(0);
    expect(coveragePct(9, 4)).toBe(56);
    expect(coveragePct(5, 0)).toBe(100);
  });

  it('auto-enqueues only when this week has activity and no job', () => {
    expect(shouldAutoEnqueueWeeklyReport({ hasJobThisWeek: false, reviewCount: 1, newCards: 0, newLinks: 0 })).toBe(
      true,
    );
    expect(shouldAutoEnqueueWeeklyReport({ hasJobThisWeek: false, reviewCount: 0, newCards: 2, newLinks: 0 })).toBe(
      true,
    );
    expect(shouldAutoEnqueueWeeklyReport({ hasJobThisWeek: false, reviewCount: 0, newCards: 0, newLinks: 1 })).toBe(
      true,
    );
    expect(shouldAutoEnqueueWeeklyReport({ hasJobThisWeek: true, reviewCount: 9, newCards: 4, newLinks: 2 })).toBe(
      false,
    );
    expect(shouldAutoEnqueueWeeklyReport({ hasJobThisWeek: false, reviewCount: 0, newCards: 0, newLinks: 0 })).toBe(
      false,
    );
  });

  it('formats a compact result summary', () => {
    expect(weeklyResultSummary({ document: true, memory: true, relearn: 3, reviews: 10 })).toBe(
      'type=weekly_report document=1 memory=1 relearn=3 reviews=10',
    );
  });
});

describe('document body helpers', () => {
  it('detects 三档 copy and injects a data summary when missing', () => {
    expect(mentionsDistribution('想起来了 7，模糊 2，忘了 1')).toBe(true);
    expect(mentionsDistribution('这周还行')).toBe(false);
    const stats = sampleStats();
    const body = ensureWeeklyReportBody('这周梯度那边还稳，偏差方差在忘。', stats);
    expect(body).toContain('想起来了 7');
    expect(body).toContain('模糊 2');
    expect(body).toContain('忘了 1');
    expect(body).toContain(`/cards/${CARD_A}`);
    expect(body).toContain(`/cards/${CARD_B}`);
    expect(body).toContain(`/cards/${CARD_C}`);
  });

  it('does not duplicate card links that the agent already wrote', () => {
    const stats = sampleStats();
    const existing = [
      '想起来了 7 次，模糊 2 次，忘了 1 次。',
      '',
      `- [偏差](/cards/${CARD_A})：老把偏差当成方差`,
      `- [方差](/cards/${CARD_B})：一换数据就抖`,
      `- [过拟合](/cards/${CARD_C})：训练集很好测试就崩`,
    ].join('\n');
    const body = ensureWeeklyReportBody(existing, stats);
    expect(body.match(/\/cards\//g)?.length).toBe(3);
    expect(body.startsWith('## 数据小结')).toBe(false);
  });

  it('appends a 建议重学 list for missing links', () => {
    const extra = ensureRelearnMarkdownLinks('想起来了 / 模糊 / 忘了', [
      { cardId: CARD_A, concept: '偏差', lapses: 3, lastFeedback: 'forgot', reason: '连着忘' },
    ]);
    expect(extra).toContain(`- [偏差](/cards/${CARD_A})：连着忘`);
  });

  it('renders coverage lines in the data summary', () => {
    const md = dataSummaryMarkdown(sampleStats());
    expect(md).toContain('机器学习基础 56%（5/9 节点）');
  });

  it('lists noted annotations with deep links and skips quote-only ones', () => {
    const stats = sampleStats({
      annotationCount: 2,
      annotations: [
        {
          id: CARD_A,
          documentId: CARD_B,
          documentTitle: '梯度消失笔记',
          kind: 'text',
          quote: 'sigmoid 导数上限 0.25',
          note: '连乘四次就不到百分之一了',
        },
        {
          id: CARD_C,
          documentId: CARD_B,
          documentTitle: '梯度消失笔记',
          kind: 'text',
          quote: '反向传播逐层算梯度',
          note: '  ',
        },
      ],
    });
    const md = dataSummaryMarkdown(stats);
    expect(md).toContain('- 新批注 2 条');
    const section = annotationsMarkdown(stats.annotations);
    expect(section).toContain('## 本周批注');
    expect(section).toContain(`[批注](${annotationDeepLink(CARD_B, CARD_A)})`);
    expect(section).toContain('连乘四次就不到百分之一了');
    expect(section).not.toContain('反向传播逐层算梯度');
  });

  it('ensureAnnotationLinks appends a 本周批注 section only for missing links', () => {
    const annotations = [
      {
        id: CARD_A,
        documentId: CARD_B,
        documentTitle: '梯度消失笔记',
        kind: 'text',
        quote: '一段原文',
        note: '一句想法',
      },
    ];
    const appended = ensureAnnotationLinks('想起来了 / 模糊 / 忘了', annotations);
    expect(appended).toContain(`annotation=${CARD_A}`);
    const already = ensureAnnotationLinks(`已有 [批注](/docs?doc=${CARD_B}&annotation=${CARD_A})`, annotations);
    expect(already).not.toContain('## 本周批注');
    expect(ensureAnnotationLinks('没有批注', [])).toBe('没有批注');
  });

  it('ensureWeeklyReportBody threads annotation links through the full body', () => {
    const stats = sampleStats({
      annotationCount: 1,
      annotations: [
        {
          id: CARD_A,
          documentId: CARD_B,
          documentTitle: '梯度消失笔记',
          kind: 'text',
          quote: '一段原文',
          note: '一句想法',
        },
      ],
    });
    const body = ensureWeeklyReportBody('这周还行。', stats);
    expect(body).toContain('- 新批注 1 条');
    expect(body).toContain(`/docs?doc=${CARD_B}&annotation=${CARD_A}`);
  });
});

describe('banner / agent doc labels', () => {
  it('matches the T23 home banner copy', () => {
    expect(weeklyReportBannerText(78, 3)).toBe(
      '📖 本周复盘已生成：成功率 78%，有 3 个概念在偷偷遗忘。',
    );
    expect(weeklyReportBannerText(100, 0)).toBe('📖 本周复盘已生成：成功率 100%，这周学得很稳。');
  });

  it('labels weekly recap vs contrast agent docs', () => {
    expect(agentDocumentMetaLabel('agent', '9/14–9/20 学习复盘')).toBe('AI 复盘');
    expect(agentDocumentMetaLabel('agent', '对比专题：偏差 vs 方差')).toBe('对比专题');
    expect(agentDocumentMetaLabel('paste', '9/14–9/20 学习复盘')).toBeNull();
  });
});
