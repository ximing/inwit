import { AssetUrlsService } from '@/services/asset-urls.service';
import type { DocumentChange } from '@/components/document-actions.service';
import { Service } from '@rabjs/react';
import type { CaptureEditorHandle } from '@/components/capture/capture-editor';
import {
  EMPTY_PM_DOC,
  isChatQuestion,
  listBodyPreview,
  toDocumentListItem,
  type Annotation,
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
  type CanvasMember,
  type CanvasNode,
  type CanvasRevision,
  type CreateCanvasNodeInput,
  type SyncChange,
  outlineChildSlots,
  outlineSlot,
  planOutlineMove,
  planOutlinePlace,
  type Topic,
  type UpdateCardInput,
} from '@inwit/dto';
import { discardThoughtDraft } from './thought-draft';
import { listDocumentAnnotations } from '@/api/annotations';
import {
  completeAssetMultipart,
  initAssetMultipart,
  presignAsset,
  signAssetMultipart,
} from '@/api/assets';
import {
  createCanvasNode,
  createCanvasNote,
  deleteCanvasNode,
  listCanvasNodes,
  listCanvasRevisions,
  restoreCanvasRevision as restoreCanvasRevisionRequest,
  updateCanvasNode,
} from '@/api/canvas';
import {
  acceptCard,
  archiveCard,
  createCard,
  restoreCard,
  rejectCard,
  resumeCard,
  suspendCard,
  updateCard,
} from '@/api/cards';
import { ApiError, errorMessage } from '@/api/client';
import {
  acceptProposedCards,
  createDocument,
  getDocument,
  listDocuments,
  retryDocument,
  updateDocument,
} from '@/api/documents';
import {
  asListItem,
  captureIsChat,
  mergeDetail,
  sendCapture,
  showToast,
  stopToast,
} from '@/lib/doc-list';
import { getJob } from '@/api/jobs';
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
import { dropPrefetchedDocument, prefetchedDocument } from '@/lib/document-prefetch';
import { asPmJson, clonePmJson, jsonEqual, textToPmDoc } from '@/lib/pm-doc';
import {
  classifyRemoteDetail,
  coalesceChanges,
  planDroppedDocumentReplay,
  planReloads,
  stripEchoes,
  type EchoStamp,
  type SyncView,
} from '@/lib/sync-plan';
import { putPresigned } from '@/lib/presign-put';
import { DialogService } from '@/services/dialog.service';
import { CARD_RAIL_NARROW_PX } from '@/services/ui-prefs.service';
import { SyncService, type SyncEvent } from '@/services/sync.service';
import { AssetUploadError, storeDocAsset, type UploadDocAssetApi } from './upload-asset';
import { type CanvasOp } from './canvas-history';
import { DocsAnnotationsService } from './docs-annotations.service';
import { DocsCanvasService } from './docs-canvas.service.js';
import {
  DocsSelectionService,
  type SelectionPollHooks,
  type SelectionPopState,
} from './docs-selection.service.js';
import {
  DocsPendingPollService,
  type PendingPollHooks,
} from './docs-pending-poll.service.js';
import { MIND_NEW_TEXT } from './mindmap-edit';
import { DocsImportService, importFailMessage } from './docs-import.service';
import { EditorService } from './editor.service';
import {
  applyCanvasDetach,
  applyCanvasMoves,
  asDocumentCard,
  cardsAfterDetach,
  cardsAfterMoves,
  clipReason,
  decisionError,
  forestOf,
  upsertCanvas,
} from './docs-canvas-logic.js';

const canvasAssetApi: UploadDocAssetApi = {
  presign: presignAsset,
  initMultipart: initAssetMultipart,
  signMultipart: signAssetMultipart,
  completeMultipart: completeAssetMultipart,
  put: putPresigned,
};

const DOC_PAGE = 20;
const LIST_LIMIT_MAX = 100;

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

interface ThoughtPopState {
  left: number;
  top: number;
  documentId: string;
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
  /** 想法批注的软锚点：点击后正文要滚到的顶层块号（1 起）。 */
  bodyFocusBlockIndex: number | null = null;
  /** 脑图再次选中同一张卡或批注时，正文滚动和 PDF 跳转靠它再走一次。 */
  documentRevealSeq = 0;
  appliedUrlAnchor: string | null = null;
  docLoadGen = 0;
  paneWidth = 0;
  /** Anchor or annotation peek. Not the 浮层/并排 choice. */
  cardRailOverlayOpen = false;
  composingNew = false;
  /** 记想法浮动输入框；null 表示没打开。位置和草稿都跟文章走。 */
  thoughtPop: ThoughtPopState | null = null;
  private thoughtByDocument = new Map<string, ThoughtPopState>();
  editorHost: DocEditorHost | null = null;

  toastTimer: ReturnType<typeof setTimeout> | null = null;
  loadGen = 0;

  private _sync: SyncService | null = null;
  private _syncResolved = false;
  private unsubscribeSync: (() => void) | null = null;
  private syncChain: Promise<void> = Promise.resolve();
  private echoes: EchoStamp[] = [];
  private saveFloors = new Map<string, number>();
  /** Latest folded body from the read view, waiting to be written. */
  private codeFold: {
    id: string;
    json: PmDocJson;
    baseline: PmDocJson;
    /** `updatedAt` of the body `baseline` was cloned from. */
    baselineUpdatedAt: string;
  } | null = null;
  private codeFoldTimer: ReturnType<typeof setTimeout> | null = null;
  private codeFoldInflight: Promise<void> | null = null;
  private conflictNotifiedAt: string | null = null;
  private goneNotifiedId: string | null = null;
  private inflightReads: DetailRead[] = [];
  private replayQueue: { id: string; changeAt: string | null }[] = [];
  private recoveryInflight = false;
  /** Last give-up key per document. Another id must not clear it. A newer write changes the key. */
  private replayStamp = new Map<string, string>();
  /** Topic PUT still in flight. Dropped GETs wait until its floor is stored. */
  private topicWrites = 0;

