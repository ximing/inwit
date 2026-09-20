import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateDocumentInput, Document } from '@inwit/dto';
import { OPEN_MEDIA_REHOST_MAX } from '@inwit/dto';
import type { PmJson } from '@inwit/doc-schema';
import { serializePmJSONToMarkdown } from '@inwit/markdown';
import { AppError } from '../errors.js';

vi.mock('../assets/asset.service.js', () => ({
  importAssetFromUrl: vi.fn(),
}));

vi.mock('./document.service.js', () => ({
  createDocument: vi.fn(),
  getOwnedDocument: vi.fn(),
  toPublicDocument: vi.fn(),
}));

import { importAssetFromUrl } from '../assets/asset.service.js';
import { createDocument, getOwnedDocument, toPublicDocument } from './document.service.js';
import { createOpenDocument, getOpenDocument, rehostOpenDocumentMedia } from './open-documents.js';
import { resetOpenTokenRate } from './open-documents-logic.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN_ID = '22222222-2222-4222-8222-222222222222';
const DOC_ID = '33333333-3333-4333-8333-333333333333';
const PAT = { id: USER_ID, accessTokenId: TOKEN_ID };
const ASSET_A =
  'asset:users/11111111-1111-4111-8111-111111111111/doc-assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png';
const ASSET_B =
  'asset:users/11111111-1111-4111-8111-111111111111/doc-assets/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png';

function publicDoc(contentJson: CreateDocumentInput['contentJson'], title = '笔记'): Document {
  return {
    id: DOC_ID,
    userId: USER_ID,
    topicId: null,
    mapNodeId: null,
    title,
    description: null,
    contentJson,
    source: 'api',
    status: 'pending',
    failReason: null,
    answer: null,
    linkHint: null,
    fileMime: null,
    pageCount: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    deletedAt: null,
  };
}

describe('rehostOpenDocumentMedia', () => {
  beforeEach(() => {
    vi.mocked(importAssetFromUrl).mockReset();
  });

  it('rewrites successful imports and keeps failed srcs with their error codes', async () => {
    vi.mocked(importAssetFromUrl).mockImplementation(async (_userId, url) => {
      if (url.endsWith('ok.png')) return { key: 'k', assetSrc: ASSET_A };
      throw AppError.of(400, 'ASSET_IMPORT_BLOCKED');
    });

    const doc: PmJson = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'https://cdn.example/ok.png' } },
        { type: 'image', attrs: { src: 'https://cdn.example/bad.png' } },
      ],
    };
    const { contentJson, media } = await rehostOpenDocumentMedia(USER_ID, doc);
    expect(contentJson.content?.[0]).toMatchObject({ attrs: { src: ASSET_A } });
    expect(contentJson.content?.[1]).toMatchObject({ attrs: { src: 'https://cdn.example/bad.png' } });
    expect(media).toEqual({
      rehosted: 1,
      failed: [{ src: 'https://cdn.example/bad.png', code: 'ASSET_IMPORT_BLOCKED' }],
    });
    expect(importAssetFromUrl).toHaveBeenCalledTimes(2);
  });

  it('maps unknown errors to ASSET_IMPORT_FAILED and keeps the original src', async () => {
    vi.mocked(importAssetFromUrl).mockRejectedValue(new Error('network'));
    const doc: PmJson = {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'https://cdn.example/x.png' } }],
    };
    const { contentJson, media } = await rehostOpenDocumentMedia(USER_ID, doc);
    expect(contentJson.content?.[0]).toMatchObject({ attrs: { src: 'https://cdn.example/x.png' } });
    expect(media).toEqual({
      rehosted: 0,
      failed: [{ src: 'https://cdn.example/x.png', code: 'ASSET_IMPORT_FAILED' }],
    });
  });

  it('dedupes identical srcs into one import', async () => {
    vi.mocked(importAssetFromUrl).mockResolvedValue({ key: 'k', assetSrc: ASSET_B });
    const doc: PmJson = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'https://cdn.example/same.png' } },
        { type: 'image', attrs: { src: 'https://cdn.example/same.png' } },
      ],
    };
    const { contentJson, media } = await rehostOpenDocumentMedia(USER_ID, doc);
    expect(importAssetFromUrl).toHaveBeenCalledTimes(1);
    expect(media.rehosted).toBe(1);
    expect(contentJson.content?.[0]).toMatchObject({ attrs: { src: ASSET_B } });
    expect(contentJson.content?.[1]).toMatchObject({ attrs: { src: ASSET_B } });
  });

  it('does not fetch when the doc has no remote media', async () => {
    const doc: PmJson = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain' }] }],
    };
    const { media } = await rehostOpenDocumentMedia(USER_ID, doc);
    expect(importAssetFromUrl).not.toHaveBeenCalled();
    expect(media).toEqual({ rehosted: 0, failed: [] });
  });

  it('skips srcs past OPEN_MEDIA_REHOST_MAX without fetching them', async () => {
    vi.mocked(importAssetFromUrl).mockResolvedValue({ key: 'k', assetSrc: ASSET_A });
    const srcs = Array.from({ length: OPEN_MEDIA_REHOST_MAX + 1 }, (_, i) => {
      return `https://cdn.example/${String(i)}.png`;
    });
    const doc: PmJson = {
      type: 'doc',
      content: srcs.map((src) => ({ type: 'image', attrs: { src } })),
    };
    const { media } = await rehostOpenDocumentMedia(USER_ID, doc);
    expect(importAssetFromUrl).toHaveBeenCalledTimes(OPEN_MEDIA_REHOST_MAX);
    expect(media.rehosted).toBe(OPEN_MEDIA_REHOST_MAX);
    expect(media.failed).toEqual([
      { src: `https://cdn.example/${String(OPEN_MEDIA_REHOST_MAX)}.png`, code: 'ASSET_IMPORT_FAILED' },
    ]);
  });
});

