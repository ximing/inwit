import {
  DEFAULT_REVIEW_SETTINGS,
  type ReviewQueueItem,
  type ReviewSettings,
  type ReviewStats,
  type ReviewToday,
  type SyncChange,
} from '@inwit/dto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getReviewCheckins,
  getReviewSettings,
  getReviewStats,
  getReviewToday,
  getStrugglingCards,
} from '@/api/review';
import { ReviewService } from './review.service';

vi.mock('@/api/review', () => ({
  getReviewToday: vi.fn(),
  getReviewStats: vi.fn(),
  getReviewSettings: vi.fn(),
  getReviewCheckins: vi.fn(),
  getStrugglingCards: vi.fn(),
  submitReviewFeedback: vi.fn(),
  updateReviewSettings: vi.fn(),
}));
vi.mock('@/api/cards', () => ({
  archiveCard: vi.fn(),
  getCardImage: vi.fn(),
  suspendCard: vi.fn(),
}));

const T1 = '2026-09-30T00:00:01.000Z';

function reviewChange(): SyncChange {
  return { id: '1', scope: 'review', resourceId: null, op: 'upsert', at: T1 };
}

function stats(current: number): ReviewStats {
  return { streak: { current, longest: current }, totalCards: 1, overdueCount: 0 } as ReviewStats;
}

function keptCard(): ReviewQueueItem {
  return { card: { id: 'keep' } } as ReviewQueueItem;
}

describe('ReviewService sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes stats in a session without replacing the queue or the calendar', async () => {
    vi.mocked(getReviewStats).mockResolvedValue(stats(3));
    vi.mocked(getReviewToday).mockResolvedValue({ items: [], reviewedToday: 0, total: 9, truncated: 0 });
    const service = new ReviewService();
    service.mode = 'session';
    service.flipped = true;
    service.calMonth = '2020-01';
    service.items = [keptCard()];
    await service.handleSync({ type: 'changes', changes: [reviewChange()] });
    expect(service.items).toEqual([keptCard()]);
    expect(service.flipped).toBe(true);
    expect(service.calMonth).toBe('2020-01');
    expect(service.stats?.streak.current).toBe(3);
    expect(getReviewToday).not.toHaveBeenCalled();
    expect(getReviewSettings).not.toHaveBeenCalled();
  });

  it('reloads the hub queue without moving calMonth or calling load()', async () => {
    const today: ReviewToday = {
      items: [{ card: { id: 'next' } } as ReviewQueueItem],
      reviewedToday: 2,
      total: 5,
      truncated: 0,
    };
    vi.mocked(getReviewToday).mockResolvedValue(today);
    vi.mocked(getReviewStats).mockResolvedValue(stats(4));
    const service = new ReviewService();
    service.mode = 'hub';
    service.flipped = true;
    service.calMonth = '2020-01';
    await service.handleSync({ type: 'reset' });
    expect(service.calMonth).toBe('2020-01');
    expect(service.flipped).toBe(true);
    expect(service.items[0]?.card.id).toBe('next');
    expect(service.reviewedToday).toBe(2);
    expect(service.total).toBe(5);
    expect(service.stats?.streak.current).toBe(4);
    expect(getReviewSettings).not.toHaveBeenCalled();
  });

  it('does not apply an in-flight hub reload after the session starts', async () => {
    let release: (today: ReviewToday) => void = () => {};
    vi.mocked(getReviewToday).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    vi.mocked(getReviewStats).mockResolvedValue(stats(1));
    const service = new ReviewService();
    service.calMonth = '2020-01';
    const pending = service.handleSync({ type: 'changes', changes: [reviewChange()] });
    service.mode = 'session';
    service.flipped = true;
    service.items = [keptCard()];
    release({ items: [], reviewedToday: 0, total: 9, truncated: 0 });
    await pending;
    expect(service.mode).toBe('session');
    expect(service.items).toEqual([keptCard()]);
    expect(service.flipped).toBe(true);
    expect(service.calMonth).toBe('2020-01');
  });

  it('skips the sync reload while exitSession is already loading', async () => {
    let release: (settings: ReviewSettings) => void = () => {};
    vi.mocked(getReviewSettings).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    vi.mocked(getReviewToday).mockResolvedValue({ items: [], reviewedToday: 0, total: 1, truncated: 0 });
    vi.mocked(getReviewStats).mockResolvedValue(stats(1));
    vi.mocked(getStrugglingCards).mockResolvedValue([]);
    vi.mocked(getReviewCheckins).mockResolvedValue({ month: '2026-09', days: [] });
    const service = new ReviewService();
    service.mode = 'session';
    const exiting = service.exitSession();
    const calls = vi.mocked(getReviewToday).mock.calls.length;
    await service.handleSync({ type: 'changes', changes: [reviewChange()] });
    expect(vi.mocked(getReviewToday).mock.calls.length).toBe(calls);
    release(DEFAULT_REVIEW_SETTINGS);
    await exiting;
  });
});
