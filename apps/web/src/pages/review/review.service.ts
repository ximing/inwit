import { Service } from '@rabjs/react';
import {
  DEFAULT_REVIEW_SETTINGS,
  type ReviewFeedback,
  type ReviewQueueItem,
  type ReviewSettings,
  type ReviewStats,
  type ReviewStrugglingCard,
  type ReviewToday,
} from '@inwit/dto';
import { errorMessage } from '@/api/client';
import { archiveCard, getCardImage, suspendCard } from '@/api/cards';
import { maskCloze, stripCloze } from '@/lib/cloze';
import {
  isPresignedStale,
  livePresignedUrl,
  shouldRetryPresign,
  type PresignedUrlEntry,
} from '@/lib/presign-cache-logic';
import {
  getReviewSettings,
  getReviewStats,
  getReviewToday,
  getStrugglingCards,
  submitReviewFeedback,
  updateReviewSettings,
} from '@/api/review';
import { LayoutService } from '@/shell/layout.service';

const TOAST_MS = 3200;

export function cloneSettings(settings: ReviewSettings): ReviewSettings {
  return {
    dailyReviewLimit: settings.dailyReviewLimit,
    dailyNewLimit: settings.dailyNewLimit,
    startingEase: settings.startingEase,
    fuzzyScale: settings.fuzzyScale,
    learningSteps: [...settings.learningSteps],
  };
}

export class ReviewService extends Service {
  mode: 'hub' | 'session' = 'hub';
  items: ReviewQueueItem[] = [];
  reviewedToday = 0;
  total = 0;
  flipped = false;
  ready = false;
  error: string | null = null;
  stats: ReviewStats | null = null;
  struggling: ReviewStrugglingCard[] = [];
  settings: ReviewSettings = cloneSettings(DEFAULT_REVIEW_SETTINGS);
  lastFeedback: ReviewFeedback | null = null;
  toast: string | null = null;
  toastTimer: ReturnType<typeof setTimeout> | null = null;
  cardImageUrls: Record<string, PresignedUrlEntry> = {};
  cardMenuOpen = false;

  get layout(): LayoutService {
    return this.resolve(LayoutService);
  }

  private refreshDueBadge(): void {
    try {
      void this.layout.refreshDue();
    } catch {
      // Rail badge is optional if this page is rendered without Layout.
    }
  }

  get current(): ReviewQueueItem | null {
    return this.items[0] ?? null;
  }

  get dueCount(): number {
    return Math.max(0, this.total - this.reviewedToday);
  }

  /** 超出每日上限、会被顺延的积压卡片数。 */
  get backlogCount(): number {
    const overdue = this.stats?.overdueCount ?? 0;
    return Math.max(0, overdue - this.dueCount);
  }

  get cardOrdinal(): number {
    if (this.total <= 0) return 0;
    if (this.items.length === 0) return this.total;
    return Math.min(this.total, this.reviewedToday + 1);
  }

  get progressPct(): number {
    if (this.total <= 0) return 0;
    return Math.min(100, (this.cardOrdinal / this.total) * 100);
  }

  get question(): string {
    const item = this.current;
    if (!item) return '';
    const first = item.card.questions[0];
    return maskCloze(first?.question ?? item.card.concept);
  }

  get answer(): string {
    const item = this.current;
    if (!item) return '';
    const first = item.card.questions[0];
    if (first) return stripCloze(first.answer);
    const parts = [item.card.example, item.card.confusionPoint].filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join('\n\n') : item.card.concept;
  }

  get crumb(): string | null {
    const placement = this.current?.mapPlacement;
    if (!placement) return null;
    return `${placement.topicTitle} · ${placement.nodePath}`;
  }

  get currentImageUrl(): string | null {
    const id = this.current?.card.id;
    if (!id || !this.current?.card.hasImage) return null;
    return livePresignedUrl(this.cardImageUrls[id]);
  }

  async loadCardImage(id: string, force = false): Promise<string | null> {
    const existing = this.cardImageUrls[id];
    if (!force && existing && !isPresignedStale(existing)) return existing.url;
    try {
      const { url } = await getCardImage(id);
      this.cardImageUrls = { ...this.cardImageUrls, [id]: { url, fetchedAt: Date.now() } };
      return url;
    } catch {
      return null;
    }
  }

  retryCardImage(id: string): void {
    if (!shouldRetryPresign(this.cardImageUrls[id])) return;
    void this.loadCardImage(id, true);
  }