  /**
   * 惰性解析 SyncService：Service 之间互相依赖时一律在使用点 resolve，
   * 不在构造器里解析（嵌套实例化顺序敏感，且让构造保持轻量可测）。
   * Unit tests call `new DocsService()` with no container.
   */
  private get sync(): SyncService | null {
    if (!this._syncResolved) {
      this._syncResolved = true;
      try {
        this._sync = this.resolve(SyncService);
      } catch {
        this._sync = null;
      }
    }
    return this._sync;
  }

  get importService(): DocsImportService {
    return this.resolve(DocsImportService);
  }

  get annotationService(): DocsAnnotationsService {
    return this.resolve(DocsAnnotationsService);
  }

  get canvasService(): DocsCanvasService {
    return this.resolve(DocsCanvasService);
  }

  get selectionService(): DocsSelectionService {
    return this.resolve(DocsSelectionService);
  }

  get pollService(): DocsPendingPollService {
    return this.resolve(DocsPendingPollService);
  }

  get activeJobs(): Job[] {
    return this.pollService.activeJobs;
  }
  set activeJobs(value: Job[]) {
    this.pollService.activeJobs = value;
  }

  get pollTimer(): ReturnType<typeof setInterval> | null {
    return this.pollService.pollTimer;
  }
  set pollTimer(value: ReturnType<typeof setInterval> | null) {
    this.pollService.pollTimer = value;
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

  /** 已经落库的画布节点。没摆过的卡片和批注不在这里，读的时候补成根。 */
  get canvasNodes(): CanvasNode[] {
    return this.canvasService.canvasNodes;
  }
  set canvasNodes(value: CanvasNode[]) {
    this.canvasService.canvasNodes = value;
  }

  get canvasUploading(): boolean {
    return this.canvasService.canvasUploading;
  }
  set canvasUploading(value: boolean) {
    this.canvasService.canvasUploading = value;
  }

  get canvasUndo(): number {
    return this.canvasService.canvasUndo;
  }
  set canvasUndo(value: number) {
    this.canvasService.canvasUndo = value;
  }

  get canvasRedo(): number {
    return this.canvasService.canvasRedo;
  }
  set canvasRedo(value: number) {
    this.canvasService.canvasRedo = value;
  }

  get canvasRevisions(): CanvasRevision[] {
    return this.canvasService.canvasRevisions;
  }
  set canvasRevisions(value: CanvasRevision[]) {
    this.canvasService.canvasRevisions = value;
  }

  get canvasRevisionsOpen(): boolean {
    return this.canvasService.canvasRevisionsOpen;
  }
  set canvasRevisionsOpen(value: boolean) {
    this.canvasService.canvasRevisionsOpen = value;
  }

  get canvasRevisionsLoading(): boolean {
    return this.canvasService.canvasRevisionsLoading;
  }
  set canvasRevisionsLoading(value: boolean) {
    this.canvasService.canvasRevisionsLoading = value;
  }

  get canvasRevisionRestoring(): string | null {
    return this.canvasService.canvasRevisionRestoring;
  }
  set canvasRevisionRestoring(value: string | null) {
    this.canvasService.canvasRevisionRestoring = value;
  }

  get selectionDigesting(): boolean {
    return this.selectionService.selectionDigesting;
  }
  set selectionDigesting(value: boolean) {
    this.selectionService.selectionDigesting = value;
  }

  get selectionPollUntil(): number {
    return this.selectionService.selectionPollUntil;
  }
  set selectionPollUntil(value: number) {
    this.selectionService.selectionPollUntil = value;
  }

  get selectionPollDocId(): string | null {
    return this.selectionService.selectionPollDocId;
  }
  set selectionPollDocId(value: string | null) {
    this.selectionService.selectionPollDocId = value;
  }

  get selectionCardCountAtStart(): number {
    return this.selectionService.selectionCardCountAtStart;
  }
  set selectionCardCountAtStart(value: number) {
    this.selectionService.selectionCardCountAtStart = value;
  }

  get selectionJobId(): string | null {
    return this.selectionService.selectionJobId;
  }
  set selectionJobId(value: string | null) {
    this.selectionService.selectionJobId = value;
  }

  get selectionPop(): SelectionPopState | null {
    return this.selectionService.selectionPop;
  }
  set selectionPop(value: SelectionPopState | null) {
    this.selectionService.selectionPop = value;
  }

  get selectionTickTimer(): ReturnType<typeof setTimeout> | null {
    return this.selectionService.selectionTickTimer;
  }
  set selectionTickTimer(value: ReturnType<typeof setTimeout> | null) {
    this.selectionService.selectionTickTimer = value;
  }

  get selectionWatchdog(): ReturnType<typeof setTimeout> | null {
    return this.selectionService.selectionWatchdog;
  }
  set selectionWatchdog(value: ReturnType<typeof setTimeout> | null) {
    this.selectionService.selectionWatchdog = value;
  }

  get canvasForest(): CanvasMember[] {
    return forestOf(this.doc?.cards ?? [], this.annotations, this.canvasNodes);
  }

  /** 一个节点离开可见树时，直接子节点各自成为一棵树。卡片和批注的画布行留着，恢复后还能挂回。 */
  detachCanvasLocal(removedId: string): void {
    if (!this.doc) return;
    const forest = forestOf(this.doc.cards, this.annotations, this.canvasNodes);
    this.canvasNodes = applyCanvasDetach(this.canvasNodes, forest, removedId, this.doc.id);
    this.doc = { ...this.doc, cards: cardsAfterDetach(this.doc.cards, forest, removedId) };
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
    preview?: string | null;
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
      hasContent:
        Boolean(doc.preview?.trim()) ||
        (doc.contentJson !== undefined && listBodyPreview(doc.contentJson) !== null),
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

  /**
   * Flush the open draft before preview, close, or another document.
   * Failure stays in the editor: no idle, and the draft is not marked saved.
   */
  async commitEditorLeave(leave: boolean): Promise<boolean> {
    const editor = this.resolve(EditorService);
    const pending =
      editor.dirty || editor.saveInflight !== null || editor.saveState === 'error';
    if (pending) {
      const ok = await editor.commitBeforeLeave();
      if (!ok) return false;
    }
    if (!leave) return true;
    if (editor.saveState === 'error' || editor.dirty || editor.saveInflight !== null) return false;
    if (editor.id) {
      this.noteEditorSaved(
        editor.id,
        editor.draftTitle.trim() || editor.lastSavedTitle.trim() || null,
        editor.draftJson,
      );
    }
    editor.idle();
    return true;
  }

  applyDocumentChange(change: DocumentChange): void {
    const { id, document: updated, topicTitle } = change;
    const remove = !updated || (this.filterTopicId !== null && updated.topicId !== this.filterTopicId);
    const had = this.documents.some((item) => item.id === id);
    this.documents = remove
      ? this.documents.filter((item) => item.id !== id)
      : this.documents.map((item) => {
          if (item.id !== id || !updated) return item;
          return toDocumentListItem(updated, {
            cardCount: item.cardCount,
            proposedCount: item.proposedCount,
            conceptCount: item.conceptCount,
            topicTitle,
          });
        });
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
    if (this.sync && !this.unsubscribeSync) {
      this.unsubscribeSync = this.sync.subscribe((event) => this.onSyncEvent(event));
    }
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
              conceptCount: existing.conceptCount,
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
      this.parkDocumentPops(this.doc?.id ?? null);
      this.doc = null;
      this.annotations = [];
      this.canvasNodes = [];
      this.annotationImageUrls = {};
      this.cardImageUrls = {};
      this.closeHighlight();
      this.appliedUrlAnchor = null;
      this.expandedCardIds = [];
      this.canvasService.resetCanvasHistory();
      this.canvasService.closeCanvasRevisionPanel();
      this.selectionService.restoreSelection(id);
      this.thoughtPop = this.thoughtByDocument.get(id) ?? null;
    }
    const gen = ++this.docLoadGen;
    if (this.goneNotifiedId === id) this.goneNotifiedId = null;
    try {
      const [detail, notes, canvas] = await Promise.all([
        prefetchedDocument(id) ?? getDocument(id),
        listDocumentAnnotations(id).catch(() => [] as Annotation[]),
        listCanvasNodes(id).catch(() => (this.doc?.id === id ? this.canvasNodes : [])),
      ]);
      if (gen !== this.docLoadGen) return;
      if (detail.assetUrls) {
        this.resolve(AssetUrlsService).seed(detail.assetUrls, detail.assetUrlsFetchedAt);
      }
      this.doc = detail;
      this.annotations = notes;
      this.canvasNodes = canvas;
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
      this.canvasNodes = [];
      this.canvasService.closeCanvasRevisionPanel();
    }
  }

  closeDoc(): void {
    this.parkDocumentPops(this.doc?.id ?? null);
    this.docLoadGen += 1;
    this.editorHost = null;
    this.doc = null;
    this.annotations = [];
    this.canvasNodes = [];
    this.annotationImageUrls = {};
    this.cardImageUrls = {};
    this.docError = null;
    this.composingNew = false;
    this.closeHighlight();
    this.expandedCardIds = [];
    this.appliedUrlAnchor = null;
    this.canvasService.resetCanvasHistory();
    this.canvasService.closeCanvasRevisionPanel();
    this.cardRailOverlayOpen = false;
    this.closeSelectionPop();
    this.thoughtPop = null;
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

  /**
   * 脑图选中一个节点。卡片和批注点亮正文并请求滚动或跳转，不展开、再点也不取消。
   * 锚点丢失、文本和图片只停在脑图上，不滚动、不跳转。
   */
  selectCanvasNode(id: string): void {
    const member = this.canvasForest.find((item) => item.id === id);
    if (!member) return;
    if (member.kind === 'card') {
      const card = this.doc?.cards.find((item) => item.id === id);
      if (!card || this.isCardAnchorLost(card)) return;
      this.activeCardId = id;
      this.activeAnnotationId = null;
      this.bodyFocusAnnotationId = null;
      this.bodyFocusCardId = id;
      this.documentRevealSeq += 1;
      return;
    }
    if (member.kind === 'annotation') {
      const item = this.annotations.find((note) => note.id === id);
      if (!item || this.isAnnotationAnchorLost(item)) return;
      this.activeAnnotationId = id;
      this.activeCardId = null;
      this.bodyFocusCardId = null;
      if (item.kind === 'note') {
        // 想法没有正文锚点：有软锚点就把对应块滚进视口，否则只停在脑图选中。
        this.bodyFocusAnnotationId = null;
        if (item.anchorBlockIndex != null) {
          this.bodyFocusBlockIndex = item.anchorBlockIndex;
          this.documentRevealSeq += 1;
        }
        return;
      }
      this.bodyFocusAnnotationId = id;
      this.documentRevealSeq += 1;
    }
  }

  focusAnnotation(id: string): void {
    // 再点一次当前批注 = 取消选中
    if (this.activeAnnotationId === id) {
      this.activeAnnotationId = null;
      this.bodyFocusAnnotationId = null;
      this.bodyFocusBlockIndex = null;
      return;
    }
    const item = this.annotations.find((note) => note.id === id);
    if (item && this.isAnnotationAnchorLost(item)) {
      this.showToast('原文已删除');
      return;
    }
    this.activeAnnotationId = id;
    this.activeCardId = null;
    if (item?.kind === 'note') {
      this.bodyFocusAnnotationId = null;
      if (item.anchorBlockIndex != null) {
        this.bodyFocusBlockIndex = item.anchorBlockIndex;
        this.documentRevealSeq += 1;
      }
      return;
    }
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
    this.bodyFocusBlockIndex = null;
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

  clearBodyFocusBlock(): void {
    this.bodyFocusBlockIndex = null;
  }

  /** 打开记想法浮动输入框。不传位置时取窗口上方居中。 */
  openThoughtPop(at?: { left: number; top: number }): void {
    const documentId = this.doc?.id;
    if (!documentId) return;
    if (this.thoughtPop && this.thoughtPop.documentId !== documentId) {
      this.thoughtByDocument.set(this.thoughtPop.documentId, this.thoughtPop);
    }
    const next = { ...(at ?? { left: window.innerWidth / 2, top: 120 }), documentId };
    this.thoughtPop = next;
    this.thoughtByDocument.set(documentId, next);
  }

  closeThoughtPop(): void {
    const documentId = this.thoughtPop?.documentId;
    if (documentId) {
      this.thoughtByDocument.delete(documentId);
      discardThoughtDraft('float', documentId);
    }
    this.thoughtPop = null;
  }

  /** 记想法时静默记录的软锚点：正文视口顶部所在块。取不到就返回 null，不阻塞。 */
  thoughtAnchorBlockIndex(): number | null {
    try {
      return this.editorHost?.viewportTopBlockIndex() ?? null;
    } catch {
      return null;
    }
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

  openSelectionPop(input: SelectionPopState): void {
    this.selectionService.openSelectionPop(input);
  }

  closeSelectionPop(): void {
    this.selectionService.closeSelectionPop();
  }

  /** 切文章时把当前浮层留给原文章，调用方再装上目标文章自己的。 */
  private parkDocumentPops(documentId: string | null): void {
    if (!documentId) return;
    this.selectionService.parkSelection(documentId);
    if (this.thoughtPop?.documentId === documentId) {
      this.thoughtByDocument.set(documentId, this.thoughtPop);
    }
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
    return (await this.annotationService.addAnnotation(documentId, quote, note, extra)) !== null;
  }

  /** 正文选区拖到脑图：落成批注（不在正文侧打开），返回新批注 id 供画布落位。 */
  async addCanvasQuoteAnnotation(
    documentId: string,
    quote: string,
    extra?: Pick<
      CreateAnnotationInput,
      'kind' | 'pageIndex' | 'geometry' | 'imageKey' | 'anchorBlockIndex'
    > & { from?: number; to?: number },
  ): Promise<string | null> {
    const created = await this.annotationService.addAnnotation(documentId, quote, '', extra, {
      quiet: true,
    });
    return created?.id ?? null;
  }

  /** 记一条想法（kind='note'）。成功后插入本地列表并选中；quiet 供脑图管线使用。 */
  async addThought(
    input: {
      documentId: string;
      note: string;
      imageKey?: string;
      anchorBlockIndex?: number;
    },
    opts?: { quiet?: boolean },
  ): Promise<Annotation | null> {
    return this.annotationService.addThought(input, opts);
  }

  /** 想法/脑图贴图上传：走 assets presign 链路，返回 imageKey（object key，不是 URL）。 */
  async uploadThoughtImage(file: File): Promise<string | null> {
    try {
      const stored = await storeDocAsset(file, canvasAssetApi);
      if (stored.kind !== 'image') {
        this.showToast('请选择图片');
        return null;
      }
      return stored.assetSrc.startsWith('asset:')
        ? stored.assetSrc.slice('asset:'.length)
        : stored.assetSrc;
    } catch (err) {
      const fallback = err instanceof AssetUploadError ? err.message : '图片没传上去';
      this.showToast(errorMessage(err, fallback));
      return null;
    }
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
        ...(input.annotationId ? { annotationId: input.annotationId } : {}),
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

  noteCanvasRevised(): void {
    if (this.canvasRevisionsOpen) void this.reloadCanvasRevisions();
  }

  toggleCanvasRevisions(): void {
    if (this.canvasRevisionsOpen) {
      this.canvasRevisionsOpen = false;
      return;
    }
    this.canvasRevisionsOpen = true;
    void this.reloadCanvasRevisions();
  }

  closeCanvasRevisions(): void {
    this.canvasService.closeCanvasRevisions();
  }

  async reloadCanvasRevisions(): Promise<void> {
    const id = this.doc?.id;
    if (!id) return;
    const gen = this.canvasService.startRevisionLoad();
    try {
      const revisions = await listCanvasRevisions(id);
      if (!this.canvasService.revisionGenMatches(gen) || this.doc?.id !== id) return;
      this.canvasRevisions = revisions;
    } catch (err) {
      if (!this.canvasService.revisionGenMatches(gen)) return;
      this.showToast(errorMessage(err, '历史没读出来'));
    } finally {
      this.canvasService.finishRevisionLoad(gen);
    }
  }

  async restoreCanvasRevision(revisionId: string): Promise<void> {
    if (!this.doc || this.canvasRevisionRestoring) return;
    const documentId = this.doc.id;
    this.canvasRevisionRestoring = revisionId;
    try {
      await restoreCanvasRevisionRequest(documentId, revisionId);
      this.cardWriteGen += 1;
      const gen = this.cardWriteGen;
      const [detail, canvas, notes] = await Promise.all([
        getDocument(documentId),
        listCanvasNodes(documentId),
        listDocumentAnnotations(documentId),
      ]);
      if (!this.doc || this.doc.id !== documentId || this.cardWriteGen !== gen) return;
      this.doc = { ...this.doc, cards: detail.cards, updatedAt: detail.updatedAt };
      this.annotations = notes;
      this.canvasNodes = canvas;
      this.editorHost?.ensureEntityMarks(this.doc.cards, this.annotations);
      this.canvasService.resetCanvasHistory();
      this.showToast('已恢复这一版脑图');
      await this.reloadCanvasRevisions();
    } catch (err) {
      this.showToast(errorMessage(err, '没恢复成'));
    } finally {
      if (this.canvasRevisionRestoring === revisionId) this.canvasRevisionRestoring = null;
    }
  }

  private refuseCanvas(message: string): void {
    if (this.canvasService.historyOpen) this.showToast(message);
    else throw new Error(message);
  }

  /**
   * 脑图落位。给出 index 时插到该兄弟位置；不给则接到 parentId 的末尾。
   * 已经是根时，调用方不应再把它拖成「接到根的末尾」。
   */
  async placeOnCanvas(memberId: string, parentId: string | null, index?: number): Promise<void> {
    if (!this.doc) {
      this.refuseCanvas('没放上去');
      return;
    }
    const documentId = this.doc.id;
    const forest = forestOf(this.doc.cards, this.annotations, this.canvasNodes);
    const before = outlineSlot(forest, memberId);
    const moved =
      index === undefined
        ? planOutlineMove(forest, memberId, parentId)
        : planOutlinePlace(forest, memberId, parentId, index);
    if (!moved.ok) {
      this.refuseCanvas(moved.reason === 'depth' ? '层级太深了' : '不能放到这里');
      return;
    }
    // 成员可能只有合并视图里的虚拟根（新批注还没有 canvas 行）：
    // 位置没变也要补落一行，否则「落位」只存在于 mergeCanvasForest 的兜底逻辑里。
    const hasRow = this.canvasNodes.some((node) => node.id === memberId);
    if (moved.unchanged && hasRow) return;
    const moves =
      'moves' in moved
        ? moved.moves
        : [{ id: memberId, parentId: moved.parentId, position: moved.position }];
    const nodeSnapshot = this.canvasNodes;
    const cardSnapshot = this.doc.cards;
    this.cardWriteGen += 1;
    const gen = this.cardWriteGen;
    this.canvasNodes = applyCanvasMoves(nodeSnapshot, forest, moves, documentId);
    this.doc = { ...this.doc, cards: cardsAfterMoves(cardSnapshot, forest, moves) };
    try {
      const updated = await updateCanvasNode(
        documentId,
        memberId,
        index === undefined || !('index' in moved)
          ? { parentId: moved.parentId }
          : { parentId: moved.parentId, index: moved.index },
      );
      if (!this.doc || this.doc.id !== documentId || this.cardWriteGen !== gen) return;
      this.canvasNodes = upsertCanvas(this.canvasNodes, updated);
      this.mirrorPlacedCard(updated);
      const after = outlineSlot(forestOf(this.doc.cards, this.annotations, this.canvasNodes), memberId);
      if (before && after) {
        this.canvasService.rememberCanvas(
          { type: 'place', id: memberId, at: before },
          { type: 'place', id: memberId, at: after },
        );
      }
      this.echoDocumentRow(updated.documentId, updated.updatedAt);
      this.noteCanvasRevised();
    } catch (err) {
      if (this.doc && this.cardWriteGen === gen) {
        this.canvasNodes = nodeSnapshot;
        this.doc = { ...this.doc, cards: cardSnapshot };
      }
      if (!this.canvasService.historyOpen) throw err;
      this.showToast(errorMessage(err, '没放上去'));
    }
  }

  private mirrorPlacedCard(node: CanvasNode): void {
    if (!this.doc || node.kind !== 'card') return;
    const parent = node.parentId
      ? forestOf(this.doc.cards, this.annotations, this.canvasNodes).find((item) => item.id === node.parentId)
      : null;
    this.doc = {
      ...this.doc,
      cards: this.doc.cards.map((card) =>
        card.id === node.id
          ? {
              ...card,
              outlineParentId: parent?.kind === 'card' ? parent.id : null,
              outlinePosition: node.position,
              updatedAt: node.updatedAt,
            }
          : card,
      ),
    };
  }

  /**
   * 脑图「添加文本节点」：同一次请求里新建想法并落位，这样编辑历史能把它整段撤掉。
   */
  async addCanvasTextAt(parentId: string | null, index: number): Promise<string | null> {
    if (!this.doc) return null;
    const documentId = this.doc.id;
    try {
      const created = await createCanvasNote(documentId, {
        note: MIND_NEW_TEXT,
        parentId,
        index,
      });
      if (!this.doc || this.doc.id !== documentId) return null;
      this.cardWriteGen += 1;
      this.annotations = [
        ...this.annotations.filter((item) => item.id !== created.annotation.id),
        created.annotation,
      ];
      this.canvasNodes = upsertCanvas(this.canvasNodes, created.node);
      this.echoDocumentRow(documentId, created.annotation.updatedAt);
      this.noteCanvasRevised();
      return created.annotation.id;
    } catch (err) {
      this.showToast(errorMessage(err, '没放上去'));
      return null;
    }
  }

  /** 脑图「添加图片节点」：上传后同一次请求里新建想法并落位。 */
  async addCanvasImage(file: File, parentId: string | null = null): Promise<void> {
    if (!this.doc || this.canvasUploading) return;
    const documentId = this.doc.id;
    this.canvasUploading = true;
    try {
      const stored = await storeDocAsset(file, canvasAssetApi);
      if (stored.kind !== 'image') {
        this.showToast('请选择图片');
        return;
      }
      const imageKey = stored.assetSrc.startsWith('asset:')
        ? stored.assetSrc.slice('asset:'.length)
        : stored.assetSrc;
      const created = await createCanvasNote(documentId, { imageKey, parentId });
      if (!this.doc || this.doc.id !== documentId) return;
      this.cardWriteGen += 1;
      this.annotations = [
        ...this.annotations.filter((item) => item.id !== created.annotation.id),
        created.annotation,
      ];
      this.canvasNodes = upsertCanvas(this.canvasNodes, created.node);
      this.echoDocumentRow(documentId, created.annotation.updatedAt);
      this.noteCanvasRevised();
    } catch (err) {
      const fallback = err instanceof AssetUploadError ? err.message : '图片没放上去';
      this.showToast(errorMessage(err, fallback));
    } finally {
      this.canvasUploading = false;
    }
  }

  async saveCanvasText(id: string, text: string): Promise<boolean> {
    if (!this.doc) return false;
    const trimmed = text.trim();
    if (!trimmed) {
      this.showToast('写点内容');
      return false;
    }
    if ([...trimmed].length > 4000) {
      this.showToast('太长了，四千字以内');
      return false;
    }
    const documentId = this.doc.id;
    const snapshot = this.canvasNodes;
    const existing = snapshot.find((node) => node.id === id);
    if (!existing || existing.kind !== 'text' || existing.text === trimmed) return existing?.text === trimmed;
    const previous = existing.text ?? '';
    this.cardWriteGen += 1;
    const gen = this.cardWriteGen;
    this.canvasNodes = upsertCanvas(snapshot, { ...existing, text: trimmed });
    try {
      const updated = await updateCanvasNode(documentId, id, { text: trimmed });
      if (!this.doc || this.cardWriteGen !== gen) return true;
      this.canvasNodes = upsertCanvas(this.canvasNodes, updated);
      this.echoDocumentRow(updated.documentId, updated.updatedAt);
      this.canvasService.rememberCanvas(
        { type: 'edit', id, text: previous },
        { type: 'edit', id, text: trimmed },
      );
      this.noteCanvasRevised();
      return true;
    } catch (err) {
      if (this.doc && this.cardWriteGen === gen) this.canvasNodes = snapshot;
      if (!this.canvasService.historyOpen) throw err;
      this.showToast(errorMessage(err, '没改上'));
      return false;
    }
  }

  async removeCanvasNode(id: string): Promise<void> {
    if (!this.doc) {
      this.refuseCanvas('没删掉');
      return;
    }
    const node = this.canvasNodes.find((item) => item.id === id);
    if (!node || (node.kind !== 'text' && node.kind !== 'image')) {
      if (!this.canvasService.historyOpen) this.refuseCanvas('没删掉');
      return;
    }
    const forest = forestOf(this.doc.cards, this.annotations, this.canvasNodes);
    const at = outlineSlot(forest, id) ?? { parentId: node.parentId, index: 0 };
    const children = outlineChildSlots(forest, id);
    const documentId = this.doc.id;
    const nodeSnapshot = this.canvasNodes;
    const cardSnapshot = this.doc.cards;
    this.cardWriteGen += 1;
    const gen = this.cardWriteGen;
    this.detachCanvasLocal(id);
    this.canvasNodes = this.canvasNodes.filter((item) => item.id !== id);
    try {
      await deleteCanvasNode(documentId, id);
      this.canvasService.rememberCanvas(
        {
          type: 'restore',
          id,
          kind: node.kind,
          text: node.text,
          imageKey: node.imageKey,
          at,
          children,
        },
        { type: 'delete', id },
      );
      this.noteCanvasRevised();
    } catch (err) {
      if (this.doc && this.cardWriteGen === gen) {
        this.canvasNodes = nodeSnapshot;
        this.doc = { ...this.doc, cards: cardSnapshot };
      }
      if (!this.canvasService.historyOpen) throw err;
      this.showToast(errorMessage(err, '没删掉'));
    }
  }

  private async insertCanvasNode(input: CreateCanvasNodeInput): Promise<CanvasNode | null> {
    if (!this.doc) {
      this.refuseCanvas('没放上去');
      return null;
    }
    const documentId = this.doc.id;
    this.cardWriteGen += 1;
    const gen = this.cardWriteGen;
    try {
      const created = await createCanvasNode(documentId, input);
      if (!this.doc || this.doc.id !== documentId || this.cardWriteGen !== gen) return null;
      this.canvasNodes = upsertCanvas(this.canvasNodes, created);
      this.echoDocumentRow(created.documentId, created.updatedAt);
      if (created.kind === 'text' || created.kind === 'image') {
        const at =
          outlineSlot(forestOf(this.doc.cards, this.annotations, this.canvasNodes), created.id) ?? {
            parentId: created.parentId,
            index: 0,
          };
        this.canvasService.rememberCanvas(
          { type: 'delete', id: created.id },
          {
            type: 'create',
            id: created.id,
            kind: created.kind,
            text: created.text,
            imageKey: created.imageKey,
            at,
          },
        );
      }
      this.noteCanvasRevised();
      return created;
    } catch (err) {
      if (!this.canvasService.historyOpen) throw err;
      this.showToast(errorMessage(err, '没放上去'));
      return null;
    }
  }

  async undoCanvas(): Promise<void> {
    await this.stepCanvas('undo');
  }

  async redoCanvas(): Promise<void> {
    await this.stepCanvas('redo');
  }

  private async stepCanvas(dir: 'undo' | 'redo'): Promise<void> {
    if (!this.canvasService.historyOpen) return;
    const op = this.canvasService.peekHistory(dir);
    if (!op) return;
    this.canvasService.suspendHistory();
    try {
      await this.runCanvasOp(op);
      this.canvasService.commitHistory(dir);
    } catch (err) {
      this.showToast(errorMessage(err, dir === 'undo' ? '没撤销成' : '没重做成'));
    } finally {
      this.canvasService.resumeHistory();
    }
  }

  private async runCanvasOp(op: CanvasOp): Promise<void> {
    switch (op.type) {
      case 'place':
        await this.placeOnCanvas(op.id, op.at.parentId, op.at.index);
        return;
      case 'edit': {
        const ok = await this.saveCanvasText(op.id, op.text);
        if (!ok) throw new Error('edit');
        return;
      }
      case 'delete':
        await this.removeCanvasNode(op.id);
        return;
      case 'archive': {
        const ok = await this.archiveDocCard(op.id, false);
        if (!ok) throw new Error('archive');
        return;
      }
      case 'create':
      case 'restore': {
        if (op.kind === 'text' && !op.text) throw new Error('text');
        if (op.kind === 'image' && !op.imageKey) throw new Error('image');
        const created = await this.insertCanvasNode(
          op.kind === 'text'
            ? { kind: 'text', text: op.text ?? '', parentId: op.at.parentId, index: op.at.index }
            : { kind: 'image', imageKey: op.imageKey ?? '', parentId: op.at.parentId, index: op.at.index },
        );
        if (!created || !this.doc) throw new Error('create');
        if (op.type === 'restore') {
          try {
            for (const child of [...op.children].sort((a, b) => a.index - b.index)) {
              await this.placeOnCanvas(child.id, created.id, child.index);
            }
          } catch (err) {
            await deleteCanvasNode(this.doc.id, created.id).catch(() => undefined);
            this.detachCanvasLocal(created.id);
            this.canvasNodes = this.canvasNodes.filter((node) => node.id !== created.id);
            throw err;
          }
        }
        if (created.id !== op.id) this.canvasService.remapHistory(op.id, created.id);
        return;
      }
      case 'unarchive':
        await this.restoreCanvasCard(op.id, op.card, op.children);
    }
  }

  private async restoreCanvasCard(
    id: string,
    card: DocumentCard,
    children: Array<{ id: string; index: number }>,
  ): Promise<void> {
    const restored = await restoreCard(id);
    if (!this.doc || this.doc.id !== card.documentId) throw new Error('restore');
    const nextCard: DocumentCard = {
      ...card,
      ...restored,
      questions: card.questions,
      review: card.review,
    };
    const cards = this.doc.cards.some((item) => item.id === id)
      ? this.doc.cards.map((item) => (item.id === id ? nextCard : item))
      : [...this.doc.cards, nextCard];
    this.doc = { ...this.doc, cards };
    this.patchListFromDetail(this.doc);
    for (const child of [...children].sort((a, b) => a.index - b.index)) {
      await this.placeOnCanvas(child.id, id, child.index);
    }
  }

  /** 删除前的说明。有子节点时告诉用户它们会留下，各自成为一棵树。 */
  nodeDeleteMessage(id: string, lead: string): string {
    const hasChild = this.canvasForest.some((node) => node.parentId === id);
    if (!hasChild) return lead;
    const base = lead.endsWith('。') ? lead : `${lead}。`;
    return `${base}挂在下面的节点会各自成为一棵树，不会一起删掉。`;
  }

  /** Soft delete: the card moves to 回收站 and can be restored from settings. */
  async archiveDocCard(id: string, confirm = true): Promise<boolean> {
    if (this.acceptingProposed) return false;
    if (!this.doc) {
      this.refuseCanvas('没删掉');
      return false;
    }
    const card = this.doc.cards.find((item) => item.id === id) ?? null;
    const children = outlineChildSlots(
      forestOf(this.doc.cards, this.annotations, this.canvasNodes),
      id,
    );
    if (confirm) {
      const ok = await this.resolve(DialogService).confirm(
        this.nodeDeleteMessage(id, '移入回收站，之后可以在设置里恢复'),
        { title: '移入回收站', ok: '移入回收站', danger: true },
      );
      if (!ok || !this.doc) return false;
    }
    try {
      await archiveCard(id);
      if (this.doc) {
        this.cardWriteGen += 1;
        this.detachCanvasLocal(id);
        this.patchListFromDetail(this.doc);
      }
      this.expandedCardIds = this.expandedCardIds.filter((cardId) => cardId !== id);
      if (this.activeCardId === id) this.activeCardId = null;
      if (this.editingCardId === id) this.editingCardId = null;
      this.editorHost?.ensureEntityMarks(this.doc?.cards ?? [], this.annotations);
      if (card) {
        this.canvasService.rememberCanvas({ type: 'unarchive', id, card, children }, { type: 'archive', id });
      }
      if (this.canvasService.historyOpen) this.showToast('已移入回收站，可在设置里恢复');
      this.noteCanvasRevised();
      return true;
    } catch (err) {
      if (!this.canvasService.historyOpen) throw err;
      this.showToast(errorMessage(err, '没删掉'));
      return false;
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
      this.detachCanvasLocal(id);
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
    return this.selectionService.queueSelectionCards(
      documentId,
      text,
      blockIndex,
      this.selectionPollHooks(),
    );
  }

  startSelectionPoll(documentId: string): void {
    this.selectionService.startSelectionPoll(documentId, this.selectionPollHooks());
  }

  private armSelectionLoop(documentId: string): void {
    this.selectionService.armSelectionLoop(documentId, this.selectionPollHooks());
  }

  stopSelectionTick(): void {
    this.selectionService.stopSelectionTick();
  }

  /** Drop the 2s getDocument loop without clearing selectionDigesting or the watchdog. */
  private disarmSelectionLoop(): void {
    this.selectionService.disarmSelectionLoop();
  }

  finishSelectionPoll(): void {
    this.selectionService.finishSelectionPoll();
  }

  private selectionPollHooks(): SelectionPollHooks {
    return {
      syncActive: () => this.syncActive(),
      refreshOne: (id) => this.refreshOne(id),
      showToast: (message) => this.showToast(message),
      cardCount: (id) => (this.doc?.id === id ? this.doc.cards.length : null),
    };
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
      item.id === id
        ? { ...item, title, preview: listBodyPreview(contentJson), ...(stamp ? { updatedAt: stamp } : {}) }
        : item,
    );
    if (this.doc?.id === id) {
      this.doc = { ...this.doc, title, contentJson, ...(stamp ? { updatedAt: stamp } : {}) };
    }
    if (!stamp) return;
    this.saveFloors.set(id, Date.parse(stamp));
    this.echoDocumentRow(id, stamp);
  }

  stopPolling(): void {
    this.pollService.stopPolling();
  }

  noteCodeFold(json: unknown): void {
    const doc = this.doc;
    if (!doc) return;
    const next = asPmJson(json);
    const same = this.codeFold?.id === doc.id ? this.codeFold : null;
    const baseline = same ? same.baseline : clonePmJson(doc.contentJson);
    const baselineUpdatedAt = same ? same.baselineUpdatedAt : doc.updatedAt;
    this.codeFold = { id: doc.id, json: next, baseline, baselineUpdatedAt };
    if (this.codeFoldTimer) clearTimeout(this.codeFoldTimer);
    this.codeFoldTimer = setTimeout(() => {
      this.codeFoldTimer = null;
      void this.flushCodeFold();
    }, 400);
  }

  async flushCodeFold(): Promise<void> {
    if (this.codeFoldTimer) {
      clearTimeout(this.codeFoldTimer);
      this.codeFoldTimer = null;
    }
    if (this.codeFoldInflight) await this.codeFoldInflight;
    const pending = this.codeFold;
    if (!pending) return;
    this.codeFold = null;
    const run = this.persistCodeFold(pending);
    this.codeFoldInflight = run;
    try {
      await run;
    } finally {
      if (this.codeFoldInflight === run) this.codeFoldInflight = null;
    }
    if (this.codeFold) await this.flushCodeFold();
  }

  private async persistCodeFold(pending: {
    id: string;
    json: PmDocJson;
    baseline: PmDocJson;
    baselineUpdatedAt: string;
  }): Promise<void> {
    if (jsonEqual(pending.baseline, pending.json)) return;
    if (this.foldBaselineStale(pending.id, pending.baselineUpdatedAt)) return;
    this.bumpCardWriteGen();
    try {
      const updated = await updateDocument(pending.id, { contentJson: pending.json });
      this.noteEditorSaved(pending.id, updated.title, asPmJson(updated.contentJson), updated.updatedAt);
    } catch (err) {
      if (!this.codeFold) this.codeFold = pending;
      this.error = errorMessage(err, '没记住代码的折叠');
    }
  }

  /** Newest stamp we already accepted for this document, if any. */
  private documentUpdatedAtMs(id: string): number | null {
    const stamps: number[] = [];
    const push = (value: string | number | null | undefined) => {
      if (value === null || value === undefined) return;
      const ms = typeof value === 'number' ? value : Date.parse(value);
      if (!Number.isNaN(ms)) stamps.push(ms);
    };
    if (this.doc?.id === id) push(this.doc.updatedAt);
    push(this.documents.find((item) => item.id === id)?.updatedAt);
    push(this.saveFloors.get(id));
    if (stamps.length === 0) return null;
    return Math.max(...stamps);
  }

  private foldBaselineStale(id: string, baselineUpdatedAt: string): boolean {
    const baselineMs = Date.parse(baselineUpdatedAt);
    if (Number.isNaN(baselineMs)) return false;
    const known = this.documentUpdatedAtMs(id);
    return known !== null && known > baselineMs;
  }

  override destroy(): void {
    void this.flushCodeFold();
    this.unsubscribeSync?.();
    this.unsubscribeSync = null;
    this._sync = null;
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
    this.pollService.clearFlipFollowUps();
    stopToast(this);
    super.destroy();
  }

  syncPolling(): void {
    this.pollService.syncPolling(this.pendingPollHooks());
  }

  startPolling(): void {
    this.pollService.startPolling(this.pendingPollHooks());
  }

  async tickPending(): Promise<void> {
    await this.pollService.tickPending(this.pendingPollHooks());
  }

  async refreshOneMeta(id: string): Promise<void> {
    await this.pollService.refreshOneMeta(id, this.pendingPollHooks());
  }

  async refreshJobs(): Promise<void> {
    await this.pollService.refreshJobs();
  }

  private pendingPollHooks(): PendingPollHooks {
    return {
      documents: () => this.documents,
      setDocuments: (items) => {
        this.documents = items;
      },
      doc: () => this.doc,
      setDoc: (doc) => {
        this.doc = doc;
      },
      uploadByDoc: () => this.uploadByDoc,
      syncActive: () => this.syncActive(),
      refreshOne: (id) => this.refreshOne(id),
      forgetDocument: (id) => this.forgetDocument(id),
    };
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
      const [detail, notes, canvas] = await Promise.all([
        getDocument(id),
        read.openAtStart
          ? listDocumentAnnotations(id).catch(() => this.annotations)
          : Promise.resolve(null),
        read.openAtStart
          ? listCanvasNodes(id).catch(() => this.canvasNodes)
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
      this.applyRemoteDetail(id, detail, notes, canvas, mode, at, read.docLoadGen);
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
      // sync 激活后仍保留轻量轮询（有 pending 时），停的只是 selection 补拉。
      this.syncPolling();
      if (event.active) {
        this.disarmSelectionLoop();
      } else if (this.selectionPollDocId) {
        this.armSelectionLoop(this.selectionPollDocId);
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
    const foldHeld = this.codeFold?.id === id;
    const bodyDirty =
      foldHeld || (editor.id === id && !jsonEqual(editor.draftJson, editor.lastSavedJson));
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
    canvas: CanvasNode[] | null,
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
      if (detail.assetUrls) {
        this.resolve(AssetUrlsService).seed(detail.assetUrls, detail.assetUrlsFetchedAt);
      }
      let held: PmDocJson | null = null;
      if (this.codeFold?.id === id) {
        const baselineMs = Date.parse(this.codeFold.baselineUpdatedAt);
        const detailMs = Date.parse(detail.updatedAt);
        const remoteNewer =
          !Number.isNaN(baselineMs) && !Number.isNaN(detailMs) && detailMs > baselineMs;
        if (remoteNewer) {
          if (this.codeFoldTimer) {
            clearTimeout(this.codeFoldTimer);
            this.codeFoldTimer = null;
          }
          this.codeFold = null;
        } else {
          held = this.codeFold.json;
        }
      }
      this.doc = held ? { ...detail, contentJson: held } : detail;
      if (notes) this.annotations = notes;
      if (canvas) {
        this.canvasNodes = canvas;
        if (this.canvasRevisionsOpen) void this.reloadCanvasRevisions();
      }
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
    dropPrefetchedDocument(id);
    this.pollService.cancelFlipFollowUp(id);
    const had = this.documents.some((item) => item.id === id);
    this.documents = this.documents.filter((item) => item.id !== id);
    if (had) this.documentsTotal = Math.max(0, this.documentsTotal - 1);
    const editor = this.resolve(EditorService);
    const wasOpen = this.doc?.id === id || editor.id === id;
    if (this.doc?.id === id) {
      this.docLoadGen += 1;
      this.doc = null;
      this.annotations = [];
      this.canvasNodes = [];
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

  kickReplay(): void {
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
