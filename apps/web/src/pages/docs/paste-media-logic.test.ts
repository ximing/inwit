import { describe, expect, it, vi } from 'vitest';
import {
  collectMediaFromHtml,
  decidePasteAction,
  fileFromDataUrl,
  needsRehostSrc,
  parseDataUrl,
  rehostPastedHtml,
  rewriteMediaSrcs,
} from './paste-media-logic';

const ASSET = 'asset:users/11111111-1111-4111-8111-111111111111/doc-assets/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png';
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('needsRehostSrc', () => {
  it('keeps owned asset: keys and rejects empty', () => {
    expect(needsRehostSrc(ASSET)).toBe(false);
    expect(needsRehostSrc('')).toBe(false);
    expect(needsRehostSrc('   ')).toBe(false);
  });

  it('flags http(s), protocol-relative, data, blob, and file URLs', () => {
    expect(needsRehostSrc('https://cdn.example/a.png')).toBe(true);
    expect(needsRehostSrc('http://127.0.0.1:4569/bucket/key')).toBe(true);
    expect(needsRehostSrc('//cdn.example/a.png')).toBe(true);
    expect(needsRehostSrc(`data:image/png;base64,${PNG_B64}`)).toBe(true);
    expect(needsRehostSrc('blob:https://example/1')).toBe(true);
    expect(needsRehostSrc('file:///Users/me/a.png')).toBe(true);
  });
});

describe('collectMediaFromHtml / decidePasteAction', () => {
  it('collects img, video, and source srcs and decodes entities', () => {
    const html = `
      <p>hi</p>
      <img src="https://cdn.example/a.png" alt="a">
      <img src='${ASSET}'>
      <video controls src="https://cdn.example/v.mp4"></video>
      <video><source src="https://cdn.example/v2.webm"></video>
      <img src="https://cdn.example/a.png&amp;x=1">
    `;
    const refs = collectMediaFromHtml(html);
    expect(refs.map((item) => item.src)).toEqual([
      'https://cdn.example/a.png',
      ASSET,
      'https://cdn.example/v.mp4',
      'https://cdn.example/v2.webm',
      'https://cdn.example/a.png&x=1',
    ]);
    expect(refs[0]?.kind).toBe('image');
    expect(refs[2]?.kind).toBe('video');
  });

  it('rehosts HTML when any media is external, otherwise files-only or default', () => {
    expect(decidePasteAction('<img src="https://cdn.example/a.png">', 0)).toBe('rehost-html');
    expect(decidePasteAction(`<img src="${ASSET}">`, 1)).toBe('default');
    expect(decidePasteAction('<p>hello</p>', 1)).toBe('default');
    expect(decidePasteAction('', 2)).toBe('ingest-files');
    expect(decidePasteAction('plain text', 1)).toBe('ingest-files');
  });
});

describe('parseDataUrl / rewriteMediaSrcs', () => {
  it('decodes a PNG data URL', () => {
    const parsed = parseDataUrl(`data:image/png;base64,${PNG_B64}`);
    expect(parsed?.mime).toBe('image/png');
    expect(parsed?.bytes[0]).toBe(0x89);
    expect(parsed?.bytes[1]).toBe(0x50);
    const file = fileFromDataUrl(`data:image/png;base64,${PNG_B64}`);
    expect(file?.name).toBe('paste.png');
    expect(file?.type).toBe('image/png');
  });

  it('rewrites quoted src values without touching unrelated URLs', () => {
    const html = `<img src="https://a/x.png"><img src='https://a/x.png?y'><img src=https://b/z.png>`;
    const next = rewriteMediaSrcs(
      html,
      new Map([
        ['https://a/x.png', 'asset:one'],
        ['https://b/z.png', 'asset:two'],
      ]),
    );
    expect(next).toBe(`<img src="asset:one"><img src='https://a/x.png?y'><img src=asset:two>`);
  });
});

describe('rehostPastedHtml', () => {
  it('uploads data URLs and remote srcs, leaving owned asset: keys', async () => {
    const storeFile = vi.fn(async (file: File) => `asset:${file.name}`);
    const fetchSrc = vi.fn(async (src: string) => {
      if (src === 'https://cdn.example/a.png') return new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
      return null;
    });
    const html = `<p>x</p><img src="https://cdn.example/a.png"><img src="${ASSET}"><img src="data:image/png;base64,${PNG_B64}">`;
    const result = await rehostPastedHtml(html, [], { storeFile, fetchSrc });
    expect(result.failed).toEqual([]);
    expect(result.assetSrcs).toEqual(['asset:a.png', 'asset:paste.png']);
    expect(result.html).toContain('src="asset:a.png"');
    expect(result.html).toContain(`src="${ASSET}"`);
    expect(result.html).toContain('src="asset:paste.png"');
    expect(storeFile).toHaveBeenCalledTimes(2);
  });

  it('falls back to clipboard files then importUrl when fetch fails', async () => {
    const storeFile = vi.fn(async (file: File) => `asset:${file.name}`);
    const importUrl = vi.fn(async (url: string) => `asset:imported:${url}`);
    const extra = [new File([new Uint8Array([9])], 'clip.png', { type: 'image/png' })];
    const html = `<img src="file:///tmp/a.png"><img src="https://blocked.example/b.png">`;
    const result = await rehostPastedHtml(html, extra, {
      storeFile,
      fetchSrc: async () => null,
      importUrl,
    });
    expect(result.failed).toEqual([]);
    expect(result.html).toContain('src="asset:clip.png"');
    expect(result.html).toContain('src="asset:imported:https://blocked.example/b.png"');
    expect(importUrl).toHaveBeenCalledWith('https://blocked.example/b.png');
  });

  it('records failures when nothing can supply bytes', async () => {
    const result = await rehostPastedHtml('<img src="https://gone.example/a.png">', [], {
      storeFile: async () => 'asset:nope',
      fetchSrc: async () => null,
    });
    expect(result.failed).toEqual(['https://gone.example/a.png']);
    expect(result.html).toContain('https://gone.example/a.png');
    expect(result.assetSrcs).toEqual([]);
  });
});
