import { Service } from '@rabjs/react';
import type {
  DocumentListItem,
  Job,
  MapNodeDetail,
  MapSummary,
  MapTreeNode,
  Topic,
} from '@inwit/dto';
import { topicJobPayloadFrom } from '@inwit/dto';
import { ApiError, errorMessage } from '@/api/client';
import { listDocuments } from '@/api/documents';
import { getJob } from '@/api/jobs';
import {
  fillMapNode,
  getActiveTopicJob,
  getMapNodeDetail,
  getTopicMap,
  getTopicMapSummary,
  organizeTopicMap,
} from '@/api/maps';
import { archiveTopic, getTopic } from '@/api/topics';

const POLL_MS = 3000;
const DOC_PAGE = 50;

export type TopicTab = 'map' | 'feed';

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

export class TopicService extends Service {
  topic: Topic | null = null;
  tree: MapTreeNode[] = [];
  summary: MapSummary | null = null;
  documents: DocumentListItem[] = [];
  documentsTotal = 0;
  titleByNodeId: Record<string, string> = {};
  tab: TopicTab = 'map';
  collapsedIds: string[] = [];
  selectedNodeId: string | null = null;
  nodeDetail: MapNodeDetail | null = null;
  activeJob: Job | null = null;
  error: string | null = null;
  busyArchive = false;
  pollTimer: ReturnType<typeof setInterval> | null = null;
  topicId: string | null = null;

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

  watchJob(job: Job): void {
    this.activeJob = job;
    if (job.status === 'pending' || job.status === 'running') this.startPolling();
    else void this.onJobSettled(job);
  }

  startPolling(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => {
      void this.tickJob();
    }, POLL_MS);
  }

  stopPolling(): void {
    if (this.pollTimer === null) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async load(id: string): Promise<void> {
    this.topicId = id;
    this.error = null;
    this.tab = 'map';
    this.closeDrawer();
    this.stopPolling();
    this.activeJob = null;
    this.collapsedIds = readCollapsed(id);
    try {
      const [topic, map, summary, docs, active] = await Promise.all([
        getTopic(id),
        getTopicMap(id),
        getTopicMapSummary(id),
        listDocuments({ topicId: id, limit: DOC_PAGE, offset: 0 }),
        getActiveTopicJob(id),
      ]);
      this.topic = topic;
      this.applyMap(map.nodes);
      this.summary = summary;
      this.documents = docs.items;
      this.documentsTotal = docs.total;
      if (active.job) this.watchJob(active.job);
    } catch (err) {
      this.error = errorMessage(err, '打不开这个主题');
      this.topic = null;
      this.tree = [];
      this.summary = null;
      this.documents = [];
    }
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
      if (this.selectedNodeId) await this.openNode(this.selectedNodeId);
    } catch (err) {
      this.error = errorMessage(err, '刷新地图失败');
    }
  }

  async openNode(nodeId: string): Promise<void> {
    this.selectedNodeId = nodeId;
    try {
      this.nodeDetail = await getMapNodeDetail(nodeId);
    } catch (err) {
      this.error = errorMessage(err, '打不开这个节点');
      this.nodeDetail = null;
    }
  }

  async organize(): Promise<void> {
    if (!this.topic || this.topic.status === 'archived' || this.jobRunning) return;
    this.error = null;
    try {
      const job = await organizeTopicMap(this.topic.id);
      this.watchJob(job);
    } catch (err) {
      if (await this.resumeFromConflict(err)) return;
      this.error = errorMessage(err, '整理地图失败');
    }
  }

  async fill(nodeId: string): Promise<void> {
    if (!this.topic || this.topic.status === 'archived' || this.jobRunning) return;
    this.error = null;
    try {
      const job = await fillMapNode(nodeId);
      this.watchJob(job);
      void this.openNode(nodeId);
    } catch (err) {
      if (await this.resumeFromConflict(err)) return;
      this.error = errorMessage(err, '补节点失败');
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
      this.stopPolling();
      return;
    }
    try {
      const job = await getJob(current.id);
      this.activeJob = job;
      if (job.status === 'done' || job.status === 'failed') {
        this.stopPolling();
        await this.onJobSettled(job);
      }
    } catch {
      // keep last snapshot
    }
  }

  async onJobSettled(job: Job): Promise<void> {
    if (job.status === 'failed') {
      this.error = job.lastError ?? '地图任务失败';
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
    this.documents = [...this.documents, ...page.items];
    this.documentsTotal = page.total;
  }

  async archive(): Promise<void> {
    if (!this.topic || this.busyArchive) return;
    this.busyArchive = true;
    this.error = null;
    try {
      this.topic = await archiveTopic(this.topic.id);
    } catch (err) {
      this.error = errorMessage(err, '归档失败');
    } finally {
      this.busyArchive = false;
    }
  }

  override destroy(): void {
    this.stopPolling();
    super.destroy();
  }
}
