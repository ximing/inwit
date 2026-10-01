import { EMPTY_PM_DOC, type CardLinksResponse, type DocumentDetail } from '@inwit/dto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCardLinks } from '@/api/cards';
import { ApiError } from '@/api/client';
import { getDocument, getDocumentFile } from '@/api/documents';
import { ReaderService } from './reader.service';
import { AssetUrlsService } from '@/services/asset-urls.service';

vi.mock('@/api/documents', () => ({ getDocument: vi.fn(), getDocumentFile: vi.fn() }));
vi.mock('@/api/cards', () => ({ getCardLinks: vi.fn() }));

const oldLinks: CardLinksResponse = { outgoing: [], incoming: [] };

describe('reader document asset URLs', () => {
  it.each(['document', 'card', 'refresh'] as const)('seeds image URLs when opening a %s', async (mode) => {
    const src = 'asset:users/11111111-1111-4111-8111-111111111111/doc-assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png';
    const doc = {
      ...detail('images'),
      assetUrls: { [src]: 'https://cdn.example/image.png' },
      assetUrlsFetchedAt: Date.now(),
    };
    vi.mocked(getDocument).mockResolvedValue(doc);
    vi.mocked(getCardLinks).mockResolvedValue(oldLinks);
    const service = new ReaderService();
    const assets = new AssetUrlsService();
    vi.spyOn(service, 'resolve').mockReturnValue(assets);
    try {
      if (mode === 'document') await service.openDoc(doc.id);
      else if (mode === 'card') await service.openCard('card-1', doc.id);
      else {
        service.doc = detail(doc.id);
        await service.refreshOpenDocument(doc.id);
      }
      expect(service.doc?.id).toBe(doc.id);
      expect(assets.urlFor(src)).toBe('https://cdn.example/image.png');
    } finally {
      service.close();
      assets.destroy();
    }
  });
});

function detail(id: string): DocumentDetail {
  return {
    id,
    userId: 'user',
    topicId: null,
    mapNodeId: null,
    title: '文档',
    description: null,
    contentJson: EMPTY_PM_DOC,
    source: 'import',
    status: 'digested',
    answer: null,
    linkHint: null,
    failReason: null,
    fileMime: null,
    pageCount: null,
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    cards: [],
    topicTitle: null,
  };
}

describe('PDF reading overlay', () => {
  it('opens a PDF document instead of rejecting it', async () => {
    const doc: DocumentDetail = {
      id: 'pdf-doc', userId: 'user', topicId: null, mapNodeId: null,
      title: 'PDF', description: null, contentJson: EMPTY_PM_DOC,
      source: 'import', status: 'digested', answer: null, linkHint: null,
      fileMime: 'application/pdf', pageCount: 2,
      createdAt: '2026-09-17T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z',
      cards: [], topicTitle: null,
    };
    vi.mocked(getDocument).mockResolvedValue(doc);
    const service = new ReaderService();

    await service.openDoc(doc.id);

    expect(service.doc?.id).toBe(doc.id);
    expect(service.error).toBeNull();
    expect(service.isOpen).toBe(true);
    service.close();
    expect(service.isOpen).toBe(false);
  });
});

