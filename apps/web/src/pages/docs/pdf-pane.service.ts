import { Service } from '@rabjs/react';
import {
  IMAGE_EXCERPT_QUOTE,
  type Annotation,
  type AnnotationGeometry,
  type DocumentCard,
} from '@inwit/dto';
import { errorMessage } from '@/api/client';
import { getDocumentFile, requestExcerptUpload } from '@/api/documents';
import { DocsService } from './docs.service';
import {
  geometryFromRects,
  PDF_HIGHLIGHT_COLOR,
  type OwnPdfAnnotation,
} from './pdf-pane/annotation-adapter';
import { isPdfOcrPending, pageIndexFromAnchor } from './pdf-pane/page-logic';
import type { Rect } from '@embedpdf/models';

const EXCERPT_MAX_BYTES = 5 * 1024 * 1024;

export type PdfJumpRequest = {
  key: string;
  pageIndex: number;
  quote: string | null;
};

export class PdfPaneService extends Service {
  fileUrl: string | null = null;
  fileMime: string | null = null;
  fileError: string | null = null;
  loadGen = 0;
  selectionText = '';
  selectionPageIndex = 0;
  selectionGeometry: AnnotationGeometry | null = null;
  jump: PdfJumpRequest | null = null;
  lastJumpKey: string | null = null;
  thumbsOpen = true;
  searchOpen = false;
  zoomMenuOpen = false;
  searchQuery = '';
  searchFocusGen = 0;
  pageDraft: string | null = null;

  get docs(): DocsService {
    return this.resolve(DocsService);
  }

  get ocrPending(): boolean {
    return isPdfOcrPending(this.docs.doc?.contentMd ?? '');
  }

  get ownPdfAnnotations(): OwnPdfAnnotation[] {
    const out: OwnPdfAnnotation[] = [];
    for (const item of this.docs.annotations) {
      if (item.kind !== 'pdf' || item.pageIndex == null || !item.geometry) continue;
      out.push({
        id: item.id,
        pageIndex: item.pageIndex,
        geometry: item.geometry,
        kind: item.imageKey ? 'excerpt' : 'highlight',
        quote: item.quote,
        note: item.note,
      });
    }
    return out;
  }

  get pdfSelection(): {
    pageIndex: number;
    geometry: AnnotationGeometry;
    imageKey?: string;
  } | null {
    if (!this.selectionGeometry) return null;
    return {
      pageIndex: this.selectionPageIndex,
      geometry: this.selectionGeometry,
    };
  }

  async loadFile(documentId: string): Promise<void> {
    const gen = ++this.loadGen;
    this.fileError = null;
    try {
      const file = await getDocumentFile(documentId);
      if (gen !== this.loadGen) return;
      this.fileUrl = file.url;
      this.fileMime = file.mime;
    } catch (err) {
      if (gen !== this.loadGen) return;
      this.fileUrl = null;
      this.fileMime = null;
      this.fileError = errorMessage(err, '打不开这份 PDF');
    }
  }

  noteSelection(input: {
    text: string;
    pageIndex: number;
    rects: Rect[];
  }): void {
    this.selectionText = input.text.trim();
    this.selectionPageIndex = input.pageIndex;
    this.selectionGeometry =
      input.rects.length > 0 ? geometryFromRects(input.rects, PDF_HIGHLIGHT_COLOR) : null;
  }

  clearSelection(): void {
    this.selectionText = '';
    this.selectionGeometry = null;
  }

  requestJumpFromAnnotation(item: Annotation): void {
    if (item.kind === 'pdf' && item.pageIndex != null) {
      this.setJump({
        key: `ann:${item.id}`,
        pageIndex: item.pageIndex,
        quote: this.jumpQuote(item.quote),
      });
      return;
    }
    this.requestJumpFromQuote(item.quote, item.id, 'ann');
  }

  requestJumpFromCard(card: DocumentCard): void {
    const doc = this.docs.doc;
    const pageIndex = pageIndexFromAnchor({
      contentMd: doc?.contentMd ?? '',
      pageIndex: null,
      anchorBlock: card.anchorBlock,
      quote: card.anchorText,
      pageCount: doc?.pageCount,
    });
    this.setJump({
      key: `card:${card.id}`,
      pageIndex,
      quote: this.jumpQuote(card.anchorText),
    });
  }

  requestJumpFromQuote(quote: string, id: string, kind: 'ann' | 'card'): void {
    const doc = this.docs.doc;
    const pageIndex = pageIndexFromAnchor({
      contentMd: doc?.contentMd ?? '',
      quote,
      pageCount: doc?.pageCount,
    });
    this.setJump({
      key: `${kind}:${id}`,
      pageIndex,
      quote: this.jumpQuote(quote),
    });
  }

  consumeJump(): PdfJumpRequest | null {
    const next = this.jump;
    this.jump = null;
    return next;
  }

  async uploadExcerpt(documentId: string, blob: Blob): Promise<string | null> {
    const contentType = (blob.type.split(';')[0]?.trim() || 'image/png').toLowerCase();
    if (blob.size <= 0 || blob.size > EXCERPT_MAX_BYTES) {
      this.docs.showToast('截图太大了');
      return null;
    }
    try {
      const { uploadUrl, key } = await requestExcerptUpload(documentId, {
        contentType,
        sizeBytes: blob.size,
      });
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': contentType },
      });
      if (!put.ok) {
        this.docs.showToast('截图没传上去');
        return null;
      }
      return key;
    } catch (err) {
      this.docs.showToast(errorMessage(err, '截图没传上去'));
      return null;
    }
  }

  async createExcerptAnnotation(input: {
    documentId: string;
    pageIndex: number;
    geometry: AnnotationGeometry;
    imageKey: string;
    note?: string;
  }): Promise<boolean> {
    return this.docs.addAnnotation(input.documentId, IMAGE_EXCERPT_QUOTE, input.note ?? '', {
      kind: 'pdf',
      pageIndex: input.pageIndex,
      geometry: input.geometry,
      imageKey: input.imageKey,
    });
  }

  private jumpQuote(text: string | null | undefined): string | null {
    const clipped = text?.trim() ?? '';
    if (!clipped || clipped === IMAGE_EXCERPT_QUOTE) return null;
    return clipped;
  }

  private setJump(next: PdfJumpRequest): void {
    if (this.lastJumpKey === next.key) return;
    this.lastJumpKey = next.key;
    this.jump = next;
  }

  resetJumpTracking(): void {
    this.lastJumpKey = null;
    this.jump = null;
  }

  resetChrome(): void {
    this.searchOpen = false;
    this.zoomMenuOpen = false;
    this.searchQuery = '';
    this.pageDraft = null;
  }

  toggleThumbs(): void {
    this.thumbsOpen = !this.thumbsOpen;
  }

  openSearch(): void {
    this.searchOpen = true;
    this.zoomMenuOpen = false;
    this.searchFocusGen += 1;
  }

  closeSearch(): void {
    this.searchOpen = false;
    this.searchQuery = '';
  }

  toggleSearch(): void {
    if (this.searchOpen) this.closeSearch();
    else this.openSearch();
  }

  setSearchQuery(query: string): void {
    this.searchQuery = query;
  }

  toggleZoomMenu(): void {
    this.zoomMenuOpen = !this.zoomMenuOpen;
  }

  closeZoomMenu(): void {
    this.zoomMenuOpen = false;
  }

  beginPageEdit(currentPage: number): void {
    this.pageDraft = String(currentPage);
  }

  setPageDraft(raw: string): void {
    this.pageDraft = raw;
  }

  endPageEdit(): void {
    this.pageDraft = null;
  }
}
