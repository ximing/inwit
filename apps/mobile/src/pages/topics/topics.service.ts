import AsyncStorage from '@react-native-async-storage/async-storage';
import { Service } from '@rabjs/react';
import type {
  Document,
  DocumentDetail,
  DocumentListItem,
  Job,
  MapNodeDetail,
  MapSummary,
  MapTreeNode,
  ReviewTopicStat,
  Topic,
} from '@inwit/dto';
import { isChatQuestion, topicJobPayloadFrom } from '@inwit/dto';
import { ApiError, errorMessage } from '@/api/client';
import { createChat, createDocument, getDocument, listDocuments } from '@/api/documents';
import { getJob } from '@/api/jobs';
import { getReviewTopicStats } from '@/api/review';
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
import { textToPmDoc } from '@/lib/pm-doc';
import { consumeEchoes } from '@/lib/sync-echo';
import {
  coalesceChanges,
  planReloads,
  type EchoStamp,
  type ReloadIntent,
  type SyncView,
} from '@/lib/sync-plan';
import { SyncService, type SyncEvent } from '@/services/sync.service';
import { ToastService } from '@/services/toast.service';

const POLL_MS = 3000;
const DOC_PAGE = 20;
const LIST_LIMIT_MAX = 100;

export type TopicTab = 'docs' | 'map' | 'feed';
export type TopicEditField = 'title' | 'goal';

export type TopicListItem = {
  topic: Topic;
  cardCount: number;
  documentCount: number;
  totalNodes: number;
  uncoveredNodes: number;
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

async function readCollapsed(topicId: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(collapsedKey(topicId));
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
    topicId: detail.topicId,
    fileMime: detail.fileMime,
    pageCount: detail.pageCount,
    updatedAt: detail.updatedAt,
    cardCount: detail.cards.filter((card) => card.acceptance === 'accepted').length,
    proposedCount: detail.cards.filter((card) => card.acceptance === 'proposed').length,
    topicTitle: detail.topicTitle ?? item.topicTitle,
  };
}

export function flattenMapTree(
  nodes: MapTreeNode[],
  collapsedIds: readonly string[],
  depth = 0,
): Array<{ node: MapTreeNode; depth: number }> {
  const closed = new Set(collapsedIds);
  const out: Array<{ node: MapTreeNode; depth: number }> = [];
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.children.length > 0 && !closed.has(node.id)) {
      out.push(...flattenMapTree(node.children, collapsedIds, depth + 1));
    }
  }
  return out;
}

export function firstUncoveredNode(
  nodes: MapTreeNode[],
  skipProposed = false,
): MapTreeNode | null {
  for (const node of nodes) {
    if (node.status === 'uncovered' && !(skipProposed && node.proposedCount > 0)) return node;
    const child = firstUncoveredNode(node.children, skipProposed);
    if (child) return child;
  }
  return null;
}

export class TopicsService extends Service {
  items: TopicListItem[] = [];
  topicStats: Record<string, ReviewTopicStat> = {};
  error: string | null = null;
  detailError: string | null = null;
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
  focused = false;
  appActive = true;

  jobPollTimer: ReturnType<typeof setInterval> | null = null;
  docPollTimer: ReturnType<typeof setInterval> | null = null;
  topicLoadGen = 0;
  private sync: SyncService | null = null;
  private unsubscribeSync: (() => void) | null = null;
  private syncChain: Promise<void> = Promise.resolve();
  private echoes: EchoStamp[] = [];
  private pinnedDocs = new Set<string>();
  private pinnedTopics = new Set<string>();
  private rowGen = new Map<string, number>();
  private topicGen = new Map<string, number>();
  private topicsGen = 0;
  private docListGen = 0;
  private topicOpens = 0;

  constructor() {
    super();
    try {
      this.sync = this.resolve(SyncService);
      this.unsubscribeSync = this.sync.subscribe((event) => this.onSyncEvent(event));
    } catch {
      this.sync = null;
    }
  }