describe('reader remote document upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears the whole links cache and reloads links only for the open card', async () => {
    const fresh: CardLinksResponse = { outgoing: [], incoming: [] };
    vi.mocked(getDocument).mockResolvedValue(detail('doc-1'));
    vi.mocked(getCardLinks).mockResolvedValue(fresh);
    const service = new ReaderService();
    service.doc = detail('doc-1');
    service.activeCardId = 'card-a';
    service.linksCache = { 'card-a': oldLinks, 'card-b': { outgoing: [], incoming: [] } };
    service.pendingScrollTop = false;
    service.loading = false;

    await service.refreshOpenDocument('doc-1');

    expect(getCardLinks).toHaveBeenCalledTimes(1);
    expect(getCardLinks).toHaveBeenCalledWith('card-a');
    expect(service.linksCache['card-b']).toBeUndefined();
    expect(service.linksCache['card-a']).toEqual(fresh);
    expect(service.loading).toBe(false);
    expect(service.pendingScrollTop).toBe(false);
  });

  it('does not fetch links when no card is open', async () => {
    vi.mocked(getDocument).mockResolvedValue(detail('doc-1'));
    const service = new ReaderService();
    service.doc = detail('doc-1');
    service.activeCardId = null;
    service.linksCache = { 'card-b': oldLinks };

    await service.refreshOpenDocument('doc-1');

    expect(getCardLinks).not.toHaveBeenCalled();
    expect(service.linksCache).toEqual({});
  });

  it('ignores an upsert for a different document', async () => {
    const service = new ReaderService();
    service.doc = detail('doc-1');

    await service.refreshOpenDocument('doc-2');

    expect(getDocument).not.toHaveBeenCalled();
    expect(service.doc?.id).toBe('doc-1');
  });

  it('closes when the open document is gone', async () => {
    vi.mocked(getDocument).mockRejectedValue(new ApiError(404, 'NOT_FOUND', '没有这份文档'));
    const service = new ReaderService();
    service.doc = detail('doc-1');
    service.linksCache = { 'card-a': oldLinks };

    await service.refreshOpenDocument('doc-1');

    expect(service.doc).toBeNull();
    expect(service.linksCache).toEqual({});
    expect(service.isOpen).toBe(false);
  });

  it('keeps linksCache when returning from a card to the list', () => {
    const service = new ReaderService();
    service.doc = detail('doc-1');
    service.activeCardId = 'card-a';
    service.linksCache = { 'card-a': { outgoing: [], incoming: [] } };

    service.backToList();

    expect(service.activeCardId).toBeNull();
    expect(service.linksCache['card-a']).toEqual({ outgoing: [], incoming: [] });
  });

  it('drops cached links before the detail request finishes', async () => {
    let release!: (doc: DocumentDetail) => void;
    vi.mocked(getDocument).mockReturnValue(new Promise((resolve) => {
      release = resolve;
    }));
    const service = new ReaderService();
    service.doc = detail('doc-1');
    service.activeCardId = 'card-a';
    service.links = oldLinks;
    service.linksCache = { 'card-a': oldLinks, 'card-b': oldLinks };

    const pending = service.refreshOpenDocument('doc-1');

    expect(service.links).toBeNull();
    expect(service.linksCache).toEqual({});
    release(detail('doc-1'));
    await pending;
  });

  it('refetches links when the detail request fails and does not keep the old cache', async () => {
    vi.mocked(getDocument).mockRejectedValue(new ApiError(500, 'INTERNAL', '失败'));
    vi.mocked(getCardLinks).mockResolvedValue({ outgoing: [], incoming: [] });
    const service = new ReaderService();
    service.doc = detail('doc-1');
    service.activeCardId = 'card-a';
    service.links = oldLinks;
    service.linksCache = { 'card-a': oldLinks, 'card-b': oldLinks };

    await service.refreshOpenDocument('doc-1');

    expect(service.doc?.id).toBe('doc-1');
    expect(service.linksCache['card-b']).toBeUndefined();
    expect(getCardLinks).toHaveBeenCalledWith('card-a');
    expect(service.isOpen).toBe(true);
  });

  it('keeps an in-flight PDF presign when the document is refreshed', async () => {
    const pdf = { ...detail('doc-1'), fileMime: 'application/pdf' };
    vi.mocked(getDocument).mockResolvedValue(pdf);
    let release!: (file: { url: string; mime: string }) => void;
    vi.mocked(getDocumentFile).mockReturnValue(new Promise((resolve) => {
      release = resolve;
    }));
    const service = new ReaderService();

    await service.openDoc('doc-1');
    expect(service.pdfUrl).toBeNull();
    await service.refreshOpenDocument('doc-1');
    release({ url: 'https://files.example/a.pdf', mime: 'application/pdf' });
    await vi.waitFor(() => {
      expect(service.pdfUrl).toBe('https://files.example/a.pdf');
    });
  });

  it('leaves a displayed PDF url in place when the document is refreshed', async () => {
    const pdf = { ...detail('doc-1'), fileMime: 'application/pdf' };
    vi.mocked(getDocument).mockResolvedValue(pdf);
    const service = new ReaderService();
    service.doc = pdf;
    service.pdfUrl = 'https://files.example/old.pdf';

    await service.refreshOpenDocument('doc-1');

    expect(service.pdfUrl).toBe('https://files.example/old.pdf');
  });

  it('clears loading when a newer refresh supersedes an open', async () => {
    const first = detail('doc-1');
    let release!: (doc: DocumentDetail) => void;
    vi.mocked(getDocument).mockImplementation((id: string) => {
      if (id === 'doc-2') {
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve(first);
    });
    const service = new ReaderService();
    service.doc = first;

    const pending = service.openDoc('doc-2');
    expect(service.loading).toBe(true);
    await service.refreshOpenDocument('doc-1');
    release(detail('doc-2'));
    await pending;

    expect(service.loading).toBe(false);
    expect(service.doc?.id).toBe('doc-1');
  });
});
