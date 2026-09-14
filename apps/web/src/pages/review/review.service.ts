import { Service } from '@rabjs/react';
import type {
  CardLinksResponse,
  MapPlacement,
  ReviewFeedback,
  ReviewQueueItem,
  ReviewStats,
  WeeklyReportLatest,
} from '@inwit/dto';
import { getCardLinks } from '@/api/cards';
import { errorMessage } from '@/api/client';
import { getLatestWeeklyReport } from '@/api/reports';
import { getReviewStats, getReviewToday, submitReviewFeedback } from '@/api/review';
import { groupCardLinks, uniqueRelatedCount, type RelatedGroup } from '@/lib/card-copy';

export class ReviewService extends Service {
  items: ReviewQueueItem[] = [];
  reviewedToday = 0;
  total = 0;
  flipped = false;
  ready = false;
  error: string | null = null;
  stats: ReviewStats | null = null;
  weeklyReport: WeeklyReportLatest | null = null;
  lastFeedback: ReviewFeedback | null = null;
  links: CardLinksResponse | null = null;
  linksCardId: string | null = null;
  sheetOpen = false;

  get current(): ReviewQueueItem | null {
    return this.items[0] ?? null;
  }

  get done(): boolean {
    return this.items.length === 0 && this.total > 0;
  }

  get empty(): boolean {
    return this.items.length === 0 && this.total === 0;
  }

  get progressPct(): number {
    if (this.total <= 0) return 0;
    return Math.min(100, (this.reviewedToday / this.total) * 100);
  }

  get relatedCount(): number {
    if (!this.links) return 0;
    return uniqueRelatedCount(this.links);
  }

  get relatedGroups(): RelatedGroup[] {
    if (!this.links) return [];
    return groupCardLinks(this.links);
  }

  get mapPlacement(): MapPlacement | null {
    return this.current?.mapPlacement ?? null;
  }

  get question(): string {
    const item = this.current;
    if (!item) return '';
    const first = item.card.questions[0];
    return first?.question ?? item.card.concept;
  }

  get answer(): string {
    const item = this.current;
    if (!item) return '';
    const first = item.card.questions[0];
    if (first) return first.answer;
    const parts = [item.card.example, item.card.confusionPoint].filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join('\n\n') : item.card.concept;
  }

  flip(): void {
    if (!this.current) return;
    this.flipped = !this.flipped;
  }

  openSheet(): void {
    if (this.relatedCount === 0) return;
    this.sheetOpen = true;
  }

  closeSheet(): void {
    this.sheetOpen = false;
  }

  async load(): Promise<void> {
    this.ready = false;
    this.error = null;
    this.flipped = false;
    this.stats = null;
    this.weeklyReport = null;
    this.lastFeedback = null;
    this.links = null;
    this.linksCardId = null;
    this.sheetOpen = false;
    try {
      const today = await getReviewToday();
      this.items = today.items;
      this.reviewedToday = today.reviewedToday;
      this.total = today.total;
      if (this.items.length === 0) {
        this.stats = await getReviewStats();
        if (this.total > 0) await this.loadWeeklyReport();
      } else {
        void this.loadLinksForCurrent();
      }
    } catch (err) {
      this.error = errorMessage(err, '今日队列拿不下来');
    } finally {
      this.ready = true;
    }
  }

  async loadWeeklyReport(): Promise<void> {
    try {
      const result = await getLatestWeeklyReport();
      this.weeklyReport = result.report;
    } catch {
      this.weeklyReport = null;
    }
  }

  async loadLinksForCurrent(): Promise<void> {
    const item = this.current;
    if (!item) {
      this.links = null;
      this.linksCardId = null;
      this.sheetOpen = false;
      return;
    }
    const cardId = item.card.id;
    if (this.linksCardId === cardId && this.links) return;
    this.linksCardId = cardId;
    this.sheetOpen = false;
    try {
      const links = await getCardLinks(cardId);
      if (this.current?.card.id !== cardId) return;
      this.links = links;
    } catch {
      if (this.current?.card.id !== cardId) return;
      this.links = { outgoing: [], incoming: [] };
    }
  }

  async grade(feedback: ReviewFeedback): Promise<void> {
    const item = this.current;
    if (!item || this.$model.grade.loading) return;
    this.error = null;
    this.lastFeedback = feedback;
    try {
      await submitReviewFeedback(item.card.id, feedback);
      this.reviewedToday += 1;
      this.items = this.items.slice(1);
      this.flipped = false;
      this.sheetOpen = false;
      this.links = null;
      this.linksCardId = null;
      if (this.items.length === 0) {
        this.stats = await getReviewStats();
        await this.loadWeeklyReport();
      } else {
        void this.loadLinksForCurrent();
      }
    } catch (err) {
      this.error = errorMessage(err, '这次反馈没记下，再点一次');
      this.lastFeedback = null;
    }
  }
}
