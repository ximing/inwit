export const PDF_HIGHLIGHT_COLOR = '#f5c542';
export const PDF_EXCERPT_COLOR = '#c45c26';

export type PdfMark = {
  id: string;
  pageIndex: number;
  kind: 'highlight' | 'excerpt';
  quads: number[][];
};

export type PdfViewerEvent =
  | { type: 'ready' }
  | { type: 'loaded'; pageCount: number }
  | { type: 'page'; pageIndex: number }
  | { type: 'selection'; text: string; pageIndex: number; quads: number[][] }
  | {
      type: 'excerpt';
      pageIndex: number;
      quads: number[][];
      mime: 'image/png' | 'image/jpeg';
      base64: string;
      byteLength: number;
    }
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

function finiteNumbers(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length !== 4 && value.length < 8) return null;
  const nums: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item)) return null;
    nums.push(item);
  }
  return nums;
}

/** Missing quads mean an older selection event. A present value must be well formed. */
function parseQuads(value: unknown, required: boolean): number[][] | null {
  if (value === undefined) return required ? null : [];
  if (!Array.isArray(value)) return null;
  const quads: number[][] = [];
  for (const item of value) {
    const nums = finiteNumbers(item);
    if (!nums) return null;
    quads.push(nums);
  }
  if (required && !quads.some((quad) => quadArea(quad) > 0)) return null;
  return quads;
}

export function quadBounds(quad: readonly number[]): { x: number; y: number; width: number; height: number } | null {
  if (quad.length === 4) {
    const [x, y, width, height] = quad;
    if (x === undefined || y === undefined || width === undefined || height === undefined) return null;
    if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
    return { x, y, width, height };
  }
  if (quad.length < 8) return null;
  const xs = [quad[0], quad[2], quad[4], quad[6]].filter((n): n is number => typeof n === 'number');
  const ys = [quad[1], quad[3], quad[5], quad[7]].filter((n): n is number => typeof n === 'number');
  if (xs.length < 4 || ys.length < 4) return null;
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function quadArea(quad: readonly number[]): number {
  const bounds = quadBounds(quad);
  if (!bounds) return 0;
  return Math.abs(bounds.width * bounds.height);
}

/** Same drag threshold as a page marquee: the longer side must exceed 5 CSS pixels. */
export function isMarqueeLargeEnough(
  size: { width: number; height: number } | null | undefined,
  scale = 1,
  minDragPx = 5,
): boolean {
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) return false;
  if (!Number.isFinite(scale) || scale <= 0) return false;
  return Math.max(size.width, size.height) * scale > minDragPx;
}

export function base64ByteLength(value: string): number | null {
  const trimmed = value.replace(/\s/g, '');
  if (trimmed.length === 0 || trimmed.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
  const pad = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0;
  return (trimmed.length / 4) * 3 - pad;
}

export function geometryFromQuads(
  quads: readonly number[][],
  color: string,
): { quads: number[][]; color: string } | null {
  const kept = quads.filter((quad) => quadArea(quad) > 0);
  if (kept.length === 0) return null;
  return { quads: kept.map((quad) => quad.slice()), color };
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
      const quads = parseQuads(data.quads, false);
      if (quads === null) return fail('selection requires quads');
      return { ok: true, value: { type: 'selection', text: data.text, pageIndex, quads } };
    }
    case 'excerpt': {
      const pageIndex = integerAtLeast(data.pageIndex, 0);
      if (pageIndex === null) return fail('excerpt requires pageIndex');
      const quads = parseQuads(data.quads, true);
      if (quads === null) return fail('excerpt requires quads');
      if (data.mime !== 'image/png' && data.mime !== 'image/jpeg') return fail('excerpt requires mime');
      if (typeof data.base64 !== 'string') return fail('excerpt requires base64');
      const decoded = base64ByteLength(data.base64);
      const byteLength = integerAtLeast(data.byteLength, 1);
      if (decoded === null || byteLength === null || decoded !== byteLength) {
        return fail('excerpt requires byteLength');
      }
      return {
        ok: true,
        value: { type: 'excerpt', pageIndex, quads, mime: data.mime, base64: data.base64, byteLength },
      };
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

export function pdfPaintInjection(marks: readonly PdfMark[]): string {
  return `window.__pdfViewer&&window.__pdfViewer.paint(${JSON.stringify(marks)});true;`;
}

export function pdfGoToInjection(pageIndex: number): string {
  const index = Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex : 0;
  return `window.__pdfViewer&&window.__pdfViewer.goToPage(${String(index)});true;`;
}

export function pdfMarqueeInjection(on: boolean): string {
  return `window.__pdfViewer&&window.__pdfViewer.setMarquee(${on ? 'true' : 'false'});true;`;
}

export function pdfMarksFromAnnotations(
  notes: readonly {
    id: string;
    kind: string;
    pageIndex: number | null;
    imageKey: string | null;
    geometry: { quads: number[][] } | null;
  }[],
): PdfMark[] {
  const marks: PdfMark[] = [];
  for (const note of notes) {
    if (note.kind !== 'pdf' || note.pageIndex === null || !note.geometry) continue;
    const quads = note.geometry.quads.filter((quad) => quadArea(quad) > 0);
    if (quads.length === 0) continue;
    marks.push({
      id: note.id,
      pageIndex: note.pageIndex,
      kind: note.imageKey ? 'excerpt' : 'highlight',
      quads,
    });
  }
  return marks;
}
