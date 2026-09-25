import { Service } from '@rabjs/react';
import {
  EMPTY_PM_DOC,
  isChatQuestion,
  type Document,
  type DocumentDetail,
  type DocumentListItem,
  type DocumentSource,
  type DocumentStatus,
  type Job,
  type Topic,
} from '@inwit/dto';
import { errorMessage } from '@/api/client';
import {
  createChat,
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  retryDocument,
  updateDocument,
} from '@/api/documents';
import { getJobQueue } from '@/api/jobs';
import { createTopic, listTopics } from '@/api/topics';
import { describeDocumentStage, pickDocumentJob, type DocPipelineStage } from '@/lib/doc-pipeline';
import { checkpointPercent } from '@/lib/import-logic';
import { isBlankPmDoc, textToPmDoc } from '@/lib/pm-doc';
import { ToastService } from '@/services/toast.service';
import { ImportService } from './import.service';

const DOC_PAGE = 20;
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
    topicId: detail.topicId,
    fileMime: detail.fileMime,
    pageCount: detail.pageCount,
    updatedAt: detail.updatedAt,
    cardCount: detail.cards.filter((card) => card.acceptance === 'accepted').length,
    proposedCount: detail.cards.filter((card) => card.acceptance === 'proposed').length,
    topicTitle: detail.topicTitle ?? item.topicTitle,
  };
}

export class DocsService extends Service {
  topics: Topic[] = [];
  documents: DocumentListItem[] = [];
  documentsTotal = 0;
  filterTopicId: string | null = null;
  captureTopicId: string | null = null;
  draft = '';
  error: string | null = null;
  activeJobs: Job[] = [];
  retryingId: string | null = null;
  focused = false;
  appActive = true;
  pollTimer: ReturnType<typeof setInterval> | null = null;
  loadGen = 0;

  get toastService(): ToastService {
    return this.resolve(ToastService);
  }

  get importService(): ImportService {
    return this.resolve(ImportService);
  }

  /** Filter wins; otherwise the capture-box topic. */
  get actionTopicId(): string | undefined {
    return this.filterTopicId ?? this.captureTopicId ?? undefined;
  }

  get cancelingId(): string | null {
    return this.importService.cancelingId;
  }

  get captureTopic(): Topic | null {
    if (this.captureTopicId === null) return null;
    return this.topics.find((topic) => topic.id === this.captureTopicId) ?? null;
  }

  get canSend(): boolean {
    return this.draft.trim().length > 0 && !this.$model.send.loading;
  }

  get draftLooksLikeQuestion(): boolean {
    return isChatQuestion(this.draft);
  }

  get hasMore(): boolean {
    return this.documents.length < this.documentsTotal;
  }

  get pollingAllowed(): boolean {
    return this.focused && this.appActive;
  }

  jobFor(documentId: string): Job | null {
    return pickDocumentJob(this.activeJobs, documentId);
  }

  stageFor(doc: {
    id: string;
    status: DocumentStatus;
    source: DocumentSource;
    contentJson?: unknown;
  }): DocPipelineStage {
    const upload = this.importService.uploadByDoc[doc.id];
    const checkpoint = this.importService.checkpointFor(doc.id);
    const job = upload ? null : this.jobFor(doc.id);
    const uploadPercent = upload
      ? upload.percent
      : !job && checkpoint
        ? checkpointPercent(checkpoint)
        : null;
    return describeDocumentStage({
      status: doc.status,
      source: doc.source,
      uploadPercent,
      hasCheckpoint: Boolean(checkpoint),
      hasContent: !isBlankPmDoc(doc.contentJson),
      job,
    });
  }

  setDraft(value: string): void {
    this.draft = value;
  }

  selectCaptureTopic(id: string | null): void {
    this.captureTopicId = id;
  }

