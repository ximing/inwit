import { describe, expect, it } from 'vitest';
import {
  clipPdfQuote,
  parsePdfViewerEvent,
  pdfOpenInjection,
  pdfPageLabel,
  pdfThemeInjection,
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
      value: { type: 'selection', text: '引用', pageIndex: 2 },
    });
    expect(parsePdfViewerEvent({ type: 'selection', text: '', pageIndex: 0 })).toEqual({
      ok: true,
      value: { type: 'selection', text: '', pageIndex: 0 },
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
});
