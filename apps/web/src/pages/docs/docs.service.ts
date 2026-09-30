import type { DocumentChange } from '@/components/document-actions.service';
import { Service } from '@rabjs/react';
import type { CaptureEditorHandle } from '@/components/capture/capture-editor';
import {
  EMPTY_PM_DOC,
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
  type PmDocJson,
  type SyncChange,
  type Topic,
  type UpdateCardInput,
} from '@inwit/dto';
import { listDocumentAnnotations } from '@/api/annotations';
import {
  acceptCard,
  archiveCard,
  createCard,
  rejectCard,
  resumeCard,
  suspendCard,
  updateCard,
} from '@/api/cards';
import { ApiError, errorMessage } from '@/api/client';
import {
  acceptProposedCards,
  createDocument,
  enqueueSelectionCards,
  getDocument,
  listDocuments,
  retryDocument,
  updateDocument,
} from '@/api/documents';
import {
  asListItem,
  captureIsChat,
  hasPendingDoc,
  mergeDetail,
  sendCapture,
  showToast,
  startPolling,
  stopPolling,
  stopToast,
} from '@/lib/doc-list';
import { getJob, getJobQueue } from '@/api/jobs';
import { createTopic, listTopics } from '@/api/topics';
import {
  describeDocumentStage,
  pickDocumentJob,
  type DocPipelineStage,
} from '@/lib/doc-pipeline';
import {
  checkpointPercent,
  type ImportCheckpoint,
} from '@/lib/multipart-logic';
import { type PresignedUrlEntry } from '@/lib/presign-cache-logic';
import { isLostTextEntity, type DocEditorHost } from '@/lib/entity-marks';
import { asPmJson, isBlankPmDoc, jsonEqual, textToPmDoc } from '@/lib/pm-doc';
import {
  classifyRemoteDetail,
  coalesceChanges,
  planDroppedDocumentReplay,
  planReloads,
  stripEchoes,
  type EchoStamp,
  type SyncView,
} from '@/lib/sync-plan';
import { CARD_RAIL_NARROW_PX } from '@/services/ui-prefs.service';
import { SyncService, type SyncEvent } from '@/services/sync.service';
import { DocsAnnotationsService } from './docs-annotations.service';
import { DocsImportService, importFailMessage } from './docs-import.service';
import { EditorService } from './editor.service';

const DOC_PAGE = 20;
const LIST_LIMIT_MAX = 100;
const SELECTION_POLL_MS = 2000;
const SELECTION_POLL_FOR_MS = 9000;

function asDocumentCard(card: Card): DocumentCard {
  return {
    ...card,
    questions: [],
    review: { dueAt: new Date().toISOString(), intervalDays: 0, suspendedAt: null },
  };
}

function clipReason(reason: string): string {
  const chars = [...reason.replaceAll('\0', '')];
  return chars.length <= 500 ? chars.join('') : chars.slice(0, 500).join('');
}

/** One getDocument. Generation and doc load are captured when the request starts. */
type DetailRead = {
  id: string;
  gen: number;
  floor: number | null;
  docLoadGen: number;
  openAtStart: boolean;
  /** This id was the open document, so a later close must not treat the old generation as current. */
  protectedAtStart: boolean;
  changeAt: string | null;
};

