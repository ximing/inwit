import type { AnnotationGeometry } from '@inwit/dto';
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import type { AnnotationTransferItem } from '@embedpdf/plugin-annotation';

/** PDF user-space rect. Structurally matches EmbedPDF Rect; kept local so the type does not leak. */
export type PdfRect = {
  origin: { x: number; y: number };
  size: { width: number; height: number };
};

export const PDF_HIGHLIGHT_COLOR = '#f5c542';
export const PDF_EXCERPT_STROKE = '#c45c26';

export type OwnPdfAnnotation = {
  id: string;
  pageIndex: number;
  geometry: AnnotationGeometry;
  kind: 'highlight' | 'excerpt';
  quote?: string | null;
  note?: string | null;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numbersOf(quad: unknown): number[] {
  if (!Array.isArray(quad)) return [];
  return quad.filter(isFiniteNumber);
}

export function rectFromQuad(quad: number[]): PdfRect | null {
  if (quad.length === 4) {
    const [x, y, width, height] = quad;
    if (x === undefined || y === undefined || width === undefined || height === undefined) {
      return null;
    }
    return { origin: { x, y }, size: { width, height } };
  }
  if (quad.length < 8) return null;
  const xs = [quad[0], quad[2], quad[4], quad[6]].filter(isFiniteNumber);
  const ys = [quad[1], quad[3], quad[5], quad[7]].filter(isFiniteNumber);
  if (xs.length < 4 || ys.length < 4) return null;
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return {
    origin: { x: left, y: top },
    size: { width: right - left, height: bottom - top },
  };
}

export function quadFromRect(rect: PdfRect): number[] {
  const x = rect.origin.x;
  const y = rect.origin.y;
  const w = rect.size.width;
  const h = rect.size.height;
  return [x, y, x + w, y, x + w, y + h, x, y + h];
}

export function unionRects(rects: PdfRect[]): PdfRect | null {
  if (rects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.origin.x);
    top = Math.min(top, rect.origin.y);
    right = Math.max(right, rect.origin.x + rect.size.width);
    bottom = Math.max(bottom, rect.origin.y + rect.size.height);
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return {
    origin: { x: left, y: top },
    size: { width: right - left, height: bottom - top },
  };
}

export function geometryFromRects(rects: PdfRect[], color = PDF_HIGHLIGHT_COLOR): AnnotationGeometry {
  return {
    quads: rects.map(quadFromRect),
    color,
  };
}

export function rectsFromGeometry(geometry: AnnotationGeometry): PdfRect[] {
  const rects: PdfRect[] = [];
  for (const raw of geometry.quads) {
    const rect = rectFromQuad(numbersOf(raw));
    if (rect) rects.push(rect);
  }
  return rects;
}

function highlightObject(item: OwnPdfAnnotation, rects: PdfRect[], rect: PdfRect): PdfAnnotationObject {
  const color = item.geometry.color ?? PDF_HIGHLIGHT_COLOR;
  return {
    id: item.id,
    type: PdfAnnotationSubtype.HIGHLIGHT,
    pageIndex: item.pageIndex,
    rect,
    segmentRects: rects,
    color,
    strokeColor: color,
    opacity: 0.45,
    contents: item.note?.trim() || item.quote?.trim() || undefined,
    flags: ['print', 'readOnly', 'locked'],
  };
}

function excerptObject(item: OwnPdfAnnotation, rect: PdfRect): PdfAnnotationObject {
  const color = item.geometry.color ?? PDF_EXCERPT_STROKE;
  return {
    id: item.id,
    type: PdfAnnotationSubtype.SQUARE,
    pageIndex: item.pageIndex,
    rect,
    color: '#ffffff',
    opacity: 0.08,
    strokeWidth: 1.5,
    strokeColor: color,
    strokeStyle: PdfAnnotationBorderStyle.SOLID,
    contents: item.note?.trim() || item.quote?.trim() || undefined,
    flags: ['print', 'readOnly', 'locked'],
  };
}

export function toTransferItem(item: OwnPdfAnnotation): AnnotationTransferItem | null {
  const rects = rectsFromGeometry(item.geometry);
  const rect = unionRects(rects);
  if (!rect) return null;
  const annotation =
    item.kind === 'excerpt' ? excerptObject(item, rect) : highlightObject(item, rects, rect);
  return { annotation };
}

export function fromTransferItem(item: AnnotationTransferItem): OwnPdfAnnotation | null {
  const annotation = item.annotation;
  if (annotation.pageIndex == null || !annotation.id) return null;
  if (annotation.type === PdfAnnotationSubtype.HIGHLIGHT) {
    const rects = annotation.segmentRects?.length ? annotation.segmentRects : [annotation.rect];
    return {
      id: annotation.id,
      pageIndex: annotation.pageIndex,
      kind: 'highlight',
      geometry: geometryFromRects(rects, annotation.strokeColor ?? annotation.color ?? PDF_HIGHLIGHT_COLOR),
      quote: annotation.contents ?? null,
    };
  }
  if (annotation.type === PdfAnnotationSubtype.SQUARE) {
    return {
      id: annotation.id,
      pageIndex: annotation.pageIndex,
      kind: 'excerpt',
      geometry: geometryFromRects(
        [annotation.rect],
        annotation.strokeColor ?? annotation.color ?? PDF_EXCERPT_STROKE,
      ),
      quote: annotation.contents ?? null,
    };
  }
  return null;
}

export function importAnnotationsFromOwn(
  items: ReadonlyArray<OwnPdfAnnotation>,
): AnnotationTransferItem[] {
  const out: AnnotationTransferItem[] = [];
  for (const item of items) {
    const transfer = toTransferItem(item);
    if (transfer) out.push(transfer);
  }
  return out;
}
