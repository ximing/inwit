import { Service } from '@rabjs/react';
import {
  type Annotation,
  type CardLinksResponse,
  type DocumentCard,
  type DocumentDetail,
  type Topic,
} from '@inwit/dto';
import { createAnnotation, getAnnotationImage, listDocumentAnnotations } from '@/api/annotations';
import { createCard, getCard, getCardImage, getCardLinks } from '@/api/cards';
import { errorMessage } from '@/api/client';
import {
  enqueueSelectionCards,
  getDocument,
  retryDocument,
  updateDocument,
} from '@/api/documents';
import { listTopics } from '@/api/topics';
import { clipChars } from '@/lib/clip';
import { asAssetSrc } from '@/lib/internal-links';
import { isBlankPmDoc, textToPmDoc } from '@/lib/pm-doc';
import {
  livePresignedUrl,
  shouldRetryPresign,
  type PresignedUrlEntry,
} from '@/lib/presign-cache-logic';
import { AssetUrlsService } from '@/services/asset-urls.service';
import { ToastService } from '@/services/toast.service';
import type { TextSelectionAnchor } from '../../../../../packages/doc-engine/src/protocol';

const POLL_MS = 3000;
const SELECTION_POLL_MS = 2000;
const SELECTION_POLL_FOR_MS = 9000;
const PDF_MIME = 'application/pdf';

export type ReaderSheet =
  | { kind: 'cards'; cardIds: string[] }
  | { kind: 'card'; cardId: string; fromCards?: string[] }
  | { kind: 'annotations'; annotationIds: string[] }
  | { kind: 'annotate'; anchor: TextSelectionAnchor }
  | { kind: 'card-form'; anchor: TextSelectionAnchor }
  | { kind: 'topic' };

export class ReaderService extends Service {
  doc: DocumentDetail | null = null;
  annotations: Annotation[] = [];
  topics: Topic[] = [];
  docError: string | null = null;
  engineError: string | null = null;
  engineReady = false;
  contentGen = 0;
  sheet: ReaderSheet | null = null;
  activeCardId: string | null = null;
  links: CardLinksResponse | null = null;
  linksCache: Record<string, CardLinksResponse> = {};
  cardImageUrls: Record<string, PresignedUrlEntry> = {};
  annotationImageUrls: Record<string, string | null> = {};
  noteDraft = '';
  cardQuestion = '';
  cardAnswer = '';
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

  get engineDoc() {
    if (!this.doc) return null;
    if (!isBlankPmDoc(this.doc.contentJson)) return this.doc.contentJson;
    if (this.doc.answer?.trim()) return textToPmDoc(this.doc.answer);
    return null;
  }

  showToast(message: string): void {
    this.toastService.show(message);
  }

  setFocused(value: boolean): void {
    this.focused = value;
    if (!value) this.stopPolling();
    else this.syncPolling();
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
  }

  async load(id: string, anchor?: string | null): Promise<void> {
    this.docError = null;
    this.engineError = null;
    this.pendingAnchor = anchor ?? null;
    this.appliedAnchor = null;
    if (this.doc?.id !== id) {
      this.doc = null;
      this.annotations = [];
      this.sheet = null;
      this.activeCardId = null;
      this.links = null;
      this.engineReady = false;
    }
    const gen = ++this.loadGen;
    try {
      const [detail, notes, topics] = await Promise.all([
        getDocument(id),
        listDocumentAnnotations(id).catch(() => [] as Annotation[]),
        this.topics.length > 0 ? Promise.resolve(this.topics) : listTopics('active'),
      ]);
      if (gen !== this.loadGen) return;
      this.doc = detail;
      this.annotations = notes;
      this.topics = topics;
      this.contentGen += 1;
      this.syncPolling();
      void this.prefetchMedia();
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

  cardsForSheet(): DocumentCard[] {
    if (!this.doc || this.sheet?.kind !== 'cards') return [];
    const want = new Set(this.sheet.cardIds);
    return this.doc.cards.filter((card) => want.has(card.id));
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

  async saveAnnotation(): Promise<boolean> {
    if (!this.doc || this.sheet?.kind !== 'annotate' || this.saving) return false;
    const quote = clipChars(this.sheet.anchor.text.trim(), 20_000);
    if (!quote) return false;
    this.saving = true;
    try {
      await createAnnotation({
        documentId: this.doc.id,
        quote,
        note: this.noteDraft.trim(),
        ...(this.sheet.anchor.blockIndex > 0
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
      this.doc = detail;
      this.annotations = notes;
      this.contentGen += 1;
      void this.prefetchMedia();
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
    this.stopPolling();
    this.finishSelectionPoll();
    super.destroy();
  }
}
