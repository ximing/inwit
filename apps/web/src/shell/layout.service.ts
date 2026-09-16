import { Service } from '@rabjs/react';
import { getReviewToday } from '@/api/review';

export class LayoutService extends Service {
  dueCount = 0;

  constructor() {
    super();
    void this.refreshDue();
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
