export const CARD_RAIL_WIDTH_DEFAULT = 300;
export const CARD_RAIL_WIDTH_MIN = 220;
export const CARD_RAIL_WIDTH_MAX = 520;
/** 禅模式和脑图用的右栏上限。列表模式仍停在 CARD_RAIL_WIDTH_MAX。 */
export const CARD_RAIL_WIDE_MAX = 1120;
export const CANVAS_PANE_WIDTH_DEFAULT = 560;

/** 脑图栏变宽时，正文至少留出标题和工具条能横排的宽度。 */
const WIDE_DOC_MIN = 520;

export function cardRailLimits(wide: boolean, paneWidth = 0): { min: number; max: number } {
  const absMax = wide ? CARD_RAIL_WIDE_MAX : CARD_RAIL_WIDTH_MAX;
  const fraction = wide ? 0.72 : 0.48;
  let paneCap = paneWidth > 0 ? Math.floor(paneWidth * fraction) : absMax;
  if (wide && paneWidth > 0) paneCap = Math.min(paneCap, paneWidth - WIDE_DOC_MIN);
  return { min: CARD_RAIL_WIDTH_MIN, max: Math.min(absMax, Math.max(CARD_RAIL_WIDTH_MIN, paneCap)) };
}

export function clampCardRailWidth(width: number, paneWidth = 0, wide = false): number {
  const { min, max } = cardRailLimits(wide, paneWidth);
  if (!Number.isFinite(width)) return wide ? CANVAS_PANE_WIDTH_DEFAULT : CARD_RAIL_WIDTH_DEFAULT;
  return Math.min(max, Math.max(min, Math.round(width)));
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

export function cardRailWidthFromKey(
  current: number,
  key: string,
  step = 16,
  limits?: { min: number; max: number },
): number | null {
  const min = limits?.min ?? CARD_RAIL_WIDTH_MIN;
  const max = limits?.max ?? CARD_RAIL_WIDTH_MAX;
  if (key === 'ArrowLeft') return current + step;
  if (key === 'ArrowRight') return current - step;
  if (key === 'Home') return max;
  if (key === 'End') return min;
  return null;
}

export const DOC_LIST_WIDTH_DEFAULT = 384;
export const DOC_LIST_WIDTH_MIN = 280;
export const DOC_LIST_WIDTH_MAX = 560;

export function clampDocListWidth(width: number): number {
  if (!Number.isFinite(width)) return DOC_LIST_WIDTH_DEFAULT;
  return Math.min(DOC_LIST_WIDTH_MAX, Math.max(DOC_LIST_WIDTH_MIN, Math.round(width)));
}

export function parseDocListWidth(raw: string | null | undefined): number {
  if (raw == null || raw === '') return DOC_LIST_WIDTH_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DOC_LIST_WIDTH_DEFAULT;
  return clampDocListWidth(n);
}

export const ASSISTANT_WIDTH_DEFAULT = 360;
export const ASSISTANT_WIDTH_MIN = 300;
export const ASSISTANT_WIDTH_MAX = 520;
/** Viewport narrower than this opens the conversation as an overlay. */
export const ASSISTANT_DOCK_MIN_PX = 1100;

export function clampAssistantWidth(width: number): number {
  if (!Number.isFinite(width)) return ASSISTANT_WIDTH_DEFAULT;
  return Math.min(ASSISTANT_WIDTH_MAX, Math.max(ASSISTANT_WIDTH_MIN, Math.round(width)));
}

export function parseAssistantWidth(raw: string | null | undefined): number {
  if (raw == null || raw === '') return ASSISTANT_WIDTH_DEFAULT;
  return clampAssistantWidth(Number(raw));
}

/** Panel sits on the right: dragging the left edge leftward increases width. */
export function assistantWidthFromDrag(startWidth: number, startX: number, clientX: number): number {
  return startWidth + (startX - clientX);
}

export function assistantWidthFromKey(current: number, key: string, step = 16): number | null {
  if (key === 'ArrowLeft') return current + step;
  if (key === 'ArrowRight') return current - step;
  if (key === 'Home') return ASSISTANT_WIDTH_MAX;
  if (key === 'End') return ASSISTANT_WIDTH_MIN;
  return null;
}

/** List sits on the left: dragging the right edge rightward increases width. */
export function docListWidthFromDrag(startWidth: number, startX: number, clientX: number): number {
  return startWidth + (clientX - startX);
}

export function docListWidthFromKey(current: number, key: string, step = 16): number | null {
  if (key === 'ArrowLeft') return current - step;
  if (key === 'ArrowRight') return current + step;
  if (key === 'Home') return DOC_LIST_WIDTH_MAX;
  if (key === 'End') return DOC_LIST_WIDTH_MIN;
  return null;
}
