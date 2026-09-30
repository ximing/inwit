import { Service } from '@rabjs/react';
import {
  isChatQuestion,
  listBodyPreview,
  toDocumentListItem,
  type Document,
  type DocumentDetail,
  type DocumentListItem,
  type Job,
  type ReviewStats,
  type Topic,
  type TopicSuggestion,
  type WeeklyReportLatest,
} from '@inwit/dto';
import { ApiError, errorMessage } from '@/api/client';
import { createChat, createDocument, getDocument, listDocuments } from '@/api/documents';
import { listJobs } from '@/api/jobs';
import { textToPmDoc } from '@/lib/pm-doc';
import { getLatestWeeklyReport } from '@/api/reports';
import { getReviewStats, getReviewToday } from '@/api/review';
import { consumeEchoes } from '@/lib/sync-echo';
import { coalesceChanges, planReloads, type EchoStamp, type ReloadIntent, type SyncView } from '@/lib/sync-plan';
import {
  acceptTopicSuggestion,
  createTopic,
  dismissTopicSuggestion,
  listTopicSuggestions,
  listTopics,
} from '@/api/topics';
import { LayoutService } from '@/services/layout.service';
import { SyncService, type SyncEvent } from '@/services/sync.service';
import { ToastService } from '@/services/toast.service';

const RECENT_DOCS = 4;
const RECENT_JOBS = 5;
const LIST_LIMIT_MAX = 100;
const POLL_MS = 3000;

function asListItem(
  doc: Document,
  extra: { cardCount: number; topicTitle: string | null },
): DocumentListItem {
  return toDocumentListItem(doc, extra);
}

