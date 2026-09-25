import { Service } from '@rabjs/react';
import {
  ASSET_IMAGE_MAX_BYTES,
  ASSET_IMAGE_MIMES,
  type Annotation,
  type CardDetail,
  type CardLinksResponse,
  type DocumentCard,
  type DocumentDetail,
  type PmDocJson,
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
  retryDocument,
  updateDocument,
} from '@/api/documents';
import { confirmAction } from '@/lib/confirm';
import { listTopics } from '@/api/topics';
import { clipChars } from '@/lib/clip';
import { formatTimeHm } from '@/lib/format';
import { asAssetSrc } from '@/lib/internal-links';
import { clonePmJson, isBlankPmDoc, jsonEqual } from '@/lib/pm-doc';
import {
  livePresignedUrl,
  shouldRetryPresign,
  type PresignedUrlEntry,
} from '@/lib/presign-cache-logic';
import { AssetUrlsService } from '@/services/asset-urls.service';
import { ToastService } from '@/services/toast.service';
import * as FileSystem from 'expo-file-system/legacy';
import type { FormatState, TextSelectionAnchor } from '../../../../../packages/doc-engine/src/protocol';
import { buildDocumentPatch, displayedPmJson, SAVE_DEBOUNCE_MS, titlesDiffer } from './editor-session';

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
  | { kind: 'annotate'; anchor: TextSelectionAnchor; pdfPageIndex?: number }
  | { kind: 'card-form'; anchor: TextSelectionAnchor }
  | { kind: 'card-edit'; cardId: string; fromCards?: string[] }
  | { kind: 'topic' }
  | { kind: 'more' }
  | { kind: 'format' }
  | { kind: 'link' };

