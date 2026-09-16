import { PDF_PAGE_SEPARATOR } from '@inwit/dto';

export function splitPdfPages(contentMd: string): string[] {
  const normalized = contentMd.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  if (normalized.trim().length === 0) return [];
  return normalized.split(PDF_PAGE_SEPARATOR);
}

function parseBlockIndex(value: string | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.round(value));
  }
  if (typeof value === 'string') {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n)) return Math.max(1, n);
  }
  return null;
}

/**
 * 0-based PDF page. `pageIndex` wins; otherwise map `anchorBlock` / `quote`
 * through the `\n\n---\n\n` page separator in `contentMd`.
 */
export function pageIndexFromAnchor(input: {
  contentMd: string;
  pageIndex?: number | null;
  anchorBlock?: string | number | null;
  quote?: string | null;
  pageCount?: number | null;
}): number {
  if (typeof input.pageIndex === 'number' && Number.isFinite(input.pageIndex) && input.pageIndex >= 0) {
    return Math.floor(input.pageIndex);
  }

  const pages = splitPdfPages(input.contentMd);
  const quote = input.quote?.trim() ?? '';
  if (quote.length > 0 && pages.length > 0) {
    const hit = pages.findIndex((page) => page.includes(quote));
    if (hit >= 0) return hit;
  }

  const block = parseBlockIndex(input.anchorBlock);
  if (block !== null) {
    const zero = block - 1;
    if (pages.length > 0) {
      return Math.min(Math.max(0, zero), pages.length - 1);
    }
    if (typeof input.pageCount === 'number' && input.pageCount > 0) {
      return Math.min(Math.max(0, zero), input.pageCount - 1);
    }
    return Math.max(0, zero);
  }

  return 0;
}

export function isPdfOcrPending(contentMd: string): boolean {
  return contentMd.trim().length === 0;
}
