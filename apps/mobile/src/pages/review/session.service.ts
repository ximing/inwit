import { Service } from '@rabjs/react';
import {
  DEFAULT_REVIEW_SETTINGS,
  type ReviewFeedback,
  type ReviewQueueItem,
  type ReviewSettings,
  type ReviewStats,
} from '@inwit/dto';
import { router } from 'expo-router';
import { archiveCard, getCardImage, suspendCard } from '@/api/cards';
import { errorMessage } from '@/api/client';
import { getReviewSettings, getReviewStats, getReviewToday, submitReviewFeedback } from '@/api/review';
import {
  isPresignedStale,
  livePresignedUrl,
  shouldRetryPresign,
  type PresignedUrlEntry,
} from '@/lib/presign-cache-logic';
import { LayoutService } from '@/services/layout.service';
import { ToastService } from '@/services/toast.service';
import { adoptSettings, cloneSettings } from './review-settings-logic';
import {
  applyFlip,
  applyGradeFailure,
  applyGradeStart,
  applyGradeSuccess,
  applyRemoveCurrent,
  applyToday,
  canFlip,
  canGrade,
  cardOrdinal,
  completeTitle,
  currentItem,
  dueCountOf,
  emptySession,
  hasSource,
  progressPct,
  sessionAnswer,
  sessionCrumb,
  sessionPhase,
  sessionQuestion,
  type SessionState,
} from './review-session-logic';

/**
 * Session page service. State transitions go through `review-session-logic.ts`
 * so they stay aligned with web `ReviewService` (flip → grade → next / complete).
 */
export class ReviewSessionService extends Service {
  items: ReviewQueueItem[] = [];
  reviewedToday = 0;
  total = 0;
  flipped = false;
  lastFeedback: ReviewFeedback | null = null;
  ready = false;
  error: string | null = null;
  stats: ReviewStats | null = null;
  settings: ReviewSettings = cloneSettings(DEFAULT_REVIEW_SETTINGS);
  cardImageUrls: Record<string, PresignedUrlEntry> = {};
  removing = false;

  get layout(): LayoutService {
    return this.resolve(LayoutService);
  }

  get toastService(): ToastService {
    return this.resolve(ToastService);
  }

  private snapshot(): SessionState {
    return {
      items: this.items,
      reviewedToday: this.reviewedToday,
      total: this.total,
      flipped: this.flipped,
      lastFeedback: this.lastFeedback,
    };
  }

  private commit(next: SessionState): void {
    this.items = next.items;
    this.reviewedToday = next.reviewedToday;
    this.total = next.total;
    this.flipped = next.flipped;
    this.lastFeedback = next.lastFeedback;
  }

  get current(): ReviewQueueItem | null {
    return currentItem(this.snapshot());
  }

  get phase() {
    return sessionPhase(this.snapshot());
  }

  get dueCount(): number {
    return dueCountOf(this);
  }

  get cardOrdinal(): number {
    return cardOrdinal(this);
  }

  get progressPct(): number {
    return progressPct(this);
  }

  get question(): string {
    return sessionQuestion(this.current);
  }

  get answer(): string {
    return sessionAnswer(this.current);
  }

  get crumb(): string | null {
    return sessionCrumb(this.current);
  }

  get showSource(): boolean {
    return hasSource(this.current);
  }

  get completeHeadline(): string {
    return completeTitle(this.reviewedToday);
  }

  get currentImageUrl(): string | null {
    const id = this.current?.card.id;
    if (!id || !this.current?.card.hasImage) return null;
    return livePresignedUrl(this.cardImageUrls[id]);
  }

  get tomorrowDue(): number {
    return this.stats?.forecast[1]?.count ?? 0;
  }

  get grading(): boolean {
    return this.$model.grade.loading || this.removing;
  }

  private refreshDueBadge(): void {
    this.layout.setDueCount(this.dueCount);
    void this.layout.refreshDue();
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

  flip(): void {
    if (!canFlip(this.snapshot(), this.grading)) return;
    this.commit(applyFlip(this.snapshot()));
  }

  async load(): Promise<void> {
    this.error = null;
    this.commit(emptySession());
    try {
      const [today, stats, settings] = await Promise.all([
        getReviewToday(),
        getReviewStats(),
        getReviewSettings(),
      ]);
      this.commit(applyToday(today));
      this.stats = stats;
      this.settings = adoptSettings(settings);
      this.refreshDueBadge();
    } catch (err) {
      this.error = errorMessage(err, '今日队列拿不下来');
    } finally {
      this.ready = true;
    }
  }

  async grade(feedback: ReviewFeedback): Promise<void> {
    const state = this.snapshot();
    const item = currentItem(state);
    if (!item || !canGrade(state, this.grading)) return;
    this.error = null;
    this.commit(applyGradeStart(state, feedback));
    try {
      await submitReviewFeedback(item.card.id, feedback);
      this.commit(applyGradeSuccess(this.snapshot()));
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
      this.commit(applyGradeFailure(this.snapshot()));
    }
  }

  async markCurrentFamiliar(): Promise<void> {
    const item = this.current;
    if (!item || this.grading) return;
    this.removing = true;
    this.error = null;
    try {
      await suspendCard(item.card.id);
      if (this.current?.card.id === item.card.id) {
        this.commit(applyRemoveCurrent(this.snapshot()));
        this.refreshDueBadge();
      }
      this.toastService.show('这张先放到一边');
    } catch (err) {
      this.error = errorMessage(err, '操作没成功，再试一次');
    } finally {
      this.removing = false;
    }
  }

  async archiveCurrent(): Promise<void> {
    const item = this.current;
    if (!item || this.grading) return;
    this.removing = true;
    this.error = null;
    try {
      await archiveCard(item.card.id);
      if (this.current?.card.id === item.card.id) {
        this.commit(applyRemoveCurrent(this.snapshot()));
        this.refreshDueBadge();
      }
      this.toastService.show('已移入回收站，可在设置里恢复');
    } catch (err) {
      this.error = errorMessage(err, '没删掉，再试一次');
    } finally {
      this.removing = false;
    }
  }

  onSourcePress(): void {
    const item = this.current;
    const docId = item?.card.documentId;
    if (!docId) {
      this.toastService.show('这张卡没有所属文档');
      return;
    }
    router.push({ pathname: '/docs/[id]', params: { id: docId, anchor: item.card.id } });
  }
}
