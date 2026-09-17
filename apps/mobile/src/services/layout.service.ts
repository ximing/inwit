import { Service } from '@rabjs/react';
import { getReviewToday } from '@/api/review';

/** Tab badge due count. Mirrors web `apps/web/src/shell/layout.service.ts`. */
export class LayoutService extends Service {
  dueCount = 0;

  constructor() {
    super();
    void this.refreshDue();
  }

  setDueCount(count: number): void {
    this.dueCount = Math.max(0, count);
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
