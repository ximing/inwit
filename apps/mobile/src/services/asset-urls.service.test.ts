import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAssetUrls } from '@/api/assets';
import { AssetUrlsService } from './asset-urls.service';

vi.mock('@/api/assets', () => ({ resolveAssetUrls: vi.fn() }));

const a = 'asset:users/11111111-1111-1111-1111-111111111111/doc-assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png';
const b = 'asset:users/11111111-1111-1111-1111-111111111111/doc-assets/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.png';

function deferred() {
  let resolve!: (value: { urls: Record<string, string> }) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<{ urls: Record<string, string> }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

afterEach(() => vi.resetAllMocks());

describe('concurrent image URL resolution', () => {
  it.each(['success', 'missing', 'failure'] as const)(
    'keeps an already displayed image when another request finishes with %s',
    async (outcome) => {
      const first = deferred();
      const second = deferred();
      vi.mocked(resolveAssetUrls).mockImplementation(({ srcs }) =>
        srcs.includes(a) ? first.promise : second.promise,
      );
      const service = new AssetUrlsService();
      const displayed: Array<string | null> = [];
      const unsubscribe = service.subscribe(() => displayed.push(service.urlFor(a)));
      try {
        const loadingA = service.ensure([a]);
        const loadingB = service.ensure([b]);
        first.resolve({ urls: { [a]: 'https://cdn.example/a.png' } });
        await loadingA;
        expect(service.urlFor(a)).toBe('https://cdn.example/a.png');

        if (outcome === 'failure') second.reject(new Error('offline'));
        else second.resolve({ urls: outcome === 'success' ? { [b]: 'https://cdn.example/b.png' } : {} });
        await loadingB;

        expect(service.urlFor(a)).toBe('https://cdn.example/a.png');
        expect(displayed).toEqual(['https://cdn.example/a.png', 'https://cdn.example/a.png']);
        expect(service.urlFor(b)).toBe(outcome === 'success' ? 'https://cdn.example/b.png' : null);
      } finally {
        unsubscribe();
        service.destroy();
      }
    },
  );
});


describe('document asset URL seeding', () => {
  it('makes server-provided URLs available without another resolve request', async () => {
    const service = new AssetUrlsService();
    try {
      service.seed({ [a]: 'https://cdn.example/from-document.png' }, Date.now());
      await service.ensure([a]);
      expect(service.urlFor(a)).toBe('https://cdn.example/from-document.png');
      expect(resolveAssetUrls).not.toHaveBeenCalled();
    } finally { service.destroy(); }
  });

  it('keeps an existing valid URL stable when a refreshed document supplies another signature', () => {
    const service = new AssetUrlsService();
    try {
      service.seed({ [a]: 'https://cdn.example/first.png' }, Date.now());
      service.seed({ [a]: 'https://cdn.example/second.png', [b]: 'https://cdn.example/b.png' }, Date.now());
      expect(service.urlFor(a)).toBe('https://cdn.example/first.png');
      expect(service.urlFor(b)).toBe('https://cdn.example/b.png');
    } finally { service.destroy(); }
  });

  it('resolves expired document URLs instead of treating them as newly signed', async () => {
    const service = new AssetUrlsService();
    vi.mocked(resolveAssetUrls).mockResolvedValue({ urls: { [a]: 'https://cdn.example/refreshed.png' } });
    try {
      service.seed({ [a]: 'https://cdn.example/expired.png' }, Date.now() - 3600000);
      expect(service.urlFor(a)).toBeNull();
      await service.ensure([a]);
      expect(service.urlFor(a)).toBe('https://cdn.example/refreshed.png');
    } finally { service.destroy(); }
  });
});
