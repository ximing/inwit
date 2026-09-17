import { describe, expect, it } from 'vitest';
import { localDateKey } from '../utils/date.js';
import {
  aggregateTopicStats,
  applyReviewQueueLimits,
  buildDailyDistribution,
  buildForecast,
  computeStreak,
  retentionPercent,
} from './review-logic.js';

function atLocal(year: number, monthIndex: number, day: number, hour = 12): Date {
  return new Date(year, monthIndex, day, hour, 0, 0, 0);
}

describe('applyReviewQueueLimits', () => {
  const settings = { dailyReviewLimit: 5, dailyNewLimit: 2 };

  it('puts new cards first, caps new + total, and reports truncated', () => {
    const due = [
      { id: 'r1', reps: 3 },
      { id: 'n1', reps: 0 },
      { id: 'r2', reps: 1 },
      { id: 'n2', reps: 0 },
      { id: 'n3', reps: 0 },
      { id: 'r3', reps: 4 },
      { id: 'r4', reps: 2 },
    ];
    const { selected, truncated } = applyReviewQueueLimits(due, settings);
    expect(selected.map((row) => row.id)).toEqual(['n1', 'n2', 'r1', 'r2', 'r3']);
    expect(truncated).toBe(2);
  });

  it('uses leftover slots for review cards when fewer new cards exist', () => {
    const due = [
      { id: 'n1', reps: 0 },
      { id: 'r1', reps: 1 },
      { id: 'r2', reps: 2 },
      { id: 'r3', reps: 3 },
      { id: 'r4', reps: 4 },
      { id: 'r5', reps: 5 },
    ];
    const { selected, truncated } = applyReviewQueueLimits(due, settings);
    expect(selected.map((row) => row.id)).toEqual(['n1', 'r1', 'r2', 'r3', 'r4']);
    expect(truncated).toBe(1);
  });

  it('takes no new cards when dailyNewLimit is 0', () => {
    const due = [
      { id: 'n1', reps: 0 },
      { id: 'r1', reps: 1 },
      { id: 'r2', reps: 2 },
    ];
    const { selected, truncated } = applyReviewQueueLimits(due, {
      dailyReviewLimit: 5,
      dailyNewLimit: 0,
    });
    expect(selected.map((row) => row.id)).toEqual(['r1', 'r2']);
    expect(truncated).toBe(1);
  });
});

describe('computeStreak', () => {
  const now = atLocal(2026, 8, 14);

  it('is zero when there are no review days', () => {
    expect(computeStreak([], now)).toEqual({ current: 0, longest: 0 });
  });

  it('starts from today and walks backward', () => {
    expect(
      computeStreak(['2026-09-12', '2026-09-13', '2026-09-14', '2026-09-01'], now),
    ).toEqual({ current: 3, longest: 3 });
  });

  it('starts from yesterday when today is empty', () => {
    expect(computeStreak(['2026-09-12', '2026-09-13'], now)).toEqual({
      current: 2,
      longest: 2,
    });
  });

  it('does not count a broken current streak that ended before yesterday', () => {
    expect(computeStreak(['2026-09-01', '2026-09-02', '2026-09-03'], now)).toEqual({
      current: 0,
      longest: 3,
    });
  });

  it('records the historical longest even when current is shorter', () => {
    expect(
      computeStreak(
        ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-09-13', '2026-09-14'],
        now,
      ),
    ).toEqual({ current: 2, longest: 4 });
  });
});

describe('buildDailyDistribution', () => {
  const now = atLocal(2026, 8, 14, 18);

  it('fills missing local days with zeros over the last 7 days', () => {
    const daily = buildDailyDistribution(
      [
        { reviewedAt: atLocal(2026, 8, 14, 9), feedback: 'remembered' },
        { reviewedAt: atLocal(2026, 8, 14, 10), feedback: 'fuzzy' },
        { reviewedAt: atLocal(2026, 8, 12, 8), feedback: 'forgot' },
        { reviewedAt: atLocal(2026, 8, 12, 20), feedback: 'remembered' },
        { reviewedAt: atLocal(2026, 8, 7, 23), feedback: 'remembered' },
      ],
      now,
    );
    expect(daily.map((row) => row.date)).toEqual([
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
    ]);
    expect(daily[0]).toEqual({ date: '2026-09-08', forgot: 0, fuzzy: 0, remembered: 0 });
    expect(daily[4]).toEqual({ date: '2026-09-12', forgot: 1, fuzzy: 0, remembered: 1 });
    expect(daily[6]).toEqual({ date: '2026-09-14', forgot: 0, fuzzy: 1, remembered: 1 });
  });
});

describe('buildForecast', () => {
  const now = atLocal(2026, 8, 14, 10);

  it('counts overdue on today and buckets the next 6 local days', () => {
    const forecast = buildForecast(
      [
        atLocal(2026, 8, 10, 8),
        atLocal(2026, 8, 14, 1),
        atLocal(2026, 8, 14, 22),
        atLocal(2026, 8, 15, 9),
        atLocal(2026, 8, 15, 18),
        atLocal(2026, 8, 20, 12),
        atLocal(2026, 8, 21, 12),
      ],
      now,
    );
    expect(forecast.map((row) => row.date)).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
    expect(forecast[0]?.count).toBe(3);
    expect(forecast[1]?.count).toBe(2);
    expect(forecast[6]?.count).toBe(1);
  });
});

describe('retentionPercent', () => {
  it('returns a 0-100 integer, or null when total is 0', () => {
    expect(retentionPercent(0, 0)).toBeNull();
    expect(retentionPercent(2, 3)).toBe(67);
    expect(retentionPercent(1, 1)).toBe(100);
  });
});

describe('aggregateTopicStats', () => {
  it('sums the three feedback grades and derives retention per topic', () => {
    const stats = aggregateTopicStats([
      { topicId: 't1', title: 'RL', remembered: 8, fuzzy: 3, forgot: 1 },
      { topicId: 't2', title: '统计', remembered: 0, fuzzy: 0, forgot: 4 },
    ]);
    expect(stats).toEqual([
      { topicId: 't1', title: 'RL', reviews7d: 12, retention7d: 67 },
      { topicId: 't2', title: '统计', reviews7d: 4, retention7d: 0 },
    ]);
  });

  it('sorts by review volume desc, keeping stable output for empty input', () => {
    const stats = aggregateTopicStats([
      { topicId: 'a', title: 'A', remembered: 1, fuzzy: 0, forgot: 0 },
      { topicId: 'b', title: 'B', remembered: 2, fuzzy: 2, forgot: 0 },
    ]);
    expect(stats.map((row) => row.topicId)).toEqual(['b', 'a']);
    expect(aggregateTopicStats([])).toEqual([]);
  });
});

describe('localDateKey', () => {
  it('formats YYYY-MM-DD in local time', () => {
    expect(localDateKey(atLocal(2026, 8, 4, 0))).toBe('2026-09-04');
  });
});
