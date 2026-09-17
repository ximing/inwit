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
  Topic,
} from '@inwit/dto';
import { isChatQuestion, topicJobPayloadFrom } from '@inwit/dto';
import { ApiError, errorMessage } from '@/api/client';
import { createChat, createDocument, getDocument, listDocuments } from '@/api/documents';
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
import { textToPmDoc } from '@/lib/pm-doc';
import { ToastService } from '@/services/toast.service';

const POLL_MS = 3000;
const DOC_PAGE = 20;

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
    cardCount: detail.cards.length,
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

export function firstUncoveredNode(nodes: MapTreeNode[]): MapTreeNode | null {
  for (const node of nodes) {
    if (node.status === 'uncovered') return node;
    const child = firstUncoveredNode(node.children);
    if (child) return child;
  }
  return null;
}

export class TopicsService extends Service {
  items: TopicListItem[] = [];
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
      if (selected?.status === 'uncovered') return selected;
    }
    return firstUncoveredNode(this.tree);
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
    const pending = this.documents.some((item) => item.status === 'pending');
    if (pending && this.pollingAllowed) this.startDocPolling();
    else this.stopDocPolling();
  }

  async load(): Promise<void> {
    this.error = null;
    try {
      const topics = await listTopics();
      this.items = await Promise.all(topics.map((topic) => this._enrich(topic)));
    } catch (err) {
      this.error = errorMessage(err, '加载主题失败');
    }
  }

  async openTopic(id: string | null): Promise<void> {
    const gen = ++this.topicLoadGen;
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
    try {
      const [topic, map, summary, docs, active] = await Promise.all([
        getTopic(id),
        getTopicMap(id),
        getTopicMapSummary(id),
        listDocuments({ topicId: id, limit: DOC_PAGE, offset: 0 }),
        getActiveTopicJob(id),
      ]);
      if (gen !== this.topicLoadGen) return;
      this.topic = topic;
      this.applyMap(map.nodes);
      this.summary = summary;
      this.documents = docs.items;
      this.documentsTotal = docs.total;
      this.patchItem(id, {
        cardCount: summary.cardCount,
        documentCount: docs.total,
        totalNodes: summary.totalNodes,
        uncoveredNodes: summary.uncoveredNodes,
        masteryPct: summary.masteryPct,
      });
      if (topic.status === 'archived') this.archiveOpen = true;
      if (active.job) this.watchJob(active.job);
      this.syncDocPolling();
    } catch (err) {
      if (gen !== this.topicLoadGen) return;
      this.detailError = errorMessage(err, '打不开这个主题');
      this.topic = null;
      this.tree = [];
      this.summary = null;
      this.documents = [];
      this.documentsTotal = 0;
      this.stopDocPolling();
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
      this.items = [blankItem(topic), ...this.items];
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
        if (this.topic?.id === topicId) this.applyTopic(updated);
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
      if (this.topic?.id === topicId) this.applyTopic(updated);
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
      this.applyTopic(await archiveTopic(this.topic.id));
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
      this.applyTopic(await restoreTopic(this.topic.id));
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
    this.syncDocPolling();
  }

  async refreshAfterJob(): Promise<void> {
    if (!this.topicId) return;
    try {
      const [map, summary, docs] = await Promise.all([
        getTopicMap(this.topicId),
        getTopicMapSummary(this.topicId),
        listDocuments({ topicId: this.topicId, limit: DOC_PAGE, offset: 0 }),
      ]);
      this.applyMap(map.nodes);
      this.summary = summary;
      this.documents = docs.items;
      this.documentsTotal = docs.total;
      this.patchItem(this.topicId, {
        cardCount: summary.cardCount,
        documentCount: docs.total,
        totalNodes: summary.totalNodes,
        uncoveredNodes: summary.uncoveredNodes,
        masteryPct: summary.masteryPct,
      });
      if (this.selectedNodeId) await this.openNode(this.selectedNodeId);
      this.syncDocPolling();
    } catch (err) {
      this.detailError = errorMessage(err, '刷新地图失败');
    }
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
    const target = nodeId ?? this.fillTarget?.id;
    if (!target) {
      this.detailError = '没有可补充的未覆盖节点';
      return;
    }
    this.detailError = null;
    try {
      const job = await fillMapNode(target);
      this.watchJob(job);
      void this.openNode(target);
    } catch (err) {
      if (await this.resumeFromConflict(err)) return;
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
    if (!this.pollingAllowed) {
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
    try {
      const detail = await getDocument(id);
      this.documents = this.documents.map((item) =>
        item.id === id ? mergeDetail(item, detail) : item,
      );
    } catch {
      // Transient poll errors should not wipe the list.
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
    this.stopJobPolling();
    this.stopDocPolling();
    super.destroy();
  }
}
