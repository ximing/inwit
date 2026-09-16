import type { CardLinksResponse, DocumentCard, DocumentDetail } from '@inwit/dto';
import { Service } from '@rabjs/react';
import { getCardLinks } from '@/api/cards';
import { errorMessage } from '@/api/client';
import { getDocument } from '@/api/documents';

const PDF_MIME = 'application/pdf';
const PDF_BLOCK_MESSAGE = 'PDF 文档请在完整页面打开。';

function isPdfDocument(doc: Pick<DocumentDetail, 'fileMime'>): boolean {
  return doc.fileMime === PDF_MIME;
}

export class ReaderService extends Service {
  doc: DocumentDetail | null = null;
  loading = false;
  error: string | null = null;
  activeCardId: string | null = null;
  focusCardId: string | null = null;
  links: CardLinksResponse | null = null;
  /** 脉络懒加载缓存（按 cardId）。 */
  linksCache: Record<string, CardLinksResponse> = {};
  /** openLinkedCard 走过的卡片，backToList 时清空。 */
  cardTrail: string[] = [];
  pendingScrollTop = false;
  loadGen = 0;

  get isOpen(): boolean {
    return this.loading || this.error !== null || this.doc !== null;
  }

  get activeCard(): DocumentCard | null {
    if (!this.doc || !this.activeCardId) return null;
    return this.doc.cards.find((card) => card.id === this.activeCardId) ?? null;
  }

  async openDoc(docId: string): Promise<void> {
    if (this.doc?.id === docId && !this.loading) {
      this.error = null;
      this.activeCardId = null;
      this.focusCardId = null;
      this.links = null;
      this.cardTrail = [];
      this.pendingScrollTop = true;
      return;
    }
    const gen = ++this.loadGen;
    this.loading = true;
    this.error = null;
    this.activeCardId = null;
    this.focusCardId = null;
    this.links = null;
    this.cardTrail = [];
    this.pendingScrollTop = true;
    try {
      const detail = await getDocument(docId);
      if (gen !== this.loadGen) return;
      if (isPdfDocument(detail)) {
        this.blockPdf();
        return;
      }
      this.doc = detail;
      this.loading = false;
    } catch (err) {
      if (gen !== this.loadGen) return;
      this.loading = false;
      this.doc = null;
      this.error = errorMessage(err, '打不开这份文档');
    }
  }

  async openCard(cardId: string, docId: string): Promise<void> {
    this.cardTrail = [];
    await this.focusCard(cardId, docId);
  }

  async openLinkedCard(cardId: string): Promise<void> {
    const prev = this.activeCardId;
    if (prev) this.cardTrail = [...this.cardTrail, prev];
    const local = this.doc?.cards.find((card) => card.id === cardId);
    if (local) {
      this.error = null;
      this.activeCardId = cardId;
      this.focusCardId = cardId;
      this.pendingScrollTop = false;
      await this.ensureLinks(cardId, this.loadGen);
      return;
    }
    const nextDocId = this.linkedDocumentId(cardId);
    if (!nextDocId) {
      if (prev) this.cardTrail = this.cardTrail.slice(0, -1);
      this.error = '这张关联卡没有所属文档。';
      return;
    }
    await this.focusCard(cardId, nextDocId);
  }

  backToList(): void {
    this.activeCardId = null;
    this.focusCardId = null;
    this.links = null;
    this.cardTrail = [];
  }

  close(): void {
    this.loadGen += 1;
    this.doc = null;
    this.loading = false;
    this.error = null;
    this.activeCardId = null;
    this.focusCardId = null;
    this.links = null;
    this.linksCache = {};
    this.cardTrail = [];
    this.pendingScrollTop = false;
  }

  clearFocus(): void {
    this.focusCardId = null;
  }

  clearPendingScrollTop(): void {
    this.pendingScrollTop = false;
  }

  private async focusCard(cardId: string, docId: string): Promise<void> {
    if (this.doc?.id === docId && !this.loading) {
      this.error = null;
      this.activeCardId = cardId;
      this.focusCardId = cardId;
      this.pendingScrollTop = false;
      await this.ensureLinks(cardId, this.loadGen);
      return;
    }
    const gen = ++this.loadGen;
    this.loading = true;
    this.error = null;
    try {
      const detail = await getDocument(docId);
      if (gen !== this.loadGen) return;
      if (isPdfDocument(detail)) {
        this.blockPdf();
        return;
      }
      this.doc = detail;
      this.loading = false;
      this.activeCardId = cardId;
      this.focusCardId = cardId;
      this.pendingScrollTop = false;
      await this.ensureLinks(cardId, gen);
    } catch (err) {
      if (gen !== this.loadGen) return;
      this.loading = false;
      this.doc = null;
      this.activeCardId = null;
      this.focusCardId = null;
      this.links = null;
      this.error = errorMessage(err, '打不开这份文档');
    }
  }

  private blockPdf(): void {
    this.loading = false;
    this.doc = null;
    this.activeCardId = null;
    this.focusCardId = null;
    this.links = null;
    this.pendingScrollTop = false;
    this.error = PDF_BLOCK_MESSAGE;
  }

  private linkedDocumentId(cardId: string): string | null {
    if (!this.links) return null;
    const hit = [...this.links.outgoing, ...this.links.incoming].find(
      (item) => item.card.id === cardId,
    );
    return hit?.card.documentId ?? null;
  }

  private async ensureLinks(cardId: string, gen: number): Promise<void> {
    const cached = this.linksCache[cardId];
    if (cached) {
      if (gen === this.loadGen) this.links = cached;
      return;
    }
    this.links = null;
    try {
      const data = await getCardLinks(cardId);
      this.linksCache = { ...this.linksCache, [cardId]: data };
      if (gen === this.loadGen && this.activeCardId === cardId) this.links = data;
    } catch {
      if (gen === this.loadGen && this.activeCardId === cardId) {
        this.links = { outgoing: [], incoming: [] };
      }
    }
  }
}
