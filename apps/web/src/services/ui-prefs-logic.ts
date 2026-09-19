export const CARD_RAIL_WIDTH_DEFAULT = 300;
export const CARD_RAIL_WIDTH_MIN = 220;
export const CARD_RAIL_WIDTH_MAX = 520;

export function clampCardRailWidth(width: number, paneWidth = 0): number {
  const paneMax =
    paneWidth > 0 ? Math.max(CARD_RAIL_WIDTH_MIN, Math.floor(paneWidth * 0.48)) : CARD_RAIL_WIDTH_MAX;
  const max = Math.min(CARD_RAIL_WIDTH_MAX, paneMax);
  if (!Number.isFinite(width)) return CARD_RAIL_WIDTH_DEFAULT;
  return Math.min(max, Math.max(CARD_RAIL_WIDTH_MIN, Math.round(width)));
}

export function parseCardRailWidth(raw: string | null | undefined): number {
  if (raw == null || raw === '') return CARD_RAIL_WIDTH_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return CARD_RAIL_WIDTH_DEFAULT;
  return clampCardRailWidth(n);
}

/** Rail sits on the right: dragging the left edge leftward increases width. */
export function cardRailWidthFromDrag(startWidth: number, startX: number, clientX: number): number {
  return startWidth + (startX - clientX);
}

export function cardRailWidthFromKey(current: number, key: string, step = 16): number | null {
  if (key === 'ArrowLeft') return current + step;
  if (key === 'ArrowRight') return current - step;
  if (key === 'Home') return CARD_RAIL_WIDTH_MAX;
  if (key === 'End') return CARD_RAIL_WIDTH_MIN;
  return null;
}
