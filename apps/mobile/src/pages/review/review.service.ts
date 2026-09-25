import { Service } from '@rabjs/react';
import {
  DEFAULT_REVIEW_SETTINGS,
  type ReviewSettings,
  type ReviewStats,
  type ReviewStrugglingCard,
  type ReviewToday,
} from '@inwit/dto';
import { errorMessage } from '@/api/client';
import {
  getReviewCheckins,
  getReviewSettings,
  getReviewStats,
  getReviewToday,
  getStrugglingCards,
  updateReviewSettings,
} from '@/api/review';
import { LayoutService } from '@/services/layout.service';
import { ToastService } from '@/services/toast.service';
import { countsByDate, isCurrentMonth, monthKeyOf, shiftMonthKey } from './checkin-logic';
import { adoptSettings, cloneSettings, normalizeDraft } from './review-settings-logic';

export class ReviewService extends Service {
  items: ReviewToday['items'] = [];
  reviewedToday = 0;
  total = 0;
  ready = false;
  error: string | null = null;
  stats: ReviewStats | null = null;
  settings: ReviewSettings = cloneSettings(DEFAULT_REVIEW_SETTINGS);
  struggling: ReviewStrugglingCard[] = [];
  calMonth: string = monthKeyOf(new Date());
  checkins: Record<string, number> = {};

  get layout(): LayoutService {
    return this.resolve(LayoutService);
  }

  get toastService(): ToastService {
    return this.resolve(ToastService);
  }

  get dueCount(): number {
    return Math.max(0, this.total - this.reviewedToday);
  }

  /** Cards past the daily cap, carried to tomorrow. */
  get backlogCount(): number {
    const overdue = this.stats?.overdueCount ?? 0;
    return Math.max(0, overdue - this.dueCount);
  }

  showToast(message: string): void {
    this.toastService.show(message);
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
      const month = monthKeyOf(new Date());
      if (this.calMonth !== month) {
        this.calMonth = month;
        this.checkins = {};
      }
      this.refreshDueBadge();
    } catch (err) {
      this.error = errorMessage(err, '复习中心加载失败');
    } finally {
      this.ready = true;
    }
    void this.loadStruggling();
    void this.loadCheckins(this.calMonth);
  }

  async loadStruggling(): Promise<void> {
    try {
      this.struggling = await getStrugglingCards();
    } catch {
      // Keep the last list. Struggling cards are optional.
    }
  }

  async loadCheckins(month = this.calMonth): Promise<void> {
    try {
      const data = await getReviewCheckins(month);
      if (month !== this.calMonth) return;
      this.checkins = countsByDate(data.days);
    } catch {
      // Keep the last month. The heatmap is optional.
    }
  }

  async shiftCalMonth(delta: number): Promise<void> {
    if (delta === 0) return;
    if (delta > 0 && isCurrentMonth(this.calMonth, new Date())) return;
    const next = shiftMonthKey(this.calMonth, delta);
    if (next > monthKeyOf(new Date())) return;
    this.calMonth = next;
    this.checkins = {};
    await this.loadCheckins(next);
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
