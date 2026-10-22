import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDocumentDetailCache, getDocument } from './documents';

const DOC = '11111111-1111-4111-8111-111111111111';
const ETAG = 'W/"abc"';

function detail(title: string) {
  return { id: DOC, title, contentJson: { type: 'doc', content: [] }, cards: [] };
}

afterEach(() => {
  clearDocumentDetailCache();
  vi.unstubAllGlobals();
});

describe('getDocument', () => {
  it('sends If-None-Match and keeps the cached body on 304', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (headers.get('If-None-Match') === ETAG) {
        return new Response(null, { status: 304 });
      }
      return new Response(JSON.stringify(detail('原文')), {
        status: 200,
        headers: { etag: ETAG, 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await getDocument(DOC);
    const second = await getDocument(DOC);

    expect(first.title).toBe('原文');
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondHeaders = new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit).headers);
    expect(secondHeaders.get('If-None-Match')).toBe(ETAG);
  });

  it('shares one request while the first read is in flight', async () => {
    let release!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = getDocument(DOC);
    const second = getDocument(DOC);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(
      new Response(JSON.stringify(detail('原文')), {
        status: 200,
        headers: { etag: ETAG },
      }),
    );
    await expect(first).resolves.toMatchObject({ title: '原文' });
    await expect(second).resolves.toMatchObject({ title: '原文' });
  });

  it('replaces the cache when the validator changes', async () => {
    let etag = ETAG;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = new Headers(init?.headers).get('If-None-Match');
      if (sent === etag) return new Response(null, { status: 304 });
      const body = detail(etag === ETAG ? '原文' : '新文');
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { etag },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    expect((await getDocument(DOC)).title).toBe('原文');
    etag = 'W/"next"';
    expect((await getDocument(DOC)).title).toBe('新文');
    expect((await getDocument(DOC)).title).toBe('新文');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