function mergeDetail(item: DocumentListItem, detail: DocumentDetail): DocumentListItem {
  return {
    ...item,
    title: detail.title,
    description: detail.description,
    status: detail.status,
    answer: detail.answer,
    linkHint: detail.linkHint,
    updatedAt: detail.updatedAt,
    cardCount: detail.cards.filter((card) => card.acceptance === 'accepted').length,
    proposedCount: detail.cards.filter((card) => card.acceptance === 'proposed').length,
    topicTitle: detail.topicTitle ?? item.topicTitle,
    preview: listBodyPreview(detail.contentJson),
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
  private sync: SyncService | null = null;
  private unsubscribeSync: (() => void) | null = null;
  private syncChain: Promise<void> = Promise.resolve();
  private echoes: EchoStamp[] = [];
  private pinned = new Set<string>();
  private rowGen = new Map<string, number>();
  private jobsGen = 0;
  private opGen = 0;
  private hiddenDocs = new Map<string, number>();
  private reviewGen = 0;
  private suggestGen = 0;
  private reportGen = 0;

  constructor() {
    super();
    try {
      this.sync = this.resolve(SyncService);
      this.unsubscribeSync = this.sync.subscribe((event) => this.onSyncEvent(event));
    } catch {
      this.sync = null;
    }
  }

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
    const listedAt = this.opGen;
    try {
      const page = await listDocuments({ limit: RECENT_DOCS, offset: 0 });
      if (gen !== this.loadGen) return;
      this.applyServerPage(page.items, page.total, [], false, listedAt);
      this.syncPolling();
    } catch (err) {
      if (gen !== this.loadGen) return;
      this.error = errorMessage(err, '加载文档失败');
    }
  }

  async loadReview(): Promise<void> {
    const gen = ++this.reviewGen;
    try {
      const today = await getReviewToday();
      if (gen !== this.reviewGen) return;
      this.dueCount = Math.max(0, today.total - today.reviewedToday);
      this.reviewLoaded = true;
      this.layout.setDueCount(this.dueCount);
    } catch {
      // Review strip is optional; keep the last snapshot.
    }
    try {
      const stats = await getReviewStats();
      if (gen !== this.reviewGen) return;
      this.applyStats(stats);
      this.reviewLoaded = true;
    } catch {
      // Stats are optional; keep the last snapshot.
    }
  }

  async loadJobs(): Promise<void> {
    const gen = ++this.jobsGen;
    try {
      const page = await listJobs({ limit: RECENT_JOBS, offset: 0 });
      if (gen !== this.jobsGen) return;
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
      this.pinned.add(created.id);
      this.bumpRow(created.id);
      this.documents = [
        asListItem(created, {
          cardCount: 0,
          topicTitle: this.currentTopic?.title ?? null,
        }),
        ...this.documents.filter((item) => item.id !== created.id),
      ];
      this.documentTotal += 1;
      this.echoDocumentRow(created.id, created.updatedAt);
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
    this.unsubscribeSync?.();
    this.unsubscribeSync = null;
    this.sync = null;
    this.stopPolling();
    super.destroy();
  }

  async loadSuggestions(): Promise<void> {
    const gen = ++this.suggestGen;
    try {
      const items = await listTopicSuggestions();
      if (gen !== this.suggestGen) return;
      this.suggestion = items[0] ?? null;
      if (this.suggestion) this.suggestDeadline = 0;
    } catch {
      // Banner is optional; keep the last snapshot.
    }
  }

  async loadWeeklyReport(): Promise<void> {
    const gen = ++this.reportGen;
    try {
      const result = await getLatestWeeklyReport();
      if (gen !== this.reportGen) return;
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
    if (this.syncActive()) {
      this.stopPolling();
      return;
    }
    const pending = this.documents.some((item) => item.status === 'pending');
    const waitingSuggest = Date.now() < this.suggestDeadline;
    if ((pending || waitingSuggest) && this.pollingAllowed) this.startPolling();
    else this.stopPolling();
  }

  startPolling(): void {
    if (this.syncActive()) return;
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
    const gen = this.bumpRow(id);
    try {
      const prev = this.documents.find((item) => item.id === id);
      const detail = await getDocument(id);
      if (this.rowGen.get(id) !== gen) return;
      if (!this.documents.some((item) => item.id === id)) return;
      this.documents = this.documents.map((item) =>
        item.id === id ? mergeDetail(item, detail) : item,
      );
      if (prev?.status === 'pending' && detail.status === 'digested' && !detail.topicId) {
        this.suggestDeadline = Date.now() + 120_000;
      }
      this.syncPolling();
    } catch (err) {
      if (this.rowGen.get(id) !== gen) return;
      if (err instanceof ApiError && err.status === 404) this.forgetDocument(id);
    }
  }

  private syncActive(): boolean {
    return this.sync?.active === true;
  }

  private bumpRow(id: string): number {
    const gen = (this.rowGen.get(id) ?? 0) + 1;
    this.rowGen.set(id, gen);
    return gen;
  }

  private echoDocumentRow(documentId: string, updatedAt: string | null | undefined): void {
    if (!updatedAt) return;
    const atMs = Date.parse(updatedAt);
    if (Number.isNaN(atMs)) return;
    const dup = this.echoes.some(
      (echo) => echo.scope === 'document' && echo.resourceId === documentId && echo.atMs === atMs,
    );
    if (dup) return;
    this.echoes.push({ scope: 'document', resourceId: documentId, atMs });
    if (this.echoes.length > 200) this.echoes.splice(0, this.echoes.length - 200);
  }

  private forgetDocument(id: string): void {
    this.pinned.delete(id);
    this.hiddenDocs.set(id, ++this.opGen);
    const had = this.documents.some((doc) => doc.id === id);
    this.documents = this.documents.filter((doc) => doc.id !== id);
    if (had) this.documentTotal = Math.max(0, this.documentTotal - 1);
    this.syncPolling();
  }

  private applyServerPage(
    items: DocumentListItem[],
    total: number,
    deleteIds: readonly string[],
    keepTail: boolean,
    listedAt: number,
  ): void {
    const visible = items.filter((item) => {
      const hiddenAt = this.hiddenDocs.get(item.id);
      if (hiddenAt === undefined) return true;
      if (hiddenAt > listedAt) return false;
      this.hiddenDocs.delete(item.id);
      return true;
    });
    const prev = new Map(this.documents.map((item) => [item.id, item]));
    const seen = new Set(visible.map((item) => item.id));
    for (const id of seen) this.pinned.delete(id);
    const merged = visible.map((item) => {
      const local = prev.get(item.id);
      if (!local) return item;
      const localMs = Date.parse(local.updatedAt);
      const nextMs = Date.parse(item.updatedAt);
      if (!Number.isNaN(localMs) && !Number.isNaN(nextMs) && localMs > nextMs) return local;
      return item;
    });
    const pinned = this.documents.filter((item) => this.pinned.has(item.id) && !seen.has(item.id));
    const tail = keepTail
      ? this.documents.filter((item) => !seen.has(item.id) && !this.pinned.has(item.id))
      : [];
    const drop = new Set(deleteIds);
    this.documents = [...pinned, ...merged, ...tail].filter((item) => !drop.has(item.id));
    this.documentTotal = Math.max(total, this.documents.length);
  }

  private onSyncEvent(event: SyncEvent): void {
    if (event.type === 'active') {
      if (event.active) this.stopPolling();
      else this.syncPolling();
      return;
    }
    this.syncChain = this.syncChain.then(() => this.handleSync(event)).catch(() => undefined);
  }

  private async handleSync(event: SyncEvent): Promise<void> {
    if (event.type === 'reset') {
      await this.load();
      return;
    }
    if (event.type !== 'changes') return;
    const changes = coalesceChanges(consumeEchoes(event.changes, this.echoes));
    await this.applySyncIntents(planReloads(changes, this.syncView()));
  }

  private syncView(): SyncView {
    return {
      documents: this.documents.map((item) => ({ id: item.id, updatedAt: item.updatedAt })),
      openDocumentId: null,
      listIncludesHead: true,
      editor: null,
      topics: [],
      openTopicId: null,
      mapTopicId: null,
      readerDocumentId: null,
      readerActiveCardId: null,
      reviewInSession: false,
      jobs: [],
      activeJobId: null,
    };
  }

  private async applySyncIntents(intents: ReloadIntent[]): Promise<void> {
    const deleteIds = intents.flatMap((intent) =>
      intent.kind === 'document' && intent.op === 'delete' ? [intent.id] : [],
    );
    const upserts = intents.flatMap((intent) =>
      intent.kind === 'document' && intent.op === 'upsert' ? [intent.id] : [],
    );
    if (intents.some((intent) => intent.kind === 'documents-page')) {
      await this.reloadListMerging(deleteIds);
    }
    for (const id of deleteIds) {
      this.bumpRow(id);
      this.forgetDocument(id);
    }
    for (const id of upserts) {
      if (this.documents.some((item) => item.id === id)) await this.refreshOne(id);
    }
    if (intents.some((intent) => intent.kind === 'job')) await this.loadJobs();
    if (intents.some((intent) => intent.kind === 'review')) await this.loadReview();
    if (intents.some((intent) => intent.kind === 'report')) await this.loadWeeklyReport();
    if (intents.some((intent) => intent.kind === 'suggest')) await this.loadSuggestions();
  }

  private async reloadListMerging(deleteIds: readonly string[]): Promise<void> {
    const gen = ++this.loadGen;
    const listedAt = this.opGen;
    const want = Math.max(this.documents.length, RECENT_DOCS);
    try {
      const items: DocumentListItem[] = [];
      let total = 0;
      let offset = 0;
      while (items.length < want) {
        const limit = Math.min(LIST_LIMIT_MAX, want - items.length);
        const page = await listDocuments({ limit, offset });
        total = page.total;
        items.push(...page.items);
        if (page.items.length === 0 || items.length >= total) break;
        offset += page.items.length;
      }
      if (gen !== this.loadGen) return;
      this.applyServerPage(items, total, deleteIds, true, listedAt);
      this.syncPolling();
    } catch {
      // Keep the rows already on screen.
    }
  }

  private applyStats(stats: ReviewStats): void {
    this.streak = stats.streak.current;
    this.totalCards = stats.totalCards;
  }
}
