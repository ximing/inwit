export type PdfViewerEvent =
  | { type: 'ready' }
  | { type: 'loaded'; pageCount: number }
  | { type: 'page'; pageIndex: number }
  | { type: 'selection'; text: string; pageIndex: number }
  | { type: 'error'; message: string };

export type PdfParseOk = { ok: true; value: PdfViewerEvent };
export type PdfParseErr = { ok: false; message: string };
export type PdfParseResult = PdfParseOk | PdfParseErr;

function fail(message: string): PdfParseErr {
  return { ok: false, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Integers only. Floats, NaN, and numeric strings are rejected. */
function integerAtLeast(value: unknown, min: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) return null;
  return value;
}

export function parsePdfViewerEvent(raw: unknown): PdfParseResult {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      return fail('invalid json');
    }
  }
  if (!isRecord(data) || typeof data.type !== 'string') return fail('event requires type');

  switch (data.type) {
    case 'ready':
      return { ok: true, value: { type: 'ready' } };
    case 'loaded': {
      const pageCount = integerAtLeast(data.pageCount, 1);
      if (pageCount === null) return fail('loaded requires pageCount');
      return { ok: true, value: { type: 'loaded', pageCount } };
    }
    case 'page': {
      const pageIndex = integerAtLeast(data.pageIndex, 0);
      if (pageIndex === null) return fail('page requires pageIndex');
      return { ok: true, value: { type: 'page', pageIndex } };
    }
    case 'selection': {
      if (typeof data.text !== 'string') return fail('selection requires text');
      const pageIndex = integerAtLeast(data.pageIndex, 0);
      if (pageIndex === null) return fail('selection requires pageIndex');
      return { ok: true, value: { type: 'selection', text: data.text, pageIndex } };
    }
    case 'error': {
      if (typeof data.message !== 'string' || data.message.trim().length === 0) {
        return fail('error requires message');
      }
      return { ok: true, value: { type: 'error', message: data.message } };
    }
    default:
      return fail(`unknown event: ${data.type}`);
  }
}

/** 1-based label. Invalid counts yield an empty string so the chip can hide. */
export function pdfPageLabel(pageIndex: number, pageCount: number): string {
  if (!Number.isInteger(pageIndex) || !Number.isInteger(pageCount)) return '';
  if (pageCount < 1 || pageIndex < 0 || pageIndex >= pageCount) return '';
  return `${pageIndex + 1} / ${pageCount}`;
}

/** Trim, then clip by Unicode code point so a surrogate pair is not split. */
export function clipPdfQuote(text: string, max = 4000): string {
  const trimmed = text.trim();
  if (!Number.isFinite(max) || max < 1) return '';
  const limit = Math.floor(max);
  const chars = Array.from(trimmed);
  if (chars.length <= limit) return trimmed;
  return chars.slice(0, limit).join('');
}

export function pdfOpenInjection(url: string): string {
  return `window.__pdfViewer&&window.__pdfViewer.open(${JSON.stringify(url)});true;`;
}

export function pdfThemeInjection(theme: 'light' | 'dark'): string {
  const name = theme === 'dark' ? 'dark' : 'light';
  return `window.__pdfViewer&&window.__pdfViewer.setTheme(${JSON.stringify(name)});true;`;
}
