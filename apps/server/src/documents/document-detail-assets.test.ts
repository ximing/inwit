import { expect, it, vi } from 'vitest';
import { documentDetailSchema } from '@inwit/dto';
import { getDb } from '../db/index.js';
import { documents, type DocumentRow } from '../db/schema.js';
import { presignGet } from '../storage/client.js';
import { getDocument } from './document.service.js';

vi.mock('../db/index.js', () => ({ getDb: vi.fn() }));
vi.mock('../storage/client.js', async (original) => ({
  ...await original<typeof import('../storage/client.js')>(), presignGet: vi.fn(),
}));

it('returns the editable document together with ready-to-use image URLs', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const src = `asset:users/${userId}/doc-assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png`;
  const row: DocumentRow = {
    id: '33333333-3333-4333-8333-333333333333', userId,
    topicId: null, mapNodeId: null, title: 'Article', description: null,
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src } }] }] },
    source: 'api', kind: 'document', reportWeekStart: null, status: 'digested',
    failReason: null, answer: null, linkHint: null,
    fileKey: null, fileMime: null, fileSize: null, pageCount: null,
    createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  };
  const db = {
    select: () => ({ from: (table: unknown) => ({ where: () => ({
      limit: async () => table === documents ? [row] : [],
      orderBy: async () => [],
    }) }) }),
  };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  vi.mocked(presignGet).mockResolvedValue('https://cdn.example/image.png?signature=ready');

  const detail = documentDetailSchema.parse(await getDocument(userId, row.id));

  expect(detail.contentJson).toEqual(row.contentJson);
  expect(detail.assetUrls).toEqual({ [src]: 'https://cdn.example/image.png?signature=ready' });
  expect(detail.assetUrlsFetchedAt).toBeGreaterThan(0);
});
