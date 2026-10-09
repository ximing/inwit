import { afterEach, describe, expect, it, vi } from 'vitest';
import { getReviewToday } from '@/api/review';
import { isTauriRuntime } from '@/platform/runtime';
import { syncNativeDueBadge } from '@/services/native-due-badge';
import { HIDDEN_DUE_BADGE_POLL_MS, LayoutService } from './layout.service';

const { syncNativeDueBadgeMock, isTauriRuntimeMock } = vi.hoisted(() => ({
  syncNativeDueBadgeMock: vi.fn(() => Promise.resolve()),
  isTauriRuntimeMock: vi.fn(() => false),
}));

vi.mock('@/api/review', () => ({ getReviewToday: vi.fn() }));
vi.mock('@/services/native-due-badge', () => ({
  syncNativeDueBadge: syncNativeDueBadgeMock,
}));
vi.mock('@/platform/runtime', () => ({
  isTauriRuntime: isTauriRuntimeMock,
}));

describe('LayoutService.refreshDue', () => {
  let service: LayoutService | undefined;

  afterEach(() => {
    service?.destroy();
    service = undefined;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.mocked(isTauriRuntime).mockReturnValue(false);
    vi.clearAllMocks();
  });

  it('ignores a stale success and does not clear the badge from a stale failure', async () => {
    vi.mocked(getReviewToday).mockResolvedValue({ items: [], reviewedToday: 0, total: 0, truncated: 0 });
    const layout = new LayoutService();
    service = layout;
    await Promise.resolve();
    await Promise.resolve();
    expect(syncNativeDueBadge).toHaveBeenCalledWith(0);
    vi.mocked(syncNativeDueBadge).mockClear();

    let releaseOld!: (today: { items: []; reviewedToday: number; total: number; truncated: number }) => void;
    vi.mocked(getReviewToday).mockReturnValueOnce(
      new Promise((resolve) => {
        releaseOld = resolve;
      }),
    );
    const older = layout.refreshDue();
    vi.mocked(getReviewToday).mockResolvedValueOnce({ items: [], reviewedToday: 1, total: 4, truncated: 0 });
    await layout.refreshDue();
    expect(layout.dueCount).toBe(3);
    releaseOld({ items: [], reviewedToday: 0, total: 9, truncated: 0 });
    await older;
    expect(layout.dueCount).toBe(3);

    let rejectOld!: (err: unknown) => void;
    vi.mocked(getReviewToday).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      }),
    );
    const failing = layout.refreshDue();
    vi.mocked(getReviewToday).mockResolvedValueOnce({ items: [], reviewedToday: 0, total: 2, truncated: 0 });
    await layout.refreshDue();
    expect(layout.dueCount).toBe(2);
    rejectOld(new Error('late'));
    await failing;
    expect(layout.dueCount).toBe(2);
    expect(vi.mocked(syncNativeDueBadge).mock.calls).toEqual([[3], [2]]);
  });

  it('pushes the due count onto the desktop icon and clears it when the shell goes away', async () => {
    vi.mocked(getReviewToday).mockResolvedValue({ items: [], reviewedToday: 0, total: 5, truncated: 0 });
    const layout = new LayoutService();
    service = layout;
    await Promise.resolve();
    await Promise.resolve();
    expect(layout.dueCount).toBe(5);
    expect(syncNativeDueBadge).toHaveBeenCalledWith(5);
    layout.destroy();
    expect(syncNativeDueBadge).toHaveBeenLastCalledWith(0);
    service = undefined;
  });

  it('keeps polling the due count while the Tauri window is hidden', async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    const listeners = new Set<() => void>();
    const doc = {
      hidden: true,
      addEventListener(_name: string, fn: () => void) {
        listeners.add(fn);
      },
      removeEventListener(_name: string, fn: () => void) {
        listeners.delete(fn);
      },
    };
    vi.stubGlobal('document', doc);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.mocked(getReviewToday).mockResolvedValue({ items: [], reviewedToday: 1, total: 4, truncated: 0 });

    const layout = new LayoutService();
    service = layout;
    await Promise.resolve();
    await Promise.resolve();
    expect(layout.dueCount).toBe(3);
    expect(getReviewToday).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);
    expect(syncNativeDueBadge).toHaveBeenCalledWith(3);

    await vi.advanceTimersByTimeAsync(HIDDEN_DUE_BADGE_POLL_MS);
    await Promise.resolve();
    expect(getReviewToday).toHaveBeenCalledTimes(2);

    doc.hidden = false;
    for (const fn of listeners) fn();
    await Promise.resolve();
    await Promise.resolve();
    expect(getReviewToday).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(HIDDEN_DUE_BADGE_POLL_MS);
    expect(getReviewToday).toHaveBeenCalledTimes(3);
  });
});
