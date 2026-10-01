import { describe, expect, it } from 'vitest';
import {
  CARD_RAIL_WIDTH_DEFAULT,
  CARD_RAIL_WIDTH_MAX,
  CARD_RAIL_WIDTH_MIN,
  DOC_LIST_WIDTH_DEFAULT,
  DOC_LIST_WIDTH_MAX,
  DOC_LIST_WIDTH_MIN,
  ASSISTANT_WIDTH_DEFAULT,
  ASSISTANT_WIDTH_MAX,
  ASSISTANT_WIDTH_MIN,
  assistantWidthFromDrag,
  assistantWidthFromKey,
  cardRailWidthFromDrag,
  cardRailWidthFromKey,
  clampAssistantWidth,
  clampCardRailWidth,
  clampDocListWidth,
  docListWidthFromDrag,
  docListWidthFromKey,
  parseAssistantWidth,
  parseCardRailWidth,
  parseDocListWidth,
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

  it('lets the mind-map rail grow past the list maximum, while the document keeps 520px', () => {
    expect(clampCardRailWidth(800, 0, true)).toBe(800);
    expect(clampCardRailWidth(2000, 0, true)).toBe(1120);
    expect(clampCardRailWidth(900, 1000, true)).toBe(480);
    expect(clampCardRailWidth(900, 1600, true)).toBe(900);
    expect(cardRailWidthFromKey(560, 'Home', 16, { min: 220, max: 1120 })).toBe(1120);
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

describe('clampDocListWidth / parseDocListWidth', () => {
  it('clamps to the absolute min and max', () => {
    expect(clampDocListWidth(100)).toBe(DOC_LIST_WIDTH_MIN);
    expect(clampDocListWidth(900)).toBe(DOC_LIST_WIDTH_MAX);
    expect(clampDocListWidth(400)).toBe(400);
  });

  it('falls back to the default for missing or junk values', () => {
    expect(parseDocListWidth(null)).toBe(DOC_LIST_WIDTH_DEFAULT);
    expect(parseDocListWidth('')).toBe(DOC_LIST_WIDTH_DEFAULT);
    expect(parseDocListWidth('nope')).toBe(DOC_LIST_WIDTH_DEFAULT);
    expect(parseDocListWidth('420')).toBe(420);
  });
});

describe('clampAssistantWidth / parseAssistantWidth', () => {
  it('clamps to the conversation rail min and max', () => {
    expect(clampAssistantWidth(100)).toBe(ASSISTANT_WIDTH_MIN);
    expect(clampAssistantWidth(900)).toBe(ASSISTANT_WIDTH_MAX);
    expect(clampAssistantWidth(360)).toBe(360);
    expect(clampAssistantWidth(Number.NaN)).toBe(ASSISTANT_WIDTH_DEFAULT);
  });

  it('falls back to the default for missing or junk values', () => {
    expect(parseAssistantWidth(null)).toBe(ASSISTANT_WIDTH_DEFAULT);
    expect(parseAssistantWidth('')).toBe(ASSISTANT_WIDTH_DEFAULT);
    expect(parseAssistantWidth('nope')).toBe(ASSISTANT_WIDTH_DEFAULT);
    expect(parseAssistantWidth('400')).toBe(400);
  });
});

describe('assistantWidthFromDrag / assistantWidthFromKey', () => {
  it('grows the rail when the pointer moves left', () => {
    expect(assistantWidthFromDrag(360, 1000, 940)).toBe(420);
    expect(assistantWidthFromDrag(360, 1000, 1060)).toBe(300);
  });

  it('maps arrow keys to width deltas', () => {
    expect(assistantWidthFromKey(360, 'ArrowLeft')).toBe(376);
    expect(assistantWidthFromKey(360, 'ArrowRight')).toBe(344);
    expect(assistantWidthFromKey(360, 'Home')).toBe(ASSISTANT_WIDTH_MAX);
    expect(assistantWidthFromKey(360, 'End')).toBe(ASSISTANT_WIDTH_MIN);
    expect(assistantWidthFromKey(360, 'Enter')).toBeNull();
  });
});

describe('docListWidthFromDrag / docListWidthFromKey', () => {
  it('grows the list when the pointer moves right', () => {
    expect(docListWidthFromDrag(384, 500, 560)).toBe(444);
    expect(docListWidthFromDrag(384, 500, 440)).toBe(324);
  });

  it('maps arrow keys to width deltas', () => {
    expect(docListWidthFromKey(384, 'ArrowRight')).toBe(400);
    expect(docListWidthFromKey(384, 'ArrowLeft')).toBe(368);
    expect(docListWidthFromKey(384, 'Home')).toBe(DOC_LIST_WIDTH_MAX);
    expect(docListWidthFromKey(384, 'End')).toBe(DOC_LIST_WIDTH_MIN);
    expect(docListWidthFromKey(384, 'Enter')).toBeNull();
  });
});
