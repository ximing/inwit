import { describe, expect, it } from 'vitest';
import {
  parseMarkdownToMdast,
  parseMarkdownToPmJSON,
  serializeMdastToMarkdown,
  serializePmJSONToMarkdown,
} from '../src/pipeline.js';
import { safeMediaSrc, type PmNode } from '../src/index.js';

const USER = '11111111-1111-4111-8111-111111111111';
const IMG = '22222222-2222-4222-8222-222222222222';
const VID = '33333333-3333-4333-8333-333333333333';
const POSTER = '44444444-4444-4444-8444-444444444444';

const ASSET_IMG = `asset:users/${USER}/doc-assets/${IMG}.png`;
const ASSET_VID = `asset:users/${USER}/doc-assets/${VID}.mp4`;
const ASSET_POSTER = `asset:users/${USER}/doc-assets/${POSTER}.jpg`;

function collect(node: PmNode, type: string, acc: PmNode[] = []): PmNode[] {
  if (node.type === type) acc.push(node);
  for (const child of node.content ?? []) collect(child, type, acc);
  return acc;
}

function roundTripPm(md: string): string {
  const first = serializePmJSONToMarkdown(parseMarkdownToPmJSON(md));
  return serializePmJSONToMarkdown(parseMarkdownToPmJSON(first));
}

describe('safeMediaSrc', () => {
  it('accepts asset: keys and http(s), rejects uploads path and other schemes', () => {
    expect(safeMediaSrc(ASSET_IMG)).toBe(ASSET_IMG);
    expect(safeMediaSrc('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(safeMediaSrc('http://example.com/a.png')).toBe('http://example.com/a.png');
    expect(safeMediaSrc(`/api/v1/uploads/${IMG}`)).toBeNull();
    expect(safeMediaSrc('javascript:alert(1)')).toBeNull();
    expect(safeMediaSrc('asset:users/not-a-uuid/doc-assets/x.png')).toBeNull();
    expect(safeMediaSrc(`asset:users/${USER}/other/${IMG}.png`)).toBeNull();
    expect(safeMediaSrc(`ASSET:users/${USER}/doc-assets/${IMG}.png`)).toBeNull();
  });
});

describe('asset: images', () => {
  it('parses asset: images into PM and round-trips', () => {
    const md = `A photo ![cover](${ASSET_IMG}) in a line.\n`;
    const images = collect(parseMarkdownToPmJSON(md), 'image');
    expect(images).toEqual([{ type: 'image', attrs: { src: ASSET_IMG, alt: 'cover' } }]);
    expect(roundTripPm(md)).toBe(serializePmJSONToMarkdown(parseMarkdownToPmJSON(md)));
    expect(serializePmJSONToMarkdown(parseMarkdownToPmJSON(md))).toContain(`![cover](${ASSET_IMG})`);
  });

  it('parses https images', () => {
    const md = '![x](https://example.com/a.png)\n';
    expect(collect(parseMarkdownToPmJSON(md), 'image')[0]?.attrs).toEqual({
      src: 'https://example.com/a.png',
      alt: 'x',
    });
  });

  it('drops illegal image src, including the old uploads path', () => {
    expect(collect(parseMarkdownToPmJSON(`![x](/api/v1/uploads/${IMG})\n`), 'image')).toEqual([]);
    expect(collect(parseMarkdownToPmJSON('![x](javascript:alert(1))\n'), 'image')).toEqual([]);
    expect(
      collect(parseMarkdownToPmJSON(`![x](asset:users/${USER}/nope/${IMG}.png)\n`), 'image'),
    ).toEqual([]);
    expect(
      serializePmJSONToMarkdown({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: 'javascript:alert(1)', alt: 'x' } }],
      }),
    ).not.toContain('javascript:');
  });
});

describe('::video leaf directive', () => {
  it('parses ::video{src} into a PM video node', () => {
    const md = `::video{src="${ASSET_VID}"}\n`;
    const videos = collect(parseMarkdownToPmJSON(md), 'video');
    expect(videos).toEqual([{ type: 'video', attrs: { src: ASSET_VID } }]);
    const tree = parseMarkdownToMdast(md);
    const leaf = tree.children[0] as { type: string; name?: string };
    expect(leaf.type).toBe('leafDirective');
    expect(leaf.name).toBe('video');
  });

  it('parses optional poster and mime', () => {
    const md = `::video{src="${ASSET_VID}" poster="${ASSET_POSTER}" mime="video/mp4"}\n`;
    expect(collect(parseMarkdownToPmJSON(md), 'video')).toEqual([
      { type: 'video', attrs: { src: ASSET_VID, poster: ASSET_POSTER, mime: 'video/mp4' } },
    ]);
  });

  it('serializes PM video back to ::video{...} and is idempotent', () => {
    const md = `::video{src="${ASSET_VID}" poster="${ASSET_POSTER}" mime="video/mp4"}\n`;
    const out = serializePmJSONToMarkdown(parseMarkdownToPmJSON(md));
    expect(out).toBe(
      `::video{src="${ASSET_VID}" poster="${ASSET_POSTER}" mime="video/mp4"}\n`,
    );
    expect(roundTripPm(md)).toBe(out);
    expect(serializeMdastToMarkdown(parseMarkdownToMdast(out))).toBe(out);
  });

  it('accepts http(s) video src', () => {
    const md = '::video{src="https://cdn.example.com/a.mp4"}\n';
    expect(collect(parseMarkdownToPmJSON(md), 'video')[0]?.attrs).toEqual({
      src: 'https://cdn.example.com/a.mp4',
    });
    expect(serializePmJSONToMarkdown(parseMarkdownToPmJSON(md))).toBe(
      '::video{src="https://cdn.example.com/a.mp4"}\n',
    );
  });

  it('drops illegal video src on parse and serialize', () => {
    expect(collect(parseMarkdownToPmJSON('::video{src="javascript:alert(1)"}\n'), 'video')).toEqual(
      [],
    );
    expect(
      collect(parseMarkdownToPmJSON(`::video{src="/api/v1/uploads/${VID}"}\n`), 'video'),
    ).toEqual([]);
    expect(collect(parseMarkdownToPmJSON('::video{src="asset:nope"}\n'), 'video')).toEqual([]);
    expect(
      serializePmJSONToMarkdown({
        type: 'doc',
        content: [{ type: 'video', attrs: { src: 'javascript:alert(1)' } }],
      }),
    ).not.toContain('::video');
  });

  it('drops illegal poster but keeps a valid src', () => {
    const md = `::video{src="${ASSET_VID}" poster="javascript:x"}\n`;
    expect(collect(parseMarkdownToPmJSON(md), 'video')).toEqual([
      { type: 'video', attrs: { src: ASSET_VID } },
    ]);
  });
});

describe('vitalEntity compatibility', () => {
  it('keeps [[kind:id]] as vitalEntity through PM round-trip', () => {
    const md = `Hello [[task:${USER}]] world.\n`;
    const entities = collect(parseMarkdownToPmJSON(md), 'vitalEntity');
    expect(entities).toEqual([{ type: 'vitalEntity', attrs: { kind: 'task', id: USER } }]);
    expect(serializePmJSONToMarkdown(parseMarkdownToPmJSON(md))).toBe(md);
    expect(roundTripPm(md)).toBe(md);
  });
});
