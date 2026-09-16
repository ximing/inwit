import { Service } from '@rabjs/react';
import {
  excerptCardInputFromAnnotation,
  isChatQuestion,
  type Annotation,
  type AnnotationGeometry,
  type Card,
  type CreateAnnotationInput,
  type CreateCardInput,
  type Document,
  type DocumentCard,
  type DocumentDetail,
  type DocumentListItem,
  type DocumentSource,
  type DocumentStatus,
  type Job,
  type Topic,
} from '@inwit/dto';
import {
  createAnnotation,
  deleteAnnotation,
  getAnnotationImage,
  listDocumentAnnotations,
  updateAnnotation,
} from '@/api/annotations';
import { createCard, getCardImage } from '@/api/cards';
import { ApiError, errorMessage } from '@/api/client';
import {
  abortImport,
  completeImport,
  createChat,
  createDocument,
  enqueueSelectionCards,
  getDocument,
  initImport,
  listDocuments,
  presignImportParts,
  retryDocument,
  updateDocument,
} from '@/api/documents';
import { getJobQueue } from '@/api/jobs';
import { createTopic, listTopics } from '@/api/topics';
import {
  describeDocumentStage,
  pickDocumentJob,
  type DocPipelineStage,
} from '@/lib/doc-pipeline';
import {
  checkpointPercent,
  findCheckpointForFile,
  loadCheckpoints,
  removeCheckpoint,
  upsertCheckpoint,
  type ImportCheckpoint,
} from '@/lib/multipart-logic';
import {
  checkpointFromInit,
  isAbortError,
  uploadRemainingParts,
} from '@/lib/multipart-upload';
import {
  isPresignedStale,
  livePresignedUrl,
  shouldRetryPresign,
  type PresignedUrlEntry,
} from '@/lib/presign-cache-logic';
import { CARD_RAIL_NARROW_PX } from '@/services/ui-prefs.service';
import { EditorService } from './editor.service';

const DOC_PAGE = 20;
const POLL_MS = 3000;
const TOAST_MS = 3200;
const SELECTION_POLL_MS = 2000;
const SELECTION_POLL_FOR_MS = 9000;
const IMPORT_EXTS = new Set(['pdf', 'docx', 'epub', 'txt', 'md']);
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip',
  txt: 'text/plain',
  md: 'text/markdown',
};

function fileExt(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

function mimeOf(file: File): string {
  const fromFile = file.type.split(';')[0]?.trim() ?? '';
  if (fromFile.length > 0) return fromFile;
  return MIME_BY_EXT[fileExt(file.name)] ?? 'application/octet-stream';
}

function importFailMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 415 || err.code === 'IMPORT_UNSUPPORTED_TYPE') {
      return '不支持这种文件。目前可以导入 PDF、Word、EPUB、TXT 和 Markdown';
    }
    if (err.status === 413) {
      return '文件太大了';
    }
    if (err.code === 'STORAGE_NOT_CONFIGURED') {
      return '文件存储还没配好';
    }
    if (err.code === 'DOCUMENT_NOT_RETRYABLE') {
      return '这篇现在不能重试';
    }
    if (err.code === 'IMPORT_EMPTY') {
      return '这个文件里没有可提取的文字';
    }
    if (err.status === 422 || err.code === 'IMPORT_PARSE_FAILED') {
      return '这个文件解析失败了，可能已加密或损坏';
    }
  }
  return errorMessage(err, '导入失败');
}

