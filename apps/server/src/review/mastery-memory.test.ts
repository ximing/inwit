import { describe, expect, it } from 'vitest';
import { evolveReasonFor } from './evolve-reason.js';
import {
  MASTERY_RECENT_LIMIT,
  masteryCardKey,
  mergeMasteryContent,
  parseMasteryRecent,
  recentFromLogs,
} from './mastery-memory.js';

describe('masteryCardKey', () => {
  it('prefixes the card id', () => {
    expect(masteryCardKey('abc')).toBe('card:abc');
  });
});

describe('evolveReasonFor', () => {
  it('maps fuzzy always and forgot only when lapses >= 2', () => {
    expect(evolveReasonFor('fuzzy', 0)).toBe('fuzzy');
    expect(evolveReasonFor('fuzzy', 9)).toBe('fuzzy');
    expect(evolveReasonFor('forgot', 1)).toBeNull();
    expect(evolveReasonFor('forgot', 2)).toBe('repeated_forgot');
    expect(evolveReasonFor('remembered', 4)).toBeNull();
  });
});

describe('recentFromLogs', () => {
  it('keeps the last 5 in chronological order', () => {
    const logs = [
      { feedback: 'forgot' as const, reviewedAt: '2026-09-01T00:00:00.000Z' },
      { feedback: 'fuzzy' as const, reviewedAt: '2026-09-02T00:00:00.000Z' },
      { feedback: 'remembered' as const, reviewedAt: '2026-09-03T00:00:00.000Z' },
      { feedback: 'forgot' as const, reviewedAt: '2026-09-04T00:00:00.000Z' },
      { feedback: 'fuzzy' as const, reviewedAt: '2026-09-05T00:00:00.000Z' },
      { feedback: 'remembered' as const, reviewedAt: '2026-09-06T00:00:00.000Z' },
    ];
    const recent = recentFromLogs(logs);
    expect(recent).toHaveLength(MASTERY_RECENT_LIMIT);
    expect(recent[0]).toEqual({ feedback: 'fuzzy', reviewedAt: '2026-09-02T00:00:00.000Z' });
    expect(recent[4]).toEqual({ feedback: 'remembered', reviewedAt: '2026-09-06T00:00:00.000Z' });
  });

  it('accepts Date reviewedAt', () => {
    const at = new Date('2026-09-14T08:00:00.000Z');
    expect(recentFromLogs([{ feedback: 'fuzzy', reviewedAt: at }])).toEqual([
      { feedback: 'fuzzy', reviewedAt: '2026-09-14T08:00:00.000Z' },
    ]);
  });
});

describe('parseMasteryRecent / mergeMasteryContent', () => {
  it('drops malformed entries', () => {
    expect(
      parseMasteryRecent({
        recent: [
          { feedback: 'fuzzy', reviewedAt: '2026-09-14T00:00:00.000Z' },
          { feedback: 'nope', reviewedAt: '2026-09-14T00:00:00.000Z' },
          { feedback: 'forgot' },
          'x',
        ],
      }),
    ).toEqual([{ feedback: 'fuzzy', reviewedAt: '2026-09-14T00:00:00.000Z' }]);
  });

  it('preserves extra fields when writing recent', () => {
    const merged = mergeMasteryContent(
      { note: '换了个角度', recent: [{ feedback: 'forgot', reviewedAt: 'old' }] },
      { recent: [{ feedback: 'fuzzy', reviewedAt: 'new' }] },
    );
    expect(merged.note).toBe('换了个角度');
    expect(merged.recent).toEqual([{ feedback: 'fuzzy', reviewedAt: 'new' }]);
  });
});
