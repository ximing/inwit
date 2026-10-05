import { Service } from '@rabjs/react';
import {
  ASSET_IMAGE_MAX_BYTES,
  ASSET_IMAGE_MIMES,
  EXCERPT_MAX_BYTES,
  IMAGE_EXCERPT_QUOTE,
  type Annotation,
  type CanvasNode,
  type CardDetail,
  type CardLinksResponse,
  type DocumentCard,
  type DocumentDetail,
  type PmDocJson,
  type SyncChange,
  type Topic,
  type UpdateCardInput,
} from '@inwit/dto';
import {
  createAnnotation,
  deleteAnnotation,
  getAnnotationImage,
  listDocumentAnnotations,
  updateAnnotation,
} from '@/api/annotations';
import { presignAsset } from '@/api/assets';
import {
  deleteCanvasNode,
  listCanvasNodes,
  updateCanvasNode,
} from '@/api/canvas';
import {
  acceptCard,
  archiveCard,
  createCard,
  getCard,
  getCardImage,
  getCardLinks,
  rejectCard,
  resumeCard,
  suspendCard,
  updateCard,
} from '@/api/cards';
import { ApiError, errorMessage } from '@/api/client';
import {
  acceptProposedCards,
  deleteDocument,
  enqueueSelectionCards,
  getDocument,
  getDocumentFile,
  requestExcerptUpload,
  retryDocument,
  updateDocument,
} from '@/api/documents';
import { confirmAction } from '@/lib/confirm';
import { getJob } from '@/api/jobs';
import { getTopic, listTopics } from '@/api/topics';
import { clipChars } from '@/lib/clip';
import { formatTimeHm } from '@/lib/format';
import { asAssetSrc } from '@/lib/internal-links';
import { clonePmJson, isBlankPmDoc, jsonEqual } from '@/lib/pm-doc';
import { consumeEchoes } from '@/lib/sync-echo';
import {
  classifyRemoteDetail,
  coalesceChanges,
  planDroppedDocumentReplay,
  planReloads,
  type EchoStamp,
  type ReloadIntent,
  type SyncView,
} from '@/lib/sync-plan';
import {
  livePresignedUrl,
  shouldRetryPresign,
  type PresignedUrlEntry,
} from '@/lib/presign-cache-logic';
import { AssetUrlsService } from '@/services/asset-urls.service';
import { SyncService, type SyncEvent } from '@/services/sync.service';
import { ToastService } from '@/services/toast.service';
import * as FileSystem from 'expo-file-system/legacy';
import {
  documentForest,
  forestRows,
  imageKeyFromAssetSrc,
  nodesAfterMemberLeaves,
  planForestOpen,
  planReparent,
  type ForestRow,
} from './canvas-logic';
import {
  geometryFromQuads,
  PDF_EXCERPT_COLOR,
  PDF_HIGHLIGHT_COLOR,
  type PdfViewerEvent,
} from './pdf-logic';
import type { FormatState, TextSelectionAnchor } from '../../../../../packages/doc-engine/src/protocol';
import {
  buildDocumentPatch,
  displayedPmJson,
  enginePmJson,
  SAVE_DEBOUNCE_MS,
  titlesDiffer,
} from './editor-session';

const IMAGE_MIMES = new Set<string>(ASSET_IMAGE_MIMES);

function imageMime(uri: string, mimeType?: string | null): string | null {
  if (mimeType) {
    const mime = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
    const normalized = mime === 'image/jpg' ? 'image/jpeg' : mime;
    if (IMAGE_MIMES.has(normalized)) return normalized;
  }
  const lower = uri.split('?')[0]?.toLowerCase() ?? '';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return null;
}

function clipReason(reason: string): string {
  return clipChars(reason.replaceAll('\0', ''), 500);
}

function reparentError(reason: string): string {
  if (reason === 'cycle') return '不能挂到自己下面的节点';
  if (reason === 'depth') return '这一层太深了';
  if (reason === 'self') return '不能挂到自己下面';
  return '没法移动';
}

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

const POLL_MS = 3000;
const SELECTION_POLL_MS = 2000;
const SELECTION_POLL_FOR_MS = 9000;
const PDF_MIME = 'application/pdf';

export type ReaderSheet =
  | { kind: 'cards'; cardIds: string[] }
  | { kind: 'card'; cardId: string; fromCards?: string[] }
  | { kind: 'reject'; cardId: string; fromCards?: string[] }
  | { kind: 'annotations'; annotationIds: string[] }
  | { kind: 'annotate'; anchor: TextSelectionAnchor; pdfPageIndex?: number; pdfQuads?: number[][] }
  | { kind: 'canvas-actions'; nodeId: string }
  | { kind: 'canvas-parent'; nodeId: string }
  | { kind: 'canvas-text'; mode: 'create' | 'edit'; nodeId: string | null; parentId: string | null }
  | { kind: 'card-form'; anchor: TextSelectionAnchor }
  | { kind: 'card-edit'; cardId: string; fromCards?: string[] }
  | { kind: 'topic' }
  | { kind: 'more' }
  | { kind: 'format' }
  | { kind: 'link' }
  | { kind: 'math' };

type DetailRead = {
  id: string;
  gen: number;
  floor: number | null;
  serial: number;
  changeAt: string | null;
};

export class ReaderService extends Service {
  doc: DocumentDetail | null = null;
  annotations: Annotation[] = [];
  topics: Topic[] = [];
  docError: string | null = null;
  engineError: string | null = null;
  pdfUrl: string | null = null;
  pdfError: string | null = null;
  pdfSelection: { text: string; pageIndex: number; quads: number[][] } | null = null;
  pdfMarquee = false;
  pdfJump: { pageIndex: number; token: number } | null = null;
  canvasNodes: CanvasNode[] = [];
  viewMode: 'body' | 'map' = 'body';
  canvasText = '';
  engineReady = false;
  contentGen = 0;
  /** Bumped when cards change without a new document body. contentGen also reloads the doc. */
  entityGen = 0;
  sheet: ReaderSheet | null = null;
  activeCardId: string | null = null;
  links: CardLinksResponse | null = null;
  linksCache: Record<string, CardLinksResponse> = {};
  cardImageUrls: Record<string, PresignedUrlEntry> = {};
  annotationImageUrls: Record<string, string | null> = {};
  canvasImageUrls: Record<string, string | null> = {};
  noteDraft = '';
  cardQuestion = '';
  cardAnswer = '';
  rejectDraft = '';
  deciding = false;
  saving = false;
  focused = false;
  appActive = true;
  pollTimer: ReturnType<typeof setInterval> | null = null;
  selectionDigesting = false;
  selectionPollUntil = 0;
  selectionPollDocId: string | null = null;
  selectionCardCountAtStart = 0;
  selectionTickTimer: ReturnType<typeof setTimeout> | null = null;
  loadGen = 0;
  appliedAnchor: string | null = null;
  pendingAnchor: string | null = null;
  pendingAnnotationId: string | null = null;
  /** Route deep links open the card sheet when the engine catches up. A map open does not. */
  private anchorOpensSheet = false;
  private appliedAnnotationId: string | null = null;
  editing = false;
  draftTitle = '';
  lastSavedTitle = '';
  draftJson: PmDocJson | null = null;
  lastSavedJson: PmDocJson | null = null;
  saveState: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  savedAt: Date | null = null;
  saveError: string | null = null;
  formatState: FormatState | null = null;
  linkDraft = '';
  editingLink = false;
  mathDraft = '';
  cardEditQuestion = '';
  cardEditAnswer = '';
  uploadingImage = false;
  trashing = false;
  cardBusy = false;
  /** True from the first local edit until that JSON is known to match the last save. */
  editorLive = false;
  private closed = false;
  private bodyRead = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveInflight: Promise<void> | null = null;
  private docGetter: (() => Promise<PmDocJson>) | null = null;
  private trashed = false;
  private editRouteFor: string | null = null;
  private sync: SyncService | null = null;
  private unsubscribeSync: (() => void) | null = null;
  private syncChain: Promise<void> = Promise.resolve();
  private echoes: EchoStamp[] = [];
  private cardWriteGen = 0;
  private canvasGen = 0;
  private linksGen = 0;
  private saveFloors = new Map<string, number>();
  private detailWrites = 0;
  private inflightReads: DetailRead[] = [];
  private replayQueue: Array<{ id: string; changeAt: string | null }> = [];
  private replayStamp = new Map<string, string>();
  private recoveryInflight = false;
  private detailSerial = 0;
  private appliedSerial = 0;
  private conflictNotifiedAt: string | null = null;
  private goneNotifiedId: string | null = null;
  private selectionJobId: string | null = null;
  private selectionTickInflight = false;
  private selectionWatchdog: ReturnType<typeof setTimeout> | null = null;
  private remoteGone = false;

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

  get assets(): AssetUrlsService {
    return this.resolve(AssetUrlsService);
  }

  get isPdf(): boolean {
    return this.doc?.fileMime === PDF_MIME;
  }

  get isBlank(): boolean {
    if (!this.doc) return true;
    if (!isBlankPmDoc(this.doc.contentJson)) return false;
    if (this.doc.source === 'chat' && this.doc.answer?.trim()) return false;
    return true;
  }

  /** PDF and weekly reports stay read-only. */
  get canEdit(): boolean {
    if (!this.doc || this.isPdf) return false;
    return this.doc.kind !== 'weekly_report';
  }