  get tomorrowDue(): number {
    return this.stats?.forecast[1]?.count ?? 0;
  }

  get grading(): boolean {
    return this.$model.grade.loading;
  }

  showToast(message: string): void {
    this.toast = message;
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = null;
      this.toastTimer = null;
    }, TOAST_MS);
  }

  flip(): void {
    if (!this.current || this.grading) return;
    this.flipped = !this.flipped;
  }

  toggleCardMenu(): void {
    this.cardMenuOpen = !this.cardMenuOpen;
  }

  closeCardMenu(): void {
    this.cardMenuOpen = false;
  }

  /** Drop the current card from the session without a review outcome. */
  private dropCurrent(): void {
    this.items = this.items.slice(1);
    this.total = Math.max(this.reviewedToday, this.total - 1);
    this.flipped = false;
    this.refreshDueBadge();
  }

  /** 已熟悉：当前卡不再安排复习，可在文档页卡片栏恢复。 */
  async markCurrentFamiliar(): Promise<void> {
    const item = this.current;
    if (!item || this.grading) return;
    this.closeCardMenu();
    try {
      await suspendCard(item.card.id);
      this.dropCurrent();
      this.showToast('已标记为熟悉，不再安排复习');
    } catch (err) {
      this.error = errorMessage(err, '操作没成功，再试一次');
    }
  }

  /** Soft delete: 当前卡移入回收站，可在设置里恢复。 */
  async removeCurrentCard(): Promise<void> {
    const item = this.current;
    if (!item || this.grading) return;
    this.closeCardMenu();
    try {
      await archiveCard(item.card.id);
      this.dropCurrent();
      this.showToast('已移入回收站，可在设置里恢复');
    } catch (err) {
      this.error = errorMessage(err, '没删掉，再试一次');
    }
  }

  applyToday(today: ReviewToday): void {
    this.items = today.items;
    this.reviewedToday = today.reviewedToday;
    this.total = today.total;
  }

  async load(): Promise<void> {
    this.error = null;
    this.flipped = false;
    this.lastFeedback = null;
    try {
      const [today, stats, settings] = await Promise.all([
        getReviewToday(),
        getReviewStats(),
        getReviewSettings(),
      ]);
      this.applyToday(today);
      this.stats = stats;
      this.settings = cloneSettings(settings);
      this.refreshDueBadge();
    } catch (err) {
      this.error = errorMessage(err, '复习中心加载失败');
    } finally {
      this.ready = true;
    }
    void this.loadStruggling();
  }

  /** 薄弱卡片是锦上添花，失败时静默保留旧列表。 */
  private async loadStruggling(): Promise<void> {
    try {
      this.struggling = await getStrugglingCards();
    } catch {
      // keep last snapshot
    }
  }

  async startSession(): Promise<void> {
    this.error = null;
    this.flipped = false;
    this.lastFeedback = null;
    try {
      const today = await getReviewToday();
      this.applyToday(today);
      this.mode = 'session';
      this.refreshDueBadge();
    } catch (err) {
      this.error = errorMessage(err, '今日队列拿不下来');
    }
  }

  async exitSession(): Promise<void> {
    this.mode = 'hub';
    this.flipped = false;
    this.lastFeedback = null;
    await this.load();
  }

  async grade(feedback: ReviewFeedback): Promise<void> {
    const item = this.current;
    if (!item || this.grading || !this.flipped) return;
    this.error = null;
    this.lastFeedback = feedback;
    try {
      await submitReviewFeedback(item.card.id, feedback);
      this.reviewedToday += 1;
      this.items = this.items.slice(1);
      this.flipped = false;
      this.lastFeedback = null;
      this.refreshDueBadge();
      if (this.items.length === 0) {
        try {
          this.stats = await getReviewStats();
        } catch {
          // Complete copy can live without a fresh forecast.
        }
      }
    } catch (err) {
      this.error = errorMessage(err, '这次反馈没记下，再点一次');
      this.lastFeedback = null;
    }
  }

  async saveSettings(input: ReviewSettings): Promise<boolean> {
    this.error = null;
    try {
      const saved = await updateReviewSettings(input);
      this.settings = cloneSettings(saved);
      this.showToast('设置已保存');
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
      this.settings = cloneSettings(saved);
      this.showToast('已恢复默认');
      return cloneSettings(saved);
    } catch (err) {
      this.error = errorMessage(err, '恢复默认失败');
      return null;
    }
  }

  override destroy(): void {
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    super.destroy();
  }
}