  get toastService(): ToastService {
    return this.resolve(ToastService);
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

  get pollingAllowed(): boolean {
    return this.focused && this.appActive;
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

  get fillTarget(): MapTreeNode | null {
    if (this.selectedNodeId) {
      const selected = this.findNode(this.tree, this.selectedNodeId);
      if (selected?.status === 'uncovered' && selected.proposedCount <= 0) return selected;
    }
    // A node that only has proposed cards stays uncovered, but it is not a gap to fill.
    return firstUncoveredNode(this.tree, true);
  }

  /** Uncovered nodes exist, and every one of them is waiting on proposed cards. */
  get fillWaiting(): boolean {
    return this.fillTarget === null && firstUncoveredNode(this.tree) !== null;
  }

  hangingTitle(doc: DocumentListItem): string | null {
    if (!doc.mapNodeId) return null;
    return this.titleByNodeId[doc.mapNodeId] ?? null;
  }

  isCollapsed(id: string): boolean {
    return this.collapsedIds.includes(id);
  }

  findNode(nodes: MapTreeNode[], id: string): MapTreeNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      const child = this.findNode(node.children, id);
      if (child) return child;
    }
    return null;
  }

  setTab(tab: TopicTab): void {
    this.tab = tab;
  }

  setDraft(value: string): void {
    this.draft = value;
  }

  setNewTitle(value: string): void {
    this.newTitle = value;
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
    void AsyncStorage.setItem(collapsedKey(this.topicId), JSON.stringify(this.collapsedIds)).catch(
      () => {
        // ignore quota / private mode
      },
    );
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
    this.toastService.show(message);
  }

  setFocused(value: boolean): void {
    this.focused = value;
    if (!value) {
      this.stopJobPolling();
      this.stopDocPolling();
    } else {
      if (this.jobRunning) this.startJobPolling();
      this.syncDocPolling();
    }
  }

  setAppActive(value: boolean): void {
    this.appActive = value;
    if (!value) {
      this.stopJobPolling();
      this.stopDocPolling();
    } else if (this.focused) {
      if (this.jobRunning) this.startJobPolling();
      this.syncDocPolling();
    }
  }

  watchJob(job: Job): void {
    this.activeJob = job;
    if (job.status === 'pending' || job.status === 'running') {
      if (this.pollingAllowed) this.startJobPolling();
    } else {
      void this.onJobSettled(job);
    }
  }

  startJobPolling(): void {
    if (this.syncActive()) return;
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
    if (this.syncActive()) return;
    if (this.docPollTimer !== null) return;
    this.docPollTimer = setInterval(() => {
      void this.tickPending();
    }, POLL_MS);
  }

  stopDocPolling(): void {
    if (this.docPollTimer === null) return;
    clearInterval(this.docPollTimer);
    this.docPollTimer = null;
  }

  syncDocPolling(): void {
    if (this.syncActive()) {
      this.stopDocPolling();
      return;
    }
    const pending = this.documents.some((item) => item.status === 'pending');
    if (pending && this.pollingAllowed) this.startDocPolling();
    else this.stopDocPolling();
  }

  async load(): Promise<void> {
    this.error = null;
    try {
      const topics = await listTopics();
      const enriched = await Promise.all(topics.map((topic) => this._enrich(topic)));
      const seen = new Set(enriched.map((item) => item.topic.id));
      const prev = new Map(this.items.map((item) => [item.topic.id, item]));
      const pinned = this.items.filter(
        (item) => this.pinnedTopics.has(item.topic.id) && !seen.has(item.topic.id),
      );
      for (const id of seen) this.pinnedTopics.delete(id);
      this.items = [
        ...pinned,
        ...enriched.map((item) => {
          const local = prev.get(item.topic.id);
          if (!local) return item;
          return { ...item, topic: newerTopic(local.topic, item.topic) };
        }),
      ];
    } catch (err) {
      this.error = errorMessage(err, '加载主题失败');
      return;
    }
    try {
      const stats = await getReviewTopicStats();
      const next: Record<string, ReviewTopicStat> = {};
      for (const stat of stats) next[stat.topicId] = stat;
      this.topicStats = next;
    } catch {
      // Retention is optional; the topic list stays.
    }
  }

  async openTopic(id: string | null): Promise<void> {
    const gen = ++this.topicLoadGen;
    this.topicOpens += 1;
    try {
      await this.openTopicBody(id, gen);
    } finally {
      this.topicOpens -= 1;
    }
  }

