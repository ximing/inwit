import { evolveAnalyzeJobPayloadFrom, evolveJobPayloadFrom } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { localDateKey } from '../utils/date.js';
import {
  ANALYZE_DAILY_THRESHOLD,
  capDocumentTitle,
  confusableMemoryKey,
  contrastDocTitle,
  documentOnCooldown,
  eligibleContrastPairs,
  parseConfusableKey,
  shouldEnqueueDailyAnalyze,
  analyzeResultSummary,
} from './analyze-logic.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('evolveAnalyzeJobPayloadFrom', () => {
  it('requires action and a YYYY-MM-DD date', () => {
    expect(evolveAnalyzeJobPayloadFrom({ action: 'analyze_patterns', date: '2026-09-14' })).toEqual({
      action: 'analyze_patterns',
      date: '2026-09-14',
    });
    expect(evolveAnalyzeJobPayloadFrom({ action: 'analyze_patterns' })).toBeUndefined();
    expect(evolveAnalyzeJobPayloadFrom({ action: 'analyze_patterns', date: '09/14' })).toBeUndefined();
    expect(evolveJobPayloadFrom({ action: 'analyze_patterns', date: '2026-09-14' })).toBeUndefined();
  });
});

describe('confusableMemoryKey', () => {
  it('is order-independent and parseable', () => {
    expect(confusableMemoryKey(A, B)).toBe(confusableMemoryKey(B, A));
    expect(confusableMemoryKey(A, B)).toBe(`confusable:${A}+${B}`);
    expect(parseConfusableKey(confusableMemoryKey(B, A))).toEqual({ a: A, b: B });
    expect(parseConfusableKey('card:abc')).toBeNull();
    expect(parseConfusableKey('confusable:only-one')).toBeNull();
  });
});

describe('documentOnCooldown', () => {
  it('requires a documentId generated within the window', () => {
    const now = new Date('2026-09-14T12:00:00.000Z');
    expect(documentOnCooldown(undefined, now)).toBe(false);
    expect(documentOnCooldown({ documentId: 'doc-1' }, now)).toBe(false);
    expect(
      documentOnCooldown(
        { documentId: 'doc-1', generatedAt: '2026-08-01T00:00:00.000Z' },
        now,
      ),
    ).toBe(false);
    expect(
      documentOnCooldown(
        { documentId: 'doc-1', generatedAt: '2026-09-01T00:00:00.000Z' },
        now,
      ),
    ).toBe(true);
  });
});

describe('shouldEnqueueDailyAnalyze', () => {
  it('needs daily volume, at least two struggling cards, and no in-flight job', () => {
    expect(shouldEnqueueDailyAnalyze(ANALYZE_DAILY_THRESHOLD - 1, 2, false)).toBe(false);
    expect(shouldEnqueueDailyAnalyze(ANALYZE_DAILY_THRESHOLD, 1, false)).toBe(false);
    expect(shouldEnqueueDailyAnalyze(ANALYZE_DAILY_THRESHOLD, 2, false)).toBe(true);
    expect(shouldEnqueueDailyAnalyze(9, 4, true)).toBe(false);
  });
});

describe('eligibleContrastPairs', () => {
  it('skips pairs whose memory key is on cooldown', () => {
    const key = confusableMemoryKey(A, B);
    expect(eligibleContrastPairs([A, B], new Set())).toEqual([key]);
    expect(eligibleContrastPairs([A, B], new Set([key]))).toEqual([]);
    expect(eligibleContrastPairs([A], new Set())).toEqual([]);
  });
});

describe('titles / summary / date', () => {
  it('builds a capped 对比专题 title', () => {
    expect(contrastDocTitle('偏差', '方差')).toBe('对比专题：偏差 vs 方差');
    expect(capDocumentTitle('  对比专题：偏差 vs 方差  ')).toBe('对比专题：偏差 vs 方差');
    expect([...capDocumentTitle('对比专题：' + '很长概念'.repeat(20))].length).toBeLessThanOrEqual(40);
  });

  it('formats local YYYY-MM-DD and result summaries', () => {
    expect(localDateKey(new Date(2026, 8, 14, 23, 30))).toBe('2026-09-14');
    expect(
      analyzeResultSummary({
        skipped: 'too_few',
        struggling: 1,
        pairs: 0,
        document: false,
        cards: 0,
        memory: 0,
      }),
    ).toBe('action=analyze_patterns skipped=too_few cards=1');
    expect(
      analyzeResultSummary({
        struggling: 2,
        pairs: 1,
        document: true,
        cards: 2,
        memory: 1,
      }),
    ).toBe('action=analyze_patterns pairs=1 document=1 cards=2 memory=1');
  });
});
