import { STORAGE_FILE_PAGE_LIMIT } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import {
  assembleStorageFiles,
  assetKeysInContent,
  collectFileRefs,
  kindOfOwnedKey,
  selectStorageFiles,
  storagePrefixesFor,
  summarizeStorageFiles,
  type FileRefRows,
  type StorageObjectMeta,
} from './files-logic.js';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const DOC = '22222222-2222-4222-8222-222222222222';
const DOC_2 = '22222222-2222-4222-8222-222222222223';
const CARD = '33333333-3333-4333-8333-333333333333';
const NOTE = '44444444-4444-4444-8444-444444444444';
const CANVAS = '55555555-5555-4555-8555-555555555555';
const IMG = '66666666-6666-4666-8666-666666666666';
const VID = '77777777-7777-4777-8777-777777777777';
const POSTER = '88888888-8888-4888-8888-888888888888';

const SOURCE = `docs/${USER}/${DOC}/source.pdf`;
const SHOT = `docs/${USER}/${DOC}/source.png`;
const EXCERPT = `docs/${USER}/${DOC}/excerpts/${IMG}.png`;
const MEDIA = `users/${USER}/doc-assets/${IMG}.png`;
const VIDEO = `users/${USER}/doc-assets/${VID}.mp4`;
const POSTER_KEY = `users/${USER}/doc-assets/${POSTER}.jpg`;
const AVATAR = `avatars/${USER}/${IMG}.webp`;
const OLD_AVATAR = `avatars/${USER}/${VID}.png`;

function rows(partial: Partial<FileRefRows> = {}): FileRefRows {
  return {
    documents: [],
    cards: [],
    annotations: [],
    canvas: [],
    avatarKey: null,
    ...partial,
  };
}

function object(key: string, sizeBytes: number, modifiedAt: string | null): StorageObjectMeta {
  return { key, sizeBytes, modifiedAt };
}

const query = {
  kind: 'all' as const,
  unused: '0' as const,
  sort: 'modified' as const,
  limit: STORAGE_FILE_PAGE_LIMIT,
  offset: 0,
};

describe('storagePrefixesFor / kindOfOwnedKey', () => {
  it('lists only the signed-in account prefixes', () => {
    expect(storagePrefixesFor(USER)).toEqual([
      `docs/${USER}/`,
      `users/${USER}/doc-assets/`,
      `avatars/${USER}/`,
    ]);
    expect(() => storagePrefixesFor('../etc')).toThrow(AppError);
  });

  it('classifies owned keys and drops everyone else', () => {
    expect(kindOfOwnedKey(USER, SOURCE)).toBe('source');
    expect(kindOfOwnedKey(USER, SHOT)).toBe('source');
    expect(kindOfOwnedKey(USER, EXCERPT)).toBe('excerpt');
    expect(kindOfOwnedKey(USER, MEDIA)).toBe('media');
    expect(kindOfOwnedKey(USER, VIDEO)).toBe('media');
    expect(kindOfOwnedKey(USER, AVATAR)).toBe('avatar');
    expect(kindOfOwnedKey(USER, `docs/${USER}/${DOC}/notes/orphan.bin`)).toBe('source');
    expect(kindOfOwnedKey(USER, `docs/${OTHER}/${DOC}/source.pdf`)).toBeNull();
    expect(kindOfOwnedKey(USER, `users/${USER}/../${OTHER}/doc-assets/${IMG}.png`)).toBeNull();
    expect(kindOfOwnedKey(USER, `docs/${USER}/`)).toBeNull();
  });
});

describe('assetKeysInContent', () => {
  it('reads image and video srcs and posters, once each', () => {
    const keys = assetKeysInContent(USER, {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: `asset:${MEDIA}` }] },
        { type: 'image', attrs: { src: `asset:${MEDIA}`, alt: '图' } },
        { type: 'image', attrs: { src: `asset:${MEDIA}` } },
        { type: 'video', attrs: { src: `asset:${VIDEO}`, poster: `asset:${POSTER_KEY}` } },
        { type: 'image', attrs: { src: `asset:users/${OTHER}/doc-assets/${IMG}.png` } },
        { type: 'image', attrs: { src: 'https://example.com/a.png' } },
      ],
    });
    expect(keys).toEqual([MEDIA, VIDEO, POSTER_KEY]);
  });
});

