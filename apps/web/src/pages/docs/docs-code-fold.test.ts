import type { DocumentDetail } from '@inwit/dto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/documents', () => ({
  updateDocument: vi.fn(),
  createDocument: vi.fn(),
  getDocument: vi.fn(),
  listDocuments: vi.fn(),
  enqueueSelectionCards: vi.fn(),
  acceptProposedCards: vi.fn(),
  retryDocument: vi.fn(),
}));

import { updateDocument } from '@/api/documents';
import { DocsService } from './docs.service';

const saved = {
  type: 'doc',
  content: [
    {
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const x = 1' }],
    },
  ],
};

const folded = {
  type: 'doc',
  content: [
    {
      type: 'codeBlock',
      attrs: { language: 'ts', collapsed: true },
      content: [{ type: 'text', text: 'const x = 1' }],
    },
  ],
};

describe('read-mode code fold', () => {
  beforeEach(() => {
    vi.mocked(updateDocument).mockReset();
  });

  it('writes the folded document and keeps it on the open doc', async () => {
    const service = new DocsService();
    service.doc = {
      id: 'doc-1',
      title: '笔记',
      contentJson: saved,
      updatedAt: '2026-10-21T00:00:00.000Z',
    } as DocumentDetail;
    vi.mocked(updateDocument).mockResolvedValue({
      id: 'doc-1',
      title: '笔记',
      contentJson: folded,
      updatedAt: '2026-10-21T00:00:01.000Z',
    } as Awaited<ReturnType<typeof updateDocument>>);

    service.noteCodeFold(folded);
    await service.flushCodeFold();

    expect(updateDocument).toHaveBeenCalledWith('doc-1', { contentJson: folded });
    expect(service.doc?.contentJson).toEqual(folded);
    expect(service.doc?.updatedAt).toBe('2026-10-21T00:00:01.000Z');
  });

  it('skips a write when the body is already the saved one', async () => {
    const service = new DocsService();
    service.doc = {
      id: 'doc-1',
      title: '笔记',
      contentJson: saved,
      updatedAt: '2026-10-21T00:00:00.000Z',
    } as DocumentDetail;

    service.noteCodeFold(saved);
    await service.flushCodeFold();

    expect(updateDocument).not.toHaveBeenCalled();
  });
});
