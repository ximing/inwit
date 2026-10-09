import { Service } from '@rabjs/react';
import { getReviewToday } from '@/api/review';
import { isTauriRuntime } from '@/platform/runtime';
import { syncNativeDueBadge } from '@/services/native-due-badge';
import { SyncService, type SyncEvent } from '@/services/sync.service';

/** 窗口隐藏后同步轮询会停，图标角标按这个间隔自己拉今日队列。 */
export const HIDDEN_DUE_BADGE_POLL_MS = 60_000;

export class LayoutService extends Service {
  dueCount = 0;
  private dueGen = 0;
  private unsubSync: (() => void) | null = null;
  private badgeTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    void this.refreshDue();
    // 壳不随路由卸载，人在文档或设置页时徽章也要跟着复习变更走。
    try {
      this.unsubSync = this.resolve(SyncService).subscribe((event) => {
        this.onSync(event);
      });
    } catch {
      this.unsubSync = null;
    }
    this.watchHiddenBadge();
  }

  override destroy(): void {
    this.dueGen += 1;
    this.unsubSync?.();
    this.unsubSync = null;
    this.stopHiddenBadgeWatch();
    void syncNativeDueBadge(0);
    super.destroy();
  }

  /** 窗口隐藏后同步轮询会停。桌面图标上的待复习数仍要自己刷新。 */
  private watchHiddenBadge(): void {
    if (!isTauriRuntime()) return;
    document.addEventListener('visibilitychange', this.onBadgeVisibility);
    this.syncHiddenBadgePoll(false);
  }

  private stopHiddenBadgeWatch(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onBadgeVisibility);
    }
    this.clearBadgeTimer();
  }

  private onBadgeVisibility = (): void => {
    const hidden = document.hidden;
    this.syncHiddenBadgePoll(hidden);
    if (!hidden) void this.refreshDue();
  };

  private syncHiddenBadgePoll(refreshNow: boolean): void {
    this.clearBadgeTimer();
    if (typeof document === 'undefined' || !document.hidden) return;
    if (refreshNow) void this.refreshDue();
    this.badgeTimer = setInterval(() => {
      void this.refreshDue();
    }, HIDDEN_DUE_BADGE_POLL_MS);
  }

  private clearBadgeTimer(): void {
    if (this.badgeTimer === null) return;
    clearInterval(this.badgeTimer);
    this.badgeTimer = null;
  }

  private onSync(event: SyncEvent): void {
    if (event.type === 'reset') {
      void this.refreshDue();
      return;
    }
    if (event.type !== 'changes') return;
    if (event.changes.some((change) => change.scope === 'review')) void this.refreshDue();
  }

  async refreshDue(): Promise<void> {
    const gen = ++this.dueGen;
    try {
      const today = await getReviewToday();
      if (gen !== this.dueGen) return;
      this.publishDue(Math.max(0, today.total - today.reviewedToday));
    } catch {
      if (gen !== this.dueGen) return;
      this.publishDue(0);
    }
  }

  private publishDue(count: number): void {
    this.dueCount = count;
    void syncNativeDueBadge(count);
  }
}