  get engineDoc() {
    if (!this.doc) return null;
    return enginePmJson(this.draftJson, this.doc, this.editing);
  }

  get bodyDirty(): boolean {
    if (!this.draftJson || !this.lastSavedJson) return false;
    return !jsonEqual(this.draftJson, this.lastSavedJson);
  }

  get titleDirty(): boolean {
    return titlesDiffer(this.draftTitle, this.lastSavedTitle);
  }

  get dirty(): boolean {
    return this.bodyDirty || this.titleDirty;
  }

  get saveLabel(): string {
    if (this.saveState === 'saving') return '保存中…';
    if (this.saveState === 'error' && this.saveError) return this.saveError;
    if (this.saveState === 'saved' && this.savedAt) return `已保存 · ${formatTimeHm(this.savedAt)}`;
    return '';
  }

  showToast(message: string): void {
    this.toastService.show(message);
  }

  setFocused(value: boolean): void {
    this.focused = value;
    if (!value) {
      this.stopPolling();
      void this.flushSave();
    } else {
      this.syncPolling();
    }
  }

  setAppActive(value: boolean): void {
    this.appActive = value;
    if (!value) {
      this.stopPolling();
      this.disarmSelectionLoop();
      return;
    }
    this.syncPolling();
    if (this.selectionPollDocId) this.armSelectionLoop(this.selectionPollDocId);
  }

  setDocGetter(getter: (() => Promise<PmDocJson>) | null): void {
    this.docGetter = getter;
  }

  setEditing(next: boolean): void {
    if (next && !this.canEdit) return;
    this.editing = next;
    if (!next) this.formatState = null;
  }

  noteTitle(title: string): void {
    this.draftTitle = title;
    this.touchSave();
  }

  nextBodyRead(): number {
    this.bodyRead += 1;
    return this.bodyRead;
  }

  markEditorLive(): void {
    this.editorLive = true;
  }

  noteJson(json: PmDocJson, seq?: number): void {
    if (seq != null && seq < this.bodyRead) return;
    this.draftJson = clonePmJson(json);
    if (this.lastSavedJson && jsonEqual(this.draftJson, this.lastSavedJson)) this.editorLive = false;
    this.touchSave();
  }

  noteFormatState(state: FormatState): void {
    this.formatState = state;
  }

  openMore(): void {
    this.sheet = { kind: 'more' };
  }

  openFormatMenu(): void {
    this.sheet = { kind: 'format' };
  }

  openLinkSheet(): void {
    const state = this.formatState;
    this.editingLink = state?.link === true;
    const href = state?.link && typeof state.href === 'string' ? state.href : '';
    this.linkDraft = href;
    this.sheet = { kind: 'link' };
  }

  setLinkDraft(value: string): void {
    this.linkDraft = value;
  }

  openMathSheet(): void {
    this.mathDraft = '';
    this.sheet = { kind: 'math' };
  }

  setMathDraft(value: string): void {
    this.mathDraft = value;
  }

  markEngineReady(): void {
    this.engineReady = true;
    this.contentGen += 1;
  }

  setEngineError(message: string | null): void {
    this.engineError = message;
  }

  closeSheet(): void {
    if (this.sheet?.kind === 'card' && this.sheet.cardId === this.pendingAnchor) {
      this.anchorOpensSheet = false;
    }
    this.sheet = null;
    this.noteDraft = '';
    this.cardQuestion = '';
    this.cardAnswer = '';
    this.cardEditQuestion = '';
    this.cardEditAnswer = '';
    this.rejectDraft = '';
    this.linkDraft = '';
    this.editingLink = false;
    this.mathDraft = '';
    this.canvasText = '';
  }

  get proposedCount(): number {
    return this.doc?.cards.filter((card) => card.acceptance === 'proposed').length ?? 0;
  }

  get canConfirmCards(): boolean {
    return this.doc?.status === 'digested' && this.proposedCount > 0;
  }

  async load(id: string, anchor?: string | null, editRequested = false): Promise<void> {
    this.docError = null;
    this.engineError = null;
    this.pendingAnchor = anchor ?? null;
    this.appliedAnchor = null;
    this.anchorOpensSheet = Boolean(anchor);
    if (this.doc?.id !== id) {
      this.trashed = false;
      this.remoteGone = false;
      this.resetEditor();
      this.doc = null;
      this.annotations = [];
      this.sheet = null;
      this.activeCardId = null;
      this.links = null;
      this.engineReady = false;
      this.pdfUrl = null;
      this.pdfError = null;
      this.pdfSelection = null;
      this.pdfMarquee = false;
      this.pdfJump = null;
      this.canvasNodes = [];
      this.canvasImageUrls = {};
      this.viewMode = 'body';
      this.canvasText = '';
      this.pendingAnnotationId = null;
      this.appliedAnnotationId = null;
      this.canvasGen += 1;
      this.loadGen += 1;
    }
    const gen = this.loadGen;
    const readGen = this.cardWriteGen;
    const floor = this.saveFloors.get(id) ?? null;
    const serial = ++this.detailSerial;
    const reloading = this.doc?.id === id && this.draftJson !== null;
    let detail: DocumentDetail;
    try {
      detail = await getDocument(id);
    } catch (err) {
      if (gen !== this.loadGen) return;
      if (reloading) return;
      this.docError = errorMessage(err, '打不开这份文档');
      this.doc = null;
      return;
    }
    if (gen !== this.loadGen) return;
    const notes = await listDocumentAnnotations(id).catch(() =>
      this.doc?.id === id ? this.annotations : ([] as Annotation[]),
    );
    if (gen !== this.loadGen) return;
    if (this.topics.length === 0) {
      try {
        this.topics = await listTopics('active');
      } catch {
        // The document still opens; the topic picker can stay empty.
      }
    }
    if (gen !== this.loadGen) return;
    const sameDoc = this.doc?.id === detail.id && this.draftJson !== null;
    if (sameDoc) {
      const read: DetailRead = { id, gen: readGen, floor, serial, changeAt: null };
      const mode = classifyRemoteDetail({
        capturedGen: read.gen,
        currentGen: this.cardWriteGen,
        dirty: this.bodyDirty || this.editorLive,
        inflight: this.saveInflight !== null,
        detailUpdatedAtMs: Date.parse(detail.updatedAt),
        floorUpdatedAtMs: read.floor,
      });
      if (mode === 'drop') {
        this.noteDetailDropped(read);
        if (
          this.replayQueue.some((item) => item.id === id) &&
          this.replayQueue.some((item) => item.id !== id)
        ) {
          this.kickReplay();
        }
        return;
      }
      if (serial < this.appliedSerial) return;
      this.appliedSerial = serial;
      this.applyRemoteDetail(detail, notes, mode, null);
      this.syncPolling();
      return;
    }
    if (detail.assetUrls) this.assets.seed(detail.assetUrls, detail.assetUrlsFetchedAt);
    this.doc = detail;
    this.annotations = notes;
    this.seedEditor(detail);
    if (serial >= this.appliedSerial) this.appliedSerial = serial;
    if (this.editRouteFor !== id) {
      this.editRouteFor = id;
      if (editRequested && this.canEdit) this.editing = true;
    }
    this.contentGen += 1;
    this.syncPolling();
    void this.prefetchMedia();
    void this.loadCanvas();
    if (detail.fileMime === PDF_MIME) void this.loadPdf(detail.id, gen);
    else {
      this.pdfUrl = null;
      this.pdfError = null;
      this.pdfSelection = null;
    }
  }

  consumePendingAnchor(): { id: string; openSheet: boolean } | null {
    const cardId = this.pendingAnchor;
    if (!cardId || !this.doc) return null;
    const key = `${this.doc.id}:${cardId}`;
    if (this.appliedAnchor === key) return null;
    if (!this.doc.cards.some((card) => card.id === cardId)) return null;
    const openSheet = this.anchorOpensSheet;
    this.appliedAnchor = key;
    this.pendingAnchor = null;
    this.anchorOpensSheet = false;
    return { id: cardId, openSheet };
  }

  consumePendingAnnotation(): string | null {
    const id = this.pendingAnnotationId;
    if (!id || !this.doc) return null;
    const key = `${this.doc.id}:${id}`;
    if (this.appliedAnnotationId === key) return null;
    if (!this.annotations.some((item) => item.id === id)) return null;
    this.appliedAnnotationId = key;
    this.pendingAnnotationId = null;
    return id;
  }

  openAnchors(cardIds: string[]): void {
    const unique = [...new Set(cardIds.filter(Boolean))];
    this.activeCardId = unique[0] ?? null;
    this.sheet = { kind: 'cards', cardIds: unique };
    for (const id of unique) void this.loadCardImage(id);
  }

  openCard(cardId: string, fromCards?: string[]): void {
    this.activeCardId = cardId;
    this.sheet = { kind: 'card', cardId, fromCards };
    void this.ensureLinks(cardId);
    void this.loadCardImage(cardId);
  }

  backToCards(): void {
    if (this.sheet?.kind === 'card' && this.sheet.fromCards) {
      this.sheet = { kind: 'cards', cardIds: this.sheet.fromCards };
      return;
    }
    this.closeSheet();
  }

  openAnnotations(ids: string[]): void {
    this.sheet = { kind: 'annotations', annotationIds: [...new Set(ids.filter(Boolean))] };
    void this.prefetchMedia();
  }