export class ReaderService extends Service {
  doc: DocumentDetail | null = null;
  annotations: Annotation[] = [];
  topics: Topic[] = [];
  docError: string | null = null;
  engineError: string | null = null;
  pdfUrl: string | null = null;
  pdfError: string | null = null;
  pdfSelection: { text: string; pageIndex: number } | null = null;
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
  noteDraft = '';
  cardQuestion = '';
  cardAnswer = '';
  rejectDraft = '';
  deciding = false;
  saving = false;
  focused = false;
  pollTimer: ReturnType<typeof setInterval> | null = null;
  selectionDigesting = false;
  selectionPollUntil = 0;
  selectionPollDocId: string | null = null;
  selectionCardCountAtStart = 0;
  selectionTickTimer: ReturnType<typeof setTimeout> | null = null;
  loadGen = 0;
  appliedAnchor: string | null = null;
  pendingAnchor: string | null = null;
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
    const shown = displayedPmJson(this.doc);
    if (!isBlankPmDoc(shown)) return shown;
    if (this.editing) return shown;
    return null;
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
    this.linkDraft = '';
    this.sheet = { kind: 'link' };
  }

  setLinkDraft(value: string): void {
    this.linkDraft = value;
  }

  markEngineReady(): void {
    this.engineReady = true;
    this.contentGen += 1;
  }

  setEngineError(message: string | null): void {
    this.engineError = message;
  }

  closeSheet(): void {
    this.sheet = null;
    this.noteDraft = '';
    this.cardQuestion = '';
    this.cardAnswer = '';
    this.cardEditQuestion = '';
    this.cardEditAnswer = '';
    this.rejectDraft = '';
    this.linkDraft = '';
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
    if (this.doc?.id !== id) {
      this.trashed = false;
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
    }
    const gen = ++this.loadGen;
    try {
      const [detail, notes, topics] = await Promise.all([
        getDocument(id),
        listDocumentAnnotations(id).catch(() => [] as Annotation[]),
        this.topics.length > 0 ? Promise.resolve(this.topics) : listTopics('active'),
      ]);
      if (gen !== this.loadGen) return;
      const sameDoc = this.doc?.id === detail.id && this.draftJson !== null;
      this.topics = topics;
      if (sameDoc) {
        this.applyRemoteDetail(detail, notes);
        this.syncPolling();
        return;
      }
      this.doc = detail;
      this.annotations = notes;
      this.seedEditor(detail);
      if (this.editRouteFor !== id) {
        this.editRouteFor = id;
        if (editRequested && this.canEdit) this.editing = true;
      }
      this.contentGen += 1;
      this.syncPolling();
      void this.prefetchMedia();
      if (detail.fileMime === PDF_MIME) void this.loadPdf(detail.id, gen);
      else {
        this.pdfUrl = null;
        this.pdfError = null;
        this.pdfSelection = null;
      }
    } catch (err) {
      if (gen !== this.loadGen) return;
      this.docError = errorMessage(err, '打不开这份文档');
      this.doc = null;
    }
  }

  consumePendingAnchor(): string | null {
    const cardId = this.pendingAnchor;
    if (!cardId || !this.doc) return null;
    const key = `${this.doc.id}:${cardId}`;
    if (this.appliedAnchor === key) return null;
    if (!this.doc.cards.some((card) => card.id === cardId)) return null;
    this.appliedAnchor = key;
    this.pendingAnchor = null;
    return cardId;
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

  setPdfSelection(text: string, pageIndex: number): void {
    const quote = text.trim();
    if (!quote) {
      this.pdfSelection = null;
      return;
    }
    this.pdfSelection = { text: quote, pageIndex };
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
    const cached = this.linksCache[cardId];
    if (cached) {
      this.links = cached;
      return;
    }
    this.links = null;
    try {
      const data = await getCardLinks(cardId);
      this.linksCache = { ...this.linksCache, [cardId]: data };
      if (this.sheet?.kind === 'card' && this.sheet.cardId === cardId) this.links = data;
    } catch {
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

  private removeCard(id: string): void {
    if (!this.doc) return;
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
      const detail = await acceptCard(id);
      this.applyCard(detail);
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
      const detail = await rejectCard(cardId, trimmed ? { reason: trimmed } : {});
      this.applyCard(detail);
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
      const result = await acceptProposedCards(documentId);
      const acceptedIds = new Set(result.acceptedIds);
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
      this.deciding = false;
    }
  }

  async saveAnnotation(): Promise<boolean> {
    if (!this.doc || this.sheet?.kind !== 'annotate' || this.saving) return false;
    const quote = clipChars(this.sheet.anchor.text.trim(), 20_000);
    if (!quote) return false;
    this.saving = true;
    try {
      const pdfPageIndex = this.sheet.pdfPageIndex;
      await createAnnotation({
        documentId: this.doc.id,
        quote,
        note: this.noteDraft.trim(),
        ...(pdfPageIndex != null
          ? { kind: 'pdf' as const, pageIndex: pdfPageIndex, geometry: { quads: [] } }
          : this.sheet.anchor.blockIndex > 0
            ? { anchorBlockIndex: this.sheet.anchor.blockIndex }
            : {}),
      });
      this.showToast('已记下');
      this.closeSheet();
      await this.refresh();
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
    this.saving = true;
    try {
      await createCard({
        documentId: this.doc.id,
        concept,
        example: clipChars(this.cardAnswer.trim(), 4000),
        anchorText: clipChars(this.sheet.anchor.text, 4000),
        ...(this.sheet.anchor.blockIndex > 0
          ? { anchorBlockIndex: this.sheet.anchor.blockIndex }
          : {}),
      });
      this.showToast('已加入复习队列');
      this.closeSheet();
      await this.refresh();
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
    this.selectionDigesting = true;
    this.selectionPollDocId = this.doc.id;
    this.selectionCardCountAtStart = this.doc.cards.length;
    this.selectionPollUntil = Date.now() + SELECTION_POLL_FOR_MS;
    try {
      await enqueueSelectionCards(this.doc.id, { text: clipped, blockIndex: anchor.blockIndex });
      this.showToast('已排队，消化完成后出现');
      this.startSelectionPoll(this.doc.id);
    } catch (err) {
      this.finishSelectionPoll();
      this.showToast(errorMessage(err, '没排上队'));
    }
  }

  startSelectionPoll(documentId: string): void {
    this.stopSelectionTick();
    const startCount = this.selectionCardCountAtStart;
    const tick = async () => {
      this.selectionTickTimer = null;
      if (!this.selectionDigesting || this.selectionPollDocId !== documentId) return;
      await this.refresh();
      const grown = this.doc?.id === documentId && this.doc.cards.length > startCount;
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
  }

  stopSelectionTick(): void {
    if (this.selectionTickTimer === null) return;
    clearTimeout(this.selectionTickTimer);
    this.selectionTickTimer = null;
  }

  finishSelectionPoll(): void {
    this.stopSelectionTick();
    this.selectionDigesting = false;
    this.selectionPollUntil = 0;
    this.selectionPollDocId = null;
  }

  async setDocTopic(topicId: string | null): Promise<void> {
    if (!this.doc) return;
    this.closeSheet();
    try {
      const updated = await updateDocument(this.doc.id, { topicId });
      const topicTitle = this.topics.find((topic) => topic.id === updated.topicId)?.title ?? null;
      this.doc = { ...this.doc, topicId: updated.topicId, topicTitle, updatedAt: updated.updatedAt };
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

  async refresh(): Promise<void> {
    if (!this.doc) return;
    const id = this.doc.id;
    try {
      const [detail, notes] = await Promise.all([
        getDocument(id),
        listDocumentAnnotations(id).catch(() => this.annotations),
      ]);
      if (this.doc?.id !== id) return;
      this.applyRemoteDetail(detail, notes);
    } catch {
      // keep last copy
    }
  }

  stopPolling(): void {
    if (this.pollTimer === null) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  syncPolling(): void {
    if (this.doc?.status === 'pending' && this.focused) this.startPolling();
    else this.stopPolling();
  }

  startPolling(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => {
      void this.tickPending();
    }, POLL_MS);
  }

  async tickPending(): Promise<void> {
    if (!this.focused || this.doc?.status !== 'pending') {
      this.stopPolling();
      return;
    }
    await this.refresh();
    this.syncPolling();
  }

  override destroy(): void {
    this.closed = true;
    this.clearSaveTimer();
    this.stopPolling();
    this.finishSelectionPoll();
    super.destroy();
  }

  async flushSave(): Promise<void> {
    if (this.trashed) return;
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
      const detail = await updateCard(card.id, input);
      this.applyCard(detail);
      this.entityGen += 1;
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
      await archiveCard(id);
      this.removeCard(id);
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
      const state = suspended ? await resumeCard(card.id) : await suspendCard(card.id);
      if (!this.doc) return;
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
      const updated = await updateAnnotation(id, { note: note.slice(0, 20_000) });
      this.annotations = this.annotations.map((item) => (item.id === id ? updated : item));
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
      await deleteAnnotation(id);
      this.annotations = this.annotations.filter((item) => item.id !== id);
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

  /** Poll/digest: keep a dirty draft; accept a clean remote title. */
  private applyRemoteDetail(detail: DocumentDetail, notes: Annotation[]): void {
    const prev = this.doc;
    if (!prev || prev.id !== detail.id) return;
    const remoteOlder = detail.updatedAt < prev.updatedAt;
    const keepBody = this.bodyDirty || this.editorLive || remoteOlder;
    const keepTitle = this.titleDirty || remoteOlder;
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
    }
    if (prevCards !== JSON.stringify(detail.cards) || prevNotes !== JSON.stringify(notes)) {
      this.entityGen += 1;
    }
    void this.prefetchMedia();
  }

  private touchSave(): void {
    if (this.trashed || this.closed) return;
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
    if (this.trashed) return;
    if (!force && !this.dirty) return;
    if (this.saveInflight) {
      await this.saveInflight;
      if (this.trashed) return;
      if (!force && !this.dirty && this.saveState !== 'error') return;
    }
    const run = this.persist();
    this.saveInflight = run;
    try {
      await run;
    } finally {
      if (this.saveInflight === run) this.saveInflight = null;
    }
  }

  private async persist(): Promise<void> {
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
    try {
      const updated = await updateDocument(id, patch);
      if (this.trashed || this.closed || this.doc?.id !== id) return;
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
}
