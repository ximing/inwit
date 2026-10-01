import type { DocumentDetail } from '@inwit/dto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDocument } from '@/api/documents';
import {
  DOCUMENT_PREFETCH_MAX_INFLIGHT,
  DOCUMENT_PREFETCH_TTL_MS,
  clearDocumentPrefetch,
  dropPrefetchedDocument,
  prefetchDocument,
  prefetchedDocument,
} from './document-prefetch';

vi.mock('@/api/documents', () => ({ getDocument: vi.fn() }));

const DOC = '11111111-1111-4111-8111-111111111111';

function detail(id: string): DocumentDetail {
  return { id } as DocumentDetail;
}

afterEach(() => {
  clearDocumentPrefetch();
  vi.useRealTimers();
  vi.mocked(getDocument).mockReset();
});

describe('document prefetch', () => {
  it('reuses one in-flight read for a later open', async () => {
    let release!: (doc: DocumentDetail) => void;
    vi.mocked(getDocument).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    prefetchDocument(DOC);
    prefetchDocument(DOC);
    expect(getDocument).toHaveBeenCalledTimes(1);
    const pending = prefetchedDocument(DOC);
    expect(pending).not.toBeNull();
    release(detail(DOC));
    await expect(pending).resolves.toMatchObject({ id: DOC });
  });

  it('drops a failed read so the next hover tries again', async () => {
    vi.mocked(getDocument).mockRejectedValueOnce(new Error('down'));
    prefetchDocument(DOC);
    await vi.waitFor(() => expect(prefetchedDocument(DOC)).toBeNull());
    vi.mocked(getDocument).mockResolvedValueOnce(detail(DOC));
    prefetchDocument(DOC);
    await expect(prefetchedDocument(DOC)).resolves.toMatchObject({ id: DOC });
    expect(getDocument).toHaveBeenCalledTimes(2);
  });

  it('keeps only the latest hover once two reads are already in flight', async () => {
    const pending: Array<(doc: DocumentDetail) => void> = [];
    vi.mocked(getDocument).mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    prefetchDocument('a');
    prefetchDocument('b');
    prefetchDocument('c');
    prefetchDocument('d');
    expect(getDocument).toHaveBeenCalledTimes(DOCUMENT_PREFETCH_MAX_INFLIGHT);
    expect(prefetchedDocument('d')).not.toBeNull();
    expect(getDocument).toHaveBeenCalledTimes(DOCUMENT_PREFETCH_MAX_INFLIGHT + 1);
    expect(vi.mocked(getDocument).mock.calls.map((call) => call[0])).toEqual(['a', 'b', 'd']);
    pending.forEach((release, index) => release(detail(String(index))));
    await Promise.all(pending.map((_, index) => vi.mocked(getDocument).mock.results[index]?.value));
  });

  it('expires a finished read', async () => {
    vi.useFakeTimers();
    vi.mocked(getDocument).mockResolvedValue(detail(DOC));
    prefetchDocument(DOC);
    await vi.mocked(getDocument).mock.results[0]?.value;
    expect(prefetchedDocument(DOC)).not.toBeNull();
    vi.advanceTimersByTime(DOCUMENT_PREFETCH_TTL_MS);
    expect(prefetchedDocument(DOC)).toBeNull();
  });

  it('forgets a dropped document', async () => {
    vi.mocked(getDocument).mockResolvedValue(detail(DOC));
    prefetchDocument(DOC);
    await prefetchedDocument(DOC);
    dropPrefetchedDocument(DOC);
    expect(prefetchedDocument(DOC)).toBeNull();
  });

  it('skips prefetch when the browser is saving data', () => {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    const previous = Object.getOwnPropertyDescriptor(nav, 'connection');
    Object.defineProperty(nav, 'connection', {
      configurable: true,
      value: { saveData: true },
    });
    try {
      prefetchDocument(DOC);
      expect(getDocument).not.toHaveBeenCalled();
    } finally {
      if (previous) Object.defineProperty(nav, 'connection', previous);
      else delete nav.connection;
    }
  });
});
