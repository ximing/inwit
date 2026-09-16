import { describe, expect, it } from 'vitest';
import {
  formatZoomPercent,
  isEditableKeyTarget,
  matchingZoomPresetId,
  parsePageInput,
  pdfViewerKeyAction,
  searchResultLabel,
} from './chrome-logic';

describe('formatZoomPercent', () => {
  it('rounds a scale factor to a percent label', () => {
    expect(formatZoomPercent(1)).toBe('100%');
    expect(formatZoomPercent(0.5)).toBe('50%');
    expect(formatZoomPercent(1.333)).toBe('133%');
  });

  it('falls back when the scale is not a positive finite number', () => {
    expect(formatZoomPercent(0)).toBe('100%');
    expect(formatZoomPercent(Number.NaN)).toBe('100%');
    expect(formatZoomPercent(-1)).toBe('100%');
  });
});

describe('matchingZoomPresetId', () => {
  it('maps fit modes and exact percents', () => {
    expect(matchingZoomPresetId('fit-width')).toBe('fit-width');
    expect(matchingZoomPresetId('fit-page')).toBe('fit-page');
    expect(matchingZoomPresetId(1)).toBe('100');
    expect(matchingZoomPresetId(0.5)).toBe('50');
    expect(matchingZoomPresetId(1.5)).toBe('150');
    expect(matchingZoomPresetId(2)).toBe('200');
  });

  it('returns null for in-between scales', () => {
    expect(matchingZoomPresetId(0.87)).toBeNull();
    expect(matchingZoomPresetId('automatic')).toBeNull();
  });
});

describe('parsePageInput', () => {
  it('parses a 1-based page number', () => {
    expect(parsePageInput('3', 10)).toBe(3);
    expect(parsePageInput(' 12 ', 20)).toBe(12);
  });

  it('clamps oversized values to the last page', () => {
    expect(parsePageInput('99', 5)).toBe(5);
  });

  it('rejects empty or non-integer input', () => {
    expect(parsePageInput('', 10)).toBeNull();
    expect(parsePageInput('0', 10)).toBeNull();
    expect(parsePageInput('3.2', 10)).toBeNull();
    expect(parsePageInput('a', 10)).toBeNull();
  });
});

describe('searchResultLabel', () => {
  it('renders 1-based x/y and clamps the active index', () => {
    expect(searchResultLabel(0, 4)).toBe('1/4');
    expect(searchResultLabel(3, 4)).toBe('4/4');
    expect(searchResultLabel(-1, 4)).toBe('1/4');
    expect(searchResultLabel(9, 4)).toBe('4/4');
  });

  it('renders 0/0 when there are no hits', () => {
    expect(searchResultLabel(0, 0)).toBe('0/0');
    expect(searchResultLabel(2, Number.NaN)).toBe('0/0');
  });
});

describe('isEditableKeyTarget', () => {
  it('treats text inputs and contenteditable as typing targets', () => {
    expect(isEditableKeyTarget({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isEditableKeyTarget({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(isEditableKeyTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableKeyTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('does not treat toolbar buttons as typing targets', () => {
    expect(isEditableKeyTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditableKeyTarget({ tagName: 'INPUT', type: 'button' })).toBe(false);
    expect(isEditableKeyTarget({ tagName: 'DIV' })).toBe(false);
    expect(isEditableKeyTarget(null)).toBe(false);
  });
});

const navBase = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

describe('pdfViewerKeyAction', () => {
  it('turns pages with arrows and PageUp/PageDown when not typing', () => {
    const idle = { typing: false, searchOpen: false };
    expect(pdfViewerKeyAction({ ...navBase, key: 'ArrowLeft' }, idle)).toBe('prev-page');
    expect(pdfViewerKeyAction({ ...navBase, key: 'PageUp' }, idle)).toBe('prev-page');
    expect(pdfViewerKeyAction({ ...navBase, key: 'ArrowRight' }, idle)).toBe('next-page');
    expect(pdfViewerKeyAction({ ...navBase, key: 'PageDown' }, idle)).toBe('next-page');
  });

  it('does not steal paging keys from an input', () => {
    const typing = { typing: true, searchOpen: false };
    expect(pdfViewerKeyAction({ ...navBase, key: 'ArrowLeft' }, typing)).toBeNull();
    expect(pdfViewerKeyAction({ ...navBase, key: 'PageDown' }, typing)).toBeNull();
  });

  it('opens in-document search on ⌘F / Ctrl+F even while typing', () => {
    expect(
      pdfViewerKeyAction({ ...navBase, key: 'f', metaKey: true }, { typing: true, searchOpen: false }),
    ).toBe('open-search');
    expect(
      pdfViewerKeyAction({ ...navBase, key: 'F', ctrlKey: true }, { typing: false, searchOpen: true }),
    ).toBe('open-search');
  });

  it('does not steal the global ⌘K shortcut', () => {
    expect(
      pdfViewerKeyAction({ ...navBase, key: 'k', metaKey: true }, { typing: false, searchOpen: false }),
    ).toBeNull();
  });

  it('closes search, then the zoom menu, on Escape', () => {
    expect(
      pdfViewerKeyAction({ ...navBase, key: 'Escape' }, { typing: true, searchOpen: true, zoomMenuOpen: true }),
    ).toBe('close-search');
    expect(
      pdfViewerKeyAction({ ...navBase, key: 'Escape' }, { typing: false, searchOpen: false, zoomMenuOpen: true }),
    ).toBe('close-zoom');
    expect(
      pdfViewerKeyAction({ ...navBase, key: 'Escape' }, { typing: false, searchOpen: false, zoomMenuOpen: false }),
    ).toBeNull();
  });

  it('ignores composing and repeated ⌘F', () => {
    expect(
      pdfViewerKeyAction(
        { ...navBase, key: 'ArrowRight', isComposing: true },
        { typing: false, searchOpen: false },
      ),
    ).toBeNull();
    expect(
      pdfViewerKeyAction(
        { ...navBase, key: 'f', metaKey: true, repeat: true },
        { typing: false, searchOpen: false },
      ),
    ).toBeNull();
  });
});