describe('createOpenDocument / getOpenDocument', () => {
  beforeEach(() => {
    resetOpenTokenRate();
    vi.mocked(importAssetFromUrl).mockReset();
    vi.mocked(createDocument).mockReset();
    vi.mocked(getOwnedDocument).mockReset();
    vi.mocked(toPublicDocument).mockReset();
    vi.mocked(createDocument).mockImplementation(async (_userId, input) =>
      publicDoc(input.contentJson, input.title ?? '笔记'),
    );
  });

  it('requires a personal access token', async () => {
    await expect(
      createOpenDocument({ id: USER_ID }, { title: '笔记', markdown: 'hello' }),
    ).rejects.toMatchObject({ status: 403, code: 'PAT_REQUIRED' });
    await expect(getOpenDocument({ id: USER_ID }, DOC_ID)).rejects.toMatchObject({
      status: 403,
      code: 'PAT_REQUIRED',
    });
    expect(createDocument).not.toHaveBeenCalled();
    expect(getOwnedDocument).not.toHaveBeenCalled();
  });

  it('converts markdown to TipTap, stores source=api, and returns markdown', async () => {
    const created = await createOpenDocument(PAT, { title: '过拟合', markdown: '# 过拟合\n\n高偏差。' });
    expect(createDocument).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        title: '过拟合',
        source: 'api',
        contentJson: expect.objectContaining({ type: 'doc' }),
      }),
    );
    const stored = vi.mocked(createDocument).mock.calls[0]?.[1].contentJson as PmJson;
    expect(stored.content?.some((node) => node.type === 'heading')).toBe(true);
    expect(created.markdown).toContain('过拟合');
    expect(created.media).toEqual({ rehosted: 0, failed: [] });
    expect(created.source).toBe('api');
  });

  it('converts html, rehosts images, and prepends sourceUrl', async () => {
    vi.mocked(importAssetFromUrl).mockResolvedValue({ key: 'k', assetSrc: ASSET_A });
    const created = await createOpenDocument(PAT, {
      title: '转存',
      html: '<p>正文 <img src="https://cdn.example/pic.png" alt="图"></p>',
      sourceUrl: 'https://example.com/a',
    });
    const stored = vi.mocked(createDocument).mock.calls[0]?.[1].contentJson as PmJson;
    expect(stored.content?.[0]?.type).toBe('blockquote');
    const images = (stored.content ?? []).flatMap((node) =>
      node.type === 'image' ? [node] : (node.content ?? []).filter((child) => child.type === 'image'),
    );
    expect(images.some((node) => node.attrs?.src === ASSET_A)).toBe(true);
    expect(created.media).toEqual({ rehosted: 1, failed: [] });
    expect(importAssetFromUrl).toHaveBeenCalledWith(USER_ID, 'https://cdn.example/pic.png');
  });

  it('rejects empty html before create', async () => {
    await expect(
      createOpenDocument(PAT, { title: '空', html: '<div>   </div>' }),
    ).rejects.toMatchObject({ status: 400, code: 'IMPORT_EMPTY' });
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('GET serializes stored TipTap to markdown with an empty media report', async () => {
    const stored = publicDoc({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '正文' }] },
      ],
    });
    vi.mocked(getOwnedDocument).mockResolvedValue({} as never);
    vi.mocked(toPublicDocument).mockReturnValue(stored);

    const got = await getOpenDocument(PAT, DOC_ID);
    expect(getOwnedDocument).toHaveBeenCalledWith(USER_ID, DOC_ID);
    expect(got.markdown).toBe(serializePmJSONToMarkdown(stored.contentJson));
    expect(got.markdown).toContain('标题');
    expect(got.media).toEqual({ rehosted: 0, failed: [] });
  });
});
