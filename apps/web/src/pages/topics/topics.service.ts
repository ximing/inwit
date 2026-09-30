import type { DocumentChange } from '@/components/document-actions.service';
import { Service } from '@rabjs/react';
import type { CaptureEditorHandle } from '@/components/capture/capture-editor';
import type {
  Document,
  DocumentListItem,
  Job,
  MapNodeDetail,
  MapSummary,
  MapTreeNode,
  ReviewTopicStat,
  SyncChange,
  Topic,
} from '@inwit/dto';
import { isChatQuestion, topicJobPayloadFrom } from '@inwit/dto';
import { ApiError, errorMessage } from '@/api/client';
import { getReviewTopicStats } from '@/api/review';
import { listDocuments } from '@/api/documents';
import { ReaderService } from '@/components/reader/reader.service';
import {
  asListItem,
  captureIsChat,
  fetchMergedItem,
  hasPendingDoc,
  POLL_MS,
  sendCapture,
  showToast,
  startPolling,
  stopPolling,
  stopToast,
} from '@/lib/doc-list';
import {
  coalesceChanges,
  planReloads,
  stripEchoes,
  type EchoStamp,
  type ReloadIntent,
  type SyncView,
} from '@/lib/sync-plan';
import { cardPath } from '@/routes';
import { SyncService, type SyncEvent } from '@/services/sync.service';
import { getJob } from '@/api/jobs';
import {
  fillMapNode,
  getActiveTopicJob,
  getMapNodeDetail,
  getTopicMap,
  getTopicMapSummary,
  organizeTopicMap,
} from '@/api/maps';
import {
  archiveTopic,
  createTopic,
  deleteTopic,
  getTopic,
  listTopics,
  restoreTopic,
  updateTopic,
} from '@/api/topics';

const DOC_PAGE = 50;
/** listDocuments 拒绝更大的 limit，长窗口按页拼。 */
const DOC_LIMIT_MAX = 100;

/**
 * 服务端顺序在前，本地这次没回到的尾部接在后面。
 * 删除放在合并之后，避免尾部把刚删掉的 id 补回来。
 */
export function mergeListedRows<T>(
  local: readonly T[],
  server: readonly T[],
  deleteIds: readonly string[],
  idOf: (row: T) => string,
): T[] {
  const seen = new Set(server.map((row) => idOf(row)));
  const tail = local.filter((row) => !seen.has(idOf(row)));
  const drop = new Set(deleteIds);
  const merged = [...server, ...tail];
  if (drop.size === 0) return merged;
  return merged.filter((row) => !drop.has(idOf(row)));
}

function changeIds(
  changes: readonly SyncChange[],
  scope: SyncChange['scope'],
  op: SyncChange['op'],
): string[] {
  const ids: string[] = [];
  for (const change of changes) {
    if (change.scope !== scope || change.op !== op || !change.resourceId) continue;
    ids.push(change.resourceId);
  }
  return ids;
}

async function fetchDocumentWindow(
  topicId: string,
  held: number,
): Promise<{ items: DocumentListItem[]; total: number }> {
  const want = Math.max(DOC_PAGE, held);
  const items: DocumentListItem[] = [];
  const seen = new Set<string>();
  let total = 0;
  let offset = 0;
  while (items.length < want) {
    const limit = Math.min(DOC_LIMIT_MAX, want - items.length);
    const page = await listDocuments({ topicId, limit, offset });
    total = page.total;
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    offset += page.items.length;
    if (page.items.length === 0 || offset >= total) break;
  }
  return { items, total };
}

export type TopicTab = 'docs' | 'map' | 'feed';
export type TopicEditField = 'title' | 'goal';

export type TopicListItem = {
  topic: Topic;
  cardCount: number;
  documentCount: number;
  totalNodes: number;
  uncoveredNodes: number;
  /** Map-summary remembered ratio (0–100). See T7 report: not intervalDays≥21. */
  masteryPct: number;
};

function blankItem(topic: Topic): TopicListItem {
  return {
    topic,
    cardCount: 0,
    documentCount: 0,
    totalNodes: 0,
    uncoveredNodes: 0,
    masteryPct: 0,
  };
}

function collapsedKey(topicId: string): string {
  return `inwit.map.collapsed.${topicId}`;
}

