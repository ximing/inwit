import { Service } from '@rabjs/react';
import {
  isChatQuestion,
  type Document,
  type DocumentDetail,
  type DocumentListItem,
  type Topic,
  type TopicSuggestion,
  type WeeklyReportLatest,
} from '@inwit/dto';
import { getLatestWeeklyReport } from '@/api/reports';
import { createChat, createDocument, getDocument, listDocuments } from '@/api/documents';
import { errorMessage } from '@/api/client';
import {
  acceptTopicSuggestion,
  createTopic,
  dismissTopicSuggestion,
  listTopicSuggestions,
  listTopics,
} from '@/api/topics';
import { ROUTES } from '@/routes';

const PAGE_SIZE = 50;
const POLL_MS = 3000;
const TOAST_MS = 3200;

function asListItem(
  doc: Document,
  extra: { cardCount: number; topicTitle: string | null },
): DocumentListItem {
  return {
    ...doc,
    cardCount: extra.cardCount,
    topicTitle: extra.topicTitle,
  };
}

function mergeDetail(item: DocumentListItem, detail: DocumentDetail): DocumentListItem {
  return {
    ...item,
    title: detail.title,
    contentMd: detail.contentMd,
    status: detail.status,
    answer: detail.answer,
    linkHint: detail.linkHint,
    updatedAt: detail.updatedAt,
    cardCount: detail.cards.length,
    topicTitle: detail.topicTitle ?? item.topicTitle,
  };
}

export class HomeService extends Service {
  topics: Topic[] = [];
  documents: DocumentListItem[] = [];
  total = 0;
  /** null = 全部（inbox + 各主题） */
  topicId: string | null = null;
  draft = '';
  error: string | null = null;
  toast: string | null = null;
  suggestion: TopicSuggestion | null = null;
  weeklyReport: WeeklyReportLatest | null = null;
  suggestDeadline = 0;
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

  get hasMore(): boolean {
    return this.documents.length < this.total;
  }

  get canSend(): boolean {
    return this.draft.trim().length > 0 && !this.$model.send.loading;
  }

  get draftLooksLikeQuestion(): boolean {
    return isChatQuestion(this.draft);
  }

  get editorHref(): string {
    return this.topicId ? `${ROUTES.editorNew}?topicId=${this.topicId}` : ROUTES.editorNew;
  }

  setDraft(value: string): void {
    this.draft = value;
  }

  selectTopic(id: string | null): void {
    if (this.topicId === id) return;
    this.topicId = id;
    void this.loadDocuments();
  }

  openNewTopic(): void {
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
    this.toast = message;
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = null;
      this.toastTimer = null;
    }, TOAST_MS);
  }

  async load(): Promise<void> {
    this.error = null;
    try {
      this.topics = await listTopics('active');
      if (this.topicId && !this.topics.some((topic) => topic.id === this.topicId)) {
        this.topicId = null;
      }
      await Promise.all([this.loadDocuments(), this.loadSuggestions(), this.loadWeeklyReport()]);
    } catch (err) {
      this.error = errorMessage(err, '加载文档失败');
    }
  }

  async loadDocuments(): Promise<void> {
    const gen = ++this.loadGen;
    this.error = null;
    try {
      const page = await listDocuments({
        topicId: this.topicId ?? undefined,
        limit: PAGE_SIZE,
        offset: 0,
      });
      if (gen !== this.loadGen) return;
      this.documents = page.items;
      this.total = page.total;
      this.syncPolling();
    } catch (err) {
      if (gen !== this.loadGen) return;
      this.error = errorMessage(err, '加载文档失败');
    }
  }

  async loadMore(): Promise<void> {
    if (!this.hasMore || this.$model.loadMore.loading) return;
    const page = await listDocuments({
      topicId: this.topicId ?? undefined,
      limit: PAGE_SIZE,
      offset: this.documents.length,
    });
    this.documents = [...this.documents, ...page.items];
    this.total = page.total;
    this.syncPolling();
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
            contentMd: content,
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
      this.total += 1;
      this.showToast(useChat ? '问题扔出去了，正在答' : '已收下，消化中');
      this.syncPolling();
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
      await this.loadDocuments();
    } catch (err) {
      this.newTopicError = errorMessage(err, '创建主题失败');
    }
  }

  stopPolling(): void {
    if (this.pollTimer === null) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  override destroy(): void {
    this.stopPolling();
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
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
      // Banner is optional; keep the last snapshot.
    }
  }

  async acceptSuggestion(): Promise<Topic | null> {
    if (!this.suggestion) return null;
    this.error = null;
    try {
      const result = await acceptTopicSuggestion(this.suggestion.key);
      this.suggestion = null;
      this.topics = [result.topic, ...this.topics.filter((topic) => topic.id !== result.topic.id)];
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
    if (pending || waitingSuggest) this.startPolling();
    else this.stopPolling();
  }

  startPolling(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => {
      void this.tickPending();
    }, POLL_MS);
  }

  async tickPending(): Promise<void> {
    const pending = this.documents.filter((item) => item.status === 'pending');
    if (pending.length > 0) {
      await Promise.all(pending.map((item) => this.refreshOne(item.id)));
    }
    if (pending.length > 0 || Date.now() < this.suggestDeadline) {
      await this.loadSuggestions();
    }
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
}