  showToast(message: string): void {
    this.toastService.show(message);
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

  async boot(): Promise<void> {
    this.error = null;
    try {
      await this.importService.hydrate();
    } catch {
      // A missing checkpoint store should not block the list.
    }
    try {
      this.topics = await listTopics('active');
      if (this.captureTopicId && !this.topics.some((topic) => topic.id === this.captureTopicId)) {
        this.captureTopicId = null;
      }
      if (this.filterTopicId && !this.topics.some((topic) => topic.id === this.filterTopicId)) {
        this.filterTopicId = null;
      }
      await this.loadDocuments();
    } catch (err) {
      this.error = errorMessage(err, '加载失败');
    }
  }

  async setFilter(topicId: string | null): Promise<void> {
    if (this.filterTopicId === topicId) return;
    this.filterTopicId = topicId;
    await this.loadDocuments();
  }

  async loadDocuments(): Promise<void> {
    const gen = ++this.loadGen;
    try {
      const page = await listDocuments({
        ...(this.filterTopicId ? { topicId: this.filterTopicId } : {}),
        limit: DOC_PAGE,
        offset: 0,
      });
      if (gen !== this.loadGen) return;
      this.documents = page.items;
      this.documentsTotal = page.total;
      await this.refreshJobs();
      this.syncPolling();
    } catch (err) {
      if (gen !== this.loadGen) return;
      this.error = errorMessage(err, '加载文档失败');
    }
  }

  async loadMore(): Promise<void> {
    if (!this.hasMore || this.$model.loadMore.loading) return;
    const gen = this.loadGen;
    const page = await listDocuments({
      ...(this.filterTopicId ? { topicId: this.filterTopicId } : {}),
      limit: DOC_PAGE,
      offset: this.documents.length,
    });
    if (gen !== this.loadGen) return;
    const have = new Set(this.documents.map((item) => item.id));
    this.documents = [...this.documents, ...page.items.filter((item) => !have.has(item.id))];
    this.documentsTotal = page.total;
    await this.refreshJobs();
    this.syncPolling();
  }

  async send(mode: 'auto' | 'chat' | 'paste' = 'auto'): Promise<string | null> {
    const content = this.draft.trim();
    if (content.length === 0) return null;
    this.error = null;
    const useChat = mode === 'chat' || (mode === 'auto' && isChatQuestion(content));
    try {
      const created = useChat
        ? await createChat({
            question: content,
            ...(this.captureTopicId ? { topicId: this.captureTopicId } : {}),
          })
        : await createDocument({
            contentJson: textToPmDoc(content),
            ...(this.captureTopicId ? { topicId: this.captureTopicId } : {}),
          });
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
      topicTitle: this.topicTitleById(created.topicId) ?? this.captureTopic?.title ?? null,
    });
    const matchesFilter = this.filterTopicId === null || this.filterTopicId === created.topicId;
    if (matchesFilter) {
      const exists = this.documents.some((doc) => doc.id === created.id);
      this.documents = [item, ...this.documents.filter((doc) => doc.id !== created.id)];
      if (!exists) this.documentsTotal += 1;
    }
    this.syncPolling();
  }

  async createBlank(): Promise<string | null> {
    const topicId = this.actionTopicId;
    try {
      const created = await createDocument({
        contentJson: EMPTY_PM_DOC,
        source: 'editor',
        ...(topicId ? { topicId } : {}),
      });
      this.ingestCreated(created);
      return created.id;
    } catch (err) {
      this.showToast(errorMessage(err, '没建出来，再试一次'));
      return null;
    }
  }

  async renameDocument(id: string, rawTitle: string): Promise<boolean> {
    const trimmed = rawTitle.trim();
    try {
      const updated = await updateDocument(id, { title: trimmed.length === 0 ? null : trimmed });
      this.documents = this.documents.map((item) =>
        item.id === id ? { ...item, title: updated.title, updatedAt: updated.updatedAt } : item,
      );
      return true;
    } catch (err) {
      this.showToast(errorMessage(err, '没改成'));
      return false;
    }
  }

  async archiveDocument(id: string): Promise<void> {
    if (this.importService.checkpointFor(id) || this.importService.uploadingDocumentId === id) {
      await this.importService.cancelImport(id);
      this.showToast('已取消上传');
      return;
    }
    try {
      await deleteDocument(id);
      const had = this.documents.some((doc) => doc.id === id);
      this.documents = this.documents.filter((doc) => doc.id !== id);
      if (had) this.documentsTotal = Math.max(0, this.documentsTotal - 1);
      this.showToast('已移入回收站');
    } catch (err) {
      this.showToast(errorMessage(err, '没移进去'));
    }
  }

  async cancelImport(id: string): Promise<void> {
    await this.importService.cancelImport(id);
  }

  topicTitleById(id: string | null): string | null {
    if (!id) return null;
    return this.topics.find((topic) => topic.id === id)?.title ?? null;
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
      this.captureTopicId = topic.id;
      return null;
    } catch (err) {
      return errorMessage(err, '创建主题失败');
    }
  }

  async retryFailed(documentId: string): Promise<void> {
    this.retryingId = documentId;
    try {
      await retryDocument(documentId);
      await Promise.all([this.refreshOne(documentId), this.refreshJobs()]);
      this.syncPolling();
    } catch (err) {
      this.showToast(errorMessage(err, '没重试上'));
    } finally {
      this.retryingId = null;
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

  syncPolling(): void {
    const listPending = this.documents.some((item) => item.status === 'pending');
    if (listPending && this.pollingAllowed) this.startPolling();
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
    await Promise.all([this.refreshJobs(), ...pending.map((item) => this.refreshOne(item.id))]);
    this.syncPolling();
  }

  async refreshJobs(): Promise<void> {
    try {
      const queue = await getJobQueue();
      this.activeJobs = [...queue.running, ...queue.pending];
    } catch {
      // keep last snapshot
    }
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
}
