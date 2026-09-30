import { Service } from '@rabjs/react';
import { getReviewToday } from '@/api/review';
import { SyncService, type SyncEvent } from './sync.service';

/** Tab badge due count. Mirrors web `apps/web/src/shell/layout.service.ts`. */
export class LayoutService extends Service {
  dueCount = 0;
  private dueGen = 0;
  private unsubscribeSync: (() => void) | null = null;

  constructor() {
    super();
    try {
      this.unsubscribeSync = this.resolve(SyncService).subscribe((event) => {
        this.onSync(event);
      });
    } catch {
      this.unsubscribeSync = null;
    }
    void this.refreshDue();
  }

  setDueCount(count: number): void {
    this.dueCount = Math.max(0, count);
  }

  async refreshDue(): Promise<void> {
    const gen = ++this.dueGen;
    try {
      const today = await getReviewToday();
      if (gen !== this.dueGen) return;
      this.dueCount = Math.max(0, today.total - today.reviewedToday);
    } catch {
      if (gen !== this.dueGen) return;
      this.dueCount = 0;
    }
  }

  override destroy(): void {
    this.unsubscribeSync?.();
    this.unsubscribeSync = null;
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
}
