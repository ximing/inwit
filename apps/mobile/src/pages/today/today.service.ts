import { Service } from '@rabjs/react';
import {
  isChatQuestion,
  type Document,
  type DocumentDetail,
  type DocumentListItem,
  type Job,
  type ReviewStats,
  type Topic,
  type TopicSuggestion,
  type WeeklyReportLatest,
} from '@inwit/dto';
import { errorMessage } from '@/api/client';
import { createChat, createDocument, getDocument, listDocuments } from '@/api/documents';
import { listJobs } from '@/api/jobs';
import { textToPmDoc } from '@/lib/pm-doc';
import { getLatestWeeklyReport } from '@/api/reports';
import { getReviewStats, getReviewToday } from '@/api/review';
import {
  acceptTopicSuggestion,
  createTopic,
  dismissTopicSuggestion,
  listTopicSuggestions,
  listTopics,
} from '@/api/topics';
import { LayoutService } from '@/services/layout.service';
import { ToastService } from '@/services/toast.service';

const RECENT_DOCS = 4;
const RECENT_JOBS = 5;
const POLL_MS = 3000;

function asListItem(
  doc: Document,
  extra: { cardCount: number; topicTitle: string | null },
): DocumentListItem {
  return {
    ...doc,
    cardCount: extra.cardCount,
    proposedCount: 0,
    topicTitle: extra.topicTitle,
  };
}

function mergeDetail(item: DocumentListItem, detail: DocumentDetail): DocumentListItem {
  return {
    ...item,
    title: detail.title,
    description: detail.description,
    contentJson: detail.contentJson,
    status: detail.status,
    answer: detail.answer,
    linkHint: detail.linkHint,
    updatedAt: detail.updatedAt,
    cardCount: detail.cards.filter((card) => card.acceptance === 'accepted').length,
    proposedCount: detail.cards.filter((card) => card.acceptance === 'proposed').length,
    topicTitle: detail.topicTitle ?? item.topicTitle,
  };
}

export class TodayService extends Service {
  topics: Topic[] = [];
  documents: DocumentListItem[] = [];
  documentTotal = 0;
  jobs: Job[] = [];
  topicId: string | null = null;
  draft = '';
  error: string | null = null;
  suggestion: TopicSuggestion | null = null;
  weeklyReport: WeeklyReportLatest | null = null;
  dueCount = 0;
  streak = 0;
  totalCards = 0;
  reviewLoaded = false;
  suggestDeadline = 0;
  focused = false;
  appActive = true;
  pollTimer: ReturnType<typeof setInterval> | null = null;
  loadGen = 0;

  get layout(): LayoutService {
    return this.resolve(LayoutService);
  }

  get toastService(): ToastService {
    return this.resolve(ToastService);
  }

  get currentTopic(): Topic | null {
    if (this.topicId === null) return null;
    return this.topics.find((topic) => topic.id === this.topicId) ?? null;
  }

  get recentDocuments(): DocumentListItem[] {
    return this.documents.slice(0, RECENT_DOCS);
  }

  get canSend(): boolean {
    return this.draft.trim().length > 0 && !this.$model.send.loading;
  }

  get draftLooksLikeQuestion(): boolean {
    return isChatQuestion(this.draft);
  }

  get pollingAllowed(): boolean {
    return this.focused && this.appActive;
  }

  setDraft(value: string): void {
    this.draft = value;
  }

  selectTopic(id: string | null): void {
    this.topicId = id;
  }

  setFocused(value: boolean): void {
    this.focused = value;
    if (!value) this.stopPolling();
    else this.syncPolling();
  }

  setAppActive(value: boolean): void {
    this.appActive = value;
    if (!value) this.stopPolling();
    else this.syncPolling();
  }

  showToast(message: string): void {
    this.toastService.show(message);
  }

  async load(): Promise<void> {
    this.error = null;
    try {
      this.topics = await listTopics('active');
      if (this.topicId && !this.topics.some((topic) => topic.id === this.topicId)) {
        this.topicId = null;
      }
      await Promise.all([
        this.loadDocuments(),
        this.loadSuggestions(),
        this.loadWeeklyReport(),
        this.loadReview(),
        this.loadJobs(),
      ]);
    } catch (err) {
      this.error = errorMessage(err, '加载失败');
    }
  }

  async loadDocuments(): Promise<void> {
    const gen = ++this.loadGen;
    try {
      const page = await listDocuments({ limit: RECENT_DOCS, offset: 0 });
      if (gen !== this.loadGen) return;
      this.documents = page.items;
      this.documentTotal = page.total;
      this.syncPolling();
    } catch (err) {
      if (gen !== this.loadGen) return;
      this.error = errorMessage(err, '加载文档失败');
    }
  }

  async loadReview(): Promise<void> {
    try {
      const [today, stats] = await Promise.all([getReviewToday(), getReviewStats()]);
      this.dueCount = Math.max(0, today.total - today.reviewedToday);
      this.applyStats(stats);
      this.reviewLoaded = true;
      this.layout.setDueCount(this.dueCount);
    } catch {
      // Review strip is optional; keep the last snapshot.
    }
  }

