import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors.js';
import type { PublicLookup, ResolvedAddress } from '../net/public-url.js';
import { createPinnedLookup, downloadPublicMedia, type PinnedMediaRequest } from './import-fetch.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function headers(values: Record<string, string>): { get(name: string): string | null } {
  const lower = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => lower.get(name.toLowerCase()) ?? null };
}

function ok(bytes: Uint8Array = PNG): Awaited<ReturnType<PinnedMediaRequest>> {
  return { status: 200, headers: headers({ 'content-type': 'image/png' }), bytes };
}

async function expectBlocked(raw: string): Promise<void> {
  const lookup = vi.fn<PublicLookup>(async () => [{ address: '8.8.8.8', family: 4 }]);
  const request = vi.fn<PinnedMediaRequest>(async () => ok());
  await expect(downloadPublicMedia(raw, { lookup, request })).rejects.toMatchObject({
    status: 400,
    code: 'ASSET_IMPORT_BLOCKED',
  });
  expect(lookup).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
}

describe('downloadPublicMedia pinning', () => {
  it('rejects metadata, loopback, private, localhost, and decimal hosts before connect', async () => {
    await expectBlocked('http://169.254.169.254/latest/meta-data');
    await expectBlocked('http://127.0.0.1/a.png');
    await expectBlocked('http://10.1.2.3/a.png');
    await expectBlocked('http://10.255.255.255/a.png');
    await expectBlocked('https://localhost/a.png');
    await expectBlocked('http://2130706433/a.png');
    await expectBlocked('http://0x7f000001/a.png');
  });

  it('passes the checked public addresses to the connection layer', async () => {
    const addresses: ResolvedAddress[] = [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ];
    const lookup = vi.fn<PublicLookup>(async () => addresses);
    const request = vi.fn<PinnedMediaRequest>(async () => ok());
    const result = await downloadPublicMedia('https://cdn.example/a.png', { lookup, request });
    expect(result.contentType).toBe('image/png');
    expect(result.bytes).toEqual(PNG);
    expect(lookup).toHaveBeenCalledWith('cdn.example');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0].hostname).toBe('cdn.example');
    expect(request.mock.calls[0]?.[1]).toEqual(addresses);
  });

  it('blocks a hostname when any resolved address is private and hides DNS errors', async () => {
    const lookup = vi.fn<PublicLookup>(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.9', family: 4 },
    ]);
    const request = vi.fn<PinnedMediaRequest>(async () => ok());
    await expect(downloadPublicMedia('https://cdn.example/a.png', { lookup, request })).rejects.toMatchObject({
      status: 400,
      code: 'ASSET_IMPORT_BLOCKED',
    });
    expect(request).not.toHaveBeenCalled();

    const failed = vi.fn<PublicLookup>(async () => {
      throw new Error('getaddrinfo ENOTFOUND secret.internal');
    });
    try {
      await downloadPublicMedia('https://cdn.example/a.png', { lookup: failed, request });
      expect.fail('expected AppError');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('ASSET_IMPORT_FAILED');
      expect((err as AppError).message).not.toContain('secret.internal');
      expect((err as AppError).details).toBeUndefined();
    }
  });

  it('re-checks and re-pins every redirect', async () => {
    const lookup = vi.fn<PublicLookup>(async (hostname: string) => {
      if (hostname === 'a.example') return [{ address: '1.1.1.1', family: 4 }];
      if (hostname === 'b.example') return [{ address: '8.8.8.8', family: 4 }];
      throw new Error(`unexpected ${hostname}`);
    });
    const request = vi.fn<PinnedMediaRequest>(async (url) => {
      if (url.hostname === 'a.example') {
        return { status: 302, headers: headers({ location: 'https://b.example/b.png' }) };
      }
      return ok();
    });
    await downloadPublicMedia('https://a.example/a.png', { lookup, request });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[1]).toEqual([{ address: '1.1.1.1', family: 4 }]);
    expect(request.mock.calls[1]?.[0].hostname).toBe('b.example');
    expect(request.mock.calls[1]?.[1]).toEqual([{ address: '8.8.8.8', family: 4 }]);
  });

  it('does not connect to a redirect target that is literal-private or decimal', async () => {
    const lookup = vi.fn<PublicLookup>(async () => [{ address: '1.1.1.1', family: 4 }]);
    const request = vi.fn<PinnedMediaRequest>(async () => ({
      status: 302,
      headers: headers({ location: 'http://127.0.0.1/admin' }),
    }));
    await expect(downloadPublicMedia('https://cdn.example/a.png', { lookup, request })).rejects.toMatchObject({
      code: 'ASSET_IMPORT_BLOCKED',
    });
    expect(request).toHaveBeenCalledTimes(1);

    request.mockResolvedValueOnce({
      status: 302,
      headers: headers({ location: 'http://2130706433/admin' }),
    });
    await expect(downloadPublicMedia('https://cdn.example/a.png', { lookup, request })).rejects.toMatchObject({
      code: 'ASSET_IMPORT_BLOCKED',
    });
  });
});

describe('createPinnedLookup', () => {
  const addresses: ResolvedAddress[] = [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
  ];

  it('returns only the already-checked addresses', () => {
    const lookup = createPinnedLookup(addresses);
    lookup('cdn.example', {}, (err, address, family) => {
      expect(err).toBeNull();
      expect(address).toBe('93.184.216.34');
      expect(family).toBe(4);
    });
    lookup('cdn.example', { all: true }, (err, address) => {
      expect(err).toBeNull();
      expect(address).toEqual(addresses);
    });
    lookup('cdn.example', { family: 6 }, (err, address, family) => {
      expect(err).toBeNull();
      expect(address).toBe('2606:2800:220:1:248:1893:25c8:1946');
      expect(family).toBe(6);
    });
  });
});
