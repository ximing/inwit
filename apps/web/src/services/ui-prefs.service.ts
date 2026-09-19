import { Service } from '@rabjs/react';
import {
  CARD_RAIL_WIDTH_DEFAULT,
  clampCardRailWidth,
  parseCardRailWidth,
} from './ui-prefs-logic';

export type DocMode = 'edit' | 'preview';

export const DOC_MODE_STORAGE_KEY = 'inwit-doc-mode';
export const CARD_RAIL_COLLAPSED_KEY = 'inwit-card-rail-collapsed';
export const CARD_RAIL_WIDTH_KEY = 'inwit-card-rail-width';
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
  navRailCollapsed = false;

  constructor() {
    super();
    this.docMode = readDocMode();
    this.cardRailCollapsed = readFlag(CARD_RAIL_COLLAPSED_KEY);
    this.navRailCollapsed = readFlag(NAV_RAIL_COLLAPSED_KEY);
    try {
      this.cardRailWidth = parseCardRailWidth(localStorage.getItem(CARD_RAIL_WIDTH_KEY));
    } catch {
      this.cardRailWidth = CARD_RAIL_WIDTH_DEFAULT;
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

  setNavRailCollapsed(collapsed: boolean): void {
    if (this.navRailCollapsed === collapsed) return;
    this.navRailCollapsed = collapsed;
    writeStorage(NAV_RAIL_COLLAPSED_KEY, collapsed ? '1' : '0');
  }

  toggleNavRail(): void {
    this.setNavRailCollapsed(!this.navRailCollapsed);
  }
}
