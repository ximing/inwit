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
vi.mock('@/api/annotations', () => ({ listDocumentAnnotations: vi.fn(async () => []) }));
vi.mock('@/api/canvas', () => ({ listCanvasNodes: vi.fn(async () => []) }));

import { getDocument, updateDocument } from '@/api/documents';
import { DocsPendingPollService } from './docs-pending-poll.service.js';
import { DocsService } from './docs.service';
import { EditorService } from './editor.service';

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

  it('does not put the folded baseline over a newer document stamp', async () => {
    const service = new DocsService();
    service.doc = {
      id: 'doc-1',
      title: '笔记',
      contentJson: saved,
      updatedAt: '2026-10-21T00:00:00.000Z',
    } as DocumentDetail;
    service.noteCodeFold(folded);
    service.doc = {
      ...service.doc,
      updatedAt: '2026-10-21T00:00:02.000Z',
    };

    await service.flushCodeFold();

    expect(updateDocument).not.toHaveBeenCalled();
    expect(service.doc?.contentJson).toEqual(saved);
  });

  it('keeps the editor body when a fold is pending and drops a newer remote body from the put', async () => {
    const service = new DocsService();
    const editor = new EditorService();
    const polls = new DocsPendingPollService();
    vi.spyOn(service, 'resolve').mockImplementation(((token: unknown) => {
      if (token === EditorService) return editor;
      if (token === DocsPendingPollService) return polls;
      throw new Error('unexpected service');
    }) as typeof service.resolve);
    const remote = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '另一端刚写的' }] }],
    };
    service.doc = {
      id: 'doc-1',
      title: '笔记',
      contentJson: saved,
      updatedAt: '2026-10-21T00:00:00.000Z',
      topicId: null,
      cards: [],
    } as DocumentDetail;
    editor.phase = 'ready';
    editor.id = 'doc-1';
    editor.draftTitle = '笔记';
    editor.lastSavedTitle = '笔记';
    editor.draftJson = saved;
    editor.lastSavedJson = saved;
    service.noteCodeFold(folded);
    vi.mocked(getDocument).mockResolvedValue({
      id: 'doc-1',
      title: '笔记',
      contentJson: remote,
      updatedAt: '2026-10-21T00:00:03.000Z',
      topicId: null,
      cards: [],
    } as Awaited<ReturnType<typeof getDocument>>);

    try {
      await service.refreshOne('doc-1');
      await service.flushCodeFold();

      expect(editor.draftJson).toEqual(saved);
      expect(service.doc?.contentJson).toEqual(remote);
      expect(updateDocument).not.toHaveBeenCalled();
    } finally {
      polls.stopPolling();
      editor.destroy();
    }
  });
});