function decisionError(err: unknown, action: 'accept' | 'reject'): string {
  if (err instanceof ApiError) {
    if (err.code === 'CARD_INDEX_FAILED') {
      return action === 'accept'
        ? '这张卡暂时没能进入检索，请再试'
        : '这张卡暂时没能移出检索，请再试';
    }
    if (err.code === 'DIGEST_IN_PROGRESS') return '消化还在进行，暂时不能确认';
    if (err.code === 'CARD_ALREADY_REVIEWED') return '请用回收站，而不是「有问题」';
  }
  return errorMessage(err, '操作没成功');
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
  activeJobs: Job[] = [];
  retryingId: string | null = null;
  toast: string | null = null;
  topicMenuOpen = false;
  paneTopicMenuOpen = false;
  /** 列表头：主题筛选下拉 / 新建菜单 的开合 */
  listFilterMenuOpen = false;
  listPlusOpen = false;
  newTopicOpen = false;
  newTopicSource: 'capture' | 'filter' | 'pane' = 'capture';
  newTitle = '';
  newGoal = '';
  newTopicError: string | null = null;

  doc: DocumentDetail | null = null;
  docError: string | null = null;
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
  selectionJobId: string | null = null;
  selectionPop: {
    kind: 'annotate' | 'card';
    text: string;
    left: number;
    top: number;
    documentId: string;
    blockIndex?: number;
    from?: number;
    to?: number;
    pdf?: {
      pageIndex: number;
      geometry: AnnotationGeometry;
      imageKey?: string;
    };
  } | null = null;
  editorHost: DocEditorHost | null = null;

  pollTimer: ReturnType<typeof setInterval> | null = null;
  toastTimer: ReturnType<typeof setTimeout> | null = null;
  selectionTickTimer: ReturnType<typeof setTimeout> | null = null;
  selectionWatchdog: ReturnType<typeof setTimeout> | null = null;
  private selectionTickInflight = false;
  loadGen = 0;

  private sync: SyncService | null = null;
  private unsubscribeSync: (() => void) | null = null;
  private syncChain: Promise<void> = Promise.resolve();
  private echoes: EchoStamp[] = [];
  private saveFloors = new Map<string, number>();
  private conflictNotifiedAt: string | null = null;
  private goneNotifiedId: string | null = null;
  private inflightReads: DetailRead[] = [];
  private replayQueue: { id: string; changeAt: string | null }[] = [];
  private recoveryInflight = false;
  /** Last give-up key per document. Another id must not clear it. A newer write changes the key. */
  private replayStamp = new Map<string, string>();
  /** Topic PUT still in flight. Dropped GETs wait until its floor is stored. */
  private topicWrites = 0;

  constructor() {
    super();
    // Unit tests call `new DocsService()` with no container.
    try {
      this.sync = this.resolve(SyncService);
      this.unsubscribeSync = this.sync.subscribe((event) => this.onSyncEvent(event));
    } catch {
      this.sync = null;
    }
    try {
      const editor = this.resolve(EditorService);
      editor.onLocalWriteStart = () => this.bumpCardWriteGen();
      editor.onLocalWriteEnd = () => this.kickReplay();
    } catch {
      // Same unattached instance.
    }
  }

  get importService(): DocsImportService {
    return this.resolve(DocsImportService);
  }

  get annotationService(): DocsAnnotationsService {
    return this.resolve(DocsAnnotationsService);
  }

  get importError(): string | null {
    return this.importService.importError;
  }
  set importError(value: string | null) {
    this.importService.importError = value;
  }

  get importingName(): string | null {
    return this.importService.importingName;
  }
  set importingName(value: string | null) {
    this.importService.importingName = value;
  }

  get uploadByDoc(): Record<string, { percent: number; filename: string }> {
    return this.importService.uploadByDoc;
  }
  set uploadByDoc(value: Record<string, { percent: number; filename: string }>) {
    this.importService.uploadByDoc = value;
  }

  get importCheckpoints(): ImportCheckpoint[] {
    return this.importService.importCheckpoints;
  }
  set importCheckpoints(value: ImportCheckpoint[]) {
    this.importService.importCheckpoints = value;
  }

  get importAbort(): AbortController | null {
    return this.importService.importAbort;
  }
  set importAbort(value: AbortController | null) {
    this.importService.importAbort = value;
  }

  get uploadingDocumentId(): string | null {
    return this.importService.uploadingDocumentId;
  }
  set uploadingDocumentId(value: string | null) {
    this.importService.uploadingDocumentId = value;
  }

  get cancelingId(): string | null {
    return this.importService.cancelingId;
  }
  set cancelingId(value: string | null) {
    this.importService.cancelingId = value;
  }

  get annotations(): Annotation[] {
    return this.annotationService.annotations;
  }
  set annotations(value: Annotation[]) {
    this.annotationService.annotations = value;
  }

  get annotationImageUrls(): Record<string, PresignedUrlEntry> {
    return this.annotationService.annotationImageUrls;
  }
  set annotationImageUrls(value: Record<string, PresignedUrlEntry>) {
    this.annotationService.annotationImageUrls = value;
  }

  get cardImageUrls(): Record<string, PresignedUrlEntry> {
    return this.annotationService.cardImageUrls;
  }
  set cardImageUrls(value: Record<string, PresignedUrlEntry>) {
    this.annotationService.cardImageUrls = value;
  }

  get convertingAnnotationId(): string | null {
    return this.annotationService.convertingAnnotationId;
  }
  set convertingAnnotationId(value: string | null) {
    this.annotationService.convertingAnnotationId = value;
  }

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
    return this.importService.checkpointFor(documentId);
  }

  stageFor(doc: {
    id: string;
    status: DocumentStatus;
    source: DocumentSource;
    contentJson?: unknown;
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
      hasContent: !isBlankPmDoc(doc.contentJson),
      job: upload ? null : job,
    });
  }

  rememberCheckpoint(checkpoint: ImportCheckpoint): void {
    this.importService.rememberCheckpoint(checkpoint);
  }

  forgetCheckpoint(documentId: string): void {
    this.importService.forgetCheckpoint(documentId);
  }

  setUploadProgress(documentId: string, percent: number, filename: string): void {
    this.importService.setUploadProgress(documentId, percent, filename);
  }

  clearUploadProgress(documentId: string): void {
    this.importService.clearUploadProgress(documentId);
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

  captureHandle: CaptureEditorHandle | null = null;

  bindCapture(handle: CaptureEditorHandle | null): void {
    this.captureHandle = handle;
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

  toggleListFilterMenu(): void {
    this.listFilterMenuOpen = !this.listFilterMenuOpen;
    if (this.listFilterMenuOpen) this.listPlusOpen = false;
  }

  closeListFilterMenu(): void {
    this.listFilterMenuOpen = false;
  }

  toggleListPlus(): void {
    this.listPlusOpen = !this.listPlusOpen;
    if (this.listPlusOpen) this.listFilterMenuOpen = false;
  }

  closeListPlus(): void {
    this.listPlusOpen = false;
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
    showToast(this, message);
  }

  dismissImportError(): void {
    this.importService.dismissImportError();
  }

  async prepareDocumentChange(id: string): Promise<void> {
    const editor = this.resolve(EditorService);
    if (editor.id !== id) return;
    await editor.save();
    if (editor.saveState === 'error') throw new Error(editor.error ?? '请先保存文档');
  }

  applyDocumentChange(change: DocumentChange): void {
    const { id, document: updated, topicTitle } = change;
    const remove = !updated || (this.filterTopicId !== null && updated.topicId !== this.filterTopicId);
    const had = this.documents.some((item) => item.id === id);
    this.documents = remove
      ? this.documents.filter((item) => item.id !== id)
      : this.documents.map((item) => item.id === id ? { ...item, ...updated, topicTitle } : item);
    if (remove && had) this.documentsTotal = Math.max(0, this.documentsTotal - 1);
    if (!updated) {
      if (this.doc?.id === id) this.closeDoc();
    } else {
      if (this.doc?.id === id) {
        const topicMoved = this.doc.topicId !== updated.topicId;
        this.doc = {
          ...this.doc,
          ...updated,
          topicTitle,
          cards: topicMoved
            ? this.doc.cards.map((card) => ({ ...card, topicId: updated.topicId, mapNodeId: null }))
            : this.doc.cards,
        };
      }
      this.syncEditorFromRemote(updated);
      const editor = this.resolve(EditorService);
      if (editor.id === id) editor.topicId = updated.topicId;
    }
    this.syncPolling();
  }

  async boot(): Promise<void> {
    this.error = null;
    this.importService.hydrateCheckpoints();
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
    const content = (this.captureHandle?.getText() ?? this.draft).trim();
    if (content.length === 0) return null;
    this.error = null;
    const useChat = captureIsChat(content, mode);
    try {
      const { created } = await sendCapture({
        text: content,
        pmJson: this.captureHandle?.getJSON(),
        topicId: this.captureTopicId,
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
      topicTitle: this.topicTitleById(created.topicId) ?? this.captureTopic?.title ?? null,
    });
    const existing = this.documents.find((doc) => doc.id === created.id);
    if (existing) {
      this.documents = this.documents.map((doc) =>
        doc.id === created.id
          ? {
              ...item,
              cardCount: existing.cardCount,
              proposedCount: existing.proposedCount,
              topicTitle: item.topicTitle ?? existing.topicTitle,
            }
          : doc,
      );
      this.echoDocumentRow(created.id, created.updatedAt);
      this.syncPolling();
      return;
    }
    const matchesFilter =
      this.filterTopicId === null || this.filterTopicId === created.topicId;
    if (matchesFilter) {
      this.documents = [item, ...this.documents];
      this.documentsTotal += 1;
      this.echoDocumentRow(created.id, created.updatedAt);
    }
    this.syncPolling();
  }

  async createBlank(): Promise<string | null> {
    this.error = null;
    this.importError = null;
    try {
      const created = await createDocument({
        contentJson: EMPTY_PM_DOC,
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
    return this.importService.importFile(file);
  }

  async cancelImport(documentId: string): Promise<void> {
    return this.importService.cancelImport(documentId);
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

  async loadDoc(id: string, urlAnchor?: string | null, urlAnnotation?: string | null): Promise<void> {
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
    if (this.goneNotifiedId === id) this.goneNotifiedId = null;
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
      this.applyUrlAnnotation(urlAnnotation ?? null);
    } catch (err) {
      if (gen !== this.docLoadGen) return;
      this.docError = errorMessage(err, '打不开这份文档');
      this.doc = null;
      this.annotations = [];
    }
  }

  closeDoc(): void {
    this.docLoadGen += 1;
    this.editorHost = null;
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

  applyUrlAnnotation(annotationId: string | null): void {
    if (!annotationId || !this.doc) return;
    const key = `${this.doc.id}:ann:${annotationId}`;
    if (this.appliedUrlAnchor === key) return;
    if (!this.annotations.some((item) => item.id === annotationId)) return;
    this.appliedUrlAnchor = key;
    this.openAnnotation(annotationId);
  }

  async refreshDoc(): Promise<void> {
    if (!this.doc) return;
    await this.refreshOne(this.doc.id);
  }

  openAnchors(ids: string[]): void {
    const unique = [...new Set(ids.filter(Boolean))];
    this.openCardIds = unique;
    this.activeCardId = unique[0] ?? null;
    this.activeAnnotationId = null;
    this.scrollCardId = unique[0] ?? null;
    this.expandedCardIds = unique;
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
    // 手风琴：同时只展开一张卡；再点一次当前卡 = 收起并取消选中
    const wasOpen = this.expandedCardIds.includes(id);
    this.expandedCardIds = wasOpen ? [] : [id];
    if (wasOpen) {
      if (this.activeCardId === id) {
        this.activeCardId = null;
        this.bodyFocusCardId = null;
      }
      return;
    }
    this.activeCardId = id;
    this.activeAnnotationId = null;
    const card = this.doc?.cards.find((item) => item.id === id);
    if (card && this.isCardAnchorLost(card)) {
      this.bodyFocusCardId = null;
      return;
    }
    this.bodyFocusCardId = id;
  }

  focusAnnotation(id: string): void {
    // 再点一次当前批注 = 取消选中
    if (this.activeAnnotationId === id) {
      this.activeAnnotationId = null;
      this.bodyFocusAnnotationId = null;
      return;
    }
    const item = this.annotations.find((note) => note.id === id);
    if (item && this.isAnnotationAnchorLost(item)) {
      this.showToast('原文已删除');
      return;
    }
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

  attachEditorHost(host: DocEditorHost | null): void {
    this.editorHost = host;
  }

  contentJsonForAnchors(): PmDocJson {
    return this.editorHost?.getJSON() ?? asPmJson(this.doc?.contentJson);
  }

  isCardAnchorLost(card: DocumentCard): boolean {
    return isLostTextEntity(this.contentJsonForAnchors(), {
      id: card.id,
      kind: 'card',
      quote: card.anchorText,
      blockIndex: card.anchorBlockIndex,
      hasImage: card.hasImage,
    });
  }

  isAnnotationAnchorLost(item: Annotation): boolean {
    return isLostTextEntity(this.contentJsonForAnchors(), {
      id: item.id,
      kind: 'annotation',
      annotationKind: item.kind,
      quote: item.quote,
      blockIndex: item.anchorBlockIndex,
      hasImage: Boolean(item.imageKey),
    });
  }

  openSelectionPop(input: {
    kind: 'annotate' | 'card';
    text: string;
    left: number;
    top: number;
    documentId: string;
    blockIndex?: number;
    from?: number;
    to?: number;
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
    extra?: Pick<
      CreateAnnotationInput,
      'kind' | 'pageIndex' | 'geometry' | 'imageKey' | 'anchorBlockIndex'
    > & { from?: number; to?: number },
  ): Promise<boolean> {
    return this.annotationService.addAnnotation(documentId, quote, note, extra);
  }

  async saveAnnotationNote(id: string, note: string): Promise<boolean> {
    return this.annotationService.saveAnnotationNote(id, note);
  }

  async removeAnnotation(id: string): Promise<void> {
    return this.annotationService.removeAnnotation(id);
  }

  annotationImageUrl(id: string): string | null {
    return this.annotationService.annotationImageUrl(id);
  }

  async loadAnnotationImage(id: string, force = false): Promise<string | null> {
    return this.annotationService.loadAnnotationImage(id, force);
  }

  retryAnnotationImage(id: string): void {
    this.annotationService.retryAnnotationImage(id);
  }

  cardImageUrl(id: string): string | null {
    return this.annotationService.cardImageUrl(id);
  }

  async loadCardImage(id: string, force = false): Promise<string | null> {
    return this.annotationService.loadCardImage(id, force);
  }

  retryCardImage(id: string): void {
    this.annotationService.retryCardImage(id);
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
        ...(input.anchorBlockIndex != null ? { anchorBlockIndex: input.anchorBlockIndex } : {}),
        ...(input.imageKey ? { imageKey: input.imageKey } : {}),
      });
      if (this.doc?.id === input.documentId) {
        const have = this.doc.cards.some((item) => item.id === card.id);
        this.cardWriteGen += 1;
        this.doc = {
          ...this.doc,
          cards: have ? this.doc.cards : [...this.doc.cards, asDocumentCard(card)],
        };
        this.patchListFromDetail(this.doc);
      }
      this.echoDocumentRow(input.documentId, card.updatedAt);
      this.showToast('已加入复习队列');
      this.editorHost?.ensureEntityMarks(this.doc?.cards ?? [], this.annotations);
      this.openAnchors([card.id]);
      void this.refreshOne(input.documentId);
      return true;
    } catch (err) {
      this.showToast(errorMessage(err, '没写成卡片'));
      return false;
    }
  }

  async cardFromExcerpt(annotationId: string): Promise<boolean> {
    return this.annotationService.cardFromExcerpt(annotationId);
  }

  editingCardId: string | null = null;
  decidingCardId: string | null = null;
  acceptingProposed = false;
  /** Editor saves, card edits, and annotation replacements share this generation. */
  private cardWriteGen = 0;

  bumpCardWriteGen(): void {
    this.cardWriteGen += 1;
  }

  /** One echo per applied row. A duplicate stamp must not swallow a second upsert. */
  echoDocumentRow(documentId: string | null, updatedAt: string | null | undefined): void {
    if (!documentId || !updatedAt) return;
    const atMs = Date.parse(updatedAt);
    if (Number.isNaN(atMs)) return;
    const dup = this.echoes.some(
      (echo) => echo.scope === 'document' && echo.resourceId === documentId && echo.atMs === atMs,
    );
    if (dup) return;
    this.echoes.push({ scope: 'document', resourceId: documentId, atMs });
    if (this.echoes.length > 200) this.echoes.splice(0, this.echoes.length - 200);
  }

  get cardDecisionBusy(): boolean {
    return this.decidingCardId !== null || this.acceptingProposed;
  }

  openCardEdit(id: string): void {
    this.editingCardId = id;
  }

  closeCardEdit(): void {
    this.editingCardId = null;
  }

  get editingCard(): DocumentCard | null {
    if (!this.doc || !this.editingCardId) return null;
    return this.doc.cards.find((card) => card.id === this.editingCardId) ?? null;
  }

  private replaceDocCard(updated: DocumentCard): void {
    if (!this.doc) return;
    this.cardWriteGen += 1;
    this.doc = {
      ...this.doc,
      cards: this.doc.cards.map((card) => (card.id === updated.id ? updated : card)),
    };
    this.patchListFromDetail(this.doc);
  }

  async saveCardEdit(id: string, input: UpdateCardInput): Promise<boolean> {
    try {
      const detail = await updateCard(id, input);
      const { documentTitle: _documentTitle, ...card } = detail;
      this.replaceDocCard(card);
      this.echoDocumentRow(card.documentId, card.updatedAt);
      this.showToast('已保存');
      return true;
    } catch (err) {
      this.showToast(errorMessage(err, '没改上'));
      return false;
    }
  }

  /** Soft delete: the card moves to 回收站 and can be restored from settings. */
  async archiveDocCard(id: string): Promise<void> {
    if (this.acceptingProposed) return;
    try {
      await archiveCard(id);
      if (this.doc) {
        this.cardWriteGen += 1;
        this.doc = { ...this.doc, cards: this.doc.cards.filter((card) => card.id !== id) };
        this.patchListFromDetail(this.doc);
      }
      this.expandedCardIds = this.expandedCardIds.filter((cardId) => cardId !== id);
      if (this.activeCardId === id) this.activeCardId = null;
      if (this.editingCardId === id) this.editingCardId = null;
      this.editorHost?.ensureEntityMarks(this.doc?.cards ?? [], this.annotations);
      this.showToast('已移入回收站，可在设置里恢复');
    } catch (err) {
      this.showToast(errorMessage(err, '没删掉'));
    }
  }

  async acceptDocCard(id: string): Promise<void> {
    if (this.cardDecisionBusy || this.doc?.status !== 'digested') return;
    this.decidingCardId = id;
    try {
      const detail = await acceptCard(id);
      const { documentTitle: _documentTitle, ...card } = detail;
      this.replaceDocCard(card);
      this.echoDocumentRow(card.documentId, card.updatedAt);
      this.showToast('已确认，会安排复习');
    } catch (err) {
      this.showToast(decisionError(err, 'accept'));
    } finally {
      if (this.decidingCardId === id) this.decidingCardId = null;
    }
  }

  async rejectDocCard(id: string, reason: string): Promise<void> {
    if (this.cardDecisionBusy || this.doc?.status !== 'digested') return;
    const trimmed = clipReason(reason.trim());
    this.decidingCardId = id;
    try {
      const detail = await rejectCard(id, trimmed ? { reason: trimmed } : {});
      const { documentTitle: _documentTitle, ...card } = detail;
      this.dropDocCard(id);
      this.echoDocumentRow(card.documentId, card.updatedAt);
      this.showToast('不会进入复习');
    } catch (err) {
      this.showToast(decisionError(err, 'reject'));
    } finally {
      if (this.decidingCardId === id) this.decidingCardId = null;
    }
  }

  async acceptAllProposed(): Promise<void> {
    if (this.cardDecisionBusy) {
      this.showToast('还有卡片正在确认，请稍后再试');
      return;
    }
    if (!this.doc || this.doc.status !== 'digested') return;
    if (!this.doc.cards.some((card) => card.acceptance === 'proposed')) return;
    const documentId = this.doc.id;
    this.acceptingProposed = true;
    try {
      const result = await acceptProposedCards(documentId);
      const acceptedIds = new Set(result.acceptedIds);
      if (this.doc?.id === documentId) {
        this.cardWriteGen += 1;
        this.doc = {
          ...this.doc,
          cards: this.doc.cards.map((card) =>
            acceptedIds.has(card.id)
              ? {
                  ...card,
                  acceptance: 'accepted',
                  review: card.review ?? {
                    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
                    intervalDays: 1,
                    suspendedAt: null,
                  },
                }
              : card,
          ),
        };
        this.patchListFromDetail(this.doc);
      }
      await this.refreshOne(documentId);
      const accepted = result.acceptedIds.length;
      const failed = result.failedIds.length;
      if (failed > 0 && accepted > 0) {
        this.showToast(`已确认 ${accepted} 张。${failed} 张未能进入检索，可再试`);
      } else if (failed > 0) {
        this.showToast(`${failed} 张未能进入检索，可再试`);
      } else if (accepted > 0) {
        this.showToast(`已确认 ${accepted} 张`);
      } else {
        this.showToast('没有待确认的卡片');
      }
    } catch (err) {
      this.showToast(decisionError(err, 'accept'));
    } finally {
      this.acceptingProposed = false;
    }
  }

  private dropDocCard(id: string): void {
    if (this.doc) {
      this.cardWriteGen += 1;
      this.doc = { ...this.doc, cards: this.doc.cards.filter((card) => card.id !== id) };
      this.patchListFromDetail(this.doc);
    }
    this.openCardIds = this.openCardIds.filter((cardId) => cardId !== id);
    this.expandedCardIds = this.expandedCardIds.filter((cardId) => cardId !== id);
    if (this.activeCardId === id) this.activeCardId = null;
    if (this.editingCardId === id) this.editingCardId = null;
    this.editorHost?.ensureEntityMarks(this.doc?.cards ?? [], this.annotations);
  }

  /** 已熟悉 ↔ 恢复复习。 */
  async toggleCardSuspended(card: DocumentCard): Promise<void> {
    if (this.acceptingProposed) return;
    const suspended = card.review?.suspendedAt != null;
    try {
      const state = suspended ? await resumeCard(card.id) : await suspendCard(card.id);
      this.replaceDocCard({
        ...card,
        review: {
          dueAt: state.dueAt,
          intervalDays: state.intervalDays,
          suspendedAt: state.suspendedAt,
        },
      });
      this.echoDocumentRow(card.documentId, state.updatedAt);
      this.showToast(suspended ? '已恢复复习' : '已标记为熟悉，不再安排复习');
    } catch (err) {
      this.showToast(errorMessage(err, '操作没成功'));
    }
  }

  async queueSelectionCards(documentId: string, text: string, blockIndex: number): Promise<boolean> {
    const clipped = text.trim();
    if (!clipped || !Number.isFinite(blockIndex) || blockIndex < 1) return false;
    this.selectionDigesting = true;
    this.selectionPollDocId = documentId;
    this.selectionCardCountAtStart =
      this.doc?.id === documentId ? this.doc.cards.length : 0;
    this.selectionPollUntil = Date.now() + SELECTION_POLL_FOR_MS;
    try {
      const job = await enqueueSelectionCards(documentId, { text: clipped, blockIndex });
      this.selectionJobId = job.id;
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
    const deadline = this.selectionPollUntil;
    this.selectionWatchdog = setTimeout(() => {
      this.selectionWatchdog = null;
      if (this.selectionPollUntil === deadline) this.finishSelectionPoll();
    }, SELECTION_POLL_FOR_MS + 400);
    // Job events and document reloads finish the flag. The 2s loop is only the fallback.
    this.armSelectionLoop(documentId);
  }

  private armSelectionLoop(documentId: string): void {
    if (this.syncActive()) return;
    if (this.selectionTickTimer !== null || this.selectionTickInflight) return;
    if (!this.selectionDigesting || this.selectionPollDocId !== documentId) return;
    const startCount = this.selectionCardCountAtStart;
    const tick = async () => {
      this.selectionTickTimer = null;
      this.selectionTickInflight = true;
      try {
        if (!this.selectionDigesting || this.selectionPollDocId !== documentId) return;
        await this.refreshOne(documentId);
        if (!this.selectionDigesting || this.selectionPollDocId !== documentId) return;
        if (this.syncActive()) return;
        const grown =
          this.doc?.id === documentId && this.doc.cards.length > startCount;
        const timedOut = Date.now() >= this.selectionPollUntil;
        if (grown || timedOut) this.finishSelectionPoll();
      } finally {
        this.selectionTickInflight = false;
      }
      if (!this.selectionDigesting || this.selectionPollDocId !== documentId) return;
      if (this.syncActive() || this.selectionTickTimer !== null) return;
      this.selectionTickTimer = setTimeout(() => {
        void tick();
      }, SELECTION_POLL_MS);
    };
    this.selectionTickTimer = setTimeout(() => {
      void tick();
    }, SELECTION_POLL_MS);
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

  /** Drop the 2s getDocument loop without clearing selectionDigesting or the watchdog. */
  private disarmSelectionLoop(): void {
    if (this.selectionTickTimer === null) return;
    clearTimeout(this.selectionTickTimer);
    this.selectionTickTimer = null;
  }

  finishSelectionPoll(): void {
    this.stopSelectionTick();
    this.selectionDigesting = false;
    this.selectionPollUntil = 0;
    this.selectionPollDocId = null;
    this.selectionJobId = null;
  }

  async setDocTopic(topicId: string | null, documentId?: string | null): Promise<void> {
    const id = documentId ?? this.doc?.id;
    if (!id) {
      this.paneTopicMenuOpen = false;
      return;
    }
    this.paneTopicMenuOpen = false;
    this.error = null;
    // In-flight GETs of this document predate the move. Refetch after the new floor is stored.
    this.bumpCardWriteGen();
    this.topicWrites += 1;
    try {
      const updated = await updateDocument(id, { topicId });
      const floorMs = Date.parse(updated.updatedAt);
      if (!Number.isNaN(floorMs)) this.saveFloors.set(id, floorMs);
      const topicTitle = this.topicTitleById(updated.topicId);
      if (this.doc?.id === id) {
        const topicMoved = this.doc.topicId !== updated.topicId;
        this.doc = {
          ...this.doc,
          topicId: updated.topicId,
          topicTitle,
          updatedAt: updated.updatedAt,
          cards: topicMoved
            ? this.doc.cards.map((card) => ({ ...card, topicId: updated.topicId, mapNodeId: null }))
            : this.doc.cards,
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
    } finally {
      this.topicWrites -= 1;
      this.kickReplay();
    }
  }

  private syncEditorFromRemote(doc: { id: string; title: string | null }): void {
    this.resolve(EditorService).applyRemoteMeta(doc);
  }

  noteEditorSaved(
    id: string,
    title: string | null,
    contentJson: PmDocJson,
    updatedAt?: string,
  ): void {
    const stamp = updatedAt && !Number.isNaN(Date.parse(updatedAt)) ? updatedAt : null;
    this.documents = this.documents.map((item) =>
      item.id === id ? { ...item, title, contentJson, ...(stamp ? { updatedAt: stamp } : {}) } : item,
    );
    if (this.doc?.id === id) {
      this.doc = { ...this.doc, title, contentJson, ...(stamp ? { updatedAt: stamp } : {}) };
    }
    if (!stamp) return;
    this.saveFloors.set(id, Date.parse(stamp));
    this.echoDocumentRow(id, stamp);
  }

  stopPolling(): void {
    stopPolling(this);
  }

  override destroy(): void {
    this.unsubscribeSync?.();
    this.unsubscribeSync = null;
    this.sync = null;
    try {
      const editor = this.resolve(EditorService);
      editor.onLocalWriteStart = null;
      editor.onLocalWriteEnd = null;
    } catch {
      // Container already gone.
    }
    this.importService.abortInFlight();
    this.stopPolling();
    this.finishSelectionPoll();
    stopToast(this);
    super.destroy();
  }

  syncPolling(): void {
    if (this.syncActive()) {
      this.stopPolling();
      return;
    }
    const listPending = hasPendingDoc(this.documents);
    const docPending = this.doc?.status === 'pending';
    const uploading = Object.keys(this.uploadByDoc).length > 0;
    if (listPending || docPending || uploading) this.startPolling();
    else this.stopPolling();
  }

  startPolling(): void {
    if (this.syncActive()) return;
    startPolling(this, () => void this.tickPending());
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

  async refreshOne(id: string, changeAt?: string | null): Promise<void> {
    let editorId: string | null = null;
    try {
      editorId = this.resolve(EditorService).id;
    } catch {
      editorId = null;
    }
    const read: DetailRead = {
      id,
      gen: this.cardWriteGen,
      floor: this.saveFloors.get(id) ?? null,
      docLoadGen: this.docLoadGen,
      openAtStart: this.doc?.id === id,
      protectedAtStart: this.doc?.id === id || editorId === id,
      changeAt: changeAt ?? null,
    };
    this.inflightReads.push(read);
    try {
      const [detail, notes] = await Promise.all([
        getDocument(id),
        read.openAtStart
          ? listDocumentAnnotations(id).catch(() => this.annotations)
          : Promise.resolve(null),
      ]);
      const mode = this.classifyDetail(id, read, detail.updatedAt);
      if (mode === 'drop') {
        this.noteDetailDropped(read);
        return;
      }
      const queuedAt = this.replayQueue.find((item) => item.id === id)?.changeAt ?? null;
      const at = read.changeAt ?? queuedAt;
      if (read.gen === this.cardWriteGen) {
        this.replayQueue = this.replayQueue.filter((item) => item.id !== id);
        if (this.replayStamp.get(id) === this.replayKey(id)) this.replayStamp.delete(id);
      }
      this.applyRemoteDetail(id, detail, notes, mode, at, read.docLoadGen);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        this.replayQueue = this.replayQueue.filter((item) => item.id !== id);
        this.forgetDocument(id);
        return;
      }
      // Transient poll errors should not wipe the list.
    } finally {
      this.inflightReads = this.inflightReads.filter((item) => item !== read);
      this.kickReplay();
    }
  }

  private syncActive(): boolean {
    return this.sync?.active === true;
  }

  private onSyncEvent(event: SyncEvent): void {
    if (event.type === 'active') {
      if (event.active) {
        this.stopPolling();
        this.disarmSelectionLoop();
      } else {
        this.syncPolling();
        if (this.selectionPollDocId) this.armSelectionLoop(this.selectionPollDocId);
      }
      return;
    }
    this.syncChain = this.syncChain
      .then(() => this.handleSync(event))
      .catch(() => undefined);
  }

  private async handleSync(event: SyncEvent): Promise<void> {
    if (event.type === 'reset') {
      await this.reloadFromReset();
      return;
    }
    if (event.type !== 'changes') return;
    const changes = coalesceChanges(stripEchoes(event.changes, this.echoes));
    const intents = planReloads(changes, this.syncView());
    await this.applySyncIntents(intents, changes);
  }

  private syncView(): SyncView {
    const editor = this.resolve(EditorService);
    const editorLive = editor.id !== null && editor.phase !== 'idle' && editor.phase !== 'missing';
    return {
      documents: this.documents.map((item) => ({ id: item.id, updatedAt: item.updatedAt })),
      openDocumentId: this.doc?.id ?? null,
      listIncludesHead: true,
      editor:
        editorLive && editor.id
          ? {
              id: editor.id,
              updatedAt: this.serverStamp(editor.id),
              bodyDirty: !jsonEqual(editor.draftJson, editor.lastSavedJson),
              titleDirty: editor.draftTitle.trim() !== editor.lastSavedTitle.trim(),
              saveInflight: editor.saveInflight !== null,
            }
          : null,
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

  private serverStamp(id: string): string {
    if (this.doc?.id === id) return this.doc.updatedAt;
    return this.documents.find((item) => item.id === id)?.updatedAt ?? new Date(0).toISOString();
  }

  private async applySyncIntents(
    intents: ReturnType<typeof planReloads>,
    changes: SyncChange[],
  ): Promise<void> {
    const deleteIds: string[] = [];
    const upserts: string[] = [];
    const jobIds: string[] = [];
    for (const intent of intents) {
      if (intent.kind === 'document' && intent.op === 'delete') deleteIds.push(intent.id);
      else if (intent.kind === 'document' && intent.op === 'upsert') upserts.push(intent.id);
      else if (intent.kind === 'job') jobIds.push(intent.id);
    }
    if (intents.some((intent) => intent.kind === 'documents-page')) {
      await this.reloadListMerging(deleteIds);
    }
    for (const id of deleteIds) this.forgetDocument(id);
    const atById = new Map<string, string>();
    for (const change of changes) {
      if (change.scope === 'document' && change.op === 'upsert' && change.resourceId) {
        atById.set(change.resourceId, change.at);
      }
    }
    for (const id of upserts) {
      await this.refreshOne(id, atById.get(id) ?? null);
    }
    if (jobIds.length > 0) {
      await this.refreshJobs();
      for (const id of jobIds) {
        if (this.selectionJobId === id) await this.settleSelectionJob(id);
      }
    }
  }

  private async reloadFromReset(): Promise<void> {
    const editor = this.resolve(EditorService);
    const openId = this.doc?.id ?? editor.id;
    // The gap is not replayed, so replace the window instead of appending local rows.
    await Promise.all([this.reloadListMerging([], false), this.refreshJobs()]);
    if (!openId) return;
    if (editor.remoteGone && editor.id === openId) return;
    await this.refreshOne(openId);
  }

  private async reloadListMerging(deleteIds: readonly string[], keepTail = true): Promise<void> {
    const gen = ++this.loadGen;
    const want = Math.max(this.documents.length, DOC_PAGE);
    try {
      // Server list limit is 100.
      const items: DocumentListItem[] = [];
      let total = 0;
      let offset = 0;
      while (items.length < want) {
        const limit = Math.min(LIST_LIMIT_MAX, want - items.length);
        const page = await listDocuments({
          ...(this.filterTopicId ? { topicId: this.filterTopicId } : {}),
          limit,
          offset,
        });
        total = page.total;
        items.push(...page.items);
        if (page.items.length === 0 || items.length >= total) break;
        offset += page.items.length;
      }
      if (gen !== this.loadGen) return;
      const seen = new Set(items.map((item) => item.id));
      const tail = keepTail ? this.documents.filter((item) => !seen.has(item.id)) : [];
      const drop = new Set(deleteIds);
      this.documents = [...items, ...tail].filter((item) => !drop.has(item.id));
      this.documentsTotal = total;
      this.syncPolling();
    } catch {
      // Keep the rows already on screen.
    }
  }

  private classifyDetail(
    id: string,
    read: DetailRead,
    updatedAt: string,
  ): 'drop' | 'merge-keep-body' | 'merge-seed-body' {
    const editor = this.resolve(EditorService);
    const bodyDirty = editor.id === id && !jsonEqual(editor.draftJson, editor.lastSavedJson);
    const inflight = editor.id === id && editor.saveInflight !== null;
    // A read that started on this document keeps its generation after close.
    // Other rows ignore the counter so a card edit does not cancel their refresh.
    return classifyRemoteDetail({
      capturedGen: read.protectedAtStart ? read.gen : this.cardWriteGen,
      currentGen: this.cardWriteGen,
      dirty: bodyDirty,
      inflight,
      detailUpdatedAtMs: Date.parse(updatedAt),
      floorUpdatedAtMs: read.floor,
    });
  }

  private applyRemoteDetail(
    id: string,
    detail: DocumentDetail,
    notes: Annotation[] | null,
    mode: 'merge-keep-body' | 'merge-seed-body',
    changeAt: string | null,
    docLoadGenAtStart: number,
  ): void {
    if (docLoadGenAtStart !== this.docLoadGen) {
      // The open snapshot arrived after this GET. Do not write the editor or an older list row.
      const stored =
        this.doc?.id === id
          ? this.doc.updatedAt
          : this.documents.find((item) => item.id === id)?.updatedAt;
      const detailMs = Date.parse(detail.updatedAt);
      const storedMs = stored === undefined ? Number.NaN : Date.parse(stored);
      const older = stored !== undefined && detailMs < storedMs;
      if (!older) this.patchListFromDetail(detail);
      this.syncPolling();
      return;
    }
    const editor = this.resolve(EditorService);
    this.patchListFromDetail(detail);
    if (this.doc?.id === id) {
      this.doc = detail;
      if (notes) this.annotations = notes;
      this.pruneOpenCards();
    }
    if (editor.id === id && !editor.remoteGone) {
      editor.setTopicId(detail.topicId);
      if (mode === 'merge-seed-body') editor.applyRemoteBody(detail);
      this.syncEditorFromRemote(detail);
      if (mode === 'merge-keep-body') this.toastBodyConflict(detail, changeAt);
    }
    if (
      this.selectionDigesting &&
      this.selectionPollDocId === id &&
      this.doc?.id === id &&
      this.doc.cards.length > this.selectionCardCountAtStart
    ) {
      this.finishSelectionPoll();
    }
    this.syncPolling();
  }

  private toastBodyConflict(detail: DocumentDetail, changeAt: string | null): void {
    if (!changeAt || this.conflictNotifiedAt === changeAt) return;
    const editor = this.resolve(EditorService);
    if (editor.id !== detail.id) return;
    if (jsonEqual(detail.contentJson, editor.lastSavedJson)) return;
    this.conflictNotifiedAt = changeAt;
    this.showToast('另一处改过正文，这里仍是未保存的草稿');
  }

  private forgetDocument(id: string): void {
    const had = this.documents.some((item) => item.id === id);
    this.documents = this.documents.filter((item) => item.id !== id);
    if (had) this.documentsTotal = Math.max(0, this.documentsTotal - 1);
    const editor = this.resolve(EditorService);
    const wasOpen = this.doc?.id === id || editor.id === id;
    if (this.doc?.id === id) {
      this.docLoadGen += 1;
      this.doc = null;
      this.annotations = [];
      this.annotationImageUrls = {};
      this.cardImageUrls = {};
      this.closeHighlight();
    }
    if (this.selectionPollDocId === id) this.finishSelectionPoll();
    if (!wasOpen) {
      this.syncPolling();
      return;
    }
    const dirty = editor.id === id && (editor.dirty || editor.saveInflight !== null);
    if (dirty) {
      editor.remoteGone = true;
      editor.clearTimer();
      if (this.goneNotifiedId !== id) {
        this.goneNotifiedId = id;
        this.showToast('这份文档已在别处移入回收站');
      }
      this.syncPolling();
      return;
    }
    if (editor.id === id) {
      editor.clearTimer();
      editor.phase = 'missing';
      editor.error = null;
    }
    this.docError = '找不到这份文档。';
    this.syncPolling();
  }

  /** Generation and PUT floor. The document id is the map key. */
  private replayKey(id: string): string {
    return `${this.cardWriteGen}:${this.saveFloors.get(id) ?? ''}`;
  }

  private noteDetailDropped(read: DetailRead): void {
    const id = read.id;
    if (read.changeAt) {
      const queued = this.replayQueue.find((item) => item.id === id);
      if (queued) {
        if (!queued.changeAt) queued.changeAt = read.changeAt;
      } else {
        const inflight = this.inflightReads.find(
          (item) => item !== read && item.id === id && item.gen === this.cardWriteGen,
        );
        if (inflight && !inflight.changeAt) inflight.changeAt = read.changeAt;
      }
    }
    const key = this.replayKey(id);
    if (this.replayStamp.get(id) === key) return;
    // This read stays listed until finally. Only another current-generation read covers it.
    const covered = this.inflightReads.some(
      (item) => item !== read && item.id === id && item.gen === this.cardWriteGen,
    );
    const decision = planDroppedDocumentReplay({
      dropped: true,
      writeInflight: this.isWriteInflight(),
      recoveryInflight: this.recoveryInflight || covered,
    });
    if (decision === 'none') return;
    this.replayStamp.set(id, key);
    if (!this.replayQueue.some((item) => item.id === id)) {
      this.replayQueue.push({ id, changeAt: read.changeAt });
    }
    if (decision === 'start') this.kickReplay();
  }

  private isWriteInflight(): boolean {
    // The topic PUT stores its floor on success. A replay before that would put the old topic back.
    if (this.topicWrites > 0) return true;
    try {
      return this.resolve(EditorService).saveInflight !== null;
    } catch {
      return false;
    }
  }

  private kickReplay(): void {
    if (this.recoveryInflight || this.isWriteInflight()) return;
    const next = this.replayQueue.find(
      (item) => !this.inflightReads.some((read) => read.id === item.id && read.gen === this.cardWriteGen),
    );
    if (!next) return;
    this.replayQueue = this.replayQueue.filter((item) => item !== next);
    void this.runReplay(next.id, next.changeAt);
  }

  private async runReplay(id: string, changeAt: string | null): Promise<void> {
    this.recoveryInflight = true;
    try {
      await this.refreshOne(id, changeAt);
    } finally {
      this.recoveryInflight = false;
      this.kickReplay();
    }
  }

  private async settleSelectionJob(id: string): Promise<void> {
    if (this.selectionJobId !== id || !this.selectionDigesting) return;
    try {
      const job = await getJob(id);
      if (this.selectionJobId !== id) return;
      if (job.status === 'done' || job.status === 'failed') this.finishSelectionPoll();
    } catch {
      // Watchdog still clears the flag.
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
