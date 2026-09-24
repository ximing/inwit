import { afterEach, describe, expect, it, vi } from 'vitest';
import { request, setUnauthorizedHandler } from './client';

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('request', () => {
  it('uses a same-origin path and includes cookies without Authorization', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: 'user' }));
    vi.stubGlobal('fetch', fetchMock);

    await request('/api/auth/me');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('/api/auth/me');
    const init = call?.[1] as RequestInit;
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });

  it('clears the session on 401 INVALID_TOKEN without calling refresh', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(401, { error: { code: 'INVALID_TOKEN', message: '登录已过期' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);

    await expect(request('/api/auth/me')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_TOKEN',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('/api/auth/refresh'))).toBe(false);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not clear the session on 401 INVALID_CREDENTIALS', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(401, { error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);

    await expect(request('/api/auth/login', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