  openTopicMenu(): void {
    this.sheet = { kind: 'topic' };
  }

  async loadPdf(id = this.doc?.id, gen = this.loadGen): Promise<void> {
    if (!id) return;
    this.pdfError = null;
    try {
      const file = await getDocumentFile(id);
      if (gen !== this.loadGen || this.doc?.id !== id) return;
      this.pdfUrl = file.url;
    } catch (err) {
      if (gen !== this.loadGen || this.doc?.id !== id) return;
      this.pdfUrl = null;
      this.pdfError = errorMessage(err, '打不开这份 PDF');
    }
  }

  setPdfError(message: string | null): void {
    this.pdfError = message;
  }

  setPdfSelection(text: string, pageIndex: number, quads: number[][] = []): void {
    const quote = text.trim();
    if (!quote) {
      this.pdfSelection = null;
      return;
    }
    this.pdfSelection = { text: quote, pageIndex, quads };
  }

  clearPdfSelection(): void {
    this.pdfSelection = null;
  }

  beginPdfAnnotate(): void {
    const selection = this.pdfSelection;
    if (!selection) return;
    this.pdfSelection = null;
    this.noteDraft = '';
    this.sheet = {
      kind: 'annotate',
      anchor: { text: selection.text, blockIndex: 0, from: 0, to: selection.text.length },
      pdfPageIndex: selection.pageIndex,
      pdfQuads: selection.quads,
    };
  }

  beginPdfCard(): void {
    const selection = this.pdfSelection;
    if (!selection) return;
    this.pdfSelection = null;
    this.beginCardForm({
      text: selection.text,
      blockIndex: 0,
      from: 0,
      to: selection.text.length,
    });
  }

  togglePdfMarquee(): void {
    this.pdfMarquee = !this.pdfMarquee;
    if (this.pdfMarquee) this.pdfSelection = null;
  }

  revealPdfPage(pageIndex: number): void {
    if (!Number.isInteger(pageIndex) || pageIndex < 0) return;
    this.viewMode = 'body';
    this.pdfJump = { pageIndex, token: Date.now() };
  }

  jumpToPdfPage(pageIndex: number): void {
    this.revealPdfPage(pageIndex);
    this.closeSheet();
  }

