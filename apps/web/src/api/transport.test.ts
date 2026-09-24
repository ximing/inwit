import { describe, expect, it, vi } from 'vitest';
import { browserFetch, browserUrl } from './transport';

describe('browserUrl', () => {
  it('returns a same-origin path unchanged', () => {
    expect(browserUrl('/api/auth/me')).toBe('/api/auth/me');
  });

  it('rejects absolute and protocol-relative URLs', () => {
    expect(() => browserUrl('https://inwit.aimo.plus/api/auth/me')).toThrow(
      'API path must be a same-origin path',
    );
    expect(() => browserUrl('//host/api/auth/me')).toThrow('API path must be a same-origin path');
  });
});

describe('browserFetch', () => {
  it('throws when Authorization is already set', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(() =>
      browserFetch('/api/auth/me', { headers: { Authorization: 'Bearer token' } }),
    ).toThrow('API transport must not set Authorization');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