function asDocumentCard(card: Card): DocumentCard {
  return {
    ...card,
    questions: [],
    review: { dueAt: new Date().toISOString(), intervalDays: 0 },
  };
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
    contentMd: detail.contentMd,
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

export class DocsService extends Service {
  topics: Topic[] = [];
  documents: DocumentListItem[] = [];
  documentsTotal = 0;
  /** List filter. null = 全部 */
  filterTopicId: string | null = null;
  /** Capture composer topic. Independent of the list filter. */
  captureTopicId: string | null = null;
  draft = '';
  error: string | null = null;
  importError: string | null = null;
  importingName: string | null = null;
  uploadByDoc: Record<string, { percent: number; filename: string }> = {};
  importCheckpoints: ImportCheckpoint[] = [];
  activeJobs: Job[] = [];
  importAbort: AbortController | null = null;
  uploadingDocumentId: string | null = null;
  retryingId: string | null = null;
  cancelingId: string | null = null;
  toast: string | null = null;
  topicMenuOpen = false;
  paneTopicMenuOpen = false;
  newTopicOpen = false;
  newTopicSource: 'capture' | 'filter' | 'pane' = 'capture';
  newTitle = '';
  newGoal = '';
  newTopicError: string | null = null;

  doc: DocumentDetail | null = null;
  docError: string | null = null;
  annotations: Annotation[] = [];
  annotationImageUrls: Record<string, string> = {};
  cardImageUrls: Record<string, PresignedUrlEntry> = {};
  convertingAnnotationId: string | null = null;
  openCardIds: string[] = [];
  activeCardId: string | null = null;
  activeAnnotationId: string | null = null;
  expandedCardIds: string[] = [];
  scrollCardId: string | null = null;
  scrollAnnotationId: string | null = null;
  bodyFocusCardId: string | null = null;
  bodyFocusAnnotationId: string | null = null;
  appliedUrlAnchor: string | null = null;
  docLoadGen = 0;
  paneWidth = 0;
  cardRailOverlayOpen = false;
  composingNew = false;
  selectionDigesting = false;
  selectionPollUntil = 0;
  selectionPollDocId: string | null = null;
  selectionCardCountAtStart = 0;
  selectionPop: {
    kind: 'annotate' | 'card';
    text: string;
    left: number;
    top: number;
    documentId: string;
    pdf?: {
      pageIndex: number;
      geometry: AnnotationGeometry;
      imageKey?: string;
    };
  } | null = null;

  pollTimer: ReturnType<typeof setInterval> | null = null;
  toastTimer: ReturnType<typeof setTimeout> | null = null;
  selectionTickTimer: ReturnType<typeof setTimeout> | null = null;
  selectionWatchdog: ReturnType<typeof setTimeout> | null = null;
  loadGen = 0;

  get captureTopic(): Topic | null {
    if (this.captureTopicId === null) return null;
    return this.topics.find((topic) => topic.id === this.captureTopicId) ?? null;
  }

  get paneTopic(): Topic | null {
    const id = this.doc?.topicId ?? null;
    if (id === null) return null;
    return this.topics.find((topic) => topic.id === id) ?? null;
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

  get actionTopicId(): string | undefined {
    return this.filterTopicId ?? undefined;
  }

  get importing(): boolean {
    return this.importingName !== null;
  }

  jobFor(documentId: string): Job | null {
    return pickDocumentJob(this.activeJobs, documentId);
  }

  checkpointFor(documentId: string): ImportCheckpoint | null {
    return this.importCheckpoints.find((item) => item.documentId === documentId) ?? null;
  }

  stageFor(doc: {
    id: string;
    status: DocumentStatus;
    source: DocumentSource;
  }): DocPipelineStage {
    const job = this.jobFor(doc.id);
    const upload = this.uploadByDoc[doc.id];
    const checkpoint = this.checkpointFor(doc.id);
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
      job: upload ? null : job,
    });
  }

  rememberCheckpoint(checkpoint: ImportCheckpoint): void {
    upsertCheckpoint(checkpoint);
    const rest = this.importCheckpoints.filter((item) => item.documentId !== checkpoint.documentId);
    this.importCheckpoints = [...rest, checkpoint];
  }

  forgetCheckpoint(documentId: string): void {
    removeCheckpoint(documentId);
    this.importCheckpoints = this.importCheckpoints.filter((item) => item.documentId !== documentId);
  }

  setUploadProgress(documentId: string, percent: number, filename: string): void {
    const current = this.uploadByDoc[documentId];
    if (current && current.percent === percent && current.filename === filename) return;
    this.uploadByDoc = { ...this.uploadByDoc, [documentId]: { percent, filename } };
  }

  clearUploadProgress(documentId: string): void {
    if (!(documentId in this.uploadByDoc)) return;
    const next = { ...this.uploadByDoc };
    delete next[documentId];
    this.uploadByDoc = next;
  }

  get activeCard(): DocumentCard | null {
    if (!this.doc || !this.activeCardId) return null;
    return this.doc.cards.find((card) => card.id === this.activeCardId) ?? null;
  }

  get cardRailNarrow(): boolean {
    if (this.paneWidth <= 0) {
      return typeof window !== 'undefined' && window.innerWidth < 1280;
    }
    return this.paneWidth < CARD_RAIL_NARROW_PX;
  }

  beginComposeNew(): void {
    this.composingNew = true;
  }

  endComposeNew(): void {
    this.composingNew = false;
  }

  setPaneWidth(width: number): void {
    const next = Math.round(width);
    if (next === this.paneWidth) return;
    this.paneWidth = next;
  }

  openCardRailOverlay(): void {
    this.cardRailOverlayOpen = true;
  }

  closeCardRailOverlay(): void {
    this.cardRailOverlayOpen = false;
  }

  topicTitleById(id: string | null): string | null {
    if (!id) return null;
    return this.topics.find((topic) => topic.id === id)?.title ?? null;
  }

  setDraft(value: string): void {
    this.draft = value;
  }

  selectCaptureTopic(id: string | null): void {
    this.captureTopicId = id;
    this.topicMenuOpen = false;
  }

  toggleTopicMenu(): void {
    this.topicMenuOpen = !this.topicMenuOpen;
    if (this.topicMenuOpen) this.paneTopicMenuOpen = false;
  }

  closeTopicMenu(): void {
    this.topicMenuOpen = false;
  }

  togglePaneTopicMenu(): void {
    this.paneTopicMenuOpen = !this.paneTopicMenuOpen;
    if (this.paneTopicMenuOpen) this.topicMenuOpen = false;
  }

  closePaneTopicMenu(): void {
    this.paneTopicMenuOpen = false;
  }

  openNewTopic(source: 'capture' | 'filter' | 'pane'): void {
    this.topicMenuOpen = false;
    this.paneTopicMenuOpen = false;
    this.newTopicSource = source;
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

  dismissImportError(): void {
    this.importError = null;
  }

  async boot(): Promise<void> {
    this.error = null;
    this.importCheckpoints = loadCheckpoints();
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
            contentMd: content,
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
    const existing = this.documents.find((doc) => doc.id === created.id);
    if (existing) {
      this.documents = this.documents.map((doc) =>
        doc.id === created.id
          ? {
              ...item,
              cardCount: existing.cardCount,
              topicTitle: item.topicTitle ?? existing.topicTitle,
            }
          : doc,
      );
      this.syncPolling();
      return;
    }
    const matchesFilter =
      this.filterTopicId === null || this.filterTopicId === created.topicId;
    if (matchesFilter) {
      this.documents = [item, ...this.documents];
      this.documentsTotal += 1;
    }
    this.syncPolling();
  }

  async createBlank(): Promise<string | null> {
    this.error = null;
    this.importError = null;
    try {
      const created = await createDocument({
        contentMd: '',
        source: 'editor',
        ...(this.actionTopicId ? { topicId: this.actionTopicId } : {}),
      });
      this.ingestCreated(created);
      return created.id;
    } catch (err) {
      this.showToast(errorMessage(err, '没建出来，再试一次'));
      return null;
    }
  }

  async importFile(file: File): Promise<string | null> {
    if (this.importingName !== null) return null;
    this.importError = null;
    const ext = fileExt(file.name);
    if (ext && !IMPORT_EXTS.has(ext)) {
      this.importError = importFailMessage(
        new ApiError(415, 'IMPORT_UNSUPPORTED_TYPE', '不支持的文件类型'),
      );
      return null;
    }
    if (file.size <= 0) {
      this.importError = '这个文件是空的';
      return null;
    }

    this.importingName = file.name;
    const ac = new AbortController();
    this.importAbort = ac;
    let documentId: string | null = null;

    try {
      let checkpoint = findCheckpointForFile(file.name, file.size);
      let existing: DocumentDetail | null = null;
      if (checkpoint) {
        try {
          existing = await getDocument(checkpoint.documentId);
        } catch (err) {
          if (isAbortError(err)) throw err;
          if (err instanceof ApiError && err.status === 404) {
            this.forgetCheckpoint(checkpoint.documentId);
            checkpoint = null;
          }
        }
      }

      if (!checkpoint) {
        const init = await initImport({
          filename: file.name,
          mime: mimeOf(file),
          size: file.size,
          ...(this.actionTopicId ? { topicId: this.actionTopicId } : {}),
        });
        checkpoint = checkpointFromInit(init, file);
        this.rememberCheckpoint(checkpoint);
      }

      documentId = checkpoint.documentId;
      this.uploadingDocumentId = documentId;
      this.setUploadProgress(documentId, checkpointPercent(checkpoint), file.name);

      if (existing && existing.id === documentId) {
        this.ingestCreated(existing);
      } else {
        try {
          this.ingestCreated(await getDocument(documentId));
        } catch (err) {
          if (isAbortError(err)) throw err;
        }
      }

      const uploadId = checkpoint.uploadId;
      const parts = await uploadRemainingParts({
        file,
        checkpoint,
        listPartUrls: async (partNumbers) => {
          const res = await presignImportParts(documentId!, {
            uploadId,
            partNumbers,
          });
          return res.parts;
        },
        signal: ac.signal,
        onCheckpoint: (next) => {
          checkpoint = next;
          this.rememberCheckpoint(next);
        },
        onProgress: (percent) => {
          if (documentId) this.setUploadProgress(documentId, percent, file.name);
        },
      });

      const created = await completeImport(documentId, { uploadId, parts });
      this.forgetCheckpoint(documentId);
      this.clearUploadProgress(documentId);
      this.ingestCreated(created);
      await this.refreshJobs();
      this.syncPolling();
      return created.id;
    } catch (err) {
      if (isAbortError(err)) return null;
      this.importError = importFailMessage(err);
      return documentId;
    } finally {
      this.importingName = null;
      this.importAbort = null;
      this.uploadingDocumentId = null;
      if (documentId) this.clearUploadProgress(documentId);
    }
  }

  async cancelImport(documentId: string): Promise<void> {
    this.cancelingId = documentId;
    const checkpoint = this.checkpointFor(documentId);
    if (this.uploadingDocumentId === documentId) this.importAbort?.abort();
    try {
      if (checkpoint) await abortImport(documentId, { uploadId: checkpoint.uploadId });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        this.showToast(errorMessage(err, '没取消掉'));
      }
    } finally {
      this.forgetCheckpoint(documentId);
      this.clearUploadProgress(documentId);
      const had = this.documents.some((doc) => doc.id === documentId);
      this.documents = this.documents.filter((doc) => doc.id !== documentId);
      if (had) this.documentsTotal = Math.max(0, this.documentsTotal - 1);
      if (this.doc?.id === documentId) this.closeDoc();
      this.cancelingId = null;
    }
  }

  async retryFailed(documentId: string): Promise<void> {
    this.retryingId = documentId;
    try {
      await retryDocument(documentId);
      await Promise.all([this.refreshOne(documentId), this.refreshJobs()]);
      this.syncPolling();
    } catch (err) {
      this.showToast(importFailMessage(err));
    } finally {
      this.retryingId = null;
    }
  }

  patchListFromDetail(detail: DocumentDetail): void {
    this.documents = this.documents.map((item) =>
      item.id === detail.id ? mergeDetail(item, detail) : item,
    );
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
      if (this.newTopicSource === 'filter') {
        this.filterTopicId = topic.id;
        this.newTopicOpen = false;
        await this.loadDocuments();
        return;
      }
      if (this.newTopicSource === 'pane') {
        this.newTopicOpen = false;
        this.resolve(EditorService).setTopicId(topic.id);
        await this.setDocTopic(topic.id, this.doc?.id ?? this.resolve(EditorService).id);
        return;
      }
      this.captureTopicId = topic.id;
      this.newTopicOpen = false;
    } catch (err) {
      this.newTopicError = errorMessage(err, '创建主题失败');
    }
  }

  async loadDoc(id: string, urlAnchor?: string | null): Promise<void> {
    this.docError = null;
    this.composingNew = false;
    if (this.doc?.id !== id) {
      this.doc = null;
      this.annotations = [];
      this.annotationImageUrls = {};
      this.cardImageUrls = {};
      this.closeHighlight();
      this.appliedUrlAnchor = null;
      this.expandedCardIds = [];
    }
    const gen = ++this.docLoadGen;
    try {
      const [detail, notes] = await Promise.all([
        getDocument(id),
        listDocumentAnnotations(id).catch(() => [] as Annotation[]),
      ]);
      if (gen !== this.docLoadGen) return;
      this.doc = detail;
      this.annotations = notes;
      this.pruneOpenCards();
      this.patchListFromDetail(detail);
      this.syncEditorFromRemote(detail);
      if (detail.status === 'pending' || detail.status === 'failed') await this.refreshJobs();
      this.syncPolling();
      this.applyUrlAnchor(urlAnchor ?? null);
    } catch (err) {
      if (gen !== this.docLoadGen) return;
      this.docError = errorMessage(err, '打不开这份文档');
      this.doc = null;
      this.annotations = [];
    }
  }

  closeDoc(): void {
    this.docLoadGen += 1;
    this.doc = null;
    this.annotations = [];
    this.annotationImageUrls = {};
    this.cardImageUrls = {};
    this.docError = null;
    this.composingNew = false;
    this.closeHighlight();
    this.expandedCardIds = [];
    this.appliedUrlAnchor = null;
    this.cardRailOverlayOpen = false;
    this.closeSelectionPop();
    this.finishSelectionPoll();
    this.syncPolling();
  }

  applyUrlAnchor(cardId: string | null): void {
    if (!cardId || !this.doc) return;
    const key = `${this.doc.id}:${cardId}`;
    if (this.appliedUrlAnchor === key) return;
    if (!this.doc.cards.some((card) => card.id === cardId)) return;
    this.appliedUrlAnchor = key;
    this.openAnchors([cardId]);
  }

  async refreshDoc(): Promise<void> {
    if (!this.doc) return;
    const id = this.doc.id;
    try {
      const [detail, notes] = await Promise.all([
        getDocument(id),
        listDocumentAnnotations(id).catch(() => this.annotations),
      ]);
      if (this.doc?.id !== id) return;
      this.doc = detail;
      this.annotations = notes;
      this.pruneOpenCards();
      this.patchListFromDetail(detail);
      this.syncEditorFromRemote(detail);
      this.syncPolling();
    } catch {
      // keep the last good copy while polling
    }
  }

  openAnchors(ids: string[]): void {
    const unique = [...new Set(ids.filter(Boolean))];
    this.openCardIds = unique;
    this.activeCardId = unique[0] ?? null;
    this.activeAnnotationId = null;
    this.scrollCardId = unique[0] ?? null;
    const extra = unique.filter((id) => !this.expandedCardIds.includes(id));
    if (extra.length > 0) this.expandedCardIds = [...this.expandedCardIds, ...extra];
    this.cardRailOverlayOpen = true;
  }

  openAnnotation(id: string): void {
    if (!id) return;
    this.activeAnnotationId = id;
    this.activeCardId = null;
    this.scrollAnnotationId = id;
    this.cardRailOverlayOpen = true;
  }

  toggleCard(id: string): void {
    if (this.expandedCardIds.includes(id)) {
      this.expandedCardIds = this.expandedCardIds.filter((item) => item !== id);
    } else {
      this.expandedCardIds = [...this.expandedCardIds, id];
    }
    this.activeCardId = id;
    this.activeAnnotationId = null;
    this.bodyFocusCardId = id;
  }

  focusAnnotation(id: string): void {
    this.activeAnnotationId = id;
    this.activeCardId = null;
    this.bodyFocusAnnotationId = id;
  }

  closeHighlight(): void {
    this.openCardIds = [];
    this.activeCardId = null;
    this.activeAnnotationId = null;
    this.scrollCardId = null;
    this.scrollAnnotationId = null;
    this.bodyFocusCardId = null;
    this.bodyFocusAnnotationId = null;
  }

  clearScrollCard(): void {
    this.scrollCardId = null;
  }

  clearScrollAnnotation(): void {
    this.scrollAnnotationId = null;
  }

  clearBodyFocus(): void {
    this.bodyFocusCardId = null;
    this.bodyFocusAnnotationId = null;
  }

  openSelectionPop(input: {
    kind: 'annotate' | 'card';
    text: string;
    left: number;
    top: number;
    documentId: string;
    pdf?: {
      pageIndex: number;
      geometry: AnnotationGeometry;
      imageKey?: string;
    };
  }): void {
    this.selectionPop = input;
  }

  closeSelectionPop(): void {
    this.selectionPop = null;
  }

  async addAnnotation(
    documentId: string,
    quote: string,
    note: string,
    extra?: Pick<CreateAnnotationInput, 'kind' | 'pageIndex' | 'geometry' | 'imageKey'>,
  ): Promise<boolean> {
    const clipped = quote.trim();
    if (!clipped) return false;
    try {
      const created = await createAnnotation({
        documentId,
        quote: clipped,
        note: note.trim(),
        ...(extra?.kind ? { kind: extra.kind } : {}),
        ...(extra?.pageIndex !== undefined ? { pageIndex: extra.pageIndex } : {}),
        ...(extra?.geometry ? { geometry: extra.geometry } : {}),
        ...(extra?.imageKey ? { imageKey: extra.imageKey } : {}),
      });
      if (!this.doc || this.doc.id === documentId) {
        this.annotations = [...this.annotations.filter((item) => item.id !== created.id), created];
      }
      this.openAnnotation(created.id);
      return true;
    } catch (err) {
      this.showToast(errorMessage(err, '没记下这条批注'));
      return false;
    }
  }

  async saveAnnotationNote(id: string, note: string): Promise<boolean> {
    try {
      const updated = await updateAnnotation(id, { note });
      this.annotations = this.annotations.map((item) => (item.id === id ? updated : item));
      return true;
    } catch (err) {
      this.showToast(errorMessage(err, '没改上'));
      return false;
    }
  }

  async removeAnnotation(id: string): Promise<void> {
    try {
      await deleteAnnotation(id);
      this.annotations = this.annotations.filter((item) => item.id !== id);
      if (this.activeAnnotationId === id) this.activeAnnotationId = null;
      if (this.annotationImageUrls[id]) {
        const next = { ...this.annotationImageUrls };
        delete next[id];
        this.annotationImageUrls = next;
      }
    } catch (err) {
      this.showToast(errorMessage(err, '没删掉'));
    }
  }

  async loadAnnotationImage(id: string): Promise<string | null> {
    if (this.annotationImageUrls[id]) return this.annotationImageUrls[id] ?? null;
    try {
      const { url } = await getAnnotationImage(id);
      this.annotationImageUrls = { ...this.annotationImageUrls, [id]: url };
      return url;
    } catch {
      return null;
    }
  }

  cardImageUrl(id: string): string | null {
    return livePresignedUrl(this.cardImageUrls[id]);
  }

  async loadCardImage(id: string, force = false): Promise<string | null> {
    const existing = this.cardImageUrls[id];
    if (!force && existing && !isPresignedStale(existing)) return existing.url;
    try {
      const { url } = await getCardImage(id);
      this.cardImageUrls = { ...this.cardImageUrls, [id]: { url, fetchedAt: Date.now() } };
      return url;
    } catch {
      return null;
    }
  }

  retryCardImage(id: string): void {
    if (!shouldRetryPresign(this.cardImageUrls[id])) return;
    void this.loadCardImage(id, true);
  }

  async addManualCard(input: CreateCardInput): Promise<boolean> {
    const concept = input.concept.trim();
    const example = input.example.trim();
    if (!concept) return false;
    try {
      const card = await createCard({
        documentId: input.documentId,
        concept,
        example,
        ...(input.anchorText?.trim() ? { anchorText: input.anchorText.trim() } : {}),
        ...(input.anchorBlock?.trim() ? { anchorBlock: input.anchorBlock.trim() } : {}),
        ...(input.imageKey ? { imageKey: input.imageKey } : {}),
      });
      if (this.doc?.id === input.documentId) {
        const have = this.doc.cards.some((item) => item.id === card.id);
        this.doc = {
          ...this.doc,
          cards: have ? this.doc.cards : [...this.doc.cards, asDocumentCard(card)],
        };
        this.patchListFromDetail(this.doc);
      }
      this.showToast('已加入复习队列');
      this.openAnchors([card.id]);
      void this.refreshOne(input.documentId);
      return true;
    } catch (err) {
      this.showToast(errorMessage(err, '没写成卡片'));
      return false;
    }
  }

  async cardFromExcerpt(annotationId: string): Promise<boolean> {
    if (this.convertingAnnotationId) return false;
    const item = this.annotations.find((note) => note.id === annotationId);
    if (!item) return false;
    const input = excerptCardInputFromAnnotation(item);
    if (!input) {
      this.showToast('这条批注没有截图');
      return false;
    }
    this.convertingAnnotationId = annotationId;
    try {
      return await this.addManualCard(input);
    } finally {
      this.convertingAnnotationId = null;
    }
  }

  async queueSelectionCards(documentId: string, text: string): Promise<boolean> {
    const clipped = text.trim();
    if (!clipped) return false;
    this.selectionDigesting = true;
    this.selectionPollDocId = documentId;
    this.selectionCardCountAtStart =
      this.doc?.id === documentId ? this.doc.cards.length : 0;
    this.selectionPollUntil = Date.now() + SELECTION_POLL_FOR_MS;
    try {
      await enqueueSelectionCards(documentId, { text: clipped });
      this.startSelectionPoll(documentId);
      return true;
    } catch (err) {
      this.finishSelectionPoll();
      this.showToast(errorMessage(err, '没排上队'));
      return false;
    }
  }

  startSelectionPoll(documentId: string): void {
    this.stopSelectionTick();
    const startCount = this.selectionCardCountAtStart;
    const deadline = this.selectionPollUntil;
    const tick = async () => {
      this.selectionTickTimer = null;
      if (!this.selectionDigesting || this.selectionPollDocId !== documentId) return;
      await this.refreshOne(documentId);
      const grown =
        this.doc?.id === documentId && this.doc.cards.length > startCount;
      const timedOut = Date.now() >= this.selectionPollUntil;
      if (grown || timedOut) {
        this.finishSelectionPoll();
        return;
      }
      this.selectionTickTimer = setTimeout(() => {
        void tick();
      }, SELECTION_POLL_MS);
    };
    this.selectionTickTimer = setTimeout(() => {
      void tick();
    }, SELECTION_POLL_MS);
    this.selectionWatchdog = setTimeout(() => {
      this.selectionWatchdog = null;
      if (this.selectionPollUntil === deadline) this.finishSelectionPoll();
    }, SELECTION_POLL_FOR_MS + 400);
  }

  stopSelectionTick(): void {
    if (this.selectionTickTimer !== null) {
      clearTimeout(this.selectionTickTimer);
      this.selectionTickTimer = null;
    }
    if (this.selectionWatchdog !== null) {
      clearTimeout(this.selectionWatchdog);
      this.selectionWatchdog = null;
    }
  }

  finishSelectionPoll(): void {
    this.stopSelectionTick();
    this.selectionDigesting = false;
    this.selectionPollUntil = 0;
    this.selectionPollDocId = null;
  }

  async setDocTopic(topicId: string | null, documentId?: string | null): Promise<void> {
    const id = documentId ?? this.doc?.id;
    if (!id) {
      this.paneTopicMenuOpen = false;
      return;
    }
    this.paneTopicMenuOpen = false;
    this.error = null;
    try {
      const updated = await updateDocument(id, { topicId });
      const topicTitle = this.topicTitleById(updated.topicId);
      if (this.doc?.id === id) {
        this.doc = {
          ...this.doc,
          topicId: updated.topicId,
          topicTitle,
          updatedAt: updated.updatedAt,
        };
        this.patchListFromDetail(this.doc);
      } else {
        this.documents = this.documents.map((item) =>
          item.id === id
            ? { ...item, topicId: updated.topicId, topicTitle, updatedAt: updated.updatedAt }
            : item,
        );
      }
    } catch (err) {
      this.error = errorMessage(err, '没换上主题');
    }
  }

  private syncEditorFromRemote(doc: { id: string; title: string | null }): void {
    this.resolve(EditorService).applyRemoteMeta(doc);
  }

  noteEditorSaved(id: string, title: string | null, contentMd: string): void {
    this.documents = this.documents.map((item) =>
      item.id === id ? { ...item, title, contentMd, updatedAt: new Date().toISOString() } : item,
    );
    if (this.doc?.id === id) {
      this.doc = { ...this.doc, title, contentMd, updatedAt: new Date().toISOString() };
    }
  }

  stopPolling(): void {
    if (this.pollTimer === null) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  override destroy(): void {
    this.importAbort?.abort();
    this.stopPolling();
    this.finishSelectionPoll();
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    super.destroy();
  }

  syncPolling(): void {
    const listPending = this.documents.some((item) => item.status === 'pending');
    const docPending = this.doc?.status === 'pending';
    const uploading = Object.keys(this.uploadByDoc).length > 0;
    if (listPending || docPending || uploading) this.startPolling();
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
    const extra =
      this.doc?.status === 'pending' && !pending.some((item) => item.id === this.doc?.id)
        ? [this.doc.id]
        : [];
    const ids = [...pending.map((item) => item.id), ...extra];
    const tasks: Promise<void>[] = [this.refreshJobs()];
    if (ids.length > 0) {
      tasks.push(...ids.map((id) => this.refreshOne(id)));
    }
    await Promise.all(tasks);
    this.syncPolling();
  }

  async refreshJobs(): Promise<void> {
    try {
      const queue = await getJobQueue();
      this.activeJobs = [...queue.running, ...queue.pending];
    } catch {
      // keep the last good copy while polling
    }
  }

  async refreshOne(id: string): Promise<void> {
    try {
      const [detail, notes] = await Promise.all([
        getDocument(id),
        this.doc?.id === id
          ? listDocumentAnnotations(id).catch(() => this.annotations)
          : Promise.resolve(null),
      ]);
      this.documents = this.documents.map((item) =>
        item.id === id ? mergeDetail(item, detail) : item,
      );
      if (this.doc?.id === id) {
        this.doc = detail;
        if (notes) this.annotations = notes;
        this.pruneOpenCards();
      }
      this.syncEditorFromRemote(detail);
    } catch {
      // Transient poll errors should not wipe the list.
    }
  }

  private pruneOpenCards(): void {
    if (!this.doc) {
      this.closeHighlight();
      return;
    }
    const have = new Set(this.doc.cards.map((card) => card.id));
    this.openCardIds = this.openCardIds.filter((id) => have.has(id));
    this.expandedCardIds = this.expandedCardIds.filter((id) => have.has(id));
    if (this.activeCardId && !have.has(this.activeCardId)) {
      this.activeCardId = this.openCardIds[0] ?? null;
    }
    const notes = new Set(this.annotations.map((item) => item.id));
    if (this.activeAnnotationId && !notes.has(this.activeAnnotationId)) {
      this.activeAnnotationId = null;
    }
  }
}