  private async openTopicBody(id: string | null, gen: number): Promise<void> {
    this.topicId = id;
    this.detailError = null;
    this.closeDrawer();
    this.stopJobPolling();
    this.activeJob = null;
    this.editing = null;
    this.paneMenuOpen = false;
    this.draft = '';
    this.tab = 'docs';
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
    this.collapsedIds = await readCollapsed(id);
    const [topicR, mapR, summaryR, docsR, jobR] = await Promise.allSettled([
      getTopic(id),
      getTopicMap(id),
      getTopicMapSummary(id),
      listDocuments({ topicId: id, limit: DOC_PAGE, offset: 0 }),
      getActiveTopicJob(id),
    ]);
    if (gen !== this.topicLoadGen) return;
    if (topicR.status === 'rejected') {
      this.detailError = errorMessage(topicR.reason, '打不开这个主题');
      this.topic = null;
      this.tree = [];
      this.summary = null;
      this.documents = [];
      this.documentsTotal = 0;
      this.stopDocPolling();
      return;
    }
    const topic = topicR.value;
    this.topic = topic;
    if (mapR.status === 'fulfilled') this.applyMap(mapR.value.nodes);
    else {
      this.tree = [];
      this.titleByNodeId = {};
    }
    if (summaryR.status === 'fulfilled') this.summary = summaryR.value;
    else this.summary = null;
    if (docsR.status === 'fulfilled') this.applyDocPage(docsR.value.items, docsR.value.total, [], false);
    else {
      this.documents = [];
      this.documentsTotal = 0;
    }
    const summary = summaryR.status === 'fulfilled' ? summaryR.value : this.summary;
    if (summary) {
      this.patchItem(id, {
        cardCount: summary.cardCount,
        documentCount: docsR.status === 'fulfilled' ? docsR.value.total : this.documentsTotal,
        totalNodes: summary.totalNodes,
        uncoveredNodes: summary.uncoveredNodes,
        masteryPct: summary.masteryPct,
      });
    }
    if (topic.status === 'archived') this.archiveOpen = true;
    if (jobR.status === 'fulfilled' && jobR.value.job) this.watchJob(jobR.value.job);
    this.syncDocPolling();
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
      this.pinnedTopics.add(topic.id);
      this.bumpTopic(topic.id);
      this.items = [blankItem(topic), ...this.items.filter((item) => item.topic.id !== topic.id)];
      this.echoRow('topic', topic.id, topic.updatedAt);
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
        this.bumpTopic(updated.id);
        if (this.topic?.id === topicId) this.applyTopic(updated);
        this.echoRow('topic', updated.id, updated.updatedAt);
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
      this.bumpTopic(updated.id);
      if (this.topic?.id === topicId) this.applyTopic(updated);
      this.echoRow('topic', updated.id, updated.updatedAt);
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
      const archived = await archiveTopic(this.topic.id);
      this.bumpTopic(archived.id);
      this.applyTopic(archived);
      this.echoRow('topic', archived.id, archived.updatedAt);
      this.archiveOpen = true;
      this.showToast('已归档');
    } catch (err) {
      this.detailError = errorMessage(err, '归档失败');
    }
  }

  async restoreSelected(): Promise<void> {
    if (!this.topic || this.topic.status !== 'archived') return;
    this.paneMenuOpen = false;
    this.error = null;
    try {
      const restored = await restoreTopic(this.topic.id);
      this.bumpTopic(restored.id);
      this.applyTopic(restored);
      this.echoRow('topic', restored.id, restored.updatedAt);
      this.showToast('已取消归档');
    } catch (err) {
      this.detailError = errorMessage(err, '恢复失败');
    }
  }

  async deleteSelected(): Promise<boolean> {
    if (!this.topic) return false;
    this.paneMenuOpen = false;
    this.error = null;
    const id = this.topic.id;
    try {
      await deleteTopic(id);
      this.items = this.items.filter((item) => item.topic.id !== id);
      this.topic = null;
      this.tree = [];
      this.summary = null;
      this.documents = [];
      this.documentsTotal = 0;
      this.topicId = null;
      this.stopJobPolling();
      this.stopDocPolling();
      return true;
    } catch (err) {
      this.detailError = errorMessage(err, '删除失败');
      return false;
    }
  }

  async send(mode: 'auto' | 'chat' | 'paste' = 'auto'): Promise<string | null> {
    if (!this.topic || this.topic.status === 'archived') return null;
    const content = this.draft.trim();
    if (content.length === 0) return null;
    this.detailError = null;
    const useChat = mode === 'chat' || (mode === 'auto' && isChatQuestion(content));
    try {
      const created = useChat
        ? await createChat({ question: content, topicId: this.topic.id })
        : await createDocument({ contentJson: textToPmDoc(content), topicId: this.topic.id });
      this.draft = '';
      this.ingestCreated(created);
      this.showToast(useChat ? '问题扔出去了，正在答' : '已收下，消化中');
      return created.id;
    } catch (err) {
      this.detailError = errorMessage(err, useChat ? '提问失败' : '发送失败');
      return null;
    }
  }

  ingestCreated(created: Document): void {
    this.pinnedDocs.add(created.id);
    this.bumpRow(created.id);
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
    if (this.topicOpens === 0) this.echoRow('document', created.id, created.updatedAt);
    this.syncDocPolling();
  }

  async refreshAfterJob(): Promise<void> {
    if (!this.topicId) return;
    const topicId = this.topicId;
    const want = Math.min(LIST_LIMIT_MAX, Math.max(this.documents.length, DOC_PAGE));
    const [mapR, summaryR, docsR] = await Promise.allSettled([
      getTopicMap(topicId),
      getTopicMapSummary(topicId),
      listDocuments({ topicId, limit: want, offset: 0 }),
    ]);
    if (this.topicId !== topicId) return;
    if (mapR.status === 'fulfilled') this.applyMap(mapR.value.nodes);
    else this.detailError = errorMessage(mapR.reason, '刷新地图失败');
    if (summaryR.status === 'fulfilled') this.applySummary(summaryR.value);
    if (docsR.status === 'fulfilled') {
      this.applyDocPage(docsR.value.items, docsR.value.total, [], true);
      this.patchItem(topicId, { documentCount: docsR.value.total });
    }
    if (this.selectedNodeId) await this.openNode(this.selectedNodeId);
    this.syncDocPolling();
  }

  async refreshSummary(): Promise<void> {
    if (!this.topicId) return;
    try {
      const summary = await getTopicMapSummary(this.topicId);
      this.summary = summary;
      this.patchItem(this.topicId, {
        cardCount: summary.cardCount,
        totalNodes: summary.totalNodes,
        uncoveredNodes: summary.uncoveredNodes,
        masteryPct: summary.masteryPct,
      });
    } catch {
      // keep last snapshot
    }
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

  async fill(nodeId?: string): Promise<void> {
    if (!this.topic || this.topic.status === 'archived' || this.jobRunning) return;
    let target = nodeId;
    if (target) {
      const node = this.findNode(this.tree, target);
      if (node && node.proposedCount > 0) {
        this.showToast('有待确认的卡');
        return;
      }
    } else {
      target = this.fillTarget?.id;
    }
    if (!target) {
      if (this.fillWaiting) this.showToast('有待确认的卡');
      else this.detailError = '没有可补充的未覆盖节点';
      return;
    }
    this.detailError = null;
    try {
      const job = await fillMapNode(target);
      this.watchJob(job);
      void this.openNode(target);
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
    this.showToast('已有主题任务在进行');
    try {
      const jobId = jobIdFromConflict(err);
      const job = jobId ? await getJob(jobId) : (await getActiveTopicJob(this.topicId)).job;
      if (job) this.watchJob(job);
      return true;
    } catch {
      this.detailError = '主题任务冲突，无法接续';
      return true;
    }
  }

  async tickJob(): Promise<void> {
    if (!this.syncActive() && !this.pollingAllowed) {
      this.stopJobPolling();
      return;
    }
    const current = this.activeJob;
    if (!current) {
      this.stopJobPolling();
      return;
    }
    try {
      const job = await getJob(current.id);
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
    } else {
      this.showToast(this.organizing || job.type === 'topic' ? '地图已更新' : '补充完成');
    }
    this.activeJob = null;
    await this.refreshAfterJob();
  }

  async loadMoreDocs(): Promise<void> {
    if (!this.topicId || !this.hasMoreDocs || this.$model.loadMoreDocs.loading) return;
    const page = await listDocuments({
      topicId: this.topicId,
      limit: DOC_PAGE,
      offset: this.documents.length,
    });
    const have = new Set(this.documents.map((item) => item.id));
    this.documents = [...this.documents, ...page.items.filter((item) => !have.has(item.id))];
    this.documentsTotal = page.total;
    this.patchItem(this.topicId, { documentCount: page.total });
    this.syncDocPolling();
  }

  async tickPending(): Promise<void> {
    if (!this.pollingAllowed) {
      this.stopDocPolling();
      return;
    }
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
    const gen = this.bumpRow(id);
    try {
      const detail = await getDocument(id);
      if (this.rowGen.get(id) !== gen) return;
      if (!this.documents.some((item) => item.id === id)) return;
      this.documents = this.documents.map((item) =>
        item.id === id ? mergeDetail(item, detail) : item,
      );
    } catch (err) {
      if (this.rowGen.get(id) !== gen) return;
      if (err instanceof ApiError && err.status === 404) this.forgetDocument(id);
    }
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
    this.unsubscribeSync?.();
    this.unsubscribeSync = null;
    this.sync = null;
    this.stopJobPolling();
    this.stopDocPolling();
    super.destroy();
  }

  private syncActive(): boolean {
    return this.sync?.active === true;
  }

  private bumpRow(id: string): number {
    const gen = (this.rowGen.get(id) ?? 0) + 1;
    this.rowGen.set(id, gen);
    return gen;
  }

  private bumpTopic(id: string): number {
    const gen = (this.topicGen.get(id) ?? 0) + 1;
    this.topicGen.set(id, gen);
    return gen;
  }

  private echoRow(
    scope: 'document' | 'topic',
    resourceId: string | null,
    updatedAt: string | null | undefined,
  ): void {
    if (!resourceId || !updatedAt) return;
    const atMs = Date.parse(updatedAt);
    if (Number.isNaN(atMs)) return;
    const dup = this.echoes.some(
      (echo) => echo.scope === scope && echo.resourceId === resourceId && echo.atMs === atMs,
    );
    if (dup) return;
    this.echoes.push({ scope, resourceId, atMs });
    if (this.echoes.length > 200) this.echoes.splice(0, this.echoes.length - 200);
  }

  private applySummary(summary: MapSummary): void {
    this.summary = summary;
    if (!this.topicId) return;
    this.patchItem(this.topicId, {
      cardCount: summary.cardCount,
      totalNodes: summary.totalNodes,
      uncoveredNodes: summary.uncoveredNodes,
      masteryPct: summary.masteryPct,
    });
  }

  private applyDocPage(
    items: DocumentListItem[],
    total: number,
    deleteIds: readonly string[],
    keepTail: boolean,
  ): void {
    const prev = new Map(this.documents.map((item) => [item.id, item]));
    const seen = new Set(items.map((item) => item.id));
    for (const id of seen) this.pinnedDocs.delete(id);
    const merged = items.map((item) => newerDoc(prev.get(item.id), item));
    const pinned = this.documents.filter((item) => this.pinnedDocs.has(item.id) && !seen.has(item.id));
    const tail = keepTail
      ? this.documents.filter((item) => !seen.has(item.id) && !this.pinnedDocs.has(item.id))
      : [];
    const drop = new Set(deleteIds);
    this.documents = [...pinned, ...merged, ...tail].filter((item) => !drop.has(item.id));
    this.documentsTotal = Math.max(total, this.documents.length);
  }

  private forgetDocument(id: string): void {
    this.pinnedDocs.delete(id);
    const had = this.documents.some((doc) => doc.id === id);
    this.documents = this.documents.filter((doc) => doc.id !== id);
    if (had) this.documentsTotal = Math.max(0, this.documentsTotal - 1);
    if (this.topicId) this.patchItem(this.topicId, { documentCount: this.documentsTotal });
    this.syncDocPolling();
  }

  private forgetTopic(id: string): void {
    this.pinnedTopics.delete(id);
    this.items = this.items.filter((item) => item.topic.id !== id);
    if (this.topicId !== id && this.topic?.id !== id) return;
    this.topic = null;
    this.tree = [];
    this.summary = null;
    this.documents = [];
    this.documentsTotal = 0;
    this.titleByNodeId = {};
    this.topicId = null;
    this.activeJob = null;
    this.detailError = '打不开这个主题';
    this.stopJobPolling();
    this.stopDocPolling();
  }

  private adoptTopic(topic: Topic): void {
    if (this.topicId === topic.id) {
      this.applyTopic(topic);
      return;
    }
    const index = this.items.findIndex((item) => item.topic.id === topic.id);
    if (index < 0) {
      this.items = [blankItem(topic), ...this.items];
      return;
    }
    this.items = this.items.map((item, i) => (i === index ? { ...item, topic } : item));
  }

  private onSyncEvent(event: SyncEvent): void {
    if (event.type === 'active') {
      if (event.active) {
        this.stopJobPolling();
        this.stopDocPolling();
      } else {
        if (this.jobRunning && this.pollingAllowed) this.startJobPolling();
        this.syncDocPolling();
      }
      return;
    }
    this.syncChain = this.syncChain.then(() => this.handleSync(event)).catch(() => undefined);
  }

  private async handleSync(event: SyncEvent): Promise<void> {
    if (event.type === 'reset') {
      await this.reloadFromReset();
      return;
    }
    if (event.type !== 'changes') return;
    const changes = coalesceChanges(consumeEchoes(event.changes, this.echoes));
    await this.applySyncIntents(planReloads(changes, this.syncView()));
  }

  private syncView(): SyncView {
    const topicIds = this.items.map((item) => item.topic.id);
    if (this.topic && !topicIds.includes(this.topic.id)) topicIds.push(this.topic.id);
    return {
      documents: this.topicId
        ? this.documents.map((item) => ({ id: item.id, updatedAt: item.updatedAt }))
        : [],
      openDocumentId: null,
      listIncludesHead: this.topicId !== null,
      editor: null,
      topics: topicIds.map((id) => ({ id })),
      openTopicId: this.topicId,
      mapTopicId: this.topicId,
      readerDocumentId: null,
      readerActiveCardId: null,
      reviewInSession: false,
      jobs: [],
      activeJobId: this.activeJob?.id ?? null,
    };
  }

  private async applySyncIntents(intents: ReloadIntent[]): Promise<void> {
    const deleteDocs = intents.flatMap((intent) =>
      intent.kind === 'document' && intent.op === 'delete' ? [intent.id] : [],
    );
    const upsertDocs = intents.flatMap((intent) =>
      intent.kind === 'document' && intent.op === 'upsert' ? [intent.id] : [],
    );
    const deleteTopics = intents.flatMap((intent) =>
      intent.kind === 'topic' && intent.op === 'delete' ? [intent.id] : [],
    );
    const upsertTopics = intents.flatMap((intent) =>
      intent.kind === 'topic' && intent.op === 'upsert' ? [intent.id] : [],
    );
    if (intents.some((intent) => intent.kind === 'documents-page') && this.topicId) {
      await this.reloadDocs(this.topicId, deleteDocs, true);
    }
    for (const id of deleteDocs) {
      this.bumpRow(id);
      this.forgetDocument(id);
    }
    for (const id of upsertDocs) {
      if (this.documents.some((item) => item.id === id)) await this.refreshOne(id);
    }
    if (intents.some((intent) => intent.kind === 'topics-page')) await this.reloadTopics();
    for (const id of deleteTopics) this.forgetTopic(id);
    for (const id of upsertTopics) {
      if (this.topicId === id || this.items.some((item) => item.topic.id === id)) {
        await this.refreshTopic(id);
      }
    }
    for (const intent of intents) {
      if (intent.kind === 'map' && intent.topicId === this.topicId) await this.refreshMap(intent.topicId);
      if (intent.kind === 'job' && this.activeJob?.id === intent.id) await this.tickJob();
    }
  }

  private async reloadFromReset(): Promise<void> {
    await this.reloadTopics();
    if (!this.topicId) {
      try {
        const stats = await getReviewTopicStats();
        const next: Record<string, ReviewTopicStat> = {};
        for (const stat of stats) next[stat.topicId] = stat;
        this.topicStats = next;
      } catch {
        // Retention is optional.
      }
      return;
    }
    const topicId = this.topicId;
    await this.reloadDocs(topicId, [], false);
    const [topicR, mapR, summaryR, jobR] = await Promise.allSettled([
      getTopic(topicId),
      getTopicMap(topicId),
      getTopicMapSummary(topicId),
      getActiveTopicJob(topicId),
    ]);
    if (this.topicId !== topicId) return;
    if (topicR.status === 'fulfilled') this.applyTopic(topicR.value);
    else if (topicR.reason instanceof ApiError && topicR.reason.status === 404) {
      this.forgetTopic(topicId);
      return;
    }
    if (mapR.status === 'fulfilled') this.applyMap(mapR.value.nodes);
    if (summaryR.status === 'fulfilled') this.applySummary(summaryR.value);
    if (jobR.status === 'fulfilled') {
      if (jobR.value.job) this.watchJob(jobR.value.job);
      else {
        this.activeJob = null;
        this.stopJobPolling();
      }
    }
    if (this.selectedNodeId) await this.openNode(this.selectedNodeId);
    this.syncDocPolling();
  }

  private async reloadTopics(): Promise<void> {
    const gen = ++this.topicsGen;
    try {
      const topics = await listTopics();
      if (gen !== this.topicsGen) return;
      const prev = new Map(this.items.map((item) => [item.topic.id, item]));
      const seen = new Set(topics.map((topic) => topic.id));
      const next: TopicListItem[] = [];
      for (const topic of topics) {
        const existing = prev.get(topic.id);
        if (existing) next.push({ ...existing, topic: newerTopic(existing.topic, topic) });
        else next.push(await this._enrich(topic));
      }
      if (gen !== this.topicsGen) return;
      const pinned = this.items.filter(
        (item) => this.pinnedTopics.has(item.topic.id) && !seen.has(item.topic.id),
      );
      for (const id of seen) this.pinnedTopics.delete(id);
      this.items = [...pinned, ...next];
      if (this.topicId) {
        const fresh = this.items.find((item) => item.topic.id === this.topicId);
        if (fresh) this.topic = fresh.topic;
      }
    } catch {
      // Keep the topics already on screen.
    }
  }

  private async reloadDocs(
    topicId: string,
    deleteIds: readonly string[],
    keepTail: boolean,
  ): Promise<void> {
    const gen = ++this.docListGen;
    const want = Math.max(this.documents.length, DOC_PAGE);
    try {
      const items: DocumentListItem[] = [];
      let total = 0;
      let offset = 0;
      while (items.length < want) {
        const limit = Math.min(LIST_LIMIT_MAX, want - items.length);
        const page = await listDocuments({ topicId, limit, offset });
        total = page.total;
        items.push(...page.items);
        if (page.items.length === 0 || items.length >= total) break;
        offset += page.items.length;
      }
      if (gen !== this.docListGen || this.topicId !== topicId) return;
      this.applyDocPage(items, total, deleteIds, keepTail);
      if (this.topicId) this.patchItem(this.topicId, { documentCount: this.documentsTotal });
      this.syncDocPolling();
    } catch {
      // Keep the rows already on screen.
    }
  }

  private async refreshTopic(id: string): Promise<void> {
    const gen = this.bumpTopic(id);
    try {
      const topic = await getTopic(id);
      if (this.topicGen.get(id) !== gen) return;
      this.adoptTopic(topic);
    } catch (err) {
      if (this.topicGen.get(id) !== gen) return;
      if (err instanceof ApiError && err.status === 404) this.forgetTopic(id);
    }
  }

  private async refreshMap(topicId: string): Promise<void> {
    if (this.topicId !== topicId) return;
    const [mapR, summaryR] = await Promise.allSettled([
      getTopicMap(topicId),
      getTopicMapSummary(topicId),
    ]);
    if (this.topicId !== topicId) return;
    if (mapR.status === 'fulfilled') this.applyMap(mapR.value.nodes);
    if (summaryR.status === 'fulfilled') this.applySummary(summaryR.value);
    if (this.selectedNodeId) await this.openNode(this.selectedNodeId);
  }
}

function newerTopic(local: Topic, incoming: Topic): Topic {
  const localMs = Date.parse(local.updatedAt);
  const nextMs = Date.parse(incoming.updatedAt);
  if (!Number.isNaN(localMs) && !Number.isNaN(nextMs) && localMs > nextMs) return local;
  return incoming;
}

function newerDoc(
  local: DocumentListItem | undefined,
  incoming: DocumentListItem,
): DocumentListItem {
  if (!local) return incoming;
  const localMs = Date.parse(local.updatedAt);
  const nextMs = Date.parse(incoming.updatedAt);
  if (!Number.isNaN(localMs) && !Number.isNaN(nextMs) && localMs > nextMs) return local;
  return incoming;
}