describe('collectFileRefs / assembleStorageFiles', () => {
  const content = {
    type: 'doc',
    content: [
      { type: 'image', attrs: { src: `asset:${MEDIA}` } },
      { type: 'video', attrs: { src: `asset:${VIDEO}`, poster: `asset:${POSTER_KEY}` } },
    ],
  };

  function built() {
    const refs = collectFileRefs(
      USER,
      rows({
        documents: [
          {
            id: DOC,
            title: '讲义',
            description: null,
            fileKey: SOURCE,
            deletedAt: null,
            contentJson: content,
          },
          {
            id: DOC_2,
            title: null,
            description: null,
            fileKey: SHOT,
            deletedAt: '2026-01-02T00:00:00.000Z',
            contentJson: { type: 'doc', content: [{ type: 'image', attrs: { src: `asset:${MEDIA}` } }] },
          },
        ],
        cards: [
          {
            id: CARD,
            concept: '摘录概念',
            imageKey: EXCERPT,
            documentId: DOC,
            deletedAt: null,
          },
        ],
        annotations: [
          {
            id: NOTE,
            quote: '原文句子',
            note: '我的笔记',
            imageKey: EXCERPT,
            documentId: DOC,
            deletedAt: null,
          },
        ],
        canvas: [{ id: CANVAS, imageKey: `asset:${MEDIA}`, documentId: DOC_2 }],
        avatarKey: AVATAR,
      }),
    );
    const files = assembleStorageFiles(
      USER,
      [
        object(SOURCE, 100, '2026-03-01T00:00:00.000Z'),
        object(SHOT, 20, '2026-03-02T00:00:00.000Z'),
        object(EXCERPT, 30, '2026-03-03T00:00:00.000Z'),
        object(MEDIA, 40, '2026-03-04T00:00:00.000Z'),
        object(VIDEO, 500, '2026-03-05T00:00:00.000Z'),
        object(POSTER_KEY, 15, null),
        object(AVATAR, 8, '2026-03-06T00:00:00.000Z'),
        object(OLD_AVATAR, 9, '2026-01-01T00:00:00.000Z'),
        object(`docs/${OTHER}/${DOC}/source.pdf`, 1, '2026-03-07T00:00:00.000Z'),
        object(SOURCE, 999, '2026-03-08T00:00:00.000Z'),
      ],
      refs,
    );
    return { refs, files };
  }

  it('attaches every reference and marks orphans unused', () => {
    const { files } = built();
    const byKey = new Map(files.map((file) => [file.key, file]));
    expect(byKey.size).toBe(8);
    expect(byKey.get(SOURCE)).toMatchObject({
      kind: 'source',
      sizeBytes: 100,
      preview: null,
      unused: false,
      ext: 'pdf',
    });
    expect(byKey.get(SOURCE)?.refs.map((ref) => ref.title)).toEqual(['讲义']);
    expect(byKey.get(SHOT)).toMatchObject({ kind: 'source', preview: 'image', unused: false });
    expect(byKey.get(SHOT)?.refs[0]).toMatchObject({ archived: true, title: '未命名文档' });
    expect(byKey.get(EXCERPT)?.refs.map((ref) => ref.type)).toEqual(['card', 'annotation']);
    expect(byKey.get(EXCERPT)?.refs[1]?.title).toBe('我的笔记');
    expect(byKey.get(MEDIA)?.refs.map((ref) => `${ref.type}:${ref.id}`)).toEqual([
      `document:${DOC}`,
      `document:${DOC_2}`,
      `canvas:${CANVAS}`,
    ]);
    expect(byKey.get(MEDIA)?.refs.find((ref) => ref.id === DOC_2)?.archived).toBe(true);
    expect(byKey.get(MEDIA)?.refs.find((ref) => ref.type === 'canvas')?.archived).toBe(true);
    expect(byKey.get(VIDEO)).toMatchObject({ kind: 'media', preview: 'video', unused: false });
    expect(byKey.get(POSTER_KEY)?.unused).toBe(false);
    expect(byKey.get(AVATAR)?.refs).toEqual([
      { type: 'avatar', id: USER, title: '当前头像', documentId: null, archived: false },
    ]);
    expect(byKey.get(OLD_AVATAR)).toMatchObject({ kind: 'avatar', unused: true, refs: [] });
    expect(byKey.has(`docs/${OTHER}/${DOC}/source.pdf`)).toBe(false);
  });

  it('summarizes the whole set before filtering', () => {
    const summary = summarizeStorageFiles(built().files);
    expect(summary.totalCount).toBe(8);
    expect(summary.totalBytes).toBe(100 + 20 + 30 + 40 + 500 + 15 + 8 + 9);
    expect(summary.byKind.source).toEqual({ count: 2, bytes: 120 });
    expect(summary.byKind.media).toEqual({ count: 3, bytes: 555 });
    expect(summary.byKind.excerpt).toEqual({ count: 1, bytes: 30 });
    expect(summary.byKind.avatar).toEqual({ count: 2, bytes: 17 });
  });
});

describe('selectStorageFiles', () => {
  const files = assembleStorageFiles(
    USER,
    [
      object(SOURCE, 10, '2026-01-01T00:00:00.000Z'),
      object(OLD_AVATAR, 50, '2026-02-01T00:00:00.000Z'),
      object(MEDIA, 5, null),
    ],
    collectFileRefs(USER, rows({ avatarKey: null })),
  );

  it('filters unused objects and sorts newest first, with missing times last', () => {
    const page = selectStorageFiles(files, { ...query, unused: '1', sort: 'modified' });
    expect(page.total).toBe(3);
    expect(page.items.map((file) => file.key)).toEqual([OLD_AVATAR, SOURCE, MEDIA]);
  });

  it('sorts by size and pages', () => {
    const page = selectStorageFiles(files, {
      ...query,
      kind: 'source',
      sort: 'size',
      limit: 1,
      offset: 0,
    });
    expect(page.total).toBe(1);
    expect(page.items.map((file) => file.key)).toEqual([SOURCE]);
    const empty = selectStorageFiles(files, { ...query, kind: 'excerpt' });
    expect(empty).toEqual({ total: 0, items: [] });
  });
});
