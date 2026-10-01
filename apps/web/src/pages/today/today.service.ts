import { Service } from '@rabjs/react';
import type { CaptureEditorHandle } from '@/components/capture/capture-editor';
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
  coalesceChanges,
  planReloads,
  stripEchoes,
  type EchoStamp,
  type ReloadIntent,
  type SyncView,
} from '@/lib/sync-plan';
import { SyncService, type SyncEvent } from '@/services/sync.service';
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
  private topicsGen = 0;
  private reviewGen = 0;
  private jobsGen = 0;
  private reportGen = 0;
  private suggestGen = 0;
  private resurfaceGen = 0;
  private sync: SyncService | null = null;
  private unsubSync: (() => void) | null = null;
  private echoes: EchoStamp[] = [];
  private syncChain: Promise<void> = Promise.resolve();

  constructor() {
    super();
    try {
      this.sync = this.resolve(SyncService);
      this.unsubSync = this.sync.subscribe((event) => {
        void this.handleSync(event);
      });
    } catch {
      this.sync = null;
    }
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

  setDraft(value: string): void {
    this.draft = value;
  }

  captureHandle: CaptureEditorHandle | null = null;

  bindCapture(handle: CaptureEditorHandle | null): void {
    this.captureHandle = handle;
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
    await Promise.all([
      this.loadTopics(),
      this.loadDocuments(),
      this.loadSuggestions(),
      this.loadResurface(),
      this.loadWeeklyReport(),
      this.loadReview(),
      this.loadJobs(),
    ]);
  }

  async loadTopics(): Promise<void> {
    const gen = ++this.topicsGen;
    try {
      const topics = await listTopics('active');
      if (gen !== this.topicsGen) return;
      this.topics = topics;
      if (this.topicId && !topics.some((topic) => topic.id === this.topicId)) {
        this.topicId = null;
      }
    } catch (err) {
      if (gen !== this.topicsGen) return;
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
    const gen = ++this.reviewGen;
    try {
      const [today, stats] = await Promise.all([getReviewToday(), getReviewStats()]);
      if (gen !== this.reviewGen) return;
      this.dueCount = Math.max(0, today.total - today.reviewedToday);
      this.applyStats(stats);
      this.reviewLoaded = true;
    } catch {
      // Review strip is optional; keep the last snapshot.
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
    const content = (this.captureHandle?.getText() ?? this.draft).trim();
    if (content.length === 0) return;
    this.error = null;
    const useChat = captureIsChat(content, mode);
    try {
      const { created } = await sendCapture({
        text: content,
        pmJson: this.captureHandle?.getJSON(),
        topicId: this.topicId,
        mode,
      });
      this.captureHandle?.clear();
      this.draft = '';
      // 插入前发出的首页请求作废。再拉一次才能把新行和其余最近文档一起画上；回声会被剥掉，不会补这次列表。
      ++this.loadGen;
      this.documents = [
        asListItem(created, {
          cardCount: 0,
          topicTitle: this.currentTopic?.title ?? null,
        }),
        ...this.documents,
      ];
      this.documentTotal += 1;
      this.rememberDocument(created);
      this.showToast(useChat ? '问题扔出去了，正在答' : '已收下，消化中');
      this.syncPolling();
      void this.loadDocuments();
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
    this.unsubSync?.();
    this.unsubSync = null;
    this.stopPolling();
    stopToast(this);
    super.destroy();
  }

  async handleSync(event: SyncEvent): Promise<void> {
    if (event.type === 'active') {
      if (event.active) this.stopPolling();
      else this.syncPolling();
      return;
    }
    // 加载失败留在各 loader 的快照里，链本身要继续。
    const run = (this.syncChain = this.syncChain
      .then(() => this.applySync(event))
      .catch(() => undefined));
    await run;
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
    const gen = ++this.resurfaceGen;
    try {
      const result = await getAnnotationResurface();
      if (gen !== this.resurfaceGen) return;
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
    // 握手可能在本页构造前就已经 active，开定时器前再看一次。
    if (this.sync?.active === true) {
      this.stopPolling();
      return;
    }
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

  /** 只压刚写上屏幕的这一行，不用文档 updatedAt 盖掉更早的卡片扇出。 */
  private rememberDocument(doc: { id: string; updatedAt: string }): void {
    const atMs = Date.parse(doc.updatedAt);
    if (!Number.isFinite(atMs)) return;
    this.echoes.push({ scope: 'document', resourceId: doc.id, atMs });
  }

  private async applySync(event: SyncEvent): Promise<void> {
    if (event.type === 'reset') {
      await this.load();
      return;
    }
    if (event.type !== 'changes') return;
    const kept = stripEchoes(event.changes, this.echoes);
    const keptSet = new Set(kept);
    for (const change of event.changes) {
      if (change.op === 'delete' || keptSet.has(change)) continue;
      const atMs = Date.parse(change.at);
      const index = this.echoes.findIndex(
        (echo) => echo.scope === change.scope && echo.resourceId === change.resourceId && echo.atMs === atMs,
      );
      if (index >= 0) this.echoes.splice(index, 1);
    }
    await this.applyIntents(planReloads(coalesceChanges(kept), this.syncView()));
  }

  private syncView(): SyncView {
    return {
      documents: this.documents.map((doc) => ({ id: doc.id, updatedAt: doc.updatedAt })),
      openDocumentId: null,
      listIncludesHead: true,
      editor: null,
      topics: [],
      openTopicId: null,
      mapTopicId: null,
      readerDocumentId: null,
      readerActiveCardId: null,
      reviewInSession: false,
      jobs: this.jobs.map((job) => ({ id: job.id, updatedAt: job.updatedAt })),
      activeJobId: null,
    };
  }

  private async applyIntents(intents: ReloadIntent[]): Promise<void> {
    const refreshIds: string[] = [];
    const deleteIds: string[] = [];
    let page = false;
    let review = false;
    let report = false;
    let suggest = false;
    let resurface = false;
    let jobs = false;
    for (const intent of intents) {
      switch (intent.kind) {
        case 'documents-page':
          page = true;
          break;
        case 'document':
          if (intent.op === 'delete') deleteIds.push(intent.id);
          else refreshIds.push(intent.id);
          break;
        case 'review':
          review = true;
          break;
        case 'report':
          report = true;
          break;
        case 'suggest':
          suggest = true;
          break;
        case 'resurface':
          resurface = true;
          break;
        case 'job':
          jobs = true;
          break;
        default:
          break;
      }
    }
    await this.syncDocuments(refreshIds, deleteIds, page);
    await Promise.all([
      review ? this.loadReview() : Promise.resolve(),
      report ? this.loadWeeklyReport() : Promise.resolve(),
      suggest ? this.loadSuggestions() : Promise.resolve(),
      resurface ? this.loadResurface() : Promise.resolve(),
      jobs ? this.loadJobs() : Promise.resolve(),
    ]);
  }

  private async syncDocuments(refreshIds: string[], deleteIds: string[], page: boolean): Promise<void> {
    const drop = new Set(deleteIds);
    // 先合并列表，再丢掉本批 delete，避免刚删的 id 被这一页带回来。
    let merged = false;
    if (page || drop.size > 0) merged = await this.mergeRecentDocuments(drop);
    const refresh = refreshIds.filter((id) => !drop.has(id));
    if (refresh.length > 0) await Promise.all(refresh.map((id) => this.refreshOne(id)));
    if (drop.size === 0) return;
    const next = this.documents.filter((doc) => !drop.has(doc.id));
    const removed = this.documents.length - next.length;
    if (removed === 0) return;
    this.documents = next;
    if (!merged) this.documentTotal = Math.max(0, this.documentTotal - removed);
    this.syncPolling();
  }

  private async mergeRecentDocuments(drop: ReadonlySet<string>): Promise<boolean> {
    const gen = ++this.loadGen;
    try {
      const page = await listDocuments({ limit: RECENT_DOCS, offset: 0 });
      if (gen !== this.loadGen) return false;
      const pageIds = new Set(page.items.map((item) => item.id));
      const held = this.documents;
      const overlap = held.findIndex((item) => pageIds.has(item.id));
      // 插在这一页前面的本地行还没被服务端算进 total，不能接到第四条后面。
      const front = overlap < 0 ? [] : held.slice(0, overlap);
      const tail = (overlap < 0 ? held : held.slice(overlap)).filter((item) => !pageIds.has(item.id));
      this.documents = [...front, ...page.items, ...tail];
      // page.total 已不含回收站。本批要删的队首不能再加一次；页内删掉的 id 也不在这里减。
      const keptFront = front.filter((item) => !drop.has(item.id)).length;
      this.documentTotal = page.total + keptFront;
      this.syncPolling();
      return true;
    } catch {
      return false;
    }
  }
}