  async savePdfExcerpt(event: Extract<PdfViewerEvent, { type: 'excerpt' }>): Promise<void> {
    if (!this.doc || this.saving) return;
    if (event.byteLength > EXCERPT_MAX_BYTES) {
      this.showToast('截图太大了');
      return;
    }
    const geometry = geometryFromQuads(event.quads, PDF_EXCERPT_COLOR);
    if (!geometry) {
      this.showToast('选区太小了');
      return;
    }
    const dir = FileSystem.cacheDirectory;
    if (!dir) {
      this.showToast('截图没传上去');
      return;
    }
    const documentId = this.doc.id;
    const path = `${dir}excerpt-${Date.now()}.png`;
    this.saving = true;
    let failed = false;
    try {
      await FileSystem.writeAsStringAsync(path, event.base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const presigned = await requestExcerptUpload(documentId, {
        contentType: event.mime,
        sizeBytes: event.byteLength,
      });
      const put = await FileSystem.uploadAsync(presigned.uploadUrl, path, {
        httpMethod: 'PUT',
        headers: { 'Content-Type': event.mime },
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      });
      if (put.status < 200 || put.status >= 300) {
        this.showToast('截图没传上去');
        return;
      }
      await this.withDetailWrite(async () => {
        const created = await createAnnotation({
          documentId,
          quote: IMAGE_EXCERPT_QUOTE,
          note: '',
          kind: 'pdf',
          pageIndex: event.pageIndex,
          geometry,
          imageKey: presigned.key,
        });
        this.cardWriteGen += 1;
        this.canvasGen += 1;
        if (this.doc?.id === documentId) {
          this.annotations = [...this.annotations.filter((item) => item.id !== created.id), created];
          this.entityGen += 1;
        }
        this.echoDocumentRow(created.documentId, created.updatedAt);
      });
      void this.prefetchMedia();
      this.pdfMarquee = false;
      this.showToast('已摘录');
    } catch (err) {
      failed = true;
      this.showToast(errorMessage(err, '没摘下这块'));
    } finally {
      this.saving = false;
      await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
    }
    if (failed) return;
  }

  showBody(): void {
    this.viewMode = 'body';
  }

  showMap(): void {
    this.viewMode = 'map';
    // The prose engine unmounts with the map. The next ready event must push and focus.
    this.engineReady = false;
    void this.loadCanvas();
    void this.prefetchMedia();
  }

  openCanvasCards(): void {
    const ids = this.doc?.cards.filter((card) => card.acceptance !== 'rejected').map((card) => card.id) ?? [];
    this.openAnchors(ids);
  }

  get forest() {
    const cardIds = this.doc?.cards.filter((card) => card.acceptance !== 'rejected').map((card) => card.id) ?? [];
    const annotationIds = this.annotations.map((item) => item.id);
    return documentForest(cardIds, annotationIds, this.canvasNodes);
  }

  get mapRows(): ForestRow[] {
    return forestRows(this.forest);
  }

  canvasTitle(id: string): { kicker: string; title: string; imageKey: string | null } {
    const member = this.forest.find((item) => item.id === id);
    if (!member) return { kicker: '节点', title: '节点', imageKey: null };
    if (member.kind === 'card') {
      const card = this.doc?.cards.find((item) => item.id === id);
      const title = card?.concept.trim() || card?.anchorText?.trim() || '卡片';
      return { kicker: '卡片', title, imageKey: null };
    }
    if (member.kind === 'annotation') {
      const note = this.annotations.find((item) => item.id === id);
      if (note?.kind === 'note') {
        return {
          kicker: '想法',
          title: note.note.trim() || '想法',
          imageKey: note.imageKey,
        };
      }
      const raw = note?.quote.trim() || '批注';
      const title = raw === IMAGE_EXCERPT_QUOTE ? '图片摘录' : raw;
      const kicker = note?.kind === 'pdf' ? `PDF ${(note.pageIndex ?? 0) + 1}` : '批注';
      return { kicker, title, imageKey: note?.imageKey ?? null };
    }
    const node = this.canvasNodes.find((item) => item.id === id);
    if (member.kind === 'text') return { kicker: '文本', title: node?.text?.trim() || '文本', imageKey: null };
    return { kicker: '图片', title: '图片', imageKey: node?.imageKey ?? null };
  }

  canvasImageUrl(imageKey: string | null): string | null {
    if (!imageKey) return null;
    return this.canvasImageUrls[imageKey] ?? this.assets.urlFor(asAssetSrc(imageKey));
  }

  canvasParents(nodeId: string): Array<{ id: string; title: string }> {
    return this.mapRows
      .filter((row) => row.id !== nodeId)
      .map((row) => ({ id: row.id, title: this.canvasTitle(row.id).title }));
  }

  openForestNode(id: string): void {
    const member = this.forest.find((item) => item.id === id);
    if (!member) return;
    const note =
      member.kind === 'annotation'
        ? (this.annotations.find((item) => item.id === id) ?? null)
        : null;
    const plan = planForestOpen(
      member.kind,
      id,
      note ? { kind: note.kind, pageIndex: note.pageIndex } : null,
      this.isPdf,
    );
    if (plan.type === 'card') {
      this.showBody();
      this.pendingAnnotationId = null;
      this.pendingAnchor = plan.cardId;
      this.appliedAnchor = null;
      this.anchorOpensSheet = plan.reopenSheet;
      this.openCard(plan.cardId);
      return;
    }
    if (plan.type === 'annotation') {
      this.showBody();
      this.pendingAnchor = null;
      this.anchorOpensSheet = false;
      this.openAnnotations([plan.annotationId]);
      if (plan.pageIndex != null) {
        this.revealPdfPage(plan.pageIndex);
        return;
      }
      this.pendingAnnotationId = plan.annotationId;
      this.appliedAnnotationId = null;
      return;
    }
    if (plan.type === 'text') {
      this.beginEditCanvasText(plan.nodeId);
      return;
    }
    this.openCanvasActions(plan.nodeId);
  }

  openCanvasActions(nodeId: string): void {
    if (!this.forest.some((item) => item.id === nodeId)) return;
    this.sheet = { kind: 'canvas-actions', nodeId };
  }

  openCanvasParent(nodeId: string): void {
    if (!this.forest.some((item) => item.id === nodeId)) return;
    this.sheet = { kind: 'canvas-parent', nodeId };
  }

  beginCanvasText(parentId: string | null): void {
    this.canvasText = '';
    this.sheet = { kind: 'canvas-text', mode: 'create', nodeId: null, parentId };
  }

  beginEditCanvasText(nodeId: string): void {
    const node = this.canvasNodes.find((item) => item.id === nodeId);
    this.canvasText = node?.text ?? '';
    this.sheet = { kind: 'canvas-text', mode: 'edit', nodeId, parentId: node?.parentId ?? null };
  }

  setCanvasText(value: string): void {
    this.canvasText = value.slice(0, 4000);
  }

  async reparentCanvas(nodeId: string, parentId: string | null): Promise<void> {
    if (!this.doc || this.saving) return;
    const plan = planReparent(this.forest, nodeId, parentId);
    if (!plan.ok) {
      this.showToast(reparentError(plan.reason));
      return;
    }
    if (plan.unchanged) {
      this.closeSheet();
      return;
    }
    const documentId = this.doc.id;
    this.saving = true;
    this.canvasGen += 1;
    let failed = false;
    try {
      await this.withDetailWrite(async () => {
        const updated = await updateCanvasNode(documentId, nodeId, { parentId: plan.parentId });
        this.cardWriteGen += 1;
        this.upsertCanvasNode(updated);
      });
      this.showToast(parentId ? '已挂到这个节点下' : '已独立成树');
      this.closeSheet();
    } catch (err) {
      failed = true;
      this.showToast(errorMessage(err, '没移成'));
    } finally {
      this.canvasGen += 1;
      this.saving = false;
    }
    if (failed) void this.loadCanvas();
  }

  async saveCanvasText(): Promise<boolean> {
    const sheet = this.sheet;
    if (!this.doc || sheet?.kind !== 'canvas-text' || this.saving) return false;
    const text = this.canvasText.trim();
    if (!text) {
      this.showToast('写点文字');
      return false;
    }
    const documentId = this.doc.id;
    this.saving = true;
    this.canvasGen += 1;
    try {
      await this.withDetailWrite(async () => {
        if (sheet.mode === 'edit' && sheet.nodeId) {
          const updated = await updateCanvasNode(documentId, sheet.nodeId, { text });
          this.cardWriteGen += 1;
          this.upsertCanvasNode(updated);
          return;
        }
        // 新文本节点 = note 批注 + 落位（批注是痕迹层，画布只负责摆放）。
        const created = await createAnnotation({
          documentId,
          kind: 'note',
          note: text,
        });
        this.cardWriteGen += 1;
        this.canvasGen += 1;
        if (this.doc?.id === documentId) {
          this.annotations = [...this.annotations.filter((item) => item.id !== created.id), created];
          this.entityGen += 1;
        }
        this.echoDocumentRow(created.documentId, created.updatedAt);
        // 无父节点也落一条 canvas 根行（与 web 一致），不靠 mergeCanvasForest 兜底。
        const placed = await updateCanvasNode(documentId, created.id, {
          parentId: sheet.parentId,
        });
        this.upsertCanvasNode(placed);
      });
      this.showToast(sheet.mode === 'edit' ? '已改好' : '已加上');
      this.closeSheet();
      return true;
    } catch (err) {
      this.showToast(errorMessage(err, '没写上'));
      return false;
    } finally {
      this.canvasGen += 1;
      this.saving = false;
    }
  }

  async addCanvasImage(
    asset: { uri: string; mimeType?: string | null; fileSize?: number | null },
    parentId: string | null,
  ): Promise<void> {
    const src = await this.uploadEditorImage(asset);
    if (!src || !this.doc) return;
    const imageKey = imageKeyFromAssetSrc(src);
    if (!imageKey) {
      this.showToast('图片没加上');
      return;
    }
    const documentId = this.doc.id;
    this.canvasGen += 1;
    try {
      await this.withDetailWrite(async () => {
        // 新图片节点 = 纯图片 note 批注 + 落位。
        const created = await createAnnotation({
          documentId,
          kind: 'note',
          imageKey,
        });
        this.cardWriteGen += 1;
        this.canvasGen += 1;
        if (this.doc?.id === documentId) {
          this.annotations = [...this.annotations.filter((item) => item.id !== created.id), created];
          this.entityGen += 1;
        }
        this.echoDocumentRow(created.documentId, created.updatedAt);
        // 无父节点也落一条 canvas 根行（与 web 一致），不靠 mergeCanvasForest 兜底。
        const placed = await updateCanvasNode(documentId, created.id, { parentId });
        this.upsertCanvasNode(placed);
      });
      void this.ensureCanvasImages();
      this.showToast('已加上图片');
    } catch (err) {
      this.showToast(errorMessage(err, '图片没加上'));
    } finally {
      this.canvasGen += 1;
    }
  }

  async removeCanvasNode(nodeId: string): Promise<void> {
    if (!this.doc || this.saving) return;
    const member = this.forest.find((item) => item.id === nodeId);
    if (!member || (member.kind !== 'text' && member.kind !== 'image')) return;
    const documentId = this.doc.id;
    this.closeSheet();
    const ok = await confirmAction('删除这个节点？', '它下面的节点会各自独立成树。', '删除', true);
    if (!ok || this.doc?.id !== documentId) return;
    this.canvasGen += 1;
    this.cardWriteGen += 1;
    this.canvasNodes = nodesAfterMemberLeaves(this.canvasNodes, this.forest, nodeId, documentId, false);
    let failed = false;
    try {
      await this.withDetailWrite(async () => {
        await deleteCanvasNode(documentId, nodeId);
      });
    } catch (err) {
      failed = true;
      this.showToast(errorMessage(err, '没删掉'));
    } finally {
      this.canvasGen += 1;
    }
    if (failed) void this.loadCanvas();
  }

  async loadCanvas(): Promise<void> {
    const id = this.doc?.id;
    if (!id) return;
    const ticket = ++this.canvasGen;
    try {
      const nodes = await listCanvasNodes(id);
      if (ticket !== this.canvasGen || this.doc?.id !== id || this.detailWrites > 0) return;
      this.canvasNodes = nodes;
      void this.ensureCanvasImages();
    } catch {
      // Keep the forest already on screen.
    }
  }

  beginAnnotate(anchor: TextSelectionAnchor): void {
    this.noteDraft = '';
    this.sheet = { kind: 'annotate', anchor };
  }

  beginCardForm(anchor: TextSelectionAnchor): void {
    this.cardQuestion = clipChars(anchor.text, 2000);
    this.cardAnswer = '';
    this.sheet = { kind: 'card-form', anchor };
  }

  setNoteDraft(value: string): void {
    this.noteDraft = value;
  }

  setCardQuestion(value: string): void {
    this.cardQuestion = value;
  }

  setCardAnswer(value: string): void {
    this.cardAnswer = value;
  }

  beginReject(cardId: string): void {
    if (this.doc?.status !== 'digested' || this.deciding) return;
    const fromCards = this.sheet?.kind === 'card' ? this.sheet.fromCards : undefined;
    this.rejectDraft = '';
    this.sheet = { kind: 'reject', cardId, fromCards };
  }

  setRejectDraft(value: string): void {
    this.rejectDraft = clipReason(value);
  }

  cancelReject(): void {
    if (this.deciding) return;
    if (this.sheet?.kind !== 'reject') {
      this.closeSheet();
      return;
    }
    const { cardId, fromCards } = this.sheet;
    this.rejectDraft = '';
    this.openCard(cardId, fromCards);
  }

  cardsForSheet(): DocumentCard[] {
    if (!this.doc || this.sheet?.kind !== 'cards') return [];
    const want = new Set(this.sheet.cardIds);
    const proposed: DocumentCard[] = [];
    const rest: DocumentCard[] = [];
    for (const card of this.doc.cards) {
      if (!want.has(card.id) || card.acceptance === 'rejected') continue;
      if (card.acceptance === 'proposed') proposed.push(card);
      else rest.push(card);
    }
    return [...proposed, ...rest];
  }

  annotationsForSheet(): Annotation[] {
    if (this.sheet?.kind !== 'annotations') return [];
    const want = new Set(this.sheet.annotationIds);
    const matched = this.annotations.filter((item) => want.has(item.id));
    return matched.length > 0 ? matched : this.annotations;
  }

  activeCard(): DocumentCard | null {
    if (!this.doc || this.sheet?.kind !== 'card') return null;
    const cardId = this.sheet.cardId;
    return this.doc.cards.find((card) => card.id === cardId) ?? null;
  }

  cardImageUrl(id: string): string | null {
    return livePresignedUrl(this.cardImageUrls[id]);
  }

  annotationImageUrl(id: string): string | null {
    return this.annotationImageUrls[id] ?? null;
  }

  async loadCardImage(id: string, force = false): Promise<void> {
    const existing = this.cardImageUrls[id];
    if (!force && existing && livePresignedUrl(existing)) return;
    try {
      const { url } = await getCardImage(id);
      this.cardImageUrls = { ...this.cardImageUrls, [id]: { url, fetchedAt: Date.now() } };
    } catch {
      this.cardImageUrls = { ...this.cardImageUrls, [id]: { url: '', fetchedAt: Date.now() } };
    }
  }

  retryCardImage(id: string): void {
    if (!shouldRetryPresign(this.cardImageUrls[id])) return;
    void this.loadCardImage(id, true);
  }

  async prefetchMedia(): Promise<void> {
    const cards = this.doc?.cards.filter((card) => card.hasImage) ?? [];
    for (const card of cards) void this.loadCardImage(card.id);
    const notes = this.annotations.filter((item) => item.imageKey);
    const srcs = notes
      .map((item) => item.imageKey)
      .filter((key): key is string => Boolean(key))
      .map(asAssetSrc);
    if (srcs.length > 0) {
      await this.assets.ensure(srcs);
      const next = { ...this.annotationImageUrls };
      for (const item of notes) {
        if (!item.imageKey) continue;
        const src = asAssetSrc(item.imageKey);
        next[item.id] = this.assets.urlFor(src);
      }
      this.annotationImageUrls = next;
    }
    for (const item of notes) {
      if (this.annotationImageUrls[item.id]) continue;
      try {
        const { url } = await getAnnotationImage(item.id);
        this.annotationImageUrls = { ...this.annotationImageUrls, [item.id]: url };
      } catch {
        this.annotationImageUrls = { ...this.annotationImageUrls, [item.id]: null };
      }
    }
  }

  async ensureLinks(cardId: string): Promise<void> {
    const gen = this.linksGen;
    const cached = this.linksCache[cardId];
    if (cached) {
      if (gen !== this.linksGen) return;
      this.links = cached;
      return;
    }
    this.links = null;
    try {
      const data = await getCardLinks(cardId);
      if (gen !== this.linksGen) return;
      this.linksCache = { ...this.linksCache, [cardId]: data };
      if (this.sheet?.kind === 'card' && this.sheet.cardId === cardId) this.links = data;
    } catch {
      if (gen !== this.linksGen) return;
      if (this.sheet?.kind === 'card' && this.sheet.cardId === cardId) {
        this.links = { outgoing: [], incoming: [] };
      }
    }
  }

  async openStandaloneCard(cardId: string): Promise<void> {
    try {
      const detail = await getCard(cardId);
      if (detail.documentId) {
        await this.load(detail.documentId, cardId);
        this.openCard(cardId);
        return;
      }
      this.showToast('这张卡没有所属文档');
    } catch (err) {
      this.showToast(errorMessage(err, '打不开这张卡'));
    }
  }

  private applyCard(detail: CardDetail): void {
    if (!this.doc) return;
    const { documentTitle: _documentTitle, ...card } = detail;
    if (card.acceptance === 'rejected') {
      this.removeCard(card.id);
      return;
    }
    const have = this.doc.cards.some((item) => item.id === card.id);
    this.doc = {
      ...this.doc,
      cards: have
        ? this.doc.cards.map((item) => (item.id === card.id ? card : item))
        : [...this.doc.cards, card],
    };
  }

  private detachCanvasMember(id: string, keepRow: boolean): void {
    if (!this.doc) return;
    this.canvasGen += 1;
    this.canvasNodes = nodesAfterMemberLeaves(this.canvasNodes, this.forest, id, this.doc.id, keepRow);
  }

  private upsertCanvasNode(node: CanvasNode): void {
    const index = this.canvasNodes.findIndex((item) => item.id === node.id);
    if (index < 0) {
      this.canvasNodes = [...this.canvasNodes, node];
      return;
    }
    const next = this.canvasNodes.slice();
    next[index] = node;
    this.canvasNodes = next;
  }

  private async ensureCanvasImages(): Promise<void> {
    const keys = [
      ...new Set(
        this.canvasNodes.map((node) => node.imageKey).filter((key): key is string => Boolean(key)),
      ),
    ];
    if (keys.length === 0) return;
    await this.assets.ensure(keys.map(asAssetSrc));
    if (this.closed) return;
    const next = { ...this.canvasImageUrls };
    for (const key of keys) next[key] = this.assets.urlFor(asAssetSrc(key));
    this.canvasImageUrls = next;
  }

  private removeCard(id: string): void {
    if (!this.doc) return;
    this.detachCanvasMember(id, true);
    this.doc = { ...this.doc, cards: this.doc.cards.filter((card) => card.id !== id) };
    this.entityGen += 1;
    if (this.activeCardId === id) this.activeCardId = null;
    if (this.sheet?.kind === 'cards') {
      const cardIds = this.sheet.cardIds.filter((cardId) => cardId !== id);
      this.sheet = cardIds.length > 0 ? { kind: 'cards', cardIds } : null;
      return;
    }
    if (this.sheet?.kind === 'card' && this.sheet.cardId === id) {
      const fromCards = this.sheet.fromCards?.filter((cardId) => cardId !== id);
      this.sheet = fromCards && fromCards.length > 0 ? { kind: 'cards', cardIds: fromCards } : null;
      return;
    }
    if (this.sheet?.kind === 'reject' && this.sheet.cardId === id) {
      const fromCards = this.sheet.fromCards?.filter((cardId) => cardId !== id);
      this.rejectDraft = '';
      this.sheet = fromCards && fromCards.length > 0 ? { kind: 'cards', cardIds: fromCards } : null;
      return;
    }
    if (this.sheet?.kind === 'card-edit' && this.sheet.cardId === id) {
      const fromCards = this.sheet.fromCards?.filter((cardId) => cardId !== id);
      this.cardEditQuestion = '';
      this.cardEditAnswer = '';
      this.sheet = fromCards && fromCards.length > 0 ? { kind: 'cards', cardIds: fromCards } : null;
    }
  }

  async acceptOneCard(id: string): Promise<void> {
    if (this.deciding || this.doc?.status !== 'digested') return;
    this.deciding = true;
    try {
      await this.withDetailWrite(async () => {
        const detail = await acceptCard(id);
        this.cardWriteGen += 1;
        this.applyCard(detail);
        this.echoDocumentRow(detail.documentId, detail.updatedAt);
      });
      this.showToast('已确认，会安排复习');
    } catch (err) {
      this.showToast(decisionError(err, 'accept'));
    } finally {
      this.deciding = false;
    }
  }

  async submitReject(): Promise<void> {
    if (this.deciding || this.sheet?.kind !== 'reject' || this.doc?.status !== 'digested') return;
    const { cardId } = this.sheet;
    const trimmed = clipReason(this.rejectDraft.trim());
    this.deciding = true;
    try {
      await this.withDetailWrite(async () => {
        const detail = await rejectCard(cardId, trimmed ? { reason: trimmed } : {});
        this.cardWriteGen += 1;
        this.applyCard(detail);
        this.echoDocumentRow(detail.documentId, detail.updatedAt);
      });
      this.showToast('不会进入复习');
    } catch (err) {
      this.showToast(decisionError(err, 'reject'));
    } finally {
      this.deciding = false;
    }
  }

  async acceptAllProposed(): Promise<void> {
    if (!this.doc || this.doc.status !== 'digested' || this.deciding || this.proposedCount === 0) return;
    const ok = await confirmAction('全部确认', '这篇里待确认的卡片会进入复习。', '全部确认');
    if (!ok || !this.doc || this.deciding) return;
    const documentId = this.doc.id;
    this.deciding = true;
    try {
      const result = await this.withDetailWrite(async () => {
        const accepted = await acceptProposedCards(documentId);
        this.cardWriteGen += 1;
        const acceptedIds = new Set(accepted.acceptedIds);
        if (this.doc?.id === documentId) {
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
        }
        await this.refresh();
        return accepted;
      });
      const acceptedIds = new Set(result.acceptedIds);
      const accepted = acceptedIds.size;
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
      this.deciding = false;
    }
  }

  async saveAnnotation(): Promise<boolean> {
    if (!this.doc || this.sheet?.kind !== 'annotate' || this.saving) return false;
    const quote = clipChars(this.sheet.anchor.text.trim(), 20_000);
    if (!quote) return false;
    const pdfPageIndex = this.sheet.pdfPageIndex;
    const pdfGeometry =
      pdfPageIndex != null ? geometryFromQuads(this.sheet.pdfQuads ?? [], PDF_HIGHLIGHT_COLOR) : null;
    if (pdfPageIndex != null && !pdfGeometry) {
      this.showToast('选区没有位置，没法高亮');
      return false;
    }
    const blockIndex = this.sheet.anchor.blockIndex;
    const documentId = this.doc.id;
    const note = this.noteDraft.trim();
    this.saving = true;
    try {
      await this.withDetailWrite(async () => {
        const created = await createAnnotation({
          documentId,
          quote,
          note,
          ...(pdfGeometry
            ? { kind: 'pdf' as const, pageIndex: pdfPageIndex, geometry: pdfGeometry }
            : blockIndex > 0
              ? { anchorBlockIndex: blockIndex }
              : {}),
        });
        this.cardWriteGen += 1;
        if (this.doc?.id === documentId) {
          this.annotations = [...this.annotations.filter((item) => item.id !== created.id), created];
          this.entityGen += 1;
        }
        this.echoDocumentRow(created.documentId, created.updatedAt);
      });
      this.showToast('已记下');
      this.closeSheet();
      return true;
    } catch (err) {
      this.showToast(errorMessage(err, '没记下这条批注'));
      return false;
    } finally {
      this.saving = false;
    }
  }

  async saveManualCard(): Promise<boolean> {
    if (!this.doc || this.sheet?.kind !== 'card-form' || this.saving) return false;
    const concept = clipChars(this.cardQuestion.trim(), 2000);
    if (!concept) return false;
    const documentId = this.doc.id;
    const example = clipChars(this.cardAnswer.trim(), 4000);
    const anchorText = clipChars(this.sheet.anchor.text, 4000);
    const blockIndex = this.sheet.anchor.blockIndex;
    this.saving = true;
    try {
      await this.withDetailWrite(async () => {
        const card = await createCard({
          documentId,
          concept,
          example,
          anchorText,
          ...(blockIndex > 0 ? { anchorBlockIndex: blockIndex } : {}),
        });
        this.cardWriteGen += 1;
        if (this.doc?.id === documentId) {
          const next = { ...card, questions: [], review: null };
          const have = this.doc.cards.some((item) => item.id === card.id);
          this.doc = {
            ...this.doc,
            cards: have
              ? this.doc.cards.map((item) => (item.id === card.id ? next : item))
              : [...this.doc.cards, next],
          };
          this.entityGen += 1;
        }
        const pulled = await this.refresh();
        if (pulled) this.echoDocumentRow(card.documentId, card.updatedAt);
      });
      this.showToast('已加入复习队列');
      this.closeSheet();
      return true;
    } catch (err) {
      this.showToast(errorMessage(err, '没写成卡片'));
      return false;
    } finally {
      this.saving = false;
    }
  }

  async queueDigest(anchor: TextSelectionAnchor): Promise<void> {
    if (!this.doc) return;
    const clipped = clipChars(anchor.text.trim(), 100_000);
    if (!clipped || !Number.isFinite(anchor.blockIndex) || anchor.blockIndex < 1) {
      this.showToast('选区没法排队');
      return;
    }
    const documentId = this.doc.id;
    this.selectionDigesting = true;
    this.selectionPollDocId = documentId;
    this.selectionCardCountAtStart = this.doc.cards.length;
    this.selectionPollUntil = Date.now() + SELECTION_POLL_FOR_MS;
    try {
      const job = await enqueueSelectionCards(documentId, { text: clipped, blockIndex: anchor.blockIndex });
      this.selectionJobId = job.id;
      this.showToast('已排队，消化完成后出现');
      this.startSelectionPoll(documentId);
    } catch (err) {
      this.finishSelectionPoll();
      this.showToast(errorMessage(err, '没排上队'));
    }
  }

  startSelectionPoll(documentId: string): void {
    this.stopSelectionTick();
    const deadline = this.selectionPollUntil;
    this.selectionWatchdog = setTimeout(() => {
      this.selectionWatchdog = null;
      if (this.selectionPollUntil === deadline) this.finishSelectionPoll();
    }, SELECTION_POLL_FOR_MS + 400);
    this.armSelectionLoop(documentId);
  }

  private armSelectionLoop(documentId: string): void {
    if (this.syncActive() || !this.appActive) return;
    if (this.selectionTickTimer !== null || this.selectionTickInflight) return;
    if (!this.selectionDigesting || this.selectionPollDocId !== documentId) return;
    const startCount = this.selectionCardCountAtStart;
    const tick = async () => {
      this.selectionTickTimer = null;
      this.selectionTickInflight = true;
      try {
        if (!this.appActive || !this.selectionDigesting || this.selectionPollDocId !== documentId) return;
        await this.refresh();
        if (!this.selectionDigesting || this.selectionPollDocId !== documentId) return;
        if (this.syncActive()) return;
        const grown = this.doc?.id === documentId && this.doc.cards.length > startCount;
        const timedOut = Date.now() >= this.selectionPollUntil;
        if (grown || timedOut) this.finishSelectionPoll();
      } finally {
        this.selectionTickInflight = false;
      }
      if (!this.selectionDigesting || this.selectionPollDocId !== documentId) return;
      if (!this.appActive || this.syncActive() || this.selectionTickTimer !== null) return;
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

  async setDocTopic(topicId: string | null): Promise<void> {
    if (!this.doc) return;
    const id = this.doc.id;
    this.closeSheet();
    try {
      await this.withDetailWrite(async () => {
        this.cardWriteGen += 1;
        const updated = await updateDocument(id, { topicId });
        const floorMs = Date.parse(updated.updatedAt);
        if (!Number.isNaN(floorMs)) this.saveFloors.set(id, floorMs);
        if (this.doc?.id === id) {
          const topicTitle = this.topics.find((topic) => topic.id === updated.topicId)?.title ?? null;
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
        }
        this.echoDocumentRow(id, updated.updatedAt);
      });
    } catch (err) {
      this.showToast(errorMessage(err, '没换上主题'));
    }
  }

  async retry(): Promise<void> {
    if (!this.doc) return;
    try {
      await retryDocument(this.doc.id);
      await this.refresh();
      this.syncPolling();
    } catch (err) {
      this.showToast(errorMessage(err, '没重试上'));
    }
  }

  async refresh(): Promise<boolean> {
    if (!this.doc) return false;
    return this.pullDetail(this.doc.id, null, false);
  }

  stopPolling(): void {
    if (this.pollTimer === null) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  syncPolling(): void {
    if (this.syncActive()) {
      this.stopPolling();
      return;
    }
    if (this.doc?.status === 'pending' && this.focused && this.appActive) this.startPolling();
    else this.stopPolling();
  }

  startPolling(): void {
    if (this.syncActive() || !this.appActive || !this.focused) return;
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => {
      void this.tickPending();
    }, POLL_MS);
  }

  async tickPending(): Promise<void> {
    if (!this.focused || !this.appActive || this.doc?.status !== 'pending') {
      this.stopPolling();
      return;
    }
    await this.refresh();
    this.syncPolling();
  }

  override destroy(): void {
    this.closed = true;
    this.unsubscribeSync?.();
    this.unsubscribeSync = null;
    this.sync = null;
    this.clearSaveTimer();
    this.stopPolling();
    this.finishSelectionPoll();
    super.destroy();
  }

  async flushSave(): Promise<void> {
    if (this.trashed || this.remoteGone) return;
    this.clearSaveTimer();
    await this.save(true);
  }

  async trashDocument(): Promise<boolean> {
    if (!this.doc || this.isPdf || this.trashing) return false;
    const id = this.doc.id;
    this.closeSheet();
    const ok = await confirmAction(
      '移入回收站',
      '30 天内可以在「我的 → 回收站」恢复。',
      '移入回收站',
      true,
    );
    if (!ok || this.doc?.id !== id) return false;
    this.trashing = true;
    try {
      await deleteDocument(id);
      this.trashed = true;
      this.clearSaveTimer();
      this.editing = false;
      this.showToast('已移入回收站');
      return true;
    } catch (err) {
      this.showToast(errorMessage(err, '没移入回收站'));
      return false;
    } finally {
      this.trashing = false;
    }
  }

  async uploadEditorImage(asset: {
    uri: string;
    mimeType?: string | null;
    fileSize?: number | null;
  }): Promise<string | null> {
    if (this.uploadingImage) return null;
    const contentType = imageMime(asset.uri, asset.mimeType);
    if (!contentType) {
      this.showToast('请换成 JPG、PNG、WebP 或 GIF');
      return null;
    }
    let sizeBytes = asset.fileSize ?? 0;
    if (sizeBytes <= 0) {
      try {
        const info = await FileSystem.getInfoAsync(asset.uri);
        if (!info.exists || info.isDirectory) {
          this.showToast('图片没传上');
          return null;
        }
        sizeBytes = info.size;
      } catch {
        this.showToast('图片没传上');
        return null;
      }
    }
    if (sizeBytes > ASSET_IMAGE_MAX_BYTES) {
      this.showToast('图片太大了');
      return null;
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      this.showToast('图片没传上');
      return null;
    }
    this.uploadingImage = true;
    try {
      const presigned = await presignAsset({ kind: 'image', contentType, sizeBytes });
      const put = await FileSystem.uploadAsync(presigned.uploadUrl, asset.uri, {
        httpMethod: 'PUT',
        headers: { 'Content-Type': contentType },
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      });
      if (put.status < 200 || put.status >= 300) {
        this.showToast('图片没传上');
        return null;
      }
      return presigned.assetSrc;
    } catch {
      this.showToast('图片没传上');
      return null;
    } finally {
      this.uploadingImage = false;
    }
  }

  beginCardEdit(cardId: string): void {
    const card = this.doc?.cards.find((item) => item.id === cardId);
    if (!card || card.acceptance === 'proposed') return;
    const question = card.questions[0];
    this.cardEditQuestion = question?.question ?? card.concept;
    this.cardEditAnswer = question?.answer ?? card.example;
    const fromCards = this.sheet?.kind === 'card' ? this.sheet.fromCards : undefined;
    this.sheet = { kind: 'card-edit', cardId, fromCards };
  }

  setCardEditQuestion(value: string): void {
    this.cardEditQuestion = value;
  }

  setCardEditAnswer(value: string): void {
    this.cardEditAnswer = value;
  }

  closeCardEdit(): void {
    if (this.sheet?.kind !== 'card-edit') {
      this.closeSheet();
      return;
    }
    const { cardId, fromCards } = this.sheet;
    this.cardEditQuestion = '';
    this.cardEditAnswer = '';
    this.sheet = { kind: 'card', cardId, fromCards };
  }

  async saveCardEdit(): Promise<boolean> {
    const editing = this.sheet;
    if (editing?.kind !== 'card-edit' || this.cardBusy || !this.doc) return false;
    const card = this.doc.cards.find((item) => item.id === editing.cardId);
    if (!card) return false;
    const ask = clipChars(this.cardEditQuestion.trim(), 2000);
    const answer = clipChars(this.cardEditAnswer.trim(), 4000);
    if (!ask || !answer) {
      this.showToast('没改上');
      return false;
    }
    const existing = card.questions[0];
    // cardQuestionTypeSchema is cloze | compare | judge — there is no qa.
    const input: UpdateCardInput = {
      concept: ask,
      example: answer,
      questions: [
        {
          ...(existing?.id ? { id: existing.id } : {}),
          type: existing?.type ?? 'cloze',
          question: ask,
          answer,
        },
      ],
    };
    const fromCards = editing.fromCards;
    this.cardBusy = true;
    try {
      await this.withDetailWrite(async () => {
        const detail = await updateCard(card.id, input);
        this.cardWriteGen += 1;
        this.applyCard(detail);
        this.entityGen += 1;
        this.echoDocumentRow(detail.documentId, detail.updatedAt);
      });
      this.showToast('已保存');
      const stillThere = this.doc?.cards.some((item) => item.id === card.id) ?? false;
      this.cardEditQuestion = '';
      this.cardEditAnswer = '';
      if (stillThere) this.sheet = { kind: 'card', cardId: card.id, fromCards };
      return true;
    } catch (err) {
      this.showToast(errorMessage(err, '没改上'));
      return false;
    } finally {
      this.cardBusy = false;
    }
  }

  async archiveDocCard(id: string): Promise<void> {
    if (this.cardBusy) return;
    const sheet = this.sheet;
    const fromCards =
      sheet?.kind === 'card' || sheet?.kind === 'card-edit' ? sheet.fromCards : undefined;
    this.closeSheet();
    const ok = await confirmAction('移入回收站', '移入后可在设置里恢复。', '移入回收站', true);
    if (!ok) {
      if (this.doc?.cards.some((card) => card.id === id)) this.openCard(id, fromCards);
      return;
    }
    this.cardBusy = true;
    try {
      await this.withDetailWrite(async () => {
        await archiveCard(id);
        this.cardWriteGen += 1;
        this.removeCard(id);
      });
      this.showToast('已移入回收站，可在设置里恢复');
    } catch (err) {
      this.showToast(errorMessage(err, '没删掉'));
    } finally {
      this.cardBusy = false;
    }
  }

  async toggleCardSuspended(cardId: string): Promise<void> {
    const card = this.doc?.cards.find((item) => item.id === cardId);
    if (!card?.review || this.cardBusy) return;
    const suspended = card.review.suspendedAt != null;
    this.cardBusy = true;
    try {
      await this.withDetailWrite(async () => {
        const state = suspended ? await resumeCard(card.id) : await suspendCard(card.id);
        this.cardWriteGen += 1;
        if (this.doc) {
          this.doc = {
            ...this.doc,
            cards: this.doc.cards.map((item) =>
              item.id === card.id
                ? {
                    ...item,
                    review: {
                      dueAt: state.dueAt,
                      intervalDays: state.intervalDays,
                      suspendedAt: state.suspendedAt,
                    },
                  }
                : item,
            ),
          };
        }
        this.echoDocumentRow(card.documentId, state.updatedAt);
      });
      this.showToast(suspended ? '已恢复复习' : '已标记为熟悉，不再安排复习');
    } catch (err) {
      this.showToast(errorMessage(err, '操作没成功'));
    } finally {
      this.cardBusy = false;
    }
  }

  async saveAnnotationNote(id: string, note: string): Promise<boolean> {
    if (this.saving) return false;
    this.saving = true;
    try {
      await this.withDetailWrite(async () => {
        const updated = await updateAnnotation(id, { note: note.slice(0, 20_000) });
        this.cardWriteGen += 1;
        this.annotations = this.annotations.map((item) => (item.id === id ? updated : item));
        this.echoDocumentRow(updated.documentId, updated.updatedAt);
      });
      this.showToast('已记下');
      return true;
    } catch (err) {
      this.showToast(errorMessage(err, '没改上'));
      return false;
    } finally {
      this.saving = false;
    }
  }

  async deleteAnnotationNote(id: string): Promise<void> {
    const annotationIds = this.sheet?.kind === 'annotations' ? this.sheet.annotationIds : [id];
    this.closeSheet();
    const ok = await confirmAction('删除这条批注？', '删除后可在设置里恢复。', '删除', true);
    if (!ok) {
      this.sheet = { kind: 'annotations', annotationIds };
      return;
    }
    try {
      await this.withDetailWrite(async () => {
        await deleteAnnotation(id);
        this.cardWriteGen += 1;
        this.detachCanvasMember(id, true);
        this.annotations = this.annotations.filter((item) => item.id !== id);
      });
      if (this.sheet?.kind === 'annotations') {
        const annotationIds = this.sheet.annotationIds.filter((item) => item !== id);
        this.sheet = annotationIds.length > 0 ? { kind: 'annotations', annotationIds } : null;
      }
      this.entityGen += 1;
      this.showToast('已移入回收站，可在设置里恢复');
    } catch (err) {
      this.showToast(errorMessage(err, '没删掉'));
    }
  }

  private seedEditor(doc: DocumentDetail): void {
    const shown = displayedPmJson(doc);
    this.draftTitle = doc.title ?? '';
    this.lastSavedTitle = doc.title ?? '';
    this.draftJson = shown;
    this.lastSavedJson = clonePmJson(shown);
    const savedAt = new Date(doc.updatedAt);
    this.savedAt = Number.isNaN(savedAt.getTime()) ? null : savedAt;
    this.saveState = this.savedAt ? 'saved' : 'idle';
    this.saveError = null;
  }

  private resetEditor(): void {
    this.clearSaveTimer();
    this.editing = false;
    this.draftTitle = '';
    this.lastSavedTitle = '';
    this.draftJson = null;
    this.lastSavedJson = null;
    this.saveState = 'idle';
    this.savedAt = null;
    this.saveError = null;
    this.formatState = null;
    this.editRouteFor = null;
  }

  private applyRemoteDetail(
    detail: DocumentDetail,
    notes: Annotation[],
    mode: 'merge-keep-body' | 'merge-seed-body',
    changeAt: string | null,
  ): void {
    const prev = this.doc;
    if (!prev || prev.id !== detail.id) return;
    if (detail.assetUrls) this.assets.seed(detail.assetUrls, detail.assetUrlsFetchedAt);
    const keepBody = mode === 'merge-keep-body';
    const keepTitle = this.titleDirty;
    const prevCards = JSON.stringify(prev.cards);
    const prevNotes = JSON.stringify(this.annotations);
    const shown = displayedPmJson(detail);
    const contentChanged = !keepBody && !jsonEqual(shown, this.lastSavedJson ?? prev.contentJson);
    this.doc = {
      ...detail,
      contentJson: keepBody ? prev.contentJson : detail.contentJson,
      title: keepTitle ? prev.title : detail.title,
      answer: keepBody ? prev.answer : detail.answer,
    };
    this.annotations = notes;
    if (!keepTitle) {
      const nextTitle = detail.title ?? '';
      if (nextTitle !== this.lastSavedTitle) {
        this.lastSavedTitle = nextTitle;
        this.draftTitle = nextTitle;
      }
    }
    if (!keepBody) {
      this.draftJson = shown;
      this.lastSavedJson = clonePmJson(shown);
      if (contentChanged) this.contentGen += 1;
    } else {
      this.toastBodyConflict(detail, changeAt);
    }
    if (
      this.selectionDigesting &&
      this.selectionPollDocId === detail.id &&
      detail.cards.length > this.selectionCardCountAtStart
    ) {
      this.finishSelectionPoll();
    }
    if (prevCards !== JSON.stringify(detail.cards) || prevNotes !== JSON.stringify(notes)) {
      this.entityGen += 1;
    }
    void this.prefetchMedia();
    void this.loadCanvas();
  }

  private touchSave(): void {
    if (this.trashed || this.closed || this.remoteGone) return;
    if (!this.dirty) {
      this.clearSaveTimer();
      if (this.saveState !== 'saving') this.saveState = this.savedAt ? 'saved' : 'idle';
      return;
    }
    this.clearSaveTimer();
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save(false);
    }, SAVE_DEBOUNCE_MS);
  }

  private clearSaveTimer(): void {
    if (this.saveTimer === null) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }

  private async save(force: boolean): Promise<void> {
    if (this.trashed || this.remoteGone) return;
    if (!force && !this.dirty) return;
    if (this.saveInflight) {
      await this.saveInflight;
      if (this.trashed || this.remoteGone) return;
      if (!force && !this.dirty && this.saveState !== 'error') return;
    }
    const run = this.persist();
    this.saveInflight = run;
    try {
      await run;
    } finally {
      if (this.saveInflight === run) this.saveInflight = null;
      this.kickReplay();
    }
  }

  private async persist(): Promise<void> {
    if (this.remoteGone || this.trashed) return;
    await this.persistBody();
  }

  private async persistBody(): Promise<void> {
    this.clearSaveTimer();
    const current = this.doc;
    if (!current || this.trashed) return;
    const id = current.id;
    const lastSavedTitle = this.lastSavedTitle;
    const lastSavedJson = this.lastSavedJson;
    const titleSnapshot = this.draftTitle;
    const jsonSnapshot = this.draftJson;
    const getter = this.editing || this.dirty ? this.docGetter : null;
    let fetched: PmDocJson | null = null;
    if (getter) {
      try {
        fetched = clonePmJson(await getter());
      } catch {
        fetched = null;
      }
    }
    if (this.trashed) return;
    const still = this.doc?.id === id;
    const draftTitle = still ? this.draftTitle : titleSnapshot;
    let draftJson = fetched ?? (still ? this.draftJson : jsonSnapshot);
    if (
      still &&
      this.draftJson &&
      fetched &&
      !jsonEqual(this.draftJson, fetched) &&
      !jsonEqual(this.draftJson, jsonSnapshot)
    ) {
      draftJson = this.draftJson;
    }
    if (!draftJson || !lastSavedJson) return;
    const patch = buildDocumentPatch({
      draftTitle,
      lastSavedTitle,
      draftJson,
      lastSavedJson,
    });
    if (!patch) {
      if (still && fetched && (this.draftJson === null || jsonEqual(this.draftJson, jsonSnapshot))) {
        this.draftJson = fetched;
      }
      if (still && this.saveState !== 'saving') {
        this.saveError = null;
        this.saveState = this.savedAt ? 'saved' : 'idle';
      }
      return;
    }
    if (still) {
      this.saveState = 'saving';
      this.saveError = null;
    }
    const sentJson = clonePmJson(draftJson);
    const sentTitle = draftTitle;
    this.cardWriteGen += 1;
    try {
      const updated = await updateDocument(id, patch);
      const floorMs = Date.parse(updated.updatedAt);
      if (!Number.isNaN(floorMs)) this.saveFloors.set(id, floorMs);
      this.echoDocumentRow(id, updated.updatedAt);
      if (this.trashed || this.closed || this.remoteGone || this.doc?.id !== id) return;
      // Keep the client JSON. jsonb reorders keys, and that must not look like a new edit.
      this.lastSavedJson = clonePmJson(sentJson);
      this.lastSavedTitle = updated.title ?? '';
      if (
        this.draftJson === null ||
        jsonEqual(this.draftJson, jsonSnapshot) ||
        jsonEqual(this.draftJson, sentJson)
      ) {
        this.draftJson = clonePmJson(sentJson);
      }
      if (this.draftTitle.trim() === sentTitle.trim()) {
        this.draftTitle = updated.title ?? '';
      }
      const titleStillDirty = titlesDiffer(this.draftTitle, this.lastSavedTitle);
      this.doc = {
        ...this.doc,
        contentJson: clonePmJson(sentJson),
        title: titleStillDirty ? this.doc.title : (updated.title ?? null),
        updatedAt: updated.updatedAt,
      };
      this.savedAt = new Date();
      this.saveState = 'saved';
      this.saveError = null;
      if (!this.dirty) this.editorLive = false;
      if (this.dirty) this.touchSave();
    } catch (err) {
      if (this.doc?.id !== id) return;
      this.saveState = 'error';
      this.saveError = errorMessage(err, '没存上，再试一次');
    }
  }

  private async withDetailWrite<T>(run: () => Promise<T>): Promise<T> {
    this.detailWrites += 1;
    try {
      return await run();
    } finally {
      this.detailWrites -= 1;
      this.kickReplay();
    }
  }

  private echoDocumentRow(documentId: string | null, updatedAt: string | null | undefined): void {
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

  private syncActive(): boolean {
    return this.sync?.active === true;
  }

  private async pullDetail(id: string, changeAt: string | null, clearLinks: boolean): Promise<boolean> {
    if (clearLinks && this.doc?.id === id) {
      this.linksGen += 1;
      this.linksCache = {};
      this.links = null;
    }
    const read: DetailRead = {
      id,
      gen: this.cardWriteGen,
      floor: this.saveFloors.get(id) ?? null,
      serial: ++this.detailSerial,
      changeAt,
    };
    this.inflightReads.push(read);
    let closed = false;
    try {
      const detail = await getDocument(id);
      const notes = await listDocumentAnnotations(id).catch(() =>
        this.doc?.id === id ? this.annotations : ([] as Annotation[]),
      );
      if (this.doc?.id !== id) return false;
      const mode = classifyRemoteDetail({
        capturedGen: read.gen,
        currentGen: this.cardWriteGen,
        dirty: this.bodyDirty || this.editorLive,
        inflight: this.saveInflight !== null,
        detailUpdatedAtMs: Date.parse(detail.updatedAt),
        floorUpdatedAtMs: read.floor,
      });
      if (mode === 'drop') {
        this.noteDetailDropped(read);
        return false;
      }
      if (read.gen === this.cardWriteGen) {
        this.replayQueue = this.replayQueue.filter((item) => item.id !== id);
        if (this.replayStamp.get(id) === this.replayKey(id)) this.replayStamp.delete(id);
      }
      if (read.serial < this.appliedSerial) return false;
      this.appliedSerial = read.serial;
      this.applyRemoteDetail(detail, notes, mode, read.changeAt);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && (this.doc?.id === id || this.doc === null)) {
        this.replayQueue = this.replayQueue.filter((item) => item.id !== id);
        this.forgetOpenDocument(id);
        closed = this.doc === null || this.doc.id !== id;
      }
      return false;
    } finally {
      this.inflightReads = this.inflightReads.filter((item) => item !== read);
      this.kickReplay();
      if (!closed && this.sheet?.kind === 'card') void this.ensureLinks(this.sheet.cardId);
    }
  }

  private toastBodyConflict(detail: DocumentDetail, changeAt: string | null): void {
    if (!changeAt || this.conflictNotifiedAt === changeAt) return;
    if (!this.lastSavedJson || jsonEqual(displayedPmJson(detail), this.lastSavedJson)) return;
    this.conflictNotifiedAt = changeAt;
    this.showToast('另一处改过正文，这里仍是未保存的草稿');
  }

  private forgetOpenDocument(id: string): void {
    if (this.selectionPollDocId === id) this.finishSelectionPoll();
    this.stopPolling();
    const dirty =
      this.doc?.id === id &&
      (this.bodyDirty ||
        this.titleDirty ||
        this.editorLive ||
        this.saveInflight !== null ||
        this.detailWrites > 0);
    if (dirty) {
      this.remoteGone = true;
      this.clearSaveTimer();
      if (this.goneNotifiedId !== id) {
        this.goneNotifiedId = id;
        this.showToast('这份文档已在别处移入回收站');
      }
      return;
    }
    if (this.doc?.id === id || this.doc === null) {
      this.doc = null;
      this.annotations = [];
      this.canvasNodes = [];
      this.canvasImageUrls = {};
      this.viewMode = 'body';
      this.canvasGen += 1;
      this.linksGen += 1;
      this.links = null;
      this.linksCache = {};
      this.sheet = null;
      this.docError = '打不开这份文档';
      this.resetEditor();
    }
  }

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
    return this.detailWrites > 0 || this.saveInflight !== null;
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
      await this.pullDetail(id, changeAt, false);
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
    this.syncChain = this.syncChain.then(() => this.handleSync(event)).catch(() => undefined);
  }