function readCollapsed(topicId: string): string[] {
  try {
    const raw = localStorage.getItem(collapsedKey(topicId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function jobIdFromConflict(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.code !== 'TOPIC_JOB_IN_PROGRESS') return null;
  if (typeof err.details !== 'object' || err.details === null) return null;
  if (!('jobId' in err.details)) return null;
  const id = (err.details as { jobId: unknown }).jobId;
  return typeof id === 'string' ? id : null;
}

export function subtreeCounts(node: MapTreeNode): { cards: number; docs: number } {
  let cards = node.cardCount;
  let docs = node.docCount;
  for (const child of node.children) {
    const sub = subtreeCounts(child);
    cards += sub.cards;
    docs += sub.docs;
  }
  return { cards, docs };
}

export function chapterMeta(node: MapTreeNode): string {
  const { cards, docs } = subtreeCounts(node);
  if (docs > 0) return `${cards}卡 · ${docs}资料`;
  return `${cards}卡`;
}

function findMapNode(nodes: readonly MapTreeNode[], id: string): MapTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findMapNode(node.children, id);
    if (child) return child;
  }
  return null;
}

export class TopicsService extends Service {
  items: TopicListItem[] = [];
  /** topicId → 近 7 天复习量/想起率。加载失败时保持为空，UI 静默隐藏。 */
  topicStats: ReviewTopicStat[] = [];
  error: string | null = null;
  detailError: string | null = null;
  newTopicOpen = false;
  newTitle = '';
  newTopicError: string | null = null;
  archiveOpen = false;
  paneMenuOpen = false;
  editing: TopicEditField | null = null;
  draftTitle = '';
  draftGoal = '';

  topic: Topic | null = null;
  tree: MapTreeNode[] = [];
  summary: MapSummary | null = null;
  documents: DocumentListItem[] = [];
  documentsTotal = 0;
  titleByNodeId: Record<string, string> = {};
  tab: TopicTab = 'docs';
  collapsedIds: string[] = [];
  selectedNodeId: string | null = null;
  nodeDetail: MapNodeDetail | null = null;
  activeJob: Job | null = null;
  topicId: string | null = null;
  draft = '';
  toast: string | null = null;

  jobPollTimer: ReturnType<typeof setInterval> | null = null;
  pollTimer: ReturnType<typeof setInterval> | null = null;
  toastTimer: ReturnType<typeof setTimeout> | null = null;
  topicLoadGen = 0;
  /** 文档窗口仍从 offset 0 开始，含 loadMore。当前主题第一次落地前为 false。 */
  docsHeadReady = false;

  private syncUnsub: (() => void) | null = null;
  private syncChain: Promise<void> = Promise.resolve();
  /** 本屏已经套用的行。满 32 条丢掉最旧的，那一条只会多一次 GET。 */
  private syncEchoes: EchoStamp[] = [];
  private syncStopped = false;
  private docListGen = 0;
  /** 进行中的 openTopic 在等待期间收到变更后会再拉一次。 */
  private docSyncPending = false;
  private openInFlight = false;
  /** reset 的快照还没落地，这段写入会被盖掉，先不要记回声。 */
  private resetReloading = false;
  private loadsInFlight = 0;
  /** load() 等待期间删掉的主题。晚到的 listTopics 不能把它们插回去。 */
  private removedDuringLoad = new Set<string>();

  constructor() {
    super();
    // 单测直接 new，没有容器。握手可能在本页挂上之前就完成了，启动定时器时再看 active。
    if (!this._container) return;
    this.syncUnsub = this.resolve(SyncService).subscribe((event) => {
      this._enqueueSync(event);
    });
  }

  get active(): TopicListItem[] {
    return this.items.filter((item) => item.topic.status === 'active');
  }

  get archived(): TopicListItem[] {
    return this.items.filter((item) => item.topic.status === 'archived');
  }

  get selectedItem(): TopicListItem | null {
    if (!this.topicId) return null;
    return this.items.find((item) => item.topic.id === this.topicId) ?? null;
  }

  get archivedSelected(): boolean {
    return this.topic?.status === 'archived';
  }

  get coveredCount(): number {
    if (!this.summary) return 0;
    return Math.max(0, this.summary.totalNodes - this.summary.uncoveredNodes);
  }

  get coveragePct(): number {
    const total = this.summary?.totalNodes ?? 0;
    if (total <= 0) return 0;
    return Math.round((this.coveredCount / total) * 100);
  }

  get emptyMap(): boolean {
    return this.tree.length === 0;
  }

  get jobRunning(): boolean {
    const status = this.activeJob?.status;
    return status === 'pending' || status === 'running';
  }

  get organizing(): boolean {
    if (!this.jobRunning || !this.activeJob) return false;
    return topicJobPayloadFrom(this.activeJob.payload)?.action === 'organize';
  }

  get fillingNodeId(): string | null {
    if (!this.jobRunning || !this.activeJob) return null;
    const payload = topicJobPayloadFrom(this.activeJob.payload);
    return payload?.action === 'fill' ? (payload.nodeId ?? null) : null;
  }

  get drawerOpen(): boolean {
    return this.selectedNodeId !== null;
  }

  get hasMoreDocs(): boolean {
    return this.documents.length < this.documentsTotal;
  }

  get mapNodeCount(): number {
    return this.summary?.totalNodes ?? this.selectedItem?.totalNodes ?? 0;
  }

  get reader(): ReaderService {
    return this.resolve(ReaderService);
  }

  get canSend(): boolean {
    return (
      this.draft.trim().length > 0 &&
      !this.$model.send.loading &&
      this.topic !== null &&
      this.topic.status !== 'archived'
    );
  }

  get draftLooksLikeQuestion(): boolean {
    return isChatQuestion(this.draft);
  }

  get lastDigestedAt(): string | null {
    if (this.documents.length === 0) return null;
    let latest = this.documents[0]?.updatedAt ?? null;
    for (const doc of this.documents) {
      if (!latest || doc.updatedAt > latest) latest = doc.updatedAt;
    }
    return latest;
  }

  get cardCount(): number {
    return this.summary?.cardCount ?? this.selectedItem?.cardCount ?? 0;
  }

  get documentCount(): number {
    return this.documentsTotal || this.selectedItem?.documentCount || 0;
  }

  get masteryPct(): number {
    return this.summary?.masteryPct ?? this.selectedItem?.masteryPct ?? 0;
  }

  retentionFor(topicId: string): ReviewTopicStat | null {
    return this.topicStats.find((stat) => stat.topicId === topicId) ?? null;
  }

  hangingTitle(doc: DocumentListItem): string | null {
    if (!doc.mapNodeId) return null;
    return this.titleByNodeId[doc.mapNodeId] ?? null;
  }

  isCollapsed(id: string): boolean {
    return this.collapsedIds.includes(id);
  }

  setTab(tab: TopicTab): void {
    this.tab = tab;
  }

  /** 在当前主题页打开阅读弹层。 */
  readerNavForDoc(docId: string): string | null {
    void this.reader.openDoc(docId);
    return null;
  }

  /** 无所属文档时返回跳转路径；否则打开卡片模式弹层（PDF 同样走弹层）。 */
  readerNavForCard(cardId: string, documentId: string | null): string | null {
    if (!documentId) return cardPath(cardId, documentId);
    void this.reader.openCard(cardId, documentId);
    return null;
  }

  setDraft(value: string): void {
    this.draft = value;
  }

  captureHandle: CaptureEditorHandle | null = null;

  bindCapture(handle: CaptureEditorHandle | null): void {
    this.captureHandle = handle;
  }

  setNewTitle(value: string): void {
    this.newTitle = value;
  }

  openNewTopic(): void {
    if (this.newTopicOpen) return;
    this.paneMenuOpen = false;
    this.newTopicOpen = true;
    this.newTitle = '';
    this.newTopicError = null;
  }

  closeNewTopic(): void {
    this.newTopicOpen = false;
    this.newTopicError = null;
  }

  toggleArchiveOpen(): void {
    this.archiveOpen = !this.archiveOpen;
  }

  togglePaneMenu(): void {
    this.paneMenuOpen = !this.paneMenuOpen;
  }

  closePaneMenu(): void {
    this.paneMenuOpen = false;
  }

  startEdit(field: TopicEditField): void {
    if (!this.topic) return;
    this.paneMenuOpen = false;
    this.editing = field;
    this.draftTitle = this.topic.title;
    this.draftGoal = this.topic.goal ?? '';
  }

  setDraftTitle(value: string): void {
    this.draftTitle = value;
  }

  setDraftGoal(value: string): void {
    this.draftGoal = value;
  }

  cancelEdit(): void {
    this.editing = null;
  }

  toggleCollapsed(id: string): void {
    if (this.collapsedIds.includes(id)) {
      this.collapsedIds = this.collapsedIds.filter((item) => item !== id);
    } else {
      this.collapsedIds = [...this.collapsedIds, id];
    }
    this.persistCollapsed();
  }

  persistCollapsed(): void {
    if (!this.topicId) return;
    localStorage.setItem(collapsedKey(this.topicId), JSON.stringify(this.collapsedIds));
  }

  closeDrawer(): void {
    this.selectedNodeId = null;
    this.nodeDetail = null;
  }

  applyMap(nodes: MapTreeNode[]): void {
    this.tree = nodes;
    const titles: Record<string, string> = {};
    const walk = (list: MapTreeNode[]) => {
      for (const node of list) {
        titles[node.id] = node.title;
        walk(node.children);
      }
    };
    walk(nodes);
    this.titleByNodeId = titles;
  }

  applyTopic(topic: Topic): void {
    this.topic = topic;
    const index = this.items.findIndex((item) => item.topic.id === topic.id);
    if (index < 0) {
      this.items = [blankItem(topic), ...this.items];
      return;
    }
    this.items = this.items.map((item, i) => (i === index ? { ...item, topic } : item));
  }

  patchItem(id: string, patch: Partial<Omit<TopicListItem, 'topic'>>): void {
    this.items = this.items.map((item) => (item.topic.id === id ? { ...item, ...patch } : item));
  }

  showToast(message: string): void {
    showToast(this, message);
  }

  watchJob(job: Job): void {
    this.activeJob = job;
    this._noteEcho('job', job.id, job.updatedAt);
    if (job.status === 'pending' || job.status === 'running') this.startJobPolling();
    else void this.onJobSettled(job);
  }

  startJobPolling(): void {
    if (this._syncActive()) return;
    if (this.jobPollTimer !== null) return;
    this.jobPollTimer = setInterval(() => {
      void this.tickJob();
    }, POLL_MS);
  }

  stopJobPolling(): void {
    if (this.jobPollTimer === null) return;
    clearInterval(this.jobPollTimer);
    this.jobPollTimer = null;
  }

  startDocPolling(): void {
    if (this._syncActive()) return;
    startPolling(this, () => void this.tickPending());
  }

  stopDocPolling(): void {
    stopPolling(this);
  }

  syncDocPolling(): void {
    if (hasPendingDoc(this.documents)) this.startDocPolling();
    else this.stopDocPolling();
  }

  async load(): Promise<void> {
    this.error = null;
    void this.loadTopicStats();
    const startedWith = new Set(this.items.map((item) => item.topic.id));
    this.loadsInFlight += 1;
    try {
      const topics = await listTopics();
      const enriched = await Promise.all(topics.map((topic) => this._enrich(topic)));
      if (this.syncStopped) return;
      const gone = new Set(this.removedDuringLoad);
      for (const id of startedWith) {
        if (this.items.some((item) => item.topic.id === id)) continue;
        gone.add(id);
      }
      const seen = new Set<string>();
      const merged: TopicListItem[] = [];
      const localById = new Map(this.items.map((item) => [item.topic.id, item]));
      for (const row of enriched) {
        if (gone.has(row.topic.id)) continue;
        seen.add(row.topic.id);
        const prev = localById.get(row.topic.id);
        const topic =
          prev && Date.parse(prev.topic.updatedAt) > Date.parse(row.topic.updatedAt)
            ? prev.topic
            : row.topic;
        merged.push({ ...row, topic });
      }
      for (const id of startedWith) {
        if (seen.has(id) || gone.has(id)) continue;
        this.removedDuringLoad.add(id);
      }
      const created = this.items.filter(
        (item) => !seen.has(item.topic.id) && !gone.has(item.topic.id) && !startedWith.has(item.topic.id),
      );
      this.items = [...created, ...merged];
    } catch (err) {
      this.error = errorMessage(err, '加载主题失败');
    } finally {
      this.loadsInFlight -= 1;
      if (this.loadsInFlight === 0) this.removedDuringLoad.clear();
    }
  }

  private async loadTopicStats(): Promise<void> {
    try {
      this.topicStats = await getReviewTopicStats();
    } catch {
      this.topicStats = [];
    }
  }

  applyDocumentChange(change: DocumentChange): void {
    const { id, document: updated, topicTitle } = change;
    const remove = !updated || updated.topicId !== this.topicId;
    const had = this.documents.some((item) => item.id === id);
    this.documents = remove
      ? this.documents.filter((item) => item.id !== id)
      : this.documents.map((item) => item.id === id ? { ...item, ...updated, topicTitle } : item);
    if (remove && had) this.documentsTotal = Math.max(0, this.documentsTotal - 1);
    if (this.topicId) this.patchItem(this.topicId, { documentCount: this.documentsTotal });
    const openDoc = this._container ? this.reader.doc : null;
    const readerOpen = openDoc?.id === id;
    if (openDoc && readerOpen) {
      if (!updated) this.reader.close();
      else this.reader.doc = { ...openDoc, ...updated, topicTitle };
    }
    if (updated && ((had && this.docsHeadReady) || readerOpen)) {
      this._noteEcho('document', id, updated.updatedAt);
    }
    this.syncDocPolling();
    if (remove) {
      const topicId = this.topicId;
      const at = updated?.updatedAt;
      void this.refreshSummary(true).then((applied) => {
        if (!applied || !topicId || !at) return;
        this._noteEcho('topic', topicId, at);
        this._noteEcho('map', topicId, at);
      });
    }
  }

  async openTopic(id: string | null): Promise<void> {
    if (this.topicId !== id) this.reader.close();
    const gen = ++this.topicLoadGen;
    this.docListGen += 1;
    this.topicId = id;
    this.detailError = null;
    this.closeDrawer();
    this.stopJobPolling();
    this.activeJob = null;
    this.editing = null;
    this.paneMenuOpen = false;
    this.draft = '';
    this.docsHeadReady = false;
    this.docSyncPending = false;
    this.openInFlight = true;
    try {
      if (!id) {
        this.topic = null;
        this.tree = [];
        this.summary = null;
        this.documents = [];
        this.documentsTotal = 0;
        this.titleByNodeId = {};
        this.stopDocPolling();
        return;
      }
      this.collapsedIds = readCollapsed(id);
      let loaded = await this._loadTopicPane(id, 0);
      if (gen !== this.topicLoadGen) return;
      while (this.docSyncPending && gen === this.topicLoadGen) {
        this.docSyncPending = false;
        loaded = await this._loadTopicPane(id, loaded.documents.length);
        if (gen !== this.topicLoadGen) return;
      }
      this._applyTopicPane(id, loaded);
      if (loaded.job) this.watchJob(loaded.job);
      this.syncDocPolling();
    } catch (err) {
      if (gen !== this.topicLoadGen) return;
      this.detailError = errorMessage(err, '打不开这个主题');
      this.topic = null;
      this.tree = [];
      this.summary = null;
      this.documents = [];
      this.documentsTotal = 0;
      this.docsHeadReady = false;
      this.stopDocPolling();
    } finally {
      if (this.topicLoadGen === gen) this.openInFlight = false;
    }
  }

  async createNewTopic(): Promise<string | null> {
    const title = this.newTitle.trim();
    if (title.length === 0) {
      this.newTopicError = '请填写标题';
      return null;
    }
    this.newTopicError = null;
    try {
      const topic = await createTopic({ title });
      this.items = [blankItem(topic), ...this.items.filter((item) => item.topic.id !== topic.id)];
      this._noteEcho('topic', topic.id, topic.updatedAt);
      this.newTopicOpen = false;
      this.newTitle = '';
      return topic.id;
    } catch (err) {
      this.newTopicError = errorMessage(err, '创建主题失败');
      return null;
    }
  }

  async commitEdit(): Promise<void> {
    if (!this.topic || !this.editing) return;
    const field = this.editing;
    const topicId = this.topic.id;
    if (field === 'title') {
      const title = this.draftTitle.trim();
      if (title.length === 0 || title === this.topic.title) {
        if (this.editing === field) this.editing = null;
        return;
      }
      this.detailError = null;
      try {
        const updated = await updateTopic(topicId, { title });
        if (this.topic?.id === topicId) {
          this.applyTopic(updated);
          this._noteEcho('topic', updated.id, updated.updatedAt);
        }
      } catch (err) {
        this.detailError = errorMessage(err, '标题没保存成');
        return;
      }
      if (this.editing === field) this.editing = null;
      return;
    }
    const goal = this.draftGoal.trim();
    const next = goal.length > 0 ? goal : null;
    if (next === this.topic.goal) {
      if (this.editing === field) this.editing = null;
      return;
    }
    this.detailError = null;
    try {
      const updated = await updateTopic(topicId, { goal: next });
      if (this.topic?.id === topicId) {
        this.applyTopic(updated);
        this._noteEcho('topic', updated.id, updated.updatedAt);
      }
    } catch (err) {
      this.detailError = errorMessage(err, '学习目标没保存成');
      return;
    }
    if (this.editing === field) this.editing = null;
  }

  async archiveSelected(): Promise<void> {
    if (!this.topic || this.topic.status === 'archived') return;
    this.paneMenuOpen = false;
    this.error = null;
    try {
      const updated = await archiveTopic(this.topic.id);
      this.applyTopic(updated);
      this._noteEcho('topic', updated.id, updated.updatedAt);
      this.archiveOpen = true;
    } catch (err) {
      this.error = errorMessage(err, '归档失败');
    }
  }

  async restoreSelected(): Promise<void> {
    if (!this.topic || this.topic.status !== 'archived') return;
    this.paneMenuOpen = false;
    this.error = null;
    try {
      const updated = await restoreTopic(this.topic.id);
      this.applyTopic(updated);
      this._noteEcho('topic', updated.id, updated.updatedAt);
    } catch (err) {
      this.error = errorMessage(err, '恢复失败');
    }
  }

  async deleteSelected(): Promise<boolean> {
    if (!this.topic) return false;
    this.paneMenuOpen = false;
    this.error = null;
    const id = this.topic.id;
    try {
      await deleteTopic(id);
      this._noteTopicsRemoved([id]);
      this.items = this.items.filter((item) => item.topic.id !== id);
      this.topic = null;
      this.tree = [];
      this.summary = null;
      this.documents = [];
      this.documentsTotal = 0;
      this.docsHeadReady = false;
      this.topicId = null;
      this.stopJobPolling();
      this.stopDocPolling();
      return true;
    } catch (err) {
      this.error = errorMessage(err, '删除失败');
      return false;
    }
  }

  async send(mode: 'auto' | 'chat' | 'paste' = 'auto'): Promise<string | null> {
    if (!this.topic || this.topic.status === 'archived') return null;
    const content = (this.captureHandle?.getText() ?? this.draft).trim();
    if (content.length === 0) return null;
    this.error = null;
    const useChat = captureIsChat(content, mode);
    try {
      const { created } = await sendCapture({
        text: content,
        pmJson: this.captureHandle?.getJSON(),
        topicId: this.topic.id,
        mode,
      });
      this.captureHandle?.clear();
      this.draft = '';
      this.ingestCreated(created);
      this.showToast(useChat ? '问题扔出去了，正在答' : '已收下，消化中');
      return created.id;
    } catch (err) {
      this.error = errorMessage(err, useChat ? '提问失败' : '发送失败');
      return null;
    }
  }

  ingestCreated(created: Document): void {
    const item = asListItem(created, {
      cardCount: 0,
      topicTitle: this.topic?.title ?? null,
    });
    if (!this.documents.some((doc) => doc.id === created.id)) {
      this.documents = [item, ...this.documents];
      this.documentsTotal += 1;
      if (this.topicId) {
        this.patchItem(this.topicId, { documentCount: this.documentsTotal });
      }
    }
    // 窗口还没落地时这次插入会被 openTopic 盖掉，留给随后的列表重拉。
    if (this.docsHeadReady) this._noteEcho('document', created.id, created.updatedAt);
    this.syncDocPolling();
  }

  async refreshAfterJob(): Promise<void> {
    const topicId = this.topicId;
    if (!topicId) return;
    const topicGen = this.topicLoadGen;
    const listGen = this.docListGen;
    const held = this.documents.length;
    try {
      const [map, summary, docs] = await Promise.all([
        getTopicMap(topicId),
        getTopicMapSummary(topicId),
        fetchDocumentWindow(topicId, held),
      ]);
      if (this.topicId !== topicId || this.topicLoadGen !== topicGen) return;
      this.applyMap(map.nodes);
      this.summary = summary;
      const keepDocs = this.docListGen === listGen && this.docsHeadReady;
      if (keepDocs) {
        this.documents = mergeListedRows(this.documents, docs.items, [], (item) => item.id);
        this.documentsTotal = docs.total;
      }
      this.patchItem(topicId, {
        cardCount: summary.cardCount,
        documentCount: keepDocs ? docs.total : this.documentsTotal,
        totalNodes: summary.totalNodes,
        uncoveredNodes: summary.uncoveredNodes,
        masteryPct: summary.masteryPct,
      });
      if (this.selectedNodeId && this.topicLoadGen === topicGen) {
        await this.openNode(this.selectedNodeId);
      }
      this.syncDocPolling();
    } catch (err) {
      if (this.topicLoadGen !== topicGen) return;
      this.detailError = errorMessage(err, '刷新地图失败');
    }
  }

  async refreshSummary(refreshMap = false): Promise<boolean> {
    const topicId = this.topicId;
    const gen = this.topicLoadGen;
    const nodeId = this.selectedNodeId;
    if (!topicId) return false;
    try {
      const [summary, map] = await Promise.all([
        getTopicMapSummary(topicId),
        refreshMap ? getTopicMap(topicId) : Promise.resolve(null),
      ]);
      if (this.topicId !== topicId || this.topicLoadGen !== gen) return false;
      this.summary = summary;
      if (map) this.applyMap(map.nodes);
      this.patchItem(topicId, {
        cardCount: summary.cardCount,
        totalNodes: summary.totalNodes,
        uncoveredNodes: summary.uncoveredNodes,
        masteryPct: summary.masteryPct,
      });
    } catch {
      return false;
    }
    if (!refreshMap || !nodeId) return true;
    try {
      const detail = await getMapNodeDetail(nodeId);
      if (this.topicId === topicId && this.topicLoadGen === gen && this.selectedNodeId === nodeId) {
        this.nodeDetail = detail;
      }
    } catch (err) {
      if (this.topicId !== topicId || this.topicLoadGen !== gen || this.selectedNodeId !== nodeId) {
        return true;
      }
      if (err instanceof ApiError && err.status === 404) {
        this.selectedNodeId = null;
        this.nodeDetail = null;
      }
    }
    return true;
  }

  async openNode(nodeId: string): Promise<void> {
    this.selectedNodeId = nodeId;
    try {
      this.nodeDetail = await getMapNodeDetail(nodeId);
    } catch (err) {
      this.detailError = errorMessage(err, '打不开这个节点');
      this.nodeDetail = null;
    }
  }

  async organize(): Promise<void> {
    if (!this.topic || this.topic.status === 'archived' || this.jobRunning) return;
    this.detailError = null;
    try {
      const job = await organizeTopicMap(this.topic.id);
      this.watchJob(job);
    } catch (err) {
      if (await this.resumeFromConflict(err)) return;
      this.detailError = errorMessage(err, '整理地图失败');
    }
  }

  async fill(nodeId: string): Promise<void> {
    if (!this.topic || this.topic.status === 'archived' || this.jobRunning) return;
    if (findMapNode(this.tree, nodeId)?.proposedCount) {
      this.showToast('有待确认的卡');
      return;
    }
    this.detailError = null;
    try {
      const job = await fillMapNode(nodeId);
      this.watchJob(job);
      void this.openNode(nodeId);
    } catch (err) {
      if (await this.resumeFromConflict(err)) return;
      if (err instanceof ApiError && err.code === 'NODE_HAS_PROPOSED_CARDS') {
        this.showToast('有待确认的卡');
        return;
      }
      this.detailError = errorMessage(err, '补节点失败');
    }
  }

  async resumeFromConflict(err: unknown): Promise<boolean> {
    if (!(err instanceof ApiError) || err.code !== 'TOPIC_JOB_IN_PROGRESS') return false;
    if (!this.topicId) return false;
    try {
      const jobId = jobIdFromConflict(err);
      const job = jobId ? await getJob(jobId) : (await getActiveTopicJob(this.topicId)).job;
      if (job) this.watchJob(job);
      return true;
    } catch {
      return false;
    }
  }

  async tickJob(): Promise<void> {
    const current = this.activeJob;
    if (!current) {
      this.stopJobPolling();
      return;
    }
    const gen = this.topicLoadGen;
    try {
      const job = await getJob(current.id);
      if (this.topicLoadGen !== gen || this.activeJob?.id !== current.id) return;
      this.activeJob = job;
      if (job.status === 'done' || job.status === 'failed') {
        this.stopJobPolling();
        await this.onJobSettled(job);
      }
    } catch {
      // keep last snapshot
    }
  }

  async onJobSettled(job: Job): Promise<void> {
    if (job.status === 'failed') {
      this.detailError = job.lastError ?? '地图任务失败';
    }
    this.activeJob = null;
    await this.refreshAfterJob();
  }

  async loadMoreDocs(): Promise<void> {
    if (!this.topicId || !this.docsHeadReady || !this.hasMoreDocs || this.$model.loadMoreDocs.loading) {
      return;
    }
    const topicId = this.topicId;
    const topicGen = this.topicLoadGen;
    const listGen = this.docListGen;
    const page = await listDocuments({
      topicId,
      limit: DOC_PAGE,
      offset: this.documents.length,
    });
    if (this.topicId !== topicId || this.topicLoadGen !== topicGen || this.docListGen !== listGen) return;
    const have = new Set(this.documents.map((item) => item.id));
    this.documents = [...this.documents, ...page.items.filter((item) => !have.has(item.id))];
    this.documentsTotal = page.total;
    this.patchItem(topicId, { documentCount: page.total });
    this.syncDocPolling();
  }

  async tickPending(): Promise<void> {
    const pending = this.documents.filter((item) => item.status === 'pending');
    if (pending.length === 0) {
      this.syncDocPolling();
      return;
    }
    await Promise.all(pending.map((item) => this.refreshOne(item.id)));
    const still = this.documents.some((item) => item.status === 'pending');
    if (!still) void this.refreshSummary();
    this.syncDocPolling();
  }

  async refreshOne(id: string): Promise<void> {
    const prev = this.documents.find((item) => item.id === id);
    if (!prev) return;
    const topicId = this.topicId;
    const topicGen = this.topicLoadGen;
    const listGen = this.docListGen;
    const merged = await fetchMergedItem(prev);
    if (this.topicLoadGen !== topicGen || this.docListGen !== listGen || this.topicId !== topicId) return;
    if (!merged) return;
    if (merged.topicId !== topicId) {
      const had = this.documents.some((item) => item.id === id);
      this.documents = this.documents.filter((item) => item.id !== id);
      if (had) this.documentsTotal = Math.max(0, this.documentsTotal - 1);
      if (topicId) this.patchItem(topicId, { documentCount: this.documentsTotal });
      void this.refreshSummary(true);
      return;
    }
    this.documents = this.documents.map((item) => (item.id === id ? merged : item));
  }

  async _enrich(topic: Topic): Promise<TopicListItem> {
    try {
      const [page, summary]: [Awaited<ReturnType<typeof listDocuments>>, MapSummary] =
        await Promise.all([
          listDocuments({ topicId: topic.id, limit: 1, offset: 0 }),
          getTopicMapSummary(topic.id),
        ]);
      return {
        topic,
        cardCount: summary.cardCount,
        documentCount: page.total,
        totalNodes: summary.totalNodes,
        uncoveredNodes: summary.uncoveredNodes,
        masteryPct: summary.masteryPct,
      };
    } catch {
      return blankItem(topic);
    }
  }

  override destroy(): void {
    this.syncStopped = true;
    this.syncUnsub?.();
    this.syncUnsub = null;
    this.stopJobPolling();
    this.stopDocPolling();
    stopToast(this);
    super.destroy();
  }

  private _syncActive(): boolean {
    if (!this._container) return false;
    return this.resolve(SyncService).active;
  }

  private _enqueueSync(event: SyncEvent): void {
    this.syncChain = this.syncChain
      .then(() => this._handleSync(event))
      .catch(() => undefined);
  }

  private async _handleSync(event: SyncEvent): Promise<void> {
    if (this.syncStopped) return;
    if (event.type === 'active') {
      this._onSyncActive(event.active);
      return;
    }
    if (event.type === 'reset') {
      this.syncEchoes = [];
      const docsAtReset = this.documents.map((item) => item.id);
      this.docSyncPending = false;
      this.resetReloading = true;
      try {
        await this.load();
        if (!this.syncStopped) {
          await this._reloadMountedTopic(docsAtReset);
          if (this._container) {
            const readerId = this.reader.doc?.id;
            if (readerId) await this.reader.refreshOpenDocument(readerId);
          }
        }
      } finally {
        this.resetReloading = false;
      }
      return;
    }
    const changes = this._consumeEchoes(event.changes);
    if (changes.length === 0) return;
    if (this.openInFlight) this.docSyncPending = true;
    const coalesced = coalesceChanges(changes);
    await this._applyIntents(coalesced, planReloads(coalesced, this._syncView()));
  }

  private _onSyncActive(active: boolean): void {
    if (active) {
      this.stopDocPolling();
      this.stopJobPolling();
      return;
    }
    if (!this.openInFlight) this.syncDocPolling();
    if (this.jobRunning) this.startJobPolling();
  }

  private _noteEcho(scope: EchoStamp['scope'], resourceId: string, updatedAt: string): void {
    if (this.resetReloading) {
      this.docSyncPending = true;
      return;
    }
    if (!this._syncActive()) return;
    const atMs = Date.parse(updatedAt);
    if (Number.isNaN(atMs)) return;
    this.syncEchoes.push({ scope, resourceId, atMs });
    if (this.syncEchoes.length > 32) {
      this.syncEchoes.splice(0, this.syncEchoes.length - 32);
    }
  }

  private _consumeEchoes(changes: readonly SyncChange[]): SyncChange[] {
    const kept = stripEchoes([...changes], this.syncEchoes);
    const keptSet = new Set(kept);
    for (const change of changes) {
      if (change.op === 'delete' || keptSet.has(change)) continue;
      const atMs = Date.parse(change.at);
      const index = this.syncEchoes.findIndex(
        (echo) =>
          echo.scope === change.scope &&
          echo.resourceId === change.resourceId &&
          echo.atMs === atMs,
      );
      if (index >= 0) this.syncEchoes.splice(index, 1);
    }
    return kept;
  }

  private _syncView(): SyncView {
    const reader = this._container ? this.reader : null;
    return {
      documents: this.docsHeadReady
        ? this.documents.map((doc) => ({ id: doc.id, updatedAt: doc.updatedAt }))
        : [],
      openDocumentId: null,
      listIncludesHead: this.docsHeadReady,
      editor: null,
      topics: this.items.map((item) => ({ id: item.topic.id })),
      openTopicId: this.topicId,
      mapTopicId: this.topic?.id ?? null,
      readerDocumentId: reader?.doc?.id ?? null,
      readerActiveCardId: reader?.activeCardId ?? null,
      reviewInSession: false,
      jobs: this.activeJob ? [{ id: this.activeJob.id, updatedAt: this.activeJob.updatedAt }] : [],
      activeJobId: this.activeJob?.id ?? null,
    };
  }

  private async _applyIntents(
    changes: readonly SyncChange[],
    intents: readonly ReloadIntent[],
  ): Promise<void> {
    const topicDeletes = changeIds(changes, 'topic', 'delete');
    const topicDeleteSet = new Set(topicDeletes);
    if (intents.some((intent) => intent.kind === 'topics-page')) {
      await this._mergeTopicsPage(topicDeletes);
    }
    for (const intent of intents) {
      if (intent.kind === 'topic' && intent.op === 'delete') this._dropTopic(intent.id);
    }
    if (this.syncStopped) return;

    const mapTopics = new Set(
      intents.flatMap((intent) => (intent.kind === 'map' ? [intent.topicId] : [])),
    );
    for (const intent of intents) {
      if (intent.kind !== 'topic' || intent.op !== 'upsert') continue;
      if (topicDeleteSet.has(intent.id)) continue;
      if (this.openInFlight && intent.id === this.topicId) continue;
      const refreshCounts = !(intent.id === this.topicId && mapTopics.has(intent.id));
      await this._reloadKnownTopic(intent.id, refreshCounts);
      if (this.syncStopped) return;
    }
    for (const topicId of mapTopics) {
      if (topicDeleteSet.has(topicId)) continue;
      if (this.openInFlight && topicId === this.topicId) continue;
      const topicUpsert = intents.some(
        (intent) => intent.kind === 'topic' && intent.op === 'upsert' && intent.id === topicId,
      );
      await this._reloadKnownMap(topicId, topicUpsert);
      if (this.syncStopped) return;
    }

    await this._applyDocumentIntents(intents, changeIds(changes, 'document', 'delete'));
    if (this.syncStopped) return;
    for (const intent of intents) {
      if (this.openInFlight) break;
      if (intent.kind === 'job' && intent.id === this.activeJob?.id) await this.tickJob();
    }
  }

  private async _mergeTopicsPage(deleteIds: readonly string[]): Promise<void> {
    let topics: Topic[] | null = null;
    try {
      topics = await listTopics();
    } catch {
      topics = null;
    }
    if (this.syncStopped) return;
    const newcomers: Topic[] = [];
    if (topics) {
      const previous = new Map(this.items.map((item) => [item.topic.id, item]));
      const serverItems: TopicListItem[] = [];
      for (const topic of topics) {
        const prev = previous.get(topic.id);
        if (prev) {
          const topicRow =
            Date.parse(prev.topic.updatedAt) > Date.parse(topic.updatedAt) ? prev.topic : topic;
          serverItems.push({ ...prev, topic: topicRow });
        } else {
          serverItems.push(blankItem(topic));
          newcomers.push(topic);
        }
      }
      this._noteTopicsRemoved(deleteIds);
      this.items = mergeListedRows(this.items, serverItems, deleteIds, (item) => item.topic.id);
    }
    const openId = this.topicId;
    if (openId && deleteIds.includes(openId)) this._dropTopic(openId);
    const drop = new Set(deleteIds);
    await Promise.all(
      newcomers
        .filter((topic) => !drop.has(topic.id))
        .map(async (topic) => {
          const enriched = await this._enrich(topic);
          if (this.syncStopped) return;
          this.items = this.items.map((item) =>
            item.topic.id === topic.id ? { ...enriched, topic: item.topic } : item,
          );
        }),
    );
  }

  private async _reloadKnownTopic(id: string, refreshCounts: boolean): Promise<void> {
    const gen = this.topicLoadGen;
    if (id === this.topicId && this.topic) {
      try {
        const topic = await getTopic(id);
        if (this.syncStopped || this.topicLoadGen !== gen || this.topicId !== id || !this.topic) return;
        if (Date.parse(this.topic.updatedAt) <= Date.parse(topic.updatedAt)) this.applyTopic(topic);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) this._dropTopic(id);
        return;
      }
      if (refreshCounts) await this.refreshSummary(false);
      return;
    }
    try {
      const topic = await getTopic(id);
      if (this.syncStopped || this.topicLoadGen !== gen || !this.items.some((item) => item.topic.id === id)) {
        return;
      }
      const enriched = await this._enrich(topic);
      if (this.syncStopped || this.topicLoadGen !== gen) return;
      this.items = this.items.map((item) => {
        if (item.topic.id !== id) return item;
        const topicRow =
          Date.parse(item.topic.updatedAt) > Date.parse(topic.updatedAt) ? item.topic : topic;
        return { ...enriched, topic: topicRow };
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        this._noteTopicsRemoved([id]);
        this.items = this.items.filter((item) => item.topic.id !== id);
        if (this.topicId === id) this._dropTopic(id);
      }
    }
  }

  private async _reloadKnownMap(topicId: string, topicUpsert: boolean): Promise<void> {
    if (topicId === this.topicId && this.topic) {
      await this.refreshSummary(true);
      return;
    }
    if (topicUpsert) return;
    const item = this.items.find((row) => row.topic.id === topicId);
    if (!item) return;
    const enriched = await this._enrich(item.topic);
    if (this.syncStopped || !this.items.some((row) => row.topic.id === topicId)) return;
    this.items = this.items.map((row) =>
      row.topic.id === topicId ? { ...enriched, topic: row.topic } : row,
    );
  }

  private _dropTopic(id: string): void {
    this._noteTopicsRemoved([id]);
    this.items = this.items.filter((item) => item.topic.id !== id);
    if (this.topicId !== id) return;
    this.topicLoadGen += 1;
    this.docListGen += 1;
    this.openInFlight = false;
    this.docSyncPending = false;
    this.docsHeadReady = false;
    this.topic = null;
    this.tree = [];
    this.summary = null;
    this.documents = [];
    this.documentsTotal = 0;
    this.titleByNodeId = {};
    this.activeJob = null;
    this.closeDrawer();
    this.stopJobPolling();
    this.stopDocPolling();
    this.detailError = '这个主题已经不在了';
  }

  private async _applyDocumentIntents(
    intents: readonly ReloadIntent[],
    deleteIds: readonly string[],
  ): Promise<void> {
    const page = intents.some((intent) => intent.kind === 'documents-page');
    const upserts = intents.flatMap((intent) =>
      intent.kind === 'document' && intent.op === 'upsert' ? [intent.id] : [],
    );
    if (this.docsHeadReady && page) await this._mergeDocumentWindow(deleteIds);
    else if (this.docsHeadReady && deleteIds.length > 0) this._removeDocuments(deleteIds);
    this._closeReaderIfDeleted(deleteIds);
    if (this.openInFlight || this.syncStopped) return;
    for (const id of upserts) {
      const readerId = this._container ? this.reader.doc?.id : null;
      if (readerId === id) await this.reader.refreshOpenDocument(id);
      if (!this.docsHeadReady || !this.documents.some((item) => item.id === id)) continue;
      const hadPending = this.documents.some((item) => item.status === 'pending');
      await this.refreshOne(id);
      const stillPending = this.documents.some((item) => item.status === 'pending');
      if (hadPending && !stillPending) await this.refreshSummary();
    }
  }

  private async _mergeDocumentWindow(deleteIds: readonly string[]): Promise<void> {
    const topicId = this.topicId;
    const topicGen = this.topicLoadGen;
    if (!topicId) return;
    const listGen = ++this.docListGen;
    let page: { items: DocumentListItem[]; total: number };
    try {
      page = await fetchDocumentWindow(topicId, this.documents.length);
    } catch {
      if (this.topicId === topicId && this.topicLoadGen === topicGen && this.docsHeadReady) {
        this._removeDocuments(deleteIds);
      }
      return;
    }
    if (
      this.syncStopped ||
      this.topicId !== topicId ||
      this.topicLoadGen !== topicGen ||
      this.docListGen !== listGen ||
      !this.docsHeadReady
    ) {
      return;
    }
    this.documents = mergeListedRows(this.documents, page.items, deleteIds, (item) => item.id);
    this.documentsTotal = page.total;
    this.patchItem(topicId, { documentCount: page.total });
    this.syncDocPolling();
  }

  private _removeDocuments(ids: readonly string[]): void {
    const drop = new Set(ids);
    const before = this.documents.length;
    this.documents = this.documents.filter((item) => !drop.has(item.id));
    const removed = before - this.documents.length;
    if (removed > 0) {
      this.documentsTotal = Math.max(0, this.documentsTotal - removed);
      if (this.topicId) this.patchItem(this.topicId, { documentCount: this.documentsTotal });
    }
    this.syncDocPolling();
  }

  private _closeReaderIfDeleted(ids: readonly string[]): void {
    if (!this._container || ids.length === 0) return;
    const open = this.reader.doc?.id;
    if (open && ids.includes(open)) this.reader.close();
  }

  private _noteTopicsRemoved(ids: readonly string[]): void {
    if (this.loadsInFlight === 0) return;
    for (const id of ids) this.removedDuringLoad.add(id);
  }

  private async _loadTopicPane(id: string, documentLimit: number): Promise<{
    topic: Topic;
    map: MapTreeNode[];
    summary: MapSummary;
    documents: DocumentListItem[];
    documentsTotal: number;
    job: Job | null;
  }> {
    const [topic, map, summary, docs, active] = await Promise.all([
      getTopic(id),
      getTopicMap(id),
      getTopicMapSummary(id),
      fetchDocumentWindow(id, documentLimit),
      getActiveTopicJob(id),
    ]);
    return {
      topic,
      map: map.nodes,
      summary,
      documents: docs.items,
      documentsTotal: docs.total,
      job: active.job,
    };
  }

  private _applyTopicPane(
    id: string,
    pane: {
      topic: Topic;
      map: MapTreeNode[];
      summary: MapSummary;
      documents: DocumentListItem[];
      documentsTotal: number;
      job: Job | null;
    },
  ): void {
    this.topic = pane.topic;
    this.applyMap(pane.map);
    this.summary = pane.summary;
    this.documents = pane.documents;
    this.documentsTotal = pane.documentsTotal;
    this.docsHeadReady = true;
    this.docSyncPending = false;
    this.patchItem(id, {
      cardCount: pane.summary.cardCount,
      documentCount: pane.documentsTotal,
      totalNodes: pane.summary.totalNodes,
      uncoveredNodes: pane.summary.uncoveredNodes,
      masteryPct: pane.summary.masteryPct,
    });
    if (pane.topic.status === 'archived') this.archiveOpen = true;
  }

  private async _reloadMountedTopic(docsAtReset: readonly string[]): Promise<void> {
    const id = this.topicId;
    if (!id) return;
    const gen = ++this.topicLoadGen;
    this.docListGen += 1;
    const listGen = this.docListGen;
    this.openInFlight = false;
    this.resetReloading = true;
    const nodeId = this.selectedNodeId;
    const held = this.docsHeadReady ? this.documents.length : 0;
    try {
      let pane = await this._loadTopicPane(id, held);
      if (this.syncStopped || this.topicId !== id || gen !== this.topicLoadGen) return;
      while (this.docSyncPending && this.topicId === id && gen === this.topicLoadGen) {
        this.docSyncPending = false;
        pane = await this._loadTopicPane(id, this.documents.length);
        if (this.syncStopped || this.topicId !== id || gen !== this.topicLoadGen) return;
      }
      const local = this.topic;
      const topic =
        local &&
        local.id === pane.topic.id &&
        Date.parse(local.updatedAt) > Date.parse(pane.topic.updatedAt)
          ? local
          : pane.topic;
      const atStart = new Set(docsAtReset);
      const serverIds = new Set(pane.documents.map((item) => item.id));
      const localIds = new Set(this.documents.map((item) => item.id));
      const dropIds: string[] = [];
      for (const docId of atStart) {
        if (!serverIds.has(docId) || !localIds.has(docId)) dropIds.push(docId);
      }
      const documents =
        this.docListGen === listGen && this.docsHeadReady
          ? mergeListedRows(this.documents, pane.documents, dropIds, (item) => item.id)
          : pane.documents;
      this.detailError = null;
      this.resetReloading = false;
      this._applyTopicPane(id, { ...pane, topic, documents });
      if (topic === pane.topic) this.applyTopic(topic);
      if (pane.job && (pane.job.status === 'pending' || pane.job.status === 'running')) {
        this.watchJob(pane.job);
      } else {
        this.activeJob = null;
        this.stopJobPolling();
      }
      this.syncDocPolling();
      if (!nodeId) return;
      try {
        const detail = await getMapNodeDetail(nodeId);
        if (gen === this.topicLoadGen && this.selectedNodeId === nodeId) this.nodeDetail = detail;
      } catch {
        // 节点详情失败时留着抽屉里已有的快照。
      }
    } catch (err) {
      if (gen !== this.topicLoadGen) return;
      if (this.topicId === id && err instanceof ApiError && err.status === 404) {
        this._dropTopic(id);
        return;
      }
      if (this.topicId !== id) return;
      this.detailError = errorMessage(err, '打不开这个主题');
    } finally {
      this.resetReloading = false;
    }
  }
}
