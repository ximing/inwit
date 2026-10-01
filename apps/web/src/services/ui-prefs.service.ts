import { Service } from '@rabjs/react';
import {
  CANVAS_PANE_WIDTH_DEFAULT,
  CARD_RAIL_WIDTH_DEFAULT,
  DOC_LIST_WIDTH_DEFAULT,
  clampCardRailWidth,
  clampDocListWidth,
  parseCardRailWidth,
  parseDocListWidth,
} from './ui-prefs-logic';

export type DocMode = 'edit' | 'preview';
export type CardLayout = 'list' | 'map';

export const DOC_MODE_STORAGE_KEY = 'inwit-doc-mode';
export const CARD_RAIL_COLLAPSED_KEY = 'inwit-card-rail-collapsed';
export const CARD_RAIL_WIDTH_KEY = 'inwit-card-rail-width';
export const CANVAS_PANE_WIDTH_KEY = 'inwit-canvas-pane-width';
export const CARD_LAYOUT_KEY = 'inwit-card-layout';
export const ZEN_MODE_KEY = 'inwit-zen-mode';
export const DOC_LIST_WIDTH_KEY = 'inwit-doc-list-width';
export const NAV_RAIL_COLLAPSED_KEY = 'inwit-nav-rail-collapsed';

/** Pane narrower than this docks the card rail as an overlay instead of a column. */
export const CARD_RAIL_NARROW_PX = 880;

function readDocMode(): DocMode {
  try {
    const raw = localStorage.getItem(DOC_MODE_STORAGE_KEY);
    if (raw === 'edit' || raw === 'preview') return raw;
  } catch {
    // private mode / blocked storage
  }
  return 'edit';
}

function readCardLayout(): CardLayout {
  try {
    const raw = localStorage.getItem(CARD_LAYOUT_KEY);
    if (raw === 'list' || raw === 'map') return raw;
  } catch {
    // private mode / blocked storage
  }
  return 'list';
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore quota / private mode
  }
}

export class UiPrefsService extends Service {
  docMode: DocMode = 'edit';
  cardRailCollapsed = false;
  cardRailWidth = CARD_RAIL_WIDTH_DEFAULT;
  canvasPaneWidth = CANVAS_PANE_WIDTH_DEFAULT;
  cardLayout: CardLayout = 'list';
  zenMode = false;
  docListWidth = DOC_LIST_WIDTH_DEFAULT;
  navRailCollapsed = false;

  constructor() {
    super();
    this.docMode = readDocMode();
    this.cardLayout = readCardLayout();
    this.cardRailCollapsed = readFlag(CARD_RAIL_COLLAPSED_KEY);
    this.navRailCollapsed = readFlag(NAV_RAIL_COLLAPSED_KEY);
    this.zenMode = readFlag(ZEN_MODE_KEY);
    try {
      this.cardRailWidth = parseCardRailWidth(localStorage.getItem(CARD_RAIL_WIDTH_KEY));
      const canvasRaw = localStorage.getItem(CANVAS_PANE_WIDTH_KEY);
      this.canvasPaneWidth =
        canvasRaw == null || canvasRaw === ''
          ? CANVAS_PANE_WIDTH_DEFAULT
          : clampCardRailWidth(Number(canvasRaw), 0, true);
      this.docListWidth = parseDocListWidth(localStorage.getItem(DOC_LIST_WIDTH_KEY));
    } catch {
      this.cardRailWidth = CARD_RAIL_WIDTH_DEFAULT;
      this.canvasPaneWidth = CANVAS_PANE_WIDTH_DEFAULT;
      this.docListWidth = DOC_LIST_WIDTH_DEFAULT;
    }
  }

  get editing(): boolean {
    return this.docMode === 'edit';
  }

  setDocMode(mode: DocMode): void {
    if (this.docMode === mode) return;
    this.docMode = mode;
    writeStorage(DOC_MODE_STORAGE_KEY, mode);
  }

  setCardRailCollapsed(collapsed: boolean): void {
    if (this.cardRailCollapsed === collapsed) return;
    this.cardRailCollapsed = collapsed;
    writeStorage(CARD_RAIL_COLLAPSED_KEY, collapsed ? '1' : '0');
  }

  setCardRailWidth(width: number, paneWidth = 0): void {
    const next = clampCardRailWidth(width, paneWidth);
    if (next === this.cardRailWidth) return;
    this.cardRailWidth = next;
    writeStorage(CARD_RAIL_WIDTH_KEY, String(next));
  }

  setCanvasPaneWidth(width: number, paneWidth = 0): void {
    const next = clampCardRailWidth(width, paneWidth, true);
    if (next === this.canvasPaneWidth) return;
    this.canvasPaneWidth = next;
    writeStorage(CANVAS_PANE_WIDTH_KEY, String(next));
  }

  setCardLayout(layout: CardLayout): void {
    if (this.cardLayout === layout) return;
    this.cardLayout = layout;
    writeStorage(CARD_LAYOUT_KEY, layout);
  }

  setZenMode(on: boolean): void {
    if (this.zenMode === on) return;
    this.zenMode = on;
    writeStorage(ZEN_MODE_KEY, on ? '1' : '0');
  }

  setDocListWidth(width: number): void {
    const next = clampDocListWidth(width);
    if (next === this.docListWidth) return;
    this.docListWidth = next;
    writeStorage(DOC_LIST_WIDTH_KEY, String(next));
  }

  setNavRailCollapsed(collapsed: boolean): void {
    if (this.navRailCollapsed === collapsed) return;
    this.navRailCollapsed = collapsed;
    writeStorage(NAV_RAIL_COLLAPSED_KEY, collapsed ? '1' : '0');
  }

  toggleNavRail(): void {
    this.setNavRailCollapsed(!this.navRailCollapsed);
  }
}
