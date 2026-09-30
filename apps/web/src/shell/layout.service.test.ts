import { afterEach, describe, expect, it, vi } from 'vitest';
import { getReviewToday } from '@/api/review';
import { LayoutService } from './layout.service';

vi.mock('@/api/review', () => ({ getReviewToday: vi.fn() }));

describe('LayoutService.refreshDue', () => {
  let service: LayoutService;

  afterEach(() => {
    service?.destroy();
    vi.clearAllMocks();
  });

  it('ignores a stale success and does not clear the badge from a stale failure', async () => {
    vi.mocked(getReviewToday).mockResolvedValue({ items: [], reviewedToday: 0, total: 0, truncated: 0 });
    service = new LayoutService();
    await Promise.resolve();
    await Promise.resolve();

    let releaseOld!: (today: { items: []; reviewedToday: number; total: number; truncated: number }) => void;
    vi.mocked(getReviewToday).mockReturnValueOnce(
      new Promise((resolve) => {
        releaseOld = resolve;
      }),
    );
    const older = service.refreshDue();
    vi.mocked(getReviewToday).mockResolvedValueOnce({ items: [], reviewedToday: 1, total: 4, truncated: 0 });
    await service.refreshDue();
    expect(service.dueCount).toBe(3);
    releaseOld({ items: [], reviewedToday: 0, total: 9, truncated: 0 });
    await older;
    expect(service.dueCount).toBe(3);

    let rejectOld!: (err: unknown) => void;
    vi.mocked(getReviewToday).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      }),
    );
    const failing = service.refreshDue();
    vi.mocked(getReviewToday).mockResolvedValueOnce({ items: [], reviewedToday: 0, total: 2, truncated: 0 });
    await service.refreshDue();
    expect(service.dueCount).toBe(2);
    rejectOld(new Error('late'));
    await failing;
    expect(service.dueCount).toBe(2);
  });
});
