import { Service } from '@rabjs/react';
import { getReviewToday } from '@/api/review';
import { SyncService, type SyncEvent } from '@/services/sync.service';

export class LayoutService extends Service {
  dueCount = 0;
  private unsubSync: (() => void) | null = null;

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
  }

  override destroy(): void {
    this.unsubSync?.();
    this.unsubSync = null;
    super.destroy();
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
    try {
      const today = await getReviewToday();
      this.dueCount = Math.max(0, today.total - today.reviewedToday);
    } catch {
      this.dueCount = 0;
    }
  }
}
