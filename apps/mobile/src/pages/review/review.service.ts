import { Service } from '@rabjs/react';
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings, type ReviewStats, type ReviewToday } from '@inwit/dto';
import { errorMessage } from '@/api/client';
import { getReviewSettings, getReviewStats, getReviewToday, updateReviewSettings } from '@/api/review';
import { LayoutService } from '@/services/layout.service';
import { ToastService } from '@/services/toast.service';
import { adoptSettings, cloneSettings, normalizeDraft } from './review-settings-logic';

export class ReviewService extends Service {
  items: ReviewToday['items'] = [];
  reviewedToday = 0;
  total = 0;
  ready = false;
  error: string | null = null;
  stats: ReviewStats | null = null;
  settings: ReviewSettings = cloneSettings(DEFAULT_REVIEW_SETTINGS);

  get layout(): LayoutService {
    return this.resolve(LayoutService);
  }

  get toastService(): ToastService {
    return this.resolve(ToastService);
  }

  get dueCount(): number {
    return Math.max(0, this.total - this.reviewedToday);
  }

  private refreshDueBadge(): void {
    this.layout.setDueCount(this.dueCount);
    void this.layout.refreshDue();
  }

  applyToday(today: ReviewToday): void {
    this.items = today.items;
    this.reviewedToday = today.reviewedToday;
    this.total = today.total;
  }

  async load(): Promise<void> {
    this.error = null;
    try {
      const [today, stats, settings] = await Promise.all([
        getReviewToday(),
        getReviewStats(),
        getReviewSettings(),
      ]);
      this.applyToday(today);
      this.stats = stats;
      this.settings = adoptSettings(settings);
      this.refreshDueBadge();
    } catch (err) {
      this.error = errorMessage(err, '复习中心加载失败');
    } finally {
      this.ready = true;
    }
  }

  /** Prefetch today's queue then the screen navigates to session. */
  async startSession(): Promise<boolean> {
    this.error = null;
    try {
      const today = await getReviewToday();
      this.applyToday(today);
      this.refreshDueBadge();
      return true;
    } catch (err) {
      this.error = errorMessage(err, '今日队列拿不下来');
      return false;
    }
  }

  async saveSettings(input: ReviewSettings): Promise<boolean> {
    this.error = null;
    try {
      const saved = await updateReviewSettings(adoptSettings(normalizeDraft(input)));
      this.settings = adoptSettings(saved);
      this.toastService.show('设置已保存');
      return true;
    } catch (err) {
      this.error = errorMessage(err, '设置保存失败');
      return false;
    }
  }

  async restoreDefaults(): Promise<ReviewSettings | null> {
    this.error = null;
    try {
      const saved = await updateReviewSettings(cloneSettings(DEFAULT_REVIEW_SETTINGS));
      this.settings = adoptSettings(saved);
      this.toastService.show('已恢复默认');
      return cloneSettings(this.settings);
    } catch (err) {
      this.error = errorMessage(err, '恢复默认失败');
      return null;
    }
  }
}
