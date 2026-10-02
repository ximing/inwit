import { describe, expect, it } from 'vitest';
import {
  base64ByteLength,
  clipPdfQuote,
  geometryFromQuads,
  isMarqueeLargeEnough,
  parsePdfViewerEvent,
  pdfGoToInjection,
  pdfMarksFromAnnotations,
  pdfMarqueeInjection,
  pdfOpenInjection,
  pdfPageLabel,
  pdfPaintInjection,
  PDF_EXCERPT_COLOR,
  PDF_HIGHLIGHT_COLOR,
  pdfThemeInjection,
  quadArea,
} from './pdf-logic';

describe('parsePdfViewerEvent', () => {
  it('accepts a ready object or JSON string', () => {
    expect(parsePdfViewerEvent({ type: 'ready' })).toEqual({ ok: true, value: { type: 'ready' } });
    expect(parsePdfViewerEvent('{"type":"ready","ignored":1}')).toEqual({
      ok: true,
      value: { type: 'ready' },
    });
  });

  it('accepts loaded, page, selection, and error', () => {
    expect(parsePdfViewerEvent({ type: 'loaded', pageCount: 12 })).toEqual({
      ok: true,
      value: { type: 'loaded', pageCount: 12 },
    });
    expect(parsePdfViewerEvent('{"type":"page","pageIndex":0}')).toEqual({
      ok: true,
      value: { type: 'page', pageIndex: 0 },
    });
    expect(parsePdfViewerEvent({ type: 'selection', text: '引用', pageIndex: 2 })).toEqual({
      ok: true,
      value: { type: 'selection', text: '引用', pageIndex: 2, quads: [] },
    });
    expect(parsePdfViewerEvent({ type: 'selection', text: '', pageIndex: 0 })).toEqual({
      ok: true,
      value: { type: 'selection', text: '', pageIndex: 0, quads: [] },
    });
    expect(parsePdfViewerEvent({ type: 'error', message: '无法打开 PDF' })).toEqual({
      ok: true,
      value: { type: 'error', message: '无法打开 PDF' },
    });
  });

  it('rejects unknown types and bad counts', () => {
    expect(parsePdfViewerEvent({ type: 'thumb' }).ok).toBe(false);
    expect(parsePdfViewerEvent({ type: 'loaded', pageCount: 0 }).ok).toBe(false);
    expect(parsePdfViewerEvent({ type: 'loaded', pageCount: 1.5 }).ok).toBe(false);
    expect(parsePdfViewerEvent({ type: 'loaded', pageCount: '3' }).ok).toBe(false);
    expect(parsePdfViewerEvent({ type: 'page', pageIndex: -1 }).ok).toBe(false);
    expect(parsePdfViewerEvent({ type: 'page', pageIndex: 1.2 }).ok).toBe(false);
    expect(parsePdfViewerEvent({ type: 'selection', text: 1, pageIndex: 0 }).ok).toBe(false);
    expect(parsePdfViewerEvent({ type: 'selection', text: 'a', pageIndex: -1 }).ok).toBe(false);
    expect(parsePdfViewerEvent({ type: 'error', message: '   ' }).ok).toBe(false);
    expect(parsePdfViewerEvent('not-json').ok).toBe(false);
    expect(parsePdfViewerEvent(null).ok).toBe(false);
    expect(parsePdfViewerEvent(['ready']).ok).toBe(false);
  });
});

describe('pdfPageLabel', () => {
  it('formats 1-based page numbers', () => {
    expect(pdfPageLabel(2, 12)).toBe('3 / 12');
    expect(pdfPageLabel(0, 1)).toBe('1 / 1');
    expect(pdfPageLabel(11, 12)).toBe('12 / 12');
  });

  it('returns empty for invalid counts', () => {
    expect(pdfPageLabel(12, 12)).toBe('');
    expect(pdfPageLabel(-1, 5)).toBe('');
    expect(pdfPageLabel(0, 0)).toBe('');
    expect(pdfPageLabel(1.5, 5)).toBe('');
    expect(pdfPageLabel(Number.NaN, 5)).toBe('');
  });
});

describe('clipPdfQuote', () => {
  it('trims then clips by code point', () => {
    expect(clipPdfQuote('\n  hello \n')).toBe('hello');
    expect(clipPdfQuote('   ')).toBe('');
    expect(clipPdfQuote('abcdef', 3)).toBe('abc');
    expect(clipPdfQuote('  abcdef  ', 3)).toBe('abc');
    expect(clipPdfQuote('👍a', 1)).toBe('👍');
    expect(clipPdfQuote('hello', 0)).toBe('');
    expect(clipPdfQuote(` ${'a'.repeat(4002)} `)).toHaveLength(4000);
  });
});

