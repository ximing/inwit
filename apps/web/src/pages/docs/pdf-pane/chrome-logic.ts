export const PDF_THUMBS_WIDTH_PX = 160;

export type PdfZoomPresetId = 'fit-width' | 'fit-page' | '50' | '100' | '150' | '200';

export type PdfZoomPreset = {
  id: PdfZoomPresetId;
  label: string;
  level: 'fit-width' | 'fit-page' | number;
};

export const PDF_ZOOM_PRESETS: readonly PdfZoomPreset[] = [
  { id: 'fit-width', label: '适合页宽', level: 'fit-width' },
  { id: 'fit-page', label: '适合整页', level: 'fit-page' },
  { id: '50', label: '50%', level: 0.5 },
  { id: '100', label: '100%', level: 1 },
  { id: '150', label: '150%', level: 1.5 },
  { id: '200', label: '200%', level: 2 },
];

export function formatZoomPercent(level: number): string {
  if (!Number.isFinite(level) || level <= 0) return '100%';
  return `${Math.round(level * 100)}%`;
}

export function matchingZoomPresetId(zoomLevel: unknown): PdfZoomPresetId | null {
  if (zoomLevel === 'fit-width' || zoomLevel === 'fit-page') return zoomLevel;
  if (typeof zoomLevel === 'number' && Number.isFinite(zoomLevel)) {
    const pct = Math.round(zoomLevel * 100);
    if (pct === 50) return '50';
    if (pct === 100) return '100';
    if (pct === 150) return '150';
    if (pct === 200) return '200';
  }
  return null;
}

/** 1-based page number; out-of-range values clamp to [1, totalPages]. */
export function parsePageInput(raw: string, totalPages: number): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  if (totalPages > 0) return Math.min(n, totalPages);
  return n;
}

export function searchResultLabel(activeIndex: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '0/0';
  const index = Number.isFinite(activeIndex) ? activeIndex : 0;
  const current = Math.min(Math.max(index, 0) + 1, total);
  return `${current}/${total}`;
}

export type PdfKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
};

export type PdfViewerKeyAction = 'prev-page' | 'next-page' | 'open-search' | 'close-search' | 'close-zoom';

const NON_TEXT_INPUT_TYPES = new Set(['button', 'submit', 'checkbox', 'radio', 'file', 'reset', 'image']);

export function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (target == null || typeof target !== 'object') return false;
  const node = target as {
    tagName?: string;
    type?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
  };
  const tag = typeof node.tagName === 'string' ? node.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (node.type ?? 'text').toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  if (node.isContentEditable) return true;
  if (typeof node.closest === 'function') {
    try {
      return Boolean(node.closest('input:not([type=button]):not([type=submit]), textarea, select, [contenteditable="true"]'));
    } catch {
      return false;
    }
  }
  return false;
}

export function pdfViewerKeyAction(
  event: PdfKeyEvent,
  ctx: { typing: boolean; searchOpen: boolean; zoomMenuOpen?: boolean },
): PdfViewerKeyAction | null {
  if (event.isComposing) return null;
  const mod = event.metaKey || event.ctrlKey;
  if (mod && !event.altKey && !event.shiftKey && (event.key === 'f' || event.key === 'F')) {
    if (event.repeat) return null;
    return 'open-search';
  }
  if (event.key === 'Escape' && !mod && !event.altKey) {
    if (ctx.searchOpen) return 'close-search';
    if (ctx.zoomMenuOpen) return 'close-zoom';
    return null;
  }
  if (ctx.typing || mod || event.altKey) return null;
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') return 'prev-page';
  if (event.key === 'ArrowRight' || event.key === 'PageDown') return 'next-page';
  return null;
}
