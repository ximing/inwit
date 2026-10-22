import { Service } from '@rabjs/react';
import { errorMessage } from '@/api/client';
import { getDocumentFile } from '@/api/documents';
import { pdfSelectionFrom, type PdfSelection } from './reader-pdf-logic.js';

/**
 * PDF 查看地址、错误、选区、框选和跳页。
 * 不读文档正文、不改 viewMode、不上传摘录；那些仍由 ReaderService 编排。
 */
export class ReaderPdfService extends Service {
  pdfUrl: string | null = null;
  pdfError: string | null = null;
  pdfSelection: PdfSelection | null = null;
  pdfMarquee = false;
  pdfJump: { pageIndex: number; token: number } | null = null;

  async loadPdf(
    id: string | undefined,
    gen: number,
    loadGen: () => number,
    docId: () => string | undefined,
  ): Promise<void> {
    if (!id) return;
    this.pdfError = null;
    try {
      const file = await getDocumentFile(id);
      if (gen !== loadGen() || docId() !== id) return;
      this.pdfUrl = file.url;
    } catch (err) {
      if (gen !== loadGen() || docId() !== id) return;
      this.pdfUrl = null;
      this.pdfError = errorMessage(err, '打不开这份 PDF');
    }
  }

  setPdfError(message: string | null): void {
    this.pdfError = message;
  }

  setPdfSelection(text: string, pageIndex: number, quads: number[][] = []): void {
    this.pdfSelection = pdfSelectionFrom(text, pageIndex, quads);
  }

  clearPdfSelection(): void {
    this.pdfSelection = null;
  }

  togglePdfMarquee(): void {
    this.pdfMarquee = !this.pdfMarquee;
    if (this.pdfMarquee) this.pdfSelection = null;
  }
}