  private async handleSync(event: SyncEvent): Promise<void> {
    if (event.type === 'reset') {
      if (!this.doc || this.remoteGone) return;
      try {
        this.topics = await listTopics('active');
      } catch {
        // Keep the picker already on screen.
      }
      await this.pullDetail(this.doc.id, null, true);
      return;
    }
    if (event.type !== 'changes') return;
    const changes = coalesceChanges(consumeEchoes(event.changes, this.echoes));
    await this.applySyncIntents(planReloads(changes, this.syncView()), changes);
  }

  private syncView(): SyncView {
    const id = this.doc?.id ?? null;
    return {
      documents: [],
      openDocumentId: id,
      listIncludesHead: false,
      editor:
        id && this.doc
          ? {
              id,
              updatedAt: this.doc.updatedAt,
              bodyDirty: this.bodyDirty || this.editorLive,
              titleDirty: this.titleDirty,
              saveInflight: this.saveInflight !== null,
            }
          : null,
      topics: this.topics.map((topic) => ({ id: topic.id })),
      openTopicId: this.doc?.topicId ?? null,
      mapTopicId: null,
      readerDocumentId: id,
      readerActiveCardId: this.sheet?.kind === 'card' ? this.sheet.cardId : null,
      reviewInSession: false,
      jobs: [],
      activeJobId: this.selectionJobId,
    };
  }

