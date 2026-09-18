import { describe, expect, it } from 'vitest';
import type { PmJson } from '@inwit/doc-schema';
import { AppError } from '../errors.js';
import { htmlToContentJson } from './content-json.js';
import { buildFinalMarkdown, checkOpenTokenRate, resetOpenTokenRate } from './open-documents-logic.js';

function collect(node: PmJson, type: string, acc: PmJson[] = []): PmJson[] {
  if (node.type === type) acc.push(node);
  for (const child of node.content ?? []) collect(child, type, acc);
  return acc;
}

describe('htmlToContentJson', () => {
  it('converts headings, paragraphs, emphasis and links', () => {
    const doc = htmlToContentJson(
      '<h1>标题</h1><p>hello <strong>world</strong> and <a href="https://a.b">link</a></p>',
    );
    expect(collect(doc, 'heading')[0]).toMatchObject({ attrs: { level: 1 } });
    const strong = collect(doc, 'text').find((n) => n.marks?.some((m) => m.type === 'bold'));
    expect(strong?.text).toBe('world');
    const link = collect(doc, 'text').find((n) => n.marks?.some((m) => m.type === 'link'));
    expect(link?.marks?.[0]).toMatchObject({ type: 'link', attrs: { href: 'https://a.b' } });
  });

  it('keeps http(s) images and drops illegal srcs', () => {
    const doc = htmlToContentJson(
      '<p><img src="https://x/img.png" alt="pic"></p><p><img src="javascript:alert(1)"></p>',
    );
    const images = collect(doc, 'image');
    expect(images).toHaveLength(1);
    expect(images[0]?.attrs).toMatchObject({ src: 'https://x/img.png', alt: 'pic' });
  });

  it('converts video with src/poster/type into a video node', () => {
    const doc = htmlToContentJson(
      '<video src="https://x/v.mp4" poster="https://x/p.jpg" type="video/mp4" controls></video>',
    );
    const videos = collect(doc, 'video');
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({
      type: 'video',
      attrs: { src: 'https://x/v.mp4', poster: 'https://x/p.jpg', mime: 'video/mp4' },
    });
  });

  it('falls back to a source child for video src and mime', () => {
    const doc = htmlToContentJson(
      '<video controls><source src="https://x/v.webm" type="video/webm"></video>',
    );
    const videos = collect(doc, 'video');
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({
      type: 'video',
      attrs: { src: 'https://x/v.webm', mime: 'video/webm' },
    });
  });

  it('drops videos without any src', () => {
    const doc = htmlToContentJson('<video controls></video><p>留</p>');
    expect(collect(doc, 'video')).toEqual([]);
  });

  it('drops script/style content', () => {
    const doc = htmlToContentJson('<script>evil()</script><style>.x{}</style><p>visible</p>');
    expect(JSON.stringify(doc)).not.toContain('evil');
    expect(JSON.stringify(doc)).toContain('visible');
  });

  it('throws IMPORT_EMPTY on blank html', () => {
    expect(() => htmlToContentJson('<div>   </div>')).toThrowError(
      expect.objectContaining({ code: 'IMPORT_EMPTY' } as Partial<AppError>),
    );
  });

  it('prepends a source blockquote when sourceUrl is given', () => {
    const doc = htmlToContentJson('<p>正文</p>', 'https://example.com/a');
    const first = doc.content?.[0];
    expect(first?.type).toBe('blockquote');
    const link = collect(first!, 'text').find((n) => n.marks?.some((m) => m.type === 'link'));
    expect(link?.marks?.[0]).toMatchObject({ type: 'link', attrs: { href: 'https://example.com/a' } });
  });
});

describe('buildFinalMarkdown', () => {
  it('prepends the attribution line with sourceUrl', () => {
    const md = buildFinalMarkdown('body', 'https://example.com/a(b)');
    expect(md.startsWith('> 原文：[原文链接](<https://example.com/a(b)>)\n\nbody')).toBe(true);
  });

  it('returns markdown unchanged without sourceUrl', () => {
    expect(buildFinalMarkdown('body')).toBe('body');
  });
});

describe('checkOpenTokenRate', () => {
  it('allows up to the limit then throws RATE_LIMITED', () => {
    resetOpenTokenRate();
    const now = 1_000_000;
    for (let i = 0; i < 30; i += 1) {
      checkOpenTokenRate('token-1', now);
    }
    expect(() => checkOpenTokenRate('token-1', now)).toThrowError(
      expect.objectContaining({ status: 429 } as Partial<AppError>),
    );
  });

  it('tracks tokens independently and expires the window', () => {
    resetOpenTokenRate();
    const now = 2_000_000;
    for (let i = 0; i < 30; i += 1) {
      checkOpenTokenRate('token-2', now);
    }
    expect(() => checkOpenTokenRate('token-3', now)).not.toThrow();
    const hourLater = now + 60 * 60 * 1000 + 1;
    expect(() => checkOpenTokenRate('token-2', hourLater)).not.toThrow();
  });
});
