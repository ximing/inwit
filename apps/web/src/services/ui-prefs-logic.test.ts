import { describe, expect, it } from 'vitest';
import {
  CARD_RAIL_WIDTH_DEFAULT,
  CARD_RAIL_WIDTH_MAX,
  CARD_RAIL_WIDTH_MIN,
  cardRailWidthFromDrag,
  cardRailWidthFromKey,
  clampCardRailWidth,
  parseCardRailWidth,
} from './ui-prefs-logic';

describe('clampCardRailWidth', () => {
  it('clamps to the absolute min and max', () => {
    expect(clampCardRailWidth(100)).toBe(CARD_RAIL_WIDTH_MIN);
    expect(clampCardRailWidth(800)).toBe(CARD_RAIL_WIDTH_MAX);
    expect(clampCardRailWidth(300)).toBe(300);
  });

  it('caps at 48% of the pane so the document column keeps room', () => {
    expect(clampCardRailWidth(500, 800)).toBe(384);
    expect(clampCardRailWidth(200, 800)).toBe(CARD_RAIL_WIDTH_MIN);
  });
});

describe('parseCardRailWidth', () => {
  it('falls back to the default for missing or junk values', () => {
    expect(parseCardRailWidth(null)).toBe(CARD_RAIL_WIDTH_DEFAULT);
    expect(parseCardRailWidth('')).toBe(CARD_RAIL_WIDTH_DEFAULT);
    expect(parseCardRailWidth('nope')).toBe(CARD_RAIL_WIDTH_DEFAULT);
    expect(parseCardRailWidth('360')).toBe(360);
  });
});

describe('cardRailWidthFromDrag / cardRailWidthFromKey', () => {
  it('grows the rail when the pointer moves left', () => {
    expect(cardRailWidthFromDrag(300, 1000, 940)).toBe(360);
    expect(cardRailWidthFromDrag(300, 1000, 1060)).toBe(240);
  });

  it('maps arrow keys to width deltas', () => {
    expect(cardRailWidthFromKey(300, 'ArrowLeft')).toBe(316);
    expect(cardRailWidthFromKey(300, 'ArrowRight')).toBe(284);
    expect(cardRailWidthFromKey(300, 'Home')).toBe(CARD_RAIL_WIDTH_MAX);
    expect(cardRailWidthFromKey(300, 'End')).toBe(CARD_RAIL_WIDTH_MIN);
    expect(cardRailWidthFromKey(300, 'Enter')).toBeNull();
  });
});
