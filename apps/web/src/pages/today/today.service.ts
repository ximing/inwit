import { Service } from '@rabjs/react';
import {
  isChatQuestion,
  type AnnotationResurface,
  type DocumentListItem,
  type Job,
  type ReviewStats,
  type Topic,
  type TopicSuggestion,
  type WeeklyReportLatest,
} from '@inwit/dto';
import {
  acceptAnnotationResurface,
  dismissAnnotationResurface,
  getAnnotationResurface,
} from '@/api/annotations';
import { errorMessage } from '@/api/client';
import { listDocuments } from '@/api/documents';
import {
  asListItem,
  captureIsChat,
  fetchMergedItem,
  hasPendingDoc,
  sendCapture,
  showToast,
  startPolling,
  stopPolling,
  stopToast,
} from '@/lib/doc-list';
import { listJobs } from '@/api/jobs';
import { getLatestWeeklyReport } from '@/api/reports';
import { getReviewStats, getReviewToday } from '@/api/review';
import {
  acceptTopicSuggestion,
  createTopic,
  dismissTopicSuggestion,
  listTopicSuggestions,
  listTopics,
} from '@/api/topics';

const RECENT_DOCS = 4;
const RECENT_JOBS = 5;

export class TodayService extends Service {
  topics: Topic[] = [];
  documents: DocumentListItem[] = [];
  documentTotal = 0;
  jobs: Job[] = [];
  /** null = 不指定主题（与旧首页「全部」默认一致，只影响捕获，不筛选最近文档） */
  topicId: string | null = null;
  draft = '';
  error: string | null = null;
  toast: string | null = null;
  suggestion: TopicSuggestion | null = null;
  resurface: AnnotationResurface | null = null;
  weeklyReport: WeeklyReportLatest | null = null;
  dueCount = 0;
  /** 超出每日上限、会被顺延的积压卡片数。 */
  overdueBacklog = 0;
  streak = 0;
  totalCards = 0;
  reviewLoaded = false;
  suggestDeadline = 0;
  topicMenuOpen = false;
  newTopicOpen = false;
  newTitle = '';
  newGoal = '';
  newTopicError: string | null = null;
  pollTimer: ReturnType<typeof setInterval> | null = null;
  toastTimer: ReturnType<typeof setTimeout> | null = null;
  loadGen = 0;

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

  setDraft(value: string): void {
    this.draft = value;
  }

  selectTopic(id: string | null): void {
    this.topicId = id;
    this.topicMenuOpen = false;
  }

  toggleTopicMenu(): void {
    this.topicMenuOpen = !this.topicMenuOpen;
  }

  closeTopicMenu(): void {
    this.topicMenuOpen = false;
  }

  openNewTopic(): void {
    this.topicMenuOpen = false;
    this.newTopicOpen = true;
    this.newTitle = '';
    this.newGoal = '';
    this.newTopicError = null;
  }

  closeNewTopic(): void {
    this.newTopicOpen = false;
    this.newTopicError = null;
  }

  setNewTitle(value: string): void {
    this.newTitle = value;
  }

  setNewGoal(value: string): void {
    this.newGoal = value;
  }

  showToast(message: string): void {
    showToast(this, message);
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
        this.loadResurface(),
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
    const useChat = captureIsChat(content, mode);
    try {
      const { created } = await sendCapture({ content, topicId: this.topicId, mode });
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

  async createNewTopic(): Promise<void> {
    const title = this.newTitle.trim();
    if (title.length === 0) {
      this.newTopicError = '请填写标题';
      return;
    }
    this.newTopicError = null;
    try {
      const goal = this.newGoal.trim();
      const topic = await createTopic({
        title,
        ...(goal.length > 0 ? { goal } : {}),
      });
      this.topics = [topic, ...this.topics];
      this.topicId = topic.id;
      this.newTopicOpen = false;
    } catch (err) {
      this.newTopicError = errorMessage(err, '创建主题失败');
    }
  }

  stopPolling(): void {
    stopPolling(this);
  }

  override destroy(): void {
    this.stopPolling();
    stopToast(this);
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

  async loadResurface(): Promise<void> {
    try {
      const result = await getAnnotationResurface();
      this.resurface = result.resurface;
    } catch {
      // Resurface banner is optional; keep the last snapshot.
    }
  }

  async acceptResurface(annotationId: string): Promise<void> {
    if (!this.resurface) return;
    this.error = null;
    try {
      const result = await acceptAnnotationResurface(this.resurface.key, annotationId);
      this.resurface = result.resurface;
      this.showToast('已转成卡片，进入复习队列');
    } catch (err) {
      this.error = errorMessage(err, '转卡片失败');
    }
  }

  async dismissResurface(): Promise<void> {
    if (!this.resurface) return;
    this.error = null;
    try {
      await dismissAnnotationResurface(this.resurface.key);
      this.resurface = null;
    } catch (err) {
      this.error = errorMessage(err, '忽略失败');
    }
  }

  syncPolling(): void {
    const pending = hasPendingDoc(this.documents);
    const waitingSuggest = Date.now() < this.suggestDeadline;
    if (pending || waitingSuggest) this.startPolling();
    else this.stopPolling();
  }

  startPolling(): void {
    startPolling(this, () => void this.tickPending());
  }

  async tickPending(): Promise<void> {
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
    const prev = this.documents.find((item) => item.id === id);
    if (!prev) return;
    const merged = await fetchMergedItem(prev);
    if (!merged) return;
    this.documents = this.documents.map((item) => (item.id === id ? merged : item));
    if (prev.status === 'pending' && merged.status === 'digested' && !merged.topicId) {
      this.suggestDeadline = Date.now() + 120_000;
    }
  }

  private applyStats(stats: ReviewStats): void {
    this.streak = stats.streak.current;
    this.totalCards = stats.totalCards;
    this.overdueBacklog = Math.max(0, stats.overdueCount - this.dueCount);
  }
}