describe('webview injections', () => {
  it('embeds a URL as a JSON string literal', () => {
    const url = 'https://x.test/a.pdf?q="1"&b=</script>\n';
    const script = pdfOpenInjection(url);
    expect(script).toBe(
      `window.__pdfViewer&&window.__pdfViewer.open(${JSON.stringify(url)});true;`,
    );
    expect(() => new Function(script)).not.toThrow();
  });

  it('only injects light or dark', () => {
    expect(pdfThemeInjection('dark')).toBe(
      'window.__pdfViewer&&window.__pdfViewer.setTheme("dark");true;',
    );
    expect(pdfThemeInjection('light')).toContain('"light"');
    expect(pdfThemeInjection('system' as 'light')).toContain('"light"');
  });

  it('paints marks, jumps, and toggles the marquee', () => {
    const quad = [1, 2, 11, 2, 11, 8, 1, 8];
    const marks = [{ id: 'a', pageIndex: 1, kind: 'highlight' as const, quads: [quad] }];
    expect(pdfPaintInjection(marks)).toContain(JSON.stringify(marks));
    expect(pdfGoToInjection(3)).toContain('goToPage(3)');
    expect(pdfMarqueeInjection(true)).toContain('setMarquee(true)');
    expect(() => new Function(pdfPaintInjection(marks))).not.toThrow();
  });
});

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('pdf quads and marquee', () => {
  it('keeps a real selection quad and rejects a broken one', () => {
    const quad = [10, 20, 40, 20, 40, 28, 10, 28];
    const parsed = parsePdfViewerEvent({
      type: 'selection',
      text: '引用',
      pageIndex: 1,
      quads: [quad],
    });
    expect(parsed).toEqual({
      ok: true,
      value: { type: 'selection', text: '引用', pageIndex: 1, quads: [quad] },
    });
    expect(quadArea(quad)).toBeGreaterThan(0);
    expect(geometryFromQuads([quad], PDF_HIGHLIGHT_COLOR)).toEqual({
      quads: [quad],
      color: PDF_HIGHLIGHT_COLOR,
    });
    expect(geometryFromQuads([], PDF_HIGHLIGHT_COLOR)).toBeNull();
    expect(parsePdfViewerEvent({ type: 'selection', text: 'a', pageIndex: 0, quads: [[1]] }).ok).toBe(
      false,
    );
  });

  it('accepts a large excerpt and rejects an empty marquee', () => {
    const bytes = base64ByteLength(PNG);
    expect(bytes).toBeGreaterThan(0);
    const quad = [0, 0, 40, 0, 40, 24, 0, 24];
    const parsed = parsePdfViewerEvent({
      type: 'excerpt',
      pageIndex: 2,
      quads: [quad],
      mime: 'image/png',
      base64: PNG,
      byteLength: bytes,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.value.type === 'excerpt') {
      expect(parsed.value.quads).toEqual([quad]);
      expect(geometryFromQuads(parsed.value.quads, PDF_EXCERPT_COLOR)?.quads).toEqual([quad]);
    }
    expect(
      parsePdfViewerEvent({
        type: 'excerpt',
        pageIndex: 0,
        quads: [],
        mime: 'image/png',
        base64: PNG,
        byteLength: bytes,
      }).ok,
    ).toBe(false);
    expect(isMarqueeLargeEnough({ width: 4, height: 4 }, 1)).toBe(false);
    expect(isMarqueeLargeEnough({ width: 8, height: 2 }, 1)).toBe(true);
  });

  it('paints saved highlights and excerpt regions, skipping empty quads', () => {
    const quad = [1, 2, 5, 2, 5, 6, 1, 6];
    expect(
      pdfMarksFromAnnotations([
        {
          id: 'h',
          kind: 'pdf',
          pageIndex: 0,
          imageKey: null,
          geometry: { quads: [quad] },
        },
        {
          id: 'e',
          kind: 'pdf',
          pageIndex: 3,
          imageKey: 'users/u/excerpt.png',
          geometry: { quads: [quad] },
        },
        {
          id: 'empty',
          kind: 'pdf',
          pageIndex: 1,
          imageKey: null,
          geometry: { quads: [] },
        },
      ]),
    ).toEqual([
      { id: 'h', pageIndex: 0, kind: 'highlight', quads: [quad] },
      { id: 'e', pageIndex: 3, kind: 'excerpt', quads: [quad] },
    ]);
  });
});
