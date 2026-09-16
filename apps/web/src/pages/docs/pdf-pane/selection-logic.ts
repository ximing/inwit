export type PdfRectLike = {
  origin: { x: number; y: number };
  size: { width: number; height: number };
};

/** Subset of EmbedPDF v2.15 FormattedSelection — field names taken from the package. */
export type FormattedSelectionLike = {
  pageIndex?: number;
  segmentRects?: PdfRectLike[];
  rect?: PdfRectLike;
};

function isRect(value: unknown): value is PdfRectLike {
  if (!value || typeof value !== 'object') return false;
  const origin = (value as PdfRectLike).origin;
  const size = (value as PdfRectLike).size;
  return (
    !!origin &&
    typeof origin.x === 'number' &&
    typeof origin.y === 'number' &&
    !!size &&
    typeof size.width === 'number' &&
    typeof size.height === 'number'
  );
}

/**
 * Prefer `segmentRects` (plugin-selection@2.15.0). Fall back to the page
 * bounding `rect` so a toolbar can still appear if the field is missing.
 */
export function rectsFromFormattedSelection(
  item: FormattedSelectionLike | null | undefined,
): PdfRectLike[] {
  if (!item) return [];
  if (Array.isArray(item.segmentRects)) {
    const rects = item.segmentRects.filter(isRect);
    if (rects.length > 0) return rects;
  }
  if (isRect(item.rect)) return [item.rect];
  return [];
}

/** Same threshold as EmbedPDF capture's marquee handler (`minDragPx`, default 5). */
export function isMarqueeLargeEnough(
  rect: PdfRectLike | null | undefined,
  scale: number,
  minDragPx = 5,
): boolean {
  if (!isRect(rect)) return false;
  const dragPx = Math.max(rect.size.width, rect.size.height) * scale;
  return dragPx > minDragPx;
}