  private async applySyncIntents(intents: ReloadIntent[], changes: SyncChange[]): Promise<void> {
    const atById = new Map<string, string>();
    for (const change of changes) {
      if (change.scope === 'document' && change.op === 'upsert' && change.resourceId) {
        atById.set(change.resourceId, change.at);
      }
    }
    for (const intent of intents) {
      if (intent.kind === 'document' && this.doc?.id === intent.id) {
        if (intent.op === 'delete') this.forgetOpenDocument(intent.id);
        else if (!this.remoteGone) await this.pullDetail(intent.id, atById.get(intent.id) ?? null, true);
      } else if (intent.kind === 'job' && intent.id === this.selectionJobId) {
        await this.settleSelectionJob(intent.id);
      } else if (intent.kind === 'topic' && intent.op === 'delete') {
        this.topics = this.topics.filter((topic) => topic.id !== intent.id);
      } else if (intent.kind === 'topic' && intent.op === 'upsert') {
        await this.refreshReaderTopic(intent.id);
      } else if (intent.kind === 'topics-page') {
        try {
          this.topics = await listTopics('active');
        } catch {
          // Keep the picker already on screen.
        }
      }
    }
  }

  private async refreshReaderTopic(id: string): Promise<void> {
    try {
      const topic = await getTopic(id);
      const index = this.topics.findIndex((item) => item.id === id);
      this.topics =
        index < 0 ? [...this.topics, topic] : this.topics.map((item, i) => (i === index ? topic : item));
      if (this.doc?.topicId === id) this.doc = { ...this.doc, topicTitle: topic.title };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        this.topics = this.topics.filter((item) => item.id !== id);
      }
    }
  }
}