  async loadJobs(): Promise<void> {
    try {
      const page = await listJobs({ limit: RECENT_JOBS, offset: 0 });
      this.jobs = page.items;
    } catch {
      // Activity is optional; keep the last snapshot.
    }
  }

  async send(mode: 'auto' | 'chat' | 'paste' = 'auto'): Promise<void> {
    const content = this.draft.trim();
    if (content.length === 0) return;
    this.error = null;
    const useChat = mode === 'chat' || (mode === 'auto' && isChatQuestion(content));
    try {
      const created = useChat
        ? await createChat({
            question: content,
            ...(this.topicId ? { topicId: this.topicId } : {}),
          })
        : await createDocument({
            contentJson: textToPmDoc(content),
            ...(this.topicId ? { topicId: this.topicId } : {}),
          });
      this.draft = '';
      this.documents = [
        asListItem(created, {
          cardCount: 0,
          topicTitle: this.currentTopic?.title ?? null,
        }),
        ...this.documents,
      ];
      this.documentTotal += 1;
      this.showToast(useChat ? '问题扔出去了，正在答' : '已收下，消化中');
      this.syncPolling();
      void this.loadJobs();
    } catch (err) {
      this.error = errorMessage(err, useChat ? '提问失败' : '发送失败');
    }
  }

  async createCaptureTopic(title: string, goal: string): Promise<string | null> {
    const trimmed = title.trim();
    if (trimmed.length === 0) return '请填写标题';
    try {
      const topic = await createTopic({
        title: trimmed,
        ...(goal.trim().length > 0 ? { goal: goal.trim() } : {}),
      });
      this.topics = [topic, ...this.topics.filter((item) => item.id !== topic.id)];
      this.topicId = topic.id;
      return null;
    } catch (err) {
      return errorMessage(err, '创建主题失败');
    }
  }

  stopPolling(): void {
    if (this.pollTimer === null) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  override destroy(): void {
    this.stopPolling();
    super.destroy();
  }

  async loadSuggestions(): Promise<void> {
    try {
      const items = await listTopicSuggestions();
      this.suggestion = items[0] ?? null;
      if (this.suggestion) this.suggestDeadline = 0;
    } catch {
      // Banner is optional; keep the last snapshot.
    }
  }

  async loadWeeklyReport(): Promise<void> {
    try {
      const result = await getLatestWeeklyReport();
      this.weeklyReport = result.report;
    } catch {
      // Card is optional; keep the last snapshot.
    }
  }

  async acceptSuggestion(): Promise<Topic | null> {
    if (!this.suggestion) return null;
    this.error = null;
    try {
      const result = await acceptTopicSuggestion(this.suggestion.key);
      this.suggestion = null;
      this.topics = [result.topic, ...this.topics.filter((topic) => topic.id !== result.topic.id)];
      this.topicId = result.topic.id;
      this.showToast(`已开主题「${result.topic.title}」`);
      return result.topic;
    } catch (err) {
      this.error = errorMessage(err, '开主题失败');
      return null;
    }
  }

  async dismissSuggestion(): Promise<void> {
    if (!this.suggestion) return;
    this.error = null;
    try {
      await dismissTopicSuggestion(this.suggestion.key);
      this.suggestion = null;
      await this.loadSuggestions();
    } catch (err) {
      this.error = errorMessage(err, '忽略失败');
    }
  }

  syncPolling(): void {
    const pending = this.documents.some((item) => item.status === 'pending');
    const waitingSuggest = Date.now() < this.suggestDeadline;
    if ((pending || waitingSuggest) && this.pollingAllowed) this.startPolling();
    else this.stopPolling();
  }

  startPolling(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => {
      void this.tickPending();
    }, POLL_MS);
  }

  async tickPending(): Promise<void> {
    if (!this.pollingAllowed) {
      this.stopPolling();
      return;
    }
    const pending = this.documents.filter((item) => item.status === 'pending');
    if (pending.length > 0) {
      await Promise.all(pending.map((item) => this.refreshOne(item.id)));
    }
    if (pending.length > 0 || Date.now() < this.suggestDeadline) {
      await this.loadSuggestions();
    }
    await this.loadJobs();
    this.syncPolling();
  }

  async refreshOne(id: string): Promise<void> {
    try {
      const prev = this.documents.find((item) => item.id === id);
      const detail = await getDocument(id);
      this.documents = this.documents.map((item) =>
        item.id === id ? mergeDetail(item, detail) : item,
      );
      if (prev?.status === 'pending' && detail.status === 'digested' && !detail.topicId) {
        this.suggestDeadline = Date.now() + 120_000;
      }
    } catch {
      // Transient poll errors should not wipe the list.
    }
  }

  private applyStats(stats: ReviewStats): void {
    this.streak = stats.streak.current;
    this.totalCards = stats.totalCards;
  }
}
